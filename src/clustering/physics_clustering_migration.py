#!/usr/bin/env python3
"""
🚀 Physics-Based Clustering Migration Script

This script creates a new table called 'physics_clustering' by copying the 'filtered_papers' table,
then applies ForceAtlas2 + DBSCAN clustering to migrate from the current Node2Vec+UMAP+KMeans approach.

The new table will contain:
- All original paper data from filtered_papers
- Updated embedding_x, embedding_y coordinates from ForceAtlas2
- Updated cluster_id from DBSCAN clustering
- Preserved all other metadata

This allows us to compare the old and new clustering approaches side by side.
"""

import time
import numpy as np
import pandas as pd
import sqlite3
from typing import Dict, List, Tuple, Optional
import logging
from pathlib import Path
import json
from collections import Counter

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

# CPU fallback imports
import networkx as nx
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler

# ForceAtlas2 CPU implementations
try:
    import igraph as ig
    IGRAPH_AVAILABLE = True
    print("✅ igraph available for CPU ForceAtlas2")
except ImportError:
    IGRAPH_AVAILABLE = False
    print("⚠️  igraph not available")

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

class PhysicsClusteringMigrator:
    """
    Migrates from Node2Vec+UMAP+KMeans to ForceAtlas2+HDBSCAN clustering
    by creating a new table with physics-based results.
    
    Uses:
    - ForceAtlas2 with LinLog mode for community-aware layout (scaling=3.0, gravity=0.1)
    - HDBSCAN with raw coordinates for variable density clustering (min_cluster_size=100, min_samples=5)
    
    This approach handles the nested density structure of citation networks much better
    than the global epsilon assumption of DBSCAN.
    """
    
    def __init__(self, 
                 db_path: str = "../../data/arxiv_papers.db",
                 fa2_max_iterations: int = 2000,
                 fa2_convergence_threshold: float = 0.01,
                 fa2_check_interval: int = 100,
                 fa2_edge_weight_influence: float = 1.0,
                 fa2_jitter_tolerance: float = 1.0,
                 fa2_barnes_hut_optimize: bool = True,
                 fa2_barnes_hut_theta: float = 0.5,
                 fa2_scaling_ratio: float = 3.0,    # Optimal for LinLog mode
                 fa2_strong_gravity_mode: bool = False,
                 fa2_gravity: float = 0.1,          # Low gravity for LinLog mode
                 dbscan_eps: float = 0.3,           # Legacy DBSCAN parameter (fallback only)
                 dbscan_min_samples: int = 5,       # Legacy DBSCAN parameter (fallback only)
                 use_gpu: bool = True):
        """
        Initialize the physics clustering migrator.
        """
        self.db_path = db_path
        self.use_gpu = use_gpu and GPU_AVAILABLE
        self.fa2_max_iterations = fa2_max_iterations
        self.fa2_convergence_threshold = fa2_convergence_threshold
        self.fa2_check_interval = fa2_check_interval
        self.fa2_scaling_ratio = fa2_scaling_ratio
        self.fa2_gravity = fa2_gravity
        
        # DBSCAN parameters
        self.dbscan_params = {
            'eps': dbscan_eps,
            'min_samples': dbscan_min_samples
        }
        
        logger.info(f"🚀 Initialized Physics Clustering Migrator (GPU: {self.use_gpu})")
        logger.info(f"   ForceAtlas2 max iterations: {fa2_max_iterations}, convergence threshold: {fa2_convergence_threshold}")
        logger.info(f"   DBSCAN eps: {dbscan_eps}, min_samples: {dbscan_min_samples}")
    
    def create_physics_clustering_table(self) -> bool:
        """
        Create the physics_clustering table by copying filtered_papers.
        
        Returns:
            True if successful, False otherwise
        """
        logger.info("📋 Creating physics_clustering table...")
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Drop existing physics_clustering table if it exists
            cursor.execute("DROP TABLE IF EXISTS physics_clustering")
            
            # Create new table by copying structure and data from filtered_papers
            cursor.execute("""
                CREATE TABLE physics_clustering AS 
                SELECT * FROM filtered_papers
            """)
            
            # Verify the copy
            result = cursor.execute("SELECT COUNT(*) FROM physics_clustering").fetchone()
            count = result[0] if result else 0
            
            # Create indices for better performance
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_physics_clustering_id ON physics_clustering(paper_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_physics_clustering_cluster ON physics_clustering(cluster_id)")
            
            conn.commit()
            conn.close()
            
            logger.info(f"✅ Successfully created physics_clustering table with {count:,} papers")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to create physics_clustering table: {e}")
            return False
    
    def load_citation_network(self) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        Load the citation network from the database.
        
        Returns:
            Tuple of (nodes_df, edges_df)
        """
        logger.info("📊 Loading citation network from database...")
        
        conn = sqlite3.connect(self.db_path)
        
        # Load nodes (papers) from filtered_papers
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
        """
        if not self.use_gpu:
            return self.compute_forceatlas2_layout_cpu(nodes_df, edges_df)
        
        logger.info("🚀 Computing ForceAtlas2 layout on GPU...")
        start_time = time.time()
        
        try:
            # Create integer mapping for cuGraph (required for ForceAtlas2)
            all_nodes = set(edges_df['src'].tolist() + edges_df['dst'].tolist() + nodes_df['paper_id'].tolist())
            node_to_int = {node: i for i, node in enumerate(sorted(all_nodes))}
            int_to_node = {i: node for node, i in node_to_int.items()}
            
            # Convert edges to integer IDs
            edges_int = pd.DataFrame({
                'src': [node_to_int[src] for src in edges_df['src']],
                'dst': [node_to_int[dst] for dst in edges_df['dst']]
            })
            edges_cudf = cudf.from_pandas(edges_int)
            
            # Create cuGraph (undirected for better layout)
            G = cugraph.Graph(directed=False)
            G.from_cudf_edgelist(edges_cudf, source='src', destination='dst')
            
            logger.info(f"📊 Created cuGraph with {G.number_of_vertices():,} vertices and {G.number_of_edges():,} edges")
            
            # Run ForceAtlas2 in single shot  
            positions_cudf = self.run_forceatlas2_single_run(G)
            
            # Convert back to numpy (cuGraph returns vertex, x, y columns)
            # Use cuDF operations to avoid CUDA device issues
            vertices_int = positions_cudf['vertex'].to_arrow().to_pylist()
            x_coords = positions_cudf['x'].to_arrow().to_pylist()
            y_coords = positions_cudf['y'].to_arrow().to_pylist()
            
            # Create a mapping from integer vertex to position
            vertex_int_to_pos = {v: [x, y] for v, x, y in zip(vertices_int, x_coords, y_coords)}
            
            # Get positions in the same order as nodes_df (convert back to original node IDs)
            positions = np.array([
                vertex_int_to_pos.get(node_to_int.get(node_id, -1), [0.0, 0.0]) 
                for node_id in nodes_df['paper_id']
            ])
            
            elapsed = time.time() - start_time
            logger.info(f"✅ ForceAtlas2 completed in {elapsed:.2f} seconds")
            
            # Log coordinate statistics for debugging
            x_coords = positions[:, 0]
            y_coords = positions[:, 1]
            logger.info(f"📊 Coordinate ranges: X[{x_coords.min():.1f}, {x_coords.max():.1f}], Y[{y_coords.min():.1f}, {y_coords.max():.1f}]")
            logger.info(f"📊 Coordinate spans: X={x_coords.max()-x_coords.min():.1f}, Y={y_coords.max()-y_coords.min():.1f}")
            
            print("divide positions by 1000")
            positions = positions / 1000
            return positions
            
        except Exception as e:
            logger.error(f"❌ GPU ForceAtlas2 failed: {e}")
            logger.info("🔄 Falling back to CPU implementation...")
            return self.compute_forceatlas2_layout_cpu(nodes_df, edges_df)
    
    def run_forceatlas2_single_run(self, G) -> 'cudf.DataFrame':
        """
        Run ForceAtlas2 in a single shot with proper parameters for 70k node citation graphs.
        """
        num_vertices = G.number_of_vertices()
        num_edges = G.number_of_edges()
        
        # Use recommended parameters for large citation graphs
        iterations = min(2000, self.fa2_max_iterations)  # 2000 is usually enough for convergence
        
        print(f"🔥 Running ForceAtlas2 for {iterations} iterations on {num_vertices:,} vertices, {num_edges:,} edges")
        
        try:
            positions_cudf = cugraph.force_atlas2(
                G,
                max_iter=iterations,
                scaling_ratio=self.fa2_scaling_ratio,
                gravity=self.fa2_gravity,
                lin_log_mode=True,         # Logarithmic attraction - favors communities
                outbound_attraction_distribution=False,  # Hubs attract less, pushed to borders
                barnes_hut_optimize=True,
                verbose=False
            )
            
            print(f"✅ ForceAtlas2 completed successfully")
            return positions_cudf
            
        except Exception as e:
            print(f"❌ ForceAtlas2 failed: {e}")
            raise
    

    
    def compute_forceatlas2_layout_cpu(self, nodes_df: pd.DataFrame, edges_df: pd.DataFrame) -> np.ndarray:
        """
        Fallback CPU implementation using NetworkX + fa2.
        """
        logger.info("💻 Computing ForceAtlas2 layout on CPU (fallback)...")
        start_time = time.time()
        
        try:
            # Create NetworkX graph
            G = nx.from_pandas_edgelist(edges_df, source='src', target='dst', create_using=nx.DiGraph())
            
            # Add isolated nodes
            all_nodes = set(nodes_df['paper_id'])
            graph_nodes = set(G.nodes())
            isolated_nodes = all_nodes - graph_nodes
            G.add_nodes_from(isolated_nodes)
            
            logger.info(f"📊 Created NetworkX graph with {G.number_of_nodes():,} nodes and {G.number_of_edges():,} edges")
            
            # Use NetworkX spring layout as ForceAtlas2 alternative
            logger.info("🔥 Running NetworkX spring layout algorithm...")
            positions_dict = nx.spring_layout(
                G, 
                iterations=min(self.fa2_iterations, 50),  # Limit iterations for performance
                k=1,  # Optimal distance between nodes
                seed=42  # For reproducibility
            )
            
            # Convert to numpy array in the same order as nodes_df
            positions = np.array([[positions_dict.get(node_id, [0.0, 0.0])[0], 
                                  positions_dict.get(node_id, [0.0, 0.0])[1]] 
                                 for node_id in nodes_df['paper_id']])
            
            elapsed = time.time() - start_time
            logger.info(f"✅ CPU spring layout completed in {elapsed:.2f} seconds")
            
            return positions
            
        except Exception as e:
            logger.error(f"❌ CPU spring layout failed: {e}")
            return self.generate_random_positions(len(nodes_df))
    
    def generate_random_positions(self, n_nodes: int) -> np.ndarray:
        """
        Generate random positions as a last resort fallback.
        """
        logger.warning("⚠️  Using random positions (ForceAtlas2 failed)")
        np.random.seed(42)
        return np.random.randn(n_nodes, 2) * 10
    
    def cluster_positions_gpu(self, positions: np.ndarray) -> np.ndarray:
        """
        Perform HDBSCAN clustering on 2D positions using GPU with raw coordinates to preserve density variations.
        """
        if not self.use_gpu:
            return self.cluster_positions_cpu(positions)
        
        print("🚀 Performing HDBSCAN clustering on GPU with raw coordinates...")
        start_time = time.time()
        
        try:
            # Use raw coordinates to preserve density variations (no standardization!)
            # This is crucial for HDBSCAN to handle variable density properly
            positions_for_clustering = positions.copy()
            
            print(f"📊 Using raw coordinates to preserve density variations")
            print(f"📊 Coordinate ranges: X[{positions[:, 0].min():.1f}, {positions[:, 0].max():.1f}], Y[{positions[:, 1].min():.1f}, {positions[:, 1].max():.1f}]")
            
            # Convert to cuDF for GPU processing
            positions_cudf = cudf.DataFrame({
                'x': positions_for_clustering[:, 0],
                'y': positions_for_clustering[:, 1]
            })
            
            # GPU HDBSCAN with optimal parameters for citation networks
            from cuml import HDBSCAN as cuHDBSCAN
            hdbscan = cuHDBSCAN(
                min_cluster_size=100,      # Small clusters for granular communities
                min_samples=5,             # Low threshold for community detection
                cluster_selection_epsilon=0.0  # Use default selection
            )
            cluster_labels_cudf = hdbscan.fit_predict(positions_cudf)
            
            # Convert to numpy using arrow to avoid CUDA device issues
            cluster_labels = np.array(cluster_labels_cudf.to_arrow().to_pylist())
            
            elapsed = time.time() - start_time
            n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
            n_noise = int(np.sum(cluster_labels == -1))
            
            print(f"✅ GPU HDBSCAN completed in {elapsed:.2f} seconds")
            print(f"📊 Found {n_clusters} clusters, {n_noise} noise points")
            
            # Show cluster size distribution
            if n_clusters > 0:
                from collections import Counter
                cluster_sizes = Counter(cluster_labels)
                if -1 in cluster_sizes:
                    del cluster_sizes[-1]  # Remove noise
                largest_cluster_size = max(cluster_sizes.values()) if cluster_sizes else 0
                largest_ratio = largest_cluster_size / len(positions)
                print(f"📊 Largest cluster: {largest_cluster_size} papers ({largest_ratio:.1%})")
                
                # Show top 5 cluster sizes
                top_clusters = cluster_sizes.most_common(5)
                top_str = ", ".join([f"{size}" for _, size in top_clusters])
                print(f"📊 Top cluster sizes: {top_str}")
            
            return cluster_labels
            
        except Exception as e:
            print(f"❌ GPU HDBSCAN failed: {e}")
            print("🔄 Falling back to CPU HDBSCAN...")
            return self.cluster_positions_cpu(positions)
    
    def cluster_positions_cpu(self, positions: np.ndarray) -> np.ndarray:
        """
        Fallback CPU HDBSCAN clustering.
        """
        logger.info("💻 Performing HDBSCAN clustering on CPU...")
        start_time = time.time()
        
        try:
            # Try to use CPU HDBSCAN
            import hdbscan
            
            # Use raw coordinates (no standardization for HDBSCAN)
            positions_for_clustering = positions.copy()
            logger.info("📊 Using raw coordinates to preserve density variations")
            
            # CPU HDBSCAN with same parameters as GPU version
            clusterer = hdbscan.HDBSCAN(
                min_cluster_size=100,
                min_samples=5,
                cluster_selection_epsilon=0.0
            )
            cluster_labels = clusterer.fit_predict(positions_for_clustering)
            
            elapsed = time.time() - start_time
            n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
            n_noise = list(cluster_labels).count(-1)
            
            logger.info(f"✅ CPU HDBSCAN completed in {elapsed:.2f} seconds")
            logger.info(f"📊 Found {n_clusters} clusters, {n_noise} noise points")
            
            return cluster_labels
            
        except ImportError:
            logger.warning("⚠️  HDBSCAN not available, falling back to DBSCAN...")
            # Fallback to DBSCAN if HDBSCAN not available
            from sklearn.preprocessing import StandardScaler
            from sklearn.cluster import DBSCAN
            
            # Standardize positions for DBSCAN
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
    
    def save_physics_results_to_db(self, paper_ids: List[str], positions: np.ndarray, cluster_labels: np.ndarray) -> bool:
        """
        Save the physics-based clustering results to the physics_clustering table.
        """
        logger.info("💾 Saving physics clustering results to database...")
        
        max_retries = 3
        
        for attempt in range(max_retries):
            try:
                conn = sqlite3.connect(self.db_path, timeout=30.0)
                
                # Set pragmas for better concurrency
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute("PRAGMA temp_store=memory")
                conn.execute("PRAGMA mmap_size=268435456")  # 256MB
                
                # Calculate cluster sizes
                cluster_sizes = Counter(cluster_labels)
                
                # Update the physics_clustering table with results
                logger.info(f"📝 Updating {len(paper_ids)} papers with physics clustering results...")
                
                # Use batch updates for better performance
                batch_size = 1000
                current_time = time.strftime("%Y-%m-%d %H:%M:%S")
                
                for i in range(0, len(paper_ids), batch_size):
                    batch_end = min(i + batch_size, len(paper_ids))
                    batch_updates = []
                    
                    for j in range(i, batch_end):
                        paper_id = paper_ids[j]
                        cluster_id = int(cluster_labels[j])
                        cluster_size = cluster_sizes[cluster_id]
                        
                        batch_updates.append((
                            float(positions[j, 0]), 
                            float(positions[j, 1]), 
                            cluster_id,
                            cluster_size,
                            current_time,
                            paper_id
                        ))
                    
                    conn.executemany("""
                        UPDATE physics_clustering 
                        SET embedding_x = ?, embedding_y = ?, cluster_id = ?, 
                            cluster_size = ?, processed_date = ?
                        WHERE paper_id = ?
                    """, batch_updates)
                    
                    if (i // batch_size + 1) % 10 == 0:
                        logger.info(f"   📝 Processed {batch_end:,}/{len(paper_ids):,} papers...")
                
                conn.commit()
                logger.info(f"✅ Successfully saved results for {len(paper_ids):,} papers to physics_clustering table")
                
                # Verify the save
                result = conn.execute("SELECT COUNT(*) FROM physics_clustering WHERE cluster_id IS NOT NULL").fetchone()
                saved_count = result[0] if result else 0
                logger.info(f"✅ Verification: {saved_count:,} papers now have physics clustering results")
                
                conn.close()
                return True
                
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e).lower() and attempt < max_retries - 1:
                    logger.warning(f"⚠️  Database locked, retrying in {2 ** attempt} seconds... (attempt {attempt + 1}/{max_retries})")
                    time.sleep(2 ** attempt)
                    continue
                else:
                    logger.error(f"❌ Failed to save to database: {e}")
                    return False
            except Exception as e:
                logger.error(f"❌ Unexpected error saving to database: {e}")
                import traceback
                traceback.print_exc()
                return False
            finally:
                try:
                    conn.close()
                except:
                    pass
        
        logger.error(f"❌ Failed to save to database after {max_retries} attempts")
        return False
    
    def run_migration(self) -> bool:
        """
        Run the complete migration from Node2Vec+UMAP+KMeans to ForceAtlas2+DBSCAN on all papers.
        
        Returns:
            True if successful, False otherwise
        """
        print("🚀 Starting Physics-Based Clustering Migration")
        print("=" * 60)
        
        total_start_time = time.time()
        
        try:
            # Step 1: Create the physics_clustering table
            if not self.create_physics_clustering_table():
                return False
            
            # Step 2: Load data (all papers)
            nodes_df, edges_df = self.load_citation_network()
            print(f"📊 Loaded {len(nodes_df):,} nodes and {len(edges_df):,} edges")
            
            # Step 3: Compute ForceAtlas2 layout
            positions = self.compute_forceatlas2_layout_gpu(nodes_df, edges_df)
            
            # Step 4: Cluster positions with HDBSCAN
            cluster_labels = self.cluster_positions_gpu(positions)
            
            # Step 5: Save results to physics_clustering table (keep noise points as -1)
            paper_ids = nodes_df['paper_id'].tolist()
            success = self.save_physics_results_to_db(paper_ids, positions, cluster_labels)
            
            if success:
                total_elapsed = time.time() - total_start_time
                logger.info("🎉 Physics-Based Clustering Migration Complete!")
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
            logger.error(f"❌ Migration failed: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def compare_clustering_approaches(self) -> Dict:
        """
        Compare the old (filtered_papers) and new (physics_clustering) clustering approaches.
        
        Returns:
            Dictionary with comparison metrics
        """
        logger.info("📊 Comparing clustering approaches...")
        
        conn = sqlite3.connect(self.db_path)
        
        # Load both clustering results
        old_query = """
            SELECT paper_id, cluster_id, embedding_x, embedding_y, cluster_size
            FROM filtered_papers 
            WHERE cluster_id IS NOT NULL
        """
        old_df = pd.read_sql_query(old_query, conn)
        
        new_query = """
            SELECT paper_id, cluster_id, embedding_x, embedding_y, cluster_size
            FROM physics_clustering 
            WHERE cluster_id IS NOT NULL AND cluster_id >= 0
        """
        new_df = pd.read_sql_query(new_query, conn)
        
        # Also get noise count for new approach
        noise_query = """
            SELECT COUNT(*) as noise_count
            FROM physics_clustering 
            WHERE cluster_id = -1
        """
        noise_count = pd.read_sql_query(noise_query, conn).iloc[0]['noise_count']
        
        # Load citation network for validation
        citations_query = """
            SELECT src, dst FROM filtered_citations
        """
        citations_df = pd.read_sql_query(citations_query, conn)
        
        conn.close()
        
        def calculate_intra_cluster_density(clustering_df, citations_df):
            """Calculate intra-cluster citation density for a clustering result."""
            paper_to_cluster = dict(zip(clustering_df['paper_id'], clustering_df['cluster_id']))
            
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
            return intra_cluster_citations / total_citations if total_citations > 0 else 0
        
        # Calculate metrics for both approaches
        old_intra_density = calculate_intra_cluster_density(old_df, citations_df)
        new_intra_density = calculate_intra_cluster_density(new_df, citations_df)
        
        old_cluster_sizes = old_df['cluster_id'].value_counts()
        new_cluster_sizes = new_df['cluster_id'].value_counts()
        
        # Handle empty clusters safely
        def safe_stats(series):
            if len(series) == 0:
                return {'mean': 0, 'median': 0, 'max': 0, 'min': 0}
            return {
                'mean': float(series.mean()) if not series.empty else 0,
                'median': float(series.median()) if not series.empty else 0, 
                'max': int(series.max()) if not series.empty else 0,
                'min': int(series.min()) if not series.empty else 0
            }
        
        old_stats = safe_stats(old_cluster_sizes)
        new_stats = safe_stats(new_cluster_sizes)
        
        comparison = {
            'old_approach': {
                'name': 'Node2Vec + UMAP + KMeans',
                'total_papers': len(old_df),
                'total_clusters': len(old_cluster_sizes),
                'intra_cluster_citation_density': old_intra_density,
                'average_cluster_size': old_stats['mean'],
                'median_cluster_size': old_stats['median'],
                'largest_cluster_size': old_stats['max'],
                'smallest_cluster_size': old_stats['min']
            },
            'new_approach': {
                'name': 'ForceAtlas2 + HDBSCAN',
                'total_papers': len(new_df) + noise_count,
                'total_clusters': len(new_cluster_sizes),
                'noise_points': noise_count,
                'intra_cluster_citation_density': new_intra_density,
                'average_cluster_size': new_stats['mean'],
                'median_cluster_size': new_stats['median'],
                'largest_cluster_size': new_stats['max'],
                'smallest_cluster_size': new_stats['min']
            }
        }
        
        # Calculate improvement metrics
        comparison['improvement'] = {
            'intra_density_improvement': new_intra_density - old_intra_density,
            'cluster_count_change': len(new_cluster_sizes) - len(old_cluster_sizes),
            'avg_size_change': comparison['new_approach']['average_cluster_size'] - comparison['old_approach']['average_cluster_size']
        }
        
        logger.info("📊 Clustering Comparison Results:")
        logger.info(f"   Old approach intra-cluster density: {old_intra_density:.3f}")
        logger.info(f"   New approach intra-cluster density: {new_intra_density:.3f}")
        logger.info(f"   New approach noise points: {noise_count:,}")
        logger.info(f"   Improvement: {comparison['improvement']['intra_density_improvement']:.3f}")
        
        return comparison


def main():
    """
    Main function to run the physics-based clustering migration.
    """
    import argparse
    
    parser = argparse.ArgumentParser(description="Physics-Based Clustering Migration for Citation Networks")
    parser.add_argument("--fa2-iterations", type=int, default=2000, help="ForceAtlas2 iterations")
    parser.add_argument("--scaling-ratio", type=float, default=5.0, help="ForceAtlas2 scaling ratio (repulsion strength)")
    parser.add_argument("--gravity", type=float, default=1.5, help="ForceAtlas2 gravity (central attraction)")
    parser.add_argument("--dbscan-eps", type=float, default=0.3, help="DBSCAN epsilon parameter (for standardized coordinates)")
    parser.add_argument("--dbscan-min-samples", type=int, default=5, help="DBSCAN min samples")
    parser.add_argument("--no-gpu", action="store_true", help="Disable GPU acceleration")
    parser.add_argument("--compare", action="store_true", help="Compare old vs new clustering approaches")
    
    args = parser.parse_args()
    
    # Initialize migrator
    migrator = PhysicsClusteringMigrator(
        fa2_max_iterations=args.fa2_iterations,
        fa2_scaling_ratio=args.scaling_ratio,
        fa2_gravity=args.gravity,
        dbscan_eps=args.dbscan_eps,
        dbscan_min_samples=args.dbscan_min_samples,
        use_gpu=not args.no_gpu
    )
    
    if args.compare:
        # Just compare existing results
        comparison = migrator.compare_clustering_approaches()
        print("\n📊 Clustering Approach Comparison:")
        print("=" * 50)
        print(f"\n🔹 {comparison['old_approach']['name']}:")
        for key, value in comparison['old_approach'].items():
            if key != 'name':
                if isinstance(value, float):
                    print(f"   {key}: {value:.3f}")
                else:
                    print(f"   {key}: {value:,}")
        
        print(f"\n🔹 {comparison['new_approach']['name']}:")
        for key, value in comparison['new_approach'].items():
            if key != 'name':
                if isinstance(value, float):
                    print(f"   {key}: {value:.3f}")
                else:
                    print(f"   {key}: {value:,}")
        
        print(f"\n📈 Improvements:")
        for key, value in comparison['improvement'].items():
            if isinstance(value, float):
                print(f"   {key}: {value:+.3f}")
            else:
                print(f"   {key}: {value:+,}")
    else:
        # Run full migration on all papers
        success = migrator.run_migration()
        
        if success:
            print("\n🎉 Success! Physics-based clustering migration complete.")
            print("💡 Next steps:")
            print("   1. Compare results with: python physics_clustering_migration.py --compare")
            print("   2. Update frontend to use physics_clustering table")
            print("   3. Validate clustering quality in visualization")
        else:
            print("\n❌ Migration failed. Check logs for details.")
            exit(1)


if __name__ == "__main__":
    main() 