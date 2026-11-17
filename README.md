# अदालती नतिजा · Nepal Court Tracker

_Nepal-Lawyer: Nepali law research website — court results, precedents (NKP), statutes incl. the Constitution, research tools._

A free, self-updating legal research website for Nepali lawyers, built from official public
sources only. It implements the criminal-law research platform described in
[`docs/criminal_law_spec.pdf`](docs/criminal_law_spec.pdf); the 12 deliverables that spec asks for
are in [`docs/deliverables/`](docs/deliverables/).

Nothing on the site is written by AI. Every judgment, headnote, statute section and result is copied
from the court, NKP or Law Commission, with a link to the original. Cross-references between
precedents and provisions are detected by pattern matching and are labelled as machine-detected.

## What it contains

| Section | Source | Contents |
|---|---|---|
| **दैनिक नतिजा · Daily results** | supremecourt.gov.np cause lists | Supreme Court and all 18 High Court benches: every bench, its judges, every case listed, status and result (फैसला, आदेश, स्थगित, सदर, उल्टी…), order PDFs. Filters for decided, criminal and in-custody cases. Updated 3× a day. |
| **नजिर · Precedents** | nkp.gov.np | All ~10,500 decisions reported in Nepal Kanoon Patrika (BS 2015–2082): citation (भाग/साल/महिना/अंक/नि.नं.), date, bench, judges, case numbers, parties, the published headnotes with paragraph (प्रकरण) references, counsel, precedents relied on, related law, lower courts, full text. Ranked search; “cited by” links. |
| **फैसला / आदेश · SC orders** | Supreme Court homepage | ~320 published judgments, orders, interim orders and notices with the legal principle the court highlights, the bench, OCR'd full text, original PDF, and the case's hearing history. |
| **कानून · Statutes** | lawcommission.gov.np | Catalogue of ~390 laws with links to the official PDF; 31 criminal-justice laws (Constitution, मुलुकी अपराध संहिता, फौजदारी कार्यविधि संहिता, प्रमाण ऐन, special criminal acts…) split into sections, with Act number, dates, amendment history, a **"law as on the date of the offence"** check, and the precedents citing each section. |
| **न्यायाधीश · Judges** | cause lists + NKP | Per court: decisions, cases listed, days sitting, outcome mix, decisions with co-bench judges, reported precedents. |
| **अनुसन्धान · Research** | all of the above | Workflow 1 statutory research, Workflow 2 precedent research, Workflows 3–5 case-file worksheet (chronology, provisions cited, candidate offences, evidence matrix, procedural checklist, research questions, defence & hearing prep). **The case-file tool runs entirely in the browser — client documents are never uploaded.** |
| **मस्यौदा · Drafting** | chosen sections + precedents | बहस नोट, लिखित बहस, थुनछेक/धरौटी निवेदन, पुनरावेदन पत्र, कानूनी राय, जिरह प्रश्नावली. Add sources with **+ मस्यौदामा** on any statute section or NKP headnote, or from the case-file worksheet. **Without AI:** a formatted draft with exact quotes and citations, gaps marked for the lawyer. **With AI (optional):** Claude (`claude-opus-5-5`) writes a full draft using only the chosen sources. It runs from the lawyer's browser with their own Anthropic API key, only after they tick a consent box; party and witness names are replaced by placeholders before sending; any section or NKP number not among the chosen sources is flagged in red. Export to Word (.doc) or print/PDF. |
| **सल्लाह · Ask a question** | Constitution + Acts + NKP | For the public: ask in Nepali or English. The site finds the relevant Constitution articles, Act sections and NKP headnotes, and the AI answers in plain language, citing them as clickable [L1]/[P1] links. Any reference that isn't among the sources is flagged red. General legal information, not advice; points to a lawyer. Runs through the site's AI server: free Cloudflare Workers AI by default (Claude optional), with daily limits. |
| **वकिल · Find a lawyer** | lawyers who sign up | Directory by district and subject (call, WhatsApp, email), consultation request form, lawyer sign-up. The owner approves lawyers on the admin page. |
| **AI सहायक · AI assistant** | all of the above | For lawyers: multi-turn research chat with the case facts, plus one-click tasks (strategy, defence grounds, assessing the prosecution, procedural defects, bail research, hearing prep, cross-examination plan, evidence matrix). Sources go to the draft basket with one click. Uses the site's free AI with an access code from the owner, or optionally the lawyer's own (paid) Anthropic key; client names are hidden before sending. |
| **संविधान · Constitutions** | Law Commission; ConstitutionNet / FAOLEX | All 7 constitutions (2004, 2007, 2015, 2019, 2047, 2063, 2072), split into articles and searchable; the 2072 Constitution in Nepali and the official English translation side by side, with the 1st and 2nd Amendments and the articles they changed. Old-constitution citations in judgments link to the right constitution. Nepali originals of older constitutions are added automatically when the Law Commission's old-law repository is reachable. |
| **खोज · Search** | everything | One box across hearings, precedents, SC publications and statute sections. |

