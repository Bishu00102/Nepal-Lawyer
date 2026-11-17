"use strict";
/* All constitutions of Nepal (2004 → 2072 BS), Nepali and English, with sources and amendments. */

const constitutionsData = () => getJSON("data/constitutions.json");
const CON_YEAR = { "२००४": "2004", "२००७": "2007", "२०१५": "2015", "२०१९": "2019", "२०४७": "2047", "२०६३": "2063", "२०७२": "2072" };

// "नेपाल अधिराज्यको संविधान, २०४७ धारा २३" -> #/constitution/2047?a=23 (used by citation lists)
function constitutionHref(label, sec) {
  const y = Object.keys(CON_YEAR).find(k => label.includes(k));
  const n = (String(sec || "").match(/^\d+[क-ह]?/) || [""])[0];
  return y ? `#/constitution/${CON_YEAR[y]}?a=${encodeURIComponent(n)}` : null;
}

addRoute("constitution", /^\/constitutions$/, async () => {
  const { constitutions } = await constitutionsData();
  app.innerHTML = `<h1>संविधान · Constitutions of Nepal</h1>
    <p class="sub">नेपालका सबै संविधान — २००४ देखि २०७२ सम्म। धारा-धारामा पढ्न, खोज्न र नेपाली–अंग्रेजी दुवै भाषामा हेर्न सकिन्छ।</p>
    <div class="jgrid">${constitutions.slice().reverse().map(c => `<a class="jcard" href="#/constitution/${c.key}">
      <span class="t">वि.सं. ${toDev(c.bs)} · ${c.ad} AD ${c.key === "2072" ? `<span class="badge win">हाल लागू</span>` : ""}</span>
      <h3>${esc(c.ne)}</h3><p class="small">${esc(c.en)}</p>
      <div class="nums"><span>${esc(c.in_force)}</span></div>
      <div class="nums">${c.versions.map(v => `<span class="badge ${v.official ? "decided" : ""}">${v.lang === "ne" ? "नेपाली" : "English"} · ${toDev(v.articles.length)} धारा${v.official ? "" : " · अनौपचारिक"}</span>`).join(" ")}</div>
    </a>`).join("")}</div>
    <p class="small">आधिकारिक पाठ: नेपाल कानून आयोग। पुराना संविधानका अंग्रेजी पाठ International IDEA (ConstitutionNet) र FAO (FAOLEX) जस्ता अन्तर्राष्ट्रिय कानूनी संग्रहबाट — अनौपचारिक अनुवाद हुन्; अदालतमा उद्धरण गर्नुअघि आधिकारिक नेपाली पाठ हेर्नुहोस्। पुराना संविधानका नेपाली मूल पाठ कानून आयोगको पुरानो संग्रह (repository) पहुँचयोग्य भएपछि स्वतः थपिनेछन्।</p>`;
});

