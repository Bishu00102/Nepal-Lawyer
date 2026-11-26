"use strict";
/* Daily cause lists & results (Supreme Court, High Courts), judges. */

const dayData = (court, d) => getJSON(`data/days/${court}/${d}.json`);
const courtSearch = court => getJSON(`data/search/${court}.json`);
const courtName = (m, code) => (m.courts.find(c => c.code === code) || {}).name || code;
let DOCS_BY_CASE = {};

window.BOOT = (window.BOOT || []).concat(() => getJSON("data/judgments.json").then(j => {
  DOCS_BY_CASE = {};
  j.docs.forEach(d => { if (d.case_no) (DOCS_BY_CASE[d.case_no] ||= []).push(d); });
}));

const docLink = c => {
  const ds = DOCS_BY_CASE[c.case_no];
  return ds ? ` <a class="badge doc" href="#/doc/${ds[0].id}" title="सर्वोच्च अदालतले प्रकाशित गरेको ${esc(ds[0].kind)}">📜 प्रकाशित</a>` : "";
};

function statusBadge(c) {
  return DECIDED.has(c.status) ? `<span class="badge decided">${esc(c.status)}</span>` : `<span class="badge">${esc(c.status || "—")}</span>`;
}
function outcomeBadge(c) {
  if (!c.outcome) return "";
  const k = DECIDED.has(c.status) ? outcomeKind(c.outcome) : null;
  return `<span class="badge ${k ? k.cls : ""}">${esc(c.outcome)}</span>`;
}

