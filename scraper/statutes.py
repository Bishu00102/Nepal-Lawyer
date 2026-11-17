"""Nepal statutes from the Nepal Law Commission (official consolidated texts).

Source: https://lawcommission.gov.np — volumes (खण्ड) of Acts, the Constitution, codes outside
the volumes, recent Acts and Ordinances. Each law has a page with a PDF of the latest
consolidated text (incorporating amendments up to the date the Commission last updated it).

Two steps:
  1. catalogue  — every law on the site: title, year, volume, page URL, PDF URL  (table `acts`)
  2. full text  — for the criminal-law priority list (and any act you pass with --act), download
                  the PDF, OCR it (the PDFs' text layers use legacy fonts and are garbled), then split
                  it into भाग / परिच्छेद / दफा (table `sections`). The front page gives the Act number,
                  authentication date and the list of amending Acts with dates (table `amendments`).
                  Footnote / marker lines naming an amending Act are kept with the section they belong to.

Historical versions: the Commission publishes only the current consolidated text. For a date
before the latest amendment, the site flags which sections were amended after that date so the
lawyer can check the earlier text in the Nepal Gazette (राजपत्र). Nothing is reconstructed by guesswork.

Usage:
    python scraper/statutes.py catalogue
    python scraper/statutes.py text                 # priority criminal-law list
    python scraper/statutes.py text --act "प्रमाण ऐन"   # any act by (part of) its title
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "statutes.db"
PDF_DIR = ROOT / "data" / "statute_pdfs"
TXT_DIR = ROOT / "data" / "statute_texts"
SITE = "https://lawcommission.gov.np"
UA = "NepalCourtTracker/1.0 (public statute reader)"
DEV = str.maketrans("०१२३४५६७८९", "0123456789")
LAT2DEV = str.maketrans("0123456789", "०१२३४५६७८९")

# category id -> label
CATEGORIES = {**{str(c): f"खण्ड {i}" for i, c in enumerate(
    [1762, 1763, 1764, 1765, 1766, 1767, 1768, 1769, 1783, 1784, 1785, 1786, 1787, 1788, 1789, 1790, 1791], 1)},
              "1807": "संविधान", "2166": "खण्ड बाहेकका ऐन", "2163": "हालसालैका ऐन", "1809": "अध्यादेश"}

# Criminal-justice priority list (PDF spec §3A–D). Matched against catalogue titles.
PRIORITY = [
    ("नेपालको संविधान", "constitution"),
    ("मुलुकी अपराध संहिता", "substantive"),
    ("मुलुकी फौजदारी कार्यविधि संहिता", "procedure"),
    ("फौजदारी कसूर (सजाय निर्धारण तथा कार्यान्वयन) ऐन", "sentencing"),
    ("प्रमाण ऐन", "evidence"),
    ("अपराध पीडित संरक्षण ऐन", "victims"),
    ("भ्रष्टाचार निवारण ऐन", "corruption"),
    ("अख्तियार दुरूपयोग अनुसन्धान आयोग ऐन", "corruption"),
    ("सम्पत्ति शुद्धीकरण", "money laundering"),
    ("लागू औषध (नियन्त्रण) ऐन", "narcotics"),
    ("मानव बेचबिखन तथा ओसारपसार (नियन्त्रण) ऐन", "trafficking"),
    ("सङ्गठित अपराध निवारण ऐन", "organised crime"),
    ("विद्युतीय (इलेक्ट्रोनिक) कारोबार ऐन", "cybercrime"),
    ("हातहतियार खरखजाना ऐन", "arms"),
    ("बैङ्किङ्ग कसूर तथा सजाय ऐन", "banking"),
    ("राष्ट्रिय निकुञ्ज तथा वन्यजन्तु संरक्षण ऐन", "wildlife"),
    ("बालबालिका सम्बन्धी ऐन", "children"),
    ("घरेलु हिंसा (कसूर र सजाय) ऐन", "domestic violence"),
    ("कालोबजार तथा केही अन्य सामाजिक अपराध तथा सजाय ऐन", "social offences"),
    ("विशेष अदालत ऐन", "courts"),
    ("सरकारी मुद्दा सम्बन्धी ऐन", "prosecution"),
    ("न्याय प्रशासन ऐन", "courts"),
    ("सार्वजनिक खरिद ऐन", "procurement"),
    ("नागरिकता ऐन", "citizenship"),
    ("वैदेशिक रोजगार ऐन", "foreign employment"),
    ("राजस्व चुहावट (अनुसन्धान तथा नियन्त्रण) ऐन", "revenue"),
    ("यातना सम्बन्धी क्षतिपूर्ति ऐन", "torture"),
    ("सङ्कटापन्न वन्यजन्तु", "wildlife"),
    ("सार्वजनिक अपराध", "public offences"),
    ("प्रहरी ऐन", "police"),
    ("पारस्परिक कानूनी सहायता ऐन", "mutual legal assistance"),
    ("सुपुर्दगी ऐन", "extradition"),
    ("मुलुकी देवानी संहिता", "civil (reference)"),
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS acts (
    id INTEGER PRIMARY KEY,          -- Law Commission content id
    title TEXT, year_bs INTEGER, category TEXT, page_url TEXT, pdf_url TEXT,
    area TEXT,                       -- priority area tag, if on the criminal-law list
    act_no TEXT, authenticated TEXT, commencement TEXT,
    pages INTEGER, sections_count INTEGER, text_method TEXT, fetched_at TEXT, error TEXT,
    gaps TEXT                        -- section numbers not found by the parser (check the PDF)
);
CREATE TABLE IF NOT EXISTS amendments (
    act_id INTEGER, seq INTEGER, title TEXT, date_bs TEXT, PRIMARY KEY (act_id, seq)
);
CREATE TABLE IF NOT EXISTS sections (
    act_id INTEGER, seq INTEGER,
    part TEXT, chapter TEXT,         -- भाग / परिच्छेद heading (as printed)
    number TEXT,                     -- दफा number in Latin digits e.g. 177, 3क
    heading TEXT, body TEXT,
    amended_by TEXT,                 -- amendment markers found in this section, if any
    PRIMARY KEY (act_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_sec ON sections(act_id, number);
"""


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(s: requests.Session, url: str, binary=False):
    last = None
    for attempt in range(5):
        try:
            r = s.get(url, timeout=120)
            if r.status_code == 404:
                raise FileNotFoundError(url)
            r.raise_for_status()
            if binary:
                return r.content
            r.encoding = "utf-8"
            return r.text
        except requests.RequestException as e:
            last = e
            time.sleep(4 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def session():
    s = requests.Session()
    s.headers["User-Agent"] = UA
    return s


def area_of(title: str) -> str | None:
    t = title.replace("\u200d", "").replace("\u200c", "")
    return next((a for k, a in PRIORITY if k in t), None)


def retag(con):
    for aid, title in con.execute("SELECT id,title FROM acts").fetchall():
        con.execute("UPDATE acts SET area=? WHERE id=?", (area_of(title), aid))
    con.commit()


# ---------------------------------------------------------------- catalogue
def catalogue(con):
    s = session()
    content: dict[str, str] = {}
    for cat, label in CATEGORIES.items():
        seen_any, page = set(), 1
        while page < 40:
            url = f"{SITE}/category/{cat}/" + (f"?page={page}" if page > 1 else "")
            try:
                soup = BeautifulSoup(get(s, url), "lxml")
            except FileNotFoundError:
                break
            links = set()
            for a in soup.find_all("a", href=True):
                h = a["href"].strip()
                if re.search(r"/content/\d+/", h):
                    links.add(urljoin(SITE, h))
            new = links - seen_any
            # the sidebar repeats the same few items on every page; stop when nothing new appears
            if page > 1 and not (new - set(content)):
                break
            for l in new:
                content.setdefault(l, label)
            seen_any |= links
            page += 1
        log(f"{label}: {len(seen_any)} links")
    log(f"{len(content)} content pages; reading titles…")

    def one(item):
        url, label = item
        try:
            soup = BeautifulSoup(get(session(), url), "lxml")
            h1 = soup.find("h1", class_="news__title") or soup.find("h1")
            title = h1.get_text(" ", strip=True) if h1 else ""
            # Two upload patterns are used; the sidebar's "legal maxims" PDF appears on every page.
            pdfs = [u for u in re.findall(r"https?://giwmscdn[^\"' ]+?\.pdf", str(soup), re.I)
                    if "1714977234_32" not in u]
            # some pages carry both the Nepali text and an English translation: prefer the Nepali one
            from urllib.parse import unquote
            pdfs.sort(key=lambda u: (bool(re.search(r"english|\beng\b", unquote(u), re.I)),
                                     not re.search(r"[\u0900-\u097F]", unquote(u))))
            return url, label, title, pdfs[0] if pdfs else ""
        except Exception as e:
            return url, label, "", f"ERR {e}"

    with ThreadPoolExecutor(4) as pool:
        rows = list(pool.map(one, content.items()))
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    n = 0
    for url, label, title, pdf in rows:
        if not title or not pdf or pdf.startswith("ERR"):
            continue
        if not re.search(r"ऐन|संहिता|संविधान|अध्यादेश|ordinance", title):
            continue
        cid = int(re.search(r"/content/(\d+)/", url).group(1))
        ym = re.search(r"([०-९]{4}|20\d\d)\s*$", title.strip(" ।"))
        year = int(ym.group(1).translate(DEV)) if ym else None
        area = area_of(title)
        con.execute("""INSERT INTO acts (id,title,year_bs,category,page_url,pdf_url,area,fetched_at)
                       VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                       year_bs=excluded.year_bs,category=excluded.category,pdf_url=excluded.pdf_url,
                       area=excluded.area""", (cid, title, year, label, url, pdf, area, now))
        n += 1
    con.commit()
    log(f"catalogue: {n} laws stored")


# ---------------------------------------------------------------- text
def ocr_pdf(pdf: Path) -> str:
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
    pages = int(re.search(r"Pages:\s+(\d+)", info).group(1))
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}

    def page(p):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "p"
            subprocess.run(["pdftoppm", "-r", "250", "-gray", "-f", str(p), "-l", str(p), "-png", "-singlefile",
                            str(pdf), str(base)], capture_output=True, timeout=300)
            png = base.with_suffix(".png")
            if not png.exists():
                return ""
            return subprocess.run(["tesseract", str(png), "-", "-l", "nep+eng", "--psm", "6"],
                                  capture_output=True, text=True, env=env, timeout=600).stdout

    with ThreadPoolExecutor(4) as pool:
        texts = list(pool.map(page, range(1, pages + 1)))
    return "\f".join(texts), pages


