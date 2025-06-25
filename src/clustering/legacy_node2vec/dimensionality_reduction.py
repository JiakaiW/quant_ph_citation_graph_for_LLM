#!/usr/bin/env python3
"""
Dimensionality reduction techniques with caching support and GPU acceleration.
Supports UMAP and t-SNE for projecting high-dimensional embeddings to 2D.
"""

import numpy as np
import os
import umap
from sklearn.manifold import TSNE

# Try to import GPU libraries
try:
    from cuml.manifold import UMAP as cuUMAP
    import cupy as cp
    CUML_UMAP_AVAILABLE = True
    print("✅ cuML UMAP found – GPU UMAP acceleration available")
except ImportError:
    CUML_UMAP_AVAILABLE = False
    print("⚠️  cuML UMAP not available – using CPU UMAP only")

def project_to_2d_umap_gpu(embeddings, 
                           n_neighbors=15, 
                           min_dist=0.1, 
                           random_state=42,
                           use_cache=True):
    """Project embeddings to 2D using GPU-accelerated cuML UMAP."""
    print("🚀 Projecting embeddings to 2D using GPU UMAP (cuML)...")
    
    # Create cache filename based on embeddings shape and parameters
    cache_file = f"cuml_umap_2d_embeddings_{embeddings.shape[0]}x{embeddings.shape[1]}_n{n_neighbors}_d{min_dist}.npy"
    
    # Check if cached UMAP projection exists
    if use_cache and os.path.exists(cache_file):
        print(f"🔎 Found cached GPU UMAP projection '{cache_file}' – loading...")
        embeddings_2d = np.load(cache_file)
        print(f"✅ Loaded cached GPU UMAP projection with shape: {embeddings_2d.shape}")
        return embeddings_2d
    
    print("   No cache found – computing new GPU UMAP projection...")
    
    try:
        # Convert to CuPy array for GPU processing
        print(f"   📊 Converting {embeddings.shape} embeddings to GPU...")
        cu_embeddings = cp.asarray(embeddings, dtype=cp.float32)
        
        # Show GPU memory usage
        gpu_mem_used = cp.cuda.MemoryPool().used_bytes() / 1e6
        print(f"   📊 GPU memory used: {gpu_mem_used:.1f} MB")
        
        reducer = cuUMAP(
            n_components=2, 
            random_state=random_state, 
            n_neighbors=n_neighbors, 
            min_dist=min_dist,
            verbose=True
        )
        
        print("   🚀 Running GPU UMAP...")
        embeddings_2d_gpu = reducer.fit_transform(cu_embeddings)
        
        # Convert back to NumPy
        embeddings_2d = embeddings_2d_gpu.get()
        print(f"   ✅ GPU UMAP completed! Shape: {embeddings_2d.shape}")
        
        # Save UMAP projection to cache
        if use_cache:
            print(f"💾 Saving GPU UMAP projection to cache '{cache_file}'...")
            np.save(cache_file, embeddings_2d)
            print(f"✅ GPU UMAP projection cached for future runs!")
        
        return embeddings_2d
        
    except Exception as e:
        print(f"   ❌ GPU UMAP failed: {e}")
        print("   🔄 Falling back to CPU UMAP...")
        return project_to_2d_umap_cpu(embeddings, n_neighbors, min_dist, random_state, use_cache)

def project_to_2d_umap_cpu(embeddings, 
                           n_neighbors=15, 
                           min_dist=0.1, 
                           random_state=42,
                           use_cache=True):
    """Project embeddings to 2D using CPU UMAP."""
    print("💻 Projecting embeddings to 2D using CPU UMAP...")
    
    # Create cache filename based on embeddings shape and parameters
    cache_file = f"cpu_umap_2d_embeddings_{embeddings.shape[0]}x{embeddings.shape[1]}_n{n_neighbors}_d{min_dist}.npy"
    
    # Check if cached UMAP projection exists
    if use_cache and os.path.exists(cache_file):
        print(f"🔎 Found cached CPU UMAP projection '{cache_file}' – loading...")
        embeddings_2d = np.load(cache_file)
        print(f"✅ Loaded cached CPU UMAP projection with shape: {embeddings_2d.shape}")
        return embeddings_2d
    
    print("   No cache found – computing new CPU UMAP projection...")
    reducer = umap.UMAP(
        n_components=2, 
        random_state=random_state, 
        n_neighbors=n_neighbors, 
        min_dist=min_dist,
        verbose=True
    )
    embeddings_2d = reducer.fit_transform(embeddings)
    
    # Save UMAP projection to cache
    if use_cache:
        print(f"💾 Saving CPU UMAP projection to cache '{cache_file}'...")
        np.save(cache_file, embeddings_2d)
        print(f"✅ CPU UMAP projection cached for future runs!")
    
    return embeddings_2d

