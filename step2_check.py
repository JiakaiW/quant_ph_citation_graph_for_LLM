#!/usr/bin/env python
"""
Check the number of processed papers and sample citation stats from the SQLite DB.
"""
import sqlite3
import random
from tabulate import tabulate

DB_PATH = "arxiv_papers.db"
SAMPLE_SIZE = 10

def get_stats():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    total_arxiv = cur.execute("SELECT COUNT(*) FROM arxiv_papers").fetchone()[0]
    mapped_arxiv = cur.execute("SELECT COUNT(*) FROM arxiv_to_s2").fetchone()[0]
    total_s2_papers = cur.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
    total_edges = cur.execute("SELECT COUNT(*) FROM citations").fetchone()[0]

    print("\n📊 Database Stats:")
    print(f"  Total arXiv papers:        {total_arxiv:,}")
    print(f"  With S2 ID mapped:         {mapped_arxiv:,}")
    print(f"  Total unique S2 papers:    {total_s2_papers:,}")
    print(f"  Total citation edges:      {total_edges:,}")

    return con, cur

def sample_citations(cur):
    s2_ids = cur.execute("SELECT s2_id FROM arxiv_to_s2 WHERE s2_id IN (SELECT src_paper_id FROM citations)").fetchall()
    s2_ids = [x[0] for x in s2_ids]

    if not s2_ids:
        print("⚠️  No papers with citation data available.")
        return

    sample = random.sample(s2_ids, min(SAMPLE_SIZE, len(s2_ids)))
    print(f"\n🔍 Sample of {len(sample)} papers and their citation counts:")

    rows = []
    for pid in sample:
        title = cur.execute("SELECT title FROM papers WHERE paper_id = ?", (pid,)).fetchone()
        count = cur.execute("SELECT COUNT(*) FROM citations WHERE src_paper_id = ?", (pid,)).fetchone()[0]
        rows.append((pid[:10], count, title[0][:80] if title and title[0] else ""))

    print(tabulate(rows, headers=["S2 Paper ID", "# Cites", "Title (truncated)"], tablefmt="pretty"))

if __name__ == "__main__":
    con, cur = get_stats()
    sample_citations(cur)
    con.close()
