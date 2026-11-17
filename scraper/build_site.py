"""Export data/court.db into static JSON files the website reads (site/data/)."""
from __future__ import annotations

import json
import re
import sqlite3
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "court.db"
OUT = ROOT / "site" / "data"

DECIDED = ("फैसला", "अन्तिम आदेश")


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def dump_gz(path: Path, obj) -> None:
    """gzip-compressed JSON (the browser decompresses with DecompressionStream). Devanagari text
    compresses ~5x, which keeps the full NKP archive within GitHub Pages' size limit."""
    import gzip
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9))


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    courts = {r["code"]: dict(r) for r in con.execute("SELECT * FROM courts")} if con.execute(
        "SELECT name FROM sqlite_master WHERE name='courts'").fetchone() else {}
    courts.setdefault("SC", {"code": "SC", "name": "सर्वोच्च अदालत", "kind": "SC"})

    benches = {}
    for r in con.execute("SELECT * FROM benches"):
        b = dict(r)
        b["judges"] = [j for j in (b["judges"] or "").split("|") if j]
        benches[(b["court"], b["id"])] = b

    by_day = defaultdict(lambda: defaultdict(list))
    for r in con.execute("SELECT * FROM hearings ORDER BY court, bs_date DESC, bench_id, seq"):
        by_day[(r["court"], r["bs_date"])][r["bench_id"]].append(
            {k: r[k] for k in r.keys() if k not in ("bench_id", "bs_date", "court")})

    judge_stats = defaultdict(lambda: {"hearings": 0, "decisions": 0, "days": set(), "outcomes": defaultdict(int)})
    search = defaultdict(list)
    court_index = []
    total = 0
    for code in sorted(courts, key=lambda c: (c != "SC", c != "SPC", int(c[2:]) if c[2:].isdigit() else 0)):
        days = [dict(r) for r in con.execute(
            "SELECT * FROM hearing_days WHERE court=? AND available=1 ORDER BY bs_date DESC", (code,))]
        if not days:
            continue
        day_index = []
        for d in days:
            date = d["bs_date"]
            out_benches = []
            n_cases = n_dec = 0
            for bid, cases in sorted(by_day[(code, date)].items(),
                                     key=lambda kv: benches.get((code, kv[0]), {}).get("bench_no", "")):
                b = benches.get((code, bid), {"bench_no": "", "bench_type": "", "judges": []})
                out_benches.append({"id": bid, "no": b["bench_no"], "type": b["bench_type"],
                                    "judges": b["judges"], "cases": cases})
                for c in cases:
                    decided = c["status"] in DECIDED
                    n_cases += 1
                    n_dec += decided
                    for j in b["judges"]:
                        st = judge_stats[(j, code)]
                        st["hearings"] += 1
                        st["days"].add(date)
                        if decided:
                            st["decisions"] += 1
                            st["outcomes"][c["outcome"] or "—"] += 1
                    search[code].append([date, bid, c["case_no"], c["subject"], c["appellant"], c["respondent"],
                                         c["status"], c["outcome"], c["pdf_url"], c["remarks"], c["case_id"],
                                         c["case_url"]])
            dump(OUT / "days" / code / f"{date}.json", {"court": code, "date": date, "weekday": d["weekday"],
                                                       "benches": out_benches})
            day_index.append({"date": date, "weekday": d["weekday"], "cases": n_cases, "decided": n_dec})
            total += n_cases
        court_index.append({"code": code, "name": courts[code]["name"], "kind": courts[code]["kind"],
                            "days": day_index})
        dump(OUT / "search" / f"{code}.json", {
            "court": code,
            "benches": {bid: b["judges"] for (c, bid), b in benches.items() if c == code},
            "rows": search[code]})

    titles = {(r["name"], r["court"]): r["title"] for r in con.execute("SELECT * FROM judges")}
    judges = sorted(({"name": n, "court": c, "title": titles.get((n, c), ""), "hearings": s["hearings"],
                      "decisions": s["decisions"], "days": len(s["days"]),
                      "outcomes": dict(sorted(s["outcomes"].items(), key=lambda kv: -kv[1]))}
                     for (n, c), s in judge_stats.items()), key=lambda j: (-j["decisions"], j["name"]))

    export_documents(con)
    for extra in ("export_nkp", "export_statutes"):
        fn = globals().get(extra)
        if fn:
            fn()

    dump(OUT / "meta.json", {"updated_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
                             "courts": court_index, "judges": judges})
    print(f"Exported {len(court_index)} courts, {total} hearings, {len(judges)} judges")


