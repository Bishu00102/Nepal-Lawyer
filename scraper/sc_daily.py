"""Scrape daily cause lists (दैनिक पेसी) and results for the Supreme Court, the High Courts
and the Special Court of Nepal.

Sources (official, public — all on supremecourt.gov.np):
  Supreme Court   /lic/sys.php?d=reports&f=daily_public
  High Courts     /appeal/syspublic.php?d=reports&f=courtselect&courtid=N  then daily_public
  Special Court   /special/syspublic.php?d=reports&f=daily_public

For each date a court publishes a list of benches (इजलास) with their judges. Each bench page lists
every case heard, its status (फैसला / आदेश / स्थगित ...) and the kind of decision (सदर, उल्टी,
अन्तरिम आदेश जारी ...), sometimes with an order PDF.

Usage:
    python scraper/sc_daily.py                       # all courts, today + previous 7 days
    python scraper/sc_daily.py --courts SC --days 60 # backfill the Supreme Court only
    python scraper/sc_daily.py --date 2083-07-27
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "court.db"
HOST = "https://supremecourt.gov.np"
UA = "NepalCourtTracker/1.0 (public cause-list reader)"

# code -> (name, base path, court id for the High Court system or None)
COURTS: dict[str, tuple[str, str, str | None]] = {
    "SC": ("सर्वोच्च अदालत", "/lic/sys.php", None),
    "SPC": ("विशेष अदालत", "/special/syspublic.php", None),
}
HIGH_COURT_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "90", "91", "96"]
for _cid in HIGH_COURT_IDS:
    COURTS[f"HC{_cid}"] = ("", "/appeal/syspublic.php", _cid)   # name read from the site


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- database
SCHEMA = """
CREATE TABLE IF NOT EXISTS courts (
    code TEXT PRIMARY KEY, name TEXT, kind TEXT
);
CREATE TABLE IF NOT EXISTS hearing_days (
    court TEXT, bs_date TEXT, weekday TEXT, fetched_at TEXT, available INTEGER,
    PRIMARY KEY (court, bs_date)
);
CREATE TABLE IF NOT EXISTS benches (
    court TEXT, id INTEGER,               -- court's bench id for that day
    bs_date TEXT,
    bench_no TEXT,                        -- १, २, पूर्ण १ ...
    bench_type TEXT,                      -- एकल / संयुक्त / पूर्ण / संवैधानिक इजलास
    judges TEXT,                          -- '|' separated, normalised names
    PRIMARY KEY (court, id)
);
CREATE TABLE IF NOT EXISTS judges (
    name TEXT, court TEXT, title TEXT,
    PRIMARY KEY (name, court)
);
CREATE TABLE IF NOT EXISTS hearings (
    court TEXT, bench_id INTEGER, bs_date TEXT,
    seq INTEGER,                          -- order on the list
    serial TEXT,                          -- क.स. (blank for linked cases)
    faant TEXT, reg_date TEXT,
    subject TEXT,                         -- मुद्दा
    case_no TEXT, case_type TEXT,
    case_id TEXT,                         -- court internal id
    appellant TEXT, respondent TEXT, adv_appellant TEXT, adv_respondent TEXT,
    remarks TEXT,                         -- कैफियत (e.g. थुनुवा)
    status TEXT,                          -- मुद्दाको स्थिती
    outcome TEXT,                         -- आदेश फैसलाको किसिम
    pdf_url TEXT, note TEXT, case_url TEXT,
    PRIMARY KEY (court, bench_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_hear_date ON hearings(court, bs_date);
CREATE INDEX IF NOT EXISTS ix_hear_case ON hearings(case_no);
"""


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    migrate(con)
    con.executescript(SCHEMA)
    return con


def migrate(con: sqlite3.Connection) -> None:
    """Upgrade the original Supreme-Court-only tables (no `court` column) in place."""
    cols = [r[1] for r in con.execute("PRAGMA table_info(hearings)")]
    if not cols or "court" in cols:
        return
    log("migrating database to multi-court schema …")
    for t in ("hearing_days", "benches", "judges", "hearings"):
        con.execute(f"ALTER TABLE {t} RENAME TO old_{t}")
    con.executescript(SCHEMA)
    con.execute("INSERT INTO hearing_days SELECT 'SC',bs_date,weekday,fetched_at,available FROM old_hearing_days")
    con.execute("INSERT INTO benches SELECT 'SC',id,bs_date,bench_no,bench_type,judges FROM old_benches")
    con.execute("INSERT INTO judges SELECT name,'SC',title FROM old_judges")
    con.execute("""INSERT INTO hearings SELECT 'SC',bench_id,bs_date,seq,serial,faant,reg_date,subject,case_no,
                   case_type,case_id,appellant,respondent,adv_appellant,adv_respondent,remarks,status,outcome,
                   pdf_url,note,
                   CASE WHEN case_id<>'' THEN
                     'https://supremecourt.gov.np/lic/sys.php?d=reports&f=case_details&num=1&mode=view&caseno='||case_id
                   ELSE '' END
                   FROM old_hearings""")
    for t in ("hearing_days", "benches", "judges", "hearings"):
        con.execute(f"DROP TABLE old_{t}")
    con.commit()


# ---------------------------------------------------------------- helpers
def clean(s: str | None) -> str:
    if not s:
        return ""
    s = s.replace("\xa0", " ").replace("·", ".").replace("﻿", "")
    return re.sub(r"\s+", " ", s).strip()


JUDGE_TITLE = re.compile(r"^(स\.?\s*प्र\.?\s*न्या\.?|प्र\.?\s*न्या\.?|मा\.?\s*मु\.?\s*न्या\.?|मा\.?\s*न्या\.?|"
                         r"मा\.?\s*अध्यक्ष|मा\.?\s*सदस्य)\s*")


def split_judge(raw: str) -> tuple[str, str]:
    """'मा. न्या. डा. श्री नहकुल सुवेदी' -> ('डा. नहकुल सुवेदी', 'मा.न्या.')"""
    raw = clean(raw)
    m = JUDGE_TITLE.match(raw)
    title = ""
    if m:
        t = m.group(1).replace(" ", "")
        title = ("स.प्र.न्या." if t.startswith("स") else "प्र.न्या." if t.startswith("प्र") else
                 "मा.मु.न्या." if "मु" in t else "मा.अध्यक्ष" if "अध्यक्ष" in t else
                 "मा.सदस्य" if "सदस्य" in t else "मा.न्या.")
        raw = raw[m.end():]
    # drop the honorific "श्री" only when it is a separate word (keep names like श्रीकान्त)
    name = re.sub(r"(^|\s)श्री(?=\s)", " ", raw)
    name = re.sub(r"\s+", " ", name).strip(" ,")
    return name, title


def bs_parts(bs_date: str) -> tuple[str, str, str]:
    y, m, d = bs_date.split("-")
    return y, m.zfill(2), d.zfill(2)


class Client:
    def __init__(self, code: str, delay: float = 1.0):
        self.code = code
        name, path, cid = COURTS[code]
        self.base = HOST + path
        self.dir = self.base.rsplit("/", 1)[0] + "/"
        self.cid = cid
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.delay = delay
        self.name = name
        if cid:
            html = self._get(f"{self.base}?d=reports&f=courtselect&courtid={cid}")
            m = re.search(r"(उच्च अदालत[^<\n]{0,40})", html)
            self.name = clean(m.group(1)) if m else f"उच्च अदालत ({cid})"

    def _get(self, url: str) -> str:
        for attempt in range(4):
            try:
                r = self.s.get(url, timeout=90)
                r.raise_for_status()
                r.encoding = "utf-8"
                return r.text
            except requests.RequestException as e:
                log(f"  retry {attempt + 1}: {e}")
                time.sleep(3 * (attempt + 1))
        raise RuntimeError(f"{self.code}: site not reachable")

    def post(self, data: dict) -> str:
        url = f"{self.base}?d=reports&f=daily_public"
        for attempt in range(4):
            try:
                r = self.s.post(url, data=data, timeout=90)
                r.raise_for_status()
                r.encoding = "utf-8"
                time.sleep(self.delay)
                return r.text
            except requests.RequestException as e:
                log(f"  retry {attempt + 1}: {e}")
                time.sleep(3 * (attempt + 1))
        raise RuntimeError(f"{self.code}: site not reachable")

    def today_bs(self) -> str:
        soup = BeautifulSoup(self._get(f"{self.base}?d=reports&f=daily_public"), "lxml")
        v = lambda n: soup.find("input", {"name": n})["value"]
        return f"{v('syy')}-{v('smm').zfill(2)}-{v('sdd').zfill(2)}"


# ---------------------------------------------------------------- parsing
def parse_bench_list(html: str) -> list[tuple[str, str]]:
    soup = BeautifulSoup(html, "lxml")
    sel = soup.find("select", {"name": "bench_type"})
    if not sel:
        return []
    return [(o["value"], clean(o.text)) for o in sel.find_all("option") if o.get("value")]


def parse_bench_page(html: str, bench_id: str, cli: Client) -> dict:
    soup = BeautifulSoup(html, "lxml")
    anchor = soup.find("a", {"name": bench_id})
    if not anchor:
        return {"cases": []}
    head = anchor.find_parent("table")
    tds = head.find_all("td")
    bench_no = ""
    m = re.search(r"इजलास नं\.?\s*(.+)", clean(tds[0].get_text(" ")))
    if m:
        bench_no = m.group(1).strip()
    bench_type = clean(tds[2].get_text(" ")) if len(tds) > 2 else ""
    weekday = ""
    m = re.search(r"रोज\s*(\S+)", clean(head.get_text(" ")))
    if m:
        weekday = m.group(1).translate(str.maketrans("0123456789", "०१२३४५६७८९"))
    judge_td = tds[3] if len(tds) > 3 else None
    judges = []
    if judge_td:
        for part in judge_td.get_text("\n").split("\n"):
            part = clean(part)
            if part:
                judges.append(split_judge(part))

    table = head.find_next("table")
    cases = []
    if table:
        for seq, tr in enumerate(table.find_all("tr")[1:]):
            cells = tr.find_all("td", recursive=False)
            if len(cells) < 11:
                continue
            link = cells[4].find("a", href=re.compile(r"case_details|caseprocess"))
            case_no = ""
            case_id = case_url = ""
            if link:
                mm = re.search(r"\d{3}\s*-\s*[A-Za-z]{2}\s*-\s*\d{3,5}", link.get_text(" "))
                case_no = re.sub(r"\s", "", mm.group(0)).upper() if mm else clean(link.get_text(" "))
                mm = re.search(r"(?:caseno|casno)=(\d+)", link["href"])
                case_id = mm.group(1) if mm else ""
                case_url = cli.dir + link["href"].lstrip("./")
            else:
                case_no = clean(cells[4].get_text(" "))
            note = clean(cells[4].get_text(" ").replace(case_no, "", 1)).strip("() ")
            parties = clean(cells[5].get_text(" "))
            app, resp = split_parties(parties)
            pdf = cells[10].find("a", href=re.compile("viewpdf"))
            outcome_cell = cells[10]
            for ul in outcome_cell.find_all("ul"):
                ul.extract()
            code = ""
            mm = re.match(r"\d{3}-([A-Z]{2})-", case_no.upper())
            if mm:
                code = mm.group(1)
            cases.append({
                "seq": seq,
                "serial": clean(cells[0].text),
                "faant": clean(cells[1].text),
                "reg_date": clean(cells[2].text),
                "subject": clean(cells[3].text),
                "case_no": case_no,
                "case_type": code,
                "case_id": case_id,
                "appellant": clean(app).strip(" ।"),
                "respondent": clean(resp).strip(" ।"),
                "adv_appellant": clean(cells[6].text),
                "adv_respondent": clean(cells[7].text),
                "remarks": clean(cells[8].text),
                "status": clean(cells[9].text),
                "outcome": clean(outcome_cell.get_text(" ")),
                "pdf_url": (cli.dir + pdf["href"].lstrip("./")) if pdf else "",
                "note": note,
                "case_url": case_url,
            })
    return {"bench_no": bench_no, "bench_type": bench_type, "weekday": weekday,
            "judges": judges, "cases": cases}


def split_parties(parties: str) -> tuple[str, str]:
    for sep in (r"\|\|", r"।\s*विरुद्ध\s*।", r"\sविरुद्ध\s"):
        p = re.split(sep, parties, maxsplit=1)
        if len(p) == 2:
            return p[0], p[1]
    return parties, ""


# ---------------------------------------------------------------- scraping
def scrape_day(cli: Client, con: sqlite3.Connection, bs_date: str) -> int:
    y, m, d = bs_parts(bs_date)
    html = cli.post({"mode": "showbench", "syy": y, "smm": m, "sdd": d})
    benches = parse_bench_list(html)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    court = cli.code
    if not benches:
        con.execute("INSERT OR REPLACE INTO hearing_days VALUES (?,?,?,?,0)", (court, bs_date, "", now))
        con.commit()
        return 0
    sdate = f"{y}{m}{d}"
    total, weekday = 0, ""
    for bid, label in benches:
        page = cli.post({"mode": "show", "syy": y, "smm": m, "sdd": d, "bench_type": bid, "sdate": sdate})
        b = parse_bench_page(page, bid, cli)
        weekday = b.get("weekday") or weekday
        names = [n for n, _ in b.get("judges", [])]
        for n, t in b.get("judges", []):
            con.execute("INSERT INTO judges(name,court,title) VALUES(?,?,?) ON CONFLICT(name,court) "
                        "DO UPDATE SET title=excluded.title", (n, court, t))
        con.execute("INSERT OR REPLACE INTO benches VALUES (?,?,?,?,?,?)",
                    (court, int(bid), bs_date, b.get("bench_no") or label.split(".")[0], b.get("bench_type", ""),
                     "|".join(names)))
        con.execute("DELETE FROM hearings WHERE court=? AND bench_id=?", (court, int(bid)))
        for c in b["cases"]:
            con.execute(
                "INSERT INTO hearings VALUES (:court,:bench_id,:bs_date,:seq,:serial,:faant,:reg_date,:subject,"
                ":case_no,:case_type,:case_id,:appellant,:respondent,:adv_appellant,:adv_respondent,:remarks,"
                ":status,:outcome,:pdf_url,:note,:case_url)",
                {**c, "court": court, "bench_id": int(bid), "bs_date": bs_date})
        total += len(b["cases"])
    con.execute("INSERT OR REPLACE INTO hearing_days VALUES (?,?,?,?,1)", (court, bs_date, weekday, now))
    con.commit()
    return total


def previous_bs(bs_date: str) -> str:
    """Step back one BS day. Month lengths vary (29-32); invalid dates simply return no list."""
    y, m, d = map(int, bs_date.split("-"))
    if d > 1:
        return f"{y}-{m:02d}-{d - 1:02d}"
    if m > 1:
        return f"{y}-{m - 1:02d}-32"
    return f"{y - 1}-12-30"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="BS date YYYY-MM-DD (default: today on the court site)")
    ap.add_argument("--days", type=int, default=8, help="how many days back to (re)scrape")
    ap.add_argument("--delay", type=float, default=0.7)
    ap.add_argument("--courts", default="all", help="comma list of codes (SC, SPC, HC1 …) or 'all'")
    args = ap.parse_args()

    con = db()
    codes = list(COURTS) if args.courts == "all" else args.courts.split(",")
    for code in codes:
        try:
            cli = Client(code, args.delay)
        except Exception as e:
            log(f"{code}: cannot open ({e})")
            continue
        kind = "SC" if code == "SC" else "special" if code == "SPC" else "high"
        con.execute("INSERT OR REPLACE INTO courts VALUES (?,?,?)", (code, cli.name, kind))
        start = args.date or cli.today_bs()
        log(f"== {code} {cli.name} (today {start})")
        day = start
        for _ in range(args.days):
            d = int(day.split("-")[2])
            if d <= 32:
                try:
                    n = scrape_day(cli, con, day)
                    if n:
                        log(f"  {day}: {n} cases")
                except Exception as e:
                    log(f"  {day}: ERROR {e}")
            day = previous_bs(day)
        con.execute("DELETE FROM hearing_days WHERE available=0 AND CAST(substr(bs_date,9,2) AS INT) > 29")
        con.commit()


if __name__ == "__main__":
    main()
