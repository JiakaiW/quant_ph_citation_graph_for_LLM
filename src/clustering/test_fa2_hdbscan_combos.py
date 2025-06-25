#!/usr/bin/env python3
"""
Test HDBSCAN parameters on ForceAtlas2 (scaling=3.0, gravity=0.1) results
to handle variable density clustering properly.
"""

import sys
import os
sys.path.append(os.path.dirname(__file__))

from physics_clustering_migration import PhysicsClusteringMigrator
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from collections import Counter
from sklearn.preprocessing import StandardScaler

# GPU HDBSCAN
try:
    import cudf
    import cuml
    from cuml import HDBSCAN as cuHDBSCAN
    GPU_AVAILABLE = True
    print("🚀 GPU cuML HDBSCAN available")
except ImportError:
    GPU_AVAILABLE = False
    print("⚠️  GPU cuML not available, trying CPU HDBSCAN...")

# CPU HDBSCAN fallback
try:
    import hdbscan
    CPU_HDBSCAN_AVAILABLE = True
    print("✅ CPU HDBSCAN available")
except ImportError:
    CPU_HDBSCAN_AVAILABLE = False
    print("❌ HDBSCAN not available - install with: pip install hdbscan")

def run_fa2_fixed_params(migrator, nodes_df, edges_df):
    """Run ForceAtlas2 with the chosen parameters: scaling=3.0, gravity=0.1"""
    
    print("🚀 Running ForceAtlas2 with scaling_ratio=3.0, gravity=0.1, LinLog mode...")
    
    # Create a temporary migrator with our desired parameters
    temp_migrator = PhysicsClusteringMigrator(
        fa2_scaling_ratio=3.0,
        fa2_gravity=0.1,
        fa2_max_iterations=2000,  # More iterations for better convergence
        use_gpu=GPU_AVAILABLE
    )
    
    positions = temp_migrator.compute_forceatlas2_layout_gpu(nodes_df, edges_df)
    
    # Log coordinate statistics
    x_coords = positions[:, 0]
    y_coords = positions[:, 1]
    print(f"📊 Coordinate ranges: X[{x_coords.min():.1f}, {x_coords.max():.1f}], Y[{y_coords.min():.1f}, {y_coords.max():.1f}]")
    print(f"📊 Coordinate spans: X={x_coords.max()-x_coords.min():.1f}, Y={y_coords.max()-y_coords.min():.1f}")
    
    # Calculate distances to understand density variations
    center_x, center_y = x_coords.mean(), y_coords.mean()
    distances_from_center = np.sqrt((x_coords - center_x)**2 + (y_coords - center_y)**2)
    
    print(f"📊 Distance from center: min={distances_from_center.min():.1f}, max={distances_from_center.max():.1f}")
    print(f"📊 Distance percentiles: 50%={np.percentile(distances_from_center, 50):.1f}, 90%={np.percentile(distances_from_center, 90):.1f}, 95%={np.percentile(distances_from_center, 95):.1f}")
    
    return positions

def run_hdbscan_with_params(positions, min_cluster_size, min_samples, cluster_selection_epsilon=0.0, use_raw_coords=False):
    """Run HDBSCAN with specific parameters."""
    
    if use_raw_coords:
        # Use raw coordinates to preserve density variations
        positions_for_clustering = positions.copy()
        print(f"   📊 Using raw coordinates (preserving density variations)")
    else:
        # Standardize positions (may flatten density variations)
        scaler = StandardScaler()
        positions_for_clustering = scaler.fit_transform(positions)
        print(f"   📊 Using standardized coordinates")
    
    if GPU_AVAILABLE:
        # GPU HDBSCAN
        print(f"   🚀 Running GPU HDBSCAN...")
        positions_cudf = cudf.DataFrame({
            'x': positions_for_clustering[:, 0],
            'y': positions_for_clustering[:, 1]
        })
        
        clusterer = cuHDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            cluster_selection_epsilon=cluster_selection_epsilon
        )
        cluster_labels_cudf = clusterer.fit_predict(positions_cudf)
        cluster_labels = np.array(cluster_labels_cudf.to_arrow().to_pylist())
        
    elif CPU_HDBSCAN_AVAILABLE:
        # CPU HDBSCAN
        print(f"   💻 Running CPU HDBSCAN...")
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            cluster_selection_epsilon=cluster_selection_epsilon
        )
        cluster_labels = clusterer.fit_predict(positions_for_clustering)
    else:
        raise ImportError("Neither GPU nor CPU HDBSCAN available")
    
    return cluster_labels

