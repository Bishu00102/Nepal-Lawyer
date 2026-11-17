"""All constitutions of Nepal: full text, split into Parts and Articles, Nepali and English.

Sources (stored with every record; shown on the site):
  * Nepal Law Commission (official): Constitution of Nepal 2072 in Nepali and its official English
    translation (incl. the Second Amendment), and — when reachable — the old-law repository
    (पुराना कानून संग्रह) with Nepali originals of earlier constitutions.
  * International IDEA ConstitutionNet and WIPO Lex (reputable international repositories, unofficial
    English texts) for constitutions whose official copies are not online: 1948, 1951, 1959, 1962, 1990, 2063.

The Nepali 2072 text comes from data/statutes.db (already OCR'd and parsed by statutes.py).

Output: data/constitutions.json (+ data/constitution_texts/<key>.txt). Original PDFs go to
data/constitution_src/ (not committed).
"""
from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "constitution_src"
TXT = ROOT / "data" / "constitution_texts"
OUT = ROOT / "data" / "constitutions.json"
UA = "Mozilla/5.0 (NepalCourtTracker; public constitution reader)"
DEV = str.maketrans("०१२३४५६७८९", "0123456789")
LC_OLD = ("https://repository.lawcommission.gov.np/np/document-category/"
          "%E0%A4%AA%E0%A5%81%E0%A4%B0%E0%A4%BE%E0%A4%A8%E0%A4%BE-%E0%A4%95%E0%A4%BE%E0%A4%A8%E0%A5%82%E0%A4%A8-"
          "%E0%A4%B8%E0%A4%82%E0%A4%97%E0%A5%8D%E0%A4%B0%E0%A4%B9-%E0%A4%B8%E0%A4%82%E0%A4%B5%E0%A4%BF/")

