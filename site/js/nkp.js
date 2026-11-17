"use strict";
/* Nepal Kanoon Patrika (ने.का.प.) — reported Supreme Court precedents. */

const nkpIndex = () => getJSON("data/nkp/index.json");
const nkpHeads = () => getGz("data/nkp/heads.json.gz");
const nkpDoc = id => getGz(`data/nkp/d/${id}.json.gz`);
// index row: [id, decision_no, year, month_no, issue, date, title, bench, judges[], case_nos[], criminal, volume]
const NK = r => ({ id: r[0], no: r[1], year: r[2], month: r[3], issue: r[4], date: r[5], title: r[6], bench: r[7],
  judges: r[8], cases: r[9], criminal: r[10], volume: r[11] });
const nkpCitation = d => `ने.का.प. ${toDev(d.year || "")}${d.month ? ", " + (MONTHS[d.month - 1] || "") : ""}${d.issue ? ", अंक " + toDev(d.issue) : ""}, नि.नं. ${toDev(d.no)}`;

function nkpCard(d, heads, terms) {
  const hn = heads && heads[d.id] ? heads[d.id] : [];
  let shown = hn.slice(0, 2);
  if (terms && terms.length && hn.length) {
    const best = hn.map(h => [scoreText(h[0], terms), h]).sort((a, b) => b[0] - a[0]);
    shown = best.slice(0, 2).map(x => x[1]);
  }
  return `<article class="doc-card">
    <div class="doc-meta">
      <span class="badge decided">${esc(nkpCitation(d))}</span>
      ${d.date ? `<span>फैसला मिति ${shortDate(d.date)}</span>` : ""}
      ${d.bench ? `<span>${esc(d.bench)}</span>` : ""}
      ${d.criminal ? `<span class="badge crim">फौजदारी</span>` : ""}
      ${d.cases.length ? `<span class="case">${esc(d.cases.join(", "))}</span>` : ""}
    </div>
    <h3><a href="#/nkp/${d.id}">${esc(d.title)}</a></h3>
    ${shown.map(h => `<p class="principle">${terms ? highlight(h[0], terms, 420) : esc(h[0].slice(0, 420)) + (h[0].length > 420 ? "…" : "")}${h[1] ? ` <span class="small">(प्रकरण नं. ${esc(h[1])})</span>` : ""}</p>`).join("")}
    <div class="doc-foot"><span>${d.judges.map(j => "मा. " + esc(j)).join(", ")}</span>
      <a href="https://nkp.gov.np/full_detail/${d.id}" target="_blank" rel="noopener">nkp.gov.np ↗</a></div>
  </article>`;
}