TXT_DIR = ROOT / "data" / "texts"


def export_documents(con: sqlite3.Connection) -> None:
    """Published judgments / orders / notices -> site/data/judgments.json, docs/<id>.txt, fulltext.json"""
    if not con.execute("SELECT name FROM sqlite_master WHERE name='documents'").fetchone():
        return
    docs, fulltext = [], {}
    (OUT / "docs").mkdir(parents=True, exist_ok=True)
    doc_cites = defaultdict(list)
    for l in load_links():
        if l["src_type"] == "scdoc":
            doc_cites[l["src_id"]].append({"type": l["tgt_type"], "act": l["act_id"], "sec": l["section"],
                                           "nkp": l["tgt_id"], "label": l["label"]})
    for r in con.execute("SELECT * FROM documents ORDER BY section, list_order"):
        d = dict(r)
        txt_file = TXT_DIR / f"{d['id']}.txt"
        text = txt_file.read_text(encoding="utf-8") if txt_file.exists() else ""
        # OCR turns dotted/dashed leader lines into runs like "----22211117171…"; collapse them
        text = re.sub(r"[-–—_.:।1-27७|]{10,}", " …… ", text)
        if text:
            (OUT / "docs" / f"{d['id']}.txt").write_text(text, encoding="utf-8")
            # compact copy for in-browser full-text search
            fulltext[d["id"]] = " ".join(text.split())
        docs.append({
            "id": d["id"], "section": d["section"], "kind": d["kind"], "title": d["title"],
            "principle": d["principle"], "case_no": d["case_no"], "date": d["doc_date"],
            "bench": d["bench"] or "", "judges": [j for j in (d["judges"] or "").split("|") if j],
            "pages": d["pages"] or 0, "method": d["text_method"] or "none", "has_text": bool(text),
            "url": d["url"], "cites": doc_cites.get(d["id"], []),
        })
    dump(OUT / "judgments.json", {"docs": docs})
    dump_gz(OUT / "fulltext.json.gz", fulltext)
    print(f"Exported {len(docs)} published documents ({len(fulltext)} with text)")


NKP_DB = ROOT / "data" / "nkp.db"
STAT_DB = ROOT / "data" / "statutes.db"
LINK_DB = ROOT / "data" / "links.db"


def load_links() -> list[dict]:
    if not LINK_DB.exists():
        return []
    con = sqlite3.connect(LINK_DB)
    con.row_factory = sqlite3.Row
    return [dict(r) for r in con.execute("SELECT * FROM citations")]


