"use strict";
/* AI lawyer assistant: multi-turn research and case preparation for advocates.
   Uses either the site's AI server (with the lawyer's access code from the owner) or the lawyer's own
   Anthropic API key. Case facts stay in this browser except when a question is sent. */

const ASSIST_KEY = "nct-assistant-v1";
const LAWYER_SYSTEM_LOCAL = `You are a legal research and drafting assistant working for a licensed advocate in Nepal, inside a law-research website. The advocate reviews and takes responsibility for everything you produce.

Rules:
1. Write in the language the advocate uses (formal Nepali legal register in Devanagari by default).
2. Legal authority: rely only on the sources inside <sources> (Constitution of Nepal, Acts, Nepal Kanoon Patrika headnotes). Cite them with their ids, e.g. [L3], [P2]. Do not cite, name or rely on any other Act, section, decision or case number; if one is needed, write [वकिलले थप्नुहोस्: …] describing what to look for.
3. Attribute to a precedent only what its quoted headnote says. Never present your own analysis as a holding of the court.
4. Facts: use only the case facts provided. Never invent names, dates, evidence or statements; mark gaps as [तथ्य पुष्टि गर्नुहोस्: …].
5. Be useful like a senior colleague: identify issues, strengths and weaknesses for both sides, procedural points, evidence gaps, and practical next steps. Flag conflicting authorities and points that need verification (e.g. whether the law applied on the date of the offence).
6. Output is ready to use: headings with "## ", numbered paragraphs, no Markdown tables.`;

const TASKS = [
  ["strategy", "मुद्दाको रणनीति", "यो मुद्दाको समग्र रणनीति बनाउनुहोस्: मुख्य कानूनी र तथ्यगत प्रश्न, हाम्रो पक्षका बलिया र कमजोर पक्ष, विपक्षीका सम्भावित तर्क र जवाफ, आवश्यक थप प्रमाण, र अबका कदम।"],
  ["defence", "प्रतिरक्षाका आधार", "उपलब्ध तथ्य र स्रोतका आधारमा सम्भावित प्रतिरक्षाका आधारहरू क्रमबद्ध गर्नुहोस्: कसुरका तत्व पुष्टि नहुने ठाउँ, प्रमाणको कमजोरी, कार्यविधिगत त्रुटि, र प्रत्येकका लागि उपयुक्त स्रोत।"],
  ["prosecution", "अभियोजनको मूल्याङ्कन", "अभियोजन/वादी पक्षको दाबीको मूल्याङ्कन गर्नुहोस्: कसुरका प्रत्येक तत्व कुन प्रमाणले पुष्टि हुन खोजेको छ, कहाँ खाली ठाउँ छ, र जोखिम कति छ।"],
  ["procedure", "कार्यविधिगत त्रुटि", "पक्राउ, थुना, अनुसन्धान, बयान, खानतलासी, अभियोग पत्र र म्यादसम्बन्धी सम्भावित कार्यविधिगत त्रुटि र तिनको कानूनी असर पहिचान गर्नुहोस्।"],
  ["bail", "थुनछेक / धरौटी अनुसन्धान", "थुनछेक/धरौटी सम्बन्धमा लागू कानूनी व्यवस्था, सान्दर्भिक नजिर, र यस मुद्दामा धरौटी/जमानत माग्ने आधार तयार गर्नुहोस्।"],
  ["hearing", "सुनुवाइ तयारी", "सुनुवाइका लागि तयारी: कानूनी र तथ्यगत प्रश्न, बहसको क्रम, बाध्यकारी र प्रेरक नजिर, इजलासले सोध्न सक्ने प्रश्न र प्रस्तावित जवाफ।"],
  ["cross", "जिरह योजना", "प्रमुख साक्षीहरूको जिरह योजना: प्रत्येक साक्षीबाट स्थापित गर्नुपर्ने कुरा, छोटा नेतृत्व गर्ने प्रश्नहरू, र अघिल्लो बयानसँगको विरोधाभास।"],
  ["evidence", "प्रमाण विश्लेषण", "प्रमाण तालिका बनाउनुहोस्: प्रत्येक प्रमाण, कुन तथ्य पुष्टि गर्छ, ग्राह्यता र विश्वसनीयताका प्रश्न, र नपुगेका कागजात।"],
];

function loadAssist() { try { return { history: [], caseText: "", mode: "code", code: "", names: "", ...JSON.parse(localStorage.getItem(ASSIST_KEY) || "{}") }; } catch { return { history: [], caseText: "", mode: "code", code: "", names: "" }; } }
function saveAssist(a) { try { localStorage.setItem(ASSIST_KEY, JSON.stringify(a)); } catch { /* ignore */ } }

