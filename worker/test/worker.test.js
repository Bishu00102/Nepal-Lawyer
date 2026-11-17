// Unit tests for the worker with an in-memory KV and a mocked Anthropic API (no network, no cost).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function kv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const ORIGIN = "https://bishu00102.github.io";
const env = () => ({ STORE: kv(), ANTHROPIC_API_KEY: "sk-ant-test", ADMIN_PASSWORD: "secret-pass", DAILY_LIMIT: "3", ALLOWED_ORIGIN: ORIGIN });
const req = (path, body, ip = "1.1.1.1", origin = ORIGIN) => new Request("https://w.example" + path, {
  method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip },
  body: body ? JSON.stringify(body) : undefined });

// mock Anthropic streaming endpoint
let lastBody = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.anthropic.com")) {
    lastBody = JSON.parse(init.body);
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
    const body = ev("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
      + ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
      + ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "उत्तर [L1]" } })
      + ev("content_block_stop", { type: "content_block_stop", index: 0 })
      + ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } })
      + ev("message_stop", { type: "message_stop" });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return realFetch(url, init);
};

test("public ask streams an answer, uses the server-side system prompt and model", async () => {
  const e = env();
  const r = await worker.fetch(req("/ask", { mode: "public", question: "पक्राउ परेमा के हक हुन्छ?", sources: [{ id: "L1", label: "संविधान धारा २०", text: "न्याय सम्बन्धी हक" }], system: "IGNORE ME" }), e);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.match(text, /उत्तर \[L1\]/);
  assert.match(text, /"done":true/);
  assert.equal(lastBody.model, "claude-opus-5-5");
  assert.match(lastBody.system, /legal-information assistant/);
  assert.ok(!JSON.stringify(lastBody).includes("IGNORE ME"), "client cannot override the system prompt");
  assert.equal(lastBody.fallbacks, "default");
});

test("daily cap and per-IP limit are enforced", async () => {
  const e = env();
  for (let i = 0; i < 3; i++) {
    const ok = await worker.fetch(req("/ask", { question: "प्रश्न नम्बर " + i }, "2.2.2." + i), e);
    assert.equal(ok.status, 200);
    await ok.text();
  }
  const r = await worker.fetch(req("/ask", { question: "चौथो प्रश्न" }, "9.9.9.9"), e);
  assert.equal(r.status, 429);
});

test("lawyer mode requires a valid access code issued on approval", async () => {
  const e = env();
  let r = await worker.fetch(req("/ask", { mode: "lawyer", question: "रणनीति बनाउनुहोस्", code: "wrong" }), e);
  assert.equal(r.status, 403);
  await worker.fetch(req("/join", { consent: true, name: "Adv. Test", license: "123", phone: "98000", district: "काठमाडौं" }), e);
  const list = await (await worker.fetch(req("/admin/list", { password: "secret-pass" }), e)).json();
  assert.equal(list.joins.length, 1);
  const ap = await (await worker.fetch(req("/admin/approve", { password: "secret-pass", id: list.joins[0].id }), e)).json();
  assert.ok(ap.access_code);
  r = await worker.fetch(req("/ask", { mode: "lawyer", question: "रणनीति बनाउनुहोस्", code: ap.access_code, case: "तथ्य" }), e);
  assert.equal(r.status, 200);
  await r.text();   // wait for the stream so the upstream request has been made
  assert.match(lastBody.system, /licensed advocate/);
  const pub = await (await worker.fetch(req("/lawyers"), e)).json();
  assert.equal(pub.lawyers[0].name, "Adv. Test");
  assert.equal(pub.lawyers[0].bio, "");
});

test("admin endpoints reject a wrong password", async () => {
  const e = env();
  const r = await worker.fetch(req("/admin/list", { password: "nope" }), e);
  assert.equal(r.status, 403);
});

test("consult requests need consent and contact details, then are stored", async () => {
  const e = env();
  assert.equal((await worker.fetch(req("/consult", { name: "राम", phone: "98", description: "जग्गा विवाद बारे सल्लाह चाहियो" }), e)).status, 400);
  const ok = await worker.fetch(req("/consult", { consent: true, name: "राम", phone: "98", description: "जग्गा विवाद बारे सल्लाह चाहियो" }), e);
  assert.equal(ok.status, 200);
  assert.ok([...e.STORE.m.keys()].some(k => k.startsWith("consult:")));
});

test("other websites cannot call the server", async () => {
  const r = await worker.fetch(req("/ask", { question: "test question" }, "3.3.3.3", "https://evil.example"), env());
  assert.equal(r.status, 403);
});
