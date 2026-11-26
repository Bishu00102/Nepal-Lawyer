"use strict";
/* Home page: a welcoming front door — search, today's numbers, and a card for every section.
   All numbers come from the published data files; nothing here is estimated. */

const SECTIONS = [
  { href: "#/day", icon: "i-cal", ne: "दैनिक नतिजा", en: "Daily results", d: "सर्वोच्च, उच्च र विशेष अदालतको आजको पेसी र नतिजा" },
  { href: "#/nkp", icon: "i-book", ne: "नजिर", en: "Precedents", d: "नेपाल कानून पत्रिकाका निर्णय, सिद्धान्तसहित" },
  { href: "#/judgments", icon: "i-gavel", ne: "फैसला / आदेश", en: "SC orders", d: "सर्वोच्च अदालतले प्रकाशित गरेका पूर्ण पाठ" },
  { href: "#/laws", icon: "i-scroll", ne: "कानून", en: "Statutes", d: "ऐन, संहिता — दफा र संशोधनसहित, मूल नेपाली पाठ" },
  { href: "#/constitutions", icon: "i-landmark", ne: "संविधान", en: "Constitutions", d: "२००४ देखि २०७२ सम्मका सबै संविधान, अंग्रेजीसहित" },
  { href: "#/judges", icon: "i-user", ne: "न्यायाधीश", en: "Judges", d: "इजलासमा सूचीकृत र निर्णित मुद्दाको गणना" },
  { href: "#/assistant", icon: "i-spark", ne: "AI सहायक", en: "AI assistant", d: "स्रोत-उद्धरणसहित अनुसन्धान र तयारी" },
  { href: "#/draft", icon: "i-pen", ne: "मस्यौदा", en: "Drafting", d: "बहस नोट, धरौटी निवेदन, पुनरावेदन — सम्पादनयोग्य" },
  { href: "#/research", icon: "i-compass", ne: "अनुसन्धान", en: "Research", d: "दफा र नजिर खोज्ने चरणबद्ध कार्यपत्र" },
  { href: "#/consult", icon: "i-chat", ne: "सल्लाह", en: "Ask a question", d: "आम नागरिकका लागि कानुनी जानकारी" },
  { href: "#/lawyers", icon: "i-users", ne: "वकिल", en: "Find a lawyer", d: "दर्ता भएका वकिल खोज्नुहोस्, परामर्श माग्नुहोस्" },
  { href: "#/search", icon: "i-search", ne: "खोज", en: "Search", d: "मुद्दा नं., पक्ष, विषय — सबै अदालतमा" },
];

const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

