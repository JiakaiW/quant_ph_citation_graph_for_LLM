import sqlite3

con = sqlite3.connect("arxiv_papers.db")
cur = con.cursor()

# –– create filtered_papers table –– ---------------------------------- #
cur.execute("DROP TABLE IF EXISTS filtered_papers")
cur.execute("""
    CREATE TABLE filtered_papers AS
    SELECT *
    FROM papers
    WHERE
        COALESCE(title, '') != ''
        OR COALESCE(year, '') != ''
        OR COALESCE(external_arxiv_id, '') != ''
        OR COALESCE(external_doi, '') != ''
""")
con.commit()

# –– create filtered_citations table –– ---------------------------------- #
cur.execute("DROP TABLE IF EXISTS filtered_citations")
cur.execute("""
    CREATE TABLE filtered_citations AS
    SELECT c.src_paper_id AS src, c.dst_paper_id AS dst
    FROM citations c
    JOIN filtered_papers p1 ON p1.paper_id = c.src_paper_id
    JOIN filtered_papers p2 ON p2.paper_id = c.dst_paper_id
""")
con.commit()
print("✅ filtered_citations table created (only between valid papers)")