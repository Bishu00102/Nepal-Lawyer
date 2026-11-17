"use strict";
/* Shared AI plumbing: find relevant sources, stream an answer, render it with linked citations.
   Answers go through the site's AI server (owner's key, daily limits) or, for lawyers, their own key. */

const siteConfig = () => getJSON("data/config.json").catch(() => ({ ai_url: "" }));

/* ---------- retrieval: Constitution (2072), core Acts, NKP headnotes ---------- */
// strip common Nepali case endings / postpositions so "प्रहरीले", "पक्राउमा" match "प्रहरी", "पक्राउ"
const SUFFIXES = ["हरूलाई", "हरूको", "हरूले", "हरूमा", "हरू", "हरु", "लाई", "बाट", "देखि", "सम्म", "द्वारा", "सँग", "को", "का", "की", "ले", "मा", "छन्", "हुन्छन्", "हुन्छ", "गरेमा", "भएमा"];
const QSTOP = new Set("के कसरी कहाँ किन कति मेरो मेरा मलाई हामी तपाईं गर्ने गर्नु हुने हुन्छ हुन्छन् भने छ छन् कुन what how where can my the and for are is".split(" "));
function stemTerms(q) {
  const out = new Set();
  for (const t of tokens(q)) {
    if (QSTOP.has(t)) continue;
    let s = t;
    for (const suf of SUFFIXES) if (s.length > suf.length + 1 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
    if (s.length > 1 && !QSTOP.has(s)) out.add(s);
  }
  return [...out];
}
// BM25 over a small in-memory collection: rare words weigh more, long texts don't win by length alone
function bm25(docs, terms, textOf, headOf) {
  const N = docs.length || 1;
  const texts = docs.map(d => norm(textOf(d)));
  const heads = headOf ? docs.map(d => norm(headOf(d))) : null;
  const avg = texts.reduce((a, t) => a + t.length, 0) / N || 1;
  const idf = terms.map(t => { const df = texts.filter(x => x.includes(t)).length; return Math.log(1 + (N - df + 0.5) / (df + 0.5)); });
  return docs.map((d, i) => {
    let s = 0;
    terms.forEach((t, j) => {
      let tf = 0, k = texts[i].indexOf(t);
      while (k >= 0 && tf < 20) { tf++; k = texts[i].indexOf(t, k + t.length); }
      if (tf) s += idf[j] * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * texts[i].length / avg));
      if (heads && heads[i].includes(t)) s += idf[j] * 1.5;     // heading match is a strong signal
    });
    return [s, d];
  }).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
}

async function retrieveSources(question, opts = {}) {
  const terms = stemTerms(question);
  const latin = /[a-z]{3,}/i.test(question) && !/[ऀ-ॿ]/.test(question);
  const out = [];
  const [cons, laws, nkpIdx, heads] = await Promise.all([
    optional(constitutionsData()), optional(coreLaws()), optional(nkpIndex()), optional(nkpHeads())]);
  // Constitution of Nepal 2072 — Nepali, plus English when the question is in English
  if (cons) {
    const c = cons.constitutions.find(x => x.key === "2072");
    for (const v of c ? c.versions : []) {
      if (v.lang === "en" && !latin && !opts.bothLanguages) continue;
      bm25(v.articles, terms, a => a.heading + " " + a.text, a => a.heading).slice(0, opts.constitution || 3)
        .forEach(([s, a]) => out.push({ kind: "law", score: s, label: `नेपालको संविधान, धारा ${toDev(a.n)} (${a.heading})${v.lang === "en" ? " [English]" : ""}`,
          text: a.text.slice(0, 1800), href: `#/constitution/2072?lang=${v.lang}&a=${a.n}` }));
    }
  }
  // Acts and codes (constitution excluded: covered above)
  if (laws) {
    const all = laws.filter(a => a.area !== "constitution").flatMap(act => act.section_list.map(s => ({ act, s })));
    bm25(all, terms, r => r.s.heading + " " + r.s.body, r => r.s.heading).slice(0, opts.sections || 6)
      .map(([score, r]) => ({ ...r, score }))
      .forEach(r => out.push({ kind: "law", score: r.score, label: `${r.act.title}, दफा ${toDev(r.s.number)} (${r.s.heading})`,
        text: r.s.body.slice(0, 1800), href: `#/law/${r.act.id}?s=${encodeURIComponent(r.s.number)}`, act: r.act, sec: r.s }));
  }
  // Reported precedents: best-matching headnotes
  if (nkpIdx && heads && terms.length) {
    const docs = [];
    for (const r of nkpIdx.rows) { const d = NK(r); (heads[d.id] || []).forEach(h => docs.push({ d, h })); }
    const cands = bm25(docs, terms, x => x.d.title + " " + x.h[0], x => x.d.title)
      .map(([s, x]) => [s + (opts.criminal && x.d.criminal ? 0.3 : 0), x.d, x.h]).sort((a, b) => b[0] - a[0]);
    const seen = new Set();
    for (const [s, d, h] of cands) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ kind: "nkp", score: s, label: `${d.title}, ${nkpCitation(d)}${h[1] ? `, प्रकरण नं. ${h[1]}` : ""}`,
        text: h[0].slice(0, 1800), href: `#/nkp/${d.id}`, nkp: { id: d.id, citation: nkpCitation(d), title: d.title, headnote: h[0], para: h[1] || "" } });
      if (seen.size >= (opts.precedents || 5)) break;
    }
  }
  // drop weak matches instead of filling every slot (e.g. an unrelated article that shares one word)
  const best = k => Math.max(0, ...out.filter(s => s.kind === k).map(s => s.score));
  const bl = best("law"), bp = best("nkp");
  const kept = out.filter(s => s.score >= 0.35 * (s.kind === "nkp" ? bp : bl));
  let li = 0, pi = 0;
  return kept.map(s => ({ ...s, id: s.kind === "nkp" ? `P${++pi}` : `L${++li}` }));
}