// count up from 0 so the numbers feel alive; respects reduced-motion
function countUp(root) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelectorAll("[data-n]").forEach(el => {
    const n = +el.dataset.n;
    if (still || !n) { el.textContent = toDev(n.toLocaleString("en-IN")); return; }
    const t0 = performance.now(), dur = 900;
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur), v = Math.round(n * (1 - Math.pow(1 - p, 3)));
      el.textContent = toDev(v.toLocaleString("en-IN"));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

addRoute("home", /^\/?$/, async () => {
  const [m, nkp, laws, jd, cons] = await Promise.all([
    optional(meta()), optional(getJSON("data/nkp/index.json")), optional(getJSON("data/statutes/index.json")),
    optional(getJSON("data/judgments.json")), optional(getJSON("data/constitutions.json"))]);

  // latest sitting day across courts, with its totals
  const courts = (m && m.courts) || [];
  const latest = courts.flatMap(c => c.days.slice(0, 1).map(d => d.date)).sort().pop() || "";
  const today = courts.map(c => ({ c, d: c.days.find(d => d.date === latest) })).filter(x => x.d && x.d.cases);
  const listed = today.reduce((a, x) => a + x.d.cases, 0);
  const decided = today.reduce((a, x) => a + x.d.decided, 0);
  const top = [...today].sort((a, b) => b.d.cases - a.d.cases).slice(0, 6);
  const maxCases = Math.max(1, ...top.map(x => x.d.cases));

  const stat = (n, ne, en) => n ? `<div class="hstat"><b data-n="${n}">${toDev(n)}</b><span>${ne}<small>${en}</small></span></div>` : "";

  app.innerHTML = `
  <section class="home-hero">
    <div class="hh-inner">
      <p class="eyebrow">${icon("i-scale", "ic sm")} नेपालका वकिलका लागि · For Nepal's lawyers</p>
      <h1>अदालत, कानून र नजिर —<br><span>एकै ठाउँमा, हरेक दिन अद्यावधिक</span></h1>
      <p class="lede">Daily court results, statutes and precedents from official sources. Every result links to its original.</p>
      <form class="hsearch" id="hsearch" role="search">
        ${icon("i-search")}
        <input type="search" id="hq" placeholder="मुद्दा नं., पक्षको नाम, कसुर वा दफा खोज्नुहोस्…" aria-label="खोज">
        <button class="btn gold" type="submit">खोज्नुहोस्</button>
      </form>
      <div class="hquick">
        <span>छिटो:</span>
        <a href="#/research/statute?q=${encodeURIComponent("धरौटी")}">धरौटी</a>
        <a href="#/research/statute?q=${encodeURIComponent("ज्यान")}">ज्यान सम्बन्धी</a>
        <a href="#/research/statute?q=${encodeURIComponent("लागु औषध")}">लागु औषध</a>
        <a href="#/research/statute?q=${encodeURIComponent("पुनरावेदन म्याद")}">पुनरावेदन म्याद</a>
      </div>
    </div>
    <div class="hstats">
      ${stat(listed, "पेसीमा मुद्दा", latest ? "listed · " + shortDate(latest) : "listed")}
      ${stat(decided, "फैसला / अन्तिम आदेश", "decided")}
      ${stat(nkp && nkp.rows.length, "नजिर", "precedents")}
      ${stat(laws && laws.acts.length, "ऐन / संहिता", "statutes")}
      ${stat(jd && jd.docs.length, "पूर्ण फैसला", "full judgments")}
      ${stat(cons && cons.constitutions.length, "संविधान", "constitutions")}
    </div>
  </section>

  ${top.length ? `<section class="home-today panel">
    <div class="ht-head">
      <div><span class="live"><i></i>ताजा</span><h2>${fmtDate(latest)} को पेसी</h2></div>
      <a class="btn ghost sm" href="#/day">सबै अदालत हेर्नुहोस् →</a>
    </div>
    <div class="ht-rows">${top.map(x => `
      <a class="ht-row" href="#/day/${x.c.code}/${x.d.date}">
        <span class="ht-name">${esc(x.c.name)}</span>
        <span class="ht-bar"><i style="width:${(x.d.cases / maxCases * 100).toFixed(1)}%"></i><i class="dec" style="width:${(x.d.decided / maxCases * 100).toFixed(1)}%"></i></span>
        <span class="ht-num">${toDev(x.d.cases)} <small>/ ${toDev(x.d.decided)} निर्णित</small></span>
      </a>`).join("")}
    </div>
    <p class="legend"><span><i style="background:var(--accent-soft)"></i>पेसीमा</span><span><i style="background:var(--gold)"></i>फैसला / अन्तिम आदेश</span></p>
  </section>` : ""}

  <section class="home-grid">
    ${SECTIONS.map((s, i) => `<a class="fcard" href="${s.href}" style="--i:${i}">
      <span class="fc-ic">${icon(s.icon)}</span>
      <span class="fc-t">${s.ne}<small>${s.en}</small></span>
      <span class="fc-d">${s.d}</span>
      <span class="fc-go" aria-hidden="true">→</span>
    </a>`).join("")}
  </section>

  <section class="trust">
    <div>${icon("i-shield")}<b>आधिकारिक स्रोत मात्र</b><span>सर्वोच्च अदालत, नेपाल कानून पत्रिका, कानून आयोग</span></div>
    <div>${icon("i-link")}<b>हरेक नतिजा मूल स्रोतसँग जोडिएको</b><span>उद्धरणअघि मूल फैसला हेर्नुहोस्</span></div>
    <div>${icon("i-clock")}<b>दिनमा ३ पटक अद्यावधिक</b><span>${m ? "अन्तिम: " + esc(m.updated_at) : "स्वचालित"}</span></div>
  </section>`;

  countUp(app);
  document.getElementById("hsearch").onsubmit = e => {
    e.preventDefault();
    const q = document.getElementById("hq").value.trim();
    location.hash = q ? `#/search?q=${encodeURIComponent(q)}` : "#/search";
  };
});
