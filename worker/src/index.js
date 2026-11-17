// Nepal Lawyer AI server (Cloudflare Worker)
//
// Holds the site owner's Anthropic API key so visitors never see it, and enforces limits:
//   POST /ask           AI answer (public legal information, or lawyer assistant with an access code)
//   POST /consult       a member of the public asks for a consultation with a lawyer
//   POST /join          a lawyer applies to be listed
//   GET  /lawyers       approved lawyers (public fields only)
//   GET  /health        status + today's remaining AI answers
//   POST /admin/*       site owner only (ADMIN_PASSWORD): list, approve/remove lawyers, close requests
//
// The system prompts live here, not in the browser, so the endpoint cannot be used as a
// general-purpose chatbot. Secrets: ANTHROPIC_API_KEY, ADMIN_PASSWORD. KV binding: STORE.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";                     // used only if ANTHROPIC_API_KEY is set (paid)
const FREE_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";      // Cloudflare Workers AI, free daily allowance
// Free mode keeps prompts small: the model's context is shorter and Neurons are counted per token.
const FREE_LIMITS = { public: { maxTokens: 1500, maxSources: 12000 }, lawyer: { maxTokens: 3000, maxSources: 20000 } };
const LIMITS = {
  public: { perIpPerDay: 15, maxTokens: 4000, effort: "medium", maxSources: 40000, maxQuestion: 2000, maxHistory: 0 },
  lawyer: { perCodePerDay: 40, maxTokens: 16000, effort: "high", maxSources: 90000, maxQuestion: 24000, maxHistory: 30000 },
};

const PUBLIC_SYSTEM = `You are "Kanooni Sahayak", the legal-information assistant of a Nepali law website. You help ordinary people in Nepal understand the law that applies to their situation.

Rules:
1. Reply in the language of the question (Nepali in Devanagari by default; English if asked in English). Use plain words a non-lawyer understands; explain any legal term you use.
2. Base every legal statement only on the sources inside <sources> (Constitution of Nepal articles, Acts, Nepal Kanoon Patrika precedents). Cite them inline with their ids, e.g. [L3] or [P2]. Never cite any other law, section, case or decision, even if you believe it exists. If the sources do not cover the question, say so plainly and suggest what kind of lawyer or office can help.
3. This is general legal information, not legal advice for their case. Do not predict the outcome of a specific case. Where the matter is serious or time-limited (arrest or detention, a court date, a limitation period, violence or threats), say clearly that they should contact a lawyer immediately; if someone is in danger, tell them to call Nepal Police (100).
4. Do not help anyone commit, hide or escape responsibility for a crime, harm another person, or deceive a court or authority.
5. Keep it short: a direct answer first, then the relevant rights or steps as a short list, then "स्रोत" (sources used). End with one line: "यो सामान्य कानूनी जानकारी हो, कानूनी सल्लाह होइन — आफ्नो विषयमा वकिलसँग परामर्श गर्नुहोस्।" (in English if the reply is English).`;

const LAWYER_SYSTEM = `You are a legal research and drafting assistant working for a licensed advocate in Nepal, inside a law-research website. The advocate reviews and takes responsibility for everything you produce.

Rules:
1. Write in the language the advocate uses (formal Nepali legal register in Devanagari by default).
2. Legal authority: rely only on the sources inside <sources> (Constitution of Nepal, Acts, Nepal Kanoon Patrika headnotes, Supreme Court orders). Cite them with their ids, e.g. [L3], [P2], and the citation given. Do not cite, name or rely on any other Act, section, decision or case number; if one is needed, write [वकिलले थप्नुहोस्: …] describing what to look for.
3. Attribute to a precedent only what its quoted headnote says. Never present your own analysis as a holding of the court.
4. Facts: use only the case facts provided. Never invent names, dates, evidence or statements; mark gaps as [तथ्य पुष्टि गर्नुहोस्: …].
5. Be useful like a senior colleague: identify issues, strengths and weaknesses for both sides, procedural points, evidence gaps, and practical next steps. Flag conflicting authorities and points that need verification (e.g. whether the law applied on the date of the offence).
6. Output is ready to use: headings with "## ", numbered paragraphs, no Markdown tables.`;

