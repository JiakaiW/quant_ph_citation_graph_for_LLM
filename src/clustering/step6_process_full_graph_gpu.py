#!/usr/bin/env python3
"""
GPU-accelerated full graph processing pipeline using CuPy for heavy computations.
This script processes the entire citation network and saves results to the database.

The pipeline:
1. Loads the full citation graph from the database
2. Generates node2vec embeddings using GPU-accelerated operations
3. Performs K-means clustering with automatic elbow detection
4. Projects to 2D using UMAP
5. Saves all results back to the database
"""

import sqlite3
import pandas as pd
import numpy as np
import cupy as cp
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from kneed import KneeLocator
import umap
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
    """Load the citation graph from the database using filtered data."""
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

def create_adjacency_matrix(paper_ids, src_indices, dst_indices):
    """Create adjacency matrix for the graph."""
    print("Creating adjacency matrix...")
    n = len(paper_ids)
    
    # Create sparse adjacency matrix on GPU
    adj_matrix = cp.zeros((n, n), dtype=cp.float32)
    
    # Add edges (both directions for undirected graph)
    for src, dst in zip(src_indices, dst_indices):
        adj_matrix[src, dst] = 1.0
        adj_matrix[dst, src] = 1.0  # Undirected graph
    
    print(f"Adjacency matrix shape: {adj_matrix.shape}")
    return adj_matrix

def node2vec_walks_gpu(adj_matrix, num_walks, walk_length, p, q):
    """Generate node2vec random walks using GPU acceleration."""
    print(f"Generating {num_walks} walks of length {walk_length} per node...")
    n = adj_matrix.shape[0]
    walks = []
    
    # Generate walks for each node
    for start_node in tqdm(range(n), desc="Generating walks"):
        for _ in range(num_walks):
            walk = [start_node]
            
            for _ in range(walk_length - 1):
                current = walk[-1]
                
                # Get neighbors
                neighbors = cp.where(adj_matrix[current] > 0)[0]
                if len(neighbors) == 0:
                    break
                
                # Node2vec bias calculation
                if len(walk) == 1:
                    # First step: uniform probability
                    probs = cp.ones(len(neighbors))
                else:
                    # Subsequent steps: biased by p and q
                    prev = walk[-2]
                    probs = cp.ones(len(neighbors))
                    
                    for i, neighbor in enumerate(neighbors):
                        if adj_matrix[prev, neighbor] > 0:
                            # Return to previous node
                            probs[i] = 1.0 / p
                        elif adj_matrix[current, neighbor] > 0:
                            # Stay close to current node
                            probs[i] = 1.0
                        else:
                            # Move away from current node
                            probs[i] = 1.0 / q
                
                # Normalize probabilities
                probs = probs / cp.sum(probs)
                
                # Sample next node
                next_node = cp.random.choice(neighbors, size=1, p=probs)[0]
                walk.append(int(next_node))
            
            walks.append(walk)
    
    return walks

