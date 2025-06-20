#!/usr/bin/env python3
"""
This script constitutes the main data processing pipeline for the citation graph.

It performs the following steps:
1.  Connects to the SQLite database and adds columns to the 'papers' table
    to store embedding and clustering results if they don't already exist.
2.  Loads the full citation graph from the database.
3.  Generates high-dimensional node embeddings using PecanPy (node2vec).
4.  Performs a two-stage elbow method search to find the optimal number of
    clusters (k) for K-means.
5.  Runs K-means clustering with the optimal k on the high-dimensional embeddings.
6.  Projects the high-dimensional embeddings into 2D using UMAP for visualization.
7.  Updates the 'papers' table in the database with the cluster ID and the
    2D embedding coordinates for each paper.
"""
import pandas as pd
import networkx as nx
import numpy as np
import subprocess
import sqlite3
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from umap.umap_ import UMAP
from kneed import KneeLocator
from tqdm import tqdm

# --- Configuration ---
DB_PATH = "arxiv_papers.db"
EDGE_LIST_FILE = "full_graph.edg"
EMB_FILE = "full_graph.emb"

# PecanPy (node2vec) parameters
DIMENSIONS = 64
WALK_LENGTH = 40
NUM_WALKS = 10
WINDOW_SIZE = 5
EPOCHS = 3
P, Q = 1.0, 1.0
WORKERS = 8


def db_connect_and_setup(db_path):
    """
    Connects to the database and adds necessary columns if they don't exist.
    """
    print(f"Connecting to database at {db_path}...")
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    # Check for and add columns to the papers table
    required_cols = {
        "cluster_id": "INTEGER",
        "embedding_x": "REAL",
        "embedding_y": "REAL",
    }
    
    cur.execute("PRAGMA table_info(papers)")
    existing_cols = [row[1] for row in cur.fetchall()]
    
    for col, col_type in required_cols.items():
        if col not in existing_cols:
            print(f"Adding column '{col}' to 'papers' table...")
            cur.execute(f"ALTER TABLE papers ADD COLUMN {col} {col_type}")
        else:
            print(f"Column '{col}' already exists.")

    con.commit()
    print("Database setup complete.")
    return con


def load_graph_from_db(con):
    """
    Loads the full graph from the 'citations' table in the database.
    """
    print("Loading full citation graph from database...")
    edges_df = pd.read_sql_query("SELECT src_paper_id, dst_paper_id FROM citations", con)
    G = nx.from_pandas_edgelist(edges_df, "src_paper_id", "dst_paper_id", create_using=nx.Graph())
    
    # We only care about the largest connected component
    if not nx.is_connected(G):
        print("Graph is not connected. Taking the largest connected component.")
        largest_cc = max(nx.connected_components(G), key=len)
        G = G.subgraph(largest_cc).copy()

    print(f"Graph loaded with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges.")
    return G


def generate_embeddings(G, edge_list_file, emb_file):
    """
    Writes the graph edgelist to a file and runs PecanPy to generate embeddings.
    """
    print(f"Writing edgelist to {edge_list_file}...")
    with open(edge_list_file, "w") as f:
        for u, v in G.edges():
            f.write(f"{u}\t{v}\n")

    print("Running PecanPy to generate node2vec embeddings...")
    subprocess.run([
        "pecanpy",
        "--input", edge_list_file,
        "--output", emb_file,
        "--mode", "FirstOrderUnweighted",
        "--dimensions", str(DIMENSIONS),
        "--walk-length", str(WALK_LENGTH),
        "--num-walks", str(NUM_WALKS),
        "--window-size", str(WINDOW_SIZE),
        "--epochs", str(EPOCHS),
        "--p", str(P),
        "--q", str(Q),
        "--workers", str(WORKERS),
        "--delimiter", "\t",
        "--implicit_ids",
        "--verbose"
    ], check=True)
    
    print(f"Embeddings saved to {emb_file}")
    
    # Load embeddings from file
    print("Loading embeddings from file...")
    embeddings = {}
    with open(emb_file, "r") as f_emb:
        n_nodes, dim = map(int, f_emb.readline().split())
        for line in f_emb:
            parts = line.strip().split()
            node_id = parts[0]
            vec = np.array(parts[1:], dtype=float)
            embeddings[node_id] = vec
    
    return embeddings


