#!/usr/bin/env python3
"""
Fast CPU-based graph processing pipeline using PecanPy SparseOTF.
This script processes the entire citation network and saves results to the database.

The pipeline:
1. Loads the filtered citation graph from the database
2. Generates node2vec embeddings using PecanPy SparseOTF (fast CPU implementation)
3. Performs K-means clustering with a reasonable default k (skips elbow search)
4. Projects to 2D using UMAP
5. Saves all results back to the database

This should be fast and reliable without CUDA context issues.
"""

import sqlite3
import pandas as pd
import numpy as np
from pecanpy import pecanpy as p2v
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
import umap
import time
import os

# GPU K-means (cuML); fall back to sklearn if GPU not available
try:
    from cuml.cluster import KMeans as cuKMeans
    import cupy as cp
    GPU_KMEANS = True
    print("✅ cuML found – GPU K-means enabled")
except Exception as _:
    GPU_KMEANS = False
    print("⚠️  cuML not available – falling back to CPU K-means")

# --- Configuration ---
DB_PATH = "arxiv_papers.db"
EMBEDDING_DIM = 128
WINDOW_SIZE = 10
NUM_WALKS = 10
WALK_LENGTH = 80
P = 1.0  # Return parameter
Q = 1.0  # In-out parameter
DEFAULT_K = 72  # Reasonable default, skip elbow search

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

def generate_node2vec_embeddings(paper_ids, src_indices, dst_indices, embedding_dim, walk_length, num_walks, p, q):
    """Generate node2vec embeddings using PecanPy SparseOTF."""
    print(f"Running PecanPy SparseOTF with {num_walks} walks of length {walk_length}...")
    
    # Create cache filename based on parameters
    cache_file = f"embeddings_dim={embedding_dim}_walks={num_walks}_length={walk_length}_p={p}_q={q}_papers={len(paper_ids)}.npy"
    
    # Check if cached embeddings exist
    if os.path.exists(cache_file):
        print(f"🔎 Found cached embeddings '{cache_file}' – loading...")
        embeddings = np.load(cache_file)
        print(f"✅ Loaded cached embeddings with shape: {embeddings.shape}")
        return embeddings
    
    print("   No cache found – training new embeddings...")
    start_time = time.time()
    
    # Create temporary edge file
    temp_edge_file = "temp_edges.edg"
    with open(temp_edge_file, 'w') as f:
        for src, dst in zip(src_indices, dst_indices):
            f.write(f"{src}\t{dst}\n")
    
    # Create PecanPy model
    model = p2v.SparseOTF(p=p, q=q, workers=16, verbose=True)
    
    # Load edge list
    model.read_edg(temp_edge_file, weighted=False, directed=False)
    
    # Generate embeddings
    print("Starting embedding training...")
    print("   This may take 2-3 minutes for Word2Vec training...")
    embeddings = model.embed(
        dim=embedding_dim,
        num_walks=num_walks,
        walk_length=walk_length,
        window_size=WINDOW_SIZE,
        epochs=1  # Reduced from 3 to 1 for faster processing
    )
    print("Embedding training completed!")
    
    # Clean up temporary file
    os.remove(temp_edge_file)
    
    # Save embeddings to cache
    print(f"💾 Saving embeddings to cache '{cache_file}'...")
    np.save(cache_file, embeddings)
    print(f"✅ Embeddings cached for future runs!")
    
    elapsed_time = time.time() - start_time
    print(f"PecanPy SparseOTF completed in {elapsed_time:.2f} seconds")
    print(f"Generated embeddings shape: {embeddings.shape}")
    
    return embeddings

def perform_clustering(embeddings,
                       optimal_k,
                       cache_file="cluster_labels.npy"):
    """
    Run K-means on GPU (cuML) if available, with fallback to CPU.
    If `cache_file` exists, load labels and skip training.
    """
    print(f"\n🔍 Starting clustering with k={optimal_k}...", flush=True)
    
    # -------------------------------------------------- CACHE CHECK
    if os.path.exists(cache_file):
        print(f"🔎 Found cached clustering '{cache_file}' – loading…", flush=True)
        labels = np.load(cache_file)
        if len(labels) == len(embeddings):
            print("✅ Cache size OK – skipping K-means", flush=True)
            return labels
        else:
            print("⚠️  Cache size mismatch – recomputing", flush=True)

    # -------------------------------------------------- TRAIN
    if GPU_KMEANS:
        print(f"🚀 Attempting K-means (k={optimal_k}) on GPU...", flush=True)
        try:
            # cuML expects CuPy array; convert then get() back to NumPy
            print("   Converting to CuPy array...", flush=True)
            cu_embeddings = cp.asarray(embeddings, dtype=cp.float32)
            kmeans = cuKMeans(n_clusters=optimal_k,
                              random_state=42,
                              max_iter=300,
                              n_init=5)
            print("   Running GPU K-means...", flush=True)
            labels = kmeans.fit_predict(cu_embeddings).get()
            print("   GPU K-means completed!", flush=True)
        except Exception as e:
            print(f"   ❌ GPU K-means failed: {e}")
            print("   🔄 Falling back to CPU K-means...", flush=True)
            kmeans = KMeans(n_clusters=optimal_k,
                            random_state=42,
                            n_init=10)
            print("   Running CPU K-means...", flush=True)
            labels = kmeans.fit_predict(embeddings)
            print("   CPU K-means completed!", flush=True)
    else:
        print(f"🚀 Performing K-means (k={optimal_k}) on CPU...", flush=True)
        kmeans = KMeans(n_clusters=optimal_k,
                        random_state=42,
                        n_init=10)
        print("   Running CPU K-means...", flush=True)
        labels = kmeans.fit_predict(embeddings)
        print("   CPU K-means completed!", flush=True)

    # -------------------------------------------------- QUALITY METRIC
    if optimal_k > 1:
        sil = silhouette_score(embeddings, labels)
        print(f"   Silhouette score: {sil:.4f}", flush=True)

    # -------------------------------------------------- SAVE CACHE
    print(f"💾 Saving cluster labels to '{cache_file}'...", flush=True)
    np.save(cache_file, labels)
    print(f"✅ Cluster labels cached to '{cache_file}'", flush=True)
    return labels

