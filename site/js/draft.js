"use strict";
/* Drafting: बहस नोट, लिखित बहस, धरौटी/थुनछेक निवेदन, कानूनी राय, जिरह प्रश्नावली, पुनरावेदन पत्र.
   B (no AI): assembles a formatted draft from what the lawyer entered and the sections/precedents they chose.
   A (AI):    sends the same material to Claude with the lawyer's own API key, after explicit consent.
   The draft is kept only in this browser (localStorage) until the lawyer clears it. */

const DKEY = "nct-draft-v1";
const KEYSTORE = "nct-anthropic-key";
const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm";
const AI_MODEL = "claude-opus-5-5";

const DOC_TYPES = {
  bahas: { ne: "बहस नोट", en: "Oral argument notes", side: true },
  written: { ne: "लिखित बहस", en: "Written submission", side: true },
  bail: { ne: "थुनछेक / धरौटी सम्बन्धी निवेदन", en: "Bail / detention application", side: false },
  appeal: { ne: "पुनरावेदन पत्र", en: "Appeal", side: true },
  opinion: { ne: "कानूनी राय", en: "Legal opinion", side: false },
  cross: { ne: "जिरह प्रश्नावली", en: "Cross-examination questions", side: true },
};

const emptyDraft = () => ({
  type: "bahas", court: "", case_no: "", offence: "", appellant: "", respondent: "", side: "प्रतिवादी",
  offence_date: "", facts: "", issues: "", points: "", prayer: "", lower_decision: "", question: "",
  witnesses: "", advocate: "", license: "", provisions: [], precedents: [],
});

function loadDraft() {
  try { return { ...emptyDraft(), ...JSON.parse(localStorage.getItem(DKEY) || "{}") }; } catch { return emptyDraft(); }
}
function saveDraft(d) { try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch { /* storage blocked */ } updateBasketCount(); }

function updateBasketCount() {
  const d = loadDraft();
  const n = d.provisions.length + d.precedents.length;
  document.querySelectorAll(".basket-count").forEach(el => { el.textContent = n ? toDev(n) : ""; el.hidden = !n; });
}

/* --------- called from the law / NKP pages ("+ मस्यौदामा") */
function draftAddSection(act, s) {
  const d = loadDraft();
  if (!d.provisions.some(p => p.act === act.id && p.num === s.number)) {
    d.provisions.push({ act: act.id, actTitle: act.title, num: s.number, heading: s.heading, text: s.body,
      label: act.id === 13437 ? "धारा" : "दफा" });
    saveDraft(d);
  }
  return d.provisions.length;
}
function draftAddPrecedent(p) {
  const d = loadDraft();
  const key = p.id + "|" + (p.para || "") + "|" + p.headnote.slice(0, 40);
  if (!d.precedents.some(x => x.key === key)) { d.precedents.push({ ...p, key }); saveDraft(d); }
  return d.precedents.length;
}
function flashAdded(btn) { const t = btn.textContent; btn.textContent = "✓ थपियो"; btn.disabled = true; setTimeout(() => { btn.textContent = t; btn.disabled = false; }, 1500); }