addRoute("nkp", /^\/nkp$/, async (m, params) => {
  const idx = await nkpIndex();
  const all = idx.rows.map(NK);
  const q = (params.get("q") || "").trim();
  const crim = params.get("crim") === "1";
  const judge = params.get("judge") || "";
  const bench = params.get("bench") || "";
  const from = +(params.get("from") || 0), to = +(params.get("to") || 0);
  const years = [...new Set(all.map(d => d.year).filter(Boolean))].sort((a, b) => b - a);
  const benches = [...new Set(all.map(d => d.bench).filter(Boolean))].sort();
  app.innerHTML = `<h1>नजिर · Nepal Kanoon Patrika</h1>
    <p class="sub">सर्वोच्च अदालतको आधिकारिक कानून पत्रिका (nkp.gov.np) मा प्रकाशित ${toDev(all.length)} निर्णय — शीर्षक, सिद्धान्त (headnote), मुद्दा नं., न्यायाधीश र पूर्ण पाठ सहित।</p>
    <div class="toolbar">
      <input type="search" id="nq" placeholder="कानूनी प्रश्न, विषय, मुद्दा नं., नि.नं.… (e.g. मृत्युकालीन घोषणा, परिस्थितिजन्य प्रमाण)" value="${esc(q)}">
    </div>
    <div class="toolbar">
      <label class="check"><input type="checkbox" id="ncrim" ${crim ? "checked" : ""}> फौजदारी मात्र · criminal only</label>
      <select id="nbench"><option value="">सबै इजलास</option>${benches.map(b => `<option ${b === bench ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
      <select id="nfrom"><option value="">साल देखि</option>${years.map(y => `<option value="${y}" ${y === from ? "selected" : ""}>${toDev(y)}</option>`).join("")}</select>
      <select id="nto"><option value="">साल सम्म</option>${years.map(y => `<option value="${y}" ${y === to ? "selected" : ""}>${toDev(y)}</option>`).join("")}</select>
      ${judge ? `<span class="chip on">न्यायाधीश: ${esc(judge)} <a href="#/nkp" aria-label="remove">✕</a></span>` : ""}
    </div>
    <div id="nres"><p class="loading">खोज्दै…</p></div>`;
  const nav = () => setHash("#/nkp", {
    q: document.getElementById("nq").value.trim(), crim: document.getElementById("ncrim").checked,
    bench: document.getElementById("nbench").value, from: document.getElementById("nfrom").value,
    to: document.getElementById("nto").value, judge,
  });
  ["nq", "ncrim", "nbench", "nfrom", "nto"].forEach(i => document.getElementById(i).onchange = nav);

  let list = all.filter(d => (!crim || d.criminal) && (!bench || d.bench === bench) && (!from || d.year >= from) && (!to || d.year <= to)
    && (!judge || d.judges.some(j => j.replace(/^डा\.\s*/, "") === judge)));
  const terms = tokens(q);
  let heads = null;
  if (terms.length) {
    heads = await nkpHeads();
    const exactNo = /^\d{2,5}$/.test(toLat(q).trim()) ? +toLat(q).trim() : null;
    list = list.map(d => {
      const h = (heads[d.id] || []).map(x => x[0]).join(" ");
      let s = scoreText(d.title, terms) * 2 + scoreText(h, terms) + scoreText(d.cases.join(" ") + " " + d.judges.join(" "), terms) * 2;
      if (exactNo && d.no === exactNo) s += 100;
      const all_ = terms.every(t => norm(d.title + " " + h + " " + d.cases.join(" ") + " " + d.judges.join(" ")).includes(t));
      return [all_ ? s + 5 : s * 0.5, d];
    }).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  } else {
    heads = await optional(nkpHeads());
  }
  const el = document.getElementById("nres");
  el.innerHTML = `<p class="small">${toDev(list.length)} निर्णय${terms.length ? " — सान्दर्भिकता अनुसार क्रमबद्ध (ranked by relevance)" : ""}</p><div id="nlist"></div>`;
  paged(document.getElementById("nlist"), list, rows => rows.map(d => nkpCard(d, heads, terms.length ? terms : null)).join(""), 30);
});

addRoute("nkp", /^\/nkp\/(\d+)$/, async m => {
  const id = +m[1];
  const [idx, doc, heads] = await Promise.all([nkpIndex(), nkpDoc(id), nkpHeads()]);
  const row = idx.rows.find(r => r[0] === id);
  if (!row) { app.innerHTML = `<p class="empty">निर्णय फेला परेन।</p>`; return; }
  const d = NK(row);
  const byId = Object.fromEntries(idx.rows.map(r => [r[0], NK(r)]));
  const hn = heads[id] || [];
  // add paragraph anchors: lines starting with a Devanagari number + "." are numbered paragraphs (प्रकरण)
  const textHTML = esc(doc.text).split("\n").map(line => {
    const pm = line.match(/^\s*([०-९]{1,3})\.\s/);
    return pm ? `<span class="para" id="p-${toLat(pm[1])}">${line}</span>` : line;
  }).join("\n");
  const sameTitle = idx.rows.filter(r => r[6] === d.title && r[0] !== id).length;
  app.innerHTML = `<a class="back" href="#/nkp">← सबै नजिर</a>
    <h1 class="doc-title">${esc(d.title)}</h1>
    <div class="doc-meta" style="margin:8px 0 14px">
      <span class="badge decided">${esc(nkpCitation(d))}</span>
      ${d.date ? `<span>फैसला मिति ${shortDate(d.date)}</span>` : ""}
      ${d.bench ? `<span>${esc(d.bench)}</span>` : ""}
      ${d.criminal ? `<span class="badge crim">फौजदारी</span>` : ""}
      ${d.cases.length ? `<span class="case">${esc(d.cases.join(", "))}</span>` : ""}
    </div>
    <p><b>अदालत / इजलास:</b> ${esc(doc.court || "सर्वोच्च अदालत")}</p>
    ${d.judges.length ? `<p><b>न्यायाधीश:</b> ${d.judges.map(j => `<a href="#/nkp?judge=${encodeURIComponent(j.replace(/^डा\.\s*/, ""))}">मा. ${esc(j)}</a>`).join(" · ")}</p>` : ""}
    ${doc.parties ? `<p class="small">${esc(doc.parties).replaceAll(" ¶ ", "<br>")}</p>` : ""}
    <p><a class="btn" href="https://nkp.gov.np/full_detail/${id}" target="_blank" rel="noopener">nkp.gov.np मा मूल प्रति ↗</a>
      <button class="btn ghost" id="copyCit">उद्धरण कपी · Copy citation</button></p>
    ${hn.length ? `<div class="panel principle-box"><b>ने.का.प.मा प्रकाशित सिद्धान्त (headnotes)</b>
      ${hn.map((h, i) => `<p>${esc(h[0])}${h[1] ? ` <a class="small" href="#/nkp/${id}" data-para="${esc(toLat(h[1]).split(/[^0-9]/)[0])}">(प्रकरण नं. ${esc(h[1])})</a>` : ""}
        <button class="btn ghost sm add-draft" data-hn="${i}">+ मस्यौदामा</button></p>`).join("")}
      <p class="small">यी ने.का.प.ले प्रकाशित गरेका सिद्धान्त हुन्। These headnotes are as published by NKP, not generated.</p></div>` : ""}
    ${doc.relied ? `<p><b>अवलम्बित नजिर:</b> ${esc(doc.relied)}</p>` : ""}
    ${doc.related_law ? `<p><b>सम्बद्ध कानून:</b> ${esc(doc.related_law)}</p>` : ""}
    ${doc.counsel ? `<p class="small"><b>कानून व्यवसायी:</b><br>${esc(doc.counsel).replaceAll(" ¶ ", "<br>")}</p>` : ""}
    ${doc.lower_courts ? `<p class="small"><b>तल्लो अदालत:</b> ${esc(doc.lower_courts)}</p>` : ""}
    ${citesBlock(doc.cites)}
    ${doc.cited_by.length ? `<div class="panel"><h2>यो नजिर उद्धृत गर्ने पछिल्ला निर्णय · Cited by (${toDev(doc.cited_by.length)})</h2>
      <ul class="plain">${doc.cited_by.map(x => byId[x] ? `<li><a href="#/nkp/${x}">${esc(nkpCitation(byId[x]))} — ${esc(byId[x].title)}</a></li>` : "").join("")}</ul>
      <p class="small">⚖️ पछिल्ला निर्णयले यसलाई अनुसरण गरे, फरक छुट्याए वा उल्टाए भन्ने कुरा स्वचालित रूपमा निर्धारण गरिएको छैन — प्रत्येक निर्णय पढेर पुष्टि गर्नुहोस्। Whether later decisions followed, distinguished or overruled it is NOT auto-determined; verify by reading them.</p></div>` : ""}
    ${sameTitle ? `<p><a href="#/nkp?q=${encodeURIComponent(d.title)}">यही विषय (“${esc(d.title)}”) का अन्य ${toDev(sameTitle)} नजिर →</a></p>` : ""}
    <h2 style="margin:18px 0 8px">पूर्ण पाठ · Full text</h2>
    <div class="doc-text">${textHTML}</div>`;
  app.querySelectorAll(".add-draft[data-hn]").forEach(b => b.onclick = () => {
    const h = hn[+b.dataset.hn];
    draftAddPrecedent({ id, citation: nkpCitation(d), title: d.title, headnote: h[0], para: h[1] || "" });
    flashAdded(b);
  });
  document.getElementById("copyCit").onclick = e => {
    const cit = `${d.title}, ${nkpCitation(d)}${d.date ? `, फैसला मिति ${shortDate(d.date)}` : ""}`;
    navigator.clipboard?.writeText(cit).then(() => { e.target.textContent = "कपी भयो ✓"; }).catch(() => prompt("Copy:", cit));
  };
  app.querySelectorAll("[data-para]").forEach(a => a.onclick = ev => {
    ev.preventDefault();
    const t = document.getElementById("p-" + a.dataset.para);
    if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 2000); }
  });
});
