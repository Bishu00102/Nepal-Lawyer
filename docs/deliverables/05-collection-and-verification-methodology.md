# 5. Data collection and verification methodology

## Principles
1. **Official sources only**, with the source URL stored on every record (spec §4).
2. **No generation.** Nothing is summarised, paraphrased or "filled in". Where a field cannot be read, it is left empty and shown as missing.
3. **Machine-derived data is labelled.** OCR text, auto-detected citations, the criminal-case flag and outcome categories are all marked as such on the site.
4. **The original is always one click away** (PDF, NKP page, Law Commission page, court case page).
5. **Polite collection**: identified user agent, 0.3–1 s delays, ≤4 parallel connections, retries with back-off.

## Pipeline per source

| Step | Cause lists | SC publications | NKP | Statutes |
|---|---|---|---|---|
| Discover | Date → bench list (form POST) | Homepage tabs | Numeric ids 1…max+300 | Volume/category pages (paginated) |
| Fetch | Bench page HTML | PDF/JPG | Decision HTML | Content page → PDF |
| Extract | HTML table → fields | Text layer if valid Unicode, else OCR | HTML paragraphs → header fields, headnotes (+ प्रकरण), body | OCR → front matter (Act no., dates, amendment list) → भाग / परिच्छेद / दफा |
| Normalise | Case no. `0YY-XX-NNNN`; judge titles stripped (keeps names like श्रीकान्त) | Case no., date from title | Devanagari digits → Latin for keys; dates YYYY-MM-DD BS | Section numbers Latin; amendment dates |
| Store | `court.db` | `court.db` + `texts/` | `nkp.db` (+ git shards) | `statutes.db` + `statute_texts/` |
| Re-check | Last 8 days, 3× daily | New items daily; failed downloads retried | Newest 300 ids daily | Weekly; re-OCR when the PDF URL changes |

## Verification checks (automated)
- **Count reconciliation:** cause-list case counts per day are checked against the court's own summary table (verified for 2083-07-27: 207 listed, 17 decided, matching exactly).
- **Garbled-text detection:** a PDF text layer is rejected and OCR'd when >3% of Devanagari words start with a dependent vowel sign/virama, or core legal words (अदालत, बमोजिम, न्यायाधीश…) are absent. This caught Word exports where "अदालत" was stored as "ुदमलत".
- **Section sequence check:** statute sections must increase. Numbers mangled by amendment symbols are repaired only when one reading fits the sequence, e.g. "५२१" → "२१". Sections not found are listed as **gaps** on the act page.
- **Citation year check:** a citation "X ऐन, 2031 को दफा 9" is linked to the act in the catalogue only if the year matches; otherwise it is stored as an "old/other act" reference. Constitution articles are linked to the 2072 Constitution only when the citation says so, or when the decision post-dates 2072-06-03. Otherwise they're labelled with the older constitution or "unclear".
- **Round-trip test:** the NKP git shards are re-imported and compared (10,555 decisions, identical character counts).

## Manual verification (lawyer)
| Item | Why manual | Where the site helps |
|---|---|---|
| Ratio / obiter / issues | Legal judgement | NKP headnotes + paragraph anchors |
| Treatment of precedent (followed/overruled) | Legal judgement | "Cited by" list on each decision |
| OCR'd quotations | OCR errors possible | Original PDF linked; OCR banner |
| Statute text as on an older date | Only current text is published | "Law as on date" flags later amendments and affected sections |
| Offence elements | Legal judgement | Section text + punishment sentences highlighted |

## Known error sources
- OCR misreads numbers, Latin case numbers inside Devanagari scans, and footnote symbols. The site shows the original next to the text.
- NKP: 5 records carry the placeholder year 1111 on NKP itself; ~660 older reports have no structured judge lines; ~1,100 have no separable headnote.
- Court sites intermittently reset connections; every fetch retries, and failed items are retried on the next run.
