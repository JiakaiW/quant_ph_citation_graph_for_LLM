#!/usr/bin/env python3
"""
🚀 GPU Physics-Based Clustering using ForceAtlas2 + DBSCAN

Industrial-strength solution for large-scale citation network clustering:
1. ForceAtlas2 layout computation on GPU using RAPIDS cuGraph
2. DBSCAN clustering on the resulting 2D positions
3. Direct integration with existing database structure

This replaces the Node2Vec → UMAP → KMeans pipeline with a physics-based approach
that preserves citation network structure and creates scientifically meaningful clusters.
"""

import time
import numpy as np
import pandas as pd
import sqlite3
from typing import Dict, List, Tuple, Optional
import logging
from pathlib import Path
import json

# GPU acceleration imports
try:
    import cudf
    import cugraph
    import cuml
    from cuml import DBSCAN as cuDBSCAN
    GPU_AVAILABLE = True
    print("🚀 GPU acceleration available (RAPIDS)")
except ImportError:
    GPU_AVAILABLE = False
    print("⚠️  GPU acceleration not available, falling back to CPU")
    import networkx as nx
    from sklearn.cluster import DBSCAN
    from sklearn.preprocessing import StandardScaler

# Local imports
from data_loader import save_results_to_db

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GPUPhysicsClusterer:
    """
    GPU-accelerated physics-based clustering using ForceAtlas2 + DBSCAN.
    
    This class implements the hybrid approach:
    1. ForceAtlas2 for spatial layout (GPU-accelerated)
    2. DBSCAN for cluster detection in 2D space
    3. Direct database integration
    """
    
    def __init__(self, 
                 db_path: str = "../../data/arxiv_papers.db",
                 fa2_iterations: int = 1000,
                 fa2_edge_weight_influence: float = 1.0,
                 fa2_jitter_tolerance: float = 1.0,
                 fa2_barnes_hut_optimize: bool = True,
                 fa2_barnes_hut_theta: float = 0.5,
                 fa2_scaling_ratio: float = 2.0,
                 fa2_strong_gravity_mode: bool = False,
                 fa2_gravity: float = 1.0,
                 dbscan_eps: float = 0.5,
                 dbscan_min_samples: int = 5,
                 use_gpu: bool = True):
        """
        Initialize the GPU physics clusterer.
        
        Args:
            db_path: Path to the SQLite database
            fa2_iterations: Number of ForceAtlas2 iterations
            fa2_edge_weight_influence: How much edge weights influence layout
            fa2_jitter_tolerance: Tolerance for position jitter
            fa2_barnes_hut_optimize: Use Barnes-Hut optimization
            fa2_barnes_hut_theta: Barnes-Hut theta parameter
            fa2_scaling_ratio: Scaling ratio for forces
            fa2_strong_gravity_mode: Use strong gravity mode
            fa2_gravity: Gravity strength
            dbscan_eps: DBSCAN epsilon parameter (clustering radius)
            dbscan_min_samples: DBSCAN minimum samples per cluster
            use_gpu: Whether to use GPU acceleration
        """
        self.db_path = db_path
        self.use_gpu = use_gpu and GPU_AVAILABLE
        
        # ForceAtlas2 parameters
        self.fa2_params = {
            'max_iter': fa2_iterations,
            'edge_weight_influence': fa2_edge_weight_influence,
            'jitter_tolerance': fa2_jitter_tolerance,
            'barnes_hut_optimize': fa2_barnes_hut_optimize,
            'barnes_hut_theta': fa2_barnes_hut_theta,
            'scaling_ratio': fa2_scaling_ratio,
            'strong_gravity_mode': fa2_strong_gravity_mode,
            'gravity': fa2_gravity,
            'outbound_attraction_distribution': True,  # Better for citation networks
            'lin_log_mode': False,  # Linear mode for better cluster separation
            'prevent_overlapping': True,  # Prevent node overlap
            'verbose': True
        }
        
        # DBSCAN parameters
        self.dbscan_params = {
            'eps': dbscan_eps,
            'min_samples': dbscan_min_samples
        }
        
        logger.info(f"🚀 Initialized GPU Physics Clusterer (GPU: {self.use_gpu})")
        logger.info(f"   ForceAtlas2 iterations: {fa2_iterations}")
        logger.info(f"   DBSCAN eps: {dbscan_eps}, min_samples: {dbscan_min_samples}")
    
    def load_citation_network(self) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        Load the citation network from the database.
        
        Returns:
            Tuple of (nodes_df, edges_df) where:
            - nodes_df: DataFrame with paper_id, title, year columns
            - edges_df: DataFrame with src, dst columns
        """
        logger.info("📊 Loading citation network from database...")
        
        conn = sqlite3.connect(self.db_path)
        
        # Load nodes (papers)
        nodes_query = """
            SELECT paper_id, title, year
            FROM filtered_papers
            ORDER BY paper_id
        """
        nodes_df = pd.read_sql_query(nodes_query, conn)
        
        # Load edges (citations)
        edges_query = """
            SELECT src, dst
            FROM filtered_citations
        """
        edges_df = pd.read_sql_query(edges_query, conn)
        
        conn.close()
        
        logger.info(f"📊 Loaded {len(nodes_df):,} nodes and {len(edges_df):,} edges")
        return nodes_df, edges_df
    
    def compute_forceatlas2_layout_gpu(self, nodes_df: pd.DataFrame, edges_df: pd.DataFrame) -> np.ndarray:
        """
        Compute ForceAtlas2 layout using GPU acceleration.
        
        Args:
            nodes_df: DataFrame with node information
            edges_df: DataFrame with edge information
            
        Returns:
            2D numpy array of positions (n_nodes, 2)
        """
        if not self.use_gpu:
            return self.compute_forceatlas2_layout_cpu(nodes_df, edges_df)
        
        logger.info("🚀 Computing ForceAtlas2 layout on GPU...")
        start_time = time.time()
        
        try:
            # Convert to cuDF for GPU processing
            nodes_cudf = cudf.from_pandas(nodes_df)
            edges_cudf = cudf.from_pandas(edges_df)
            
            # Create cuGraph
            G = cugraph.Graph(directed=True)
            G.from_cudf_edgelist(edges_cudf, source='src', destination='dst')
            
            logger.info(f"📊 Created cuGraph with {G.number_of_vertices():,} vertices and {G.number_of_edges():,} edges")
            
            # Run ForceAtlas2
            logger.info("🔥 Running ForceAtlas2 algorithm...")
            positions_cudf = cugraph.force_atlas2(G, **self.fa2_params)
            
            # Convert back to numpy
            positions = positions_cudf[['x', 'y']].to_pandas().values
            
            elapsed = time.time() - start_time
            logger.info(f"✅ ForceAtlas2 completed in {elapsed:.2f} seconds")
            
            return positions
            
        except Exception as e:
            logger.error(f"❌ GPU ForceAtlas2 failed: {e}")
            logger.info("🔄 Falling back to CPU implementation...")
            return self.compute_forceatlas2_layout_cpu(nodes_df, edges_df)
    
    def compute_forceatlas2_layout_cpu(self, nodes_df: pd.DataFrame, edges_df: pd.DataFrame) -> np.ndarray:
        """
        Fallback CPU implementation using NetworkX + fa2.
        
        Args:
            nodes_df: DataFrame with node information
            edges_df: DataFrame with edge information
            
        Returns:
            2D numpy array of positions (n_nodes, 2)
        """
        logger.info("💻 Computing ForceAtlas2 layout on CPU (fallback)...")
        start_time = time.time()
        
        try:
            # Try to import fa2 for CPU ForceAtlas2
            from fa2 import ForceAtlas2
            
            # Create NetworkX graph
            G = nx.from_pandas_edgelist(edges_df, source='src', target='dst', create_using=nx.DiGraph())
            
            # Add isolated nodes
            all_nodes = set(nodes_df['paper_id'])
            graph_nodes = set(G.nodes())
            isolated_nodes = all_nodes - graph_nodes
            G.add_nodes_from(isolated_nodes)
            
            logger.info(f"📊 Created NetworkX graph with {G.number_of_nodes():,} nodes and {G.number_of_edges():,} edges")
            
            # Run ForceAtlas2
            forceatlas2 = ForceAtlas2(
                outboundAttractionDistribution=True,
                linLogMode=False,
                adjustSizes=False,
                edgeWeightInfluence=self.fa2_params['edge_weight_influence'],
                jitterTolerance=self.fa2_params['jitter_tolerance'],
                barnesHutOptimize=self.fa2_params['barnes_hut_optimize'],
                barnesHutTheta=self.fa2_params['barnes_hut_theta'],
                scalingRatio=self.fa2_params['scaling_ratio'],
                strongGravityMode=self.fa2_params['strong_gravity_mode'],
                gravity=self.fa2_params['gravity'],
                verbose=True
            )
            
            logger.info("🔥 Running ForceAtlas2 algorithm...")
            positions_dict = forceatlas2.forceatlas2_networkx_layout(G, iterations=self.fa2_params['max_iter'])
            
            # Convert to numpy array in the same order as nodes_df
            positions = np.array([[positions_dict[node_id][0], positions_dict[node_id][1]] 
                                 for node_id in nodes_df['paper_id']])
            
            elapsed = time.time() - start_time
            logger.info(f"✅ CPU ForceAtlas2 completed in {elapsed:.2f} seconds")
            
            return positions
            
        except ImportError:
            logger.error("❌ fa2 package not available for CPU ForceAtlas2")
            logger.info("💡 Install with: pip install fa2")
            # Fallback to random positions
            return self.generate_random_positions(len(nodes_df))
        except Exception as e:
            logger.error(f"❌ CPU ForceAtlas2 failed: {e}")
            return self.generate_random_positions(len(nodes_df))
    
    def generate_random_positions(self, n_nodes: int) -> np.ndarray:
        """
        Generate random positions as a last resort fallback.
        
        Args:
            n_nodes: Number of nodes
            
        Returns:
            2D numpy array of random positions
        """
        logger.warning("⚠️  Using random positions (ForceAtlas2 failed)")
        np.random.seed(42)  # Reproducible results
        return np.random.randn(n_nodes, 2) * 10
    
    def cluster_positions_gpu(self, positions: np.ndarray) -> np.ndarray:
        """
        Perform DBSCAN clustering on 2D positions using GPU.
        
        Args:
            positions: 2D positions array
            
        Returns:
            Array of cluster labels
        """
        if not self.use_gpu:
            return self.cluster_positions_cpu(positions)
        
        logger.info("🚀 Performing DBSCAN clustering on GPU...")
        start_time = time.time()
        
        try:
            # Standardize positions for better clustering
            positions_cudf = cudf.DataFrame({
                'x': positions[:, 0],
                'y': positions[:, 1]
            })
            
            # GPU DBSCAN
            dbscan = cuDBSCAN(**self.dbscan_params)
            cluster_labels = dbscan.fit_predict(positions_cudf)
            
            # Convert to numpy
            cluster_labels = cluster_labels.to_pandas().values
            
            elapsed = time.time() - start_time
            n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
            n_noise = list(cluster_labels).count(-1)
            
            logger.info(f"✅ GPU DBSCAN completed in {elapsed:.2f} seconds")
            logger.info(f"📊 Found {n_clusters} clusters, {n_noise} noise points")
            
            return cluster_labels
            
        except Exception as e:
            logger.error(f"❌ GPU DBSCAN failed: {e}")
            logger.info("🔄 Falling back to CPU DBSCAN...")
            return self.cluster_positions_cpu(positions)
    
    def cluster_positions_cpu(self, positions: np.ndarray) -> np.ndarray:
        """
        Fallback CPU DBSCAN clustering.
        
        Args:
            positions: 2D positions array
            
        Returns:
            Array of cluster labels
        """
        logger.info("💻 Performing DBSCAN clustering on CPU...")
        start_time = time.time()
        
        # Standardize positions
        scaler = StandardScaler()
        positions_scaled = scaler.fit_transform(positions)
        
        # CPU DBSCAN
        dbscan = DBSCAN(**self.dbscan_params)
        cluster_labels = dbscan.fit_predict(positions_scaled)
        
        elapsed = time.time() - start_time
        n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
        n_noise = list(cluster_labels).count(-1)
        
        logger.info(f"✅ CPU DBSCAN completed in {elapsed:.2f} seconds")
        logger.info(f"📊 Found {n_clusters} clusters, {n_noise} noise points")
        
        return cluster_labels
    
    def run_full_pipeline(self, debug_mode: bool = False, max_papers: Optional[int] = None) -> bool:
        """
        Run the complete GPU physics-based clustering pipeline.
        
        Args:
            debug_mode: If True, run on a subset for testing
            max_papers: Maximum number of papers to process (for debugging)
            
        Returns:
            True if successful, False otherwise
        """
        logger.info("🚀 Starting GPU Physics-Based Clustering Pipeline")
        logger.info("=" * 60)
        
        total_start_time = time.time()
        
        try:
            # Step 1: Load data
            nodes_df, edges_df = self.load_citation_network()
            
            # Debug mode: limit dataset size
            if debug_mode or max_papers:
                limit = max_papers or 5000
                logger.info(f"🧪 Debug mode: limiting to {limit} papers")
                nodes_df = nodes_df.head(limit)
                node_set = set(nodes_df['paper_id'])
                edges_df = edges_df[
                    edges_df['src'].isin(node_set) & 
                    edges_df['dst'].isin(node_set)
                ]
                logger.info(f"📊 Debug dataset: {len(nodes_df)} nodes, {len(edges_df)} edges")
            
            # Step 2: Compute ForceAtlas2 layout
            positions = self.compute_forceatlas2_layout_gpu(nodes_df, edges_df)
            
            # Step 3: Cluster positions with DBSCAN
            cluster_labels = self.cluster_positions_gpu(positions)
            
            # Step 4: Post-process results
            # Handle noise points (-1 labels) by assigning them to singleton clusters
            max_cluster_id = max(cluster_labels) if len(cluster_labels) > 0 else -1
            noise_mask = cluster_labels == -1
            n_noise = np.sum(noise_mask)
            
            if n_noise > 0:
                logger.info(f"🔧 Assigning {n_noise} noise points to singleton clusters...")
                # Assign unique cluster IDs to noise points
                noise_cluster_ids = np.arange(max_cluster_id + 1, max_cluster_id + 1 + n_noise)
                cluster_labels[noise_mask] = noise_cluster_ids
            
            # Step 5: Save results to database
            logger.info("💾 Saving results to database...")
            paper_ids = nodes_df['paper_id'].tolist()
            success = save_results_to_db(paper_ids, positions, cluster_labels)
            
            if success:
                total_elapsed = time.time() - total_start_time
                logger.info("🎉 GPU Physics-Based Clustering Pipeline Complete!")
                logger.info(f"⏱️  Total time: {total_elapsed:.2f} seconds")
                logger.info(f"📊 Processed {len(paper_ids):,} papers")
                logger.info(f"📊 Generated {len(set(cluster_labels))} clusters")
                
                # Print cluster size distribution
                cluster_sizes = pd.Series(cluster_labels).value_counts().sort_index()
                logger.info("📊 Cluster size distribution:")
                for cluster_id, size in cluster_sizes.head(10).items():
                    logger.info(f"   Cluster {cluster_id}: {size:,} papers")
                
                if len(cluster_sizes) > 10:
                    logger.info(f"   ... and {len(cluster_sizes) - 10} more clusters")
                
                return True
            else:
                logger.error("❌ Failed to save results to database")
                return False
                
        except Exception as e:
            logger.error(f"❌ Pipeline failed: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def validate_clustering_quality(self) -> Dict:
        """
        Validate the quality of the clustering results.
        
        Returns:
            Dictionary with quality metrics
        """
        logger.info("📊 Validating clustering quality...")
        
        conn = sqlite3.connect(self.db_path)
        
        # Load clustering results
        results_query = """
            SELECT fp.paper_id, fp.cluster_id, fp.embedding_x, fp.embedding_y
            FROM filtered_papers fp
            WHERE fp.cluster_id IS NOT NULL
            AND fp.embedding_x IS NOT NULL
            AND fp.embedding_y IS NOT NULL
        """
        results_df = pd.read_sql_query(results_query, conn)
        
        # Load citation network
        citations_query = """
            SELECT src, dst FROM filtered_citations
        """
        citations_df = pd.read_sql_query(citations_query, conn)
        
        conn.close()
        
        if len(results_df) == 0:
            return {"error": "No clustering results found"}
        
        # Calculate intra-cluster citation density
        paper_to_cluster = dict(zip(results_df['paper_id'], results_df['cluster_id']))
        
        intra_cluster_citations = 0
        inter_cluster_citations = 0
        
        for _, row in citations_df.iterrows():
            src_cluster = paper_to_cluster.get(row['src'])
            dst_cluster = paper_to_cluster.get(row['dst'])
            
            if src_cluster is not None and dst_cluster is not None:
                if src_cluster == dst_cluster:
                    intra_cluster_citations += 1
                else:
                    inter_cluster_citations += 1
        
        total_citations = intra_cluster_citations + inter_cluster_citations
        intra_density = intra_cluster_citations / total_citations if total_citations > 0 else 0
        
        # Calculate cluster statistics
        cluster_sizes = results_df['cluster_id'].value_counts()
        
        metrics = {
            'total_papers': len(results_df),
            'total_clusters': len(cluster_sizes),
            'intra_cluster_citation_density': intra_density,
            'inter_cluster_citation_density': 1 - intra_density,
            'average_cluster_size': float(cluster_sizes.mean()),
            'median_cluster_size': float(cluster_sizes.median()),
            'largest_cluster_size': int(cluster_sizes.max()),
            'smallest_cluster_size': int(cluster_sizes.min()),
            'cluster_size_std': float(cluster_sizes.std())
        }
        
        logger.info("📊 Clustering Quality Metrics:")
        logger.info(f"   Intra-cluster citation density: {metrics['intra_cluster_citation_density']:.3f}")
        logger.info(f"   Average cluster size: {metrics['average_cluster_size']:.1f}")
        logger.info(f"   Total clusters: {metrics['total_clusters']}")
        
        return metrics


def main():
    """
    Main function to run the GPU physics-based clustering pipeline.
    """
    import argparse
    
    parser = argparse.ArgumentParser(description="GPU Physics-Based Clustering for Citation Networks")
    parser.add_argument("--debug", action="store_true", help="Run in debug mode with limited dataset")
    parser.add_argument("--max-papers", type=int, help="Maximum number of papers to process")
    parser.add_argument("--fa2-iterations", type=int, default=1000, help="ForceAtlas2 iterations")
    parser.add_argument("--dbscan-eps", type=float, default=0.5, help="DBSCAN epsilon parameter")
    parser.add_argument("--dbscan-min-samples", type=int, default=5, help="DBSCAN min samples")
    parser.add_argument("--no-gpu", action="store_true", help="Disable GPU acceleration")
    parser.add_argument("--validate", action="store_true", help="Validate clustering quality")
    
    args = parser.parse_args()
    
    # Initialize clusterer
    clusterer = GPUPhysicsClusterer(
        fa2_iterations=args.fa2_iterations,
        dbscan_eps=args.dbscan_eps,
        dbscan_min_samples=args.dbscan_min_samples,
        use_gpu=not args.no_gpu
    )
    
    if args.validate:
        # Just validate existing results
        metrics = clusterer.validate_clustering_quality()
        print("\n📊 Clustering Quality Report:")
        print("=" * 40)
        for key, value in metrics.items():
            if isinstance(value, float):
                print(f"{key}: {value:.3f}")
            else:
                print(f"{key}: {value}")
    else:
        # Run full pipeline
        success = clusterer.run_full_pipeline(
            debug_mode=args.debug,
            max_papers=args.max_papers
        )
        
        if success:
            print("\n🎉 Success! Physics-based clustering complete.")
            print("💡 Next steps:")
            print("   1. Check results with: python gpu_physics_clustering.py --validate")
            print("   2. Update frontend visualization")
            print("   3. Compare with previous clustering results")
        else:
            print("\n❌ Clustering failed. Check logs for details.")
            exit(1)


if __name__ == "__main__":
    main() 