"use strict";
/* Statutes from the Nepal Law Commission: catalogue, parsed criminal-law acts, amendments, citing precedents. */

const lawsIndex = () => getJSON("data/statutes/index.json");
const lawDoc = id => getJSON(`data/statutes/a/${id}.json`);
const AREA_NE = {
  constitution: "संविधान", substantive: "मूल फौजदारी कानून", procedure: "फौजदारी कार्यविधि", sentencing: "सजाय निर्धारण",
  evidence: "प्रमाण", victims: "पीडित", corruption: "भ्रष्टाचार", "money laundering": "सम्पत्ति शुद्धीकरण",
  narcotics: "लागू औषध", trafficking: "मानव बेचबिखन", "organised crime": "सङ्गठित अपराध", cybercrime: "साइबर / विद्युतीय",
  arms: "हातहतियार", banking: "बैङ्किङ कसूर", wildlife: "वन्यजन्तु", children: "बालबालिका", "domestic violence": "घरेलु हिंसा",
  "social offences": "सामाजिक अपराध", courts: "अदालत", prosecution: "अभियोजन", procurement: "सार्वजनिक खरिद",
  citizenship: "नागरिकता", "foreign employment": "वैदेशिक रोजगार", revenue: "राजस्व", torture: "यातना",
  police: "प्रहरी", "mutual legal assistance": "पारस्परिक कानूनी सहायता", extradition: "सुपुर्दगी", "civil (reference)": "देवानी (सन्दर्भ)",
};
const ORDINALS = { "पहिलो": 1, "दोस्रो": 2, "तेस्रो": 3, "चौथो": 4, "पाँचौं": 5 };

addRoute("laws", /^\/laws$/, async (m, params) => {
  const { acts } = await lawsIndex();
  const q = (params.get("q") || "").trim();
  const cat = params.get("cat") || "";
  const core = acts.filter(a => a.area && a.sections);
  const cats = [...new Set(acts.map(a => a.category).filter(Boolean))];
  const list = acts.filter(a => (!cat || a.category === cat) && (!q || norm(a.title).includes(norm(q))));
  app.innerHTML = `<h1>कानून · Statutes</h1>
    <p class="sub">नेपाल कानून आयोग (lawcommission.gov.np) का आधिकारिक अद्यावधिक पाठ। फौजदारी न्यायसँग सम्बन्धित ${toDev(core.length)} कानून दफा-दफामा खोज्न मिल्ने गरी राखिएका छन्; बाँकी ${toDev(acts.length - core.length)} कानूनको सूची र मूल PDF लिंक।</p>
    <div class="toolbar"><input type="search" id="lq" placeholder="ऐनको नाम… वा दफा खोज्न ‘अनुसन्धान’ पृष्ठ प्रयोग गर्नुहोस्" value="${esc(q)}">
      <a class="btn ghost" href="#/research/statute">दफा / कसुर खोज्नुहोस् →</a></div>
    <h2 style="margin:10px 0">फौजदारी न्याय प्रणालीका मुख्य कानून · Core criminal-justice laws</h2>
    <div class="jgrid">${core.filter(a => !q || norm(a.title).includes(norm(q))).map(a => `<a class="jcard" href="#/law/${a.id}">
      <span class="t">${esc(AREA_NE[a.area] || a.area)}</span><h3>${esc(a.title)}</h3>
      <div class="nums"><span><b>${toDev(a.sections)}</b> दफा/धारा</span><span><b>${toDev(a.amendments)}</b> संशोधन</span><span><b>${toDev(a.cited)}</b> नजिरमा उद्धृत</span></div>
    </a>`).join("")}</div>
    <h2 style="margin:22px 0 10px">सबै कानूनको सूची · Full catalogue (${toDev(acts.length)})</h2>
    <div class="toolbar"><select id="lcat"><option value="">सबै खण्ड</option>${cats.map(c => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="bench"><div class="table-wrap"><table><thead><tr><th>ऐन</th><th>खण्ड</th><th>पाठ</th></tr></thead><tbody>
      ${list.map(a => `<tr><td>${a.sections ? `<a href="#/law/${a.id}">${esc(a.title)}</a>` : esc(a.title)}</td><td class="small">${esc(a.category || "")}</td>
        <td><a href="${esc(a.pdf)}" target="_blank" rel="noopener">PDF</a> · <a href="${esc(a.page)}" target="_blank" rel="noopener">आयोग</a></td></tr>`).join("")}
    </tbody></table></div></div>`;
  const nav = () => setHash("#/laws", { q: document.getElementById("lq").value.trim(), cat: document.getElementById("lcat").value });
  document.getElementById("lq").onchange = nav;
  document.getElementById("lcat").onchange = nav;
});

