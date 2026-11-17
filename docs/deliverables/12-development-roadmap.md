# 12. Development roadmap

## Phase 1: Built ✅
- Daily results: Supreme Court and 18 High Court benches; judges pages with outcome mix.
- NKP archive (~10,500 decisions): ranked search, headnotes with paragraph anchors, citation copy, "cited by".
- SC published judgments/orders with Nepali OCR and full-text search.
- Statutes: catalogue of ~390 laws; 31 criminal-justice laws split into sections; amendment history; law-as-on-date flags; citing precedents per section.
- Citation linker (Act + दफा, Constitution धारा with the right constitution, Muluki Ain, NKP citations).
- Research workflows: W1 statutory, W2 precedent, W3–W5 case-file worksheet (browser-only, downloadable/printable).
- District authenticated-judgments collector.
- Automation: daily + weekly GitHub Actions; free hosting on GitHub Pages.

## Phase 2: Accuracy and coverage (next 4–6 weeks)
1. **Statute proofreading pass**: fill the listed section gaps by hand or with a second OCR engine; publish a "verified" flag per section.
2. **Decided-order PDFs**: download and OCR the order PDF for every decided criminal case on the cause lists, and link it into the judge and case pages.
3. **District daily cause lists** (77 courts).
4. **Muluki Ain** text and linking of the 1,600+ detected Muluki Ain citations.
5. **Rules** (Supreme/High/District Court Rules, Government Attorney Regulations).
6. **Alerts**: email/Viber notification when a watched case number appears on a cause list or gets a result (opt-in, client-side watch list).
7. **Preeti → Unicode converter** for user-supplied typed documents.

## Phase 3: Local research platform (2–3 months)
1. Migrate to PostgreSQL + pgvector (doc 6/9); keep the static site as the public front end.
2. Hybrid semantic search (multilingual embeddings) across headnotes, paragraphs and sections.
3. **Verified annotations**: lawyers record ratio/obiter, offence elements, and precedent treatment (followed / distinguished / overruled) with name and date, kept separate from source text.
4. Local LLM research notes under the RAG rules in doc 9 (quote-and-cite only; labelled as AI-assisted).
5. Desktop packaging (one installer: database + OCR + local model) for offices that want everything offline.

## Phase 4: Practice tools
- Case-file workspace with saved files (encrypted on disk), evidence matrices and witness lists.
- Drafting aids that assemble **user-selected** provisions and precedents into bail applications, appeals and written submissions (templates labelled official/illustrative).
- Conflicting-authority report per provision.

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| Court sites block automated access from abroad | Run the scripts on a machine in Nepal; static site unaffected |
| Source HTML changes | Parsers match on headers/labels, not positions; daily runs surface failures in Actions logs |
| OCR errors in quoted text | OCR banner + original link everywhere; proofreading pass |
| Over-reliance on machine links | Labelled "auto-detected"; verified layer in Phase 3 |
| Size of hosted data | gzip JSON; NKP shards in git; originals not mirrored |
