"use strict";
/* Supreme Court published judgments / orders / notices (from the court's homepage). */

const DOC_KINDS = ["फैसला", "आदेश", "अन्तरिम आदेश", "सूचना", "प्रेस विज्ञप्ति"];
const COURT_KINDS = new Set(["फैसला", "आदेश", "अन्तरिम आदेश"]);
const judgmentsIdx = () => getJSON("data/judgments.json").catch(() => ({ docs: [] }));

function docCard(d, snippet) {
  return `<article class="doc-card">
    <div class="doc-meta">
      <span class="badge ${d.kind === "फैसला" ? "decided" : d.kind === "अन्तरिम आदेश" ? "mix" : ""}">${esc(d.kind)}</span>
      ${d.date ? `<span>${shortDate(d.date)}</span>` : ""}
      ${d.case_no ? `<span class="case">${esc(d.case_no)}</span>` : ""}
      ${d.bench ? `<span>${esc(d.bench)}</span>` : ""}
    </div>
    <h3><a href="#/doc/${d.id}">${esc(d.title)}</a></h3>
    ${d.principle ? `<p class="principle"><b>सिद्धान्त / विषय:</b> ${esc(d.principle)}</p>` : ""}
    ${snippet ? `<p class="snippet">${snippet}</p>` : ""}
    <div class="doc-foot">
      ${d.judges.length ? `<span>${d.judges.map(j => "मा. " + esc(j)).join(", ")}</span>` : "<span></span>"}
      <a href="${esc(d.url)}" target="_blank" rel="noopener">📄 मूल PDF</a>
    </div>
  </article>`;
}

addRoute("judgments", /^\/judgments$/, async (m, params) => {
  const { docs } = await judgmentsIdx();
  const kind = params.get("k") || "court";
  const q = (params.get("q") || "").trim();
  const full = params.get("full") === "1";
  const counts = Object.fromEntries(DOC_KINDS.map(k => [k, docs.filter(d => d.kind === k).length]));
  const chip = (k, label) => `<button class="chip ${kind === k ? "on" : ""}" data-k="${k}">${label}</button>`;
  app.innerHTML = `<h1>फैसला / आदेश · Supreme Court publications</h1>
    <p class="sub">सर्वोच्च अदालतले आफ्नो वेबसाइटमा प्रकाशित गरेका फैसला, आदेश, अन्तरिम आदेश र सूचनाहरू — मूल PDF र पाठ सहित।</p>
    <div class="toolbar">
      <input type="search" id="dq" placeholder="पक्ष, मुद्दा नं., विषय, सिद्धान्त, न्यायाधीश…" value="${esc(q)}">
      <label class="check"><input type="checkbox" id="full" ${full ? "checked" : ""}> पूर्ण पाठमा खोज्ने · full text</label>
    </div>
    <div class="chips">${chip("court", `फैसला र आदेश ${toDev(docs.filter(d => COURT_KINDS.has(d.kind)).length)}`)}${DOC_KINDS.filter(k => counts[k]).map(k => chip(k, `${k} ${toDev(counts[k])}`)).join("")}${chip("all", `सबै ${toDev(docs.length)}`)}</div>
    <div id="docs" style="margin-top:14px"><p class="loading">खोज्दै…</p></div>`;
  const nav = (k, qq, f) => setHash("#/judgments", { k: k !== "court" && k, q: qq, full: f });
  app.querySelectorAll(".chip").forEach(b => b.onclick = () => nav(b.dataset.k, q, full));
  const qi = document.getElementById("dq"), fi = document.getElementById("full");
  qi.onchange = () => nav(kind, qi.value.trim(), fi.checked);
  fi.onchange = () => nav(kind, qi.value.trim(), fi.checked);

  let list = docs.filter(d => kind === "all" || (kind === "court" ? COURT_KINDS.has(d.kind) : d.kind === kind));
  const terms = tokens(q);
  const snippets = {};
  if (terms.length) {
    const ft = full ? await getGz("data/fulltext.json.gz") : {};
    list = list.filter(d => {
      const metaText = norm(`${d.title} ${d.principle} ${d.case_no} ${d.judges.join(" ")} ${d.bench}`);
      if (terms.every(t => metaText.includes(t))) return true;
      const body = ft[d.id];
      if (body && terms.every(t => norm(body).includes(t))) { snippets[d.id] = highlight(body, terms); return true; }
      return false;
    });
  }
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const el = document.getElementById("docs");
  if (!list.length) { el.innerHTML = `<p class="empty">केही भेटिएन।${!full && q ? " “पूर्ण पाठमा खोज्ने” छानेर फेरि खोज्नुहोस्।" : ""}</p>`; return; }
  el.innerHTML = `<p class="small">${toDev(list.length)} कागजात</p><div id="dlist"></div>`;
  paged(document.getElementById("dlist"), list, rows => rows.map(d => docCard(d, snippets[d.id])).join(""), 40);
});

addRoute("judgments", /^\/doc\/([0-9a-f]+)$/, async m => {
  const id = m[1];
  const { docs } = await judgmentsIdx();
  const d = docs.find(x => x.id === id);
  if (!d) { app.innerHTML = `<p class="empty">कागजात फेला परेन।</p>`; return; }
  const text = d.has_text ? await fetch(`data/docs/${id}.txt`).then(r => r.text()).catch(() => "") : "";
  const hearings = [];
  if (d.case_no) {
    const idx = await optional(courtSearch("SC"));
    if (idx) idx.rows.filter(r => r[2] === d.case_no).forEach(r => hearings.push({ ...rowObj(r, "SC"), _b: idx.benches[r[1]] }));
  }
  app.innerHTML = `<a class="back" href="#/judgments">← सबै फैसला / आदेश</a>
    <h1 class="doc-title">${esc(d.title)}</h1>
    <div class="doc-meta" style="margin:8px 0 14px">
      <span class="badge decided">${esc(d.kind)}</span>
      ${d.date ? `<span>मिति ${shortDate(d.date)}</span>` : ""}
      ${d.case_no ? `<span class="case">${esc(d.case_no)}</span>` : ""}
      ${d.bench ? `<span>${esc(d.bench)}</span>` : ""}
      ${d.pages ? `<span>${toDev(d.pages)} पृष्ठ</span>` : ""}
    </div>
    ${d.judges.length ? `<p><b>इजलास:</b> ${d.judges.map(j => `<a href="#/judge/SC/${encodeURIComponent(j)}">मा. ${esc(j)}</a>`).join(" · ")}</p>` : ""}
    ${d.principle ? `<div class="panel principle-box"><b>सर्वोच्च अदालतले उल्लेख गरेको सिद्धान्त / विषय</b><p>${esc(d.principle)}</p></div>` : ""}
    <p><a class="btn" href="${esc(d.url)}" target="_blank" rel="noopener">📄 सर्वोच्च अदालतको मूल PDF हेर्नुहोस्</a></p>
    ${citesBlock(d.cites)}
    ${hearings.length ? `<h2 style="margin:18px 0 8px">यस मुद्दाको पेसी इतिहास · Hearings of this case</h2><div class="bench">${casesTable(hearings, { date: true, judges: c => (c._b || []).map(j => "मा. " + esc(j)).join(", ") })}</div>` : ""}
    <h2 style="margin:18px 0 8px">पाठ · Text</h2>
    ${ocrWarning(d.method)}
    ${text ? `<div class="doc-text">${esc(text).replace(/\f/g, '<hr class="pg">')}</div>` : `<p class="empty">पाठ उपलब्ध छैन — मूल PDF हेर्नुहोस्।</p>`}`;
});
