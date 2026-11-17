"use strict";
/* Research workflows (PDF spec §7) + site-wide search.
   W1 statutory research · W2 precedent research · W3–W5 case-file worksheet (runs only in this browser). */

let LAW_CACHE = null;
async function coreLaws() {
  if (LAW_CACHE) return LAW_CACHE;
  const { acts } = await lawsIndex();
  const core = acts.filter(a => a.area && a.sections);
  const docs = await Promise.all(core.map(a => lawDoc(a.id).catch(() => null)));
  LAW_CACHE = docs.filter(Boolean);
  return LAW_CACHE;
}
const SECTION_RE = /(?:दफा|धारा|section|s\.?)\s*([०-९0-9]{1,3}[क-ह]?)/i;
const PUNISH_RE = /[^।\n]*(सजाय|कैद|जरिवाना|जरीवाना)[^।\n]*[।]?/g;

function searchSections(laws, q, actId) {
  const terms = tokens(q);
  const secNo = (q.match(SECTION_RE) || [])[1];
  const out = [];
  for (const act of laws) {
    if (actId && act.id !== actId) continue;
    for (const s of act.section_list) {
      let score = 0;
      if (secNo && toLat(secNo) === s.number) score += 50;
      if (terms.length) {
        const t2 = terms.filter(t => !/^\d+[क-ह]?$/.test(t) && t !== "दफा" && t !== "धारा");
        if (t2.length) {
          const h = scoreText(s.heading, t2) * 3, b = scoreText(s.body, t2);
          if (!h && !b) { if (!secNo) continue; } else score += h + b + (t2.every(t => norm(s.heading + " " + s.body).includes(t)) ? 5 : 0);
        }
      }
      // definition sections mention almost every term; rank them low
      if (/परिभाषा/.test(s.heading)) score *= 0.2;
      if (score > 0) out.push({ act, s, score: score + (act.area === "substantive" ? 0.5 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function sectionCard({ act, s }, terms) {
  const pun = (s.body.match(PUNISH_RE) || []).slice(0, 3);
  const label = act.id === 13437 ? "धारा" : "दफा";
  return `<article class="doc-card">
    <div class="doc-meta"><span class="badge decided">${esc(act.title)}</span>${s.chapter ? `<span>${esc(s.chapter)}</span>` : ""}
      ${s.amended_by ? `<span class="badge mix" title="${esc(s.amended_by)}">संशोधित</span>` : ""}
      ${s.cited_by.length ? `<span class="badge leave">${toDev(s.cited_by.length)} नजिरमा उद्धृत</span>` : ""}</div>
    <h3><a href="#/law/${act.id}?s=${encodeURIComponent(s.number)}">${label} ${toDev(s.number)}. ${esc(s.heading)}</a></h3>
    <p class="snippet">${highlight(s.body, terms, 420)}</p>
    ${pun.length ? `<p class="principle"><b>सजाय सम्बन्धी वाक्य:</b> ${pun.map(p => esc(p.trim())).join(" … ")}</p>` : ""}
  </article>`;
}

/* ---------------- hub */
addRoute("research", /^\/research$/, async () => {
  app.innerHTML = `<h1>अनुसन्धान · Research workflows</h1>
    <p class="sub">PDF मा माग गरिएका कार्यप्रवाह। सबै नतिजा आधिकारिक स्रोतका पाठबाट; कुनै कानून वा नजिर बनाइँदैन।</p>
    <div class="jgrid">
      <a class="jcard" href="#/research/statute"><span class="t">कार्यप्रवाह १ · Workflow 1</span><h3>कानूनी व्यवस्था खोज</h3><p class="small">कसुर वा दफा राख्नुहोस् → लागू ऐन, दफा, सजाय, संशोधन, उद्धृत नजिर।</p></a>
      <a class="jcard" href="#/research/precedent"><span class="t">कार्यप्रवाह २ · Workflow 2</span><h3>नजिर खोज</h3><p class="small">कानूनी प्रश्न वा तथ्य राख्नुहोस् → सान्दर्भिक नजिर, सिद्धान्त, प्रकरण नं., उद्धरण।</p></a>
      <a class="jcard" href="#/casefile"><span class="t">कार्यप्रवाह ३–५ · Workflows 3–5</span><h3>मुद्दा फाइल विश्लेषण</h3><p class="small">जाहेरी, अभियोग पत्र, बयान… → घटनाक्रम, प्रमाण तालिका, कानूनी प्रश्न, प्रतिरक्षा र बहस तयारी कार्यपत्र। 🔒 तपाईंको कम्प्युटरमै प्रशोधन।</p></a>
      <a class="jcard" href="#/draft"><span class="t">मस्यौदा · Drafting</span><h3>बहस नोट, लिखित बहस, निवेदन</h3><p class="small">छानेका दफा र नजिरबाट बहस नोट, लिखित बहस, धरौटी निवेदन, पुनरावेदन, कानूनी राय, जिरह प्रश्नावली — AI सहित वा बिना।</p></a>
      <a class="jcard" href="#/search"><span class="t">सबै स्रोत</span><h3>एकीकृत खोज</h3><p class="small">पेसी, फैसला/आदेश, नजिर र कानून — एकै ठाउँबाट।</p></a>
    </div>`;
});

/* ---------------- W1 statutory research */
addRoute("research", /^\/research\/statute$/, async (m, params) => {
  const q = (params.get("q") || "").trim();
  const actId = +(params.get("act") || 0);
  app.innerHTML = `<a class="back" href="#/research">← अनुसन्धान</a><h1>कानूनी व्यवस्था खोज · Statutory research</h1>
    <p class="sub">कसुर (जस्तै “जबरजस्ती करणी”, “चोरी”, “लागू औषध”) वा दफा (जस्तै “दफा १७७”) राख्नुहोस्।</p>
    <div class="toolbar"><input type="search" id="sq" value="${esc(q)}" placeholder="कसुर, शब्द वा दफा…"><select id="sact"><option value="">सबै मुख्य कानून</option></select></div>
    <div id="sres"><p class="loading">कानून लोड हुँदैछ…</p></div>`;
  const laws = await coreLaws();
  const sel = document.getElementById("sact");
  sel.innerHTML += laws.map(a => `<option value="${a.id}" ${a.id === actId ? "selected" : ""}>${esc(a.title)}</option>`).join("");
  const nav = () => setHash("#/research/statute", { q: document.getElementById("sq").value.trim(), act: sel.value });
  document.getElementById("sq").onchange = nav; sel.onchange = nav;
  const el = document.getElementById("sres");
  if (!q) { el.innerHTML = `<p class="empty">खोज शब्द राख्नुहोस्।</p>`; return; }
  const res = searchSections(laws, q, actId);
  el.innerHTML = `<p class="small">${toDev(res.length)} दफा/धारा — सान्दर्भिकता अनुसार। प्रत्येकमा थिचेर पूर्ण पाठ, संशोधन र उद्धृत नजिर हेर्नुहोस्।</p><div id="slist"></div>
    <p><a href="#/nkp?q=${encodeURIComponent(q)}&crim=1">“${esc(q)}” सम्बन्धी फौजदारी नजिर खोज्नुहोस् →</a></p>`;
  paged(document.getElementById("slist"), res, rows => rows.map(r => sectionCard(r, tokens(q))).join(""), 20);
});

/* ---------------- W2 precedent research */
addRoute("research", /^\/research\/precedent$/, async (m, params) => {
  const q = (params.get("q") || "").trim();
  app.innerHTML = `<a class="back" href="#/research">← अनुसन्धान</a><h1>नजिर खोज · Precedent research</h1>
    <p class="sub">कानूनी प्रश्न वा तथ्यगत अवस्था लेख्नुहोस्। ने.का.प.का सिद्धान्त (headnotes) र सर्वोच्चका प्रकाशित फैसला/आदेशमा खोजिन्छ।</p>
    <textarea id="pq" rows="3" placeholder="जस्तै: प्रहरीसमक्षको साविती बयान अदालतमा इन्कार गरेमा प्रमाणको मूल्य">${esc(q)}</textarea>
    <p><label class="check"><input type="checkbox" id="pcrim" ${params.get("all") === "1" ? "" : "checked"}> फौजदारी मात्र</label> <button class="btn" id="pgo">खोज्नुहोस्</button></p>
    <div id="pres"></div>`;
  document.getElementById("pgo").onclick = () => setHash("#/research/precedent", { q: document.getElementById("pq").value.trim(), all: !document.getElementById("pcrim").checked });
  if (!q) return;
  const el = document.getElementById("pres");
  el.innerHTML = `<p class="loading">खोज्दै…</p>`;
  const terms = tokens(q);
  const crimOnly = params.get("all") !== "1";
  const [idx, heads, jd] = await Promise.all([nkpIndex(), nkpHeads(), judgmentsIdx()]);
  const ranked = idx.rows.map(NK).filter(d => !crimOnly || d.criminal).map(d => {
    const h = (heads[d.id] || []).map(x => x[0]).join(" ");
    return [scoreText(h, terms) + scoreText(d.title, terms) * 1.5, d];
  }).filter(x => x[0] > 1).sort((a, b) => b[0] - a[0]).slice(0, 40).map(x => x[1]);
  const scd = jd.docs.filter(d => COURT_KINDS.has(d.kind)).map(d => [scoreText(d.title + " " + d.principle, terms), d])
    .filter(x => x[0] > 1).sort((a, b) => b[0] - a[0]).slice(0, 8).map(x => x[1]);
  el.innerHTML = `<p class="small">⚙️ शब्द मिल्दोपनका आधारमा क्रमबद्ध (keyword relevance, not legal judgement). बाध्यकारी/प्रेरक हैसियत, र नजिर अझै लागू छ कि छैन, प्रत्येक निर्णय पढेर पुष्टि गर्नुहोस्।</p>
    <h2>ने.का.प. नजिर (${toDev(ranked.length)})</h2><div id="plist"></div>
    ${scd.length ? `<h2 style="margin-top:18px">सर्वोच्चका प्रकाशित फैसला/आदेश</h2>${scd.map(d => docCard(d)).join("")}` : ""}`;
  paged(document.getElementById("plist"), ranked, rows => rows.map(d => nkpCard(d, heads, terms)).join(""), 15);
});

/* ---------------- W3–W5 case-file worksheet (local only) */
const EVIDENCE_TYPES = [
  ["जाहेरी / उजुरी (FIR / complaint)", /जाहेरी|उजुरी/],
  ["अभियुक्तको बयान (statement of accused)", /बयान/],
  ["साक्षी / बकपत्र (witness statements)", /बकपत्र|साक्षी|कागज गर्ने/],
  ["घटनास्थल मुचुल्का (scene report)", /घटनास्थल/],
  ["बरामदी / खानतलासी मुचुल्का (recovery / search)", /बरामद|खानतलासी|दसी/],
  ["शव परीक्षण (post-mortem)", /शव परीक्षण|पोष्टमार्टम|पोस्टमार्टम|पोस्ट मार्टम/],
  ["स्वास्थ्य / मेडिकल परीक्षण (medical report)", /स्वास्थ्य परीक्षण|मेडिकल|चिकित्सक/],
  ["विधि विज्ञान / फरेन्सिक (forensic)", /विधि विज्ञान|फरेन्सिक|फोरेन्सिक|प्रयोगशाला/],
  ["DNA / औंठाछाप (DNA / fingerprints)", /DNA|डीएनए|औंठाछाप|औठाछाप|ल्याप्चे/],
  ["डिजिटल प्रमाण (CCTV, mobile, call records)", /CCTV|सीसीटीभी|मोबाइल|कल डिटेल|कल विवरण|विद्युतीय/],
  ["लिखत / कागजात (documents)", /लिखत|कागजात|सक्कल|प्रतिलिपि/],
  ["विशेषज्ञ राय (expert opinion)", /विशेषज्ञ/],
];
const OFFENCE_HINTS = [
  [/कर्तव्य ज्यान|ज्यान मार|हत्या|मारेको|मार्ने/, "ज्यान"], [/जबरजस्ती करणी|बलात्कार/, "जबरजस्ती करणी"],
  [/चोरी/, "चोरी"], [/डाँका|डाका/, "डाँका"], [/लागु ?औषध|लागूऔषध|गाँजा|हेरोइन|ब्राउन सुगर/, "लागू औषध"],
  [/भ्रष्टाचार|घुस|रिसवत/, "भ्रष्टाचार"], [/ठगी/, "ठगी"], [/अपहरण|शरीर बन्धक/, "अपहरण"],
  [/बेचबिखन|ओसारपसार/, "बेचबिखन"], [/कुटपिट|अंगभंग|अङ्गभङ्ग|चोटपटक/, "कुटपिट"], [/जालसाज|किर्ते|कीर्ते/, "जालसाजी"],
  [/सवारी|दुर्घटना/, "सवारी"], [/आगजनी|आगो लगा/, "आगजनी"], [/हातहतियार|पेस्तोल|बन्दुक/, "हातहतियार"],
  [/बहुविवाह/, "बहुविवाह"], [/बालविवाह/, "बालविवाह"], [/घरेलु हिंसा/, "घरेलु हिंसा"],
  [/सम्पत्ति शुद्धीकरण|मनी लाउन्डरिङ/, "सम्पत्ति शुद्धीकरण"], [/साइबर|अनलाइन|फेसबुक|सामाजिक सञ्जाल/, "विद्युतीय"],
  [/गाली|बेइज्जती/, "गाली बेइज्जती"], [/गर्भपतन/, "गर्भपतन"], [/जीउ मास्ने|बेचबिखन/, "बेचबिखन"],
];
// procedural checkpoints: searched in the procedure code / constitution; the matching sections are shown, not asserted
const PROCEDURE_CHECKS = [
  ["पक्राउ र पक्राउ पुर्जी (arrest & warrant)", "पक्राउ पुर्जी"],
  ["चौबीस घण्टाभित्र मुद्दा हेर्ने अधिकारी समक्ष उपस्थित (24-hour production)", "चौबीस घण्टा"],
  ["थुनामा राखी अनुसन्धान गर्ने अनुमति / म्याद थप (remand)", "थुनामा राखी अनुसन्धान"],
  ["खानतलासी र बरामदी (search & seizure)", "खानतलासी"],
  ["बयान (statement of the accused)", "बयान"],
  ["अभियोग पत्र दायर गर्ने हदम्याद (charge-sheet limitation)", "अभियोग पत्र म्याद"],
  ["थुनछेक: धरौटी / जमानत / थुनामा (bail & detention)", "धरौटी जमानत"],
  ["कानून व्यवसायी राख्न पाउने हक (right to counsel)", "कानून व्यवसायी"],
  ["न्याय सम्बन्धी हक (constitutional fair-trial rights)", "न्याय सम्बन्धी हक"],
];
const DATE_IN_TEXT = /([०-९0-9]{4})\s*[।/.\-]\s*([०-९0-9]{1,2})\s*[।/.\-]\s*([०-९0-9]{1,2})/g;

function analyse(text, laws) {
  const sentences = text.replace(/\r/g, "").split(/(?<=[।?!])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3);
  // chronology
  const chrono = [];
  sentences.forEach(s => {
    for (const m of s.matchAll(DATE_IN_TEXT)) {
      const y = +toLat(m[1]), mo = +toLat(m[2]), d = +toLat(m[3]);
      if (y > 1990 && y < 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 32)
        chrono.push({ date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, s });
    }
  });
  chrono.sort((a, b) => a.date.localeCompare(b.date));
  // provisions mentioned explicitly
  const mentioned = [];
  const lawNames = laws.map(a => [norm(a.title.replace(/[,，]?\s*[०-९0-9]{4}\s*$/, "")), a]);
  sentences.forEach(s => {
    const ns = norm(s);
    for (const [n, a] of lawNames) if (ns.includes(n)) {
      for (const mm of s.matchAll(/दफा\s*([०-९0-9]{1,3}[क-ह]?)/g)) {
        const sec = a.section_list.find(x => x.number === toLat(mm[1]));
        mentioned.push({ act: a, num: toLat(mm[1]), sec, s });
      }
    }
  });
  // candidate offences (keyword hints -> search the codes)
  const hints = [...new Set(OFFENCE_HINTS.filter(([re]) => re.test(text)).map(([, h]) => h))];
  // offences live in the Criminal Code and special criminal acts — not in procedure, evidence, civil or court acts
  const NOT_OFFENCE = new Set(["constitution", "procedure", "evidence", "civil (reference)", "courts", "police", "mutual legal assistance", "prosecution"]);
  const offenceLaws = laws.filter(a => !NOT_OFFENCE.has(a.area));
  const candidates = hints.map(h => ({ hint: h, hits: searchSections(offenceLaws, h).slice(0, 4) }));
  // evidence
  const evidence = EVIDENCE_TYPES.map(([label, re]) => ({ label, found: sentences.filter(s => re.test(s)).slice(0, 3) })).filter(e => e.found.length);
  const missing = EVIDENCE_TYPES.filter(([label]) => !evidence.find(e => e.label === label)).map(([l]) => l);
  // procedure checkpoints
  const proc = laws.filter(a => a.area === "procedure" || a.area === "constitution" || a.area === "evidence");
  const procedure = PROCEDURE_CHECKS.map(([label, q]) => ({ label, hits: searchSections(proc, q).slice(0, 2) }));
  return { chrono, mentioned, hints, candidates, evidence, missing, procedure, sentences: sentences.length };
}

function worksheetHTML(a, text) {
  const secLink = r => `<a href="#/law/${r.act.id}?s=${encodeURIComponent(r.s.number)}">${esc(r.act.title)} — ${r.act.id === 13437 ? "धारा" : "दफा"} ${toDev(r.s.number)} (${esc(r.s.heading)})</a>`;
  return `
  <div class="ws-note">🔒 यो विश्लेषण तपाईंको ब्राउजरमै भयो; कागजात कतै पठाइएको छैन। ⚙️ सबै बुँदा पाठबाट स्वचालित रूपमा निकालिएका सुझाव हुन् — कानूनी राय होइनन्; वकिलले जाँच्नुपर्छ।</div>
  <h2>१. घटनाक्रम · Chronology (${toDev(a.chrono.length)})</h2>
  ${a.chrono.length ? `<table><thead><tr><th>मिति</th><th>वाक्य</th></tr></thead><tbody>${a.chrono.map(c => `<tr><td>${shortDate(c.date)}</td><td>${esc(c.s)}</td></tr>`).join("")}</tbody></table>` : `<p class="small">पाठमा वि.सं. मिति भेटिएन।</p>`}

  <h2>२. कागजातमा उल्लेखित कानूनी व्यवस्था · Provisions cited in the file</h2>
  ${a.mentioned.length ? `<ul>${a.mentioned.map(x => `<li>${x.sec ? `<a href="#/law/${x.act.id}?s=${x.num}">${esc(x.act.title)} दफा ${toDev(x.num)} — ${esc(x.sec.heading)}</a>` : `${esc(x.act.title)} दफा ${toDev(x.num)} (पाठ डाटाबेसमा भेटिएन)`}</li>`).join("")}</ul>` : `<p class="small">स्पष्ट “ऐन … दफा …” उल्लेख भेटिएन।</p>`}

  <h2>३. सम्भावित कसुर र दफा · Candidate offences (to verify)</h2>
  ${a.candidates.length ? a.candidates.map(c => `<p><b>“${esc(c.hint)}”</b> शब्द भेटियो → ${c.hits.length ? c.hits.map(secLink).join("; ") : "मिल्दो दफा भेटिएन"}</p>`).join("") : `<p class="small">कसुर जनाउने शब्द भेटिएन।</p>`}
  <p class="small">प्रत्येक दफाका तत्व (ingredients) दफाको पाठ पढेर आफैं छुट्याउनुहोस्; यहाँ स्वचालित रूपमा तत्व बनाइँदैन।</p>

  <h2>४. प्रमाण तालिका · Evidence matrix</h2>
  <table><thead><tr><th>प्रमाण</th><th>फाइलमा भेटिएको वाक्य</th><th>अभियोजन पक्षलाई</th><th>प्रतिरक्षा पक्षलाई</th><th>कमजोरी / टिप्पणी</th></tr></thead><tbody>
  ${a.evidence.map(e => `<tr><td>${esc(e.label)}</td><td class="small">${e.found.map(esc).join("<br>…<br>")}</td><td contenteditable></td><td contenteditable></td><td contenteditable></td></tr>`).join("")}
  </tbody></table>
  ${a.missing.length ? `<p><b>फाइलमा उल्लेख नभेटिएका प्रमाण (हराएका कागजात हुन सक्छन्):</b> ${a.missing.map(esc).join(", ")}</p>` : ""}

  <h2>५. कार्यविधिगत जाँचसूची · Procedural checklist</h2>
  <table><thead><tr><th>जाँच</th><th>सम्बन्धित कानूनी व्यवस्था (खोज नतिजा)</th><th>पालना भयो?</th></tr></thead><tbody>
  ${a.procedure.map(p => `<tr><td>${esc(p.label)}</td><td class="small">${p.hits.length ? p.hits.map(secLink).join("<br>") : "भेटिएन"}</td><td contenteditable>☐ हो ☐ होइन ☐ थाहा छैन</td></tr>`).join("")}
  </tbody></table>

  <h2>६. तथ्य र विवादित तथ्य · Facts in issue / disputed facts</h2>
  <table><thead><tr><th>तथ्य</th><th>अभियोजनको दाबी</th><th>प्रतिरक्षाको दाबी</th><th>प्रमाण</th></tr></thead><tbody>
  ${[1, 2, 3, 4, 5].map(() => `<tr><td contenteditable></td><td contenteditable></td><td contenteditable></td><td contenteditable></td></tr>`).join("")}</tbody></table>

  <h2>७. अनुसन्धान प्रश्न · Research questions</h2>
  <ol>
  ${a.candidates.flatMap(c => c.hits.slice(0, 1)).map(r => `<li>${esc(r.act.title)} दफा ${toDev(r.s.number)} का प्रत्येक तत्व फाइलका कुन प्रमाणले पुष्टि वा खण्डन गर्छ?</li>
    <li>दफा ${toDev(r.s.number)} को व्याख्या गर्ने बाध्यकारी नजिर कुन हुन्? <a href="#/law/${r.act.id}?s=${r.s.number}">उद्धृत नजिर हेर्नुहोस्</a></li>`).join("")}
  <li>कसुर भएको मितिमा कुन कानून (र कुन संस्करण) लागू थियो? (कानून पृष्ठको “कसुर भएको मितिमा लागू कानून” जाँच)</li>
  <li>पक्राउ, थुना, बयान र खानतलासीमा कानूनी कार्यविधि पालना भएको छ?</li>
  <li>कुनै प्रमाण प्रमाण ऐन, २०३१ अनुसार ग्राह्य नहुने/कमजोर हुने आधार छ?</li>
  ${a.missing.length ? `<li>फाइलमा नभेटिएका प्रमाण (${a.missing.slice(0, 3).map(esc).join(", ")}…) किन छैनन्? माग गर्नुपर्ने हो?</li>` : ""}
  </ol>

  <h2>८. प्रतिरक्षा तयारी · Defence preparation</h2>
  <table><tbody>
  ${["सम्भावित प्रतिरक्षाका आधार", "लागू नजिर (बाध्यकारी / प्रेरक)", "प्रमाणगत कमजोरी", "कार्यविधिगत आपत्ति", "कानूनी तर्क", "विपक्षीका सम्भावित प्रतितर्क", "जोखिम मूल्याङ्कन"].map(l => `<tr><th>${l}</th><td contenteditable></td></tr>`).join("")}
  </tbody></table>

  <h2>९. सुनुवाइ तयारी · Hearing preparation</h2>
  <table><tbody>
  ${["कानूनी प्रश्न", "तथ्यगत प्रश्न", "सम्बन्धित कानूनी व्यवस्था", "बाध्यकारी र प्रेरक नजिर", "बहसको क्रम", "इजलासले सोध्न सक्ने प्रश्न", "प्रस्तावित जवाफ"].map(l => `<tr><th>${l}</th><td contenteditable></td></tr>`).join("")}
  </tbody></table>
  <p class="small">नजिर खोज्न: <a href="#/research/precedent?q=${encodeURIComponent(a.hints.join(" "))}">“${esc(a.hints.join(", "))}” सम्बन्धी नजिर →</a></p>`;
}

addRoute("research", /^\/casefile$/, async () => {
  app.innerHTML = `<a class="back" href="#/research">← अनुसन्धान</a>
    <h1>मुद्दा फाइल विश्लेषण · Case-file worksheet</h1>
    <p class="sub">जाहेरी, अनुसन्धान प्रतिवेदन, अभियोग पत्र, बयान, बकपत्र आदिको पाठ टाँस्नुहोस् वा .txt फाइल छान्नुहोस्।</p>
    <p class="ok">🔒 गोपनीयता: यो पृष्ठले तपाईंको कागजात कुनै सर्भरमा पठाउँदैन — सबै प्रशोधन यही ब्राउजरमा हुन्छ र पृष्ठ बन्द गरेपछि केही बाँकी रहँदैन। Nothing you paste here leaves your computer.</p>
    <textarea id="cf" rows="10" placeholder="यहाँ मुद्दाको कागजातको पाठ टाँस्नुहोस्…"></textarea>
    <p><input type="file" id="cff" accept=".txt,text/plain" multiple> <button class="btn" id="cgo">विश्लेषण गर्नुहोस्</button>
      <button class="btn ghost" id="cdl" hidden>कार्यपत्र डाउनलोड (.html)</button> <button class="btn ghost" id="cpr" hidden>प्रिन्ट</button>
      <button class="btn ai" id="cdraft" hidden>📝 यसबाट बहस/निवेदनको मस्यौदा बनाउनुहोस् →</button></p>
    <div id="cout" class="worksheet"></div>`;
  const ta = document.getElementById("cf");
  document.getElementById("cff").onchange = async e => {
    const texts = await Promise.all([...e.target.files].map(f => f.text()));
    ta.value = (ta.value ? ta.value + "\n\n" : "") + texts.join("\n\n");
  };
  document.getElementById("cgo").onclick = async () => {
    const out = document.getElementById("cout");
    if (ta.value.trim().length < 30) { out.innerHTML = `<p class="empty">पहिले कागजातको पाठ राख्नुहोस्।</p>`; return; }
    out.innerHTML = `<p class="loading">कानून लोड गर्दै र विश्लेषण गर्दै…</p>`;
    const laws = await coreLaws();
    out.innerHTML = worksheetHTML(analyse(ta.value, laws), ta.value);
    document.getElementById("cdl").hidden = false;
    document.getElementById("cdraft").hidden = false;
    document.getElementById("cpr").hidden = false;
  };
  document.getElementById("cpr").onclick = () => window.print();
  document.getElementById("cdraft").onclick = async () => {
    // hand the facts to the drafting page (session only) and pre-load the suggested sections
    try { sessionStorage.setItem("nct-casefile", ta.value.trim()); } catch { /* ignore */ }
    const a = analyse(ta.value, await coreLaws());
    a.mentioned.filter(m => m.sec).forEach(m => draftAddSection(m.act, m.sec));
    location.hash = "#/draft";
  };
  document.getElementById("cdl").onclick = () => {
    const html = `<!doctype html><html lang="ne"><head><meta charset="utf-8"><title>मुद्दा कार्यपत्र</title>
      <style>body{font-family:"Noto Sans Devanagari",sans-serif;max-width:1000px;margin:20px auto;padding:0 16px;line-height:1.6}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ccc;padding:6px;vertical-align:top;text-align:left}h2{margin-top:24px}.small{color:#555;font-size:13px}</style></head>
      <body><h1>मुद्दा कार्यपत्र (Case worksheet)</h1>${document.getElementById("cout").innerHTML.replace(/href="#\//g, `href="${location.origin}${location.pathname}#/`)}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = "case-worksheet.html";
    a.click();
  };
});

/* ---------------- site-wide search */
addRoute("search", /^\/search$/, async (m, params) => {
  const q = (params.get("q") || "").trim();
  app.innerHTML = `<h1>खोज · Search everything</h1>
    <p class="sub">पेसी (सबै अदालत), सर्वोच्चका प्रकाशित फैसला/आदेश, ने.का.प. नजिर र कानूनका दफा — एकै ठाउँबाट।</p>
    <div class="toolbar"><input type="search" id="q" autofocus placeholder="मुद्दा नं. (078-CR-0481), पक्ष, विषय, कसुर, न्यायाधीश…" value="${esc(q)}"></div>
    <div id="results"></div>`;
  document.getElementById("q").onchange = e => setHash("#/search", { q: e.target.value.trim() });
  if (!q) return;
  const terms = tokens(q);
  const out = document.getElementById("results");
  out.innerHTML = `<p class="loading">खोज्दै…</p>`;
  const md = await meta();
  const [idxs, jd, nkp, heads, laws] = await Promise.all([
    Promise.all(md.courts.map(c => courtSearch(c.code).catch(() => null))), judgmentsIdx(),
    optional(nkpIndex()), optional(nkpHeads()), optional(coreLaws())]);
  // hearings
  const hearings = [];
  idxs.forEach((idx, i) => {
    if (!idx) return;
    const code = md.courts[i].code;
    idx.rows.forEach(r => {
      const hay = norm(`${r[2]} ${r[3]} ${r[4]} ${r[5]} ${r[6]} ${r[7]} ${(idx.benches[r[1]] || []).join(" ")}`);
      if (terms.every(t => hay.includes(t))) hearings.push({ ...rowObj(r, code), _b: idx.benches[r[1]] });
    });
  });
  hearings.sort((a, b) => b.date.localeCompare(a.date));
  const docs = jd.docs.filter(d => terms.every(t => norm(`${d.title} ${d.principle} ${d.case_no} ${d.judges.join(" ")}`).includes(t)));
  const nk = nkp ? nkp.rows.map(NK).map(d => [scoreText(d.title + " " + d.cases.join(" ") + " " + d.judges.join(" "), terms) * 2 + scoreText(((heads || {})[d.id] || []).map(x => x[0]).join(" "), terms), d])
    .filter(x => x[0] > 1).sort((a, b) => b[0] - a[0]).map(x => x[1]) : [];
  const secs = laws ? searchSections(laws, q) : [];
  const cname = code => (md.courts.find(c => c.code === code) || {}).name || code;
  out.innerHTML = `
    <h2>पेसी र नतिजा · Hearings (${toDev(hearings.length)})</h2><div class="bench" id="r1"></div>
    <h2 style="margin-top:20px">नजिर · NKP (${toDev(nk.length)})</h2>${nk.slice(0, 5).map(d => nkpCard(d, heads, terms)).join("")}${nk.length > 5 ? `<p><a href="#/nkp?q=${encodeURIComponent(q)}">सबै ${toDev(nk.length)} नजिर →</a></p>` : ""}
    <h2 style="margin-top:20px">सर्वोच्चका प्रकाशित फैसला/आदेश (${toDev(docs.length)})</h2>${docs.slice(0, 5).map(d => docCard(d)).join("")}${docs.length > 5 ? `<p><a href="#/judgments?q=${encodeURIComponent(q)}&k=all">सबै ${toDev(docs.length)} →</a></p>` : ""}
    <h2 style="margin-top:20px">कानूनका दफा (${toDev(secs.length)})</h2>${secs.slice(0, 5).map(r => sectionCard(r, terms)).join("")}${secs.length > 5 ? `<p><a href="#/research/statute?q=${encodeURIComponent(q)}">सबै ${toDev(secs.length)} दफा →</a></p>` : ""}`;
  paged(document.getElementById("r1"), hearings, r => casesTable(r, { date: true, courtLabel: c => cname(c.court), judges: c => (c._b || []).map(j => "मा. " + esc(j)).join(", ") }), 25);
});
