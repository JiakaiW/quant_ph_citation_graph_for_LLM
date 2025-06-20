#!/usr/bin/env python3
"""
RAPIDS-accelerated full graph processing pipeline using cuGraph and cuML.
This script processes the entire citation network and saves results to the database.

The pipeline:
1. Loads the filtered citation graph from the database
2. Generates node2vec embeddings using cuGraph (GPU-accelerated)
3. Performs K-means clustering with automatic elbow detection using cuML
4. Projects to 2D using cuML UMAP
5. Saves all results back to the database

This should be dramatically faster than the previous implementation.
"""

import sqlite3
import pandas as pd
import numpy as np
import cudf
import cugraph
from cuml.cluster import KMeans
from sklearn.metrics import silhouette_score
from cuml.manifold import UMAP
from kneed import KneeLocator
from tqdm import tqdm
import time
import os

# --- Configuration ---
DB_PATH = "arxiv_papers.db"
EMBEDDING_DIM = 128
WINDOW_SIZE = 10
NUM_WALKS = 10
WALK_LENGTH = 80
P = 1.0  # Return parameter
Q = 1.0  # In-out parameter

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

def create_cugraph_graph(paper_ids, src_indices, dst_indices):
    """Create a cuGraph graph from the edge list."""
    print("Creating cuGraph graph...")
    
    # Create cuDF DataFrame for edges
    edges_gdf = cudf.DataFrame({
        "src": src_indices,
        "dst": dst_indices
    })
    
    # Create and populate the graph
    G = cugraph.Graph()
    G.from_cudf_edgelist(edges_gdf, source="src", destination="dst", renumber=True)
    
    print(f"Graph created with {G.number_of_vertices()} vertices and {G.number_of_edges()} edges")
    return G

def generate_node2vec_embeddings(G, embedding_dim, walk_length, num_walks, p, q):
    """Generate node2vec embeddings using cuGraph walks + Word2Vec training."""
    print(f"Running cuGraph node2vec walks with {num_walks} walks of length {walk_length}...")
    
    start_time = time.time()
    
    # Get all vertices as start points
    vertices = G.nodes()
    start_vertices = vertices.to_pandas().tolist()
    
    # Generate random walks using cuGraph
    walks_df = cugraph.node2vec_random_walks(
        G,
        start_vertices,
        max_depth=walk_length,
        p=p,
        q=q
    )
    
    # Convert walks to format suitable for Word2Vec training
    walks = []
    for _, row in walks_df.iterrows():
        walk = row['path'].to_pandas().tolist()
        # Filter out -1 (padding values)
        walk = [node for node in walk if node != -1]
        if len(walk) > 1:  # Only keep walks with at least 2 nodes
            walks.append(walk)
    
    print(f"Generated {len(walks)} walks")
    
    # Train Word2Vec embeddings from walks
    print(f"Training Word2Vec embeddings with dimension {embedding_dim}...")
    embeddings, vertex_ids = train_word2vec_from_walks(walks, embedding_dim, WINDOW_SIZE)
    
    elapsed_time = time.time() - start_time
    print(f"Node2vec + Word2Vec completed in {elapsed_time:.2f} seconds")
    print(f"Generated embeddings shape: {embeddings.shape}")
    
    return embeddings, vertex_ids

def train_word2vec_from_walks(walks, embedding_dim, window_size):
    """Train Word2Vec model from walks using gensim."""
    from gensim.models import Word2Vec
    
    # Convert walks to strings (gensim expects strings)
    walks_str = [[str(node) for node in walk] for walk in walks]
    
    # Train Word2Vec model
    model = Word2Vec(
        walks_str,
        vector_size=embedding_dim,
        window=window_size,
        min_count=1,
        workers=4,
        sg=1,  # Skip-gram
        epochs=5
    )
    
    # Extract embeddings
    unique_nodes = sorted(model.wv.key_to_index.keys())
    embeddings = []
    
    for node in unique_nodes:
        embeddings.append(model.wv[node])
    
    embeddings = np.array(embeddings)
    vertex_ids = [int(node) for node in unique_nodes]
    
    return embeddings, vertex_ids

def find_optimal_k_elbow(embeddings, max_k=100, step_size=5):
    """Find optimal k using elbow method with two-stage search using cuML."""
    print("Finding optimal number of clusters using elbow method...")
    
    # Stage 1: Coarse search
    k_values_coarse = list(range(10, max_k + 1, step_size))
    inertias_coarse = []
    
    print(f"Stage 1: Coarse search with k values: {k_values_coarse}")
    for k in tqdm(k_values_coarse, desc="Coarse search"):
        kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
        kmeans.fit(embeddings)
        inertias_coarse.append(kmeans.inertia_)
    
    # Find elbow in coarse search
    kneedle = KneeLocator(k_values_coarse, inertias_coarse, curve='convex', direction='decreasing')
    if kneedle.elbow is None:
        print("No elbow found in coarse search, using k=50")
        optimal_k = 50
    else:
        optimal_k_coarse = k_values_coarse[kneedle.elbow]
        print(f"Coarse elbow found at k={optimal_k_coarse}")
        
        # Stage 2: Fine search around the elbow
        fine_start = max(10, optimal_k_coarse - step_size)
        fine_end = min(max_k, optimal_k_coarse + step_size)
        k_values_fine = list(range(fine_start, fine_end + 1))
        
        inertias_fine = []
        print(f"Stage 2: Fine search with k values: {k_values_fine}")
        for k in tqdm(k_values_fine, desc="Fine search"):
            kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
            kmeans.fit(embeddings)
            inertias_fine.append(kmeans.inertia_)
        
        # Find final elbow
        kneedle_fine = KneeLocator(k_values_fine, inertias_fine, curve='convex', direction='decreasing')
        if kneedle_fine.elbow is None:
            optimal_k = optimal_k_coarse
        else:
            optimal_k = k_values_fine[kneedle_fine.elbow]
    
    print(f"Optimal k determined: {optimal_k}")
    return optimal_k

