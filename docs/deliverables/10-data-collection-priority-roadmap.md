# 10. Data collection priority roadmap

Ordered by value to criminal practice and by how reliably the data can be obtained from official sources.

| Priority | Data | Source | Status |
|---|---|---|---|
| P0 | Supreme Court daily results (bench, judges, status, result) | SC cause lists | ✅ Done, 3× daily |
| P0 | Reported precedents with headnotes | NKP | ✅ Done (full archive) |
| P0 | Muluki Aparadh Samhita, Muluki Faujdari Karyabidhi Samhita, Evidence Act, Constitution | Law Commission | ✅ Sections parsed (OCR, gaps listed) |
| P0 | Sentencing Act, Victim Protection Act, special criminal acts (corruption, narcotics, trafficking, money laundering, organised crime, cyber, arms, banking, wildlife, children, domestic violence…) | Law Commission | ✅ 31 acts parsed |
| P1 | High Court results | HC cause lists | ✅ Done, daily |
| P1 | Supreme Court published judgments/orders | SC homepage | ✅ Done + OCR |
| P1 | Precedent ↔ provision links | Derived | ✅ Auto-detected, labelled |
| P1 | District court authenticated judgments | District pages | ✅ Collecting (weekly lists accumulate) |
| P2 | District daily cause lists | `/weekly_dainik/pesi/daily/{id}` | ◻ Next |
| P2 | Full judgment PDFs behind cause-list results (viewpdf) for decided criminal cases | SC `viewpdf.php` | ◻ Next: download + OCR the decided CR/RC/WH orders daily |
| P2 | Historical versions of the criminal laws (pre-amendment text) | Nepal Gazette, Law Commission old repository | ◻ Blocked: Gazette unreachable; try repository.lawcommission.gov.np |
| P2 | Muluki Ain (repealed code), chapters cited in older precedents | Law Commission historical documents (ऐतिहासिक दस्तावेज) | ◻ Next: citations already detected (1,600+) and can be linked once the text is loaded |
| P2 | Rules (नियमावली): Supreme Court Rules 2074, High Court Rules, District Court Rules, Government Attorney Regulations | Law Commission (नियमावली category) | ◻ Next |
| P3 | Attorney General prosecution guidelines, annual reports | ag.gov.np | ⚠️ Unreachable now; retry |
| P3 | CIAA annual reports and filed cases | ciaa.gov.np | ◻ Reachable |
| P3 | Police procedure manuals (public ones only) | nepalpolice.gov.np | ◻ Only notices found publicly |
| P3 | Court forms and templates (official vs illustrative) | SC notices tab, code schedules | ◻ Catalogue to build |
| P3 | Special Court decisions | Special Court system | ⚠️ No public records returned |
| P4 | English translations of key acts | Law Commission English pages | ◻ For mixed-language queries |
| Never | Police case diaries, investigation files, forensic/post-mortem reports of real cases | — | Confidential: only the lawyer's own files, kept local |

## Re-check cadence
Cause lists 3×/day · SC publications daily · NKP daily (new ids) · District lists daily · Statutes weekly
(re-OCR when the published PDF changes).