def train_word2vec_gpu(walks, embedding_dim, window_size):
    """Train Word2Vec model on GPU using CuPy."""
    print(f"Training Word2Vec model with embedding dimension {embedding_dim}...")
    
    # Flatten walks and create vocabulary
    all_nodes = []
    for walk in walks:
        all_nodes.extend(walk)
    
    unique_nodes = sorted(set(all_nodes))
    node_to_idx = {node: idx for idx, node in enumerate(unique_nodes)}
    
    # Create training pairs
    training_pairs = []
    for walk in walks:
        for i, target in enumerate(walk):
            # Create context window
            start = max(0, i - window_size)
            end = min(len(walk), i + window_size + 1)
            
            for j in range(start, end):
                if i != j:
                    context = walk[j]
                    training_pairs.append((target, context))
    
    # Initialize embeddings
    n_nodes = len(unique_nodes)
    embeddings = cp.random.normal(0, 0.1, (n_nodes, embedding_dim)).astype(cp.float32)
    context_embeddings = cp.random.normal(0, 0.1, (n_nodes, embedding_dim)).astype(cp.float32)
    
    # Training parameters
    learning_rate = 0.01
    epochs = 5
    
    print(f"Training on {len(training_pairs)} pairs for {epochs} epochs...")
    
    for epoch in range(epochs):
        total_loss = 0
        for target, context in tqdm(training_pairs, desc=f"Epoch {epoch+1}/{epochs}"):
            if target in node_to_idx and context in node_to_idx:
                target_idx = node_to_idx[target]
                context_idx = node_to_idx[context]
                
                # Forward pass
                target_emb = embeddings[target_idx]
                context_emb = context_embeddings[context_idx]
                
                # Simple dot product similarity
                score = cp.dot(target_emb, context_emb)
                
                # Simple loss (negative log likelihood approximation)
                loss = -cp.log(1 / (1 + cp.exp(-score)))
                total_loss += float(loss)
                
                # Backward pass (simplified)
                grad = 1 / (1 + cp.exp(-score)) - 1
                embeddings[target_idx] -= learning_rate * grad * context_emb
                context_embeddings[context_idx] -= learning_rate * grad * target_emb
        
        print(f"Epoch {epoch+1} loss: {total_loss/len(training_pairs):.4f}")
    
    return embeddings.get(), unique_nodes

def find_optimal_k_elbow(embeddings, max_k=100, step_size=5):
    """Find optimal k using elbow method with two-stage search."""
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
        optimal_k_coarse = kneedle.elbow
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
    """Perform K-means clustering with the optimal k."""
    print(f"Performing K-means clustering with k={optimal_k}...")
    
    kmeans = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
    cluster_labels = kmeans.fit_predict(embeddings)
    
    # Calculate silhouette score
    if optimal_k > 1:
        silhouette_avg = silhouette_score(embeddings, cluster_labels)
        print(f"Silhouette score: {silhouette_avg:.4f}")
    
    return cluster_labels

def project_to_2d(embeddings):
    """Project embeddings to 2D using UMAP."""
    print("Projecting embeddings to 2D using UMAP...")
    
    reducer = umap.UMAP(n_components=2, random_state=42, n_neighbors=15, min_dist=0.1)
    embeddings_2d = reducer.fit_transform(embeddings)
    
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
    
    print("🚀 Starting GPU-accelerated full graph processing pipeline...")
    print(f"Database: {DB_PATH}")
    
    # Check if database exists
    if not os.path.exists(DB_PATH):
        print(f"❌ Database {DB_PATH} not found!")
        return
    
    try:
        # Step 1: Load graph
        paper_ids, paper_to_idx, src_indices, dst_indices = load_graph_from_db()
        
        # Step 2: Create adjacency matrix on GPU
        adj_matrix = create_adjacency_matrix(paper_ids, src_indices, dst_indices)
        
        # Step 3: Generate node2vec walks
        walks = node2vec_walks_gpu(adj_matrix, NUM_WALKS, WALK_LENGTH, P, Q)
        
        # Step 4: Train Word2Vec embeddings
        embeddings, unique_nodes = train_word2vec_gpu(walks, EMBEDDING_DIM, WINDOW_SIZE)
        
        # Create mapping from paper_ids to embeddings
        node_to_emb_idx = {node: idx for idx, node in enumerate(unique_nodes)}
        final_embeddings = []
        
        for paper_id in paper_ids:
            if paper_id in node_to_emb_idx:
                final_embeddings.append(embeddings[node_to_emb_idx[paper_id]])
            else:
                # If paper not in walks, use zero embedding
                final_embeddings.append(np.zeros(EMBEDDING_DIM))
        
        embeddings = np.array(final_embeddings)
        
        # Step 5: Find optimal k
        optimal_k = find_optimal_k_elbow(embeddings)
        
        # Step 6: Perform clustering
        cluster_labels = perform_clustering(embeddings, optimal_k)
        
        # Step 7: Project to 2D
        embeddings_2d = project_to_2d(embeddings)
        
        # Step 8: Save results
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