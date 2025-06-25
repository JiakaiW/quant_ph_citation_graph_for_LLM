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

def kmeans_pytorch(embeddings, n_clusters, max_iter=300, tol=1e-4, random_state=42):
    """Fast PyTorch-based K-means implementation with proper seeding."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # Show device info
    if device.type == "cuda":
        print(f"   🚀 Using GPU: {torch.cuda.get_device_name()}")
        torch.cuda.empty_cache()  # Clear cache
    else:
        print(f"   💻 Using CPU")
    
    # Convert to PyTorch tensor
    X = torch.tensor(embeddings, dtype=torch.float32, device=device)
    N, D = X.shape
    
    # Set random seed for reproducible results
    torch.manual_seed(random_state)
    if device.type == "cuda":
        torch.cuda.manual_seed(random_state)
    
    # Use K-means++ initialization for better convergence
    centroids = kmeans_plus_plus_init(X, n_clusters, random_state)
    
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
                # If no points assigned, keep old centroid
                new_centroids[k] = centroids[k]
        
        # Check convergence
        if torch.norm(new_centroids - centroids) < tol:
            print(f"   ✅ Converged after {iteration + 1} iterations")
            break
            
        centroids = new_centroids
    
    if device.type == "cuda":
        torch.cuda.synchronize()  # Ensure all GPU operations complete
    
    return labels.cpu().numpy()

def kmeans_plus_plus_init(X, n_clusters, random_state):
    """K-means++ initialization for better convergence."""
    torch.manual_seed(random_state)
    N, D = X.shape
    centroids = torch.zeros(n_clusters, D, device=X.device)
    
    # Choose first centroid randomly
    centroids[0] = X[torch.randint(N, (1,))]
    
    # Choose remaining centroids using K-means++ algorithm
    for c in range(1, n_clusters):
        # Compute distances to nearest centroid
        distances = torch.cdist(X, centroids[:c])
        min_distances = torch.min(distances, dim=1)[0]
        
        # Choose next centroid with probability proportional to squared distance
        probabilities = min_distances ** 2
        probabilities = probabilities / probabilities.sum()
        
        # Sample based on probabilities
        cumulative_probs = torch.cumsum(probabilities, dim=0)
        r = torch.rand(1, device=X.device)
        idx = torch.searchsorted(cumulative_probs, r)
        centroids[c] = X[idx]
    
    return centroids

def find_optimal_k_elbow(embeddings, k_range=(5, 50), use_cache=True):
    """Find optimal number of clusters using elbow method with consistent initialization."""
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
            # Use consistent method for elbow search with multiple runs for stability
            if TORCH_AVAILABLE and torch.cuda.is_available():
                # Multiple runs with different seeds for stability
                best_inertia = float('inf')
                for seed in [42, 123, 456]:  # Multiple random seeds
                    labels = kmeans_pytorch(embeddings, k, random_state=seed)
                    # Calculate inertia manually
                    centroids = np.array([embeddings[labels == i].mean(axis=0) for i in range(k)])
                    inertia = sum(np.sum((embeddings[labels == i] - centroids[i])**2) for i in range(k))
                    best_inertia = min(best_inertia, inertia)
                inertias.append(best_inertia)
            else:
                # Use scikit-learn with multiple initializations for stability
                kmeans = KMeans(n_clusters=k, random_state=42, n_init=10, init='k-means++')
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
    """Perform K-means clustering on CPU with proper initialization."""
    print(f"🚀 Performing K-means (k={optimal_k}) on CPU...", flush=True)
    
    # Use K-means++ initialization with multiple runs for stability
    kmeans = KMeans(n_clusters=optimal_k, random_state=42, n_init=10, init='k-means++')
    print("   Running CPU K-means...", flush=True)
    labels = kmeans.fit_predict(embeddings)
    print(f"   CPU K-means completed! Final inertia: {kmeans.inertia_:.0f}", flush=True)
    
    return labels

def perform_clustering_pytorch(embeddings, optimal_k, cache_file=None):
    """Perform K-means clustering using PyTorch (GPU if available)."""
    device_name = "GPU" if torch.cuda.is_available() else "CPU"
    print(f"🚀 Performing K-means (k={optimal_k}) on PyTorch ({device_name})...", flush=True)
    
    try:
        # Use multiple runs for better stability
        best_labels = None
        best_inertia = float('inf')
        
        for seed in [42, 123, 456]:  # Multiple seeds for stability
            labels = kmeans_pytorch(embeddings, optimal_k, random_state=seed)
            # Calculate inertia
            centroids = np.array([embeddings[labels == i].mean(axis=0) for i in range(optimal_k)])
            inertia = sum(np.sum((embeddings[labels == i] - centroids[i])**2) for i in range(optimal_k))
            
            if inertia < best_inertia:
                best_inertia = inertia
                best_labels = labels
        
        print(f"   PyTorch K-means completed on {device_name}! Best inertia: {best_inertia:.0f}", flush=True)
        return best_labels
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

def perform_clustering(embeddings, optimal_k=None, k_range=(5, 50), backend="auto", use_cache=True):
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