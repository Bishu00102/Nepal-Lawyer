# 11. Estimated storage requirements

_Measured on the collected data; projections below._

| Component | Size now |
|---|---|
| Cause lists + publications metadata (court.db) | 10.8 MB |
| SC publications OCR text | 24.0 MB |
| SC publications original PDFs (not committed) | 2,129.4 MB |
| NKP archive (git shards, compressed) | 89.0 MB |
| NKP SQLite (rebuilt locally) | 122.5 MB |
| Statutes DB + OCR text | 12.8 MB |
| Statute PDFs (not committed) | 36.5 MB |
| Citation links (rebuilt) | 14.5 MB |
| Generated website data (gzip where large) | 142.8 MB |

## Projections
- Cause lists: ≈52 KB per court-day → all 19 courts × ~250 working days ≈ **248 MB per year** (database).
- NKP grows ~400–600 decisions a year → ~5 MB compressed per year.
- SC publication originals ≈ 6–7 MB per document; mirroring is optional (links kept).
- Full statute corpus (all ~390 laws OCR'd): ≈ 60 MB text; originals ≈ 450 MB.
- Decided-order PDFs (roadmap): ~20–40 criminal decisions/day at SC + HC ≈ 15–30 GB/year if mirrored, ≈ 0.5 GB/year as OCR text only.
- Local AI (doc 9): embeddings for 11k decisions split into ~400k paragraphs × 768 dims × 4 bytes ≈ **1.2 GB**; LLM weights 5–9 GB (quantised 8–14B).

**Recommended workstation:** 500 GB SSD, 32 GB RAM (16 GB without a local LLM). **Hosting the public site:** < 1 GB (GitHub Pages limit), currently well within.
