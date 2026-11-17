"use strict";
/* Public consultation: AI legal-information answers, lawyer directory, consultation requests,
   lawyer sign-up, and the site owner's admin page. */

const EXAMPLES = [
  "प्रहरीले पक्राउ गरेमा मेरा के के हक हुन्छन्?",
  "घरेलु हिंसा भएमा कहाँ उजुरी गर्ने?",
  "अंश मुद्दा कसरी हाल्ने?",
  "चोरीको अभियोग लागेमा कति सजाय हुन्छ?",
  "नागरिकता नपाएमा के गर्ने?",
  "What are my rights if I am arrested in Nepal?",
];
const AREAS = ["फौजदारी", "देवानी / जग्गा", "पारिवारिक / सम्बन्ध विच्छेद", "रिट / संवैधानिक", "भ्रष्टाचार", "बैंकिङ / वित्तीय", "श्रम / वैदेशिक रोजगार", "कम्पनी / व्यापार", "अन्य"];

async function serverCall(path, body) {
  const { ai_url } = await siteConfig();
  if (!ai_url) throw new Error("यो सुविधा अझै सेटअप भएको छैन।");
  const r = await fetch(ai_url + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `त्रुटि (${r.status})`);
  return j;
}

/* ---------------- ask a question ---------------- */
addRoute("consult", /^\/consult$/, async (m, params) => {
  const q = (params.get("q") || "").trim();
  const cfg = await siteConfig();
  app.innerHTML = `<section class="hero">
      <h1>कानूनी प्रश्न सोध्नुहोस्</h1>
      <p class="sub">नेपालको संविधान, ऐन–कानून र सर्वोच्च अदालतका नजिरका आधारमा सरल भाषामा जानकारी — स्रोतसहित। Ask in Nepali or English.</p>
      <textarea id="cq" rows="3" placeholder="आफ्नो प्रश्न यहाँ लेख्नुहोस्… (व्यक्तिगत विवरण, नाम वा फोन नम्बर नलेख्नुहोस्)">${esc(q)}</textarea>
      <div class="chips ex">${EXAMPLES.map(e => `<button class="chip" data-ex="${esc(e)}">${esc(e)}</button>`).join("")}</div>
      <p><button class="btn" id="cgo">सोध्नुहोस्</button> <a class="btn ghost" href="#/lawyers">वकिलसँग कुरा गर्नुहोस् →</a></p>
      ${cfg.ai_url ? "" : `<p class="warn small">AI उत्तर अझै सेटअप भएको छैन — तल सम्बन्धित कानून र नजिर मात्र देखाइन्छ।</p>`}
      <p class="small">⚖️ यो सामान्य कानूनी जानकारी हो, कानूनी सल्लाह होइन। पक्राउ, अदालतको म्याद वा हिंसाजस्ता गम्भीर विषयमा तुरुन्त वकिलसँग सम्पर्क गर्नुहोस्। खतरामा हुनुहुन्छ भने प्रहरी: <b>१००</b>। तपाईंको प्रश्न उत्तर बनाउन यस वेबसाइटको AI सेवा (Cloudflare Workers AI) मा पठाइन्छ।</p>
    </section>
    <div id="cans"></div>`;
  app.querySelectorAll("[data-ex]").forEach(b => b.onclick = () => setHash("#/consult", { q: b.dataset.ex }));
  document.getElementById("cgo").onclick = () => setHash("#/consult", { q: document.getElementById("cq").value.trim() });
  if (!q) return;
  const out = document.getElementById("cans");
  out.innerHTML = `<p class="loading">सम्बन्धित कानून र नजिर खोज्दै…</p>`;
  const sources = await retrieveSources(q, { bothLanguages: /[a-z]{3,}/i.test(q) });
  out.innerHTML = `<div class="panel answer"><h2>उत्तर</h2><div id="atext"><p class="loading">${cfg.ai_url ? "उत्तर लेखिँदैछ…" : ""}</p></div></div>
    <div class="panel"><h2>स्रोत · Sources</h2>${sourcesList(sources, false)}</div>
    <div class="panel cta"><h2>आफ्नो विषयमा वकिलको सल्लाह चाहिन्छ?</h2><p>सूचीकृत वकिलसँग सिधै सम्पर्क गर्नुहोस् वा सल्लाह माग फारम भर्नुहोस्।</p>
      <a class="btn" href="#/lawyers">वकिल खोज्नुहोस्</a></div>`;
  const at = document.getElementById("atext");
  if (!cfg.ai_url) { at.innerHTML = `<p class="small">AI उत्तर उपलब्ध छैन। माथिका स्रोत पढ्नुहोस् वा वकिलसँग सम्पर्क गर्नुहोस्।</p>`; return; }
  try {
    const r = await streamViaServer({ mode: "public", question: q, sources: sourcesPayload(sources) }, t => { at.innerHTML = renderAnswer(t, sources); });
    at.innerHTML = renderAnswer(r.text, sources) + (r.stop === "max_tokens" ? `<p class="small">(उत्तर लामो भएकाले बीचमै रोकियो)</p>` : "");
  } catch (e) {
    at.innerHTML = `<p class="warn">${esc(e.message)}</p>`;
  }
});