CONSTITUTIONS = [
    {"key": "2004", "bs": 2004, "ad": 1948, "ne": "नेपाल सरकारको वैधानिक कानून, २००४",
     "en": "Government of Nepal Act, 1948", "in_force": "2005 BS (1 April 1948) — not fully implemented",
     "texts": [{"lang": "en", "file": "c1948en.pdf", "official": False, "source": "International IDEA — ConstitutionNet",
                "url": "https://constitutionnet.org/sites/default/files/1948%20Constitution%20English.pdf"}]},
    {"key": "2007", "bs": 2007, "ad": 1951, "ne": "नेपाल अन्तरिम शासन विधान, २००७",
     "en": "Interim Government of Nepal Act, 1951", "in_force": "1951 – 1959",
     "texts": [{"lang": "en", "file": "c1951en.pdf", "official": False, "source": "International IDEA — ConstitutionNet",
                "url": "https://constitutionnet.org/sites/default/files/1951_constitution_english.pdf"}]},
    {"key": "2015", "bs": 2015, "ad": 1959, "ne": "नेपाल अधिराज्यको संविधान, २०१५",
     "en": "Constitution of the Kingdom of Nepal, 1959", "in_force": "1959 – 1960 (suspended)",
     "texts": [{"lang": "en", "file": "c1959en.pdf", "official": False, "source": "International IDEA — ConstitutionNet",
                "url": "https://constitutionnet.org/sites/default/files/1959%20Constitution%20English.pdf"}]},
    {"key": "2019", "bs": 2019, "ad": 1962, "ne": "नेपालको संविधान, २०१९",
     "en": "Constitution of Nepal, 1962", "in_force": "1962 – 1990 (Panchayat era)",
     "texts": [{"lang": "en", "file": "c1962en.pdf", "official": False, "source": "International IDEA — ConstitutionNet",
                "url": "https://constitutionnet.org/sites/default/files/constitution_1962.pdf"}]},
    {"key": "2047", "bs": 2047, "ad": 1990, "ne": "नेपाल अधिराज्यको संविधान, २०४७",
     "en": "Constitution of the Kingdom of Nepal, 1990", "in_force": "1990 – 2007",
     "texts": [{"lang": "en", "file": "c1990en.pdf", "official": False, "source": "International IDEA — ConstitutionNet",
                "url": "https://constitutionnet.org/sites/default/files/1990%20Constitution%20English.pdf"}]},
    {"key": "2063", "bs": 2063, "ad": 2007, "ne": "नेपालको अन्तरिम संविधान, २०६३",
     "en": "Interim Constitution of Nepal, 2007", "in_force": "2007 – 2015",
     "texts": [{"lang": "en", "file": "c2063en.pdf", "official": False, "source": "FAO — FAOLEX",
                "url": "https://faolex.fao.org/docs/pdf/nep127536.pdf"}]},
    {"key": "2072", "bs": 2072, "ad": 2015, "ne": "नेपालको संविधान", "en": "Constitution of Nepal, 2015",
     "in_force": "20 September 2015 – present",
     "texts": [{"lang": "en", "file": "c2072en.pdf", "official": True, "source": "Nepal Law Commission (official English translation)",
                "url": "http://giwmscdnone.gov.np/media/files/Constitution%20of%20Nepal%20(2nd%20amd.%20English)_xf33zb3.pdf"},
               {"lang": "ne", "from_statutes": 13437, "official": True, "source": "Nepal Law Commission",
                "url": "https://lawcommission.gov.np/content/13437/nepal-s-constitution/"}]},
]
# Nepali originals of earlier constitutions, matched by year in the Law Commission repository file name
NE_YEAR_HINT = {"2004": "२००४", "2007": "२००७", "2015": "२०१५", "2019": "२०१९", "2047": "२०४७", "2063": "२०६३"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url: str, binary=True, tries=4):
    s = requests.Session()
    s.headers["User-Agent"] = UA
    last = None
    for i in range(tries):
        try:
            r = s.get(url, timeout=120)
            r.raise_for_status()
            return r.content if binary else r.text
        except requests.RequestException as e:
            last = e
            time.sleep(4 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def pdf_text(path: Path, lang: str) -> tuple[str, str]:
    text = subprocess.run(["pdftotext", "-layout" if lang == "en" else "-raw", str(path), "-"],
                          capture_output=True, text=True).stdout
    if lang == "ne":
        sys.path.insert(0, str(ROOT / "scraper"))
        from sc_publications import is_garbled, ocr_pdf
        if is_garbled(text):
            pages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(path)], capture_output=True,
                                                                     text=True).stdout).group(1))
            return "\f".join(ocr_pdf(path, pages)), "ocr"
    return text, "pdf-text"


# ---------------------------------------------------------------- parsing (English)
# "16. Heading:", "Article 16 Heading", "16 HEADING", or "16." alone with the heading on the next line
ART = re.compile(r"^\s*(?:Article\s+)?(\d{1,3}[A-Z]?)(?:\s*\.\s*|\s+|$)(.*)$")
TOC = re.compile(r"\.{5,}\s*\d*\s*$")
PART = re.compile(r"^\s*Part\s*[-–]?\s*(\d+[A-Z]?)\b\.?\s*(.*)$", re.I)
NOISE = re.compile(r"www\.lawcommission\.gov\.np|^\s*Page \d+")   # bare numbers are kept: some texts put the article no. alone on a line


