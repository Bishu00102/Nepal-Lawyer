"""Load the Supreme Court of Nepal's published judgments, orders and notices.

Source: the official homepage https://supremecourt.gov.np/web/ — tabs:
    #aades           फैसला / आदेश   (published judgments & orders, often with the नजिर सिद्धान्त)
    #antarimAadesh   अन्तरिम आदेश   (interim orders)
    #notice          सूचना          (notices, templates, habeas corpus notices)
    #latest-news     प्रेस विज्ञप्ति   (press releases)

For each document the original PDF/image is downloaded to data/pdfs/ (not committed),
its text is extracted to data/texts/<id>.txt and metadata goes into data/court.db.

Text extraction: the PDF's own text layer is used when it is real Unicode. Many court PDFs
are scans, or Word exports whose Devanagari text layer is garbled (legacy font mapping); those
are OCR'd with Tesseract (Nepali + English). OCR text is marked as such — it can contain errors,
so the original PDF is always linked.

Usage:
    python scraper/sc_publications.py            # fetch list, process new documents
    python scraper/sc_publications.py --redo     # re-extract text for all documents
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "court.db"
PDF_DIR = ROOT / "data" / "pdfs"
TXT_DIR = ROOT / "data" / "texts"
HOME = "https://supremecourt.gov.np/web/"
UA = "NepalCourtTracker/1.0 (public judgments reader)"

SECTIONS = {
    "aades": "फैसला / आदेश",
    "antarimAadesh": "अन्तरिम आदेश",
    "notice": "सूचना",
    "latest-news": "प्रेस विज्ञप्ति",
}
DEV = str.maketrans("०१२३४५६७८९", "0123456789")
# Words that appear in almost every genuine judgment; a garbled text layer has almost none of them.
COMMON = re.compile(r"अदालत|निवेदन|बमोजिम|विरुद्ध|न्यायाधीश|फैसला|आदेश|मुद्दा|नेपाल|ऐन|दफा|गरी|भएको")

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,          -- sha1(url)[:16]
    section TEXT,
    title TEXT,                   -- listing text from the court site
    principle TEXT,               -- bold text in the listing (नजिर सिद्धान्त / subject), if any
    url TEXT,
    case_no TEXT,                 -- normalised e.g. 083-WH-0005
    doc_date TEXT,                -- BS date mentioned in the title, YYYY-MM-DD
    kind TEXT,                    -- फैसला / आदेश / अन्तरिम आदेश / सूचना ...
    bench TEXT,                   -- संयुक्त इजलास / पूर्ण इजलास / संवैधानिक इजलास ...
    judges TEXT,                  -- '|' separated, from the document header
    pages INTEGER,
    text_method TEXT,             -- pdf-text / ocr / none
    text_chars INTEGER,
    first_seen TEXT,
    list_order INTEGER,
    error TEXT
);
"""


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ").replace("﻿", "")).strip()


def norm_case(text: str) -> str:
    t = text.translate(DEV).upper()
    m = re.search(r"(\d{3})\s*-\s*([A-Z]{2})\s*-\s*(\d{3,4})", t)
    return f"{m.group(1)}-{m.group(2)}-{int(m.group(3)):04d}" if m else ""


def norm_date(text: str) -> str:
    t = text.translate(DEV)
    m = re.search(r"मिति\s*:?\s*(20\d\d)\s*[।/\-.]\s*(\d{1,2})\s*[।/\-.]\s*(\d{1,2})", t)
    if not m:
        m = re.search(r"(20[6-9]\d)\s*[।/\-.]\s*(\d{1,2})\s*[।/\-.]\s*(\d{1,2})", t)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""


def kind_of(section: str, title: str) -> str:
    if section == "antarimAadesh":
        return "अन्तरिम आदेश"
    if section in ("notice", "latest-news"):
        return SECTIONS[section]
    if "फैसला" in title:
        return "फैसला"
    if "आदेश" in title:
        return "आदेश"
    return "अन्य"


# ---------------------------------------------------------------- listing
def fetch_listing(s: requests.Session) -> list[dict]:
    for attempt in range(5):
        try:
            r = s.get(HOME, timeout=90)
            r.raise_for_status()
            break
        except requests.RequestException as e:
            log(f"homepage retry {attempt + 1}: {e}")
            time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError("homepage not reachable")
    r.encoding = "utf-8"
    soup = BeautifulSoup(r.text, "lxml")
    out, seen = [], set()
    for sec in SECTIONS:
        pane = soup.find(id=sec)
        if not pane:
            continue
        for i, a in enumerate(pane.find_all("a", href=True)):
            href = a["href"].strip()
            if href.startswith("#") or not href:
                continue
            url = urljoin(HOME, href).replace("/web/index.php/../", "/web/").replace("//judgements", "/judgements")
            if url in seen:
                continue
            seen.add(url)
            # The court's HTML sometimes leaves <a> tags unclosed, so later items end up nested
            # inside this one. Use only this anchor's own content, up to the first nested <a>/<li>.
            own = []
            for node in a.children:
                if getattr(node, "name", None) in ("a", "li", "ul"):
                    break
                own.append(node)
            principle = ""
            parts = []
            for node in own:
                if getattr(node, "name", None) == "b":
                    principle = clean(node.get_text(" ")).strip("() ।")
                else:
                    parts.append(node.get_text(" ") if hasattr(node, "get_text") else str(node))
            title = clean(" ".join(parts))
            if not title:
                continue
            out.append({
                "id": hashlib.sha1(url.encode()).hexdigest()[:16],
                "section": sec, "title": title, "principle": principle, "url": url,
                "case_no": norm_case(title), "doc_date": norm_date(title),
                "kind": kind_of(sec, title), "list_order": i,
            })
    return out


