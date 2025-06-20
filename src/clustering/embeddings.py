#!/usr/bin/env python3
"""
Node2vec embedding generation with multiple backends and caching.
Supports PecanPy (CPU), RAPIDS cuGraph (GPU), and other implementations.
"""

import numpy as np
import os
import time
from pecanpy import pecanpy as p2v

# Try to import GPU libraries
try:
    import cugraph
    from cugraph.experimental import PropertyGraph
    CUGRAPH_AVAILABLE = True
except ImportError:
    CUGRAPH_AVAILABLE = False

# --- Configuration ---
EMBEDDING_DIM = 128
WINDOW_SIZE = 10
NUM_WALKS = 10
WALK_LENGTH = 80
P = 1.0  # Return parameter
Q = 1.0  # In-out parameter

def generate_cache_filename(paper_ids, embedding_dim, num_walks, walk_length, p, q, backend="pecanpy"):
    """Generate a consistent cache filename based on parameters."""
    return f"embeddings_{backend}_dim={embedding_dim}_walks={num_walks}_length={walk_length}_p={p}_q={q}_papers={len(paper_ids)}.npy"

def generate_node2vec_pecanpy(paper_ids, src_indices, dst_indices, 
                             embedding_dim=EMBEDDING_DIM, 
                             num_walks=NUM_WALKS, 
                             walk_length=WALK_LENGTH, 
                             p=P, q=Q,
                             use_cache=True):
    """Generate node2vec embeddings using PecanPy SparseOTF (CPU)."""
    print(f"Running PecanPy SparseOTF with {num_walks} walks of length {walk_length}...")
    
    # Check cache
    cache_file = generate_cache_filename(paper_ids, embedding_dim, num_walks, walk_length, p, q, "pecanpy")
    if use_cache and os.path.exists(cache_file):
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
    if use_cache:
        print(f"💾 Saving embeddings to cache '{cache_file}'...")
        np.save(cache_file, embeddings)
        print(f"✅ Embeddings cached for future runs!")
    
    elapsed_time = time.time() - start_time
    print(f"PecanPy SparseOTF completed in {elapsed_time:.2f} seconds")
    print(f"Generated embeddings shape: {embeddings.shape}")
    
    return embeddings

def generate_node2vec_cugraph(paper_ids, src_indices, dst_indices,
                             embedding_dim=EMBEDDING_DIM,
                             num_walks=NUM_WALKS,
                             walk_length=WALK_LENGTH,
                             p=P, q=Q,
                             use_cache=True):
    """Generate node2vec embeddings using RAPIDS cuGraph (GPU)."""
    if not CUGRAPH_AVAILABLE:
        raise ImportError("RAPIDS cuGraph not available. Install with: pip install cugraph-cu12")
    
    print(f"Running RAPIDS cuGraph node2vec with {num_walks} walks of length {walk_length}...")
    
    # Check cache
    cache_file = generate_cache_filename(paper_ids, embedding_dim, num_walks, walk_length, p, q, "cugraph")
    if use_cache and os.path.exists(cache_file):
        print(f"🔎 Found cached embeddings '{cache_file}' – loading...")
        embeddings = np.load(cache_file)
        print(f"✅ Loaded cached embeddings with shape: {embeddings.shape}")
        return embeddings
    
    print("   No cache found – training new embeddings...")
    start_time = time.time()
    
    try:
        import cudf
        import cugraph
        from gensim.models import Word2Vec
        
        # Create cuDF DataFrame for edges
        edges_df = cudf.DataFrame({
            'src': src_indices,
            'dst': dst_indices
        })
        
        # Create cuGraph
        G = cugraph.Graph()
        G.from_cudf_edgelist(edges_df, source='src', destination='dst')
        
        # Generate random walks
        print("   Generating random walks on GPU...")
        walks_df = cugraph.node2vec(G, 
                                   start_vertices=None,  # All vertices
                                   max_depth=walk_length,
                                   num_walks=num_walks,
                                   p=p,
                                   q=q)
        
        # Convert walks to sequences for Word2Vec
        print("   Converting walks for Word2Vec training...")
        walks_list = []
        for _, row in walks_df.iterrows():
            walk = [str(int(node)) for node in row['vertex_path'] if node >= 0]
            if len(walk) > 1:
                walks_list.append(walk)
        
        # Train Word2Vec model
        print("   Training Word2Vec model...")
        model = Word2Vec(walks_list, 
                        vector_size=embedding_dim,
                        window=WINDOW_SIZE,
                        min_count=1,
                        workers=16,
                        epochs=1)
        
        # Extract embeddings
        embeddings = np.zeros((len(paper_ids), embedding_dim))
        for i, paper_id in enumerate(paper_ids):
            if str(i) in model.wv:
                embeddings[i] = model.wv[str(i)]
        
        print("Embedding training completed!")
        
    except Exception as e:
        print(f"❌ RAPIDS cuGraph failed: {e}")
        print("🔄 Falling back to PecanPy...")
        return generate_node2vec_pecanpy(paper_ids, src_indices, dst_indices,
                                       embedding_dim, num_walks, walk_length, p, q, use_cache)
    
    # Save embeddings to cache
    if use_cache:
        print(f"💾 Saving embeddings to cache '{cache_file}'...")
        np.save(cache_file, embeddings)
        print(f"✅ Embeddings cached for future runs!")
    
    elapsed_time = time.time() - start_time
    print(f"RAPIDS cuGraph completed in {elapsed_time:.2f} seconds")
    print(f"Generated embeddings shape: {embeddings.shape}")
    
    return embeddings

def generate_node2vec_embeddings(paper_ids, src_indices, dst_indices,
                               backend="pecanpy",
                               embedding_dim=EMBEDDING_DIM,
                               num_walks=NUM_WALKS,
                               walk_length=WALK_LENGTH,
                               p=P, q=Q,
                               use_cache=True):
    """
    Generate node2vec embeddings using the specified backend.
    
    Args:
        backend: "pecanpy" (CPU) or "cugraph" (GPU)
    """
    if backend == "pecanpy":
        return generate_node2vec_pecanpy(paper_ids, src_indices, dst_indices,
                                       embedding_dim, num_walks, walk_length, p, q, use_cache)
    elif backend == "cugraph":
        return generate_node2vec_cugraph(paper_ids, src_indices, dst_indices,
                                       embedding_dim, num_walks, walk_length, p, q, use_cache)
    else:
        raise ValueError(f"Unknown backend: {backend}. Use 'pecanpy' or 'cugraph'.") 