SEC_RE = re.compile(r"^\s*[«»*%&~#@$+×✽♦•\"'‘’“”|_©^]{0,3}\s*([०-९0-9]{1,4})([क-ह]?)\s*[.,]\s*(\S.+)$")
# OCR sometimes garbles the number itself ("3%." for "३९."): accepted only with a "heading:" line, numbered in sequence
GARBLED_RE = re.compile(r"^\s*([०-९0-9][०-९0-9%$&?@#Sगज]{0,3})\s*[.,]\s*([^:ः\d]{3,90}[:ः].*)$")
PART_RE = re.compile(r"^\s*भाग\s*[-–]?\s*([०-९0-9]+)\s*$")
CHAP_RE = re.compile(r"^\s*परिच्छेद\s*[-–]?\s*([०-९0-9]+)\s*$")
AMEND_MARK = re.compile(r"((?:[^\n।]{0,60})संशोधन गर्ने (?:ऐन|अध्यादेश)[^।\n]{0,10}[०-९0-9]{4}\s*द्वारा\s*(?:संशोधित|थपिएको|झिकिएको))|"
                        r"((?:पहिलो|दोस्रो|तेस्रो|चौथो|पाँचौं)\s*संशोधनद्वारा\s*(?:संशोधित|थपिएको|थप|झिकिएको))")