# ---------------------------------------------------------------- text extraction (runs in worker processes)
def download(url: str, dest: Path) -> None:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    last = None
    for attempt in range(5):
        try:
            r = s.get(url, timeout=120)
            r.raise_for_status()
            dest.write_bytes(r.content)
            return
        except requests.RequestException as e:
            last = e
            time.sleep(4 * (attempt + 1))
    raise RuntimeError(f"download failed: {last}")


def run(cmd: list[str], **kw) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=600, **kw).stdout


def ocr_image(path: Path) -> str:
    # One thread per Tesseract process: we already run several in parallel, and OpenMP
    # oversubscription makes Tesseract slow down by 100x or hang.
    return run(["tesseract", str(path), "-", "-l", "nep+eng", "--psm", "3"],
               env={**os.environ, "OMP_THREAD_LIMIT": "1"})


def page_images(src: Path) -> dict[int, int]:
    """Number of embedded images on each page (scans have exactly one full-page image)."""
    counts: dict[int, int] = {}
    for line in run(["pdfimages", "-list", str(src)]).splitlines()[2:]:
        f = line.split()
        if len(f) > 4 and f[0].isdigit() and f[2] == "image" and int(f[3]) > 800 and int(f[4]) > 800:
            counts[int(f[0])] = counts.get(int(f[0]), 0) + 1
    return counts


def ocr_pdf(src: Path, pages: int) -> list[str]:
    """OCR every page. For scans, pull the page image out directly (≈200x faster than
    rendering); for vector PDFs (e.g. Word exports with broken fonts) render the page."""
    imgs = page_images(src)
    parts = []
    with tempfile.TemporaryDirectory() as td:
        for p in range(1, min(pages, 150) + 1):
            base = Path(td) / f"p{p}"
            if imgs.get(p) == 1:
                subprocess.run(["pdfimages", "-j", "-png", "-f", str(p), "-l", str(p), str(src), str(base)],
                               capture_output=True, timeout=120)
            else:
                subprocess.run(["pdftoppm", "-r", "200", "-gray", "-f", str(p), "-l", str(p), "-png",
                                "-singlefile", str(src), str(base)], capture_output=True, timeout=300)
            files = sorted(Path(td).glob(f"p{p}*"), key=lambda f: f.stat().st_size, reverse=True)
            parts.append(ocr_image(files[0]) if files else "")
            for f in Path(td).glob(f"p{p}*"):
                f.unlink()
    return parts


STRICT = re.compile(r"अदालत|बमोजिम|न्यायाधीश|निवेदक|संविधान|विरुद्ध|सर्वोच्च")


def is_garbled(text: str) -> bool:
    """True when a PDF text layer is not usable Unicode Devanagari.

    Word exports with legacy font mappings produce words that start with a dependent vowel
    sign or virama (e.g. "ुदमलत" for "अदालत") and lose the common legal words entirely.
    Clean text has ~0% such words and several legal keywords per 1,000 characters.
    """
    words = [w for w in re.findall(r"\S+", text) if re.search(r"[\u0900-\u097F]", w)]
    if len(words) < 30:
        return True
    bad = sum(1 for w in words if re.match(r"[\u093E-\u094D\u0962\u0963]", w)) / len(words)
    strict = len(STRICT.findall(text)) * 1000 / max(len(text), 1)
    return bad > 0.03 or strict < 1.0


