#!/usr/bin/env python3
"""
Clustering algorithms with GPU/CPU support and caching.
Supports K-means with automatic optimal k detection and various backends.
"""

import numpy as np
import os
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from kneed import KneeLocator

# Try to import GPU libraries
try:
    import torch
    TORCH_AVAILABLE = True
    print("✅ PyTorch found – GPU K-means available")
except ImportError:
    TORCH_AVAILABLE = False
    print("⚠️  PyTorch not available")

try:
    from cuml.cluster import KMeans as cuKMeans
    import cupy as cp
    CUML_AVAILABLE = True
    print("✅ cuML found – GPU K-means enabled")
except ImportError:
    CUML_AVAILABLE = False
    print("⚠️  cuML not available")

def kmeans_pytorch(embeddings, n_clusters, max_iter=300, tol=1e-4):
    """Fast PyTorch-based K-means implementation."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # Show GPU info
    if device.type == "cuda":
        print(f"   🚀 Using GPU: {torch.cuda.get_device_name()}")
        torch.cuda.empty_cache()  # Clear cache
        mem_before = torch.cuda.memory_allocated() / 1e6
        print(f"   📊 GPU memory before: {mem_before:.1f} MB")
    else:
        print(f"   💻 Using CPU")
    
    # Convert to PyTorch tensor
    X = torch.tensor(embeddings, dtype=torch.float32, device=device)
    N, D = X.shape
    
    if device.type == "cuda":
        mem_after_data = torch.cuda.memory_allocated() / 1e6
        print(f"   📊 GPU memory after loading data: {mem_after_data:.1f} MB (+{mem_after_data-mem_before:.1f} MB)")
    
    # Initialize centroids
    centroids = X[torch.randperm(N)[:n_clusters]]
    
    for iteration in range(max_iter):
        # Compute distances: (N, 1, D) - (1, K, D) = (N, K, D)
        distances = torch.sum((X.unsqueeze(1) - centroids.unsqueeze(0)) ** 2, dim=2)
        
        # Assign points to closest centroids
        labels = torch.argmin(distances, dim=1)
        
        # Update centroids
        new_centroids = torch.zeros_like(centroids)
        for k in range(n_clusters):
            mask = labels == k
            if mask.sum() > 0:
                new_centroids[k] = X[mask].mean(dim=0)
            else:
                new_centroids[k] = centroids[k]  # Keep old centroid if no points assigned
        
        # Check convergence
        if torch.norm(new_centroids - centroids) < tol:
            print(f"   ✅ Converged after {iteration + 1} iterations")
            break
            
        centroids = new_centroids
    
    if device.type == "cuda":
        mem_final = torch.cuda.memory_allocated() / 1e6
        print(f"   📊 GPU memory final: {mem_final:.1f} MB")
        torch.cuda.synchronize()  # Ensure all GPU operations complete
    
    return labels.cpu().numpy()

def find_optimal_k_elbow(embeddings, k_range=(10, 100), use_cache=True):
    """Find optimal number of clusters using elbow method."""
    cache_file = f"elbow_search_k{k_range[0]}-{k_range[1]}_papers{len(embeddings)}.npy"
    
    if use_cache and os.path.exists(cache_file):
        print(f"🔎 Found cached elbow search '{cache_file}' – loading...")
        results = np.load(cache_file)
        k_values, inertias = results[0], results[1]
        print(f"✅ Loaded cached elbow search results")
    else:
        print(f"Finding optimal k using elbow method (range {k_range})...")
        k_values = list(range(k_range[0], k_range[1] + 1, 1))  # Step by 1 for precision
        inertias = []
        
        for k in k_values:
            print(f"   Testing k={k}...", flush=True)
            # Use fastest available method for elbow search
            if TORCH_AVAILABLE and torch.cuda.is_available():
                labels = kmeans_pytorch(embeddings, k)
                # Calculate inertia manually
                centroids = np.array([embeddings[labels == i].mean(axis=0) for i in range(k)])
                inertia = sum(np.sum((embeddings[labels == i] - centroids[i])**2) for i in range(k))
                inertias.append(inertia)
            else:
                kmeans = KMeans(n_clusters=k, random_state=42, n_init=3)
                kmeans.fit(embeddings)
                inertias.append(kmeans.inertia_)
        
        # Save to cache
        if use_cache:
            np.save(cache_file, [k_values, inertias])
            print(f"💾 Elbow search results cached to '{cache_file}'")
    
    # Find elbow
    kneedle = KneeLocator(k_values, inertias, curve="convex", direction="decreasing")
    optimal_k = kneedle.elbow
    
    if optimal_k is None:
        optimal_k = k_values[len(k_values) // 2]  # Fallback to middle value
        print(f"⚠️  No clear elbow found, using k={optimal_k}")
    else:
        print(f"📈 Optimal k found: {optimal_k}")
    
    return optimal_k, k_values, inertias

def perform_clustering_cpu(embeddings, optimal_k, cache_file=None):
    """Perform K-means clustering on CPU."""
    print(f"🚀 Performing K-means (k={optimal_k}) on CPU...", flush=True)
    
    kmeans = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
    print("   Running CPU K-means...", flush=True)
    labels = kmeans.fit_predict(embeddings)
    print("   CPU K-means completed!", flush=True)
    
    return labels

def perform_clustering_pytorch(embeddings, optimal_k, cache_file=None):
    """Perform K-means clustering using PyTorch (GPU if available)."""
    device_name = "GPU" if torch.cuda.is_available() else "CPU"
    print(f"🚀 Performing K-means (k={optimal_k}) on PyTorch ({device_name})...", flush=True)
    
    try:
        labels = kmeans_pytorch(embeddings, optimal_k)
        print(f"   PyTorch K-means completed on {device_name}!", flush=True)
        return labels
    except Exception as e:
        print(f"   ❌ PyTorch K-means failed: {e}")
        print("   🔄 Falling back to CPU K-means...", flush=True)
        return perform_clustering_cpu(embeddings, optimal_k, cache_file)

def perform_clustering_cuml(embeddings, optimal_k, cache_file=None):
    """Perform K-means clustering on GPU with cuML."""
    print(f"🚀 Attempting K-means (k={optimal_k}) on cuML GPU...", flush=True)
    
    try:
        # cuML expects CuPy array; convert then get() back to NumPy
        print("   Converting to CuPy array...", flush=True)
        cu_embeddings = cp.asarray(embeddings, dtype=cp.float32)
        kmeans = cuKMeans(n_clusters=optimal_k, random_state=42, max_iter=300, n_init=5)
        print("   Running cuML K-means...", flush=True)
        labels = kmeans.fit_predict(cu_embeddings).get()
        print("   cuML K-means completed!", flush=True)
        return labels
    except Exception as e:
        print(f"   ❌ cuML K-means failed: {e}")
        print("   🔄 Falling back to PyTorch K-means...", flush=True)
        return perform_clustering_pytorch(embeddings, optimal_k, cache_file)

def perform_clustering(embeddings, optimal_k=None, k_range=(10, 100), backend="auto", use_cache=True):
    """
    Perform clustering with caching support.
    
    Args:
        embeddings: Input embeddings
        optimal_k: Number of clusters (if None, will find optimal k)
        k_range: Range for elbow method (min_k, max_k), only used if optimal_k is None
        backend: "cpu", "pytorch", "cuml", or "auto"
        use_cache: Whether to use caching
    """
    # Find optimal k if not provided
    if optimal_k is None:
        optimal_k, _, _ = find_optimal_k_elbow(embeddings, k_range=k_range, use_cache=use_cache)
        optimal_k = int(optimal_k)  # Ensure it's an integer
    
    print(f"\n🔍 Starting clustering with k={optimal_k}...", flush=True)
    
    # Check cache
    cache_file = f"cluster_labels_k={optimal_k}_papers={len(embeddings)}.npy"
    if use_cache and os.path.exists(cache_file):
        print(f"🔎 Found cached clustering '{cache_file}' – loading…", flush=True)
        labels = np.load(cache_file)
        if len(labels) == len(embeddings):
            print("✅ Cache size OK – skipping K-means", flush=True)
            return labels
        else:
            print("⚠️  Cache size mismatch – recomputing", flush=True)
    
    # Choose backend
    if backend == "cpu":
        labels = perform_clustering_cpu(embeddings, optimal_k, cache_file)
    elif backend == "pytorch":
        if TORCH_AVAILABLE:
            labels = perform_clustering_pytorch(embeddings, optimal_k, cache_file)
        else:
            print("⚠️  PyTorch not available, falling back to CPU")
            labels = perform_clustering_cpu(embeddings, optimal_k, cache_file)
    elif backend == "cuml":
        if CUML_AVAILABLE:
            labels = perform_clustering_cuml(embeddings, optimal_k, cache_file)
        else:
            print("⚠️  cuML not available, falling back to PyTorch")
            labels = perform_clustering_pytorch(embeddings, optimal_k, cache_file)
    elif backend == "auto":
        # Smart backend selection based on data size and available libraries
        data_size = embeddings.shape[0] * embeddings.shape[1]
        
        if data_size > 100000 and CUML_AVAILABLE:  # Large data + cuML available
            labels = perform_clustering_cuml(embeddings, optimal_k, cache_file)
        elif TORCH_AVAILABLE and torch.cuda.is_available():  # PyTorch GPU available
            labels = perform_clustering_pytorch(embeddings, optimal_k, cache_file)
        else:  # Fallback to CPU
            labels = perform_clustering_cpu(embeddings, optimal_k, cache_file)
    else:
        raise ValueError(f"Unknown backend: {backend}. Use 'cpu', 'pytorch', 'cuml', or 'auto'.")
    
    # Quality metric
    if optimal_k > 1:
        sil = silhouette_score(embeddings, labels)
        print(f"   Silhouette score: {sil:.4f}", flush=True)
    
    # Save cache
    if use_cache:
        print(f"💾 Saving cluster labels to '{cache_file}'...", flush=True)
        np.save(cache_file, labels)
        print(f"✅ Cluster labels cached to '{cache_file}'", flush=True)
    
    return labels

def debug_clustering_small(embeddings, max_k=20):
    """Debug clustering on a small subset with detailed output."""
    print(f"🔧 Debug clustering on {len(embeddings)} samples (max k={max_k})")
    
    # Test different k values
    for k in range(2, min(max_k + 1, len(embeddings))):
        print(f"   Testing k={k}...")
        labels = perform_clustering(embeddings, optimal_k=k, use_cache=False)
        
        if k > 1:
            sil = silhouette_score(embeddings, labels)
            unique_labels = len(np.unique(labels))
            print(f"     k={k}: {unique_labels} clusters, silhouette={sil:.4f}")
        
        if k >= 10:  # Stop early for debugging
            break
    
    print("🔧 Debug clustering completed") 