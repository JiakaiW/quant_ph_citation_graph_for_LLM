#!/usr/bin/env python3
"""
Efficiently compute node degrees and store them in the filtered_papers table.
This script adds a 'degree' column and precomputes all node degrees for optimal performance.
"""

import sqlite3
import time
import pandas as pd
from collections import Counter

DB_PATH = "../../../data/arxiv_papers.db"

def add_degree_column():
    """Add degree column to filtered_papers table if it doesn't exist."""
    print("🔧 Adding degree column to filtered_papers table...")
    
    con = sqlite3.connect(DB_PATH)
    
    try:
        con.execute("ALTER TABLE filtered_papers ADD COLUMN degree INTEGER DEFAULT 0")
        print("✅ Added degree column")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower():
            print("⚠️  Degree column already exists")
        else:
            print(f"❌ Failed to add degree column: {e}")
            raise
    
    con.commit()
    con.close()

def compute_degrees_efficiently():
    """Compute node degrees using efficient SQL aggregation."""
    print("🔍 Computing node degrees efficiently...")
    start_time = time.time()
    
    con = sqlite3.connect(DB_PATH)
    
    # Enable WAL mode for better performance
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA temp_store=memory")
    con.execute("PRAGMA cache_size=10000")
    
    try:
        # First, reset all degrees to 0
        print("📝 Resetting all degrees to 0...")
        con.execute("UPDATE filtered_papers SET degree = 0")
        
        # Get total number of papers for progress tracking
        total_papers = con.execute("SELECT COUNT(*) FROM filtered_papers").fetchone()[0]
        print(f"📊 Total papers to process: {total_papers:,}")
        
        # Method 1: Direct SQL aggregation (most efficient)
        print("⚡ Computing degrees using SQL aggregation...")
        
        # Create a temporary table with all degrees
        con.execute("DROP TABLE IF EXISTS temp_degrees")
        con.execute("""
            CREATE TEMPORARY TABLE temp_degrees AS
            SELECT 
                papers.paper_id,
                COALESCE(out_degrees.out_degree, 0) + COALESCE(in_degrees.in_degree, 0) as total_degree
            FROM (
                SELECT paper_id FROM filtered_papers
            ) papers
            LEFT JOIN (
                SELECT src as paper_id, COUNT(*) as out_degree
                FROM filtered_citations
                GROUP BY src
            ) out_degrees ON papers.paper_id = out_degrees.paper_id
            LEFT JOIN (
                SELECT dst as paper_id, COUNT(*) as in_degree  
                FROM filtered_citations
                GROUP BY dst
            ) in_degrees ON papers.paper_id = in_degrees.paper_id
        """)
        
        # Update filtered_papers with computed degrees
        print("📝 Updating filtered_papers with computed degrees...")
        con.execute("""
            UPDATE filtered_papers 
            SET degree = (
                SELECT total_degree 
                FROM temp_degrees 
                WHERE temp_degrees.paper_id = filtered_papers.paper_id
            )
        """)
        
        # Verify the update
        updated_count = con.execute("SELECT COUNT(*) FROM filtered_papers WHERE degree > 0").fetchone()[0]
        max_degree = con.execute("SELECT MAX(degree) FROM filtered_papers").fetchone()[0]
        avg_degree = con.execute("SELECT AVG(degree) FROM filtered_papers").fetchone()[0]
        
        con.commit()
        
        elapsed = time.time() - start_time
        print(f"✅ Successfully computed degrees in {elapsed:.2f} seconds")
        print(f"📊 Papers with degree > 0: {updated_count:,}")
        print(f"📊 Maximum degree: {max_degree:,}")
        print(f"📊 Average degree: {avg_degree:.2f}")
        
        # Show degree distribution
        print("\n📊 Degree distribution:")
        degree_ranges = [
            (0, 0, "Isolated (degree 0)"),
            (1, 5, "Low connectivity (1-5)"),
            (6, 20, "Medium connectivity (6-20)"),
            (21, 50, "High connectivity (21-50)"),
            (51, 100, "Very high connectivity (51-100)"),
            (101, float('inf'), "Extremely high connectivity (100+)")
        ]
        
        for min_deg, max_deg, label in degree_ranges:
            if max_deg == float('inf'):
                count = con.execute("SELECT COUNT(*) FROM filtered_papers WHERE degree >= ?", (min_deg,)).fetchone()[0]
            else:
                count = con.execute("SELECT COUNT(*) FROM filtered_papers WHERE degree >= ? AND degree <= ?", (min_deg, max_deg)).fetchone()[0]
            percentage = (count / total_papers) * 100 if total_papers > 0 else 0
            print(f"   {label}: {count:,} papers ({percentage:.1f}%)")
        
    except Exception as e:
        print(f"❌ Error computing degrees: {e}")
        con.rollback()
        raise
    finally:
        con.close()