def extract(doc_id: str, url: str, redo: bool) -> dict:
    txt_path = TXT_DIR / f"{doc_id}.txt"
    res = {"id": doc_id, "pages": 0, "text_method": "none", "text_chars": 0, "error": ""}
    try:
        ext = ".pdf"
        low = url.lower().split("?")[0]
        for e in (".jpg", ".jpeg", ".png", ".docx", ".doc"):
            if low.endswith(e):
                ext = e
        src = PDF_DIR / f"{doc_id}{ext}"
        if not src.exists() or src.stat().st_size == 0:
            download(url, src)
        head = src.read_bytes()[:8]
        cached_method = (txt_path.with_suffix(".method").read_text()
                         if txt_path.with_suffix(".method").exists() else "pdf-text")
        if txt_path.exists() and not redo and not (
                cached_method == "pdf-text" and is_garbled(txt_path.read_text(encoding="utf-8"))):
            text = txt_path.read_text(encoding="utf-8")
            res.update(text_chars=len(text), text_method=cached_method)
            if head.startswith(b"%PDF"):
                m = re.search(r"Pages:\s+(\d+)", run(["pdfinfo", str(src)]))
                res["pages"] = int(m.group(1)) if m else 0
            return res
        if head.startswith(b"%PDF"):
            info = run(["pdfinfo", str(src)])
            m = re.search(r"Pages:\s+(\d+)", info)
            pages = int(m.group(1)) if m else 0
            res["pages"] = pages
            text = run(["pdftotext", "-layout", str(src), "-"])
            method = "pdf-text"
            if len(text.strip()) < 150 * max(pages, 1) or is_garbled(text):
                method = "ocr"
                parts = ocr_pdf(src, pages)
                text = "\f".join(parts)
        elif head[:3] == b"\xff\xd8\xff" or head.startswith(b"\x89PNG"):
            res["pages"] = 1
            text, method = ocr_image(src), "ocr"
        else:
            text, method = "", "none"
            res["error"] = "unsupported file type"
        text = re.sub(r"[ \t]+\n", "\n", text).strip()
        txt_path.write_text(text, encoding="utf-8")
        txt_path.with_suffix(".method").write_text(method)
        res.update(text_method=method, text_chars=len(text))
    except Exception as e:  # keep going; record the error
        res["error"] = str(e)[:300]
    return res


# ---------------------------------------------------------------- metadata from text
JUDGE_LINE = re.compile(r"(?:सम्माननीय|माननीय)\s*(?:प्रधान\s*|कायममुकायम\s*प्रधान\s*)?न्यायाधीश\s*(?:डा\.?\s*)?श्री\s*([^\n]+)")
BENCH = re.compile(r"(संवैधानिक इजलास|पूर्ण इजलास|पुर्ण इजलास|विशेष इजलास|संयुक्त इजलास|एकल इजलास)")


def header_meta(text: str) -> tuple[str, str]:
    head = text[:1500]
    judges = []
    for m in JUDGE_LINE.finditer(head):
        full = m.group(0)
        name = clean(re.sub(r"[^ऀ-ॿ .]", " ", m.group(1)))
        name = re.sub(r"\s{2,}", " ", name).strip(" .")
        if "डा" in full.split("श्री")[0]:
            name = "डा. " + name
        if 2 < len(name) < 40 and name not in judges:
            judges.append(name)
    b = BENCH.search(head)
    bench = b.group(1).replace("पुर्ण", "पूर्ण") if b else ""
    return bench, "|".join(judges)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--redo", action="store_true", help="re-extract text for every document")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--recheck", action="store_true",
                    help="re-check documents whose PDF text layer was used; OCR those that are garbled")
    args = ap.parse_args()

    for d in (PDF_DIR, TXT_DIR):
        d.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)

    s = requests.Session()
    s.headers["User-Agent"] = UA
    items = fetch_listing(s)
    log(f"{len(items)} documents listed on the homepage")
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    for it in items:
        con.execute("""INSERT INTO documents (id,section,title,principle,url,case_no,doc_date,kind,first_seen,list_order)
                       VALUES (:id,:section,:title,:principle,:url,:case_no,:doc_date,:kind,:now,:list_order)
                       ON CONFLICT(id) DO UPDATE SET section=excluded.section,title=excluded.title,
                       principle=excluded.principle,case_no=excluded.case_no,doc_date=excluded.doc_date,
                       kind=excluded.kind,list_order=excluded.list_order""", {**it, "now": now})
    con.commit()

    todo = [r for r in con.execute(
        "SELECT id,url FROM documents" + ("" if args.redo else
                                          " WHERE text_method IS NULL OR text_method='none' OR error<>''"
                                          + (" OR text_method='pdf-text'" if args.recheck else "")))]
    if args.limit:
        todo = todo[: args.limit]
    log(f"{len(todo)} documents to process")
    done = 0
    with ProcessPoolExecutor(args.workers) as pool:
        futs = {pool.submit(extract, i, u, args.redo): i for i, u in todo}
        for f in as_completed(futs):
            r = f.result()
            text = (TXT_DIR / f"{r['id']}.txt").read_text(encoding="utf-8") if (TXT_DIR / f"{r['id']}.txt").exists() else ""
            bench, judges = header_meta(text)
            con.execute("""UPDATE documents SET pages=?,text_method=?,text_chars=?,error=?,bench=?,judges=?
                           WHERE id=?""", (r["pages"], r["text_method"], r["text_chars"], r["error"], bench, judges, r["id"]))
            con.commit()
            done += 1
            log(f"[{done}/{len(todo)}] {r['id']} {r['text_method']} {r['pages']}p {r['text_chars']}ch {r['error']}")


if __name__ == "__main__":
    main()