/* ---------------- lawyer directory + consultation request ---------------- */
function consultForm(lawyer) {
  return `<form class="panel cform" id="cform">
    <h2>${lawyer ? `${esc(lawyer.name)} सँग सल्लाह माग्नुहोस्` : "सल्लाह माग फारम"}</h2>
    <div class="two"><label class="fl">नाम<input name="name" required></label><label class="fl">फोन<input name="phone" inputmode="tel"></label></div>
    <div class="two"><label class="fl">इमेल<input name="email" type="email"></label><label class="fl">जिल्ला<input name="district"></label></div>
    <label class="fl">विषयको किसिम<select name="area">${AREAS.map(a => `<option>${a}</option>`).join("")}</select></label>
    <label class="fl">समस्याको संक्षिप्त विवरण<textarea name="description" rows="4" required></textarea></label>
    <label class="check"><input type="checkbox" name="consent" required> मेरो विवरण यो वेबसाइटका सञ्चालक र सम्बन्धित वकिलले मलाई सम्पर्क गर्न प्रयोग गर्न सक्छन्। (१८० दिनपछि स्वतः मेटिन्छ)</label>
    <input type="hidden" name="lawyer" value="${esc(lawyer ? lawyer.id : "")}">
    <p><button class="btn">पठाउनुहोस्</button></p><p class="small" id="cmsg"></p></form>`;
}
function wireConsultForm() {
  const f = document.getElementById("cform");
  if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    d.consent = !!f.consent.checked;
    const msg = document.getElementById("cmsg");
    try { await serverCall("/consult", d); f.innerHTML = `<p class="ok">✓ तपाईंको अनुरोध पठाइयो। वकिल वा सञ्चालकले चाँडै सम्पर्क गर्नेछन्।</p>`; }
    catch (err) { msg.textContent = err.message; }
  };
}