const cors = (origin, env) => ({
  "Access-Control-Allow-Origin": allowedOrigin(origin, env) ? origin : (env.ALLOWED_ORIGIN || "*").split(",")[0],
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});
function allowedOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  return !list.length || list.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin || "");
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
const today = () => new Date().toISOString().slice(0, 10);
const str = (v, max) => (typeof v === "string" ? v : "").trim().slice(0, max);

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
async function bump(env, key, limit) {
  // KV is eventually consistent, so limits are approximate (they stop runaway use, not single requests)
  const n = parseInt((await env.STORE.get(key)) || "0", 10);
  if (n >= limit) return false;
  await env.STORE.put(key, String(n + 1), { expirationTtl: 60 * 60 * 48 });
  return true;
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function buildPrompt(body, mode, free) {
  const L = LIMITS[mode];
  let budget = free ? FREE_LIMITS[mode].maxSources : L.maxSources;
  const src = [];
  for (const s of Array.isArray(body.sources) ? body.sources.slice(0, 40) : []) {
    const id = str(s.id, 8).replace(/[^A-Z0-9]/g, "");
    const block = `<source id="${id}">\n${str(s.label, 300)}\n${str(s.text, 6000)}\n</source>`;
    if (!id || block.length > budget) continue;
    budget -= block.length;
    src.push(block);
  }
  const caseText = mode === "lawyer" && body.case ? `<case>\n${str(body.case, 20000)}\n</case>\n\n` : "";
  const task = mode === "lawyer" && body.task ? `Task: ${str(body.task, 500)}\n\n` : "";
  return `${caseText}<sources>\n${src.join("\n\n") || "(none found)"}\n</sources>\n\n${task}${mode === "public" ? "Question" : "Advocate's request"}: ${str(body.question, L.maxQuestion)}`;
}

async function ask(request, env, headers) {
  const free = !env.ANTHROPIC_API_KEY;
  if (free && !env.AI) return json({ error: "AI is not configured on this site yet." }, 503, headers);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, headers); }
  const mode = body.mode === "lawyer" ? "lawyer" : "public";
  const L = LIMITS[mode];
  if (!str(body.question, 10)) return json({ error: "प्रश्न लेख्नुहोस्।" }, 400, headers);
  const day = today();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (mode === "lawyer") {
    const code = str(body.code, 40);
    const lawyer = code ? await env.STORE.get("code:" + await sha(code), "json") : null;
    if (!lawyer) return json({ error: "वकिल पहुँच कोड मिलेन।" }, 403, headers);
    if (!(await bump(env, `rl:code:${day}:${await sha(code)}`, L.perCodePerDay)))
      return json({ error: "आजको सीमा पुग्यो (वकिल)। भोलि फेरि प्रयास गर्नुहोस् वा आफ्नै API key प्रयोग गर्नुहोस्।" }, 429, headers);
  } else if (!(await bump(env, `rl:ip:${day}:${await sha(ip + day)}`, L.perIpPerDay))) {
    return json({ error: "आज तपाईंले धेरै प्रश्न सोध्नुभयो। भोलि फेरि प्रयास गर्नुहोस्।" }, 429, headers);
  }
  if (!(await bump(env, `use:all:${day}`, parseInt(env.DAILY_LIMIT || "200", 10))))
    return json({ error: "आजको लागि यस वेबसाइटको AI सीमा पुग्यो। भोलि फेरि प्रयास गर्नुहोस्।" }, 429, headers);

  const messages = [];
  if (mode === "lawyer" && Array.isArray(body.history)) {
    let budget = L.maxHistory;
    for (const m of body.history.slice(-10)) {
      const content = str(m && m.content, 8000);
      if (!content || (m.role !== "user" && m.role !== "assistant") || content.length > budget) continue;
      budget -= content.length;
      messages.push({ role: m.role, content });
    }
    while (messages.length && messages[0].role !== "user") messages.shift();
  }
  messages.push({ role: "user", content: buildPrompt(body, mode, free) });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = obj => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const system = mode === "lawyer" ? LAWYER_SYSTEM : PUBLIC_SYSTEM;
  (async () => {
    try {
      if (free) await runFree(env, system, messages, FREE_LIMITS[mode].maxTokens, send);
      else await runClaude(env, system, messages, L, send);
    } catch (e) {
      const status = e && e.status;
      await send({ error: status === 429 ? "AI सेवा व्यस्त छ, केही बेरपछि प्रयास गर्नुहोस्।" : status === 401 ? "AI key मिलेन (साइट सञ्चालकलाई जानकारी दिनुहोस्)।"
        : free && /neuron|limit|capacity|4006|3036/i.test(String(e && e.message)) ? "आजको निःशुल्क AI सीमा सकियो। भोलि फेरि प्रयास गर्नुहोस्।" : "AI उत्तर बन्न सकेन।" });
    } finally {
      await writer.close();
    }
  })();
  return new Response(readable, { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
}

// Paid: Claude via the official SDK (only when the owner adds ANTHROPIC_API_KEY)
async function runClaude(env, system, messages, L, send) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: L.maxTokens,
    output_config: { effort: L.effort },
    // on a safety-classifier decline the API retries on a fallback model within the same call
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages,
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") await send({ t: ev.delta.text });
  }
  const msg = await stream.finalMessage();
  await send({ done: true, stop: msg.stop_reason });
}