def parse_english(text: str) -> dict:
    raw = [l.rstrip() for l in text.replace("\f", "\n").split("\n")]
    lines = [l.strip() for l in raw if l.strip() and not NOISE.search(l) and not TOC.search(l)]
    # skip a leading "List of Articles" table of contents if present (1990 text)
    start = 0
    for i, l in enumerate(lines[:400]):
        if re.match(r"^preamble\s*:?$", l, re.I) and i > 5 and any("list of articles" in x.lower() for x in lines[:i]):
            start = i
    lines = lines[start:]
    amendments = []
    for l in lines[:40]:
        m = re.match(r"^\d\.\s*(The Constitution of Nepal \(.*?Amendment\),?\s*\d{4})\s+(.+\d{4})$", l)
        if m:
            amendments.append({"title": m.group(1), "date": m.group(2)})
    arts, cur, part, prev = [], None, "", 0
    preamble = []
    pending_part = False
    i = 0
    while i < len(lines):
        l = lines[i]
        pm = PART.match(l)
        if pm and len(l) < 90:
            part = f"Part {pm.group(1)}" + (f" — {pm.group(2).strip(' -–:')}" if pm.group(2).strip() else "")
            pending_part = not pm.group(2).strip()
            i += 1
            continue
        if pending_part and not ART.match(l):
            part += f" — {l}"
            pending_part = False
            i += 1
            continue
        pending_part = False
        m = ART.match(l)
        if m:
            num = m.group(1)
            n = int(re.match(r"\d+", num).group())
            rest0 = m.group(2).strip()
            # a bare number followed by lower-case text is running prose ("2 years …"), not an article
            if rest0 and rest0[0].islower():
                m = None
        if m:
            rest1 = m.group(2).strip() or (lines[i + 1] if i + 1 < len(lines) else "")
            # a real article start has a heading: "Heading: text", a short Title/UPPER line, not a sentence
            heading_like = bool(re.match(r"^[A-Z(\"'][^.]{1,150}?[:：]", rest1)) or (len(rest1) < 110 and rest1[:1].isupper() and not rest1.endswith((".", ";", ",")))
            if not m.group(2).strip() and not heading_like:
                ok = False                               # bare number = page number
            else:
                ok = (n == prev + 1) or (n == prev and num[-1].isalpha()) or (prev < n <= prev + 3) \
                    or (prev < n <= prev + 8 and heading_like) or (prev == 0 and n <= 2)
            if ok:
                rest = m.group(2).strip()
                if not rest and i + 1 < len(lines):      # number alone on its line; heading follows
                    i += 1
                    rest = lines[i]
                hm = re.match(r"^(.{2,160}?)\s*[:：]\s*(.*)$", rest)
                if hm:
                    heading, body = hm.group(1), hm.group(2)
                elif len(rest) < 120 and not rest.endswith((".", ";", ",")):
                    heading, body = rest, ""             # heading on its own line (1962 style)
                else:
                    heading, body = "", rest
                cur = {"n": num, "part": part, "heading": heading.strip(" .:-"), "text": body}
                arts.append(cur)
                prev = n
                i += 1
                continue
        if cur is not None:
            cur["text"] += ("\n" if re.match(r"^\(?[a-z0-9]{1,4}\)", l) else " ") + l
        elif not re.search(r"amendment|gazette|^the constitution|^constitution of", l, re.I):
            preamble.append(l)
        i += 1
    for a in arts:
        a["text"] = re.sub(r"[ \t]+", " ", a["text"]).strip()
        marks = re.findall(r"(?:First|Second|Third)\s+Amendment", a["text"])
        if marks:
            a["amended"] = sorted(set(marks))
    return {"preamble": " ".join(preamble)[:6000], "articles": arts, "amendments": amendments}


def amendment_effects(text: str) -> list[dict]:
    """Footnotes like "Amended by the First Amendment." -> the article / schedule they sit under."""
    out, where = [], None
    for l in text.replace("\f", "\n").split("\n"):
        m = re.match(r"^\s*(\d{1,3}[A-Z]?)\.\s+[A-Z][^:]{2,120}:", l) or re.match(r"^\s*(\d{1,3}[A-Z]?)\.\s*$", l)
        if m:
            where = "Article " + m.group(1)
        sm = re.match(r"^\s*(Schedule\s*-?\s*\d+)\s*$", l)
        if sm:
            where = sm.group(1).replace(" ", "")
        am = re.search(r"(Amended|Inserted|Deleted|Substituted) by the (\w+ Amendment)", l)
        if am and where:
            item = {"amendment": am.group(2), "change": am.group(1).lower(), "where": where}
            if item not in out:
                out.append(item)
    return out


