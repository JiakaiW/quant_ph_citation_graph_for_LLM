#!/usr/bin/env python3
"""
Generate tree_edges and extra_edges tables using MFAS analysis.

This script splits the citation graph into:
1. tree_edges: 86.84% of edges forming DAG backbone (keeps connectivity)
2. extra_edges: 13.16% of edges for progressive enrichment

Based on: src/acyclicity/mfas_analysis.py results
"""

import sqlite3
import pandas as pd
import networkx as nx
import numpy as np
from collections import defaultdict
import time
import sys
import os

# Add acyclicity directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'acyclicity'))

DB_PATH = "../../../data/arxiv_papers.db"
TABLE_NAME = "physics_clustering"

def get_db_connection():
    """Get database connection with optimizations."""
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL") 
    conn.execute("PRAGMA temp_store = memory")
    conn.execute("PRAGMA mmap_size = 268435456")  # 256MB
    return conn

def load_citation_graph():
    """Load the full citation graph."""
    print("🔄 Loading citation graph from database...")
    conn = get_db_connection()
    
    try:
        # Load all papers with coordinates
        papers_query = f"""
            SELECT paper_id, embedding_x, embedding_y, cluster_id, degree, title
            FROM {TABLE_NAME} 
            WHERE embedding_x IS NOT NULL AND embedding_y IS NOT NULL
        """
        papers_df = pd.read_sql_query(papers_query, conn)
        print(f"📄 Loaded {len(papers_df)} papers with coordinates")
        
        # Load all citation edges  
        citations_query = """
            SELECT src, dst FROM filtered_citations
            WHERE src IN (SELECT paper_id FROM physics_clustering WHERE embedding_x IS NOT NULL)
            AND dst IN (SELECT paper_id FROM physics_clustering WHERE embedding_x IS NOT NULL)
        """
        citations_df = pd.read_sql_query(citations_query, conn)
        print(f"🔗 Loaded {len(citations_df)} citation edges")
        
        # Create NetworkX graph
        G = nx.DiGraph()
        
        # Add nodes
        for _, paper in papers_df.iterrows():
            G.add_node(paper['paper_id'], **paper.to_dict())
        
        # Add edges  
        for _, citation in citations_df.iterrows():
            if G.has_node(citation['src']) and G.has_node(citation['dst']):
                G.add_edge(citation['src'], citation['dst'])
        
        print(f"📊 Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        return G, papers_df, citations_df
        
    finally:
        conn.close()

def find_largest_scc(G):
    """Find the largest strongly connected component."""
    print("🔍 Finding strongly connected components...")
    sccs = list(nx.strongly_connected_components(G))
    sccs_by_size = sorted(sccs, key=len, reverse=True)
    
    print(f"📈 Found {len(sccs)} SCCs")
    print(f"🏆 Largest SCC: {len(sccs_by_size[0])} nodes")
    
    # Show SCC size distribution
    scc_sizes = [len(scc) for scc in sccs]
    size_counts = defaultdict(int)
    for size in scc_sizes:
        size_counts[size] += 1
    
    print("\n📊 SCC Size Distribution:")
    for size in sorted(size_counts.keys(), reverse=True)[:10]:
        print(f"   Size {size}: {size_counts[size]} SCCs")
    
    return sccs_by_size[0]  # Return largest SCC

def compute_mfas_for_scc(G, scc_nodes):
    """Compute Minimum Feedback Arc Set for the largest SCC."""
    print(f"\n🎯 Computing MFAS for SCC with {len(scc_nodes)} nodes...")
    
    # Extract subgraph
    scc_subgraph = G.subgraph(scc_nodes).copy()
    print(f"   SCC edges: {scc_subgraph.number_of_edges()}")
    
    # Method 1: NetworkX approximation (fast)
    start_time = time.time()
    try:
        feedback_edges = nx.minimum_edge_cut(scc_subgraph)
        mfas_edges_nx = list(feedback_edges) if feedback_edges else []
    except:
        # Fallback: simple cycle-breaking heuristic
        mfas_edges_nx = simple_cycle_breaking_heuristic(scc_subgraph)
    
    mfas_time = time.time() - start_time
    print(f"   ⚡ NetworkX method: {len(mfas_edges_nx)} edges removed in {mfas_time:.3f}s")
    
    # Verify the result creates a DAG
    test_graph = scc_subgraph.copy()
    test_graph.remove_edges_from(mfas_edges_nx)
    is_dag = nx.is_directed_acyclic_graph(test_graph)
    print(f"   ✅ Result is DAG: {is_dag}")
    
    if not is_dag:
        print("   ⚠️  Fallback: using simple heuristic...")
        mfas_edges_nx = simple_cycle_breaking_heuristic(scc_subgraph)
        test_graph = scc_subgraph.copy()
        test_graph.remove_edges_from(mfas_edges_nx)
        is_dag = nx.is_directed_acyclic_graph(test_graph)
        print(f"   ✅ Heuristic result is DAG: {is_dag}")
    
    return mfas_edges_nx

def simple_cycle_breaking_heuristic(G):
    """Simple heuristic to break cycles by removing high-degree edges."""
    feedback_edges = []
    graph_copy = G.copy()
    
    while not nx.is_directed_acyclic_graph(graph_copy):
        # Find cycles
        try:
            cycle = nx.find_cycle(graph_copy, orientation='original')
            # Remove the edge with highest degree sum
            max_degree_sum = 0
            edge_to_remove = None
            
            for edge in cycle:
                src, dst = edge[0], edge[1]
                degree_sum = graph_copy.in_degree(src) + graph_copy.out_degree(src) + \
                           graph_copy.in_degree(dst) + graph_copy.out_degree(dst)
                if degree_sum > max_degree_sum:
                    max_degree_sum = degree_sum
                    edge_to_remove = (src, dst)
            
            if edge_to_remove:
                graph_copy.remove_edge(*edge_to_remove)
                feedback_edges.append(edge_to_remove)
                
        except nx.NetworkXNoCycle:
            break
    
    return feedback_edges

def create_tree_and_extra_edges(G, mfas_edges):
    """Split all edges into tree_edges and extra_edges."""
    print(f"\n🌳 Creating tree and extra edge tables...")
    
    all_edges = list(G.edges())
    mfas_edge_set = set(mfas_edges)
    
    # Tree edges: all edges EXCEPT the MFAS (feedback) edges
    tree_edges = [(src, dst) for src, dst in all_edges if (src, dst) not in mfas_edge_set]
    
    # Extra edges: the MFAS (feedback) edges
    extra_edges = list(mfas_edges)
    
    print(f"   🌲 Tree edges: {len(tree_edges)} ({len(tree_edges)/len(all_edges)*100:.2f}%)")
    print(f"   ➕ Extra edges: {len(extra_edges)} ({len(extra_edges)/len(all_edges)*100:.2f}%)")
    
    # Verify tree edges form a DAG
    tree_graph = nx.DiGraph()
    tree_graph.add_edges_from(tree_edges)
    is_dag = nx.is_directed_acyclic_graph(tree_graph)
    print(f"   ✅ Tree edges form DAG: {is_dag}")
    
    return tree_edges, extra_edges

def save_edge_tables(tree_edges, extra_edges):
    """Save tree_edges and extra_edges tables to database."""
    print(f"\n💾 Saving edge tables to database...")
    conn = get_db_connection()
    
    try:
        cursor = conn.cursor()
        
        # Drop existing tables
        cursor.execute("DROP TABLE IF EXISTS tree_edges")
        cursor.execute("DROP TABLE IF EXISTS extra_edges")
        
        # Create tree_edges table
        cursor.execute("""
            CREATE TABLE tree_edges (
                src TEXT,
                dst TEXT,
                weight REAL DEFAULT 1.0,
                PRIMARY KEY (src, dst)
            )
        """)
        
        # Create extra_edges table  
        cursor.execute("""
            CREATE TABLE extra_edges (
                src TEXT,
                dst TEXT, 
                weight REAL DEFAULT 1.0,
                edge_type TEXT DEFAULT 'shortcut',
                PRIMARY KEY (src, dst)
            )
        """)
        
        # Insert tree edges
        print(f"   🌲 Inserting {len(tree_edges)} tree edges...")
        tree_data = [(src, dst, 1.0) for src, dst in tree_edges]
        cursor.executemany("INSERT INTO tree_edges (src, dst, weight) VALUES (?, ?, ?)", tree_data)
        
        # Insert extra edges
        print(f"   ➕ Inserting {len(extra_edges)} extra edges...")
        extra_data = [(src, dst, 1.0, 'feedback') for src, dst in extra_edges]
        cursor.executemany("INSERT INTO extra_edges (src, dst, weight, edge_type) VALUES (?, ?, ?, ?)", extra_data)
        
        # Create indexes
        print(f"   📇 Creating indexes...")
        cursor.execute("CREATE INDEX idx_tree_edges_src ON tree_edges(src)")
        cursor.execute("CREATE INDEX idx_tree_edges_dst ON tree_edges(dst)")
        cursor.execute("CREATE INDEX idx_extra_edges_src ON extra_edges(src)")
        cursor.execute("CREATE INDEX idx_extra_edges_dst ON extra_edges(dst)")
        
        conn.commit()
        print(f"   ✅ Tables saved successfully")
        
        # Verify counts
        cursor.execute("SELECT COUNT(*) FROM tree_edges")
        tree_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM extra_edges")
        extra_count = cursor.fetchone()[0]
        
        print(f"\n📊 Final Verification:")
        print(f"   🌲 Tree edges in DB: {tree_count:,}")
        print(f"   ➕ Extra edges in DB: {extra_count:,}")
        print(f"   📈 Total: {tree_count + extra_count:,}")
        
    finally:
        conn.close()

def compute_topological_levels():
    """Compute topological levels for overview loading."""
    print(f"\n📏 Computing topological levels...")
    conn = get_db_connection()
    
    try:
        # Load tree edges
        tree_df = pd.read_sql_query("SELECT src, dst FROM tree_edges", conn)
        
        # Create tree graph
        tree_graph = nx.DiGraph()
        tree_graph.add_edges_from(tree_df.values)
        
        # Find root nodes (no incoming edges)
        roots = [node for node in tree_graph.nodes() if tree_graph.in_degree(node) == 0]
        print(f"   🌱 Found {len(roots)} root nodes")
        
        # Compute levels using BFS from roots
        levels = {}
        queue = [(root, 0) for root in roots]
        
        while queue:
            node, level = queue.pop(0)
            if node not in levels or levels[node] > level:
                levels[node] = level
                # Add children with level + 1
                for child in tree_graph.successors(node):
                    queue.append((child, level + 1))
        
        # Update database
        cursor = conn.cursor()
        cursor.execute(f"ALTER TABLE {TABLE_NAME} ADD COLUMN topo_level INTEGER DEFAULT 0")
        
        level_updates = [(level, node_id) for node_id, level in levels.items()]
        cursor.executemany(f"UPDATE {TABLE_NAME} SET topo_level = ? WHERE paper_id = ?", level_updates)
        
        # Create index
        cursor.execute(f"CREATE INDEX idx_topo_level ON {TABLE_NAME}(topo_level)")
        
        conn.commit()
        
        # Show level distribution
        level_counts = defaultdict(int)
        for level in levels.values():
            level_counts[level] += 1
        
        print(f"   📊 Level Distribution:")
        for level in sorted(level_counts.keys())[:10]:
            print(f"      Level {level}: {level_counts[level]:,} papers")
        
        print(f"   ✅ Topological levels computed and saved")
        
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print(f"   ⚠️  Column topo_level already exists, skipping...")
        else:
            raise
    finally:
        conn.close()

def main():
    """Main execution function."""
    print("🌳 Tree-First Architecture: Edge Table Generation")
    print("=" * 60)
    
    start_time = time.time()
    
    # 1. Load citation graph
    G, papers_df, citations_df = load_citation_graph()
    
    # 2. Find largest SCC
    largest_scc = find_largest_scc(G)
    
    # 3. Compute MFAS for largest SCC only
    if len(largest_scc) > 1:
        mfas_edges = compute_mfas_for_scc(G, largest_scc)
    else:
        print("ℹ️  No non-trivial SCCs found, using empty MFAS")
        mfas_edges = []
    
    # 4. Create tree and extra edges for entire graph
    tree_edges, extra_edges = create_tree_and_extra_edges(G, mfas_edges)
    
    # 5. Save to database
    save_edge_tables(tree_edges, extra_edges)
    
    # 6. Compute topological levels
    compute_topological_levels()
    
    total_time = time.time() - start_time
    print(f"\n🎉 Edge table generation complete in {total_time:.2f} seconds!")
    print(f"✅ Ready for tree-first visualization!")

if __name__ == "__main__":
    main() 