#!/usr/bin/env python3
"""
Database preparation script for full clustering pipeline.
Adds necessary columns and cleans up any partial results.
"""

import sqlite3
import os

# TABLE_NAME = "filtered_papers"
TABLE_NAME = "physics_clustering"

def analyze_database():
    """Analyze the current database structure and contents."""
    print("🔍 Analyzing database structure...")
    print("=" * 50)
    
    con = sqlite3.connect("../../../data/arxiv_papers.db")
    
    # Check table sizes
    tables_info = [
        ("papers", "Main papers table"),
        (f"{TABLE_NAME}", "Filtered papers (our target)"),
        ("filtered_citations", "Filtered citations"),
        ("citations", "All citations"),
        ("arxiv_papers", "ArXiv metadata")
    ]
    
    for table, description in tables_info:
        try:
            result = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            count = result[0] if result else 0
            print(f"📊 {description}: {count:,} records")
        except sqlite3.OperationalError as e:
            print(f"❌ {description}: Table not found ({e})")
    
    print()
    
    # Check filtered_papers structure
    print("🔍 Filtered papers table structure:")
    columns = con.execute(f"PRAGMA table_info({TABLE_NAME})").fetchall()
    for col in columns:
        print(f"   - {col[1]} ({col[2]})")
    
    # Check for existing clustering data
    try:
        result = con.execute(f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE cluster_id IS NOT NULL").fetchone()
        clustered_count = result[0] if result else 0
        print(f"\n📊 Papers with existing cluster_id: {clustered_count:,}")
    except sqlite3.OperationalError:
        print("\n📊 No cluster_id column found")
    
    try:
        result = con.execute(f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE embedding_x IS NOT NULL").fetchone()
        embedded_count = result[0] if result else 0
        print(f"📊 Papers with existing embeddings: {embedded_count:,}")
    except sqlite3.OperationalError:
        print("📊 No embedding columns found")
    
    con.close()

def prepare_filtered_papers_table():
    """Add necessary columns to filtered_papers table."""
    print(f"\n🔧 Preparing {TABLE_NAME} table...")
    print("=" * 50)
    
    con = sqlite3.connect("../../../data/arxiv_papers.db")
    
    columns_to_add = [
        ("embedding_x", "REAL", "X coordinate of 2D embedding"),
        ("embedding_y", "REAL", "Y coordinate of 2D embedding"), 
        ("cluster_id", "INTEGER", "Cluster assignment ID"),
        ("cluster_size", "INTEGER", "Size of assigned cluster"),
        ("processed_date", "TEXT", "When clustering was performed")
    ]
    
    for col_name, col_type, description in columns_to_add:
        try:
            con.execute(f"ALTER TABLE {TABLE_NAME} ADD COLUMN {col_name} {col_type}")
            print(f"✅ Added column: {col_name} ({description})")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(f"⚠️  Column {col_name} already exists")
            else:
                print(f"❌ Failed to add {col_name}: {e}")
    
    con.commit()
    con.close()

def clean_partial_results():
    """Clean up any partial clustering results."""
    print("\n🧹 Cleaning partial results...")
    print("=" * 50)
    
    con = sqlite3.connect("../../../data/arxiv_papers.db")
    
    # Reset clustering columns in physics_clustering
    try:
        con.execute("""
            UPDATE {TABLE_NAME} 
            SET embedding_x = NULL, 
                embedding_y = NULL, 
                cluster_id = NULL, 
                cluster_size = NULL,
                processed_date = NULL
        """)
        affected = con.total_changes
        print(f"✅ Reset clustering data for {affected:,} papers in {TABLE_NAME}")
    except sqlite3.OperationalError as e:
        print(f"⚠️  Could not reset {TABLE_NAME}: {e}")
    
    # Also clean the main papers table clustering data (if any)
    try:
        con.execute("""
            UPDATE papers 
            SET embedding_x = NULL, 
                embedding_y = NULL, 
                cluster_id = NULL
        """)
        affected = con.total_changes
        print(f"✅ Reset clustering data for {affected:,} papers in main papers table")
    except sqlite3.OperationalError as e:
        print(f"⚠️  Could not reset papers table: {e}")
    
    con.commit()
    con.close()

def clean_cache_files():
    """Remove cached embedding and clustering files."""
    print("\n🗑️  Cleaning cache files...")
    print("=" * 50)
    
    cache_patterns = [
        "embeddings_*.npy",
        "cluster_labels_*.npy", 
        "elbow_search_*.npy",
        "*umap_2d_embeddings_*.npy",
        "tsne_2d_embeddings_*.npy"
    ]
    
    import glob
    removed_count = 0
    
    for pattern in cache_patterns:
        files = glob.glob(pattern)
        for file in files:
            try:
                os.remove(file)
                print(f"🗑️  Removed: {file}")
                removed_count += 1
            except OSError as e:
                print(f"❌ Could not remove {file}: {e}")
    
    if removed_count == 0:
        print("✅ No cache files found to remove")
    else:
        print(f"✅ Removed {removed_count} cache files")

def verify_data_integrity():
    """Verify the filtered dataset is ready for processing."""
    print("\n✅ Verifying data integrity...")
    print("=" * 50)
    
    con = sqlite3.connect("../../../data/arxiv_papers.db")
    
    # Check for papers without IDs
    result = con.execute(f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE paper_id IS NULL OR paper_id = ''").fetchone()
    null_ids = result[0] if result else 0
    if null_ids > 0:
        print(f"❌ Found {null_ids} papers with missing IDs")
    else:
        print("✅ All papers have valid IDs")
    
    # Check citation integrity
    result = con.execute(f"""
        SELECT COUNT(*) FROM filtered_citations fc 
        WHERE fc.src NOT IN (SELECT paper_id FROM {TABLE_NAME})
           OR fc.dst NOT IN (SELECT paper_id FROM {TABLE_NAME})
    """).fetchone()
    orphan_citations = result[0] if result else 0
    if orphan_citations > 0:
        print(f"⚠️  Found {orphan_citations} citations referencing papers not in filtered set")
    else:
        print("✅ All citations reference valid papers")
    
    # Check for isolated nodes
    result = con.execute(f"""
        SELECT COUNT(*) FROM {TABLE_NAME} fp
        WHERE fp.paper_id NOT IN (
            SELECT src FROM filtered_citations 
            UNION 
            SELECT dst FROM filtered_citations
        )
    """).fetchone()
    isolated_nodes = result[0] if result else 0
    print(f"📊 Isolated nodes (no citations): {isolated_nodes:,}")
    
    con.close()

def create_indices():
    """Create database indices for faster processing."""
    print("\n⚡ Creating database indices...")
    print("=" * 50)
    
    con = sqlite3.connect("../../../data/arxiv_papers.db")
    
    indices = [
        ("idx_filtered_papers_id", f"{TABLE_NAME}", "paper_id"),
        ("idx_filtered_citations_src", "filtered_citations", "src"),
        ("idx_filtered_citations_dst", "filtered_citations", "dst"),
        ("idx_filtered_papers_cluster", f"{TABLE_NAME}", "cluster_id")
    ]
    
    for idx_name, table, column in indices:
        try:
            con.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({column})")
            print(f"✅ Created index: {idx_name}")
        except sqlite3.OperationalError as e:
            print(f"⚠️  Index {idx_name}: {e}")
    
    con.commit()
    con.close()

def main():
    """Main preparation workflow."""
    print("🚀 Database Preparation for Full Clustering Pipeline")
    print("=" * 60)
    
    # Step 1: Analyze current state
    analyze_database()
    
    # Step 2: Prepare table structure
    prepare_filtered_papers_table()
    
    # Step 3: Clean partial results
    clean_partial_results()
    
    # Step 4: Clean cache files
    clean_cache_files()
    
    # Step 5: Verify data integrity
    verify_data_integrity()
    
    # Step 6: Create indices
    create_indices()
    
    print("\n🎉 Database preparation completed!")
    print("=" * 60)
    print("📋 Next steps:")
    print("   1. Run: python pipeline.py full")
    print("   2. Monitor progress with: python monitor_gpu.py")
    print("   3. Check results with: python -c 'from data_loader import *; analyze_results()'")

if __name__ == "__main__":
    main() 