// Free: Cloudflare Workers AI (binding "AI"). On the Workers Free plan, use beyond the daily
// allowance fails instead of being billed.
async function runFree(env, system, messages, maxTokens, send) {
  // "/no_think" turns off Qwen3's long hidden reasoning so the free allowance goes to the answer
  const msgs = [{ role: "system", content: system }, ...messages];
  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: msgs[msgs.length - 1].content + "\n\n/no_think" };
  const stream = await env.AI.run(FREE_MODEL, { messages: msgs, max_tokens: maxTokens, temperature: 0.3, stream: true });
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "", inThink = false, stop = "end_turn";
  const emit = async chunk => {
    // drop any <think>…</think> section the model still produces
    let out = "";
    while (chunk) {
      if (inThink) {
        const e = chunk.indexOf("</think>");
        if (e < 0) return;
        chunk = chunk.slice(e + 8); inThink = false;
      } else {
        const b = chunk.indexOf("<think>");
        if (b < 0) { out += chunk; break; }
        out += chunk.slice(0, b); chunk = chunk.slice(b + 7); inThink = true;
      }
    }
    if (out) await send({ t: out });
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      // Workers AI streams either {"response": "..."} or OpenAI-style {"choices":[{"delta":{"content":"..."}}]}
      const piece = ev.response ?? ev.choices?.[0]?.delta?.content ?? "";
      if (piece) await emit(piece);
      const fr = ev.choices?.[0]?.finish_reason;
      if (fr === "length") stop = "max_tokens";
    }
  }
  await send({ done: true, stop });
}

async function consult(request, env, headers) {
  const b = await request.json().catch(() => ({}));
  if (b.consent !== true) return json({ error: "सहमति आवश्यक छ।" }, 400, headers);
  const rec = { name: str(b.name, 120), phone: str(b.phone, 40), email: str(b.email, 120), district: str(b.district, 60),
    area: str(b.area, 80), description: str(b.description, 4000), lawyer: str(b.lawyer, 40), at: new Date().toISOString(), status: "new" };
  if (!rec.name || !(rec.phone || rec.email) || rec.description.length < 10) return json({ error: "नाम, फोन वा इमेल, र विषय लेख्नुहोस्।" }, 400, headers);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await bump(env, `rl:consult:${today()}:${await sha(ip)}`, 5))) return json({ error: "आजको सीमा पुग्यो।" }, 429, headers);
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await env.STORE.put("consult:" + id, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 180 });
  return json({ ok: true, id }, 200, headers);
}

async function join(request, env, headers) {
  const b = await request.json().catch(() => ({}));
  if (b.consent !== true) return json({ error: "सहमति आवश्यक छ।" }, 400, headers);
  const rec = { name: str(b.name, 120), license: str(b.license, 40), phone: str(b.phone, 40), email: str(b.email, 120),
    district: str(b.district, 60), courts: str(b.courts, 200), areas: str(b.areas, 200), languages: str(b.languages, 100),
    bio: str(b.bio, 1500), at: new Date().toISOString() };
  if (!rec.name || !rec.license || !(rec.phone || rec.email)) return json({ error: "नाम, प्रमाणपत्र नं. र सम्पर्क आवश्यक छ।" }, 400, headers);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await bump(env, `rl:join:${today()}:${await sha(ip)}`, 3))) return json({ error: "आजको सीमा पुग्यो।" }, 429, headers);
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await env.STORE.put("join:" + id, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 });
  return json({ ok: true }, 200, headers);
}

