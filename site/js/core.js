"use strict";
/* Nepal Court Tracker — shared helpers, data loading and router.
   Every view module registers itself with ROUTES. All data are static files in data/. */

const MONTHS = ["बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज", "कार्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत"];
const WEEKDAYS = { "१": "आइतबार", "२": "सोमबार", "३": "मंगलबार", "४": "बुधबार", "५": "बिहीबार", "६": "शुक्रबार", "७": "शनिबार" };
const DEV = "०१२३४५६७८९";
const toDev = s => String(s ?? "").replace(/[0-9]/g, d => DEV[d]);
const toLat = s => String(s ?? "").replace(/[०-९]/g, d => DEV.indexOf(d));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// normalise for matching: Latin digits, lower case, ignore zero-width joiners and common spelling variants
const norm = s => toLat(String(s ?? "")).toLowerCase().replace(/[‌‍]/g, "").replace(/ू/g, "ु").replace(/ी/g, "ि").replace(/ङ्ग/g, "ङ्ग");
const app = document.getElementById("app");

const DECIDED = new Set(["फैसला", "अन्तिम आदेश"]);
// "Criminal" (फौजदारी): case code CR (criminal appeal), RC (criminal review), WH (habeas corpus),
// a case marked थुनुवा (accused in custody), or a subject naming a criminal offence.
const CRIMINAL = new Set(["CR", "RC", "WH"]);
const CRIME_WORDS = /ज्यान|करणी|जालसाज|भ्रष्टाचार|घुस|रिसवत|लागु ?औषध|लागूऔषध|बेचबिखन|ओसारपसार|कसु[रू]|कसूर|चोरी|डाँका|डाका|अपहरण|शरीर बन्धक|ठगी|बहुविवाह|वहुविवाह|बालविवाह|हातहतियार|खरखजाना|शुद्धीकरण|किर्ते|कीर्ते|सवारी ज्यान|कुटपिट|अंगभंग|आगजनी|बन्दीप्रत्यक्षीकरण|गाली बेइज्जती|गर्भपतन|साइबर|विद्युतीय कारोबार|सङ्गठित अपराध|संगठित अपराध/;
const isCriminal = c => CRIMINAL.has(c.case_type) || /थुनुवा/.test(c.remarks || "") || CRIME_WORDS.test(c.subject || "");

const OUTCOME_KINDS = [
  { key: "partly", label: "आंशिक (partly allowed / reversed)", test: o => /केही उल्टी|केही सदर|आंशिक|आशिक|खारेज.*जारी/.test(o), color: "var(--mix)", cls: "mix" },
  { key: "upheld", label: "सदर (upheld)", test: o => /सदर|जिकिर नपुग्ने|संशोधन नहुने/.test(o), color: "var(--accent)", cls: "decided" },
  { key: "reversed", label: "उल्टी / बदर (reversed)", test: o => /उल्टी|बदर/.test(o), color: "var(--loss)", cls: "loss" },
  { key: "leaveNo", label: "अनुमति नहुने (leave refused)", test: o => /अनुमति नहुने/.test(o), color: "var(--leave-no)", cls: "leaveno" },
  { key: "leaveYes", label: "अनुमति हुने (leave granted)", test: o => /अनुमति हुने/.test(o), color: "var(--leave)", cls: "leave" },
  { key: "dismissed", label: "खारेज / नहुने (dismissed)", test: o => /खारेज|नहुने|लगत कट्टा|तामेली/.test(o), color: "var(--crim)", cls: "crim" },
  { key: "issued", label: "जारी / मागबमोजिम (granted)", test: o => /जारी|मागबमोजिम हुने|संशोधन हुने/.test(o), color: "var(--win)", cls: "win" },
  { key: "other", label: "अन्य (other)", test: () => true, color: "var(--muted)", cls: "" },
];
const outcomeKind = o => OUTCOME_KINDS.find(k => k.test(o || ""));

function fmtDate(bs, weekday) {
  if (!bs) return "";
  const [y, m, d] = bs.split("-");
  const wd = WEEKDAYS[weekday] ? `, ${WEEKDAYS[weekday]}` : "";
  return `${toDev(y)} ${MONTHS[+m - 1] || m} ${toDev(+d)}${wd}`;
}
const shortDate = bs => bs ? toDev(bs.replaceAll("-", "/")) : "";

/* ------------------------------------------------------------------ data */
const cache = {};
function getJSON(path) {
  if (!cache[path]) cache[path] = fetch(path, { cache: "no-cache" }).then(r => {
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  });
  return cache[path];
}
// gzip-compressed JSON (large Nepali texts): decompressed in the browser
function getGz(path) {
  if (!cache[path]) cache[path] = fetch(path, { cache: "no-cache" }).then(async r => {
    if (!r.ok) throw new Error(path + " " + r.status);
    const enc = r.headers.get("content-encoding");
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // some servers already decode gzip transparently; only decompress if the gzip magic bytes are present
    if (bytes[0] === 0x1f && bytes[1] === 0x8b && enc !== "gzip") {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  });
  return cache[path];
}
const meta = () => getJSON("data/meta.json");
const optional = p => p.catch(() => null);

/* ------------------------------------------------------------------ router */
const ROUTES = [];           // [{ tab, match: /regex/, view: (m, params) => Promise }]
function addRoute(tab, re, view) { ROUTES.push({ tab, re, view }); }

function route() {
  const h = location.hash.slice(1) || "/";
  const [rawPath, qs] = h.split("?");
  const path = decodeURIComponent(rawPath);
  const params = new URLSearchParams(qs || "");
  const r = ROUTES.find(x => x.re.test(path)) || ROUTES[0];
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === r.tab));
  app.innerHTML = `<p class="loading">लोड हुँदैछ…</p>`;
  window.scrollTo(0, 0);
  Promise.resolve(r.view(path.match(r.re), params)).catch(err => {
    console.error(err);
    app.innerHTML = `<p class="empty">डाटा लोड गर्न सकिएन। (${esc(err.message)})</p>`;
  });
}
window.addEventListener("hashchange", route);
function setHash(path, params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, v === true ? "1" : v); });
  location.hash = path + (p.toString() ? "?" + p : "");
}

