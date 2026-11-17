# 8. Nepali OCR and document processing strategy

## What the sources actually look like (measured)

| Source | Share | Problem |
|---|---|---|
| NKP | 100% Unicode HTML | None; used as-is |
| SC homepage PDFs | ~307 of 318 needed OCR | Scans (Epson scanner JPEG pages) **or** Word exports whose embedded Devanagari font has a broken ToUnicode map, so the text layer reads "ुदमलत" for "अदालत" |
| Law Commission statutes | All 31 parsed acts needed OCR | Word PDFs mixing Kalimati (broken map), Preeti (legacy ASCII font) and Times New Roman |
| Cause lists | HTML | None |

## Decision procedure per file

```
PDF?
├─ pdftotext → is it real Unicode Devanagari?
│     garbled if  > 3% of Devanagari words start with a vowel sign/virama
│              or < 1 core legal word (अदालत, बमोजिम, न्यायाधीश, निवेदक, संविधान, विरुद्ध, सर्वोच्च) per 1,000 chars
│     yes → use the text layer
│     no  → OCR
└─ OCR:
      page has exactly one full-page image (scan) → pdfimages extracts it (≈0.03 s/page; 200× faster than rendering)
      otherwise (vector Word PDF)                 → pdftoppm 200–250 dpi greyscale
      Tesseract 5, languages nep+eng
        judgments: --psm 3 (automatic layout)
        statutes:  --psm 6 (uniform block: keeps "१२. शीर्षक:" on one line; psm 3/4 split numbers into a column)
      OMP_THREAD_LIMIT=1 per process, 4 processes in parallel (OpenMP oversubscription made Tesseract hang)
Image (JPG/PNG notice) → Tesseract directly
```

## Preeti and other legacy fonts
Two routes exist:
1. **Map conversion** (Preeti→Unicode tables). This only works when the PDF really contains Preeti code points. In the Law Commission PDFs, Preeti is mixed with Kalimati, whose map is broken *ambiguously* (one glyph code for several characters, e.g. "ि" for both "ह" and "भ"), so table conversion cannot be correct.
2. **OCR the rendered page**, which is what the pipeline does. It is font-independent, and measured quality on these documents is high for running text.

A Preeti→Unicode converter is still worth adding for user-supplied documents (typed FIRs and petitions in Preeti `.docx`); see the roadmap.

## Post-processing
- Leader lines ("……", "-----") that OCR turns into digit noise (`22211117171…`) are collapsed.
- Statute OCR line-wraps are re-joined except before clause markers `(१)`, `(क)`, `स्पष्टीकरण`, `तर`.
- Section numbers: monotonic-sequence repair (amendment symbols read as digits: `५२१`→`२१`); unread numbers are reported as **gaps** on each act page.
- Latin case numbers inside Devanagari scans OCR badly (`083-WH-0005` → `OG3-WH-O0OY¥`), so case numbers always come from the listing metadata, never from OCR.

## Quality controls
- Every OCR document carries `text_method = ocr` and the site shows a warning with the original PDF link.
- Spot checks: Evidence Act front matter (Act no. २४, 5 amending acts with dates) parsed correctly; section headings verified against the PDF.
- Unicode normalisation for search: Latin/Devanagari digits unified, zero-width joiners ignored, ू/ु and ी/ि treated as equal for matching (common spelling variation in court texts).

## Throughput (measured, 4 cores)
- SC publications: 4,682 pages in ≈70 min.
- Statutes: ≈1,500 pages in ≈30 min at 250 dpi.
- NKP: no OCR; ≈10,600 pages fetched in ≈2.5 h at 3 polite connections.
