#!/usr/bin/env python3
"""
Data loading and saving utilities for the clustering pipeline.
Handles all database interactions and data preparation.
"""

import sqlite3
import pandas as pd
import numpy as np
import time
from collections import Counter

# --- Configuration ---
DB_PATH = "../../data/arxiv_papers.db"

def load_graph_from_db():
    """Load the filtered citation graph from the database."""
    print("Loading filtered citation graph from database...")
    con = sqlite3.connect(DB_PATH)
    
    # Load filtered papers
    papers_df = pd.read_sql_query("SELECT paper_id FROM filtered_papers", con)
    paper_ids = papers_df['paper_id'].tolist()
    paper_to_idx = {pid: idx for idx, pid in enumerate(paper_ids)}
    
    # Load filtered citations
    citations_df = pd.read_sql_query("SELECT src, dst FROM filtered_citations", con)
    
    # Convert to indices
    src_indices = [paper_to_idx[pid] for pid in citations_df['src']]
    dst_indices = [paper_to_idx[pid] for pid in citations_df['dst']]
    
    con.close()
    
    print(f"Loaded {len(paper_ids)} filtered papers and {len(src_indices)} filtered citations")
    return paper_ids, paper_to_idx, src_indices, dst_indices

def load_subset_for_debug(max_papers=1000):
    """Load a small subset of the graph for debugging purposes."""
    print(f"Loading subset of {max_papers} papers for debugging...")
    con = sqlite3.connect(DB_PATH)
    
    # Fast approach: just take first N papers and their connections
    print("   Using fast sampling (first N papers)...")
    papers_df = pd.read_sql_query(
        "SELECT paper_id FROM filtered_papers LIMIT ?", 
        con, params=(max_papers,)
    )
    paper_ids = papers_df['paper_id'].tolist()
    paper_to_idx = {pid: idx for idx, pid in enumerate(paper_ids)}
    paper_set = set(paper_ids)
    
    # Load only citations within this subset
    print("   Loading citations within subset...")
    citations_query = """
        SELECT src, dst FROM filtered_citations 
        WHERE src IN ({}) AND dst IN ({})
    """.format(
        ','.join(['?'] * len(paper_set)),
        ','.join(['?'] * len(paper_set))
    )
    
    subset_citations = pd.read_sql_query(
        citations_query, 
        con, 
        params=list(paper_set) + list(paper_set)
    )
    
    # Convert to indices
    src_indices = [paper_to_idx[pid] for pid in subset_citations['src'] if pid in paper_to_idx]
    dst_indices = [paper_to_idx[pid] for pid in subset_citations['dst'] if pid in paper_to_idx]
    
    con.close()
    
    print(f"Loaded {len(paper_ids)} papers and {len(src_indices)} citations for debugging")
    return paper_ids, paper_to_idx, src_indices, dst_indices

def load_subset_for_debug_by_degree(max_papers=1000):
    """Load a subset by degree (slower but better for testing clustering)."""
    print(f"Loading subset of {max_papers} highest-degree papers...")
    con = sqlite3.connect(DB_PATH)
    
    # Pre-compute degrees in a more efficient way
    print("   Computing node degrees...")
    degree_query = """
        WITH src_counts AS (
            SELECT src as paper_id, COUNT(*) as out_degree 
            FROM filtered_citations GROUP BY src
        ),
        dst_counts AS (
            SELECT dst as paper_id, COUNT(*) as in_degree 
            FROM filtered_citations GROUP BY dst
        )
        SELECT 
            p.paper_id,
            COALESCE(s.out_degree, 0) + COALESCE(d.in_degree, 0) as degree
        FROM filtered_papers p
        LEFT JOIN src_counts s ON p.paper_id = s.paper_id
        LEFT JOIN dst_counts d ON p.paper_id = d.paper_id
        ORDER BY degree DESC
        LIMIT ?
    """
    papers_df = pd.read_sql_query(degree_query, con, params=(max_papers,))
    paper_ids = papers_df['paper_id'].tolist()
    paper_to_idx = {pid: idx for idx, pid in enumerate(paper_ids)}
    paper_set = set(paper_ids)
    
    # Load citations within this subset
    print("   Loading citations within subset...")
    citations_query = """
        SELECT src, dst FROM filtered_citations 
        WHERE src IN ({}) AND dst IN ({})
    """.format(
        ','.join(['?'] * len(paper_set)),
        ','.join(['?'] * len(paper_set))
    )
    
    subset_citations = pd.read_sql_query(
        citations_query, 
        con, 
        params=list(paper_set) + list(paper_set)
    )
    
    # Convert to indices
    src_indices = [paper_to_idx[pid] for pid in subset_citations['src'] if pid in paper_to_idx]
    dst_indices = [paper_to_idx[pid] for pid in subset_citations['dst'] if pid in paper_to_idx]
    
    con.close()
    
    print(f"Loaded {len(paper_ids)} papers and {len(src_indices)} citations for debugging")
    return paper_ids, paper_to_idx, src_indices, dst_indices