addRoute("constitution", /^\/constitution\/(\d{4})$/, async (m, params) => {
  const { constitutions } = await constitutionsData();
  const c = constitutions.find(x => x.key === m[1]);
  if (!c) { app.innerHTML = `<p class="empty">संविधान फेला परेन।</p>`; return; }
  const langs = c.versions.map(v => v.lang);
  let lang = params.get("lang") || (langs.includes("ne") ? "ne" : "en");
  const both = lang === "both" && langs.length > 1;
  if (!both && !langs.includes(lang)) lang = langs[0];
  const q = (params.get("q") || "").trim();
  const a = params.get("a") || "";
  const vNe = c.versions.find(v => v.lang === "ne"), vEn = c.versions.find(v => v.lang === "en");
  const main = both ? vNe : c.versions.find(v => v.lang === lang);
  const byNumEn = vEn ? Object.fromEntries(vEn.articles.map(x => [x.n, x])) : {};
  const terms = tokens(q);
  const match = x => !terms.length || terms.every(t => norm((x.heading || "") + " " + x.text).includes(t));
  const effects = (vEn && vEn.amendment_effects) || [];
  const effectFor = n => effects.filter(e => e.where === "Article " + n);
  let part = null;
  const label = c.key === "2004" || c.key === "2007" ? "दफा/धारा" : "धारा";
  const artHTML = x => {
    const ef = effectFor(x.n);
    return `<div class="sec-body">${terms.length ? highlight(x.text, terms, 100000) : esc(x.text)}</div>
      ${ef.length ? `<p class="small amend">✎ ${ef.map(e => `${esc(e.amendment)} द्वारा ${e.change === "inserted" ? "थपिएको" : e.change === "deleted" ? "झिकिएको" : "संशोधित"}`).join("; ")}</p>` : ""}
      ${x.amended && !ef.length ? `<p class="small amend">✎ ${esc([].concat(x.amended).join("; "))}</p>` : ""}`;
  };
  const body = main.articles.filter(x => match(x) || (both && byNumEn[x.n] && match(byNumEn[x.n]))).map(x => {
    const head = x.part && x.part !== part ? (part = x.part, `<h3 class="chap">${esc(x.part)}</h3>`) : "";
    const en = both ? byNumEn[x.n] : null;
    return `${head}<section class="sec" id="s-${esc(x.n)}">
      ${both ? `<div class="bilingual"><div><h4>${label} ${toDev(x.n)}. ${esc(x.heading)}</h4>${artHTML(x)}</div>
        <div lang="en"><h4>Article ${esc(x.n)}. ${esc(en ? en.heading : "")}</h4>${en ? artHTML(en) : `<p class="small">—</p>`}</div></div>`
      : `<h4>${main.lang === "en" ? "Article " + esc(x.n) : label + " " + toDev(x.n)}. ${esc(x.heading)}</h4>${artHTML(x)}`}
    </section>`;
  }).join("");

  const tab = (l, t) => langs.includes(l) || (l === "both" && langs.length > 1)
    ? `<a class="chip ${(both ? "both" : lang) === l ? "on" : ""}" href="#/constitution/${c.key}?lang=${l}">${t}</a>` : "";
  app.innerHTML = `<a class="back" href="#/constitutions">← सबै संविधान</a>
    <h1>${esc(c.ne)}</h1>
    <p class="sub">${esc(c.en)} · लागू अवधि: ${esc(c.in_force)}</p>
    <div class="chips">${tab("ne", "नेपाली")}${tab("en", "English")}${tab("both", "दुवै · Side by side")}</div>
    <div class="panel" style="margin-top:12px">
      ${c.versions.map(v => `<p class="small"><b>${v.lang === "ne" ? "नेपाली" : "English"}:</b> ${esc(v.source)} — <a href="${esc(v.url)}" target="_blank" rel="noopener">मूल प्रति ↗</a>
        ${v.official ? `<span class="badge decided">आधिकारिक</span>` : `<span class="badge mix">अनौपचारिक अनुवाद</span>`}
        ${v.method === "ocr" ? " · OCR पाठ — गल्ती हुन सक्छ" : ""}</p>`).join("")}
      ${(vEn && vEn.amendments && vEn.amendments.length) ? `<h2>संशोधन · Amendments</h2><ol>${vEn.amendments.map(am => {
        const short = am.title.match(/\((\w+ Amendment)\)/);
        const eff = short ? effects.filter(e => e.amendment === short[1]) : [];
        return `<li>${esc(am.title)} — ${esc(am.date)}${eff.length ? `<br><span class="small">परिवर्तन: ${eff.map(e => e.where.startsWith("Article") ? `<a href="#/constitution/${c.key}?lang=${both ? "both" : lang}&a=${e.where.split(" ")[1]}">धारा ${toDev(e.where.split(" ")[1])}</a>` : esc(e.where)).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")}</span>` : ""}</li>`;
      }).join("")}</ol>` : ""}
    </div>
    <div class="toolbar"><input type="search" id="cq" placeholder="धारा भित्र खोज्नुहोस् (e.g. न्याय सम्बन्धी हक, detention)" value="${esc(q)}"></div>
    ${main.preamble && !terms.length ? `<div class="panel"><h2>प्रस्तावना · Preamble</h2><p>${esc(main.preamble)}</p></div>` : ""}
    <div class="law-body ${both ? "wide" : ""}">${body || `<p class="empty">केही भेटिएन।</p>`}</div>`;
  document.getElementById("cq").onchange = e => setHash(`#/constitution/${c.key}`, { lang: both ? "both" : lang, q: e.target.value.trim() });
  if (a) {
    const t = document.getElementById("s-" + a);
    if (t) { t.scrollIntoView({ block: "start" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 2500); }
  }
});