def find_optimal_clusters(embeddings):
    """
    Performs a two-stage elbow search to find the optimal number of clusters.
    """
    print("Finding optimal number of clusters...")
    
    # Ensure all nodes in embeddings are in the graph for clustering
    node_list = list(embeddings.keys())
    vectors = np.array([embeddings[n] for n in node_list])
    
    scaler = StandardScaler()
    scaled_vectors = scaler.fit_transform(vectors)
    
    # --- Step 1: Coarse-grained search ---
    print("--- Step 1: Coarse search ---")
    inertias = []
    cluster_range_step = 10
    cluster_range = range(20, 201, cluster_range_step)

    for k in tqdm(cluster_range, desc="Coarse K-means search"):
        kmeans_search = KMeans(n_clusters=k, random_state=42, n_init=10, max_iter=200)
        kmeans_search.fit(scaled_vectors)
        inertias.append(kmeans_search.inertia_)

    coarse_kneedle = KneeLocator(list(cluster_range), inertias, S=1.0, curve="convex", direction="decreasing")
    coarse_k = coarse_kneedle.elbow
    
    if coarse_k is None:
        print("⚠️ Could not find coarse elbow. Defaulting to 100.")
        coarse_k = 100
    else:
        print(f"✅ Coarse elbow found at k = {coarse_k}. Now performing fine search...")

    # --- Step 2: Fine-grained search ---
    print("\n--- Step 2: Fine search ---")
    fine_inertias = []
    fine_cluster_range = range(max(10, coarse_k - cluster_range_step), coarse_k + cluster_range_step + 1)
    
    for k in tqdm(fine_cluster_range, desc="Fine K-means search"):
        kmeans_search = KMeans(n_clusters=k, random_state=42, n_init=10, max_iter=200)
        kmeans_search.fit(scaled_vectors)
        fine_inertias.append(kmeans_search.inertia_)
        
    final_kneedle = KneeLocator(list(fine_cluster_range), fine_inertias, S=1.0, curve="convex", direction="decreasing")
    optimal_k = final_kneedle.elbow
    
    if optimal_k is None:
        print(f"⚠️ Could not find fine elbow. Using coarse k = {coarse_k}.")
        optimal_k = coarse_k
    else:
        print(f"✅ Final optimal number of clusters found at k = {optimal_k}")
        
    # Plot for inspection
    final_kneedle.plot_knee()
    plt.xlabel("Number of clusters (k) [Fine Search]")
    plt.ylabel("Inertia")
    plt.title("Elbow Method For Optimal k (Full Graph)")
    plt.savefig("elbow_plot_full_graph.png")
    plt.close()
    print("Elbow plot saved to elbow_plot_full_graph.png")
    
    return optimal_k, scaled_vectors, node_list


def run_clustering_and_umap(optimal_k, scaled_vectors, node_list):
    """
    Runs final K-means and UMAP projection.
    """
    print(f"Running final K-means clustering for {optimal_k} clusters...")
    kmeans = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
    cluster_labels = kmeans.fit_predict(scaled_vectors)
    node_to_cluster = {node: label for node, label in zip(node_list, cluster_labels)}
    
    print("Projecting with UMAP into 2D...")
    embedding_2d = UMAP(
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
        n_jobs=1 # Avoids issues with multiprocessing in some environments
    ).fit_transform(scaled_vectors)
    
    node_to_pos = {node: embedding_2d[i] for i, node in enumerate(node_list)}
    
    return node_to_cluster, node_to_pos
    

def update_database(con, node_to_cluster, node_to_pos):
    """
    Updates the 'papers' table with the new cluster and embedding data.
    """
    print("Updating database with cluster IDs and 2D embeddings...")
    
    update_data = []
    for node, cluster_id in node_to_cluster.items():
        pos = node_to_pos.get(node)
        if pos is not None:
            update_data.append((int(cluster_id), float(pos[0]), float(pos[1]), node))
            
    cur = con.cursor()
    cur.executemany(
        """
        UPDATE papers
        SET cluster_id = ?, embedding_x = ?, embedding_y = ?
        WHERE paper_id = ?
        """,
        update_data
    )
    
    con.commit()
    print(f"✅ Successfully updated {len(update_data)} records in the database.")


def main():
    """Main execution function."""
    con = db_connect_and_setup(DB_PATH)
    G = load_graph_from_db(con)
    
    # Generate embeddings
    embeddings = generate_embeddings(G, EDGE_LIST_FILE, EMB_FILE)
    
    # Find optimal clusters
    optimal_k, scaled_vectors, node_list = find_optimal_clusters(embeddings)
    
    # Run final clustering and UMAP
    node_to_cluster, node_to_pos = run_clustering_and_umap(optimal_k, scaled_vectors, node_list)
    
    # Update database
    update_database(con, node_to_cluster, node_to_pos)
    
    con.close()
    print("\n🎉 Full graph processing complete!")


if __name__ == "__main__":
    main() 