/* ---------- streaming ---------- */
// through the site's AI server: SSE lines "data: {t}" … "data: {done}" or "data: {error}"
async function streamViaServer(payload, onText) {
  const { ai_url } = await siteConfig();
  if (!ai_url) throw new Error("यस वेबसाइटमा AI अझै जोडिएको छैन (सञ्चालकले सेटअप गर्नुपर्छ)।");
  const r = await fetch(ai_url + "/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) {
    let msg = `AI सर्भर त्रुटि (${r.status})`;
    try { msg = (await r.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", stop = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!line.startsWith("data:")) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.error) throw new Error(ev.error);
      if (ev.t) { text += ev.t; onText(text); }
      if (ev.done) stop = ev.stop;
    }
  }
  return { text, stop };
}

// directly with a lawyer's own Anthropic key (official SDK, loaded in the browser)
async function streamWithOwnKey(key, system, messages, onText, maxTokens = 16000) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const stream = client.beta.messages.stream({
    model: AI_MODEL, max_tokens: maxTokens, output_config: { effort: "high" },
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    system, messages,
  });
  let text = "";
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { text += ev.delta.text; onText(text); }
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude ले यो अनुरोध अस्वीकार गर्‍यो।");
  return { text, stop: msg.stop_reason };
}

function sourcesPayload(sources) {
  return sources.map(s => ({ id: s.id, label: s.label, text: s.text }));
}
function sourcesXML(sources) {
  return sources.map(s => `<source id="${s.id}">\n${s.label}\n${s.text}\n</source>`).join("\n\n");
}

/* ---------- rendering ---------- */
function renderAnswer(text, sources) {
  const byId = Object.fromEntries(sources.map(s => [s.id, s]));
  const link = id => byId[id] ? `<a class="cite" href="${byId[id].href}" title="${esc(byId[id].label)}">${id}</a>` : `<mark class="bad" title="यो स्रोत दिइएको थिएन">${id}</mark>`;
  return esc(text).split("\n").map(l => {
    if (/^##\s*/.test(l)) return `<h3>${l.replace(/^##\s*/, "")}</h3>`;
    if (!l.trim()) return "";
    l = l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([LP]\d{1,2})\]/g, (_, id) => link(id))
      .replace(/\[([LP]\d{1,2})((?:,\s*[LP]\d{1,2})+)\]/g, (m) => m.slice(1, -1).split(/,\s*/).map(link).join(" "))
      .replace(/\[(वकिलले थप्नुहोस्|तथ्य पुष्टि गर्नुहोस्)[^\]]*\]/g, m => `<span class="ph">${m}</span>`);
    return /^\s*[-•*]\s+/.test(l) ? `<p class="li">• ${l.replace(/^\s*[-•*]\s+/, "")}</p>` : `<p>${l}</p>`;
  }).join("");
}

function sourcesList(sources, withDraftButtons) {
  if (!sources.length) return `<p class="small">कुनै स्रोत भेटिएन।</p>`;
  return `<ol class="srcs">${sources.map((s, i) => `<li><b>${s.id}</b> <a href="${s.href}">${esc(s.label)}</a>
    ${withDraftButtons ? `<button class="btn ghost sm" data-src="${i}">+ मस्यौदामा</button>` : ""}
    <details><summary class="small">पाठ हेर्नुहोस्</summary><p class="small">${esc(s.text)}</p></details></li>`).join("")}</ol>`;
}
function wireDraftButtons(el, sources) {
  el.querySelectorAll("[data-src]").forEach(b => b.onclick = () => {
    const s = sources[+b.dataset.src];
    if (s.nkp) draftAddPrecedent(s.nkp);
    else if (s.act) draftAddSection(s.act, s.sec);
    else draftAddProvisionText(s);
    flashAdded(b);
  });
}
// constitution articles are added to the draft as plain provisions
function draftAddProvisionText(s) {
  const d = loadDraft();
  const m = s.label.match(/धारा\s*([०-९0-9]+)/);
  if (!d.provisions.some(p => p.actTitle === "नेपालको संविधान" && m && p.num === toLat(m[1]))) {
    d.provisions.push({ act: 13437, actTitle: "नेपालको संविधान", num: m ? toLat(m[1]) : "", heading: (s.label.match(/\(([^)]+)\)/) || ["", ""])[1], text: s.text, label: "धारा" });
    saveDraft(d);
  }
}
