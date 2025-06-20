#!/usr/bin/env python
"""Batch‑fetch **inbound citations** (papers that cite A) from Semantic Scholar (unauthenticated).

• Uses the `/paper/batch` endpoint (≤ 500 IDs per POST).
• Still unauthenticated → very low quota, so throttle hard.
• Stores edges C → A where *C cites A* (i.e. incoming citations).
"""

import time
import sqlite3
import argparse
from datetime import datetime
from typing import List, Dict

import requests
from tqdm import tqdm

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
DB_PATH      = "arxiv_papers.db"
API_URL      = "https://api.semanticscholar.org/graph/v1/paper/batch"
FIELDS       = "title,year,externalIds,citations.paperId"  # inbound citations
BATCH_SIZE   = 200   # ≤500
SLEEP_BETWEEN_CALLS = 2.0  # unauth quota ≈100 req/day

HEADERS = {
    "User-Agent": "quantph-citation-crawler/unauth (github.com/yourname)"
}

# -----------------------------------------------------------------------------
# SQLite helpers
# -----------------------------------------------------------------------------

def init_db(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    cur = con.cursor()
    cur.execute("PRAGMA foreign_keys = ON;")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS papers (
        paper_id            TEXT PRIMARY KEY,
        title               TEXT,
        year                INTEGER,
        external_arxiv_id   TEXT,
        external_doi        TEXT,
        last_fetched        TEXT
    );""")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS citations (
        src_paper_id TEXT,
        dst_paper_id TEXT,
        PRIMARY KEY (src_paper_id, dst_paper_id)
    );""")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS arxiv_to_s2 (
        arxiv_id TEXT PRIMARY KEY,
        s2_id    TEXT UNIQUE
    );""")

    con.commit()
    return con


def need_lookup_arxiv_ids(con: sqlite3.Connection, limit: int | None = None) -> List[str]:
    """Return arXiv IDs not yet mapped to S2."""
    sql = """
        SELECT arxiv_id FROM arxiv_papers
        WHERE arxiv_id NOT IN (SELECT arxiv_id FROM arxiv_to_s2)
    """
    cur = con.cursor()
    if limit:
        cur.execute(sql + " LIMIT ?", (limit,))
    else:
        cur.execute(sql)
    return [r[0] for r in cur.fetchall()]

# -----------------------------------------------------------------------------
# API helpers
# -----------------------------------------------------------------------------

def fetch_batch(arxiv_ids: List[str]) -> List[Dict]:
    payload = {"ids": [f"arXiv:{a}" for a in arxiv_ids]}
    params  = {"fields": FIELDS}
    r = requests.post(API_URL, json=payload, params=params, headers=HEADERS, timeout=60)

    if r.status_code == 429:
        retry = int(r.headers.get("Retry-After", "10"))
        time.sleep(retry)
        return fetch_batch(arxiv_ids)

    r.raise_for_status()
    return r.json()

# -----------------------------------------------------------------------------
# Upsert helpers
# -----------------------------------------------------------------------------

def upsert_paper(cur: sqlite3.Cursor, p: Dict):
    pid   = p["paperId"]
    title = p.get("title")
    year  = p.get("year")
    ext   = p.get("externalIds") or {}
    arx   = ext.get("ArXiv")
    doi   = ext.get("DOI")
    now   = datetime.utcnow().isoformat()

    cur.execute(
        """INSERT INTO papers(paper_id,title,year,external_arxiv_id,external_doi,last_fetched)
             VALUES (?,?,?,?,?,?)
             ON CONFLICT(paper_id) DO UPDATE SET
                title          = excluded.title,
                year           = excluded.year,
                external_arxiv_id = COALESCE(papers.external_arxiv_id, excluded.external_arxiv_id),
                external_doi      = COALESCE(papers.external_doi     , excluded.external_doi),
                last_fetched      = excluded.last_fetched""",
        (pid, title, year, arx, doi, now)
    )

    if arx:
        cur.execute("INSERT OR IGNORE INTO arxiv_to_s2(arxiv_id, s2_id) VALUES (?,?)", (arx, pid))


def upsert_inbound(cur: sqlite3.Cursor, target_pid: str, citing_list: List[Dict]):
    """Insert edges C→A where C cites A."""
    for c in citing_list:
        src = c.get("paperId")
        if not src:
            continue
        cur.execute("INSERT OR IGNORE INTO papers(paper_id) VALUES (?)", (src,))
        cur.execute("INSERT OR IGNORE INTO citations(src_paper_id,dst_paper_id) VALUES (?,?)", (src, target_pid))

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def main(limit: int | None, batch: int):
    con = init_db(DB_PATH)
    cur = con.cursor()

    pending = need_lookup_arxiv_ids(con, limit)
    if not pending:
        print("No new arXiv IDs to process.")
        return

    pbar = tqdm(total=len(pending), unit="paper")

    for i in range(0, len(pending), batch):
        chunk = pending[i:i+batch]
        data  = fetch_batch(chunk)
        for rec in data:
            if not isinstance(rec, dict) or "paperId" not in rec:
                continue
            upsert_paper(cur, rec)
            upsert_inbound(cur, rec["paperId"], rec.get("citations", []))
        con.commit()
        pbar.update(len(chunk))
        time.sleep(SLEEP_BETWEEN_CALLS)

    pbar.close()
    con.close()
    print("✅ Inbound citation crawl finished.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser("Batch fetch inbound citations (unauthenticated)")
    parser.add_argument("--limit", type=int, default=None, help="Only process N arXiv IDs")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="IDs per POST (≤500)")
    args = parser.parse_args()
    main(args.limit, args.batch_size)