addRoute("consult-l", /^\/lawyers$/, async (m, params) => {
  const district = params.get("district") || "", area = params.get("area") || "";
  let lawyers = [], err = "";
  try { lawyers = (await serverCall("/lawyers")).lawyers || []; } catch (e) { err = e.message; }
  const list = lawyers.filter(l => (!district || (l.district || "").includes(district)) && (!area || (l.areas || "").includes(area)));
  const districts = [...new Set(lawyers.map(l => l.district).filter(Boolean))].sort();
  const wa = p => { const d = String(p || "").replace(/\D/g, ""); return d ? `https://wa.me/${d.length === 10 ? "977" + d : d}` : ""; };
  app.innerHTML = `<h1>वकिल खोज्नुहोस् · Find a lawyer</h1>
    <p class="sub">सूचीकृत कानून व्यवसायीसँग सिधै सम्पर्क गर्नुहोस् वा सल्लाह माग पठाउनुहोस्। वकिल हुनुहुन्छ? <a href="#/join">सूचीमा दर्ता हुनुहोस् →</a></p>
    ${err ? `<p class="warn">${esc(err)}</p>` : ""}
    <div class="toolbar">
      <select id="ld"><option value="">सबै जिल्ला</option>${districts.map(d => `<option ${d === district ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
      <select id="la"><option value="">सबै विषय</option>${AREAS.map(a => `<option ${a === area ? "selected" : ""}>${a}</option>`).join("")}</select>
    </div>
    <div class="jgrid">${list.map(l => `<div class="jcard">
      <span class="t">${esc(l.district || "")}${l.courts ? " · " + esc(l.courts) : ""}</span>
      <h3>${esc(l.name)}</h3>
      <p class="small">प्रमाणपत्र नं. ${esc(l.license)}${l.languages ? " · " + esc(l.languages) : ""}</p>
      ${l.areas ? `<p class="small"><b>विषय:</b> ${esc(l.areas)}</p>` : ""}
      ${l.bio ? `<p class="small">${esc(l.bio)}</p>` : ""}
      <div class="draft-actions">
        ${l.phone ? `<a class="btn ghost sm" href="tel:${esc(l.phone)}">📞 फोन</a><a class="btn ghost sm" href="${wa(l.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        ${l.email ? `<a class="btn ghost sm" href="mailto:${esc(l.email)}">✉ इमेल</a>` : ""}
        <button class="btn sm" data-ask="${esc(l.id)}">सल्लाह माग्नुहोस्</button>
      </div></div>`).join("") || `<p class="empty">${lawyers.length ? "यो फिल्टरमा वकिल भेटिएनन्।" : "अहिलेसम्म कुनै वकिल सूचीकृत छैनन्। तलको फारमबाट सल्लाह माग पठाउनुहोस्।"}</p>`}</div>
    <div id="cformwrap">${consultForm(null)}</div>
    <p class="small">वकिलको विवरण उनीहरू आफैंले दिएको हो; सञ्चालकले प्रमाणपत्र नम्बर हेरेर मात्र सूचीकृत गर्छन्। सम्झौता र शुल्क सम्बन्धित वकिलसँग हुन्छ।</p>`;
  const nav = () => setHash("#/lawyers", { district: document.getElementById("ld").value, area: document.getElementById("la").value });
  document.getElementById("ld").onchange = nav; document.getElementById("la").onchange = nav;
  app.querySelectorAll("[data-ask]").forEach(b => b.onclick = () => {
    document.getElementById("cformwrap").innerHTML = consultForm(lawyers.find(l => l.id === b.dataset.ask));
    wireConsultForm(); document.getElementById("cformwrap").scrollIntoView({ behavior: "smooth" });
  });
  wireConsultForm();
});

/* ---------------- lawyer sign-up ---------------- */
addRoute("consult-l", /^\/join$/, async () => {
  app.innerHTML = `<a class="back" href="#/lawyers">← वकिल सूची</a><h1>वकिलको रूपमा सूचीकृत हुनुहोस्</h1>
    <p class="sub">स्वीकृत भएपछि तपाईंको नाम सूचीमा देखिन्छ र तपाईंलाई <b>AI वकिल सहायक</b> प्रयोग गर्ने पहुँच कोड दिइन्छ।</p>
    <form class="panel" id="jform">
      <div class="two"><label class="fl">पूरा नाम<input name="name" required></label><label class="fl">कानून व्यवसायी प्रमाणपत्र नं.<input name="license" required></label></div>
      <div class="two"><label class="fl">फोन<input name="phone" inputmode="tel"></label><label class="fl">इमेल<input name="email" type="email"></label></div>
      <div class="two"><label class="fl">जिल्ला<input name="district"></label><label class="fl">अदालत (जस्तै: सर्वोच्च, उच्च पाटन)<input name="courts"></label></div>
      <label class="fl">विषय (अल्पविरामले छुट्याउनुहोस्)<input name="areas" placeholder="फौजदारी, देवानी / जग्गा"></label>
      <label class="fl">भाषा<input name="languages" placeholder="नेपाली, English, मैथिली"></label>
      <label class="fl">छोटो परिचय<textarea name="bio" rows="3"></textarea></label>
      <label class="check"><input type="checkbox" name="consent" required> मेरो नाम, प्रमाणपत्र नं., सम्पर्क, जिल्ला, विषय र परिचय सार्वजनिक सूचीमा देखाउन सहमत छु।</label>
      <p><button class="btn">पठाउनुहोस्</button></p><p class="small" id="jmsg"></p>
    </form>`;
  const f = document.getElementById("jform");
  f.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)); d.consent = !!f.consent.checked;
    try { await serverCall("/join", d); f.innerHTML = `<p class="ok">✓ आवेदन पठाइयो। सञ्चालकले प्रमाणपत्र जाँचेर स्वीकृत गरेपछि तपाईंलाई सम्पर्क गरिनेछ।</p>`; }
    catch (err) { document.getElementById("jmsg").textContent = err.message; }
  };
});