def create_cluster_visualization(positions, cluster_labels, edges_df, nodes_df, 
                               min_cluster_size, min_samples, cluster_selection_epsilon, 
                               use_raw_coords, stats):
    """Create a visualization of the HDBSCAN cluster assignments."""
    
    coord_type = "raw" if use_raw_coords else "std"
    print(f"   🎨 Creating visualization for min_cluster_size={min_cluster_size}, min_samples={min_samples}, coords={coord_type}")
    
    # Create large high-resolution plot
    fig, ax = plt.subplots(1, 1, figsize=(20, 20))
    fig.patch.set_facecolor('black')
    ax.set_facecolor('black')
    
    # Plot edges (sample for performance)
    edge_sample_size = min(25000, len(edges_df))  # Limit edges for visualization
    if len(edges_df) > 0:
        # Create position lookup
        paper_to_pos = {paper_id: pos for paper_id, pos in zip(nodes_df['paper_id'], positions)}
        
        # Sample edges for visualization
        edges_sample = edges_df.sample(n=edge_sample_size, random_state=42)
        
        for _, edge in edges_sample.iterrows():
            src_pos = paper_to_pos.get(edge['src'])
            dst_pos = paper_to_pos.get(edge['dst'])
            if src_pos is not None and dst_pos is not None:
                ax.plot([src_pos[0], dst_pos[0]], [src_pos[1], dst_pos[1]], 
                       color='gray', alpha=0.005, linewidth=0.1)
    
    # Plot nodes colored by cluster
    unique_clusters = sorted(set(cluster_labels))
    n_clusters = len(unique_clusters) - (1 if -1 in unique_clusters else 0)
    
    # Use a colormap that can handle many clusters
    if n_clusters <= 20:
        colors = plt.cm.tab20(np.linspace(0, 1, 20))
    else:
        colors = plt.cm.hsv(np.linspace(0, 1, n_clusters + 1))
    
    # Plot noise points first (in background)
    if -1 in unique_clusters:
        noise_mask = cluster_labels == -1
        noise_positions = positions[noise_mask]
        ax.scatter(noise_positions[:, 0], noise_positions[:, 1], 
                  c='gray', s=0.1, alpha=0.3, edgecolors='none', label='Noise')
    
    # Plot clusters
    cluster_idx = 0
    for cluster_id in unique_clusters:
        if cluster_id == -1:
            continue  # Already plotted noise
            
        cluster_mask = cluster_labels == cluster_id
        cluster_positions = positions[cluster_mask]
        
        color_idx = cluster_idx % len(colors)
        ax.scatter(cluster_positions[:, 0], cluster_positions[:, 1], 
                  c=[colors[color_idx]], s=1.0, alpha=0.8, edgecolors='none',
                  label=f'Cluster {cluster_id}' if cluster_idx < 15 else None)
        cluster_idx += 1
    
    # Title with parameters and stats
    title = f'ForceAtlas2 (S=3.0, G=0.1, LinLog) + HDBSCAN ({coord_type} coords)\n'
    title += f'min_cluster_size={min_cluster_size}, min_samples={min_samples}\n'
    title += f'{stats["n_clusters"]} clusters, largest: {stats["largest_cluster_ratio"]:.1%}, '
    title += f'noise: {stats["n_noise"]:,} ({stats["noise_ratio"]:.1%}), total: {stats["total_papers"]:,}'
    
    ax.set_title(title, color='white', fontsize=14, fontweight='bold', pad=20)
    
    # Style
    ax.set_xlabel('X Position', color='white', fontsize=12)
    ax.set_ylabel('Y Position', color='white', fontsize=12)
    ax.tick_params(colors='white')
    for spine in ax.spines.values():
        spine.set_color('white')
    
    ax.set_aspect('equal')
    
    # Add legend if not too many clusters
    if n_clusters <= 20:
        ax.legend(loc='upper right', fontsize=8, facecolor='black', edgecolor='white')
    
    # Save with parameter info in filename
    filename = f"fa2_S3.0_G0.1_hdbscan_minsize{min_cluster_size}_minsamp{min_samples}_{coord_type}.png"
    plt.tight_layout()
    plt.savefig(filename, dpi=300, bbox_inches='tight', facecolor='black')
    plt.close()
    
    print(f"   ✅ Saved: {filename}")
    return filename

