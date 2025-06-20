#!/usr/bin/env python3
"""
Debug pipeline for testing individual components on small subsets.
Perfect for debugging GPU issues and parameter tuning without waiting for full runs.
"""

import time
from data_loader import load_subset_for_debug, save_results_to_db
from embeddings import generate_node2vec_embeddings
from clustering import perform_clustering, debug_clustering_small
from dimensionality_reduction import project_to_2d, debug_projection_small

def debug_data_loading(max_papers=100):
    """Debug data loading with a small subset."""
    print(f"🔧 DEBUG: Data loading ({max_papers} papers)")
    print("-" * 40)
    
    paper_ids, paper_to_idx, src_indices, dst_indices = load_subset_for_debug(max_papers)
    
    print(f"✅ Loaded {len(paper_ids)} papers, {len(src_indices)} edges")
    print(f"   Paper ID examples: {paper_ids[:5]}")
    print(f"   Edge examples: {list(zip(src_indices[:5], dst_indices[:5]))}")
    
    return paper_ids, paper_to_idx, src_indices, dst_indices

def debug_embeddings(paper_ids, src_indices, dst_indices, backend="pecanpy"):
    """Debug embedding generation."""
    print(f"🔧 DEBUG: Embeddings ({backend})")
    print("-" * 40)
    
    start_time = time.time()
    embeddings = generate_node2vec_embeddings(
        paper_ids, src_indices, dst_indices,
        backend=backend,
        embedding_dim=64,  # Smaller for debugging
        num_walks=5,       # Fewer walks
        walk_length=40,    # Shorter walks
        use_cache=False    # No cache for debugging
    )
    elapsed = time.time() - start_time
    
    print(f"✅ Generated embeddings: {embeddings.shape}")
    print(f"   Time taken: {elapsed:.2f} seconds")
    print(f"   Embedding sample: {embeddings[0][:5]}")
    
    return embeddings

def debug_clustering_component(embeddings, backend="auto"):
    """Debug clustering component."""
    print(f"🔧 DEBUG: Clustering ({backend})")
    print("-" * 40)
    
    # Test with small k values
    debug_clustering_small(embeddings, max_k=10)
    
    # Test specific clustering
    start_time = time.time()
    labels = perform_clustering(
        embeddings, 
        optimal_k=5,  # Small k for debugging
        backend=backend,
        use_cache=False
    )
    elapsed = time.time() - start_time
    
    print(f"✅ Clustering completed: {len(labels)} labels")
    print(f"   Time taken: {elapsed:.2f} seconds")
    print(f"   Unique clusters: {len(set(labels))}")
    print(f"   Label distribution: {dict(zip(*np.unique(labels, return_counts=True)))}")
    
    return labels

def debug_projection_component(embeddings, method="umap"):
    """Debug dimensionality reduction."""
    print(f"🔧 DEBUG: Projection ({method})")
    print("-" * 40)
    
    # Test both methods
    debug_projection_small(embeddings, max_samples=len(embeddings))
    
    # Test specific projection
    start_time = time.time()
    embeddings_2d = project_to_2d(
        embeddings,
        method=method,
        use_cache=False
    )
    elapsed = time.time() - start_time
    
    print(f"✅ Projection completed: {embeddings_2d.shape}")
    print(f"   Time taken: {elapsed:.2f} seconds")
    print(f"   X range: [{embeddings_2d[:, 0].min():.2f}, {embeddings_2d[:, 0].max():.2f}]")
    print(f"   Y range: [{embeddings_2d[:, 1].min():.2f}, {embeddings_2d[:, 1].max():.2f}]")
    
    return embeddings_2d

def debug_full_pipeline_small(max_papers=100, 
                             embedding_backend="pecanpy",
                             clustering_backend="auto",
                             projection_method="umap"):
    """Debug the full pipeline on a small subset."""
    print("🔧 DEBUG: Full pipeline on small subset")
    print("=" * 50)
    
    total_start = time.time()
    
    try:
        # Step 1: Load small dataset
        paper_ids, paper_to_idx, src_indices, dst_indices = debug_data_loading(max_papers)
        
        # Step 2: Generate embeddings
        embeddings = debug_embeddings(paper_ids, src_indices, dst_indices, embedding_backend)
        
        # Step 3: Clustering
        cluster_labels = debug_clustering_component(embeddings, clustering_backend)
        
        # Step 4: Projection
        embeddings_2d = debug_projection_component(embeddings, projection_method)
        
        # Step 5: Save (optional for debugging)
        print(f"🔧 DEBUG: Saving results")
        print("-" * 40)
        save_results_to_db(paper_ids, embeddings_2d, cluster_labels)
        print("✅ Results saved to database")
        
        total_time = time.time() - total_start
        print("\n" + "=" * 50)
        print("DEBUG PIPELINE COMPLETED!")
        print("=" * 50)
        print(f"📊 Debug Summary:")
        print(f"   - Papers: {len(paper_ids)}")
        print(f"   - Embeddings: {embeddings.shape}")
        print(f"   - Clusters: {len(set(cluster_labels))}")
        print(f"   - 2D projection: {embeddings_2d.shape}")
        print(f"   - Total time: {total_time:.2f} seconds")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Debug pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_gpu_components():
    """Specifically test GPU components to debug CUDA issues."""
    print("🔧 DEBUG: GPU Components")
    print("=" * 50)
    
    # Load small dataset
    paper_ids, _, src_indices, dst_indices = debug_data_loading(50)
    
    # Test GPU embedding (cuGraph)
    try:
        print("\n🔧 Testing cuGraph embeddings...")
        embeddings = debug_embeddings(paper_ids, src_indices, dst_indices, "cugraph")
        print("✅ cuGraph embeddings work!")
    except Exception as e:
        print(f"❌ cuGraph embeddings failed: {e}")
        # Fallback to CPU
        embeddings = debug_embeddings(paper_ids, src_indices, dst_indices, "pecanpy")
    
    # Test GPU clustering
    try:
        print("\n🔧 Testing GPU clustering...")
        labels = debug_clustering_component(embeddings, "pytorch")
        print("✅ GPU clustering works!")
    except Exception as e:
        print(f"❌ GPU clustering failed: {e}")

if __name__ == "__main__":
    import sys
    import numpy as np
    
    if len(sys.argv) > 1:
        mode = sys.argv[1]
        if mode == "data":
            debug_data_loading(100)
        elif mode == "embeddings":
            paper_ids, _, src_indices, dst_indices = debug_data_loading(50)
            debug_embeddings(paper_ids, src_indices, dst_indices)
        elif mode == "clustering":
            paper_ids, _, src_indices, dst_indices = debug_data_loading(50)
            embeddings = debug_embeddings(paper_ids, src_indices, dst_indices)
            debug_clustering_component(embeddings)
        elif mode == "projection":
            paper_ids, _, src_indices, dst_indices = debug_data_loading(50)
            embeddings = debug_embeddings(paper_ids, src_indices, dst_indices)
            debug_projection_component(embeddings)
        elif mode == "gpu":
            test_gpu_components()
        elif mode == "full":
            size = int(sys.argv[2]) if len(sys.argv) > 2 else 100
            debug_full_pipeline_small(size)
        else:
            print("Usage: python debug_pipeline.py [data|embeddings|clustering|projection|gpu|full] [size]")
            sys.exit(1)
    else:
        # Default: run small full pipeline
        debug_full_pipeline_small(100) 