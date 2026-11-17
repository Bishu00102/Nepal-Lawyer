"""Load reported Supreme Court precedents from Nepal Kanoon Patrika (नेपाल कानून पत्रिका).

Source: https://nkp.gov.np/full_detail/<id> — the official law report published by the
Supreme Court of Nepal. Pages are real Unicode HTML (no OCR needed).

For every decision we keep:
  निर्णय नं. (NKP decision number), NKP citation (भाग / साल / महिना / अंक), decision date,
  court & bench type, judges, case numbers, parties, the NKP headnotes (सिद्धान्त) with their
  paragraph references (प्रकरण नं.), counsel, precedents relied on (अवलम्बित नजिर),
  related law (सम्बद्ध कानून), lower-court judges, and the full text.

Everything is stored in data/nkp.db. Nothing is summarised or generated.

Usage:
    python scraper/nkp.py                 # fetch IDs not yet stored (first run: ~2 hours)
    python scraper/nkp.py --from 10500    # only IDs >= 10500
    python scraper/nkp.py --refresh-latest 200   # re-check the newest 200 IDs for new decisions
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "nkp.db"
BASE = "https://nkp.gov.np/full_detail/"
UA = "NepalCourtTracker/1.0 (public law-report reader)"
DEV = str.maketrans("०१२३४५६७८९", "0123456789")
MONTHS = {"बैशाख": 1, "वैशाख": 1, "जेष्ठ": 2, "जेठ": 2, "असार": 3, "आषाढ": 3, "श्रावण": 4, "साउन": 4,
          "भाद्र": 5, "भदौ": 5, "असोज": 6, "आश्विन": 6, "कार्तिक": 7, "मंसिर": 8, "मङ्सिर": 8, "मार्ग": 8,
          "पौस": 9, "पुस": 9, "पौष": 9, "माघ": 10, "फागुन": 11, "फाल्गुन": 11, "चैत्र": 12, "चैत": 12}

SCHEMA = """
CREATE TABLE IF NOT EXISTS nkp (
    id INTEGER PRIMARY KEY,         -- nkp.gov.np page id
    decision_no INTEGER,            -- निर्णय नं.
    title TEXT,                     -- subject in the heading
    volume INTEGER,                 -- भाग
    year INTEGER,                   -- साल (BS) of the NKP issue
    month TEXT,
    month_no INTEGER,
    issue INTEGER,                  -- अंक
    citation TEXT,                  -- e.g. ने.का.प. २०८२, अंक १२, नि.नं. ११५२०
    decision_date TEXT,             -- YYYY-MM-DD (BS)
    court TEXT,
    bench TEXT,
    judges TEXT,                    -- '|' separated
    case_nos TEXT,                  -- '|' separated, normalised e.g. 074-CR-0171
    case_types TEXT,                -- '|' of codes e.g. CR
    parties TEXT,                   -- raw party lines joined by ' ¶ '
    headnotes TEXT,                 -- JSON list of {"text":..., "para":"८"}
    counsel TEXT,
    relied TEXT,                    -- अवलम्बित नजिर
    related_law TEXT,               -- सम्बद्ध कानून
    lower_courts TEXT,
    criminal INTEGER,
    text_z BLOB,                    -- zlib-compressed full text
    chars INTEGER,
    fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS nkp_missing (id INTEGER PRIMARY KEY, checked_at TEXT);
"""

CRIME_WORDS = re.compile(r"ज्यान|करणी|जालसाज|भ्रष्टाचार|घुस|रिसवत|लागु ?औषध|बेचबिखन|ओसारपसार|कसु[रू]|चोरी|डाँका|"
                         r"डाका|अपहरण|शरीर बन्धक|ठगी|बहुविवाह|बालविवाह|हातहतियार|खरखजाना|शुद्धीकरण|किर्ते|कीर्ते|"
                         r"कुटपिट|अंगभंग|अङ्गभङ्ग|आगजनी|गाली बेइज्जती|गर्भपतन|सवारी ज्यान|सम्पत्ति शुद्धीकरण|"
                         r"राज्यविरुद्ध|विस्फोटक|जुवा|वन्यजन्तु|अभियुक्त|अभियोग|बन्दीप्रत्यक्षीकरण")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def clean(s: str) -> str:
    s = s.replace("\xa0", " ").replace("‌", "").replace("‍", "")
    return re.sub(r"[ \t]+", " ", s).strip()


def norm_case(t: str) -> list[str]:
    t = t.translate(DEV).upper()
    return [f"{a}-{b}-{int(c):04d}" for a, b, c in re.findall(r"(\d{3})\s*-\s*([A-Z]{2})\s*-\s*(\d{1,5})", t)]


def parse(html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.select_one("#decision_summary h1")
    if not h1:
        return None
    head = clean(h1.get_text(" "))
    m = re.match(r"निर्णय नं\.?\s*([०-९0-9]+)\s*-?\s*(.*)", head)
    dec_no = int(m.group(1).translate(DEV)) if m else None
    title = m.group(2).strip() if m else head

    ed = {}
    for sp in soup.select("#edition-info span"):
        k = clean(sp.get_text(" ")).split(":")[0].strip()
        v = sp.find("strong")
        ed[k] = clean(v.get_text()) if v else ""
    meta = clean(soup.select_one("#decision_summary .post-meta").get_text(" ")) if soup.select_one(
        "#decision_summary .post-meta") else ""
    dm = re.search(r"([०-९0-9]{4})\s*[/।.\-]\s*([०-९0-9]{1,2})\s*[/।.\-]\s*([०-९0-9]{1,2})", meta)
    ddate = ""
    if dm:
        y, mo, d = (int(x.translate(DEV)) for x in dm.groups())
        ddate = f"{y}-{mo:02d}-{d:02d}"

    body = soup.find(id=re.compile(r"^faisala_detail"))
    if body is None:
        return None
    paras = [clean(p.get_text(" ")) for p in body.find_all(["p", "div", "li"], recursive=True)
             if not p.find(["p", "div"])]
    paras = [p for p in paras if p]
    full_text = "\n".join(paras)

    # header block = everything before the judgment proper starts
    stop = next((i for i, p in enumerate(paras) if p in ("फैसला", "आदेश", "निर्णय") or re.match(r"^न्या\.\s?\S+.*:", p)), len(paras))
    header = paras[:stop]

    court = next((p for p in header[:4] if "अदालत" in p or "बेञ्च" in p or "बेन्च" in p or "इजलास" in p), "")
    bench = ""
    bm = re.search(r"(संवैधानिक इजलास|वृहद पूर्ण इजलास|विशेष इजलास|पूर्ण इजलास|संयुक्त इजलास|एकल इजलास|"
                   r"डिभिजन बेञ्च|फुल बेञ्च|फूल बेञ्च|स्पेशल बेञ्च|सिङ्गल बेञ्च)", " ".join(header[:4]))
    if bm:
        bench = bm.group(1)

    judges = []
    lower_idx = next((i for i, p in enumerate(header) if p.startswith("सुरू तह") or "तहमा फैसला गर्ने" in p), len(header))
    for p in header[:min(lower_idx, 12)]:
        jm = re.match(r"^(?:सम्माननीय|माननीय|मा\.)\s*(?:कायममुकायम\s*)?(?:प्रधान\s*)?न्यायाधीश\s*(?:श्री\s*)?(.+)$", p)
        if jm:
            name = re.sub(r"^श्री\s*", "", jm.group(1)).strip(" ,।")
            name = re.sub(r"\s+", " ", name)
            if name and len(name) < 45:
                judges.append(name)

    case_nos = []
    for p in header:
        for c in norm_case(p):
            if c not in case_nos:
                case_nos.append(c)

    parties = [p for p in header if re.search(r"(पुनरावेदक|प्रत्यर्थी|निवेदक|विपक्षी|वादी|प्रतिवादी)\s*(/|:)", p)][:12]

    # headnotes: paragraphs followed by "(प्रकरण नं.X)"
    headnotes, buf = [], []
    counsel, relied, related = [], "", ""
    i = 0
    while i < len(header):
        p = header[i]
        pm = re.match(r"^\(?\s*प्रकरण\s*नं\.?\s*([०-९0-9,\s\-र]+)\)?$", p)
        if pm:
            if buf:
                headnotes.append({"text": " ".join(buf), "para": pm.group(1).strip()})
            buf = []
        elif "तर्फबाट" in p and ":" in p:
            counsel.append(p)
            buf = []
        elif p.startswith("अवलम्बित नजिर"):
            relied = p.split(":", 1)[1].strip() if ":" in p else ""
            j = i + 1
            while j < len(header) and not header[j].startswith("सम्बद्ध कानून") and "तहमा" not in header[j]:
                relied += (" ; " if relied else "") + header[j]
                j += 1
            i = j - 1
            buf = []
        elif p.startswith("सम्बद्ध कानून"):
            related = p.split(":", 1)[1].strip() if ":" in p else ""
            j = i + 1
            while j < len(header) and "तहमा" not in header[j] and not header[j].startswith("सुरू"):
                related += (" ; " if related else "") + header[j]
                j += 1
            i = j - 1
            buf = []
        elif i > 2 and len(p) > 60 and not re.search(r"(पुनरावेदक|प्रत्यर्थी|निवेदक|विपक्षी|वादी|प्रतिवादी)\s*(/|:)", p) \
                and not p.startswith(("माननीय", "मुद्दा", "फैसला मिति", "सम्वत्", "निर्णय नं")):
            buf.append(p)
        i += 1
    if not headnotes and buf:  # older reports sometimes lack the paragraph reference
        headnotes.append({"text": " ".join(buf), "para": ""})

    lower = " ; ".join(header[lower_idx:]) if lower_idx < len(header) else ""
    codes = sorted({c.split("-")[1] for c in case_nos})
    criminal = int(bool({"CR", "RC", "WH"} & set(codes)) or bool(CRIME_WORDS.search(title)))

    vol = ed.get("भाग", "")
    yr = ed.get("साल", "")
    mon = ed.get("महिना", "")
    iss = ed.get("अंक", "")
    citation = f"ने.का.प. {yr}, {mon}, अंक {iss}, नि.नं. {m.group(1) if m else ''}".strip()

    import json
    return {
        "decision_no": dec_no, "title": title,
        "volume": int(vol.translate(DEV)) if vol.translate(DEV).isdigit() else None,
        "year": int(yr.translate(DEV)) if yr.translate(DEV).isdigit() else None,
        "month": mon, "month_no": MONTHS.get(mon),
        "issue": int(iss.translate(DEV)) if iss.translate(DEV).isdigit() else None,
        "citation": citation, "decision_date": ddate, "court": court, "bench": bench,
        "judges": "|".join(dict.fromkeys(judges)), "case_nos": "|".join(case_nos), "case_types": "|".join(codes),
        "parties": " ¶ ".join(parties), "headnotes": json.dumps(headnotes, ensure_ascii=False),
        "counsel": " ¶ ".join(counsel), "relied": relied, "related_law": related, "lower_courts": lower,
        "criminal": criminal, "text_z": zlib.compress(full_text.encode("utf-8"), 9), "chars": len(full_text),
    }


_local = threading.local()


def session() -> requests.Session:
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
        _local.s.headers["User-Agent"] = UA
    return _local.s


def fetch(i: int, delay: float) -> tuple[int, dict | None, str]:
    for attempt in range(5):
        try:
            r = session().get(BASE + str(i), timeout=60, allow_redirects=False)
            time.sleep(delay)
            if r.status_code in (301, 302, 404):
                return i, None, "missing"
            r.raise_for_status()
            r.encoding = "utf-8"
            return i, parse(r.text), "ok"
        except requests.RequestException as e:
            time.sleep(4 * (attempt + 1))
            err = str(e)
    return i, None, "error: " + err[:200]


SHARD_DIR = ROOT / "data" / "nkp"


def export_shards(con) -> None:
    """Write the table to data/nkp/part-XX.jsonl.gz (one file per 1,000 ids) so it can be committed
    to git (GitHub refuses files over 100 MB; the SQLite file is ~120 MB)."""
    import base64, gzip, json
    SHARD_DIR.mkdir(parents=True, exist_ok=True)
    con.row_factory = sqlite3.Row
    shards: dict[int, list[str]] = {}
    for r in con.execute("SELECT * FROM nkp ORDER BY id"):
        d = dict(r)
        d["text_z"] = base64.b64encode(d["text_z"]).decode()
        shards.setdefault(d["id"] // 1000, []).append(json.dumps(d, ensure_ascii=False))
    for k, lines in shards.items():
        data = gzip.compress("\n".join(lines).encode("utf-8"), 9, mtime=0)
        f = SHARD_DIR / f"part-{k:02d}.jsonl.gz"
        if not f.exists() or f.read_bytes() != data:
            f.write_bytes(data)
    missing = [r[0] for r in con.execute("SELECT id FROM nkp_missing ORDER BY id")]
    (SHARD_DIR / "missing.json").write_text(json.dumps(missing))
    con.row_factory = None


def import_shards(con) -> int:
    import base64, gzip, json
    n = 0
    for f in sorted(SHARD_DIR.glob("part-*.jsonl.gz")):
        for line in gzip.decompress(f.read_bytes()).decode("utf-8").splitlines():
            d = json.loads(line)
            d["text_z"] = base64.b64decode(d["text_z"])
            con.execute(f"INSERT OR REPLACE INTO nkp ({','.join(d)}) VALUES ({','.join('?' * len(d))})", list(d.values()))
            n += 1
    mf = SHARD_DIR / "missing.json"
    if mf.exists():
        for i in json.loads(mf.read_text()):
            con.execute("INSERT OR IGNORE INTO nkp_missing VALUES (?, '')", (i,))
    con.commit()
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", type=int, default=1)
    ap.add_argument("--to", dest="end", type=int, default=0, help="default: newest known id + 300")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--refresh-latest", type=int, default=0,
                    help="re-check this many of the newest ids (new decisions appear at the top)")
    args = ap.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=120)
    con.execute("PRAGMA journal_mode=WAL")   # lets the site builder / linker read while we write
    con.executescript(SCHEMA)
    if not con.execute("SELECT count(*) FROM nkp").fetchone()[0] and SHARD_DIR.exists():
        log(f"rebuilt database from shards: {import_shards(con)} decisions")
    have = {r[0] for r in con.execute("SELECT id FROM nkp")}
    missing = {r[0] for r in con.execute("SELECT id FROM nkp_missing")}
    top = max(have | {10616})
    end = args.end or top + 300
    ids = [i for i in range(args.start, end + 1) if i not in have and (i not in missing or i > top - args.refresh_latest)]
    log(f"{len(ids)} ids to fetch ({args.start}..{end}); {len(have)} already stored")

    cols = ["decision_no", "title", "volume", "year", "month", "month_no", "issue", "citation", "decision_date",
            "court", "bench", "judges", "case_nos", "case_types", "parties", "headnotes", "counsel", "relied",
            "related_law", "lower_courts", "criminal", "text_z", "chars"]
    done = ok = 0
    now = lambda: time.strftime("%Y-%m-%d %H:%M:%S")
    with ThreadPoolExecutor(args.workers) as pool:
        futs = [pool.submit(fetch, i, args.delay) for i in ids]
        for f in as_completed(futs):
            i, d, status = f.result()
            done += 1
            if d:
                ok += 1
                con.execute(f"INSERT OR REPLACE INTO nkp (id,{','.join(cols)},fetched_at) VALUES "
                            f"(?,{','.join('?' * len(cols))},?)", [i] + [d[c] for c in cols] + [now()])
            elif status == "missing":
                con.execute("INSERT OR REPLACE INTO nkp_missing VALUES (?,?)", (i, now()))
            else:
                log(f"  {i}: {status}")
            if done % 20 == 0:
                con.commit()
                log(f"[{done}/{len(ids)}] stored {ok}")
    con.commit()
    export_shards(con)
    log(f"done: {ok} new decisions stored; shards written to data/nkp/")


if __name__ == "__main__":
    main()