def project_to_2d(embeddings):
    """Project embeddings to 2D using UMAP."""
    print("Projecting embeddings to 2D using UMAP...")
    
    # Create cache filename based on embeddings shape
    cache_file = f"umap_2d_embeddings_{embeddings.shape[0]}x{embeddings.shape[1]}.npy"
    
    # Check if cached UMAP projection exists
    if os.path.exists(cache_file):
        print(f"🔎 Found cached UMAP projection '{cache_file}' – loading...")
        embeddings_2d = np.load(cache_file)
        print(f"✅ Loaded cached UMAP projection with shape: {embeddings_2d.shape}")
        return embeddings_2d
    
    print("   No cache found – computing new UMAP projection...")
    reducer = umap.UMAP(n_components=2, random_state=42, n_neighbors=15, min_dist=0.1)
    embeddings_2d = reducer.fit_transform(embeddings)
    
    # Save UMAP projection to cache
    print(f"💾 Saving UMAP projection to cache '{cache_file}'...")
    np.save(cache_file, embeddings_2d)
    print(f"✅ UMAP projection cached for future runs!")
    
    return embeddings_2d

def save_results_to_db(paper_ids, embeddings_2d, cluster_labels):
    """Save results back to the database."""
    print("Saving results to database...")
    
    con = sqlite3.connect(DB_PATH)
    
    # Add new columns if they don't exist
    con.execute("ALTER TABLE filtered_papers ADD COLUMN IF NOT EXISTS embedding_x REAL")
    con.execute("ALTER TABLE filtered_papers ADD COLUMN IF NOT EXISTS embedding_y REAL")
    con.execute("ALTER TABLE filtered_papers ADD COLUMN IF NOT EXISTS cluster_id INTEGER")
    
    # Update the filtered_papers table
    for i, paper_id in enumerate(paper_ids):
        con.execute("""
            UPDATE filtered_papers 
            SET embedding_x = ?, embedding_y = ?, cluster_id = ?
            WHERE paper_id = ?
        """, (float(embeddings_2d[i, 0]), float(embeddings_2d[i, 1]), int(cluster_labels[i]), paper_id))
    
    con.commit()
    con.close()
    
    print(f"Saved results for {len(paper_ids)} papers")

def main():
    """Main execution function."""
    start_time = time.time()
    
    print("🚀 Starting FAST PecanPy-accelerated full graph processing pipeline...")
    print(f"Database: {DB_PATH}")
    print(f"Using default k={DEFAULT_K} (skipping elbow search for speed)")
    
    # Check if database exists
    if not os.path.exists(DB_PATH):
        print(f"❌ Database {DB_PATH} not found!")
        return
    
    try:
        # Step 1: Load graph
        paper_ids, paper_to_idx, src_indices, dst_indices = load_graph_from_db()
        
        # Step 2: Generate node2vec embeddings
        embeddings = generate_node2vec_embeddings(
            paper_ids, src_indices, dst_indices, EMBEDDING_DIM, WALK_LENGTH, NUM_WALKS, P, Q
        )
        
        # Step 3: Use default k (skip elbow search)
        optimal_k = DEFAULT_K
        print(f"Using default optimal k: {optimal_k}")
        
        # Step 4: Perform clustering
        print(f"\n🎯 About to start clustering with optimal_k={optimal_k}...", flush=True)
        cluster_labels = perform_clustering(embeddings, optimal_k, cache_file=f"cluster_labels_k={optimal_k}_lenpapers={len(paper_ids)}.npy")
        print(f"✅ Clustering completed! Got {len(cluster_labels)} labels", flush=True)
        
        # Step 5: Project to 2D
        embeddings_2d = project_to_2d(embeddings)
        
        # Step 6: Save results
        save_results_to_db(paper_ids, embeddings_2d, cluster_labels)
        
        total_time = time.time() - start_time
        print(f"\n✅ Pipeline completed successfully!")
        print(f"📊 Results:")
        print(f"   - Papers processed: {len(paper_ids)}")
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