def analyze_clustering_results(cluster_labels):
    """Analyze HDBSCAN clustering results and return statistics."""
    
    n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
    n_noise = int(np.sum(cluster_labels == -1))
    total_papers = len(cluster_labels)
    noise_ratio = n_noise / total_papers
    
    if n_clusters > 0:
        cluster_sizes = Counter(cluster_labels)
        if -1 in cluster_sizes:
            del cluster_sizes[-1]  # Remove noise from size calculation
        largest_cluster_size = max(cluster_sizes.values()) if cluster_sizes else 0
        largest_cluster_ratio = largest_cluster_size / total_papers
        
        # Get top 5 cluster sizes
        top_clusters = cluster_sizes.most_common(5)
    else:
        largest_cluster_ratio = 0
        top_clusters = []
    
    return {
        'total_papers': total_papers,
        'n_clusters': n_clusters,
        'largest_cluster_size': largest_cluster_size if n_clusters > 0 else 0,
        'largest_cluster_ratio': largest_cluster_ratio,
        'n_noise': n_noise,
        'noise_ratio': noise_ratio,
        'top_clusters': top_clusters
    }

def main():
    """Test different HDBSCAN parameters on FA2 results and visualize."""
    
    if not GPU_AVAILABLE and not CPU_HDBSCAN_AVAILABLE:
        print("❌ Neither GPU nor CPU HDBSCAN available")
        print("💡 Install with: pip install hdbscan")
        return
    
    print("🚀 ForceAtlas2 (S=3.0, G=0.1) + HDBSCAN Variable Density Clustering")
    print("=" * 80)
    
    # Create migrator and load data
    migrator = PhysicsClusteringMigrator(use_gpu=GPU_AVAILABLE)
    nodes_df, edges_df = migrator.load_citation_network()
    
    print(f"📊 Loaded {len(nodes_df):,} nodes, {len(edges_df):,} edges")
    
    # Run ForceAtlas2 with fixed good parameters
    positions = run_fa2_fixed_params(migrator, nodes_df, edges_df)
    
    # Test different HDBSCAN parameter combinations
    hdbscan_params = [
        # (min_cluster_size, min_samples, cluster_selection_epsilon, use_raw_coords)
        (100, 10, 0.0, True),   # Small clusters, raw coords
        (150, 15, 0.0, True),   # Medium clusters, raw coords  
        (200, 20, 0.0, True),   # Larger clusters, raw coords
        (300, 30, 0.0, True),   # Large clusters, raw coords
        (150, 10, 0.0, True),   # Medium clusters, fewer samples, raw coords
        (100, 5, 0.0, True),    # Small clusters, very few samples, raw coords
        (150, 15, 0.0, False),  # Medium clusters, standardized coords (for comparison)
        (200, 15, 0.0, True),   # Medium-large clusters, raw coords
        (250, 25, 0.0, True),   # Large clusters, raw coords
        (100, 15, 0.0, True),   # Small clusters, more samples, raw coords
    ]
    
    print(f"\n🔍 Testing {len(hdbscan_params)} HDBSCAN parameter combinations")
    
    results = []
    visualization_files = []
    
    for i, (min_cluster_size, min_samples, cluster_selection_epsilon, use_raw_coords) in enumerate(hdbscan_params):
        coord_type = "raw" if use_raw_coords else "std"
        print(f"\n📸 [{i+1}/{len(hdbscan_params)}] Testing min_cluster_size={min_cluster_size}, min_samples={min_samples}, coords={coord_type}")
        
        try:
            # Run HDBSCAN
            cluster_labels = run_hdbscan_with_params(
                positions, min_cluster_size, min_samples, 
                cluster_selection_epsilon, use_raw_coords
            )
            
            # Analyze results
            stats = analyze_clustering_results(cluster_labels)
            
            print(f"   📊 Results: {stats['n_clusters']} clusters, largest: {stats['largest_cluster_ratio']:.1%}, noise: {stats['n_noise']:,} ({stats['noise_ratio']:.1%})")
            
            # Show top clusters
            if stats['top_clusters']:
                top_str = ", ".join([f"{size}" for _, size in stats['top_clusters'][:3]])
                print(f"   📊 Top cluster sizes: {top_str}")
            
            # Create visualization
            filename = create_cluster_visualization(
                positions, cluster_labels, edges_df, nodes_df, 
                min_cluster_size, min_samples, cluster_selection_epsilon, 
                use_raw_coords, stats
            )
            visualization_files.append(filename)
            
            # Store results
            results.append({
                'min_cluster_size': min_cluster_size,
                'min_samples': min_samples,
                'cluster_selection_epsilon': cluster_selection_epsilon,
                'use_raw_coords': use_raw_coords,
                'filename': filename,
                **stats
            })
            
        except Exception as e:
            print(f"   ❌ Failed: {e}")
            continue
    
    # Print summary
    print(f"\n🏆 HDBSCAN Results Summary:")
    print("=" * 110)
    print(f"{'min_size':<9} {'min_samp':<9} {'coords':<6} {'clusters':<9} {'largest %':<10} {'noise %':<8} {'top_sizes':<20} {'filename'}")
    print("-" * 110)
    
    for result in results:
        coord_type = "raw" if result['use_raw_coords'] else "std"
        top_sizes = ", ".join([str(size) for _, size in result['top_clusters'][:3]])
        print(f"{result['min_cluster_size']:<9d} {result['min_samples']:<9d} {coord_type:<6} {result['n_clusters']:<9d} "
              f"{result['largest_cluster_ratio']:<9.1%} {result['noise_ratio']:<7.1%} "
              f"{top_sizes:<20} {result['filename']}")
    
    # Recommend best parameters
    if results:
        # Sort by: prefer moderate cluster counts, low largest cluster ratio, reasonable noise
        def score_result(r):
            cluster_score = abs(r['n_clusters'] - 15)  # Prefer ~15 clusters
            dominance_penalty = r['largest_cluster_ratio'] * 100  # Penalize dominant clusters
            noise_penalty = max(0, r['noise_ratio'] - 0.2) * 30  # Penalize >20% noise (HDBSCAN can handle more noise)
            raw_coords_bonus = -5 if r['use_raw_coords'] else 0  # Prefer raw coordinates
            return cluster_score + dominance_penalty + noise_penalty + raw_coords_bonus
        
        best_result = min(results, key=score_result)
        
        print(f"\n🎯 Recommended HDBSCAN parameters:")
        print(f"   min_cluster_size = {best_result['min_cluster_size']}")
        print(f"   min_samples = {best_result['min_samples']}")
        print(f"   use_raw_coords = {best_result['use_raw_coords']}")
        print(f"   Expected: {best_result['n_clusters']} clusters, {best_result['largest_cluster_ratio']:.1%} in largest")
        print(f"   Visualization: {best_result['filename']}")
    
    print(f"\n✅ Generated {len(visualization_files)} HDBSCAN cluster visualizations!")
    print("💡 Check the PNG files to see how HDBSCAN handles variable density")
    print("🔥 Raw coordinates should show better separation of central communities!")

if __name__ == "__main__":
    main() 