NOISE = re.compile(r"www\.lawcommission\.gov\.np|^\s*[०-९0-9]{1,3}\s*$")
DATE_RE = re.compile(r"([०-९0-9]{4})\s*[।/.\-]\s*([०-९0-9]{1,2})\s*[।/.\-]\s*([०-९0-9]{1,2})")


def _date(s: str) -> str:
    m = None
    for m in DATE_RE.finditer(s):
        pass
    if not m:
        return ""
    y, mo, d = (int(x.translate(DEV)) for x in m.groups())
    return f"{y}-{mo:02d}-{d:02d}" if 1950 < y < 2200 and 1 <= mo <= 12 and 1 <= d <= 32 else ""


def parse_front(lines: list[str]) -> dict:
    front = lines[:90]
    joined = "\n".join(front)
    act_no = ""
    m = re.search(r"([०-९0-9]{4})\s*सालको\s*ऐन\s*नं\.?\s*([०-९0-9]+)", joined)
    if m:
        act_no = f"{m.group(1).translate(LAT2DEV)} सालको ऐन नं. {m.group(2).translate(LAT2DEV)}"
    auth = ""
    for i, l in enumerate(front):
        if re.search(r"(प्रमाणीकरण|लालमोहर)\s*(र\s*प्रकाशन)?\s*मिति", l):
            auth = _date(l) or (_date(front[i + 1]) if i + 1 < len(front) else "")
            if auth:
                break
    # amendment list: numbered items between the "संशोधन गर्ने ऐन" header and the "सालको ऐन नं" line
    amendments = []
    try:
        start = next(i for i, l in enumerate(front) if re.fullmatch(r"\s*संशोधन गर्ने ऐन\S*\s*", l))
        end = next(i for i, l in enumerate(front) if i > start and re.search(r"सालको\s*ऐन\s*नं|प्रस्तावना", l))
        item = ""
        for l in front[start + 1:end] + ["१. "]:
            if re.search(r"प्रमाणीकरण|लालमोहर|प्रकाशन मिति", l) and not re.match(r"\s*[०-९0-9]+\.", l):
                continue
            if re.match(r"\s*[०-९0-9]{1,2}\.\s", l):
                if item:
                    date = _date(item)
                    title = DATE_RE.sub("", item)
                    title = re.sub(r"^\s*[०-९0-9]{1,2}\.\s*", "", title)
                    title = re.sub(r"(ऐन|अध्यादेश),\s*([०-९]{4})[०-९0-9]*", r"\1, \2", title).strip(" ,")
                    amendments.append({"title": re.sub(r"\s+", " ", title), "date": date})
                item = l
            else:
                item += " " + l
    except StopIteration:
        pass
    return {"act_no": act_no, "authenticated": auth, "amendments": amendments}


