# 9. Local AI and search architecture

## Requirements from the spec
Local-first; Nepali, English and mixed queries; exact section, case-number, judge and citation search;
hybrid keyword + semantic search; RAG; sensitive client documents stay local unless the user authorises
otherwise; never present AI output as a judicial holding.

## What is implemented now (no AI model)

| Need | Implementation |
|---|---|
| Exact section search ("दफा १७७", "177") | Section index per act; number parsing in Latin and Devanagari |
| Case-number search ("078-CR-0481", "०७८-CR-०४८१") | Normalised case numbers across cause lists, SC documents, NKP |
| Judge search | Judge pages per court; NKP filter by judge |
| Citation search | NKP decision no. / citation; "cited by" graph |
| Keyword search with ranking | In-browser term-frequency ranking over titles, headnotes and section text, with Nepali stop words and spelling-variant normalisation |
| Full-text search | Compressed full-text indexes loaded on demand (SC publications, NKP decisions) |
| Private case-file analysis | Pure browser JavaScript; no network requests carry the document (verified: only static GETs) |

This runs on free static hosting. It already answers W1, W2 and the structural parts of W3–W5.

## Recommended local stack (next stage)

| Component | Recommendation | Why |
|---|---|---|
| Database | **PostgreSQL 16** with `pg_trgm`, `unaccent`-style custom normaliser | Relational model (doc 6), trigram search tolerant of OCR errors |
| Full-text | PostgreSQL FTS with a simple Nepali dictionary (stop-word list + normaliser) **or** OpenSearch/Meilisearch | Devanagari has no stemmer in PostgreSQL; a custom normaliser + trigram is reliable |
| Vectors | **pgvector** in the same database | One store; joins with metadata (court, year, criminal flag) |
| Embeddings | Multilingual model that handles Devanagari, e.g. `intfloat/multilingual-e5-base` or `BAAI/bge-m3` (local, CPU-capable) | Nepali + English + mixed queries |
| Hybrid ranking | BM25/trigram score + vector similarity (reciprocal-rank fusion), then filters | Exact citations need keyword; legal concepts need semantics |
| Local LLM | Run via **Ollama / llama.cpp**: a 7–14B instruction model with good Hindi/Nepali coverage (e.g. Qwen2.5-14B-Instruct or Llama-3.1-8B-Instruct, quantised) | Fits a 16–32 GB workstation; no data leaves the office |
| OCR | Tesseract `nep+eng` (as now); optionally a Devanagari-trained TrOCR/PaddleOCR model later | Already proven on these sources |
| Document store | Local filesystem `data/originals/{source}/{id}.pdf` + SHA-256 | Keeps originals for citation |

### RAG rules (to meet spec §8)
1. Retrieve passages from statutes, NKP headnotes/paragraphs and SC texts. Every passage carries its source id + paragraph.
2. The LLM may only **quote and organise** retrieved passages. Each sentence must cite a passage id, and sentences without a citation are dropped by a post-check.
3. Output is labelled "AI-assisted research note — not a judicial holding". Holdings are shown only as quoted headnotes.
4. A conflicting-authority check groups retrieved precedents on the same provision and flags contrary outcomes for the lawyer.
5. The law-as-on-date check (doc 6) runs before any statutory answer.

### Privacy model
- Public legal data: may be hosted publicly (as now).
- Client documents: local machine only, processed by the browser tool or the local LLM. External AI APIs are used **only** if the user explicitly enables them for a given file, with a visible warning.

## Hardware estimate
- Search + database only: any laptop (8 GB RAM).
- Local embeddings for ~11k decisions (~200M characters): a few hours on CPU, once.
- Local LLM: 16 GB RAM for 8B (Q4), 32 GB for 14B; a GPU with 12 GB+ VRAM makes it interactive.