/* ------------------------------------------------------------------ assembled draft (no AI) */
const ph = s => `<span class="ph">[${esc(s)}]</span>`;
const lines = s => String(s || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
const val = (s, placeholder) => s && s.trim() ? esc(s.trim()) : ph(placeholder);

function docHeader(d, title) {
  return `<p class="c"><b>श्री ${val(d.court, "अदालतको नाम")}मा</b></p>
    <p class="c"><b>${esc(title)}</b></p>
    <p>${esc(d.side === "वादी" ? "पुनरावेदक / वादी" : "पुनरावेदक / प्रतिवादी")}: ${val(d.appellant, "पक्षको नाम, ठेगाना")}</p>
    <p class="c">विरुद्ध</p>
    <p>${esc(d.side === "वादी" ? "प्रत्यर्थी / प्रतिवादी" : "प्रत्यर्थी / वादी")}: ${val(d.respondent, "विपक्षको नाम, ठेगाना")}</p>
    <p>मुद्दा: ${val(d.offence, "मुद्दाको नाम / कसुर")} &nbsp; मुद्दा नं.: ${val(d.case_no, "मुद्दा नं.")}</p>`;
}
function lawBlock(d, title = "सम्बन्धित कानूनी व्यवस्था") {
  if (!d.provisions.length) return `<h3>${title}</h3><p>${ph("कानून पृष्ठबाट सम्बन्धित दफा “+ मस्यौदामा” थिचेर थप्नुहोस्")}</p>`;
  return `<h3>${title}</h3>${d.provisions.map(p => `<p><b>${esc(p.actTitle)}, ${p.label} ${toDev(p.num)} (${esc(p.heading)}):</b></p>
    <blockquote>${esc(p.text).replace(/\n/g, "<br>")}</blockquote>`).join("")}`;
}
function precBlock(d, title = "सम्मानित सर्वोच्च अदालतबाट प्रतिपादित नजिर सिद्धान्त") {
  if (!d.precedents.length) return `<h3>${title}</h3><p>${ph("नजिर पृष्ठबाट सिद्धान्त “+ मस्यौदामा” थिचेर थप्नुहोस्")}</p>`;
  return `<h3>${title}</h3>${d.precedents.map((p, i) => `<p>${toDev(i + 1)}. <b>${esc(p.title)}</b>, ${esc(p.citation)}${p.para ? `, प्रकरण नं. ${esc(p.para)}` : ""} मा यस्तो सिद्धान्त प्रतिपादन भएको छ:</p>
    <blockquote>“${esc(p.headnote)}”</blockquote>`).join("")}`;
}
function numbered(items, placeholder) {
  return items.length ? `<ol>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : `<p>${ph(placeholder)}</p>`;
}
function signature(d) {
  return `<p class="r">${d.type === "opinion" ? "राय दिने" : "बहसकर्ता"} कानून व्यवसायी<br>नाम: ${val(d.advocate, "नाम")}<br>
    कानून व्यवसायी प्रमाणपत्र नं.: ${val(d.license, "प्रमाणपत्र नं.")}<br>मिति: ${ph("वि.सं. मिति")}</p>`;
}

const CROSS_AREAS = [
  ["परिचय, सम्बन्ध र स्वार्थ", n => [`${n}, तपाईं पक्ष/विपक्षसँग कुनै नाता, कारोबार वा विवाद छ कि?`, `यो मुद्दामा गवाही दिन तपाईंलाई कसले र कहिले भन्यो?`]],
  ["घटनास्थलमा उपस्थिति र देख्न/सुन्न सक्ने अवस्था", n => [`घटना हुँदा तपाईं ठ्याक्कै कहाँ हुनुहुन्थ्यो, घटनास्थलबाट कति टाढा?`, `त्यस बेला उज्यालो/अँध्यारो कस्तो थियो? बीचमा कुनै छेकबार थियो कि?`, `तपाईंले आफैँ देख्नुभएको हो कि अरूबाट सुन्नुभएको?`]],
  ["अघिल्लो बयान / कागजसँग फरक", n => [`प्रहरी/अनुसन्धान अधिकारीसमक्ष गरिएको कागजमा तपाईंले यो कुरा भन्नुभएको छैन होइन?`, `त्यो कागज पढेर, बुझेर सही गर्नुभएको हो?`]],
  ["प्रमाण र मुचुल्कासँग मेल", n => [`घटनास्थल/बरामदी मुचुल्कामा तपाईंको सही छ? मुचुल्का बनाउँदा तपाईं आफैँ उपस्थित हुनुहुन्थ्यो?`, `उक्त वस्तु बरामद भएको तपाईंले आफ्नै आँखाले देख्नुभयो?`]],
  ["समय, मिति र क्रम", n => [`घटना कुन मिति, कति बजे भएको हो? तपाईंले कसरी सम्झनुभयो?`, `घटनापछि तुरुन्तै तपाईंले के गर्नुभयो, कसलाई खबर गर्नुभयो?`]],
];

function assemble(d) {
  const t = DOC_TYPES[d.type];
  const issues = lines(d.issues), points = lines(d.points);
  const facts = d.facts.trim() ? `<p>${esc(d.facts.trim()).replace(/\n+/g, "</p><p>")}</p>` : `<p>${ph("मुद्दाको संक्षिप्त तथ्य")}</p>`;
  let body = "";
  if (d.type === "bahas") {
    body = `${docHeader(d, "बहस नोट")}
      <h3>१. संक्षिप्त तथ्य</h3>${facts}
      <h3>२. निर्णय गर्नुपर्ने प्रश्नहरू</h3>${numbered(issues, "कानूनी/तथ्यगत प्रश्न")}
      ${lawBlock(d, "३. सम्बन्धित कानूनी व्यवस्था")}
      ${precBlock(d, "४. सम्बन्धित नजिर")}
      <h3>५. बहसका मुख्य बुँदा</h3>${numbered(points, "आफ्ना तर्क एक-एक बुँदामा लेख्नुहोस्")}
      <h3>६. निष्कर्ष र माग</h3><p>${val(d.prayer, "इजलाससमक्ष के माग गर्ने हो")}</p>${signature(d)}`;
  } else if (d.type === "written") {
    body = `${docHeader(d, "लिखित बहस")}
      <p>उपर्युक्त मुद्दामा ${esc(d.side)}को तर्फबाट देहाय बमोजिम लिखित बहस पेश गरेको छु:</p>
      <h3>१. मुद्दाको संक्षिप्त तथ्य</h3>${facts}
      <h3>२. निरूपण गर्नुपर्ने प्रश्न</h3>${numbered(issues, "निरूपण गर्नुपर्ने प्रश्न")}
      ${lawBlock(d, "३. कानूनी व्यवस्था")}
      ${precBlock(d, "४. सम्मानित सर्वोच्च अदालतबाट प्रतिपादित सिद्धान्त")}
      <h3>५. बहस / जिकिर</h3>${numbered(points, "तर्क")}
      <h3>६. माग</h3><p>अतः ${val(d.prayer, "माग दाबी, जस्तै: अभियोग दाबीबाट सफाइ पाउँ")}।</p>${signature(d)}`;
  } else if (d.type === "bail") {
    body = `${docHeader(d, "थुनछेक / धरौटी सम्बन्धी निवेदन")}
      <p>विषय: ${val(d.prayer, "जस्तै: धरौटी/जमानतमा छाडी पुर्पक्ष गरी पाउँ")} भन्ने बारे।</p>
      <h3>१. तथ्य</h3>${facts}
      <h3>२. निवेदनका आधारहरू</h3>${numbered(points, "आधार, जस्तै: प्रमाणको अवस्था, थुनामा बसेको अवधि, फरार हुने सम्भावना नभएको")}
      ${lawBlock(d, "३. कानूनी आधार")}
      ${precBlock(d, "४. नजिर")}
      <h3>५. माग</h3><p>अतः माथि उल्लेखित आधार र कानूनी व्यवस्था बमोजिम ${val(d.prayer, "माग")} भन्ने आदेश गरी पाउँ।</p>
      <p>यसमा लेखिएको व्यहोरा ठीक साँचो छ, झुठा ठहरे कानून बमोजिम सहुँला बुझाउँला।</p>${signature(d)}`;
  } else if (d.type === "appeal") {
    body = `${docHeader(d, "पुनरावेदन पत्र")}
      <h3>१. तथ्य</h3>${facts}
      <h3>२. शुरु/तल्लो अदालतको फैसला</h3><p>${val(d.lower_decision, "कुन अदालत, मिति, के ठहर भएको")}</p>
      <h3>३. पुनरावेदनका आधारहरू</h3>${numbered(points, "फैसलामा भएको त्रुटि एक-एक बुँदामा")}
      ${lawBlock(d, "४. कानूनी व्यवस्था")}
      ${precBlock(d, "५. नजिर")}
      <h3>६. माग</h3><p>अतः ${val(d.prayer, "जस्तै: शुरु फैसला उल्टी गरी अभियोग दाबीबाट सफाइ पाउँ")}।</p>${signature(d)}`;
  } else if (d.type === "opinion") {
    body = `<p class="c"><b>कानूनी राय</b></p>
      <p>विषय: ${val(d.offence, "विषय")} ${d.case_no ? "(मुद्दा नं. " + esc(d.case_no) + ")" : ""}</p>
      <h3>१. राय मागिएको प्रश्न</h3><p>${val(d.question, "राय मागिएको प्रश्न")}</p>
      <h3>२. संक्षिप्त उत्तर</h3><p>${ph("संक्षिप्त निष्कर्ष — वकिलले लेख्ने")}</p>
      <h3>३. तथ्य (उपलब्ध कागजात अनुसार)</h3>${facts}
      ${lawBlock(d, "४. लागू कानून")}
      ${precBlock(d, "५. सम्बन्धित नजिर")}
      <h3>६. विश्लेषण</h3>${numbered(points, "विश्लेषणका बुँदा")}
      <h3>७. निष्कर्ष</h3><p>${val(d.prayer, "निष्कर्ष र सिफारिस")}</p>
      <h3>८. सीमा र मान्यता</h3><p>यो राय उपलब्ध गराइएका कागजातमा आधारित छ। कसुर भएको मितिमा लागू कानून र नजिर अझै प्रभावी रहे/नरहेको पुष्टि गर्नुपर्छ। ${ph("नपुगेका कागजात")}</p>${signature(d)}`;
  } else if (d.type === "cross") {
    const ws = lines(d.witnesses).map(l => l.split(/\s*[—–-]\s*/));
    body = `${docHeader(d, "जिरह प्रश्नावली")}
      <p class="small-note">यी प्रश्न सुरुवाती ढाँचा मात्र हुन् — फाइलका कागज र साक्षीको बकपत्र हेरेर मिलाउनुहोस्।</p>
      ${(ws.length ? ws : [["साक्षीको नाम"]]).map(([name, role, stmt], i) => `
        <h3>${toDev(i + 1)}. साक्षी: ${esc(name || "")}${role ? ` (${esc(role)})` : ""}</h3>
        ${stmt ? `<p><i>बयान/कागजको सार:</i> ${esc(stmt)}</p>` : ""}
        ${CROSS_AREAS.map(([area, qs]) => `<p><b>${area}</b></p><ol>${qs(name || "साक्षी").map(q => `<li>${esc(q)}</li>`).join("")}<li>${ph("थप प्रश्न")}</li></ol>`).join("")}
      `).join("")}
      ${points.length ? `<h3>जिरहबाट स्थापित गर्न खोजिएका कुरा</h3>${numbered(points, "")}` : ""}
      ${lawBlock(d, "सम्बन्धित कानूनी व्यवस्था")}`;
  }
  return `<div class="legal-doc">${body}</div>`;
}

/* ------------------------------------------------------------------ AI draft (Claude) */
function anonymiser(d) {
  // replace party / witness names with placeholders before sending; restore after
  const map = [];
  const add = (name, tag) => { name = (name || "").trim(); if (name.length > 2) map.push([name, tag]); };
  lines(d.appellant.replace(/,|समेत/g, "\n")).forEach((n, i) => add(n.split(/[,(]/)[0], `[पक्ष-${toDev(i + 1)}]`));
  lines(d.respondent.replace(/,|समेत/g, "\n")).forEach((n, i) => add(n.split(/[,(]/)[0], `[विपक्ष-${toDev(i + 1)}]`));
  lines(d.witnesses).forEach((l, i) => add(l.split(/\s*[—–-]\s*/)[0], `[साक्षी-${toDev(i + 1)}]`));
  map.sort((a, b) => b[0].length - a[0].length);
  const hide = s => map.reduce((t, [n, tag]) => t.split(n).join(tag), String(s || ""));
  const show = s => map.reduce((t, [n, tag]) => t.split(tag).join(n), String(s || ""));
  return { hide, show, count: map.length };
}

const SYSTEM_PROMPT = `तपाईं नेपालमा प्रचलित कानून अनुसार काम गर्ने अनुभवी फौजदारी कानून व्यवसायीलाई मस्यौदा तयार गर्न सहयोग गर्ने सहायक हुनुहुन्छ। तपाईंले लेखेको मस्यौदा लाइसेन्सप्राप्त कानून व्यवसायीले जाँचेर मात्र प्रयोग गर्नेछन्।

You draft Nepali court documents (बहस नोट, लिखित बहस, निवेदन, पुनरावेदन पत्र, कानूनी राय, जिरह प्रश्नावली) for a licensed Nepali advocate, who will review and correct every line before use.

Rules — follow all of them:
1. Write in formal Nepali legal register, as used in pleadings before Nepali courts, in Devanagari.
2. Legal sources: use ONLY the statutory provisions and precedents given inside <sources>. Do not cite, name or rely on any other Act, section (दफा/धारा), NKP decision, case number or judgment, even if you believe it exists. If the argument needs a source that is not provided, write [वकिलले थप्नुहोस्: what is needed] instead.
3. When citing a precedent, use exactly the citation given (ने.का.प. …, नि.नं. …, प्रकरण नं. …) and attribute to it only what its quoted headnote says. Quote headnotes and provisions word for word when quoting.
4. Facts: use only the facts given. Never invent names, dates, places, evidence, witness statements or events. Where a fact is needed but not given, write [तथ्य पुष्टि गर्नुहोस्: …].
5. Names may appear as placeholders like [पक्ष-१], [विपक्ष-१], [साक्षी-१]. Keep them exactly as written.
6. Arguments must be reasoned from the given facts, provisions and headnotes. Present them as the advocate's submissions (जिकिर), never as settled holdings of the court beyond the quoted headnotes.
7. Output only the document itself, ready to paste: no preamble, no commentary, no Markdown tables. Use a line starting with "## " for each heading and numbered paragraphs (१., २., …). Leave the advocate's signature block with placeholders.`;

const TYPE_INSTRUCTIONS = {
  bahas: "बहस नोट: इजलासमा मौखिक बहस गर्न प्रयोग हुने संक्षिप्त, बुँदागत नोट — तथ्य, प्रश्न, कानून, नजिर, क्रमबद्ध तर्क, सम्भावित प्रतितर्कको जवाफ, माग।",
  written: "लिखित बहस: अदालतमा पेश गर्ने औपचारिक लिखित बहस — तथ्य, निरूपण गर्नुपर्ने प्रश्न, कानूनी व्यवस्था, नजिर, विस्तृत जिकिर, विपक्षीको सम्भावित तर्कको खण्डन, माग।",
  bail: "थुनछेक/धरौटी सम्बन्धी निवेदन: तथ्य, निवेदनका आधार (प्रमाणको अवस्था, थुनामा बसेको अवधि, फरार नहुने आधार आदि — दिइएका तथ्यबाट मात्र), कानूनी आधार, नजिर, माग, सत्यताको उद्घोषण।",
  appeal: "पुनरावेदन पत्र: तथ्य, तल्लो अदालतको फैसला, फैसलामा भएका त्रुटि बुँदागत रूपमा (कानूनको गलत व्याख्या, प्रमाणको मूल्याङ्कनमा त्रुटि, कार्यविधिगत त्रुटि), कानून, नजिर, माग।",
  opinion: "कानूनी राय: प्रश्न, संक्षिप्त उत्तर, तथ्य, लागू कानून, नजिर, विश्लेषण (बलियो र कमजोर पक्ष दुवै), जोखिम, निष्कर्ष र सिफारिस, सीमा/मान्यता र नपुगेका कागजातको सूची।",
  cross: "जिरह प्रश्नावली: प्रत्येक साक्षीका लागि छोटा, नेतृत्व गर्ने (leading), एक-एक तथ्य मात्र सोध्ने प्रश्न — परिचय/स्वार्थ, उपस्थिति र देख्न सक्ने अवस्था, अघिल्लो कागज/बयानसँग विरोधाभास, मुचुल्का र प्रमाणसँग मेल, समय र क्रम। प्रत्येक प्रश्न समूहले स्थापित गर्न खोजेको कुरा पनि लेख्नुहोस्।",
};

function buildUserMessage(d, hide) {
  const src = [];
  d.provisions.forEach((p, i) => src.push(`<provision id="L${i + 1}">\n${p.actTitle}, ${p.label} ${toDev(p.num)} (${p.heading})\n${p.text}\n</provision>`));
  d.precedents.forEach((p, i) => src.push(`<precedent id="P${i + 1}">\n${p.title}, ${p.citation}${p.para ? ", प्रकरण नं. " + p.para : ""}\nHeadnote: ${p.headnote}\n</precedent>`));
  const f = (label, v) => v && String(v).trim() ? `${label}: ${hide(String(v).trim())}\n` : "";
  return `Document type: ${DOC_TYPES[d.type].ne} (${DOC_TYPES[d.type].en})
${TYPE_INSTRUCTIONS[d.type]}

<case>
${f("अदालत", d.court)}${f("मुद्दा", d.offence)}${f("मुद्दा नं.", d.case_no)}${f("हामी कुन पक्षको वकिल", d.side)}${f("पुनरावेदक/पक्ष", d.appellant)}${f("प्रत्यर्थी/विपक्ष", d.respondent)}${f("कसुर भएको मिति", d.offence_date)}${f("तल्लो अदालतको फैसला", d.lower_decision)}${f("राय मागिएको प्रश्न", d.question)}
तथ्य:
${hide(d.facts) || "(दिइएको छैन)"}

निरूपण गर्नुपर्ने प्रश्न:
${hide(d.issues) || "(दिइएको छैन)"}

वकिलका बुँदा / तर्क:
${hide(d.points) || "(दिइएको छैन)"}

साक्षी (नाम — भूमिका — बयानको सार):
${hide(d.witnesses) || "(दिइएको छैन)"}

माग:
${hide(d.prayer) || "(दिइएको छैन)"}
</case>

<sources>
${src.join("\n\n") || "(कुनै स्रोत दिइएको छैन — कुनै दफा वा नजिर उद्धृत नगर्नुहोस्)"}
</sources>

Write the complete ${DOC_TYPES[d.type].ne} now.`;
}

function renderAIText(text) {
  return `<div class="legal-doc">${esc(text).split("\n").map(l => {
    if (/^##\s*/.test(l)) return `<h3>${l.replace(/^##\s*/, "")}</h3>`;
    if (!l.trim()) return "";
    return `<p>${l.replace(/\[(वकिलले थप्नुहोस्|तथ्य पुष्टि गर्नुहोस्)[^\]]*\]/g, m => `<span class="ph">${m}</span>`)}</p>`;
  }).join("")}</div>`;
}

// Citations in the AI text that are not among the provided sources -> flagged for the lawyer
function checkCitations(text, d) {
  const allowedSec = new Set(), allowedNo = new Set();
  d.provisions.forEach(p => { allowedSec.add(toLat(p.num)); (p.text.match(/[०-९0-9]{1,3}/g) || []).forEach(n => allowedSec.add(toLat(n))); });
  d.precedents.forEach(p => {
    const m = toLat(p.citation).match(/नि\.?\s*नं\.?\s*(\d+)/); if (m) allowedNo.add(m[1]);
    (p.headnote.match(/[०-९0-9]{1,3}/g) || []).forEach(n => allowedSec.add(toLat(n)));
  });
  // provisions the lawyer mentioned themselves in the facts / arguments are theirs, not invented
  [d.facts, d.points, d.issues, d.prayer, d.lower_decision, d.question].join(" ").replace(/(?:दफा|धारा)\s*([०-९0-9]{1,3})/g, (_, n) => allowedSec.add(toLat(n)));
  const bad = new Set();
  for (const m of text.matchAll(/(?:दफा|धारा)\s*([०-९0-9]{1,3}[क-ह]?)/g)) if (!allowedSec.has(toLat(m[1]).replace(/[क-ह]$/, "")) && !allowedSec.has(toLat(m[1]))) bad.add(m[0]);
  for (const m of text.matchAll(/नि\.?\s*नं\.?\s*([०-९0-9]{2,5})/g)) if (!allowedNo.has(toLat(m[1]))) bad.add(m[0]);
  for (const m of text.matchAll(/\b\d{3}-[A-Z]{2}-\d{3,4}\b/g)) if (!toLat(d.case_no || "").includes(m[0])) bad.add(m[0]);
  return [...bad];
}

async function runAI(d, opts, out, status) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: opts.key, dangerouslyAllowBrowser: true });
  const anon = opts.anonymise ? anonymiser(d) : { hide: s => String(s || ""), show: s => s, count: 0 };
  const stream = client.beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 32000,
    output_config: { effort: "high" },
    // if a safety check declines, the API retries on a fallback model in the same call
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(d, anon.hide) }],
  });
  let text = "";
  status.textContent = "Claude ले मस्यौदा लेख्दैछ…";
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      text += ev.delta.text;
      out.innerHTML = renderAIText(anon.show(text));
    }
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude ले यो अनुरोध अस्वीकार गर्‍यो (refusal)। सामग्री मिलाएर फेरि प्रयास गर्नुहोस्।");
  const finalText = anon.show(text);
  out.innerHTML = renderAIText(finalText);
  const bad = checkCitations(finalText, d);
  return { bad, truncated: msg.stop_reason === "max_tokens", usage: msg.usage };
}

/* ------------------------------------------------------------------ page */
addRoute("draft", /^\/draft$/, async () => {
  const d = loadDraft();
  const field = (k, label, ph_, rows) => rows
    ? `<label class="fl">${label}<textarea data-k="${k}" rows="${rows}" placeholder="${esc(ph_ || "")}">${esc(d[k])}</textarea></label>`
    : `<label class="fl">${label}<input data-k="${k}" value="${esc(d[k])}" placeholder="${esc(ph_ || "")}"></label>`;
  const casefile = (() => { try { return sessionStorage.getItem("nct-casefile") || ""; } catch { return ""; } })();
  app.innerHTML = `<h1>मस्यौदा · Drafting</h1>
    <p class="sub">बहस नोट, लिखित बहस, धरौटी निवेदन, पुनरावेदन, कानूनी राय र जिरह प्रश्नावलीको मस्यौदा। कानून र नजिर पृष्ठमा “+ मस्यौदामा” थिचेर स्रोत थप्नुहोस्।</p>
    <p class="ok">🔒 यो फारम र मस्यौदा तपाईंको ब्राउजरमा मात्र बस्छ। “AI मस्यौदा” नथिचेसम्म कुनै कुरा कतै पठाइँदैन।</p>
    <div class="draft-grid">
      <div class="panel">
        <label class="fl">कागजातको किसिम · Document
          <select data-k="type">${Object.entries(DOC_TYPES).map(([k, t]) => `<option value="${k}" ${d.type === k ? "selected" : ""}>${t.ne} · ${t.en}</option>`).join("")}</select></label>
        <div class="two">${field("court", "अदालत", "जस्तै: सर्वोच्च अदालत")}${field("case_no", "मुद्दा नं.", "078-CR-0481")}</div>
        <div class="two">${field("offence", "मुद्दा / कसुर", "जस्तै: चोरी")}${field("offence_date", "कसुर भएको मिति", "2080-05-12")}</div>
        <label class="fl">हामी कुन पक्ष · Our side
          <select data-k="side"><option ${d.side === "प्रतिवादी" ? "selected" : ""}>प्रतिवादी</option><option ${d.side === "वादी" ? "selected" : ""}>वादी</option><option ${d.side === "निवेदक" ? "selected" : ""}>निवेदक</option></select></label>
        ${field("appellant", "पक्ष / पुनरावेदक", "नाम, ठेगाना")}
        ${field("respondent", "विपक्ष / प्रत्यर्थी", "जस्तै: नेपाल सरकार")}
        ${casefile ? `<button class="btn ghost" id="importCF">मुद्दा फाइल विश्लेषणबाट तथ्य ल्याउनुहोस्</button>` : ""}
        ${field("facts", "संक्षिप्त तथ्य", "घटना, मिति, अनुसन्धान, अभियोग…", 6)}
        ${field("issues", "निरूपण गर्नुपर्ने प्रश्न (एक लाइनमा एक)", "", 3)}
        ${field("points", "तपाईंका तर्क / आधार (एक लाइनमा एक)", "जस्तै: प्रहरीसमक्षको साविती बयान अदालतमा इन्कार गरेको र अन्य स्वतन्त्र प्रमाणले पुष्टि नभएको", 5)}
        <div data-show="appeal">${field("lower_decision", "तल्लो अदालतको फैसला", "अदालत, मिति, ठहर", 2)}</div>
        <div data-show="opinion">${field("question", "राय मागिएको प्रश्न", "", 2)}</div>
        <div data-show="cross">${field("witnesses", "साक्षी (एक लाइनमा: नाम — भूमिका — बयानको सार)", "राम थापा — जाहेरवाला — घटना देखेको भनी कागज गरेको", 3)}</div>
        ${field("prayer", "माग / निष्कर्ष", "जस्तै: अभियोग दाबीबाट सफाइ पाउँ", 2)}
        <div class="two">${field("advocate", "कानून व्यवसायीको नाम")}${field("license", "प्रमाणपत्र नं.")}</div>
      </div>
      <div class="panel">
        <h2>स्रोत · Sources <span class="small">(मस्यौदामा प्रयोग हुने)</span></h2>
        <h3 class="mini">कानूनी व्यवस्था (${toDev(d.provisions.length)})</h3>
        <ul class="plain">${d.provisions.map((p, i) => `<li>${esc(p.actTitle)} ${p.label} ${toDev(p.num)} — ${esc(p.heading)} <button class="x" data-rmp="${i}" aria-label="हटाउनुहोस्">✕</button></li>`).join("") || `<li class="small">छैन</li>`}</ul>
        <div class="toolbar"><input id="addSecQ" placeholder="दफा खोजेर थप्नुहोस् (e.g. चोरी, दफा २४२)"><button class="btn ghost" id="addSecGo">खोज</button></div>
        <div id="addSecRes"></div>
        <h3 class="mini">नजिर (${toDev(d.precedents.length)})</h3>
        <ul class="plain">${d.precedents.map((p, i) => `<li>${esc(p.citation)} — ${esc(p.title)}${p.para ? ` (प्रकरण ${esc(p.para)})` : ""} <button class="x" data-rmn="${i}" aria-label="हटाउनुहोस्">✕</button></li>`).join("") || `<li class="small">छैन</li>`}</ul>
        <div class="toolbar"><input id="addPrecQ" placeholder="नजिर खोजेर थप्नुहोस् (e.g. साविती बयान)"><button class="btn ghost" id="addPrecGo">खोज</button></div>
        <div id="addPrecRes"></div>
      </div>
    </div>
    <div class="draft-actions">
      <button class="btn" id="mkB">📝 मस्यौदा बनाउनुहोस् (AI बिना)</button>
      <button class="btn ai" id="mkA">🤖 AI ले पूरा मस्यौदा लेखोस्</button>
      <button class="btn ghost" id="dlDoc" hidden>⬇ Word (.doc)</button>
      <button class="btn ghost" id="prDoc" hidden>🖨 प्रिन्ट / PDF</button>
      <button class="btn ghost danger" id="clr">सबै मेटाउनुहोस्</button>
    </div>
    <p id="dstatus" class="small"></p>
    <div id="dwarn"></div>
    <div id="dout" class="worksheet" contenteditable="true" spellcheck="false"></div>
    <dialog id="aiDlg"></dialog>`;

  const showByType = () => app.querySelectorAll("[data-show]").forEach(el => { el.hidden = el.dataset.show !== loadDraft().type; });
  showByType();
  app.querySelectorAll("[data-k]").forEach(el => {
    el.addEventListener("input", () => { const x = loadDraft(); x[el.dataset.k] = el.value; saveDraft(x); if (el.dataset.k === "type") showByType(); });
    el.addEventListener("change", () => { const x = loadDraft(); x[el.dataset.k] = el.value; saveDraft(x); if (el.dataset.k === "type") showByType(); });
  });
  app.querySelectorAll("[data-rmp]").forEach(b => b.onclick = () => { const x = loadDraft(); x.provisions.splice(+b.dataset.rmp, 1); saveDraft(x); route(); });
  app.querySelectorAll("[data-rmn]").forEach(b => b.onclick = () => { const x = loadDraft(); x.precedents.splice(+b.dataset.rmn, 1); saveDraft(x); route(); });
  const imp = document.getElementById("importCF");
  if (imp) imp.onclick = () => { const x = loadDraft(); x.facts = (x.facts ? x.facts + "\n" : "") + casefile; saveDraft(x); route(); };

  // inline source search
  document.getElementById("addSecGo").onclick = async () => {
    const q = document.getElementById("addSecQ").value.trim(); if (!q) return;
    const el = document.getElementById("addSecRes"); el.innerHTML = `<p class="loading">खोज्दै…</p>`;
    const res = searchSections(await coreLaws(), q).slice(0, 8);
    el.innerHTML = res.map((r, i) => `<p class="small">${esc(r.act.title)} ${toDev(r.s.number)} — ${esc(r.s.heading)} <button class="btn ghost sm" data-add="${i}">+ थप्नुहोस्</button></p>`).join("") || `<p class="small">भेटिएन।</p>`;
    el.querySelectorAll("[data-add]").forEach(b => b.onclick = () => { const r = res[+b.dataset.add]; draftAddSection(r.act, r.s); route(); });
  };
  document.getElementById("addPrecGo").onclick = async () => {
    const q = document.getElementById("addPrecQ").value.trim(); if (!q) return;
    const el = document.getElementById("addPrecRes"); el.innerHTML = `<p class="loading">खोज्दै…</p>`;
    const [idx, heads] = await Promise.all([nkpIndex(), nkpHeads()]);
    const terms = tokens(q);
    const cands = [];
    idx.rows.map(NK).forEach(nd => (heads[nd.id] || []).forEach(h => { const s = scoreText(h[0], terms) + scoreText(nd.title, terms); if (s > 1) cands.push([s + (nd.criminal ? 0.5 : 0), nd, h]); }));
    cands.sort((a, b) => b[0] - a[0]);
    const top = cands.slice(0, 8);
    el.innerHTML = top.map(([, nd, h], i) => `<div class="small cand"><b>${esc(nkpCitation(nd))}</b> — ${esc(nd.title)}<br>${highlight(h[0], terms, 220)} <button class="btn ghost sm" data-addp="${i}">+ थप्नुहोस्</button></div>`).join("") || `<p class="small">भेटिएन।</p>`;
    el.querySelectorAll("[data-addp]").forEach(b => b.onclick = () => {
      const [, nd, h] = top[+b.dataset.addp];
      draftAddPrecedent({ id: nd.id, citation: nkpCitation(nd), title: nd.title, headnote: h[0], para: h[1] || "" }); route();
    });
  };

  const out = document.getElementById("dout"), status = document.getElementById("dstatus"), warn = document.getElementById("dwarn");
  const showExport = () => { document.getElementById("dlDoc").hidden = false; document.getElementById("prDoc").hidden = false; };
  document.getElementById("mkB").onclick = () => {
    warn.innerHTML = "";
    out.innerHTML = assemble(loadDraft());
    status.textContent = "मस्यौदा तयार। [कोष्ठकमा] भएका ठाउँ भर्नुहोस् — यहीँ सिधै सम्पादन गर्न सकिन्छ।";
    showExport(); out.scrollIntoView({ behavior: "smooth" });
  };
  document.getElementById("clr").onclick = () => {
    if (!confirm("यो मस्यौदाका सबै विवरण र स्रोत मेटाउने?")) return;
    try { localStorage.removeItem(DKEY); } catch { /* ignore */ }
    route();
  };
  document.getElementById("prDoc").onclick = () => window.print();
  document.getElementById("dlDoc").onclick = () => {
    const html = `<html><head><meta charset="utf-8"><title>${esc(DOC_TYPES[loadDraft().type].ne)}</title>
      <style>body{font-family:"Kalimati","Noto Sans Devanagari","Mangal",serif;font-size:13pt;line-height:1.7}.c{text-align:center}.r{text-align:right}blockquote{margin:6pt 24pt;font-style:italic}.ph{background:#ffef9e}</style></head>
      <body>${out.innerHTML}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + html], { type: "application/msword" }));
    a.download = `${DOC_TYPES[loadDraft().type].en.replace(/\W+/g, "-").toLowerCase()}.doc`;
    a.click();
  };

  // ---- AI
  document.getElementById("mkA").onclick = () => {
    const x = loadDraft();
    let saved = ""; try { saved = localStorage.getItem(KEYSTORE) || ""; } catch { /* ignore */ }
    const an = anonymiser(x);
    const dlg = document.getElementById("aiDlg");
    dlg.innerHTML = `<form method="dialog" class="ai-form">
      <h2>🤖 AI मस्यौदा — पठाउनुअघि पढ्नुहोस्</h2>
      <p>“पठाउनुहोस्” थिचेपछि तलका विवरण <b>Anthropic (Claude)</b> का सर्भरमा पठाइन्छ:</p>
      <ul class="small">
        <li>कागजातको किसिम: ${esc(DOC_TYPES[x.type].ne)}</li>
        <li>मुद्दाको विवरण, तथ्य (${toDev(x.facts.length)} अक्षर), प्रश्न, तर्क, माग${x.type === "cross" ? ", साक्षीको विवरण" : ""}</li>
        <li>तपाईंले छानेका ${toDev(x.provisions.length)} दफा र ${toDev(x.precedents.length)} नजिर</li>
      </ul>
      <label class="check"><input type="checkbox" id="aiAnon" checked> पक्ष, विपक्ष र साक्षीका नाम लुकाएर पठाउनुहोस् (${toDev(an.count)} नाम [पक्ष-१] जस्ता संकेतमा बदलिन्छ, फर्केपछि फेरि राखिन्छ)</label>
      <label class="check"><input type="checkbox" id="aiConsent"> यी विवरण बाहिर पठाउन मलाई अनुमति छ (ग्राहकको सहमति/गोपनीयता दायित्व मैले जाँचेको छु)।</label>
      <label class="fl">तपाईंको Anthropic API key
        <input type="password" id="aiKey" value="${esc(saved)}" placeholder="sk-ant-…" autocomplete="off"></label>
      <label class="check"><input type="checkbox" id="aiRemember" ${saved ? "checked" : ""}> यो कम्प्युटरको ब्राउजरमा key सम्झनुहोस्</label>
      <p class="small">Key <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a> बाट लिनुहोस्। यो सिधै तपाईंको ब्राउजरबाट Anthropic मा मात्र जान्छ — यो वेबसाइटको कुनै सर्भर छैन। एक मस्यौदाको खर्च सामान्यतया केही अमेरिकी सेन्ट देखि करिब १ डलरसम्म (लम्बाइ अनुसार) तपाईंको Anthropic खाताबाट लाग्छ।</p>
      <p class="warn small">⚖️ AI मस्यौदा सहयोगी ड्राफ्ट मात्र हो, कानूनी राय होइन। तपाईंले नछानेका दफा/नजिर उद्धृत भएमा रातो चिन्हले देखाइन्छ। अदालतमा पेश गर्नुअघि प्रत्येक वाक्य जाँच्नुहोस्।</p>
      <div class="draft-actions"><button class="btn ai" value="go" id="aiGo" disabled>पठाउनुहोस्</button><button class="btn ghost" value="cancel">रद्द</button></div>
    </form>`;
    dlg.showModal();
    const consent = dlg.querySelector("#aiConsent"), keyIn = dlg.querySelector("#aiKey"), go = dlg.querySelector("#aiGo");
    const upd = () => { go.disabled = !(consent.checked && keyIn.value.trim().startsWith("sk-")); };
    consent.onchange = upd; keyIn.oninput = upd; upd();
    dlg.onclose = async () => {
      if (dlg.returnValue !== "go") return;
      const key = keyIn.value.trim();
      try { if (dlg.querySelector("#aiRemember").checked) localStorage.setItem(KEYSTORE, key); else localStorage.removeItem(KEYSTORE); } catch { /* ignore */ }
      warn.innerHTML = "";
      out.innerHTML = `<p class="loading">Claude सँग जोडिँदै…</p>`;
      out.scrollIntoView({ behavior: "smooth" });
      document.getElementById("mkA").disabled = true;
      try {
        const r = await runAI(loadDraft(), { key, anonymise: dlg.querySelector("#aiAnon").checked }, out, status);
        status.textContent = `AI मस्यौदा तयार${r.truncated ? " (लम्बाइको सीमाले अधूरो — छोटो बनाउन भनेर फेरि प्रयास गर्नुहोस्)" : ""}। यहीँ सम्पादन गर्न सकिन्छ।`;
        warn.innerHTML = r.bad.length
          ? `<p class="warn">⚠️ तपाईंले नछानेका यी सन्दर्भ मस्यौदामा देखिए — हटाउनुहोस् वा मूल स्रोतमा पुष्टि गरेर मात्र राख्नुहोस्: <b>${r.bad.map(esc).join(", ")}</b></p>`
          : `<p class="ok">✓ मस्यौदामा उद्धृत सबै दफा/नजिर तपाईंले छानेका स्रोतभित्रका छन्। तैपनि हरेक उद्धरण मूल पाठसँग मिलाउनुहोस्।</p>`;
        r.bad.forEach(b => { out.innerHTML = out.innerHTML.split(esc(b)).join(`<mark class="bad">${esc(b)}</mark>`); });
        showExport();
      } catch (e) {
        const s = e && e.status;
        const m = s === 401 ? "API key मिलेन (401)। key जाँचेर फेरि प्रयास गर्नुहोस्।"
          : s === 429 ? "धेरै अनुरोध भयो (429)। केही बेरपछि प्रयास गर्नुहोस्।"
          : s === 400 ? `अनुरोधमा समस्या (400): ${e.message}`
          : s >= 500 ? `Anthropic सर्भरमा समस्या (${s})। केही बेरपछि प्रयास गर्नुहोस्।`
          : (e && e.message) || String(e);
        out.innerHTML = `<p class="warn">AI मस्यौदा बन्न सकेन: ${esc(m)}</p>`;
        status.textContent = "";
      } finally { document.getElementById("mkA").disabled = false; }
    };
  };
});

window.BOOT = (window.BOOT || []).concat(() => updateBasketCount());
