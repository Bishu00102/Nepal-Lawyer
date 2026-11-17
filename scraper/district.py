"""District courts: weekly list of authenticated judgments (प्रमाणीकरण भएका फैसलाको विवरण).

Source: https://supremecourt.gov.np/court/<district>dc/published_faisala (official, public).
Each page lists only the current week's authenticated judgments, so this runs daily and keeps
everything it has seen (table `district_judgments` in data/court.db).

Columns are matched by their header text, not position. NOTE: written against the page structure
while every district's list was empty (start of the week); verify the first rows once they appear.
"""
from __future__ import annotations

import re
import sqlite3
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "court.db"
HOME = "https://supremecourt.gov.np/web/"
UA = "NepalCourtTracker/1.0 (public judgment list reader)"
COLS = {"वादी": "plaintiff", "प्रतिवादी": "defendant", "मुद्दा नं": "case_no", "मुद्दा": "subject",
        "दर्ता मिति": "reg_date", "फैसला मिति": "decision_date", "प्रमाणीकरण मिति": "auth_date",
        "न्यायाधीश": "judge", "कैफियत": "remarks"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS district_judgments (
    court TEXT, court_name TEXT, case_no TEXT, subject TEXT, plaintiff TEXT, defendant TEXT,
    reg_date TEXT, decision_date TEXT, auth_date TEXT, judge TEXT, remarks TEXT, link TEXT, first_seen TEXT,
    PRIMARY KEY (court, case_no, decision_date)
);
"""


def get(s, url):
    for a in range(4):
        try:
            r = s.get(url, timeout=60)
            r.raise_for_status()
            r.encoding = "utf-8"
            return r.text
        except requests.RequestException:
            time.sleep(3 * (a + 1))
    return ""


def main():
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    s = requests.Session()
    s.headers["User-Agent"] = UA
    home = get(s, HOME)
    districts = sorted(set(re.findall(r'href="/court/([a-z]+dc)"', home)))
    print(f"{len(districts)} district courts", file=sys.stderr)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    total = 0
    for d in districts:
        html = get(s, f"https://supremecourt.gov.np/court/{d}/published_faisala")
        if not html:
            continue
        soup = BeautifulSoup(html, "lxml")
        h1 = soup.find("h1")
        name = re.sub(r"\s+", " ", h1.get_text(" ")).split("को")[0].strip() if h1 else d
        table = soup.find("table")
        if not table:
            continue
        heads = [re.sub(r"\s+", " ", th.get_text(" ")).strip() for th in table.find_all("th")]
        keys = []
        for h in heads:
            k = next((v for c, v in COLS.items() if c in h and v not in keys), None)
            # "मुद्दा नं" must win over "मुद्दा"
            if h.strip().startswith("मुद्दा नं"):
                k = "case_no"
            keys.append(k)
        n = 0
        for tr in table.select("tbody tr"):
            cells = tr.find_all("td")
            if len(cells) < 5:
                continue
            row = {k: re.sub(r"\s+", " ", c.get_text(" ")).strip() for k, c in zip(keys, cells) if k}
            link = tr.find("a", href=True)
            con.execute("""INSERT OR IGNORE INTO district_judgments VALUES
                (?,?,?,?,?,?,?,?,?,?,?,?,?)""", (d, name, row.get("case_no", ""), row.get("subject", ""),
                row.get("plaintiff", ""), row.get("defendant", ""), row.get("reg_date", ""),
                row.get("decision_date", ""), row.get("auth_date", ""), row.get("judge", ""),
                row.get("remarks", ""), link["href"] if link else "", now))
            n += 1
        total += n
        time.sleep(0.4)
    con.commit()
    print(f"{total} rows seen this run; {con.execute('SELECT count(*) FROM district_judgments').fetchone()[0]} stored",
          file=sys.stderr)


if __name__ == "__main__":
    main()