def parse_act(text: str) -> dict:
    lines = [l.rstrip() for l in text.replace("\f", "\n").split("\n")]
    lines = [l for l in lines if l.strip() and not NOISE.search(l)]
    meta = parse_front(lines)
    commencement = ""
    m = re.search(r"([^\n।]{0,50}गतेदेखि\s*प्रारम्भ\s*हुनेछ)", text)
    if m:
        commencement = m.group(1).strip(" ()०-९0-9")

    sections, cur = [], None
    part = chapter = ""
    want_chapter_title = False
    prev = 0
    # the body starts at the preamble (or the first भाग/परिच्छेद); before that is the front page
    body_start = next((i for i, l in enumerate(lines) if re.match(r"\s*(प्रस्तावना|भाग\s*[-–]?\s*[०-९0-9]|परिच्छेद)", l)), 0)
    for l in lines[body_start:]:
        st = l.strip()
        if PART_RE.match(st):
            part = st
            continue
        if CHAP_RE.match(st):
            chapter, want_chapter_title = st, True
            continue
        m = SEC_RE.match(st)
        gm = None if m else GARBLED_RE.match(st)
        if gm and prev and not re.fullmatch(r"[०-९0-9]+", gm.group(1)):
            heading, body = re.split(r"[:ः]", gm.group(2), maxsplit=1)
            cur = {"part": part, "chapter": chapter, "number": str(prev + 1), "heading": heading.strip(" -–—_"),
                   "body": body.strip(" -–—"), "uncertain": True}
            sections.append(cur)
            prev += 1
            want_chapter_title = False
            continue
        if want_chapter_title and not m:
            chapter = f"{chapter} — {st}"
            want_chapter_title = False
            continue
        want_chapter_title = False
        if m:
            digits, letter, rest = m.group(1).translate(DEV), m.group(2), m.group(3)
            n = int(digits)
            has_colon = bool(re.search(r"^[^:ः]{2,150}[:ः]", rest))
            # repair numbers where an amendment symbol was read as leading digits (e.g. 743 -> 43, 5125 -> 125)
            if n > prev + 40 and len(digits) > 1:
                for k in range(len(digits) - 1, 0, -1):
                    cand = int(digits[-k:])
                    if prev < cand <= prev + 40:
                        n = cand
                        break
            looks_heading = len(rest) < 220 and re.match(r"[\u0900-\u097F]", rest)
            # numbers only increase; a "heading:" line may skip ahead (sections whose numbers OCR misread)
            plausible = (n == prev + 1) or (n == prev and letter) or (prev < n <= prev + 40 and has_colon) \
                or (prev < n <= prev + 3 and looks_heading) or (prev == 0 and n <= 3)
            if plausible:
                if has_colon:
                    heading, body = re.split(r"[:ः]", rest, maxsplit=1)
                else:
                    parts_ = re.split(r"(?=\([०-९0-9]\))", rest, maxsplit=1)
                    heading, body = (parts_[0], parts_[1]) if len(parts_) == 2 else (rest[:80], rest[80:])
                cur = {"part": part, "chapter": chapter, "number": f"{n}{letter}",
                       "heading": heading.strip(" -–—_"), "body": body.strip(" -–—")}
                sections.append(cur)
                prev = n
                continue
        if cur is not None:
            cur["body"] += "\n" + st
    for sec in sections:
        marks = sorted({x.group(0).strip() for x in AMEND_MARK.finditer(sec["body"])})
        sec["amended_by"] = " ; ".join(marks)
    nums = [int(re.match(r"\d+", x["number"]).group()) for x in sections]
    gaps = [k for k in range(1, max(nums) + 1) if k not in set(nums)] if nums else []
    return {**meta, "commencement": commencement, "sections": sections, "gaps": gaps}


