# 3. Supreme Court and High Court precedent collection strategy

## Goal
Collect every publicly available Nepalese judgment that can serve as precedent, with criminal law first.
Extract the 20 fields the spec lists, **without inventing anything**: every field comes from the
source document or is marked as missing.

## Sources, in order of authority

| # | Source | What it gives | Status |
|---|---|---|---|
| 1 | **Nepal Kanoon Patrika** (nkp.gov.np), the Supreme Court's official law report | Reported decisions with NKP citation, decision no., date, bench, judges, case nos., parties, **headnotes with प्रकरण (paragraph) numbers**, counsel, अवलम्बित नजिर, सम्बद्ध कानून, lower courts, full text | ✅ Full archive loaded (~10,500 decisions); new decisions checked daily |
| 2 | **Supreme Court homepage**: फैसला / आदेश / अन्तरिम आदेश tabs | Recent important judgments and orders, often with the principle the court states, as PDF | ✅ Loaded (~320 documents), OCR'd; daily |
| 3 | **Supreme Court cause lists** (दैनिक पेसी) | Every case heard each day: bench, judges, status, result type, order PDF | ✅ Daily, 28+ days of history and growing |
| 4 | **High Court cause lists** (18 benches) | Same for the High Courts | ✅ Daily |
| 5 | **District courts**: प्रमाणीकरण भएका फैसला (weekly) | Authenticated judgments: parties, case no., decision date, judge | ✅ Collected daily, history kept (list resets weekly) |
| 6 | Special Court case system | Decided cases by date | ⚠️ Public system returns no records; checked daily |
| 7 | Supreme Court full-bench / constitutional-bench decisions | Already inside sources 1–3 (bench type is a field) | ✅ Filterable by bench |

Unofficial sites (commercial law portals, blogs) are **not** used as substitutes, as the spec requires.

## Field extraction (spec §3E, 20 fields)

| # | Field | How it is obtained | Reliability |
|---|---|---|---|
| 1 | Case title | NKP heading / SC listing title | Exact |
| 2 | Case number | Regex on header (e.g. `०७४-CR-०१७१` → `074-CR-0171`) | Exact |
| 3 | Decision date | NKP "फैसला मिति" / listing text | Exact |
| 4 | Bench composition | Header line (संयुक्त / पूर्ण / संवैधानिक / विशेष इजलास…) | Exact |
| 5 | Judges | Header lines "माननीय न्यायाधीश श्री …" | Exact (missing on some older NKP reports) |
| 6 | Court | Header | Exact |
| 7 | Offence | NKP subject (मुद्दा) + case-type code; criminal flag | Exact subject; criminal flag is rule-based |
| 8 | Statutory provisions | Pattern-matched citations ("…ऐन, YEAR को दफा N", "संविधानको धारा N", Muluki Ain "…महलको N नं.") plus NKP's सम्बद्ध कानून field | Machine-detected, labelled. Year-checked so old acts and constitutions are not confused with current ones |
| 9 | Material facts | Full text ("तथ्य खण्ड") | Text only; not summarised |
| 10 | Issues | Full text; NKP headnotes state the resolved issues | Not auto-summarised |
| 11 | Arguments | Full text + counsel field | Not auto-summarised |
| 12 | Reasoning | Full text | Not auto-summarised |
| 13 | **Ratio decidendi** | **NKP headnotes** (published by the court's reporter) with paragraph numbers | Authoritative, as published |
| 14 | Obiter dicta | Not separated automatically; needs a lawyer | Manual |
| 15 | Final order | Full text (end of judgment) / cause-list result field | Result type exact; order text in full text |
| 16 | Followed / distinguished / overruled | "Cited by" links are detected automatically. **The treatment itself is not**: shown as "verify" | Manual verification |
| 17 | Related precedents | NKP citations in text + अवलम्बित नजिर; same-subject list | Machine-detected |
| 18 | Official source URL | Stored for every item | Exact |
| 19 | PDF / original | Linked (SC PDFs, Law Commission PDFs, NKP page) | Exact |
| 20 | Page / paragraph references | NKP headnotes give प्रकरण नं.; the site anchors numbered paragraphs | Exact where NKP gives them |

## Why some fields are not auto-generated
Ratio, obiter, issues and treatment are legal judgements. The spec forbids presenting
AI interpretation as a judicial holding, so the platform shows the court-published headnote, the full text
and the citation network, and leaves the classification to a lawyer. A future "verified annotations" layer
(see the development roadmap) can store a lawyer's classification separately, with their name and date.

## Update cadence
- Cause lists: 3× daily, re-checking the last 8 days, because results are filled in late.
- SC homepage publications: daily; only new documents are downloaded and OCR'd.
- NKP: daily check of the newest ~300 IDs; full re-crawl on demand.
- District lists: daily (weekly lists, so daily polling keeps everything).