def save_results_to_db(paper_ids, embeddings_2d, cluster_labels):
    """Save clustering results and 2D embeddings to the database."""
    print("Saving results to database...")
    
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            con = sqlite3.connect("../../data/arxiv_papers.db", timeout=30.0)
            
            # Set pragmas for better concurrency
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("PRAGMA synchronous=NORMAL")
            con.execute("PRAGMA temp_store=memory")
            con.execute("PRAGMA mmap_size=268435456")  # 256MB
            
            # Add columns if they don't exist (handle gracefully if they already exist)
            columns_to_add = [
                ("embedding_x", "REAL"),
                ("embedding_y", "REAL"),
                ("cluster_id", "INTEGER"),
                ("cluster_size", "INTEGER"),
                ("processed_date", "TEXT")
            ]
            
            for col_name, col_type in columns_to_add:
                try:
                    con.execute(f"ALTER TABLE filtered_papers ADD COLUMN {col_name} {col_type}")
                    print(f"✅ Added column: {col_name}")
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e).lower():
                        pass  # Column already exists, which is fine
                    else:
                        print(f"⚠️  Could not add column {col_name}: {e}")
            
            # Calculate cluster sizes
            cluster_sizes = Counter(cluster_labels)
            
            # Update the filtered_papers table with results
            print(f"📝 Updating {len(paper_ids)} papers with clustering results...")
            
            # Verify array dimensions match
            if len(paper_ids) != len(embeddings_2d) or len(paper_ids) != len(cluster_labels):
                print(f"⚠️  Array size mismatch:")
                print(f"   paper_ids: {len(paper_ids)}")
                print(f"   embeddings_2d: {len(embeddings_2d)}")
                print(f"   cluster_labels: {len(cluster_labels)}")
                print("   Using minimum size for safety...")
                min_size = min(len(paper_ids), len(embeddings_2d), len(cluster_labels))
                paper_ids = paper_ids[:min_size]
            
            # Use batch updates for better performance
            batch_size = 1000
            current_time = time.strftime("%Y-%m-%d %H:%M:%S")
            
            for i in range(0, len(paper_ids), batch_size):
                batch_end = min(i + batch_size, len(paper_ids))
                batch_updates = []
                
                for j in range(i, batch_end):
                    paper_id = paper_ids[j]
                    cluster_id = int(cluster_labels[j])
                    cluster_size = cluster_sizes[cluster_id]
                    
                    batch_updates.append((
                        float(embeddings_2d[j, 0]), 
                        float(embeddings_2d[j, 1]), 
                        cluster_id,
                        cluster_size,
                        current_time,
                        paper_id
                    ))
                
                con.executemany("""
                    UPDATE filtered_papers 
                    SET embedding_x = ?, embedding_y = ?, cluster_id = ?, 
                        cluster_size = ?, processed_date = ?
                    WHERE paper_id = ?
                """, batch_updates)
                
                if (i // batch_size + 1) % 10 == 0:
                    print(f"   📝 Processed {batch_end:,}/{len(paper_ids):,} papers...")
            
            con.commit()
            print(f"✅ Successfully saved results for {len(paper_ids):,} papers to database")
            
            # Verify the save
            result = con.execute("SELECT COUNT(*) FROM filtered_papers WHERE cluster_id IS NOT NULL").fetchone()
            saved_count = result[0] if result else 0
            print(f"✅ Verification: {saved_count:,} papers now have clustering results")
            
            con.close()
            return True
            
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e).lower() and attempt < max_retries - 1:
                print(f"⚠️  Database locked, retrying in {2 ** attempt} seconds... (attempt {attempt + 1}/{max_retries})")
                time.sleep(2 ** attempt)
                continue
            else:
                print(f"❌ Failed to save to database: {e}")
                return False
        except Exception as e:
            print(f"❌ Unexpected error saving to database: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            try:
                con.close()
            except:
                pass
    
    print(f"❌ Failed to save to database after {max_retries} attempts")
    return False

def get_node_degrees():
    """Get node degrees for all papers in the database."""
    con = sqlite3.connect(DB_PATH)
    
    # Calculate degrees
    degree_query = """
        SELECT paper_id, 
               (SELECT COUNT(*) FROM filtered_citations WHERE src = paper_id) +
               (SELECT COUNT(*) FROM filtered_citations WHERE dst = paper_id) as degree
        FROM filtered_papers
    """
    degrees_df = pd.read_sql_query(degree_query, con)
    con.close()
    
    return dict(zip(degrees_df['paper_id'], degrees_df['degree'])) 