async function listPrefix(env, prefix, limit = 200) {
  const out = [];
  const { keys } = await env.STORE.list({ prefix, limit });
  for (const k of keys) out.push({ id: k.name.slice(prefix.length), ...(await env.STORE.get(k.name, "json")) });
  return out.reverse();
}

async function admin(path, request, env, headers) {
  const b = await request.json().catch(() => ({}));
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const failKey = `rl:adminfail:${today()}:${await sha(ip)}`;
  if (parseInt((await env.STORE.get(failKey)) || "0", 10) >= 10) return json({ error: "धेरै गलत प्रयास।" }, 429, headers);
  if (!env.ADMIN_PASSWORD || !safeEqual(str(b.password, 200), env.ADMIN_PASSWORD)) {
    await bump(env, failKey, 1000);
    return json({ error: "पासवर्ड मिलेन।" }, 403, headers);
  }
  const lawyers = (await env.STORE.get("lawyers", "json")) || [];
  if (path === "/admin/list") {
    return json({ joins: await listPrefix(env, "join:"), consults: await listPrefix(env, "consult:"), lawyers,
      used_today: parseInt((await env.STORE.get(`use:all:${today()}`)) || "0", 10), limit: parseInt(env.DAILY_LIMIT || "200", 10) }, 200, headers);
  }
  if (path === "/admin/approve") {
    const id = str(b.id, 60);
    const rec = await env.STORE.get("join:" + id, "json");
    if (!rec) return json({ error: "not found" }, 404, headers);
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const pub = { id, name: rec.name, license: rec.license, phone: rec.phone, email: rec.email, district: rec.district,
      courts: rec.courts, areas: rec.areas, languages: rec.languages, bio: rec.bio };
    await env.STORE.put("lawyers", JSON.stringify([...lawyers.filter(l => l.id !== id), pub]));
    await env.STORE.put("code:" + await sha(code), JSON.stringify({ id, name: rec.name }));
    await env.STORE.delete("join:" + id);
    return json({ ok: true, access_code: code }, 200, headers);
  }
  if (path === "/admin/remove-lawyer") {
    await env.STORE.put("lawyers", JSON.stringify(lawyers.filter(l => l.id !== str(b.id, 60))));
    return json({ ok: true }, 200, headers);
  }
  if (path === "/admin/delete") {
    const key = str(b.key, 100);
    if (!/^(join|consult):[\w-]+$/.test(key)) return json({ error: "bad key" }, 400, headers);
    await env.STORE.delete(key);
    return json({ ok: true }, 200, headers);
  }
  if (path === "/admin/new-code") {
    // issue an access code for a listed lawyer (e.g. if they lost it); old codes keep working
    const l = lawyers.find(x => x.id === str(b.id, 60));
    if (!l) return json({ error: "not found" }, 404, headers);
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await env.STORE.put("code:" + await sha(code), JSON.stringify({ id: l.id, name: l.name }));
    return json({ ok: true, access_code: code }, 200, headers);
  }
  return json({ error: "unknown" }, 404, headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (origin && !allowedOrigin(origin, env)) return json({ error: "origin not allowed" }, 403, headers);
    try {
      if (url.pathname === "/health") {
        const used = parseInt((await env.STORE.get(`use:all:${today()}`)) || "0", 10);
        const limit = parseInt(env.DAILY_LIMIT || "200", 10);
        return json({ ok: true, ai: !!(env.ANTHROPIC_API_KEY || env.AI), provider: env.ANTHROPIC_API_KEY ? "claude" : env.AI ? "free" : "none",
          remaining_today: Math.max(0, limit - used) }, 200, headers);
      }
      if (url.pathname === "/lawyers" && request.method === "GET") {
        return json({ lawyers: (await env.STORE.get("lawyers", "json")) || [] }, 200, { ...headers, "Cache-Control": "max-age=300" });
      }
      if (request.method !== "POST") return json({ error: "not found" }, 404, headers);
      if (url.pathname === "/ask") return await ask(request, env, headers);
      if (url.pathname === "/consult") return await consult(request, env, headers);
      if (url.pathname === "/join") return await join(request, env, headers);
      if (url.pathname.startsWith("/admin/")) return await admin(url.pathname, request, env, headers);
      return json({ error: "not found" }, 404, headers);
    } catch (e) {
      return json({ error: "server error" }, 500, headers);
    }
  },
};