function casesTable(rows, opts = {}) {
  return `<div class="table-wrap"><table class="cases"><thead><tr>
    ${opts.date ? "<th>मिति</th>" : "<th>क.स.</th>"}<th>मुद्दा नं.</th><th>मुद्दा</th><th>पक्ष / विपक्ष</th><th>कैफियत</th><th>स्थिति</th><th>नतिजा</th></tr></thead><tbody>
    ${rows.map(c => `<tr class="${c.serial || opts.date ? "" : "linked"}">
      ${opts.date ? `<td data-l="मिति"><a href="#/day/${c.court}/${c.date}">${shortDate(c.date)}</a>${opts.courtLabel ? `<div class="small">${esc(opts.courtLabel(c))}</div>` : ""}</td>`
        : `<td data-l="क.स.">${esc(c.serial) || `<span class="small" title="लगाउ (linked case)">लगाउ</span>`}</td>`}
      <td class="case" data-l="मुद्दा नं.">${c.case_url ? `<a href="${esc(c.case_url)}" target="_blank" rel="noopener">${esc(c.case_no)}</a>` : esc(c.case_no)}
        ${isCriminal(c) ? ` <span class="badge crim" title="फौजदारी / criminal">फौ.</span>` : ""}${docLink(c)}</td>
      <td data-l="मुद्दा">${esc(c.subject)}</td>
      <td class="parties" data-l="पक्ष">${esc(c.appellant)}${c.respondent ? `<span class="vs">विरुद्ध</span>${esc(c.respondent)}` : ""}
        ${opts.judges ? `<div class="small">${opts.judges(c)}</div>` : ""}</td>
      <td data-l="कैफियत"><span class="small">${esc(c.remarks)}</span></td>
      <td data-l="स्थिति">${statusBadge(c)}</td>
      <td data-l="नतिजा">${outcomeBadge(c)} ${c.pdf_url ? `<a class="pdf" href="${esc(c.pdf_url)}" target="_blank" rel="noopener">📄 आदेश PDF</a>` : ""}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

function rowObj(r, court) {
  const [date, bench, case_no, subject, appellant, respondent, status, outcome, pdf_url, remarks, case_id, case_url] = r;
  const m = /^\d{3}-([A-Z]{2})-/.exec(case_no || "");
  return { court, date, bench, case_no, subject, appellant, respondent, status, outcome, pdf_url, remarks, case_id, case_url, case_type: m ? m[1] : "" };
}

/* ---------------- daily view */
addRoute("day", /^\/day(?:\/([A-Z0-9]+)(?:\/([\d-]+))?)?$/, async (m, params) => {
  const md = await meta();
  if (!md.courts.length) { app.innerHTML = `<p class="empty">अहिलेसम्म कुनै डाटा छैन।</p>`; return; }
  const court = (m && m[1]) || "SC";
  const ci = md.courts.find(c => c.code === court) || md.courts[0];
  const date = (m && m[2]) || ci.days[0].date;
  const info = ci.days.find(d => d.date === date) || { date, weekday: "" };
  const data = await dayData(ci.code, date);
  const filter = params.get("f") || "all";
  const q = (params.get("q") || "").trim();

  const all = data.benches.flatMap(b => b.cases);
  const decided = all.filter(c => DECIDED.has(c.status)).length;
  const adjourned = all.filter(c => /स्थगी?त/.test(c.status)).length;
  const crim = all.filter(isCriminal).length;
  const notHeard = all.filter(c => /हेर्न न/.test(c.status)).length;

  const courtOpts = md.courts.map(c => `<option value="${c.code}" ${c.code === ci.code ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const dateOpts = ci.days.map(d => `<option value="${d.date}" ${d.date === date ? "selected" : ""}>${fmtDate(d.date, d.weekday)} — ${toDev(d.decided)} फैसला</option>`).join("");
  const chip = (k, label) => `<button class="chip ${filter === k ? "on" : ""}" data-f="${k}">${label}</button>`;
  const keep = c => {
    if (filter === "decided" && !DECIDED.has(c.status)) return false;
    if (filter === "criminal" && !isCriminal(c)) return false;
    if (filter === "custody" && !/थुनुवा/.test(c.remarks)) return false;
    if (q && !norm(`${c.case_no} ${c.subject} ${c.appellant} ${c.respondent} ${c.outcome}`).includes(norm(q))) return false;
    return true;
  };
  const benchesHTML = data.benches.map(b => {
    const rows = b.cases.filter(keep).map(c => ({ ...c, court: ci.code }));
    if (!rows.length) return "";
    return `<section class="bench">
      <div class="bench-head">
        <div>
          <div><span class="no">इजलास नं. ${esc(b.no)}</span> · <span class="type">${esc(b.type)}</span></div>
          <div class="judges-line">${b.judges.map(j => `<a href="#/judge/${ci.code}/${encodeURIComponent(j)}">मा. ${esc(j)}</a>`).join(" · ")}</div>
        </div>
        <div class="bench-count">${toDev(rows.length)} / ${toDev(b.cases.length)} मुद्दा</div>
      </div>
      ${casesTable(rows)}
    </section>`;
  }).join("");

  app.innerHTML = `
    <h1>${esc(ci.name)} — ${fmtDate(date, info.weekday)}</h1>
    <p class="sub">दैनिक पेसी र नतिजा · Daily cause list &amp; results</p>
    <div class="stats">
      <div class="stat"><b>${toDev(all.length)}</b><span>पेसीमा मुद्दा · listed</span></div>
      <div class="stat"><b>${toDev(decided)}</b><span>फैसला / अन्तिम आदेश · decided</span></div>
      <div class="stat"><b>${toDev(adjourned)}</b><span>स्थगित · adjourned</span></div>
      <div class="stat"><b>${toDev(notHeard)}</b><span>हेर्न नभ्याइने / नमिल्ने · not reached</span></div>
      <div class="stat"><b>${toDev(crim)}</b><span>फौजदारी · criminal</span></div>
    </div>
    <div class="toolbar">
      <select id="courtPick" aria-label="अदालत">${courtOpts}</select>
      <select id="datePick" aria-label="मिति">${dateOpts}</select>
      <input type="search" id="dayQ" placeholder="मुद्दा नं, पक्ष, विषय…" value="${esc(q)}">
    </div>
    <div class="chips">${chip("all", "सबै · All")}${chip("decided", "फैसला मात्र · Decided")}${chip("criminal", "फौजदारी · Criminal")}${chip("custody", "थुनुवा · In custody")}</div>
    <div style="margin-top:14px">${benchesHTML || `<p class="empty">यो फिल्टरमा कुनै मुद्दा छैन।</p>`}</div>`;

  const nav = (f, qq) => setHash(`#/day/${ci.code}/${date}`, { f: f !== "all" && f, q: qq });
  document.getElementById("courtPick").onchange = e => { location.hash = `#/day/${e.target.value}`; };
  document.getElementById("datePick").onchange = e => { location.hash = `#/day/${ci.code}/${e.target.value}`; };
  app.querySelectorAll(".chip").forEach(b => b.onclick = () => nav(b.dataset.f, q));
  const qi = document.getElementById("dayQ");
  qi.onchange = () => nav(filter, qi.value.trim());
});

/* ---------------- judges */
function outcomeCounts(outcomes) {
  const counts = {};
  Object.entries(outcomes || {}).forEach(([o, n]) => { const k = outcomeKind(o).key; counts[k] = (counts[k] || 0) + n; });
  return counts;
}
function outcomeBar(outcomes) {
  const counts = outcomeCounts(outcomes);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return "";
  return `<div class="bar" role="img" aria-label="Outcome breakdown">${OUTCOME_KINDS.filter(k => counts[k.key]).map(k =>
    `<i style="width:${(counts[k.key] / total) * 100}%;background:${k.color}" title="${k.label}: ${counts[k.key]}"></i>`).join("")}</div>`;
}
function legend(outcomes) {
  const counts = outcomes ? outcomeCounts(outcomes) : null;
  return `<div class="legend">${OUTCOME_KINDS.filter(k => !counts || counts[k.key]).map(k =>
    `<span><i style="background:${k.color}"></i>${k.label}${counts ? " " + toDev(counts[k.key]) : ""}</span>`).join("")}</div>`;
}

addRoute("judges", /^\/judges$/, async (m, params) => {
  const md = await meta();
  const court = params.get("court") || "SC";
  const list = md.judges.filter(j => j.court === court);
  const ci = md.courts.find(c => c.code === court) || { days: [] };
  app.innerHTML = `<h1>न्यायाधीशहरू · Judges</h1>
    <div class="toolbar"><select id="jc">${md.courts.map(c => `<option value="${c.code}" ${c.code === court ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    <p class="sub">${esc(courtName(md, court))} — ${toDev(ci.days.length)} पेसी दिनको डाटा अनुसार${ci.days.length ? ` (${fmtDate(ci.days.at(-1).date)} देखि ${fmtDate(ci.days[0].date)} सम्म)` : ""}</p>
    <div class="panel" style="padding:10px 14px">${legend()}</div>
    <div class="jgrid">${list.map(j => `<a class="jcard" href="#/judge/${court}/${encodeURIComponent(j.name)}">
      <span class="t">${esc(j.title)}</span><h3>${esc(j.name)}</h3>
      <div class="nums"><span><b>${toDev(j.decisions)}</b> फैसला</span><span><b>${toDev(j.hearings)}</b> पेसी</span><span><b>${toDev(j.days)}</b> दिन</span></div>
      ${outcomeBar(j.outcomes)}</a>`).join("") || `<p class="empty">डाटा छैन।</p>`}</div>`;
  document.getElementById("jc").onchange = e => setHash("#/judges", { court: e.target.value });
});

addRoute("judges", /^\/judge\/([A-Z0-9]+)\/(.+)$/, async (m, params) => {
  const court = m[1], name = m[2];
  const [md, idx, nkp] = await Promise.all([meta(), courtSearch(court), optional(getJSON("data/nkp/index.json"))]);
  const j = md.judges.find(x => x.name === name && x.court === court);
  if (!j) { app.innerHTML = `<p class="empty">न्यायाधीश फेला परेन।</p>`; return; }
  const showAll = params.get("all") === "1";
  const benchIds = new Set(Object.entries(idx.benches).filter(([, js]) => js.includes(name)).map(([id]) => +id));
  const rows = idx.rows.filter(r => benchIds.has(r[1])).map(r => rowObj(r, court)).filter(c => showAll || DECIDED.has(c.status));
  const other = c => (idx.benches[c.bench] || []).filter(x => x !== name).map(x => "संग: मा. " + esc(x)).join(", ");
  // reported precedents in NKP on which this judge sat (exact name match on the bench list)
  const bare = name.replace(/^डा\.\s*/, "");
  const nkpRows = nkp ? nkp.rows.filter(r => r[8].some(x => x.replace(/^डा\.\s*/, "") === bare)) : [];
  app.innerHTML = `<a class="back" href="#/judges?court=${court}">← सबै न्यायाधीश</a>
    <h1>मा. ${esc(j.name)}</h1>
    <p class="sub">${esc(j.title)} · ${esc(courtName(md, court))}</p>
    <div class="stats">
      <div class="stat"><b>${toDev(j.decisions)}</b><span>फैसला / अन्तिम आदेश</span></div>
      <div class="stat"><b>${toDev(j.hearings)}</b><span>पेसीमा मुद्दा</span></div>
      <div class="stat"><b>${toDev(j.days)}</b><span>इजलास बसेको दिन</span></div>
      ${nkpRows.length ? `<div class="stat"><b>${toDev(nkpRows.length)}</b><span>ने.का.प.मा प्रकाशित नजिर</span></div>` : ""}
    </div>
    <div class="panel"><h2>नतिजाको प्रकार · Outcomes</h2>${outcomeBar(j.outcomes)}${legend(j.outcomes)}</div>
    ${nkpRows.length ? `<div class="panel"><h2>प्रकाशित नजिर (ने.का.प.) · Reported precedents</h2>
      <ul class="plain">${nkpRows.slice(0, 15).map(r => `<li><a href="#/nkp/${r[0]}">नि.नं. ${toDev(r[1])} — ${esc(r[6])}</a> <span class="small">(${shortDate(r[5])})</span></li>`).join("")}</ul>
      ${nkpRows.length > 15 ? `<a href="#/nkp?judge=${encodeURIComponent(bare)}">सबै ${toDev(nkpRows.length)} हेर्नुहोस् →</a>` : ""}</div>` : ""}
    <div class="chips" style="margin-bottom:12px">
      <a class="chip ${showAll ? "" : "on"}" href="#/judge/${court}/${encodeURIComponent(name)}">फैसला मात्र</a>
      <a class="chip ${showAll ? "on" : ""}" href="#/judge/${court}/${encodeURIComponent(name)}?all=1">सबै पेसी</a>
    </div>
    <div class="bench" id="jrows"></div>`;
  paged(document.getElementById("jrows"), rows, r => casesTable(r, { date: true, judges: other }), 100);
});