def project_to_2d_umap(embeddings, 
                       n_neighbors=15, 
                       min_dist=0.1, 
                       random_state=42,
                       use_cache=True,
                       backend="auto"):
    """Project embeddings to 2D using UMAP with backend selection."""
    
    # Backend selection
    if backend == "gpu" or (backend == "auto" and CUML_UMAP_AVAILABLE):
        if CUML_UMAP_AVAILABLE:
            return project_to_2d_umap_gpu(embeddings, n_neighbors, min_dist, random_state, use_cache)
        else:
            print("⚠️  GPU UMAP not available, falling back to CPU")
            return project_to_2d_umap_cpu(embeddings, n_neighbors, min_dist, random_state, use_cache)
    else:
        return project_to_2d_umap_cpu(embeddings, n_neighbors, min_dist, random_state, use_cache)

def project_to_2d_tsne(embeddings, 
                       perplexity=30, 
                       random_state=42,
                       use_cache=True):
    """Project embeddings to 2D using t-SNE."""
    print("Projecting embeddings to 2D using t-SNE...")
    
    # Create cache filename based on embeddings shape and parameters
    cache_file = f"tsne_2d_embeddings_{embeddings.shape[0]}x{embeddings.shape[1]}_p{perplexity}.npy"
    
    # Check if cached t-SNE projection exists
    if use_cache and os.path.exists(cache_file):
        print(f"🔎 Found cached t-SNE projection '{cache_file}' – loading...")
        embeddings_2d = np.load(cache_file)
        print(f"✅ Loaded cached t-SNE projection with shape: {embeddings_2d.shape}")
        return embeddings_2d
    
    print("   No cache found – computing new t-SNE projection...")
    # Limit perplexity for small datasets
    actual_perplexity = min(perplexity, (len(embeddings) - 1) // 3)
    
    reducer = TSNE(
        n_components=2,
        random_state=random_state,
        perplexity=actual_perplexity,
        verbose=1
    )
    embeddings_2d = reducer.fit_transform(embeddings)
    
    # Save t-SNE projection to cache
    if use_cache:
        print(f"💾 Saving t-SNE projection to cache '{cache_file}'...")
        np.save(cache_file, embeddings_2d)
        print(f"✅ t-SNE projection cached for future runs!")
    
    return embeddings_2d

def project_to_2d(embeddings, 
                  method="umap", 
                  use_cache=True,
                  backend="auto",
                  **kwargs):
    """
    Project embeddings to 2D using the specified method.
    
    Args:
        embeddings: High-dimensional embeddings
        method: "umap" or "tsne"
        use_cache: Whether to use caching
        backend: "cpu", "gpu", or "auto" (for UMAP only)
        **kwargs: Method-specific parameters
    """
    if method == "umap":
        return project_to_2d_umap(embeddings, use_cache=use_cache, backend=backend, **kwargs)
    elif method == "tsne":
        return project_to_2d_tsne(embeddings, use_cache=use_cache, **kwargs)
    else:
        raise ValueError(f"Unknown method: {method}. Use 'umap' or 'tsne'.")

def debug_projection_small(embeddings, max_samples=500):
    """Debug projection on a small subset with both methods."""
    print(f"🔧 Debug projection on {len(embeddings)} samples")
    
    # Subsample if too large
    if len(embeddings) > max_samples:
        indices = np.random.choice(len(embeddings), max_samples, replace=False)
        embeddings_subset = embeddings[indices]
        print(f"   Subsampled to {len(embeddings_subset)} samples")
    else:
        embeddings_subset = embeddings
    
    # Test GPU UMAP if available
    if CUML_UMAP_AVAILABLE:
        print("   Testing GPU UMAP...")
        try:
            umap_gpu_2d = project_to_2d_umap_gpu(embeddings_subset, use_cache=False)
            print(f"   GPU UMAP result shape: {umap_gpu_2d.shape}")
        except Exception as e:
            print(f"   GPU UMAP failed: {e}")
    
    # Test CPU UMAP
    print("   Testing CPU UMAP...")
    umap_2d = project_to_2d_umap_cpu(embeddings_subset, use_cache=False)
    print(f"   CPU UMAP result shape: {umap_2d.shape}")
    
    # Test t-SNE
    print("   Testing t-SNE...")
    tsne_2d = project_to_2d_tsne(embeddings_subset, use_cache=False)
    print(f"   t-SNE result shape: {tsne_2d.shape}")
    
    print("🔧 Debug projection completed") 