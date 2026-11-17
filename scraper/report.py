"""Generate the data-driven deliverables from the live databases:
   docs/deliverables/01-data-inventory.md, 02-criminal-legislation-master-list.md, 11-storage-estimates.md
Re-run any time; numbers always reflect what is actually collected."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data"
OUT = ROOT / "docs" / "deliverables"
DEV = str.maketrans("0123456789", "०१२३४५६७८९")


def q(db, sql, *a):
    return sqlite3.connect(D / db, timeout=60).execute(sql, a).fetchall()


def size(p: Path) -> int:
    if p.is_file():
        return p.stat().st_size
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def mb(n):
    return f"{n / 1e6:,.1f} MB"


def inventory():
    today = time.strftime("%Y-%m-%d")
    courts = q("court.db", "SELECT c.name, count(DISTINCT h.bs_date), count(*), min(h.bs_date), max(h.bs_date), "
                           "sum(h.status IN ('फैसला','अन्तिम आदेश')) FROM hearings h JOIN courts c ON c.code=h.court "
                           "GROUP BY h.court ORDER BY h.court='SC' DESC, c.name")
    docs = q("court.db", "SELECT kind, count(*), sum(text_method='ocr'), sum(coalesce(pages,0)) FROM documents GROUP BY kind")
    nk = q("nkp.db", "SELECT count(*), sum(criminal), min(year), max(year), sum(judges<>''), sum(headnotes<>'[]'), "
                     "sum(chars) FROM nkp WHERE year >= 2000")[0]
    nk_crim_by = q("nkp.db", "SELECT (year/10)*10, count(*), sum(criminal) FROM nkp WHERE year>=2000 GROUP BY 1 ORDER BY 1")
    acts = q("statutes.db", "SELECT count(*), sum(sections_count IS NOT NULL AND sections_count>0) FROM acts")[0]
    secs = q("statutes.db", "SELECT count(*) FROM sections")[0][0]
    cats = q("statutes.db", "SELECT category, count(*) FROM acts GROUP BY 1 ORDER BY 1")
    links = q("links.db", "SELECT tgt_type, count(*), count(DISTINCT src_id) FROM citations GROUP BY 1")
    dist = q("court.db", "SELECT count(*), count(DISTINCT court) FROM district_judgments") if (D / "court.db").exists() else [(0, 0)]
    L = [f"# 1. Complete Nepal Criminal Law Data Inventory", "",
         f"_Generated from the live databases on {today} by `scraper/report.py`._", "",
         "## A. Constitution and criminal-justice framework",
         "- **Constitution of Nepal (2072)**: full text OCR'd from the Law Commission PDF and split into articles (धारा). Fair-trial rights (धारा २०), the right to liberty, detention safeguards, court jurisdiction and the Attorney General's powers are searchable by article and keyword.",
         f"- Constitution citations found in judgments: see table F (linked to the 2072 text only when certain; older constitutions are labelled).", "",
         "## B–D. Substantive law, procedure, evidence",
         f"- **{acts[0]} laws catalogued** from the Law Commission (title, volume, official PDF). **{acts[1]} criminal-justice laws parsed into {secs:,} sections** with Act number, authentication date, amendment list and amendment markers. Full list: deliverable 2.",
         "", "| Law Commission category | Laws |", "|---|---|"] + [f"| {c or '—'} | {n} |" for c, n in cats] + [
         "", "## E. Precedents", "",
         "### Nepal Kanoon Patrika (official law report)",
         f"- **{nk[0]:,} decisions**, NKP years {nk[2]}–{nk[3]} BS; **{nk[1]:,} criminal** (CR/RC/WH case codes or offence subjects).",
         f"- Judges identified on {nk[4]:,}; headnotes (with प्रकरण no.) on {nk[5]:,}; {nk[6]/1e6:,.0f} million characters of full text.",
         "", "| NKP decade (BS) | Decisions | Criminal |", "|---|---|---|"] + [f"| {a}s | {b:,} | {c:,} |" for a, b, c in nk_crim_by] + [
         "", "### Supreme Court published judgments, orders and notices", "| Kind | Documents | OCR'd | Pages |", "|---|---|---|---|"] + [
         f"| {k} | {n} | {o or 0} | {p or 0:,} |" for k, n, o, p in docs] + [
         "", "### Daily cause lists and results", "| Court | Hearing days | Case listings | Decided | From | To |", "|---|---|---|---|---|---|"] + [
         f"| {c} | {d} | {n:,} | {dec or 0:,} | {a} | {b} |" for c, d, n, a, b, dec in courts] + [
         "", f"### District courts\n- Authenticated-judgment lists of **77 district courts** polled daily; {dist[0][0]} rows stored so far (lists reset weekly; history accumulates).",
         "", "## F. Cross-references (auto-detected)", "| Target | Citations | Citing documents |", "|---|---|---|"] + [
         f"| {t} | {n:,} | {s:,} |" for t, n, s in links] + [
         "", "`section` = current act + दफा (year-matched); `article` = Constitution 2072; `old_constitution` / `other_act` = older or different-year law (kept as text); `muluki_ain` = repealed Muluki Ain chapter; `nkp` = NKP citation.",
         "", "## G. Investigation and forensic material (§3F)",
         "- Public law on investigation, search, arrest, remand, evidence and expert evidence: in the procedure code and the Evidence Act (parsed).",
         "- Real investigation records (case diaries, forensic, post-mortem reports) are confidential, so they are not collected. The case-file worksheet processes a lawyer's own copies locally in the browser.",
         "", "## H. Court forms (§3G)",
         "- SC service templates page linked; statutory forms inside the codes. Official-vs-illustrative catalogue: roadmap.",
         "", "## Gaps", "- Special Court (no public records), Nepal Gazette, Attorney General, Judicial Academy (unreachable). Historical statute versions (only current consolidated texts are published). Precedent treatment needs lawyer verification."]
    (OUT / "01-data-inventory.md").write_text("\n".join(L) + "\n", encoding="utf-8")


# Common English titles (translations used by the Law Commission's English series); Nepali is authoritative.
EN = {
    "नेपालको संविधान": "Constitution of Nepal (2072/2015)",
    "मुलुकी अपराध संहिता": "National Penal (Code) Act, 2074 (2017)",
    "मुलुकी फौजदारी कार्यविधि संहिता": "National Criminal Procedure (Code) Act, 2074 (2017)",
    "मुलुकी देवानी संहिता": "National Civil (Code) Act, 2074 (2017)",
    "फौजदारी कसूर (सजाय निर्धारण तथा कार्यान्वयन) ऐन": "Criminal Offences (Sentencing and Execution) Act, 2074 (2017)",
    "प्रमाण ऐन": "Evidence Act, 2031 (1974)",
    "अपराध पीडित संरक्षण ऐन": "Crime Victim Protection Act, 2075 (2018)",
    "भ्रष्टाचार निवारण ऐन": "Prevention of Corruption Act, 2059 (2002)",
    "अख्तियार दुरूपयोग अनुसन्धान आयोग ऐन": "Commission for the Investigation of Abuse of Authority Act, 2048 (1991)",
    "सम्पत्ति शुद्धीकरण (मनी लाउन्डरिङ्ग) निवारण ऐन": "Assets (Money) Laundering Prevention Act, 2064 (2008)",
    "लागू औषध (नियन्त्रण) ऐन": "Narcotic Drugs (Control) Act, 2033 (1976)",
    "मानव बेचबिखन तथा ओसारपसार (नियन्त्रण) ऐन": "Human Trafficking and Transportation (Control) Act, 2064 (2007)",
    "सङ्गठित अपराध निवारण ऐन": "Organized Crime Prevention Act, 2070 (2014)",
    "विद्युतीय (इलेक्ट्रोनिक) कारोबार ऐन": "Electronic Transactions Act, 2063 (2008)",
    "हातहतियार खरखजाना ऐन": "Arms and Ammunition Act, 2019 (1962)",
    "बैङ्किङ्ग कसूर तथा सजाय ऐन": "Banking Offence and Punishment Act, 2064 (2008)",
    "राष्ट्रिय निकुञ्ज तथा वन्यजन्तु संरक्षण ऐन": "National Parks and Wildlife Conservation Act, 2029 (1973)",
    "सङ्कटापन्न वन्यजन्तु तथा वनस्पतिको अन्तराष्ट्रिय व्यापार नियन्त्रण ऐन": "Endangered Wild Fauna and Flora International Trade Control Act, 2073 (2017)",
    "बालबालिका सम्बन्धी ऐन": "Act Relating to Children, 2075 (2018)",
    "घरेलु हिंसा (कसूर र सजाय) ऐन": "Domestic Violence (Offence and Punishment) Act, 2066 (2009)",
    "कालोबजार तथा केही अन्य सामाजिक अपराध तथा सजाय ऐन": "Black Marketing and Some Other Social Offences and Punishment Act, 2032 (1975)",
    "विशेष अदालत ऐन": "Special Court Act, 2059 (2002)",
    "न्याय प्रशासन ऐन": "Administration of Justice Act, 2073 (2016)",
    "सार्वजनिक खरिद ऐन": "Public Procurement Act, 2063 (2007)",
    "नेपाल नागरिकता ऐन": "Nepal Citizenship Act, 2063 (2006)",
    "वैदेशिक रोजगार ऐन": "Foreign Employment Act, 2064 (2007)",
    "राजस्व चुहावट (अनुसन्धान तथा नियन्त्रण) ऐन": "Revenue Leakage (Investigation and Control) Act, 2052 (1995)",
    "यातना सम्बन्धी क्षतिपूर्ति ऐन": "Compensation Relating to Torture Act, 2053 (1996)",
    "प्रहरी ऐन": "Police Act, 2012 (1955)",
    "सशस्त्र प्रहरी ऐन": "Armed Police Act, 2058 (2001)",
    "पारस्परिक कानूनी सहायता ऐन": "Mutual Legal Assistance Act, 2070 (2014)",
}


def en_title(title: str) -> str:
    t = title.replace("\u200d", "").replace("\u200c", "")
    return next((v for k, v in sorted(EN.items(), key=lambda kv: -len(kv[0])) if k in t), "—")


def legislation():
    rows = q("statutes.db", "SELECT id,title,area,act_no,authenticated,commencement,sections_count,gaps,pdf_url,page_url "
                            "FROM acts WHERE area IS NOT NULL AND title NOT LIKE '%संशोधन%' AND title NOT LIKE '%अध्यादेश%' ORDER BY area, title")
    L = ["# 2. Master list of applicable criminal legislation", "",
         "_Generated from `data/statutes.db`. Source: Nepal Law Commission official consolidated texts. English titles are the commonly used translations, for reference; the Nepali title is authoritative._", "",
         "| Area | Title (Nepali, official) | English title (translation) | Act no. | Authenticated (BS) | Amendments (date BS) | Sections parsed | Sections OCR could not separate | Official PDF |",
         "|---|---|---|---|---|---|---|---|---|"]
    for aid, title, area, act_no, auth, comm, n, gaps, pdf, page in rows:
        am = q("statutes.db", "SELECT title, date_bs FROM amendments WHERE act_id=? ORDER BY seq", aid)
        ams = "<br>".join(f"{t}{' (' + d + ')' if d else ''}" for t, d in am) or "—"
        g = (gaps or "").split(",")
        gtxt = (", ".join(g[:12]) + (f" … (+{len(g)-12})" if len(g) > 12 else "")) if gaps else "—"
        L.append(f"| {area} | [{title}](https://lawcommission.gov.np/content/{aid}/) | {en_title(title)} | {act_no or '—'} | {auth or '—'} | {ams} | {n or 0} | {gtxt} | [PDF]({pdf}) |")
    L += ["", "Not found on the Law Commission site (record as gaps): **सरकारी मुद्दा सम्बन्धी ऐन, २०४९**, **सुपुर्दगी ऐन, २०१४**. Check the Gazette or MoLJPA.",
          "", "Per-section elements, punishments and exceptions are read from the section text on the site (कानून → act → दफा). Punishment sentences are highlighted automatically, but elements are **not** generated (they need a lawyer). Supreme Court interpretations per section: the \"cited by\" list on each section."]
    (OUT / "02-criminal-legislation-master-list.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def storage():
    items = [("Cause lists + publications metadata (court.db)", D / "court.db"),
             ("SC publications OCR text", D / "texts"),
             ("SC publications original PDFs (not committed)", D / "pdfs"),
             ("NKP archive (git shards, compressed)", D / "nkp"),
             ("NKP SQLite (rebuilt locally)", D / "nkp.db"),
             ("Statutes DB + OCR text", D / "statutes.db"), ("", D / "statute_texts"),
             ("Statute PDFs (not committed)", D / "statute_pdfs"),
             ("Citation links (rebuilt)", D / "links.db"),
             ("Generated website data (gzip where large)", ROOT / "site" / "data")]
    L = ["# 11. Estimated storage requirements", "", "_Measured on the collected data; projections below._", "",
         "| Component | Size now |", "|---|---|"]
    for label, p in items:
        if label:
            L.append(f"| {label} | {mb(size(p) + (size(D / 'statute_texts') if p.name == 'statutes.db' else 0))} |")
    days = q("court.db", "SELECT count(DISTINCT court||bs_date) FROM hearings")[0][0] or 1
    per_day = size(D / "court.db") / days
    L += ["", "## Projections",
          f"- Cause lists: ≈{per_day/1e3:,.0f} KB per court-day → all 19 courts × ~250 working days ≈ **{per_day*19*250/1e6:,.0f} MB per year** (database).",
          "- NKP grows ~400–600 decisions a year → ~5 MB compressed per year.",
          "- SC publication originals ≈ 6–7 MB per document; mirroring is optional (links kept).",
          "- Full statute corpus (all ~390 laws OCR'd): ≈ 60 MB text; originals ≈ 450 MB.",
          "- Decided-order PDFs (roadmap): ~20–40 criminal decisions/day at SC + HC ≈ 15–30 GB/year if mirrored, ≈ 0.5 GB/year as OCR text only.",
          "- Local AI (doc 9): embeddings for 11k decisions split into ~400k paragraphs × 768 dims × 4 bytes ≈ **1.2 GB**; LLM weights 5–9 GB (quantised 8–14B).",
          "", "**Recommended workstation:** 500 GB SSD, 32 GB RAM (16 GB without a local LLM). **Hosting the public site:** < 1 GB (GitHub Pages limit), currently well within."]
    (OUT / "11-storage-estimates.md").write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    inventory()
    legislation()
    storage()
    print("deliverables 01, 02, 11 generated")
