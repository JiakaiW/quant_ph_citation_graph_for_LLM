#!/usr/bin/env python3
"""
Check the progress of the clustering pipeline and verify data in filtered_papers table.
"""

import sqlite3
import time

def check_database_progress():
    """Check the current state of the filtered_papers table."""
    print("🔍 Checking clustering progress in filtered_papers table...")
    print("=" * 60)
    
    con = sqlite3.connect("../../data/arxiv_papers.db")
    
    # Check total papers
    result = con.execute("SELECT COUNT(*) FROM filtered_papers").fetchone()
    total_papers = result[0] if result else 0
    print(f"📊 Total filtered papers: {total_papers:,}")
    
    # Check papers with clustering results
    result = con.execute("SELECT COUNT(*) FROM filtered_papers WHERE cluster_id IS NOT NULL").fetchone()
    clustered_papers = result[0] if result else 0
    print(f"📊 Papers with clustering results: {clustered_papers:,}")
    
    # Check papers with embeddings
    result = con.execute("SELECT COUNT(*) FROM filtered_papers WHERE embedding_x IS NOT NULL").fetchone()
    embedded_papers = result[0] if result else 0
    print(f"📊 Papers with 2D embeddings: {embedded_papers:,}")
    
    # Progress percentage
    if total_papers > 0:
        cluster_progress = (clustered_papers / total_papers) * 100
        embedding_progress = (embedded_papers / total_papers) * 100
        print(f"📈 Clustering progress: {cluster_progress:.1f}%")
        print(f"📈 Embedding progress: {embedding_progress:.1f}%")
    
    # Check cluster distribution if any exist
    if clustered_papers > 0:
        print(f"\n🎯 Cluster Analysis:")
        cluster_stats = con.execute("""
            SELECT cluster_id, COUNT(*) as count, cluster_size
            FROM filtered_papers 
            WHERE cluster_id IS NOT NULL 
            GROUP BY cluster_id 
            ORDER BY count DESC 
            LIMIT 10
        """).fetchall()
        
        print(f"📊 Top 10 clusters by size:")
        for cluster_id, count, cluster_size in cluster_stats:
            print(f"   Cluster {cluster_id}: {count:,} papers (size: {cluster_size})")
        
        # Total unique clusters
        result = con.execute("SELECT COUNT(DISTINCT cluster_id) FROM filtered_papers WHERE cluster_id IS NOT NULL").fetchone()
        unique_clusters = result[0] if result else 0
        print(f"📊 Total unique clusters: {unique_clusters}")
    
    # Check processing timestamp
    result = con.execute("SELECT processed_date FROM filtered_papers WHERE processed_date IS NOT NULL LIMIT 1").fetchone()
    if result:
        print(f"📅 Last processed: {result[0]}")
    
    con.close()

def check_frontend_readiness():
    """Check if the data is ready for frontend visualization."""
    print(f"\n🎯 Frontend Readiness Check:")
    print("=" * 60)
    
    con = sqlite3.connect("../../data/arxiv_papers.db")
    
    # Check required columns exist
    columns = con.execute("PRAGMA table_info(filtered_papers)").fetchall()
    required_columns = ['paper_id', 'title', 'embedding_x', 'embedding_y', 'cluster_id']
    existing_columns = [col[1] for col in columns]
    
    print("📋 Required columns for frontend:")
    for col in required_columns:
        status = "✅" if col in existing_columns else "❌"
        print(f"   {status} {col}")
    
    # Check data completeness for visualization
    result = con.execute("""
        SELECT COUNT(*) FROM filtered_papers 
        WHERE embedding_x IS NOT NULL 
        AND embedding_y IS NOT NULL 
        AND cluster_id IS NOT NULL
        AND title IS NOT NULL
    """).fetchone()
    
    ready_papers = result[0] if result else 0
    print(f"\n📊 Papers ready for visualization: {ready_papers:,}")
    
    if ready_papers > 0:
        # Sample some data for verification
        sample = con.execute("""
            SELECT paper_id, title, embedding_x, embedding_y, cluster_id, cluster_size
            FROM filtered_papers 
            WHERE embedding_x IS NOT NULL 
            LIMIT 3
        """).fetchall()
        
        print(f"\n📋 Sample visualization data:")
        for paper_id, title, x, y, cluster_id, cluster_size in sample:
            title_short = title[:50] + "..." if len(title) > 50 else title
            print(f"   📄 {paper_id[:8]}... | {title_short}")
            print(f"      Position: ({x:.2f}, {y:.2f}) | Cluster: {cluster_id} (size: {cluster_size})")
    
    con.close()

def monitor_progress(interval=30):
    """Monitor progress in real-time."""
    print(f"\n⏱️  Monitoring progress every {interval} seconds...")
    print("Press Ctrl+C to stop monitoring")
    print("=" * 60)
    
    try:
        while True:
            check_database_progress()
            print(f"\n⏳ Next check in {interval} seconds...\n")
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n🛑 Monitoring stopped")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "monitor":
        monitor_progress()
    else:
        check_database_progress()
        check_frontend_readiness()
        print(f"\n💡 Tip: Run 'python check_progress.py monitor' for real-time monitoring") 