function caseFromDraft() {
  const d = loadDraft();
  return [d.court && "अदालत: " + d.court, d.offence && "मुद्दा: " + d.offence, d.case_no && "मुद्दा नं.: " + d.case_no,
    d.side && "हामी: " + d.side + " तर्फबाट", d.appellant && "पक्ष: " + d.appellant, d.respondent && "विपक्ष: " + d.respondent,
    d.offence_date && "कसुर मिति: " + d.offence_date, d.facts && "तथ्य:\n" + d.facts, d.points && "हाम्रा तर्क:\n" + d.points]
    .filter(Boolean).join("\n");
}

addRoute("assistant", /^\/assistant$/, async () => {
  const s = loadAssist();
  const cfg = await siteConfig();
  let ownKey = ""; try { ownKey = localStorage.getItem(KEYSTORE) || ""; } catch { /* ignore */ }
  app.innerHTML = `<h1>AI वकिल सहायक · AI legal assistant</h1>
    <p class="sub">मुद्दाको अनुसन्धान, रणनीति, प्रतिरक्षा, सुनुवाइ र जिरह तयारी — संविधान, ऐन र ने.का.प. नजिरमा आधारित, स्रोतसहित। मस्यौदा चाहिए <a href="#/draft">मस्यौदा पृष्ठ</a> प्रयोग गर्नुहोस्।</p>
    <div class="draft-grid">
      <div class="panel">
        <h2>मुद्दाको विवरण · Case</h2>
        <textarea id="acase" rows="9" placeholder="मुद्दाको तथ्य, कसुर, मिति, प्रमाण, अहिलेसम्मको अवस्था…">${esc(s.caseText)}</textarea>
        <p><button class="btn ghost sm" id="afromdraft">मस्यौदा फारमबाट ल्याउनुहोस्</button> <button class="btn ghost sm danger" id="aclear">कुराकानी मेटाउनुहोस्</button></p>
        <label class="fl">पठाउनुअघि लुकाउने नामहरू (अल्पविरामले छुट्याउनुहोस्)<input id="anames" value="${esc(s.names)}" placeholder="जस्तै: हरि थापा, राम थापा"></label>
      </div>
      <div class="panel">
        <h2>AI पहुँच · Access</h2>
        <label class="check"><input type="radio" name="amode" value="code" ${s.mode === "code" ? "checked" : ""} ${cfg.ai_url ? "" : "disabled"}> वेबसाइटको AI — वकिल पहुँच कोड (सञ्चालकबाट)</label>
        <input id="acode" class="fl-in" placeholder="पहुँच कोड" value="${esc(s.code)}">
        <label class="check"><input type="radio" name="amode" value="key" ${s.mode === "key" || !cfg.ai_url ? "checked" : ""}> मेरो आफ्नै Anthropic API key</label>
        <input id="akey" class="fl-in" type="password" placeholder="sk-ant-…" value="${esc(ownKey)}" autocomplete="off">
        <p class="small">${cfg.ai_url ? "" : "वेबसाइटको AI सर्भर अझै सेटअप भएको छैन — आफ्नै key प्रयोग गर्नुहोस्। "}पहुँच कोड पाउन <a href="#/join">वकिलको रूपमा दर्ता हुनुहोस्</a>।</p>
        <label class="check"><input type="checkbox" id="aconsent"> मुद्दाको विवरण Anthropic (Claude) मा पठाउन मलाई अनुमति छ (ग्राहकको गोपनीयता दायित्व मैले जाँचेको छु)।</label>
      </div>
    </div>
    <div class="chips tasks">${TASKS.map(([k, l]) => `<button class="chip" data-task="${k}">${l}</button>`).join("")}</div>
    <div id="achat" class="chat">${s.history.map(h => h.role === "user"
      ? `<div class="msg me">${esc(h.display || h.content)}</div>`
      : `<div class="msg ai">${renderAnswer(h.content, h.sources || [])}</div>`).join("")}</div>
    <div class="ask-row"><textarea id="aq" rows="2" placeholder="प्रश्न वा निर्देशन लेख्नुहोस्… (जस्तै: दफा २४२ अन्तर्गत बरामदी प्रमाण कमजोर भएमा के तर्क गर्न सकिन्छ?)"></textarea>
      <button class="btn ai" id="asend">पठाउनुहोस्</button></div>
    <p class="small">⚖️ AI ले दिएको उत्तर सहयोग मात्र हो — प्रत्येक उद्धरण मूल स्रोतमा जाँच्नुहोस्। दिइएका स्रोतबाहिरका दफा/नजिर रातो चिन्हले देखाइन्छ। रातो <mark class="bad">L9</mark> = दिइएको स्रोत होइन।</p>`;

  const persist = () => {
    s.caseText = document.getElementById("acase").value; s.names = document.getElementById("anames").value;
    s.code = document.getElementById("acode").value.trim();
    s.mode = (app.querySelector("[name=amode]:checked") || {}).value || "key";
    saveAssist(s);
    try { const k = document.getElementById("akey").value.trim(); if (k) localStorage.setItem(KEYSTORE, k); } catch { /* ignore */ }
  };
  ["acase", "anames", "acode", "akey"].forEach(i => document.getElementById(i).onchange = persist);
  app.querySelectorAll("[name=amode]").forEach(r => r.onchange = persist);
  document.getElementById("afromdraft").onclick = () => { document.getElementById("acase").value = caseFromDraft(); persist(); };
  document.getElementById("aclear").onclick = () => { if (confirm("कुराकानी मेटाउने?")) { s.history = []; saveAssist(s); route(); } };

  const chat = document.getElementById("achat");
  const send = async (question, display) => {
    persist();
    if (!document.getElementById("aconsent").checked) { alert("पहिले सहमति बाकस छान्नुहोस्।"); return; }
    if (s.mode === "code" && !s.code) { alert("पहुँच कोड लेख्नुहोस् वा आफ्नै API key छान्नुहोस्।"); return; }
    const key = document.getElementById("akey").value.trim();
    if (s.mode === "key" && !key.startsWith("sk-")) { alert("आफ्नो Anthropic API key लेख्नुहोस्।"); return; }
    // hide names before anything leaves the browser; restore them in the reply
    const names = s.names.split(/[,،\n]/).map(x => x.trim()).filter(x => x.length > 2).sort((a, b) => b.length - a.length);
    const hide = t => names.reduce((x, n, i) => x.split(n).join(`[व्यक्ति-${toDev(i + 1)}]`), String(t || ""));
    const show = t => names.reduce((x, n, i) => x.split(`[व्यक्ति-${toDev(i + 1)}]`).join(n), String(t || ""));

    chat.insertAdjacentHTML("beforeend", `<div class="msg me">${esc(display || question)}</div><div class="msg ai"><p class="loading">स्रोत खोज्दै…</p></div>`);
    const box = chat.lastElementChild;
    box.scrollIntoView({ behavior: "smooth", block: "end" });
    const sources = await retrieveSources(question + " " + s.caseText.slice(0, 600), { criminal: true, sections: 8, precedents: 8, constitution: 3 });
    box.innerHTML = `<p class="loading">लेखिँदैछ…</p>`;
    const history = s.history.slice(-8).map(h => ({ role: h.role, content: hide(h.content) }));
    const onText = t => { box.innerHTML = renderAnswer(show(t), sources); };
    try {
      let r;
      if (s.mode === "code") {
        r = await streamViaServer({ mode: "lawyer", code: s.code, question: hide(question), case: hide(s.caseText),
          sources: sourcesPayload(sources), history }, onText);
      } else {
        const user = `<case>\n${hide(s.caseText) || "(दिइएको छैन)"}\n</case>\n\n<sources>\n${sourcesXML(sources)}\n</sources>\n\nAdvocate's request: ${hide(question)}`;
        r = await streamWithOwnKey(key, LAWYER_SYSTEM_LOCAL, [...history, { role: "user", content: user }], onText);
      }
      const text = show(r.text);
      box.innerHTML = renderAnswer(text, sources) + `<details class="srcbox"><summary>प्रयोग भएका स्रोत (${toDev(sources.length)})</summary>${sourcesList(sources, true)}</details>`
        + (r.stop === "max_tokens" ? `<p class="small">(लामो भएकाले बीचमै रोकियो — “जारी राख्नुहोस्” लेख्नुहोस्)</p>` : "");
      wireDraftButtons(box, sources);
      s.history.push({ role: "user", content: question, display },
        { role: "assistant", content: text, sources: sources.map(({ id, label, href }) => ({ id, label, href })) });
      s.history = s.history.slice(-20);
      saveAssist(s);
    } catch (e) {
      box.innerHTML = `<p class="warn">${esc(e.message)}</p>`;
    }
  };
  document.getElementById("asend").onclick = () => {
    const q = document.getElementById("aq").value.trim();
    if (q) { document.getElementById("aq").value = ""; send(q); }
  };
  app.querySelectorAll("[data-task]").forEach(b => b.onclick = () => {
    const t = TASKS.find(x => x[0] === b.dataset.task);
    send(t[2], "🗂 " + t[1]);
  });
});
