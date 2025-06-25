#!/usr/bin/env python3
"""
🧪 Test Script for GPU Physics-Based Clustering

Quick validation script to test the GPU physics clustering implementation
on a small subset of data before running on the full 70K dataset.
"""

import sys
import time
import sqlite3
import pandas as pd
from gpu_physics_clustering import GPUPhysicsClusterer

def test_database_connection():
    """Test if database is accessible and has required tables."""
    print("🔍 Testing database connection...")
    
    try:
        conn = sqlite3.connect("../../data/arxiv_papers.db")
        
        # Check required tables exist
        tables = ['filtered_papers', 'filtered_citations']
        for table in tables:
            result = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            count = result[0] if result else 0
            print(f"   📊 {table}: {count:,} records")
            
            if count == 0:
                print(f"   ❌ {table} is empty!")
                return False
        
        conn.close()
        print("   ✅ Database connection successful")
        return True
        
    except Exception as e:
        print(f"   ❌ Database connection failed: {e}")
        return False

def test_gpu_availability():
    """Test if GPU acceleration is available."""
    print("\n🚀 Testing GPU availability...")
    
    try:
        import cudf, cugraph, cuml
        print("   ✅ RAPIDS GPU libraries available")
        return True
    except ImportError as e:
        print(f"   ⚠️  RAPIDS not available: {e}")
        print("   💡 Will use CPU fallback")
        return False

def test_cpu_fallback():
    """Test if CPU fallback dependencies are available."""
    print("\n💻 Testing CPU fallback dependencies...")
    
    try:
        import networkx
        print("   ✅ NetworkX available")
    except ImportError:
        print("   ❌ NetworkX not available")
        return False
    
    try:
        from sklearn.cluster import DBSCAN
        print("   ✅ scikit-learn DBSCAN available")
    except ImportError:
        print("   ❌ scikit-learn not available")
        return False
    
    try:
        from fa2 import ForceAtlas2
        print("   ✅ fa2 ForceAtlas2 available")
    except ImportError:
        print("   ⚠️  fa2 not available (will use random positions)")
        print("   💡 Install with: pip install fa2")
    
    return True

def run_mini_test():
    """Run clustering on a tiny dataset (100 papers) to test functionality."""
    print("\n🧪 Running mini test (100 papers)...")
    
    try:
        # Initialize clusterer with relaxed parameters for small dataset
        clusterer = GPUPhysicsClusterer(
            fa2_iterations=100,  # Fewer iterations for speed
            dbscan_eps=1.0,      # Larger epsilon for small dataset
            dbscan_min_samples=2, # Smaller min samples
            use_gpu=True
        )
        
        # Run on very small subset
        start_time = time.time()
        success = clusterer.run_full_pipeline(debug_mode=True, max_papers=100)
        elapsed = time.time() - start_time
        
        if success:
            print(f"   ✅ Mini test completed in {elapsed:.2f} seconds")
            
            # Validate results
            metrics = clusterer.validate_clustering_quality()
            if 'error' not in metrics:
                print(f"   📊 Found {metrics['total_clusters']} clusters")
                print(f"   📊 Intra-cluster citation density: {metrics['intra_cluster_citation_density']:.3f}")
                return True
            else:
                print(f"   ⚠️  Validation failed: {metrics['error']}")
                return False
        else:
            print("   ❌ Mini test failed")
            return False
            
    except Exception as e:
        print(f"   ❌ Mini test error: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_parameter_validation():
    """Test parameter validation and edge cases."""
    print("\n⚙️ Testing parameter validation...")
    
    try:
        # Test with various parameter combinations
        test_configs = [
            {"fa2_iterations": 50, "dbscan_eps": 0.1, "dbscan_min_samples": 2},
            {"fa2_iterations": 200, "dbscan_eps": 2.0, "dbscan_min_samples": 10},
        ]
        
        for i, config in enumerate(test_configs):
            clusterer = GPUPhysicsClusterer(**config, use_gpu=False)  # Force CPU for speed
            print(f"   ✅ Config {i+1}: {config}")
        
        print("   ✅ Parameter validation passed")
        return True
        
    except Exception as e:
        print(f"   ❌ Parameter validation failed: {e}")
        return False

def main():
    """Run all tests."""
    print("🧪 GPU Physics Clustering Test Suite")
    print("=" * 50)
    
    tests = [
        ("Database Connection", test_database_connection),
        ("GPU Availability", test_gpu_availability),
        ("CPU Fallback", test_cpu_fallback),
        ("Parameter Validation", test_parameter_validation),
        ("Mini Test", run_mini_test),
    ]
    
    passed = 0
    failed = 0
    
    for test_name, test_func in tests:
        try:
            if test_func():
                passed += 1
                status = "✅ PASSED"
            else:
                failed += 1
                status = "❌ FAILED"
        except Exception as e:
            failed += 1
            status = f"❌ ERROR: {e}"
        
        print(f"\n{test_name}: {status}")
    
    print("\n" + "=" * 50)
    print(f"🧪 Test Results: {passed} passed, {failed} failed")
    
    if failed == 0:
        print("\n🎉 All tests passed! Ready to run full clustering.")
        print("\n💡 Next steps:")
        print("   1. Run debug mode: python gpu_physics_clustering.py --debug")
        print("   2. Run full pipeline: python gpu_physics_clustering.py")
    else:
        print(f"\n⚠️  {failed} tests failed. Please fix issues before proceeding.")
        
        if failed > 0:
            print("\n🔧 Common fixes:")
            print("   - Install RAPIDS: conda install -c rapidsai rapids")
            print("   - Install CPU deps: pip install networkx scikit-learn fa2")
            print("   - Check database path: ../../data/arxiv_papers.db")
    
    return failed == 0

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 