def perform_clustering(embeddings, optimal_k):
    """Perform K-means clustering with the optimal k using cuML."""
    print(f"Performing K-means clustering with k={optimal_k}...")
    
    kmeans = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
    cluster_labels = kmeans.fit_predict(embeddings)
    
    # Calculate silhouette score
    if optimal_k > 1:
        silhouette_avg = silhouette_score(embeddings, cluster_labels)
        print(f"Silhouette score: {silhouette_avg:.4f}")
    
    return cluster_labels

def project_to_2d(embeddings):
    """Project embeddings to 2D using cuML UMAP."""
    print("Projecting embeddings to 2D using cuML UMAP...")
    
    reducer = UMAP(n_components=2, random_state=42, n_neighbors=15, min_dist=0.1)
    embeddings_2d = reducer.fit_transform(embeddings)
    
    return embeddings_2d

def save_results_to_db(paper_ids, embeddings_2d, cluster_labels, vertex_ids):
    """Save results back to the database."""
    print("Saving results to database...")
    
    con = sqlite3.connect(DB_PATH)
    
    # Add new columns if they don't exist
    con.execute("ALTER TABLE filtered_papers ADD COLUMN IF NOT EXISTS embedding_x REAL")
    con.execute("ALTER TABLE filtered_papers ADD COLUMN IF NOT EXISTS embedding_y REAL")
    con.execute("ALTER TABLE filtered_papers ADD COLUMN IF NOT EXISTS cluster_id INTEGER")
    
    # Create mapping from vertex IDs to embeddings
    vertex_to_emb_idx = {vid: idx for idx, vid in enumerate(vertex_ids)}
    
    # Update the filtered_papers table
    for i, paper_id in enumerate(paper_ids):
        if paper_id in vertex_to_emb_idx:
            emb_idx = vertex_to_emb_idx[paper_id]
            con.execute("""
                UPDATE filtered_papers 
                SET embedding_x = ?, embedding_y = ?, cluster_id = ?
                WHERE paper_id = ?
            """, (float(embeddings_2d[emb_idx, 0]), float(embeddings_2d[emb_idx, 1]), int(cluster_labels[emb_idx]), paper_id))
        else:
            # If paper not in embeddings, set to NULL
            con.execute("""
                UPDATE filtered_papers 
                SET embedding_x = NULL, embedding_y = NULL, cluster_id = NULL
                WHERE paper_id = ?
            """, (paper_id,))
    
    con.commit()
    con.close()
    
    # Count how many papers got embeddings
    papers_with_embeddings = sum(1 for pid in paper_ids if pid in vertex_to_emb_idx)
    print(f"Saved results for {papers_with_embeddings} papers (out of {len(paper_ids)} total)")

def main():
    """Main execution function."""
    start_time = time.time()
    
    print("🚀 Starting RAPIDS-accelerated full graph processing pipeline...")
    print(f"Database: {DB_PATH}")
    
    # Check if database exists
    if not os.path.exists(DB_PATH):
        print(f"❌ Database {DB_PATH} not found!")
        return
    
    try:
        # Step 1: Load graph
        paper_ids, paper_to_idx, src_indices, dst_indices = load_graph_from_db()
        
        # Step 2: Create cuGraph graph
        G = create_cugraph_graph(paper_ids, src_indices, dst_indices)
        
        # Step 3: Generate node2vec embeddings
        embeddings, vertex_ids = generate_node2vec_embeddings(
            G, EMBEDDING_DIM, WALK_LENGTH, NUM_WALKS, P, Q
        )
        
        # Step 4: Find optimal k
        optimal_k = find_optimal_k_elbow(embeddings)
        
        # Step 5: Perform clustering
        cluster_labels = perform_clustering(embeddings, optimal_k)
        
        # Step 6: Project to 2D
        embeddings_2d = project_to_2d(embeddings)
        
        # Step 7: Save results
        save_results_to_db(paper_ids, embeddings_2d, cluster_labels, vertex_ids)
        
        total_time = time.time() - start_time
        print(f"\n✅ Pipeline completed successfully!")
        print(f"📊 Results:")
        print(f"   - Papers processed: {len(paper_ids)}")
        print(f"   - Papers with embeddings: {len(vertex_ids)}")
        print(f"   - Optimal clusters: {optimal_k}")
        print(f"   - Embedding dimension: {EMBEDDING_DIM}")
        print(f"   - Total time: {total_time:.2f} seconds")
        print(f"\n🎯 You can now run 'export_for_sigma.py' to generate the visualization data.")
        
    except Exception as e:
        print(f"❌ Error during processing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main() 