/* ---------------- owner admin ---------------- */
addRoute("consult", /^\/admin$/, async () => {
  let pw = "";
  try { pw = sessionStorage.getItem("nct-admin") || ""; } catch { /* ignore */ }
  const render = async () => {
    let data;
    try { data = await serverCall("/admin/list", { password: pw }); }
    catch (e) { try { sessionStorage.removeItem("nct-admin"); } catch { /* ignore */ } return login(e.message); }
    app.innerHTML = `<h1>सञ्चालक प्यानल · Admin</h1>
      <p class="sub">आज AI उत्तर: ${toDev(data.used_today)} / ${toDev(data.limit)}</p>
      <div class="panel"><h2>वकिल आवेदन (${toDev(data.joins.length)})</h2>${data.joins.map(j => `<div class="cand">
        <b>${esc(j.name)}</b> · प्रमाणपत्र ${esc(j.license)} · ${esc(j.district)} · ${esc(j.phone)} ${esc(j.email)}<br>
        <span class="small">${esc(j.areas)} — ${esc(j.bio)}</span><br>
        <button class="btn sm" data-approve="${esc(j.id)}">स्वीकृत गर्नुहोस्</button> <button class="btn ghost sm danger" data-del="join:${esc(j.id)}">मेटाउनुहोस्</button>
        <span class="code-out" id="code-${esc(j.id)}"></span></div>`).join("") || `<p class="small">छैन</p>`}
        <p class="small">⚠️ स्वीकृत गर्नुअघि नेपाल बार काउन्सिलमा प्रमाणपत्र नम्बर जाँच्नुहोस्।</p></div>
      <div class="panel"><h2>सल्लाह माग (${toDev(data.consults.length)})</h2>${data.consults.map(c => `<div class="cand">
        <b>${esc(c.name)}</b> · ${esc(c.phone)} ${esc(c.email)} · ${esc(c.district)} · ${esc(c.area)} ${c.lawyer ? `· वकिल: ${esc((data.lawyers.find(l => l.id === c.lawyer) || {}).name || c.lawyer)}` : ""}
        <span class="small">(${esc(c.at.slice(0, 16).replace("T", " "))})</span><br><span class="small">${esc(c.description)}</span><br>
        <button class="btn ghost sm" data-del="consult:${esc(c.id)}">समाधान भयो / मेटाउनुहोस्</button></div>`).join("") || `<p class="small">छैन</p>`}</div>
      <div class="panel"><h2>सूचीकृत वकिल (${toDev(data.lawyers.length)})</h2>${data.lawyers.map(l => `<div class="cand"><b>${esc(l.name)}</b> · ${esc(l.district)}
        <button class="btn ghost sm" data-code="${esc(l.id)}">नयाँ पहुँच कोड</button> <button class="btn ghost sm danger" data-rm="${esc(l.id)}">सूचीबाट हटाउनुहोस्</button>
        <span class="code-out" id="code-${esc(l.id)}"></span></div>`).join("") || `<p class="small">छैन</p>`}</div>`;
    const act = async (path, body, after) => { try { const r = await serverCall(path, { password: pw, ...body }); after ? after(r) : render(); } catch (e) { alert(e.message); } };
    app.querySelectorAll("[data-approve]").forEach(b => b.onclick = () => act("/admin/approve", { id: b.dataset.approve },
      r => { alert(`स्वीकृत भयो। वकिललाई यो पहुँच कोड पठाउनुहोस् (फेरि देखिँदैन):\n\n${r.access_code}`); render(); }));
    app.querySelectorAll("[data-del]").forEach(b => b.onclick = () => confirm("मेटाउने?") && act("/admin/delete", { key: b.dataset.del }));
    app.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => confirm("सूचीबाट हटाउने?") && act("/admin/remove-lawyer", { id: b.dataset.rm }));
    app.querySelectorAll("[data-code]").forEach(b => b.onclick = () => act("/admin/new-code", { id: b.dataset.code },
      r => { document.getElementById("code-" + b.dataset.code).textContent = " कोड: " + r.access_code; }));
  };
  const login = (msg) => {
    app.innerHTML = `<h1>सञ्चालक प्यानल</h1><form class="panel" id="af"><label class="fl">पासवर्ड<input type="password" id="apw" autocomplete="current-password"></label>
      <button class="btn">खोल्नुहोस्</button>${msg ? `<p class="warn small">${esc(msg)}</p>` : ""}</form>`;
    document.getElementById("af").onsubmit = e => { e.preventDefault(); pw = document.getElementById("apw").value; try { sessionStorage.setItem("nct-admin", pw); } catch { /* ignore */ } render(); };
  };
  pw ? render() : login("");
});
