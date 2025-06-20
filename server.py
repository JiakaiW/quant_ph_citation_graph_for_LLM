#!/usr/bin/env python3
"""
Backend server for the citation network visualization.

This Flask application serves the frontend and provides API endpoints
to fetch graph data from the SQLite database.
"""

from flask import Flask, jsonify, render_template, request
import sqlite3
import pandas as pd
import numpy as np
from colorspacious import cspace_converter

# --- Configuration ---
DB_PATH = "arxiv_papers.db"

app = Flask(__name__)


def generate_palette(n_colors):
    """Generate a palette of visually distinct colors."""
    colors = []
    if n_colors == 0: return colors
    for h in np.linspace(0, 360, n_colors, endpoint=False):
        jch_color = np.array([50, 50, h])
        rgb_color = np.clip(cspace_converter("JCh", "sRGB1")(jch_color), 0, 1)
        hex_color = "#{:02x}{:02x}{:02x}".format(*(int(c * 255) for c in rgb_color))
        colors.append(hex_color)
    return colors


def get_db_connection():
    """Get a new database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')


@app.route('/api/graph-data')
def get_graph_data():
    """
    API endpoint to fetch graph data.
    Supports filtering by the number of recent papers.
    """
    print("API: Received request for graph data.")
    
    # Get query parameters
    limit = request.args.get('limit', default=2000, type=int)

    conn = get_db_connection()
    
    # 1. Fetch the most recent 'limit' papers with cluster and embedding info
    print(f"Fetching {limit} most recent papers from database...")
    nodes_query = f"""
        SELECT paper_id, title, embedding_x, embedding_y, cluster_id, year
        FROM papers
        WHERE cluster_id IS NOT NULL AND embedding_x IS NOT NULL AND year IS NOT NULL
        ORDER BY year DESC, paper_id DESC
        LIMIT {limit};
    """
    papers_df = pd.read_sql_query(nodes_query, conn)
    
    if len(papers_df) == 0:
        conn.close()
        return jsonify({"error": "No processed papers found in the database."}), 404
        
    print(f"Loaded {len(papers_df)} papers.")
    node_set = set(papers_df['paper_id'])

    # 2. Fetch all edges for the selected nodes and calculate degrees
    print("Fetching edges and calculating degrees...")
    
    # We must query all edges and then filter, which is less efficient but necessary
    # for SQLite to get the degree of the full graph. A better DB would optimize this.
    all_edges_df = pd.read_sql_query("SELECT src_paper_id, dst_paper_id FROM citations", conn)
    all_nodes_in_edges = pd.concat([all_edges_df['src_paper_id'], all_edges_df['dst_paper_id']])
    degrees = all_nodes_in_edges.value_counts().to_dict()
    
    conn.close()

    # 3. Generate color palette
    unique_clusters = sorted(papers_df['cluster_id'].unique())
    num_clusters = len(unique_clusters)
    print(f"Generating color palette for {num_clusters} clusters...")
    palette = generate_palette(num_clusters)
    comm_colors = {cluster_id: palette[i] for i, cluster_id in enumerate(unique_clusters)}

    # 4. Format nodes for JSON
    print("Formatting nodes...")
    nodes = []
    for _, row in papers_df.iterrows():
        node_id = row['paper_id']
        cluster_id = int(row['cluster_id'])
        nodes.append({
            "key": node_id,
            "attributes": {
                "label": row['title'] or node_id,
                "x": float(row['embedding_x']),
                "y": float(row['embedding_y']),
                "size": max(2, 1.2 + np.log1p(degrees.get(node_id, 0))),
                "color": comm_colors.get(cluster_id, "#cccccc"),
                "community": cluster_id,
                "degree": int(degrees.get(node_id, 0)),
            }
        })
        
    # 5. Format edges for JSON
    print("Formatting edges...")
    filtered_edges_df = all_edges_df[
        all_edges_df['src_paper_id'].isin(node_set) & all_edges_df['dst_paper_id'].isin(node_set)
    ]
    edges = [
        {"source": row['src_paper_id'], "target": row['dst_paper_id']}
        for _, row in filtered_edges_df.iterrows()
    ]
        
    print(f"Returning {len(nodes)} nodes and {len(edges)} edges.")
    return jsonify({"nodes": nodes, "edges": edges})


if __name__ == '__main__':
    app.run(debug=True, port=8080) 