def export_nkp() -> None:
    """Nepal Kanoon Patrika -> nkp/index.json (all decisions), nkp/heads.json (headnotes),
    nkp/d/<id>.json (full text, parties, counsel, citations in and out)."""
    if not NKP_DB.exists():
        return
    import zlib
    con = sqlite3.connect(NKP_DB, timeout=120)
    con.row_factory = sqlite3.Row
    links = [l for l in load_links() if l["src_type"] == "nkp"]
    out_links = defaultdict(list)
    cited_by = defaultdict(set)
    for l in links:
        out_links[l["src_id"]].append({"type": l["tgt_type"], "act": l["act_id"], "sec": l["section"],
                                       "nkp": l["tgt_id"], "label": l["label"], "field": l["field"]})
        if l["tgt_type"] == "nkp" and l["tgt_id"]:
            cited_by[l["tgt_id"]].add(int(l["src_id"]))
    rows, heads = [], {}
    (OUT / "nkp" / "d").mkdir(parents=True, exist_ok=True)
    for r in con.execute("SELECT * FROM nkp ORDER BY year DESC, month_no DESC, decision_no DESC"):
        hn = json.loads(r["headnotes"] or "[]")
        rows.append([r["id"], r["decision_no"], r["year"], r["month_no"], r["issue"], r["decision_date"],
                     r["title"], r["bench"], [j for j in (r["judges"] or "").split("|") if j],
                     [c for c in (r["case_nos"] or "").split("|") if c], r["criminal"], r["volume"]])
        heads[r["id"]] = [[h["text"], h["para"]] for h in hn]
        dump_gz(OUT / "nkp" / "d" / f"{r['id']}.json.gz", {
            "id": r["id"], "citation": r["citation"], "court": r["court"], "parties": r["parties"],
            "counsel": r["counsel"], "relied": r["relied"], "related_law": r["related_law"],
            "lower_courts": r["lower_courts"], "text": zlib.decompress(r["text_z"]).decode("utf-8"),
            "cites": out_links.get(str(r["id"]), []), "cited_by": sorted(cited_by.get(str(r["id"]), [])),
        })
    dump(OUT / "nkp" / "index.json", {"rows": rows})
    dump_gz(OUT / "nkp" / "heads.json.gz", heads)
    print(f"Exported {len(rows)} NKP decisions")


def export_statutes() -> None:
    """Law Commission catalogue + parsed priority acts -> statutes/index.json, statutes/a/<id>.json"""
    if not STAT_DB.exists():
        return
    con = sqlite3.connect(STAT_DB, timeout=60)
    con.row_factory = sqlite3.Row
    links = load_links()
    by_section = defaultdict(list)
    for l in links:
        if l["tgt_type"] in ("section", "article") and l["act_id"]:
            base = re.match(r"\d+[क-ह]?", l["section"] or "")
            if base:
                by_section[(l["act_id"], base.group(0))].append([l["src_type"], l["src_id"], l["label"]])
    acts = []
    (OUT / "statutes" / "a").mkdir(parents=True, exist_ok=True)
    for a in con.execute("SELECT * FROM acts ORDER BY area IS NULL, title"):
        a = dict(a)
        amendments = [dict(r) for r in con.execute(
            "SELECT title, date_bs AS date FROM amendments WHERE act_id=? ORDER BY seq", (a["id"],))]
        secs = [dict(r) for r in con.execute(
            "SELECT part, chapter, number, heading, body, amended_by FROM sections WHERE act_id=? ORDER BY seq",
            (a["id"],))]
        n_cites = 0
        for s_ in secs:
            # re-join OCR line wraps; keep breaks before clause markers "(१)", "(क)" and amendment notes
            s_["body"] = re.sub(r"\n(?!\s*[\(（]|\s*[०-९0-9]+\.|\s*(?:स्पष्टीकरण|तर|प्रतिबन्धात्मक))", " ", s_["body"])
            cites = by_section.get((a["id"], s_["number"]), [])
            # one entry per source document
            seen, uniq = set(), []
            for c in cites:
                if (c[0], c[1]) not in seen:
                    seen.add((c[0], c[1]))
                    uniq.append(c)
            s_["cited_by"] = uniq
            n_cites += len(uniq)
        acts.append({"id": a["id"], "title": a["title"], "year": a["year_bs"], "category": a["category"],
                     "area": a["area"], "act_no": a["act_no"], "authenticated": a["authenticated"],
                     "commencement": a["commencement"], "pages": a["pages"], "sections": len(secs),
                     "amendments": len(amendments), "gaps": a.get("gaps") or "", "pdf": a["pdf_url"],
                     "page": a["page_url"], "cited": n_cites})
        if secs:
            dump(OUT / "statutes" / "a" / f"{a['id']}.json", {**acts[-1], "amendment_list": amendments,
                                                              "section_list": secs})
    dump(OUT / "statutes" / "index.json", {"acts": acts})
    print(f"Exported {len(acts)} laws ({sum(1 for a in acts if a['sections'])} with parsed sections)")


if __name__ == "__main__":
    main()
