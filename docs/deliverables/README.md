# Deliverables (PDF spec §9)

| # | Document | Type |
|---|---|---|
| 1 | [Complete Nepal Criminal Law Data Inventory](01-data-inventory.md) | Generated from the live data (`scraper/report.py`) |
| 2 | [Master list of applicable criminal legislation](02-criminal-legislation-master-list.md) | Generated |
| 3 | [Supreme Court and High Court precedent collection strategy](03-precedent-collection-strategy.md) | Written |
| 4 | [Official data-source directory](04-official-source-directory.md) | Written (probed sources) |
| 5 | [Data collection and verification methodology](05-collection-and-verification-methodology.md) | Written |
| 6 | [Database schema and entity-relationship design](06-database-schema-and-erd.md) | Written (implemented + target) |
| 7 | [Legal document metadata structure](07-legal-document-metadata.md) | Written |
| 8 | [Nepali OCR and document processing strategy](08-nepali-ocr-and-document-processing.md) | Written (measured) |
| 9 | [Local AI architecture](09-local-ai-architecture.md) | Written (recommendation) |
| 10 | [Data collection priority roadmap](10-data-collection-priority-roadmap.md) | Written |
| 11 | [Estimated storage requirements](11-storage-estimates.md) | Generated (measured + projections) |
| 12 | [Development roadmap](12-development-roadmap.md) | Written |

Re-generate 1, 2 and 11 after any data update:

```bash
python scraper/report.py
```