def nepali_2072(act_id: int) -> dict:
    con = sqlite3.connect(ROOT / "data" / "statutes.db")
    arts = [{"n": n, "part": (p or "") + (" — " + c if c else ""), "heading": h, "text": b,
             **({"amended": [a]} if a else {})}
            for p, c, n, h, b, a in con.execute(
                "SELECT part, chapter, number, heading, body, amended_by FROM sections WHERE act_id=? ORDER BY seq", (act_id,))]
    gaps = (con.execute("SELECT gaps FROM acts WHERE id=?", (act_id,)).fetchone() or [""])[0] or ""
    return {"preamble": "", "articles": arts, "amendments": [], "gaps": gaps}


def try_lc_old_repository() -> dict[str, str]:
    """Nepali originals from the Law Commission repository, when it is reachable. Returns key -> pdf url."""
    try:
        html = get(LC_OLD, binary=False, tries=2)
    except Exception as e:
        log(f"Law Commission old-law repository not reachable ({str(e)[:80]}) — Nepali originals skipped this run")
        return {}
    from urllib.parse import unquote
    found = {}
    for href in set(re.findall(r'href="([^"]+\.pdf)"', html)):
        name = unquote(href)
        if "संविधान" not in name and "विधान" not in name and "कानून" not in name:
            continue
        for key, yr in NE_YEAR_HINT.items():
            if yr in name and key not in found:
                found[key] = href
    log(f"Law Commission repository: Nepali originals found for {sorted(found)}")
    return found


def main():
    SRC.mkdir(parents=True, exist_ok=True)
    TXT.mkdir(parents=True, exist_ok=True)
    previous = {}
    if OUT.exists():
        previous = {(c["key"], t["lang"]): t for c in json.loads(OUT.read_text())["constitutions"] for t in c["versions"]}
    lc = try_lc_old_repository()
    out = []
    for c in CONSTITUTIONS:
        texts = list(c["texts"])
        if c["key"] in lc and not any(t["lang"] == "ne" for t in texts):
            texts.append({"lang": "ne", "file": f"c{c['key']}ne.pdf", "official": True,
                          "source": "Nepal Law Commission — पुराना कानून संग्रह", "url": lc[c["key"]]})
        versions = []
        for t in texts:
            try:
                if t.get("from_statutes"):
                    parsed, method = nepali_2072(t["from_statutes"]), "ocr"
                else:
                    f = SRC / t["file"]
                    if not f.exists() or f.stat().st_size < 1000:
                        f.write_bytes(get(t["url"]))
                    txt_file = TXT / f"{c['key']}-{t['lang']}.txt"
                    if txt_file.exists():
                        text, method = txt_file.read_text(encoding="utf-8"), previous.get((c["key"], t["lang"]), {}).get("method", "pdf-text")
                    else:
                        text, method = pdf_text(f, t["lang"])
                        txt_file.write_text(text, encoding="utf-8")
                    if t["lang"] == "en":
                        parsed = parse_english(text)
                        parsed["amendment_effects"] = amendment_effects(text)
                    else:
                        sys.path.insert(0, str(ROOT / "scraper"))
                        from statutes import parse_act
                        p = parse_act(text)
                        parsed = {"preamble": "", "amendments": p["amendments"], "gaps": ",".join(map(str, p["gaps"])),
                                  "articles": [{"n": s["number"], "part": s["part"] + (" — " + s["chapter"] if s["chapter"] else ""),
                                                "heading": s["heading"], "text": s["body"]} for s in p["sections"]]}
                versions.append({"lang": t["lang"], "official": t["official"], "source": t["source"], "url": t["url"],
                                 "method": method, **parsed})
                log(f"{c['key']} {t['lang']}: {len(parsed['articles'])} articles ({method})")
            except Exception as e:
                log(f"{c['key']} {t['lang']}: ERROR {e}")
                if (c["key"], t["lang"]) in previous:
                    versions.append(previous[(c["key"], t["lang"])])
        out.append({k: c[k] for k in ("key", "bs", "ad", "ne", "en", "in_force")} | {"versions": versions})
    OUT.write_text(json.dumps({"constitutions": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"wrote {OUT}")


if __name__ == "__main__":
    main()
