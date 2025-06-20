#!/usr/bin/env python3
"""
Demonstration script to show GPU vs CPU performance differences.
This will make GPU usage more visible in monitoring tools.
"""

import time
import numpy as np
from clustering import perform_clustering
from dimensionality_reduction import project_to_2d

def demo_gpu_vs_cpu_clustering():
    """Demonstrate GPU vs CPU clustering performance."""
    print("🔥 GPU vs CPU Clustering Performance Demo")
    print("=" * 50)
    
    # Create increasingly large datasets
    sizes = [1000, 5000, 10000]
    
    for size in sizes:
        print(f"\n📊 Testing with {size} samples...")
        print("-" * 30)
        
        # Generate random embeddings
        np.random.seed(42)
        embeddings = np.random.randn(size, 128).astype(np.float32)
        k = min(50, size // 20)  # Reasonable number of clusters
        
        print(f"   Data: {embeddings.shape}, k={k}")
        
        # Test CPU clustering
        print("   💻 CPU K-means...")
        start_time = time.time()
        labels_cpu = perform_clustering(embeddings, optimal_k=k, backend="cpu", use_cache=False)
        cpu_time = time.time() - start_time
        print(f"   💻 CPU time: {cpu_time:.3f}s")
        
        # Test GPU clustering
        print("   🚀 GPU K-means...")
        start_time = time.time()
        labels_gpu = perform_clustering(embeddings, optimal_k=k, backend="pytorch", use_cache=False)
        gpu_time = time.time() - start_time
        print(f"   🚀 GPU time: {gpu_time:.3f}s")
        
        # Calculate speedup
        speedup = cpu_time / gpu_time if gpu_time > 0 else float('inf')
        print(f"   ⚡ Speedup: {speedup:.1f}x")
        
        # Brief pause to see GPU usage in monitoring tools
        print("   ⏳ Pausing 2s for monitoring...")
        time.sleep(2)

def demo_gpu_vs_cpu_umap():
    """Demonstrate GPU vs CPU UMAP performance."""
    print("\n🔥 GPU vs CPU UMAP Performance Demo")
    print("=" * 50)
    
    # Create increasingly large datasets
    sizes = [1000, 2000, 5000]
    
    for size in sizes:
        print(f"\n📊 Testing UMAP with {size} samples...")
        print("-" * 30)
        
        # Generate random high-dimensional embeddings
        np.random.seed(42)
        embeddings = np.random.randn(size, 128).astype(np.float32)
        
        print(f"   Data: {embeddings.shape}")
        
        # Test CPU UMAP
        print("   💻 CPU UMAP...")
        start_time = time.time()
        umap_cpu = project_to_2d(embeddings, method="umap", backend="cpu", use_cache=False)
        cpu_time = time.time() - start_time
        print(f"   💻 CPU time: {cpu_time:.3f}s")
        
        # Test GPU UMAP
        print("   🚀 GPU UMAP...")
        start_time = time.time()
        umap_gpu = project_to_2d(embeddings, method="umap", backend="gpu", use_cache=False)
        gpu_time = time.time() - start_time
        print(f"   🚀 GPU time: {gpu_time:.3f}s")
        
        # Calculate speedup
        speedup = cpu_time / gpu_time if gpu_time > 0 else float('inf')
        print(f"   ⚡ Speedup: {speedup:.1f}x")
        
        # Brief pause to see GPU usage in monitoring tools
        print("   ⏳ Pausing 2s for monitoring...")
        time.sleep(2)

def demo_sustained_gpu_usage():
    """Create sustained GPU usage that's easy to see in monitoring tools."""
    print("\n🔥 Sustained GPU Usage Demo")
    print("=" * 50)
    print("This will run multiple operations to create sustained GPU usage.")
    print("Perfect for monitoring with nvidia-smi or the GPU monitor script!")
    print()
    
    # Multiple rounds of GPU operations
    for round_num in range(1, 4):
        print(f"🔄 Round {round_num}/3")
        print("-" * 20)
        
        # Large dataset
        size = 8000
        np.random.seed(42 + round_num)
        embeddings = np.random.randn(size, 128).astype(np.float32)
        
        # Multiple clustering operations
        for k in [20, 40, 60]:
            print(f"   🚀 GPU K-means with k={k}...")
            labels = perform_clustering(embeddings, optimal_k=k, backend="pytorch", use_cache=False)
            time.sleep(0.5)  # Brief pause
        
        # UMAP projection
        print(f"   🚀 GPU UMAP projection...")
        umap_result = project_to_2d(embeddings, method="umap", backend="gpu", use_cache=False)
        
        print(f"   ✅ Round {round_num} completed")
        print("   ⏳ Pausing 3s...")
        time.sleep(3)
    
    print("\n🎉 Demo completed! Check your GPU monitoring results.")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        mode = sys.argv[1]
        if mode == "clustering":
            demo_gpu_vs_cpu_clustering()
        elif mode == "umap":
            demo_gpu_vs_cpu_umap()
        elif mode == "sustained":
            demo_sustained_gpu_usage()
        else:
            print("Usage: python demo_gpu_usage.py [clustering|umap|sustained]")
    else:
        # Run all demos
        demo_gpu_vs_cpu_clustering()
        demo_gpu_vs_cpu_umap()
        demo_sustained_gpu_usage() 