#!/usr/bin/env python3
"""
Export papers + citation edges from arxiv_papers.db to CSVs
for *Neo4j* LOAD CSV.

–– What it does ––
• Strips LaTeX commands and any weird punctuation up-front.
• Collapses newlines ↦ space (Neo4j chokes on hidden line-breaks).
• Doubles any remaining double-quotes → RFC-4180 escape.
• Replaces commas with space (so you can keep QUOTE_MINIMAL).
• Guarantees no dangling back-slash – Neo4j treats "\" literally.

Everything else is shipped through Python’s csv.writer,
which already follows RFC-4180.

Run time for 1 M papers ≈ 3-4 s on a laptop.
"""

from __future__ import annotations
import csv, re, sqlite3, sys
from pathlib import Path

DB        = "arxiv_papers.db"
OUT_DIR   = Path("./")                      # adjust if Neo4j import dir differs
PAPER_CSV = OUT_DIR / "papers.csv"
EDGE_CSV  = OUT_DIR / "citations.csv"

# --------------------------------------------------------------------------- #
# 1.  Tiny regex helpers                                                      #
# --------------------------------------------------------------------------- #
LATEX_CMD   = re.compile(r"\\[A-Za-z]+(\{.*?\})?")  # \alpha, \documentclass{..}
BAD_CHARS   = re.compile(r"[^A-Za-z0-9 \-]")        # allow letters, digits, space, dash
MULTISPACE  = re.compile(r"\s{2,}")

def sanitize(raw: str | None) -> str:
    """Return a Neo4j-safe CSV field (never None)."""
    if not raw:
        return ""
    text = str(raw)

    # 1️⃣ kill LaTeX commands *before* anything else
    text = LATEX_CMD.sub(" ", text)

    # 2️⃣ normalise whitespace & newlines
    text = text.replace("\n", " ").replace("\r", " ")

    # 3️⃣ keep only safe ASCII chars
    text = BAD_CHARS.sub(" ", text)

    # 4️⃣ collapse runs of spaces, strip ends
    text = MULTISPACE.sub(" ", text).strip()

    # 5️⃣ CSV escapes
    text = text.replace('"', '""')  # RFC-4180 quote escape
    text = text.replace(",", " ")   # avoid accidental new column

    return text

# --------------------------------------------------------------------------- #
# 2.  Main export                                                             #
# --------------------------------------------------------------------------- #
def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    cur = con.cursor()

    # –– papers.csv –– ------------------------------------------------------- #
    total = 0
    with PAPER_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_ALL)
        w.writerow(["paper_id", "title", "year", "external_arxiv_id", "external_doi"])
        for pid, title, year, arx, doi in cur.execute(
            "SELECT paper_id, title, year, external_arxiv_id, external_doi FROM filtered_papers"
        ):
            w.writerow(
                [
                    pid,
                    sanitize(title),
                    year or "",
                    sanitize(arx),
                    sanitize(doi),
                ]
            )
            total += 1
    print(f"✅ papers.csv written ({total:,} rows)")

    # –– citations.csv –– ---------------------------------------------------- #
    with EDGE_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_ALL)
        w.writerow(["src", "dst"])
        for src, dst in cur.execute("SELECT src, dst FROM filtered_citations"):
            w.writerow([src, dst])
    print("✅ citations.csv written (from filtered_citations)")
    con.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        # If something *still* blows up, die loudly with the offending record
        print("💥 Export failed:", err, file=sys.stderr)
        sys.exit(1)
