#!/usr/bin/env python3
"""
Analyze and visualize the precise elbow method results.
"""

import numpy as np
import matplotlib.pyplot as plt
from kneed import KneeLocator

def analyze_elbow_results():
    """Analyze the precise elbow results and create visualizations."""
    
    # Check if results are ready
    try:
        results = np.load('elbow_search_k10-100_papers60534.npy')
        k_values, inertias = results[0], results[1]
        print(f"✅ Loaded precise elbow results: {len(k_values)} k values tested")
    except FileNotFoundError:
        print("❌ Elbow results not found. Run the elbow analysis first.")
        return
    
    # Find the optimal k using KneeLocator
    kneedle = KneeLocator(k_values, inertias, curve="convex", direction="decreasing")
    optimal_k = kneedle.elbow
    
    if optimal_k is None:
        optimal_k = k_values[len(k_values) // 2]
        print(f"⚠️  No clear elbow found, using middle value k={optimal_k}")
    else:
        print(f"📈 Optimal k found: {optimal_k}")
    
    # Create detailed analysis
    print(f"\n📊 Detailed Analysis:")
    print(f"   K range tested: {int(min(k_values))} to {int(max(k_values))}")
    print(f"   Total k values: {len(k_values)}")
    print(f"   Optimal k: {optimal_k}")
    
    # Find inertia at key points
    k_list = k_values.tolist()
    optimal_idx = k_list.index(optimal_k)
    
    print(f"\n📈 Inertia Analysis:")
    print(f"   Inertia at k={optimal_k}: {inertias[optimal_idx]:.0f}")
    
    # Compare with common values
    common_k_values = [20, 30, 50, 72, 80, 100]
    for k in common_k_values:
        if k in k_list:
            idx = k_list.index(k)
            improvement = (inertias[idx] - inertias[optimal_idx]) / inertias[idx] * 100
            print(f"   k={k}: {inertias[idx]:.0f} ({improvement:+.1f}% vs optimal)")
    
    # Create visualization
    plt.figure(figsize=(12, 8))
    
    # Main elbow plot
    plt.subplot(2, 1, 1)
    plt.plot(k_values, inertias, 'b-', linewidth=1, alpha=0.7)
    plt.scatter(k_values, inertias, c='blue', s=20, alpha=0.6)
    plt.axvline(x=optimal_k, color='red', linestyle='--', linewidth=2, 
                label=f'Optimal k={optimal_k} (elbow)')
    plt.axvline(x=72, color='orange', linestyle='--', linewidth=2, 
                label='Previous hard-coded k=72')
    plt.xlabel('Number of Clusters (k)')
    plt.ylabel('Inertia (Within-cluster Sum of Squares)')
    plt.title('Precise K-means Elbow Method Analysis\n60,534 Papers with 128D Embeddings')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Zoomed view around the elbow
    plt.subplot(2, 1, 2)
    zoom_start = max(10, optimal_k - 20)
    zoom_end = min(100, optimal_k + 20)
    zoom_mask = (k_values >= zoom_start) & (k_values <= zoom_end)
    
    plt.plot(k_values[zoom_mask], inertias[zoom_mask], 'b-', linewidth=2)
    plt.scatter(k_values[zoom_mask], inertias[zoom_mask], c='blue', s=30)
    plt.axvline(x=optimal_k, color='red', linestyle='--', linewidth=2, 
                label=f'Optimal k={optimal_k}')
    plt.xlabel('Number of Clusters (k)')
    plt.ylabel('Inertia')
    plt.title(f'Zoomed View: k={zoom_start} to k={zoom_end}')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig('precise_elbow_analysis.png', dpi=150, bbox_inches='tight')
    print(f"\n💾 Visualization saved as 'precise_elbow_analysis.png'")
    
    # Calculate rate of change to show elbow more clearly
    rate_of_change = np.diff(inertias)
    
    plt.figure(figsize=(10, 6))
    plt.plot(k_values[1:], -rate_of_change, 'g-', linewidth=2)
    plt.axvline(x=optimal_k, color='red', linestyle='--', linewidth=2, 
                label=f'Optimal k={optimal_k}')
    plt.xlabel('Number of Clusters (k)')
    plt.ylabel('Rate of Inertia Decrease')
    plt.title('Rate of Inertia Decrease (Elbow Detection)')
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.savefig('elbow_rate_of_change.png', dpi=150, bbox_inches='tight')
    print(f"💾 Rate of change plot saved as 'elbow_rate_of_change.png'")
    
    return optimal_k, k_values, inertias

if __name__ == "__main__":
    analyze_elbow_results() 