/* ------------------------------------------------------------------ shared rendering */
function paged(el, rows, render, size = 50) {
  let n = size;
  const draw = () => {
    el.innerHTML = rows.length ? render(rows.slice(0, n)) : `<p class="empty">कुनै नतिजा छैन।</p>`;
    if (rows.length > n) {
      const b = document.createElement("button");
      b.className = "more"; b.textContent = `थप हेर्नुहोस् (${toDev(rows.length - n)} बाँकी)`;
      b.onclick = () => { n += size; draw(); };
      el.appendChild(b);
    }
  };
  draw();
}

function highlight(text, terms, max = 260) {
  const t = String(text || "");
  const nt = norm(t);
  let i = -1;
  for (const x of terms) { const k = nt.indexOf(x); if (k >= 0 && (i < 0 || k < i)) i = k; }
  let out = i < 0 ? t.slice(0, max) : t.slice(Math.max(0, i - 80), i + max - 80);
  out = esc(out);
  // mark whole syllables: include trailing vowel signs / virama so a word is never split before a matra
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  terms.forEach(x => {
    if (x && x.length > 1) out = out.replace(new RegExp(reEsc(esc(x)) + "[\\u0900-\\u0903\\u093A-\\u094F\\u0962\\u0963]*", "g"), m => `<mark>${m}</mark>`);
  });
  return (i > 80 ? "…" : "") + out + (t.length > max ? "…" : "");
}

// tokenise a query for ranked search: drop very common Nepali function words
const STOP = new Set("र वा को का की मा ले लाई बाट देखि सम्म पनि नै हो छ भएको गरेको गर्ने हुने भन्ने यो त्यो सो उक्त समेत तथा एवं एवम् लागि गरी भई".split(" "));
const tokens = q => norm(q).split(/[\s,।.;:()\[\]"'“”‘’!?/\\-]+/).filter(w => w.length > 1 && !STOP.has(w));

function scoreText(text, terms) {
  const t = norm(text);
  let s = 0;
  for (const x of terms) {
    let k = t.indexOf(x), c = 0;
    while (k >= 0 && c < 5) { c++; k = t.indexOf(x, k + x.length); }
    if (c) s += 1 + Math.log(c) + x.length / 10;
  }
  return s;
}

function lawLink(c) {
  // c: {type, act, sec, nkp, label}
  if ((c.type === "section" || c.type === "article") && c.act) {
    const base = (String(c.sec || "").match(/^\d+[क-ह]?/) || [""])[0];
    return `<a href="#/law/${c.act}?s=${encodeURIComponent(base)}">${esc(c.label)}</a>`;
  }
  if (c.type === "nkp" && c.nkp) return `<a href="#/nkp/${c.nkp}">${esc(c.label)}</a>`;
  return `<span title="यो कानून/संस्करण डाटाबेसमा छैन">${esc(c.label)}</span>`;
}

function citesBlock(cites, title = "उद्धृत कानून र नजिर · Cited law & precedents") {
  if (!cites || !cites.length) return "";
  const groups = {
    section: "ऐन / संहिताका दफा", article: "संविधान (२०७२) का धारा", nkp: "नजिर (ने.का.प.)",
    old_constitution: "पुराना संविधान", other_act: "अन्य/पुराना ऐन", muluki_ain: "मुलुकी ऐन (खारेज)",
  };
  const by = {};
  cites.forEach(c => (by[c.type] ||= []).push(c));
  return `<div class="panel"><h2>${title}</h2>
    <p class="small">⚙️ पाठबाट स्वचालित रूपमा पहिचान गरिएको (auto-detected from the text) — प्रयोग गर्नुअघि मूल पाठमा पुष्टि गर्नुहोस्।</p>
    ${Object.entries(groups).filter(([k]) => by[k]).map(([k, label]) =>
      `<div class="cite-group"><b>${label}</b><div>${by[k].map(lawLink).join(" · ")}</div></div>`).join("")}
  </div>`;
}

function ocrWarning(method) {
  return method === "ocr" ? `<p class="warn">⚠️ यो पाठ स्क्यान गरिएको PDF बाट OCR (मेसिन पढाइ) द्वारा निकालिएको हो — गल्ती हुन सक्छ। उद्धरण गर्नुअघि मूल PDF हेर्नुहोस्। Machine-read text; quote only from the original.</p>` : "";
}

function boot() {
  meta().then(m => {
    document.getElementById("updated").textContent = `अन्तिम अद्यावधिक · Last updated: ${m.updated_at}`;
  }).catch(() => {});
  Promise.all((window.BOOT || []).map(f => optional(Promise.resolve(f())))).finally(route);
}
