#!/usr/bin/env python
"""
Simple OAI-PMH crawler for arXiv quant-ph.
Crawls backward from a specified date, stops when encountering a month where all papers already exist in DB.
"""

import time
import sqlite3
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from tqdm import tqdm
import argparse

# OAI-PMH endpoint and headers
OAI_URL = "https://export.arxiv.org/oai2"
HEADERS = {"User-Agent": "quantph-oai-harvester/0.4 (your_email@domain)"}

# Namespaces for parsing
NS = {
    "oai":   "http://www.openarchives.org/OAI/2.0/",
    "arxiv": "http://arxiv.org/OAI/arXiv/"
}


def init_db(path="arxiv_papers.db") -> sqlite3.Connection:
    """Initialize SQLite DB and ensure the papers table has title."""
    con = sqlite3.connect(path)
    cur = con.cursor()
    # Create or alter table to include title column
    cur.execute("""
        CREATE TABLE IF NOT EXISTS arxiv_papers(
            arxiv_id        TEXT PRIMARY KEY,
            submitted_date  TEXT NOT NULL,
            title           TEXT NOT NULL,
            first_seen_date TEXT NOT NULL,
            analyzed_date   TEXT,
            analysis_status TEXT DEFAULT 'pending'
        );
    """)
    # In case table existed without title, attempt to add column
    try:
        cur.execute("ALTER TABLE arxiv_papers ADD COLUMN title TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        # column already exists or cannot add: ignore
        pass
    cur.execute("CREATE INDEX IF NOT EXISTS idx_submitted ON arxiv_papers(submitted_date)")
    con.commit()
    return con


def get_date_range(con: sqlite3.Connection) -> tuple[str, str]:
    """Get the earliest and latest submission dates in the database."""
    cur = con.cursor()
    cur.execute("SELECT MIN(submitted_date), MAX(submitted_date) FROM arxiv_papers")
    result = cur.fetchone()
    return result[0], result[1]


def known_ids(con: sqlite3.Connection, ids: list[str]) -> set[str]:
    """Return set of IDs already in the DB."""
    if not ids:
        return set()
    cur = con.cursor()
    placeholders = ",".join("?" for _ in ids)
    cur.execute(f"SELECT arxiv_id FROM arxiv_papers WHERE arxiv_id IN ({placeholders})", ids)
    return {row[0] for row in cur.fetchall()}


def insert_rows(con: sqlite3.Connection, rows: list[tuple[str, str, str]], ts: str) -> int:
    """Insert new (id, submitted_date, title) rows with first_seen = ts."""
    if not rows:
        return 0
    cur = con.cursor()
    cur.executemany(
        "INSERT OR IGNORE INTO arxiv_papers(arxiv_id,submitted_date,title,first_seen_date) "
        "VALUES (?,?,?,?)",
        [(aid, subd, title, ts) for aid, subd, title in rows]
    )
    con.commit()
    return cur.rowcount


def fetch_month(con: sqlite3.Connection, year: int, month: int, ts: str) -> tuple[int, bool]:
    """
    Fetch one month via ListRecords.
    
    Returns:
        tuple: (papers_added, all_existed)
        - papers_added: number of new papers added
        - all_existed: True if ALL papers in this month already existed in DB
    """
    for attempt in range(3):
        try:
            return _fetch_month_inner(con, year, month, ts)
        except requests.ConnectionError as e:
            wait = 5 * (attempt + 1)
            print(f"Connection error {e}, retrying in {wait}s...")
            time.sleep(wait)
        except Exception as e:
            # Handle cases where no records exist for this month
            if any(keyword in str(e).lower() for keyword in ["norecordsmatch"]):
                print(f"No records found for {year}-{month:02d} (likely before arXiv started)")
                return -1, False  # Signal that we've reached the limit
            elif any(keyword in str(e).lower() for keyword in ["badargument"]):
                print(f"Bad argument in {year}-{month:02d}: {e}")
                return -2, False  # Signal that we've reached the limit
            print(f"Error in {year}-{month:02d}: {e}")
            return 0, False
    print(f"Failed month {year}-{month:02d} after retries.")
    return 0, False


def _fetch_month_inner(con: sqlite3.Connection, year: int, month: int, ts: str) -> tuple[int, bool]:
    """Internal logic to harvest and insert records for a month."""
    from_dt = f"{year:04d}-{month:02d}-01"
    next_month = (datetime(year, month, 1) + timedelta(days=32)).replace(day=1)
    until_dt = (next_month - timedelta(days=1)).strftime("%Y-%m-%d")
    params = {
        "verb": "ListRecords",
        "set": "physics:quant-ph",
        "metadataPrefix": "arXiv",
        "from": from_dt,
        "until": until_dt
    }

    seen_ids = set()
    new_count = 0
    total_papers_in_month = 0

    while True:
        resp = requests.get(OAI_URL, params=params, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        
        root = ET.fromstring(resp.content)
        
        # Check for errors
        error = root.find(".//oai:error", NS)
        if error is not None:
            error_code = error.get("code", "unknown")
            error_text = error.text or "unknown error"
            raise Exception(f"{error_code}: {error_text}")

        # Parse records
        records = root.findall(".//oai:record", NS)
        batch, batch_ids = [], []

        for rec in records:
            meta = rec.find(".//arxiv:arXiv", NS)
            if meta is None:
                continue
            aid = meta.findtext("arxiv:id", namespaces=NS)
            created = meta.findtext("arxiv:created", namespaces=NS)
            title = meta.findtext("arxiv:title", namespaces=NS) or ""
            if aid and created and created.startswith(f"{year:04d}-{month:02d}"):
                batch.append((aid, created, title.strip()))
                batch_ids.append(aid)

        # Deduplicate within batch
        unique = [r for r in batch if r[0] not in seen_ids]
        seen_ids.update([r[0] for r in unique])

        # Count total papers in this month and check which already exist
        total_papers_in_month += len(unique)
        existing_ids = known_ids(con, batch_ids)
        unseen = [r for r in unique if r[0] not in existing_ids]

        if unseen:
            added = insert_rows(con, unseen, ts)
            new_count += added

        # Handle paging
        token = root.findtext(".//oai:resumptionToken", namespaces=NS)
        if not token:
            break
        params = {"verb": "ListRecords", "resumptionToken": token}
        time.sleep(1)  # polite pause

    # Check if ALL papers in this month already existed
    all_existed = (total_papers_in_month > 0) and (new_count == 0)
    return new_count, all_existed

def prev_month(dt: datetime) -> datetime:
    """Return the first day of the previous month."""
    return (dt.replace(day=1) - timedelta(days=1)).replace(day=1)

def crawl_from_date(con: sqlite3.Connection, start_date: str) -> int:
    """
    Crawl backward from start_date, stopping when we encounter a month where all papers already exist.
    
    Args:
        con: Database connection
        start_date: Date to start from in YYYY-MM-DD format
    """
    start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(day=1)
    ts = datetime.now().isoformat()
    
    # Get current database date range
    earliest_in_db, latest_in_db = get_date_range(con)
    if earliest_in_db:
        print(f"Current DB range: {earliest_in_db} to {latest_in_db}")
    else:
        print("Empty database - starting fresh crawl")

    print(f"🕰️  Starting crawl from {start_dt.strftime('%Y-%m')} going backward")
    print(f"🛑 Will stop when encountering a month where all papers already exist in DB")
    
    pbar = tqdm(desc="Crawling backward")
    today = datetime.utcnow().replace(day=1)
    cursor = start_dt
    total_added = 0
    consecutive_bad_args = 0
    max_consecutive_bad_args = 3  # Stop if we hit 3 consecutive "start date too early" errors
    
    while True:
        if cursor > today:
            # Future month—skip
            cursor = prev_month(cursor)
            continue
            
        added, all_existed = fetch_month(con, cursor.year, cursor.month, ts)
        
        if added == -1:
            print(f"🛑 Skipping {cursor.strftime('%Y-%m')}: API returned noRecordsMatch")
            cursor = prev_month(cursor)
            continue

        if added == -2:
            consecutive_bad_args += 1
            print(f"🛑 Skipping {cursor.strftime('%Y-%m')}: Bad argument (consecutive: {consecutive_bad_args})")
            
            if consecutive_bad_args >= max_consecutive_bad_args:
                print(f"🛑 Stopping: Hit {consecutive_bad_args} consecutive 'start date too early' errors")
                print(f"📅 Reached arXiv API's date limit around {cursor.strftime('%Y-%m')}")
                break
                
            cursor = prev_month(cursor)
            continue

        # Reset bad argument counter if we got a successful response
        consecutive_bad_args = 0

        if all_existed:
            print(f"🛑 Stopping: All papers in {cursor.strftime('%Y-%m')} already in DB")
            break

        total_added += added
        cursor = prev_month(cursor)
            
        # Update progress
        pbar.set_postfix({
            "month": cursor.strftime('%Y-%m'),
            "added": added,
            "total": total_added
        })
        
        pbar.update(1)

    pbar.close()
    return total_added


def main():
    parser = argparse.ArgumentParser(description="arXiv quant-ph paper crawler")
    parser.add_argument("--start-date", type=str, default=datetime.now().strftime("%Y-%m-%d"),
                       help="Date to start crawling from (YYYY-MM-DD format, default: today)")
    
    args = parser.parse_args()
    
    # Validate date format
    try:
        datetime.strptime(args.start_date, "%Y-%m-%d")
    except ValueError:
        print("Error: start-date must be in YYYY-MM-DD format")
        return
    
    conn = init_db()
    existing = conn.execute("SELECT COUNT(*) FROM arxiv_papers").fetchone()[0]
    print(f"DB initially has {existing:,} records.")
    
    print(f"🚀 Starting crawl from {args.start_date}...")
    added = crawl_from_date(conn, args.start_date)
    
    final = conn.execute("SELECT COUNT(*) FROM arxiv_papers").fetchone()[0]
    print(f"\n✅ Crawl completed!")
    print(f"📈 Added {added:,} new papers")
    print(f"💾 DB now has {final:,} total records")
    
    # Show final date range
    earliest, latest = get_date_range(conn)
    if earliest and latest:
        print(f"📅 Final date range: {earliest} to {latest}")
    
    conn.close()


if __name__ == "__main__":
    main()