function amendmentsAfter(act, asof) {
  return (act.amendment_list || []).map((a, i) => ({ ...a, ordinal: i + 1 })).filter(a => a.date && a.date > asof);
}
function sectionFlag(sec, later, act) {
  // flag a section if its amendment markers mention an amendment that came after the chosen date
  if (!sec.amended_by || !later.length) return null;
  const hits = later.filter(a => {
    const yr = (a.title.match(/[०-९]{4}/g) || []).pop();
    if (yr && sec.amended_by.includes(yr)) return true;
    const ord = Object.entries(ORDINALS).find(([w]) => sec.amended_by.includes(w + " संशोधन"));
    if (ord) {
      // "दोस्रो संशोधनद्वारा" = the act's own 2nd amendment act
      const own = (act.amendment_list || []).filter(x => x.title.includes(act.title.split(",")[0]));
      return own[ord[1] - 1] && own[ord[1] - 1].title === a.title;
    }
    return false;
  });
  return hits.length ? hits : null;
}

addRoute("laws", /^\/law\/(\d+)$/, async (m, params) => {
  const id = +m[1];
  const act = await lawDoc(id);
  const asof = (params.get("asof") || "").trim();
  const sec = params.get("s") || "";
  const q = (params.get("q") || "").trim();
  const [nkp, jd] = await Promise.all([optional(getJSON("data/nkp/index.json")), optional(getJSON("data/judgments.json"))]);
  const nkpById = nkp ? Object.fromEntries(nkp.rows.map(r => [String(r[0]), r])) : {};
  const docById = jd ? Object.fromEntries(jd.docs.map(d => [d.id, d])) : {};
  const later = asof ? amendmentsAfter(act, toLat(asof)) : [];
  const before = asof && act.authenticated && toLat(asof) < act.authenticated;
  const terms = tokens(q);
  const secs = act.section_list.filter(s => !terms.length || terms.every(t => norm(s.heading + " " + s.body).includes(t)));
  const gaps = (act.gaps || "").split(",").filter(Boolean);

  const citedHTML = s => {
    if (!s.cited_by.length) return "";
    const items = s.cited_by.slice(0, 40).map(([t, i]) => {
      if (t === "nkp" && nkpById[i]) { const r = nkpById[i]; return `<li><a href="#/nkp/${i}">ने.का.प. ${toDev(r[2])}, नि.नं. ${toDev(r[1])} — ${esc(r[6])}</a></li>`; }
      if (t === "scdoc" && docById[i]) return `<li><a href="#/doc/${i}">${esc(docById[i].title.slice(0, 140))}</a></li>`;
      return "";
    }).join("");
    return `<details class="cited"><summary>यो ${id === 13437 ? "धारा" : "दफा"} उद्धृत गर्ने नजिर / आदेश: ${toDev(s.cited_by.length)}</summary><ul class="plain">${items}</ul>
      ${s.cited_by.length > 40 ? `<p class="small">पहिलो ४० मात्र देखाइएको।</p>` : ""}<p class="small">⚙️ पाठमा “${esc(act.title)} … दफा ${toDev(s.number)}” भनी उल्लेख भएका आधारमा स्वचालित पहिचान।</p></details>`;
  };

  let chapter = null;
  const body = secs.map(s => {
    const flag = sectionFlag(s, later, act);
    const head = s.chapter && s.chapter !== chapter ? (chapter = s.chapter, `<h3 class="chap">${esc(s.part ? s.part + " · " : "")}${esc(s.chapter)}</h3>`) : "";
    return `${head}<section class="sec ${flag ? "flagged" : ""}" id="s-${esc(s.number)}">
      <h4><a href="#/law/${id}?s=${encodeURIComponent(s.number)}">${id === 13437 ? "धारा" : "दफा"} ${toDev(s.number)}.</a> ${esc(s.heading)}</h4>
      ${flag ? `<p class="warn">⚠️ ${shortDate(asof)} पछि भएको संशोधन (${flag.map(a => esc(a.title)).join("; ")}) ले यो ${id === 13437 ? "धारा" : "दफा"} परिवर्तन गरेको देखिन्छ — त्यस मितिमा लागू पाठका लागि राजपत्र/संशोधन ऐन हेर्नुहोस्।</p>` : ""}
      <div class="sec-body">${terms.length ? highlight(s.body, terms, 100000) : esc(s.body)}</div>
      ${s.amended_by ? `<p class="small amend">✎ ${esc(s.amended_by)}</p>` : ""}
      ${citedHTML(s)}
    </section>`;
  }).join("");

  app.innerHTML = `<a class="back" href="#/laws">← सबै कानून</a>
    <h1>${esc(act.title)}</h1>
    <div class="doc-meta" style="margin:6px 0 12px">
      ${act.act_no ? `<span>${esc(act.act_no)}</span>` : ""}
      ${act.authenticated ? `<span>प्रमाणीकरण/लालमोहर: ${shortDate(act.authenticated)}</span>` : ""}
      ${act.category ? `<span>${esc(act.category)}</span>` : ""}
      <span>${toDev(act.sections)} ${id === 13437 ? "धारा" : "दफा"}</span>
    </div>
    ${act.commencement ? `<p class="small">प्रारम्भ: ${esc(act.commencement)}</p>` : ""}
    <p><a class="btn" href="${esc(act.pdf)}" target="_blank" rel="noopener">📄 कानून आयोगको आधिकारिक PDF</a> <a class="btn ghost" href="${esc(act.page)}" target="_blank" rel="noopener">आयोगको पृष्ठ ↗</a></p>
    ${act.amendment_list.length ? `<div class="panel"><h2>संशोधन इतिहास · Amendments</h2><ol>${act.amendment_list.map(a => `<li>${esc(a.title)}${a.date ? ` — <span class="small">${shortDate(a.date)}</span>` : ""}</li>`).join("")}</ol></div>` : ""}
    <div class="panel"><h2>कसुर भएको मितिमा लागू कानून · Law as on a date</h2>
      <p class="small">कसुर भएको मिति (वि.सं.) राख्नुहोस्। त्यसपछि भएका संशोधन र प्रभावित देखिएका दफा चिन्ह लगाइन्छ। कानून आयोगले हालको एकीकृत पाठ मात्र प्रकाशित गर्छ — पुरानो पाठ स्वतः बनाइँदैन।</p>
      <div class="toolbar"><input id="asof" placeholder="YYYY-MM-DD e.g. 2076-05-12" value="${esc(asof)}" style="max-width:220px"><button class="btn" id="asofBtn">जाँच्नुहोस्</button></div>
      ${asof ? (before ? `<p class="warn">⚠️ यो कानून ${shortDate(act.authenticated)} मा प्रमाणीकरण भएको हो — ${shortDate(asof)} मा यो लागू थिएन। त्यस बेलाको कानून (जस्तै मुलुकी ऐन वा अघिल्लो ऐन) हेर्नुहोस्।</p>`
        : later.length ? `<p class="warn">⚠️ ${shortDate(asof)} पछि ${toDev(later.length)} संशोधन: ${later.map(a => esc(a.title) + " (" + shortDate(a.date) + ")").join("; ")}। चिन्ह लगाइएका दफा जाँच्नुहोस्; संशोधन चिन्ह OCR बाट पढिएकाले सबै नभेटिन पनि सक्छ।</p>`
        : `<p class="ok">✓ ${shortDate(asof)} पछि कुनै संशोधन सूचीमा छैन — हालको पाठ लागू हुने देखिन्छ (सूची पूर्ण छ भनी PDF मा पुष्टि गर्नुहोस्)।</p>`) : ""}
    </div>
    <p class="warn">⚠️ दफाको पाठ PDF बाट OCR द्वारा निकालिएको हो; अदालतमा उद्धरण गर्नुअघि आधिकारिक PDF सँग मिलाउनुहोस्।${gaps.length ? ` यी ${id === 13437 ? "धारा" : "दफा"} छुट्टै पहिचान हुन सकेनन् (अघिल्लो दफाभित्र परेका हुन सक्छन्): ${gaps.map(toDev).join(", ")}।` : ""}</p>
    <div class="toolbar"><input type="search" id="sq" placeholder="यस ऐनभित्र खोज्नुहोस् (e.g. जरिवाना, थुना, म्याद)" value="${esc(q)}"></div>
    <div class="law-body">${body || `<p class="empty">केही भेटिएन।</p>`}</div>`;

  document.getElementById("asofBtn").onclick = () => setHash(`#/law/${id}`, { asof: document.getElementById("asof").value.trim(), q });
  document.getElementById("sq").onchange = e => setHash(`#/law/${id}`, { q: e.target.value.trim(), asof });
  if (sec) {
    const t = document.getElementById("s-" + sec);
    if (t) { t.scrollIntoView({ block: "start" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 2500); }
  }
});
