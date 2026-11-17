# 4. Official data-source directory

Checked from the collection environment on 2083-07-30 BS (16 Nov 2026). "Reachable" = an HTTP request
succeeded during collection; government sites are intermittently slow or reset connections, so all
scrapers retry.

| Source | URL | Institution | Public | Download | Format | OCR needed | Bulk collection | Reuse | Reliability | Manual check | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Nepal Kanoon Patrika | nkp.gov.np/full_detail/{id} | Supreme Court (NKP division) | Yes | HTML per decision | Unicode HTML | No | Yes, by numeric id (~10,600), politely throttled | Official public law report; cite as NKP | Highest (official reporter) | Missing judges/headnotes on some old reports | ✅ Loaded |
| SC daily cause list | supremecourt.gov.np/lic/sys.php?d=reports&f=daily_public | Supreme Court | Yes | HTML form per date & bench | HTML | No | Yes, 1 request per bench per day | Public information | High; results filled in after hearing | Re-check last 8 days | ✅ Daily |
| SC order PDFs | …/lic/viewpdf.php?case_id&hearing_date | Supreme Court | Yes | PDF | Scanned PDF | Yes | Linked, not mirrored | Public | High | — | ✅ Linked |
| SC case details | …/lic/sys.php?d=reports&f=case_details | Supreme Court | Yes | HTML | HTML | No | Per case | Public | High | — | ✅ Linked |
| SC homepage judgments/orders/notices | supremecourt.gov.np/web/ (tabs) | Supreme Court | Yes | PDF/JPG | Scans + Word PDFs with broken font maps | Yes | Yes (~320 items) | Public | High | 10 links broken at source (404) | ✅ Loaded + OCR |
| High Court cause lists (18 benches) | supremecourt.gov.np/appeal/syspublic.php (courtid 1–15, 90, 91, 96) | High Courts | Yes | HTML (session-based court selection) | HTML | No | Yes | Public | High | — | ✅ Daily |
| Special Court | supremecourt.gov.np/special/syspublic.php ; specialcourt.gov.np | Special Court | Form public | — | — | — | Returned no records; own site unreachable | — | — | — | ⚠️ Gap |
| District court authenticated judgments | supremecourt.gov.np/court/{district}dc/published_faisala | 77 District Courts | Yes | HTML (current week only) | HTML | No | Yes, daily accumulation | Public | High | Parser to verify on first rows | ✅ Collecting |
| District daily cause lists | supremecourt.gov.np/weekly_dainik/pesi/daily/{id} | District Courts | Yes | HTML | HTML | No | Possible | Public | High | — | ◻ Not yet collected (roadmap) |
| Nepal Law Commission | lawcommission.gov.np (volumes खण्ड 1–17, constitution, codes, recent acts, ordinances) | Nepal Law Commission | Yes | PDF per law | Word PDFs with Kalimati/Preeti broken text layers | Yes | Yes (~390 laws) | Official consolidated text | Highest for current text | Section numbers OCR-misread on some sections; amendment markers | ✅ Catalogue + 31 criminal laws parsed |
| Law Commission old repository | repository.lawcommission.gov.np | Nepal Law Commission | Yes | — | — | — | Not explored | — | — | — | ◻ Roadmap (historical versions) |
| Nepal Gazette (राजपत्र) | rajpatra.dop.gov.np | Department of Printing | Should be | — | PDF | Likely | — | Official | Highest for original/amending acts | — | ⚠️ Unreachable (503 / no connection) |
| Ministry of Law, Justice & Parliamentary Affairs | moljpa.gov.np | MoLJPA | Yes | Notices, bills, PDFs | PDF/HTML | Some | Selective | Public | High | — | ◻ Reachable, not collected |
| Office of the Attorney General | ag.gov.np | OAG | Should be | — | — | — | — | — | — | — | ⚠️ Unreachable during collection |
| Nepal Police | nepalpolice.gov.np | Nepal Police | Yes (notices) | PDF notices | PDF | Some | Selective | Public | High | Investigation records are confidential | ◻ Reachable; only public notices exist |
| CIAA | ciaa.gov.np | Commission for Investigation of Abuse of Authority | Yes | Reports, cases filed | PDF/HTML | Some | Selective | Public | High | — | ◻ Reachable, not collected |
| Ministry of Home Affairs | moha.gov.np | MoHA | Yes | Notices | PDF | Some | Selective | Public | Medium | — | ◻ Reachable, not collected |
| National Judicial Academy | njanepal.org.np | NJA | Should be | — | — | — | — | — | — | — | ⚠️ Unreachable |
| SC Judicial Education (JED) | supremecourt.gov.np/jed/ | Supreme Court | — | — | — | — | — | — | — | — | ⚠️ Unreachable |
| `supremecourtofnepal.com` | — | (not an official domain) | — | — | — | — | No public DNS record | — | — | — | ✖ Does not exist |

## Confidential vs public (spec §3F)
Police case diaries, investigation files, forensic reports and post-mortem reports on real cases are
**not public**. They exist only in a lawyer's own case file. The platform keeps them local: the case-file
worksheet runs in the browser and uploads nothing. Public procedural law (the procedure code, the Evidence Act,
the Constitution's fair-trial rights) is collected and searchable.

## Court forms (spec §3G)
The Supreme Court publishes "सेवाग्राहीहरूद्वारा … निवेदनहरूको ढाँचा (Templates)" on its notices tab; this is
linked from the SC publications section (it is a web page, not a PDF). The statutory forms annexed to the
procedure codes are inside the OCR'd code text. Official templates and illustrative drafts must be kept
separate; the roadmap adds a forms catalogue that labels each form "official" or "illustrative".