def mostly_english(t: str) -> bool:
    return len(re.findall(r"[A-Za-z]", t)) > 0.3 * len(re.findall(r"[\u0900-\u097F]", t))


def nepali_alternative(s, page_url: str, current: str) -> str | None:
    """Some pages carry the Nepali text and an English translation with uninformative file names:
    read page 1 of each other PDF and return the first one that is in Nepali."""
    html = get(s, page_url)
    for u in dict.fromkeys(re.findall(r"https?://giwmscdn[^\"' ]+?\.pdf", html, re.I)):
        if u == current or "1714977234_32" in u:
            continue
        with tempfile.TemporaryDirectory() as td:
            f = Path(td) / "x.pdf"
            f.write_bytes(get(s, u, binary=True))
            subprocess.run(["pdftoppm", "-r", "150", "-gray", "-f", "1", "-l", "1", "-png", "-singlefile", str(f),
                            str(Path(td) / "p")], capture_output=True, timeout=300)
            first = subprocess.run(["tesseract", str(Path(td) / "p.png"), "-", "-l", "nep+eng"], capture_output=True,
                                   text=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"}).stdout
            if not mostly_english(first):
                return u
    return None


def text(con, act_filter: str | None, redo: bool):
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    TXT_DIR.mkdir(parents=True, exist_ok=True)
    if act_filter:
        rows = con.execute("SELECT id,title,pdf_url FROM acts WHERE title LIKE ?", (f"%{act_filter}%",)).fetchall()
    else:
        rows = con.execute("SELECT id,title,pdf_url FROM acts WHERE area IS NOT NULL").fetchall()
        # keep only the main act for each priority entry (not amending acts / ordinances that share words)
        rows = [r for r in rows if not re.search(r"संशोधन|अध्यादेश|नियमावली", r[1])]
    s = session()
    for aid, title, pdf_url in rows:
        txt = TXT_DIR / f"{aid}.txt"
        src = TXT_DIR / f"{aid}.src"          # the PDF URL the text was made from
        changed = src.exists() and src.read_text().strip() != pdf_url
        try:
            if changed:
                log(f"{title}: Law Commission published a new PDF — re-reading")
                (PDF_DIR / f"{aid}.pdf").unlink(missing_ok=True)
            if txt.exists() and not redo and not changed:
                t = txt.read_text(encoding="utf-8")
                pages = t.count("\f") + 1
            else:
                pdf = PDF_DIR / f"{aid}.pdf"
                if not pdf.exists():
                    pdf.write_bytes(get(s, pdf_url, binary=True))
                log(f"OCR {title} …")
                t, pages = ocr_pdf(pdf)
                txt.write_text(t, encoding="utf-8")
                src.write_text(pdf_url)
            if mostly_english(t):
                page_url = con.execute("SELECT page_url FROM acts WHERE id=?", (aid,)).fetchone()[0]
                alt = nepali_alternative(s, page_url, pdf_url)
                if alt:
                    log(f"  {title}: text was the English translation — switching to the Nepali PDF")
                    con.execute("UPDATE acts SET pdf_url=? WHERE id=?", (alt, aid))
                    con.commit()
                    pdf = PDF_DIR / f"{aid}.pdf"
                    pdf.write_bytes(get(s, alt, binary=True))
                    t, pages = ocr_pdf(pdf)
                    txt.write_text(t, encoding="utf-8")
                    src.write_text(alt)
            p = parse_act(t)
            con.execute("DELETE FROM sections WHERE act_id=?", (aid,))
            con.execute("DELETE FROM amendments WHERE act_id=?", (aid,))
            for i, sec in enumerate(p["sections"]):
                con.execute("INSERT INTO sections VALUES (?,?,?,?,?,?,?,?)",
                            (aid, i, sec["part"], sec["chapter"], sec["number"], sec["heading"], sec["body"],
                             sec["amended_by"]))
            for i, a in enumerate(p["amendments"]):
                con.execute("INSERT INTO amendments VALUES (?,?,?,?)", (aid, i, a["title"], a["date"]))
            con.execute("""UPDATE acts SET act_no=?,authenticated=?,commencement=?,pages=?,sections_count=?,
                           text_method='ocr',error=?,gaps=? WHERE id=?""",
                        (p["act_no"], p["authenticated"], p["commencement"], pages, len(p["sections"]),
                         "", ",".join(map(str, p["gaps"])), aid))
            con.commit()
            log(f"  {title}: {len(p['sections'])} sections, {len(p['amendments'])} amendments, {p['act_no']}, "
                f"gaps: {p['gaps'][:15]}")
        except Exception as e:
            con.execute("UPDATE acts SET error=? WHERE id=?", (str(e)[:300], aid))
            con.commit()
            log(f"  {title}: ERROR {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["catalogue", "text", "reparse"])
    ap.add_argument("--act")
    ap.add_argument("--redo", action="store_true")
    args = ap.parse_args()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    if "gaps" not in [r[1] for r in con.execute("PRAGMA table_info(acts)")]:
        con.execute("ALTER TABLE acts ADD COLUMN gaps TEXT")
    if args.step == "reparse":
        for aid, in con.execute("SELECT id FROM acts WHERE sections_count IS NOT NULL").fetchall():
            pass
    if args.step == "catalogue":
        catalogue(con)
    else:
        retag(con)
        text(con, args.act, args.redo)


if __name__ == "__main__":
    main()