def create_degree_index():
    """Create an index on the degree column for fast filtering."""
    print("⚡ Creating index on degree column...")
    
    con = sqlite3.connect(DB_PATH)
    
    try:
        con.execute("CREATE INDEX IF NOT EXISTS idx_filtered_papers_degree ON filtered_papers(degree)")
        print("✅ Created degree index")
    except sqlite3.OperationalError as e:
        print(f"⚠️  Index creation: {e}")
    
    con.commit()
    con.close()

def verify_degrees():
    """Verify the computed degrees by sampling a few papers."""
    print("🔍 Verifying computed degrees...")
    
    con = sqlite3.connect(DB_PATH)
    
    # Sample a few papers and manually verify their degrees
    sample_papers = con.execute("""
        SELECT paper_id, degree 
        FROM filtered_papers 
        WHERE degree > 0 
        ORDER BY degree DESC 
        LIMIT 5
    """).fetchall()
    
    print("📊 Verification sample (top 5 papers by degree):")
    for paper_id, stored_degree in sample_papers:
        # Manually compute degree
        out_degree = con.execute("SELECT COUNT(*) FROM filtered_citations WHERE src = ?", (paper_id,)).fetchone()[0]
        in_degree = con.execute("SELECT COUNT(*) FROM filtered_citations WHERE dst = ?", (paper_id,)).fetchone()[0]
        computed_degree = out_degree + in_degree
        
        status = "✅" if stored_degree == computed_degree else "❌"
        print(f"   {status} Paper {paper_id}: stored={stored_degree}, computed={computed_degree} (out={out_degree}, in={in_degree})")
    
    con.close()

def analyze_performance_impact():
    """Analyze the performance improvement from precomputed degrees."""
    print("📈 Analyzing performance impact...")
    
    con = sqlite3.connect(DB_PATH)
    
    # Test old method (computing degrees on-the-fly)
    print("⏱️  Testing old method (on-the-fly computation)...")
    start_time = time.time()
    
    old_query = """
        SELECT fp.paper_id, 
               (SELECT COUNT(*) FROM filtered_citations WHERE src = fp.paper_id) +
               (SELECT COUNT(*) FROM filtered_citations WHERE dst = fp.paper_id) as degree
        FROM filtered_papers fp
        WHERE fp.cluster_id IS NOT NULL
        ORDER BY degree DESC
        LIMIT 1000
    """
    
    old_results = con.execute(old_query).fetchall()
    old_time = time.time() - start_time
    
    # Test new method (precomputed degrees)
    print("⏱️  Testing new method (precomputed degrees)...")
    start_time = time.time()
    
    new_query = """
        SELECT paper_id, degree
        FROM filtered_papers
        WHERE cluster_id IS NOT NULL
        ORDER BY degree DESC
        LIMIT 1000
    """
    
    new_results = con.execute(new_query).fetchall()
    new_time = time.time() - start_time
    
    speedup = old_time / new_time if new_time > 0 else float('inf')
    
    print(f"📊 Performance comparison:")
    print(f"   Old method: {old_time:.3f} seconds")
    print(f"   New method: {new_time:.3f} seconds")
    print(f"   Speedup: {speedup:.1f}x faster")
    
    con.close()

def main():
    """Main function to compute and store node degrees."""
    print("🚀 Computing Node Degrees for Filtered Papers")
    print("=" * 50)
    
    try:
        # Step 1: Add degree column
        add_degree_column()
        
        # Step 2: Compute degrees efficiently
        compute_degrees_efficiently()
        
        # Step 3: Create index for fast filtering
        create_degree_index()
        
        # Step 4: Verify results
        verify_degrees()
        
        # Step 5: Analyze performance impact
        analyze_performance_impact()
        
        print("\n🎉 Node degree computation completed successfully!")
        print("📝 The 'degree' column has been added to filtered_papers table")
        print("⚡ API endpoints can now use 'WHERE degree >= ?' for efficient filtering")
        
    except Exception as e:
        print(f"\n❌ Error during degree computation: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main()) 