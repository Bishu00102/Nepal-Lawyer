"""Cross-references between precedents and legal provisions (PDF spec §5: "every provision connected to
precedents, every precedent connected to provisions and issues").

Reads the texts already collected and detects, by pattern matching only:
  * statute citations      "मुलुकी अपराध संहिता, २०७४ को दफा १७७", "प्रमाण ऐन, २०३१ को दफा ९(२)(क)"
  * constitution articles  "नेपालको संविधानको धारा २०", "संविधानको धारा १३३(२)"
  * old Muluki Ain         "ज्यानसम्बन्धी महलको १३(३) नं." (repealed code, recorded as text)
  * NKP citations          "ने.का.प. २०६५, अङ्क ५, नि.नं. ७९५३"  -> linked to that NKP decision
  * the NKP header fields  अवलम्बित नजिर (precedents relied on) / सम्बद्ध कानून (related law)

Every link is stored with method='auto' and the matched text, so the site can label it as
machine-detected and show exactly what was matched. Nothing is inferred beyond the literal citation.

Output: data/links.db  (table `citations`)
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DB = ROOT / "data" / "links.db"
NKP_DB = ROOT / "data" / "nkp.db"
STAT_DB = ROOT / "data" / "statutes.db"
COURT_DB = ROOT / "data" / "court.db"
TXT_DIR = ROOT / "data" / "texts"
DEV = str.maketrans("०१२३४५६७८९", "0123456789")

SCHEMA = """
DROP TABLE IF EXISTS citations;
CREATE TABLE citations (
    src_type TEXT,      -- nkp | scdoc
    src_id TEXT,
    tgt_type TEXT,      -- section | article | nkp | muluki_ain | other_act | old_constitution
    act_id INTEGER,     -- statutes.acts.id for section/article
    section TEXT,       -- e.g. 177, 9(2)
    tgt_id TEXT,        -- nkp id for tgt_type=nkp
    label TEXT,         -- normalised human label
    raw TEXT,           -- matched text
    field TEXT,         -- text | relied | related_law
    method TEXT         -- auto
);
CREATE INDEX ix_cit_tgt ON citations(tgt_type, act_id, section);
CREATE INDEX ix_cit_src ON citations(src_type, src_id);
CREATE INDEX ix_cit_nkp ON citations(tgt_type, tgt_id);
"""

# Short names lawyers and judges use for the main acts -> canonical title fragment in the catalogue
ALIASES = {
    "मुलुकी अपराध संहिता": "मुलुकी अपराध संहिता",
    "अपराध संहिता": "मुलुकी अपराध संहिता",
    "मुलुकी फौजदारी कार्यविधि संहिता": "मुलुकी फौजदारी कार्यविधि संहिता",
    "फौजदारी कार्यविधि संहिता": "मुलुकी फौजदारी कार्यविधि संहिता",
    "मुलुकी देवानी संहिता": "मुलुकी देवानी संहिता",
    "देवानी संहिता": "मुलुकी देवानी संहिता",
    "मुलुकी देवानी कार्यविधि संहिता": "मुलुकी देवानी कार्यविधि संहिता",
    "फौजदारी कसूर (सजाय निर्धारण तथा कार्यान्वयन) ऐन": "फौजदारी कसूर (सजाय निर्धारण तथा कार्यान्वयन) ऐन",
}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("‍", "").replace("‌", "").replace("ू", "ु")
                  .replace("ङ्ग", "ङ्ग").replace("कसुर", "कसुर")).strip()


def load_acts() -> list[tuple[str, int, str]]:
    """(normalised name without year, act id, display title), longest first."""
    if not STAT_DB.exists():
        return []
    con = sqlite3.connect(STAT_DB)
    acts = []
    for aid, title in con.execute("SELECT id,title FROM acts"):
        if re.search(r"संशोधन|अध्यादेश|नियमावली", title):
            continue
        base = re.sub(r"[,，]?\s*[०-९0-9]{4}\s*$", "", title).strip(" ,")
        ym = re.search(r"([०-९0-9]{4})\s*$", title)
        acts.append((norm(base), aid, title, int(ym.group(1).translate(DEV)) if ym else None))
    by_title = {a[2]: (a[1], a[3]) for a in acts}
    for alias, canon in ALIASES.items():
        hit = next(((aid, yr, t) for t, (aid, yr) in by_title.items() if canon in t), None)
        if hit:
            acts.append((norm(alias), hit[0], hit[2], hit[1]))
    const = next((aid for t, (aid, yr) in by_title.items() if "संविधान" in t), None)
    acts.sort(key=lambda a: -len(a[0]))
    return acts, const


SEC = r"([०-९0-9]{1,3}[क-ह]?(?:\s*\([०-९0-9क-ह]{1,3}\))*)"
NKP_CIT = re.compile(r"ने\.?\s*का\.?\s*प\.?\s*,?\s*([०-९0-9]{4})[^।\n]{0,40}?नि\.?\s*नं\.?\s*([०-९0-9]{2,5})")
MULUKI = re.compile(r"([ऀ-ॿ]{2,30}?\s?(?:सम्बन्धी|को)?\s?महल)(?:को)?\s*([०-९0-9]{1,3}(?:\s*\([०-९0-9]{1,2}\))?)\s*नं")
ARTICLE = re.compile(r"((?:[\u0900-\u097F]+\s+){0,2})संविधान\s*[,，]?\s*([०-९]{4})?\s*को\s*धारा\s*" + SEC)


def sec_norm(s: str) -> str:
    s = re.sub(r"\s+", "", s.translate(DEV))
    return s


def which_constitution(prefix: str, year: str | None, decision_date: str | None) -> tuple[str, bool]:
    """Return (label, is_current_2072). Only link to the 2072 text when that is certain."""
    y = int(year.translate(DEV)) if year else None
    if "अन्तरिम" in prefix or y == 2063:
        return "नेपालको अन्तरिम संविधान, २०६३", False
    if "अधिराज्य" in prefix or y in (2047, 2019, 2015):
        return f"नेपाल अधिराज्यको संविधान, {year or '२०४७'}", False
    if y == 2072:
        return "नेपालको संविधान (२०७२)", True
    # no year given: a decision made after the 2072 constitution came into force (2072-06-03)
    if decision_date and decision_date >= "2072-06-03":
        return "नेपालको संविधान (२०७२)", True
    return "संविधान (कुन संविधान हो खुलेन)", False


def detect(text: str, acts, const_id, decision_date: str | None = None) -> list[dict]:
    out = []
    t = norm(text)
    # statute citations: "<act name>[, YEAR] [को|का] [...] दफा N"; link only if the cited year matches
    for name, aid, title, year in acts:
        if name not in t:
            continue
        pat = re.compile(re.escape(name) + r"\s*[,，]?\s*([०-९0-9]{4})?\s*(?:को|का|मा)?\s*(?:[^।\n]{0,25}?)दफा\s*" + SEC)
        for m in pat.finditer(t):
            cited_year = int(m.group(1).translate(DEV)) if m.group(1) else None
            same = cited_year is None or year is None or cited_year == year
            label_title = title if same else f"{name}, {m.group(1)}"
            out.append({"tgt_type": "section" if same else "other_act", "act_id": aid if same else None,
                        "section": sec_norm(m.group(2)),
                        "label": f"{label_title} दफा {m.group(2)}", "raw": m.group(0)[:160]})
    for m in ARTICLE.finditer(t):
        label, current = which_constitution(m.group(1), m.group(2), decision_date)
        out.append({"tgt_type": "article" if current else "old_constitution",
                    "act_id": const_id if current else None, "section": sec_norm(m.group(3)),
                    "label": f"{label} धारा {m.group(3)}", "raw": m.group(0)[:160]})
    for m in MULUKI.finditer(t):
        mahal = m.group(1).strip()
        if len(mahal) < 6 or re.match(r"(सोही|उक्त|सो|यसै|त्यही|सम्बन्धी|सम्वन्धी)\b", mahal):
            continue   # "same chapter" style references cannot be resolved without context
        out.append({"tgt_type": "muluki_ain", "act_id": None, "section": sec_norm(m.group(2)),
                    "label": f"मुलुकी ऐन, {mahal}को {m.group(2)} नं.", "raw": m.group(0)[:160]})
    for m in NKP_CIT.finditer(t):
        out.append({"tgt_type": "nkp", "act_id": None, "section": None,
                    "nkp_year": int(m.group(1).translate(DEV)), "decision_no": int(m.group(2).translate(DEV)),
                    "label": f"ने.का.प. {m.group(1)}, नि.नं. {m.group(2)}", "raw": m.group(0)[:160]})
    seen, uniq = set(), []
    for c in out:
        k = (c["tgt_type"], c.get("act_id"), c.get("section"), c.get("decision_no"), c["label"])
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    return uniq


def main():
    acts, const_id = load_acts()
    print(f"{len(acts)} act names/aliases loaded", file=sys.stderr)
    out = sqlite3.connect(OUT_DB)
    out.executescript(SCHEMA)
    dec_to_id = {}
    rows = 0
    if NKP_DB.exists():
        nk = sqlite3.connect(NKP_DB, timeout=120)
        for i, dno in nk.execute("SELECT id, decision_no FROM nkp"):
            dec_to_id[dno] = i
        for i, text_z, relied, related, ddate in nk.execute(
                "SELECT id, text_z, relied, related_law, decision_date FROM nkp"):
            text = zlib.decompress(text_z).decode("utf-8")
            for field, body in (("text", text), ("relied", relied or ""), ("related_law", related or "")):
                if not body:
                    continue
                for c in detect(body, acts, const_id, ddate):
                    tgt_id = None
                    if c["tgt_type"] == "nkp":
                        tgt_id = dec_to_id.get(c["decision_no"])
                        if tgt_id == i:
                            continue
                    out.execute("INSERT INTO citations VALUES (?,?,?,?,?,?,?,?,?,?)",
                                ("nkp", str(i), c["tgt_type"], c["act_id"], c["section"],
                                 str(tgt_id) if tgt_id else None, c["label"], c["raw"], field, "auto"))
                    rows += 1
    if COURT_DB.exists():
        cc = sqlite3.connect(COURT_DB)
        for did, ddate in cc.execute("SELECT id, doc_date FROM documents"):
            f = TXT_DIR / f"{did}.txt"
            if not f.exists():
                continue
            for c in detect(f.read_text(encoding="utf-8"), acts, const_id, ddate):
                tgt_id = dec_to_id.get(c["decision_no"]) if c["tgt_type"] == "nkp" else None
                out.execute("INSERT INTO citations VALUES (?,?,?,?,?,?,?,?,?,?)",
                            ("scdoc", did, c["tgt_type"], c["act_id"], c["section"],
                             str(tgt_id) if tgt_id else None, c["label"], c["raw"], "text", "auto"))
                rows += 1
    out.commit()
    print(f"{rows} citations stored", file=sys.stderr)
    for r in out.execute("SELECT tgt_type, count(*), count(distinct src_id) FROM citations GROUP BY 1"):
        print(r, file=sys.stderr)


if __name__ == "__main__":
    main()