District courts: the weekly list of authenticated judgments for all 77 district courts is collected
daily (`scraper/district.py`) and kept as history.

## How it works

```
scraper/sc_daily.py         cause lists & results: SC, 18 High Court benches, Special Court   -> data/court.db
scraper/district.py         district courts' authenticated judgments (weekly lists)            -> data/court.db
scraper/sc_publications.py  SC published judgments/orders/notices; Nepali OCR when needed      -> data/court.db, data/texts/
scraper/nkp.py              Nepal Kanoon Patrika archive                                       -> data/nkp/ (shards) + data/nkp.db
scraper/statutes.py         Law Commission catalogue; OCR + section parsing of criminal laws   -> data/statutes.db, data/statute_texts/
scraper/links.py            citations: Act+दफा, Constitution धारा, Muluki Ain, NKP citations  -> data/links.db
scraper/build_site.py       exports static JSON for the website                                -> site/data/
site/                       the website (plain HTML/JS, no server, no build step)
```

GitHub Actions run everything automatically:
- `.github/workflows/daily.yml` (3× a day) runs the courts, publications, new NKP decisions, links, then rebuilds and publishes the site.
- `.github/workflows/weekly-statutes.yml` (Sundays) checks the Law Commission for new or amended laws.

### Text quality
- **NKP** pages are real Unicode text, so they're exact.
- **Supreme Court PDFs and Law Commission statutes** are scans, or Word exports whose Devanagari text layer is garbled (legacy fonts such as Preeti/Kalimati with broken mappings). These are read with Tesseract OCR (Nepali + English). OCR text is clearly labelled and can contain errors, so always quote from the linked original. Statute sections whose numbers OCR could not read are listed on each act page.

## Run it on your computer

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-nep poppler-utils
```

```bash
pip install -r requirements.txt
```

```bash
python scraper/sc_daily.py --days 30
```

```bash
python scraper/sc_publications.py && python scraper/nkp.py && python scraper/statutes.py catalogue && python scraper/statutes.py text
```

```bash
python scraper/links.py && python scraper/build_site.py
```

```bash
cd site && python -m http.server 8000
```

Then open http://localhost:8000. (On Windows, install Tesseract with the Nepali language pack and Poppler.)

The first full NKP load takes about 2 hours, and statutes OCR about 30 minutes. After that, updates take minutes.

## Put it online for free (GitHub Pages)

1. Create a GitHub repository and push this folder.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Actions → Daily court update → Run workflow** once. It then runs on its own.

The site will be at `https://<username>.github.io/<repo>/`. If the courts ever block GitHub's
servers, run the same scripts daily on a computer in Nepal and upload `site/`.

## AI features setup

See [`docs/SETUP-AI.md`](docs/SETUP-AI.md): a free Cloudflare account and three GitHub secrets. The AI is free
(Cloudflare Workers AI, `@cf/qwen/qwen3-30b-a3b-fp8`, 10,000 free Neurons/day). Adding an `ANTHROPIC_API_KEY` secret
optionally switches it to Claude.
The AI server code is in `worker/` (Cloudflare Worker; tests: `cd worker && npm test`).

## Known gaps (see `docs/deliverables/01-data-inventory.md`)

- **Special Court:** the public case system returns no records, and specialcourt.gov.np is unreachable.
- **Office of the Attorney General, Nepal Gazette (Rajpatra), Judicial Academy:** unreachable during collection.
- **Statutes:** only current consolidated texts are published. Historical text is flagged, not reconstructed.
- **Treatment of precedents** (followed / distinguished / overruled) is not auto-determined; "cited by" lists are given for a lawyer to verify.
- **Police investigation records and case diaries** are confidential and not collected.

## Disclaimer

This is not an official record. Data is copied automatically and may lag the sources or contain
OCR/parsing errors. Always check the original judgment, order or statute before relying on it.
