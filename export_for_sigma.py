#!/usr/bin/env python3
"""
This script exports the pre-computed graph data from the SQLite database
into the JSON format required by Sigma.js for visualization.

It performs the following steps:
1.  Connects to the database.
2.  Fetches all papers that have an assigned cluster ID and their 2D embeddings.
3.  Calculates the degree for each node based on the 'citations' table.
4.  Fetches all citation edges.
5.  Generates a distinct color palette for the clusters.
6.  Formats the nodes and edges into a JSON structure and saves it.
"""

import pandas as pd
import numpy as np
import json
import sqlite3
from colorspacious import cspace_converter

# --- Configuration ---
DB_PATH = "arxiv_papers.db"
OUT_FILE = "graph_data.json"


def generate_palette(n_colors):
    """Generate a palette of visually distinct colors."""
    colors = []
    if n_colors == 0:
        return colors
    for h in np.linspace(0, 360, n_colors, endpoint=False):
        jch_color = np.array([50, 50, h])
        rgb_color = np.clip(cspace_converter("JCh", "sRGB1")(jch_color), 0, 1)
        hex_color = "#{:02x}{:02x}{:02x}".format(*(int(c * 255) for c in rgb_color))
        colors.append(hex_color)
    return colors


def main():
    """Main execution function."""
    print(f"Connecting to database at {DB_PATH}...")
    con = sqlite3.connect(DB_PATH)
    
    # 1. Fetch papers with cluster and embedding info
    print("Fetching pre-computed paper data from database...")
    nodes_query = """
        SELECT paper_id, title, embedding_x, embedding_y, cluster_id
        FROM filtered_papers
        WHERE cluster_id IS NOT NULL 
          AND embedding_x IS NOT NULL 
          AND embedding_y IS NOT NULL;
    """
    papers_df = pd.read_sql_query(nodes_query, con)
    print(f"Loaded {len(papers_df)} papers with embeddings.")

    if len(papers_df) == 0:
        print("No processed papers found in the database.")
        print("Please run 'step6_process_full_graph_gpu.py' first.")
        con.close()
        return

    # 2. Fetch all edges and calculate degrees
    print("Fetching edges and calculating node degrees...")
    edges_df = pd.read_sql_query("SELECT src, dst FROM filtered_citations", con)
    
    all_nodes_in_edges = pd.concat([edges_df['src'], edges_df['dst']])
    degrees = all_nodes_in_edges.value_counts().to_dict()

    # 3. Generate color palette
    unique_clusters = sorted(papers_df['cluster_id'].unique())
    num_clusters = len(unique_clusters)
    print(f"Generating color palette for {num_clusters} clusters...")
    palette = generate_palette(num_clusters)
    comm_colors = {cluster_id: palette[i] for i, cluster_id in enumerate(unique_clusters)}

    # 4. Format nodes for JSON
    print("Formatting nodes for Sigma.js JSON...")
    nodes = []
    for _, row in papers_df.iterrows():
        node_id = row['paper_id']
        deg = degrees.get(node_id, 0)
        cluster_id = int(row['cluster_id'])
        
        nodes.append({
            "key": node_id,
            "attributes": {
                "label": row['title'] or node_id,
                "x": float(row['embedding_x']),
                "y": float(row['embedding_y']),
                "size": max(2, 1.2 + np.log1p(deg)),
                "color": comm_colors.get(cluster_id, "#cccccc"),
                "community": cluster_id,
                "degree": int(deg),
            }
        })
        
    # 5. Format edges for JSON
    print("Formatting edges for Sigma.js JSON...")
    edges = []
    node_set = set(papers_df['paper_id'])
    filtered_edges_df = edges_df[
        edges_df['src'].isin(node_set) & edges_df['dst'].isin(node_set)
    ]
    
    for _, row in filtered_edges_df.iterrows():
        edges.append({
            "source": row['src'],
            "target": row['dst'],
            "attributes": {"type": "line", "size": 0.4}
        })
        
    # 6. Export JSON
    print(f"Exporting {len(nodes)} nodes and {len(edges)} edges to {OUT_FILE}...")
    with open(OUT_FILE, "w") as f:
        json.dump({"nodes": nodes, "edges": edges}, f, indent=2)

    con.close()
    print(f"\n✅ Export complete. You can now open index.html.")


if __name__ == "__main__":
    main()
