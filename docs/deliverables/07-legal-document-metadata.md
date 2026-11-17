# 7. Legal document metadata structure

One common envelope for every document, plus type-specific fields. Field names are those used in
the exported JSON (`site/data/…`) and the databases.

## 7.1 Common envelope (all documents)

| Field | Type | Example | Notes |
|---|---|---|---|
| `id` | string | `10616` / `af866af1…` | Source id (NKP id) or sha1(url)[:16] |
| `source` | enum | `nkp` · `sc_publication` · `cause_list` · `law_commission` · `district` | |
| `source_url` | url | `https://nkp.gov.np/full_detail/10616` | Always present |
| `original_url` | url | PDF link | When the source is a file |
| `title` | text (ne) | `जबरजस्ती करणी` | As published |
| `language` | enum | `ne` · `en` · `mixed` | |
| `date_bs` | `YYYY-MM-DD` | `2081-01-04` | Bikram Sambat; AD stored separately when known |
| `text_method` | enum | `html` · `pdf-text` · `ocr` · `none` | Drives the OCR warning |
| `fetched_at` | timestamp | `2026-11-16 10:44:02` | |
| `verified` | object | `{by, date, note}` | Empty until a lawyer verifies |

## 7.2 Judgment / order

| Field | Example |
|---|---|
| `court` | `सर्वोच्च अदालत` |
| `bench_type` | `संयुक्त इजलास` · `पूर्ण इजलास` · `संवैधानिक इजलास` |
| `judges[]` | `["विनोद शर्मा", "महेश शर्मा पौडेल"]` |
| `case_nos[]` | `["074-CR-0171", "075-CR-0056"]` |
| `case_type` | `CR` (code from case no.) |
| `criminal` | `true` (rule: CR/RC/WH codes, थुनुवा, offence words) |
| `subject` | `जबरजस्ती करणी` |
| `parties` | `पुनरावेदक / प्रतिवादी : … ¶ प्रत्यर्थी / वादी : …` |
| `counsel` | `वादीका तर्फबाट : … ¶ प्रतिवादीका तर्फबाट : …` |
| `kind` | `फैसला` · `आदेश` · `अन्तरिम आदेश` |
| `result` | cause-list "आदेश फैसलाको किसिम": `सदर` · `उल्टी` · `केही उल्टी` · `रिट खारेज`… |
| `nkp` | `{volume: 67, year: 2082, month: "चैत्र", issue: 12, decision_no: 11520, citation: "ने.का.प. २०८२, चैत्र, अंक १२, नि.नं. ११५२०"}` |
| `headnotes[]` | `[{text, para: "८"}]` (as published by NKP) |
| `principle` | Principle line the SC homepage gives for the document |
| `relied[]` | अवलम्बित नजिर (as published) |
| `related_law[]` | सम्बद्ध कानून (as published) |
| `lower_courts` | Trial and appellate courts and judges |
| `cites[]` | `[{type: "section", act: 13454, sec: "219", label, method: "auto"}]` |
| `cited_by[]` | NKP ids citing this decision |
| `treatment[]` | `[{by_judgment, treatment, para, verified_by}]` (manual only) |
| `pages` | 18 |

## 7.3 Cause-list entry (hearing)

`court, date_bs, bench_no, bench_type, judges[], serial, faant, reg_date, subject, case_no, case_id,
case_url, appellant, respondent, adv_appellant, adv_respondent, remarks (e.g. थुनुवा), status
(फैसला/आदेश/स्थगित/हेर्न नभ्याइने…), outcome, order_pdf_url`

## 7.4 Legislation

| Level | Fields |
|---|---|
| Act | `id, title, year_bs, act_no ("२०७४ सालको ऐन नं. ३६"), authenticated_bs, commencement, category (खण्ड), area (criminal-law area), pdf_url, page_url, amendments[{title, date_bs}], gaps[]` |
| Section | `number ("177", "3क"), part (भाग), chapter (परिच्छेद — heading), heading, body, amended_by (markers found), cited_by[[src_type, src_id, label]]` |
| Version (target) | `valid_from_bs, valid_to_bs, source (Law Commission consolidated / Gazette original), source_url` |

## 7.5 Case file (private, local only)

`case_title, client_ref, offence_date_bs, documents[{kind: जाहेरी|बयान|बकपत्र|अभियोग पत्र|मुचुल्का|प्रतिवेदन, text, file}],
chronology[{date_bs, sentence, doc}], provisions_cited[], candidate_offences[], evidence[{category,
source_sentence, for_prosecution, for_defence, weakness}], procedural_checks[{check, provisions, complied}],
facts_in_issue[], research_questions[], defence[], hearing[]`. Never leaves the user's machine.

## 7.6 Identifiers and normalisation
- Case numbers: `0YY-XX-NNNN` (Latin digits, upper-case type code).
- Dates: Bikram Sambat `YYYY-MM-DD`, Latin digits internally, Devanagari on display.
- Judges: honorifics (मा., न्या., श्री, स.प्र.न्या.) removed; personal names kept intact (श्रीकान्त stays).
- Text: Unicode NFC; zero-width joiners kept in display and ignored in matching.
