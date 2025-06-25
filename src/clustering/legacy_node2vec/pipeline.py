#!/usr/bin/env python3
"""
Main clustering pipeline that orchestrates all components.
Modular approach allows for easy debugging and component swapping.
"""

import time
from data_loader import load_graph_from_db, save_results_to_db
from embeddings import generate_node2vec_embeddings
from clustering import perform_clustering
from dimensionality_reduction import project_to_2d

def run_full_pipeline(embedding_backend="pecanpy", 
                     clustering_backend="auto",
                     projection_method="umap",
                     projection_backend="auto",
                     optimal_k=None,
                     k_range=(5, 50),
                     use_cache=True):
    """
    Run the complete clustering pipeline.
    
    Args:
        embedding_backend: "pecanpy" or "cugraph"
        clustering_backend: "cpu", "pytorch", "cuml", or "auto"
        projection_method: "umap" or "tsne"
        projection_backend: "cpu", "gpu", or "auto" (for UMAP)
        optimal_k: Number of clusters (None for auto-detection with elbow method)
        k_range: Range for elbow method (min_k, max_k), only used if optimal_k is None
        use_cache: Whether to use caching
    """
    start_time = time.time()
    
    print("🚀 Starting modular clustering pipeline...")
    print(f"   Embedding backend: {embedding_backend}")
    print(f"   Clustering backend: {clustering_backend}")
    print(f"   Projection method: {projection_method}")
    print(f"   Projection backend: {projection_backend}")
    print(f"   Optimal k: {optimal_k or 'auto-detect'}")
    print(f"   Use cache: {use_cache}")
    
    try:
        # Step 1: Load graph data
        print("\n" + "="*50)
        print("STEP 1: Loading graph data")
        print("="*50)
        paper_ids, paper_to_idx, src_indices, dst_indices = load_graph_from_db()
        
        # Step 2: Generate embeddings
        print("\n" + "="*50)
        print("STEP 2: Generating node2vec embeddings")
        print("="*50)
        embeddings = generate_node2vec_embeddings(
            paper_ids, src_indices, dst_indices, 
            backend=embedding_backend,
            use_cache=use_cache
        )
        
        # Step 3: Perform clustering
        print("\n" + "="*50)
        print("STEP 3: Performing clustering")
        print("="*50)
        cluster_labels = perform_clustering(
            embeddings, 
            optimal_k=optimal_k,
            k_range=k_range,
            backend=clustering_backend,
            use_cache=use_cache
        )
        
        # Step 4: Project to 2D
        print("\n" + "="*50)
        print("STEP 4: Projecting to 2D")
        print("="*50)
        embeddings_2d = project_to_2d(
            embeddings, 
            method=projection_method,
            backend=projection_backend,
            use_cache=use_cache
        )
        
        # Step 5: Save results
        print("\n" + "="*50)
        print("STEP 5: Saving results to database")
        print("="*50)
        save_results_to_db(paper_ids, embeddings_2d, cluster_labels)
        
        # Summary
        total_time = time.time() - start_time
        unique_clusters = len(set(cluster_labels))
        
        print("\n" + "="*50)
        print("PIPELINE COMPLETED SUCCESSFULLY!")
        print("="*50)
        print(f"📊 Results Summary:")
        print(f"   - Papers processed: {len(paper_ids):,}")
        print(f"   - Embedding dimensions: {embeddings.shape[1]}")
        print(f"   - Number of clusters: {unique_clusters}")
        print(f"   - Total processing time: {total_time:.2f} seconds")
        print(f"   - Average time per paper: {total_time/len(paper_ids)*1000:.2f} ms")
        print(f"\n🎯 You can now run 'export_for_sigma.py' to generate visualization data.")
        
        return {
            'paper_ids': paper_ids,
            'embeddings': embeddings,
            'cluster_labels': cluster_labels,
            'embeddings_2d': embeddings_2d,
            'processing_time': total_time,
            'num_clusters': unique_clusters
        }
        
    except Exception as e:
        print(f"\n❌ Pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        return None

def run_fast_pipeline(use_defaults=False):
    """Run pipeline with fast defaults but proper elbow method for optimal k."""
    return run_full_pipeline(
        embedding_backend="pecanpy",
        clustering_backend="auto", 
        projection_method="umap",
        optimal_k=None,  # Always use elbow method - it's fast with GPU
        use_cache=True
    )

def run_gpu_pipeline():
    """Run pipeline with GPU acceleration where possible."""
    return run_full_pipeline(
        embedding_backend="pecanpy",
        clustering_backend="pytorch",
        projection_method="umap", 
        optimal_k=None,
        use_cache=True
    )

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        mode = sys.argv[1]
        if mode == "fast":
            result = run_fast_pipeline()
        elif mode == "gpu":
            result = run_gpu_pipeline()
        elif mode == "full":
            result = run_full_pipeline()
        else:
            print("Usage: python pipeline.py [fast|gpu|full]")
            sys.exit(1)
    else:
        # Default to fast mode
        result = run_fast_pipeline() 