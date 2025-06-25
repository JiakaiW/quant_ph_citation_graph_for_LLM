#!/usr/bin/env python3
"""
🎨 Cluster API Integration

Lightweight API integration for cluster naming using influential papers approach.
Optimized for fast response times while maintaining meaningful results.
"""

import sqlite3
import json
import numpy as np
from typing import Dict, List, Optional
from collections import Counter
import logging
from cluster_theme_extractor import InfluentialPaperClusterNamer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ClusterAPIIntegration:
    """
    API integration for cluster naming using influential papers approach.
    Optimized for fast response times while providing meaningful, paper-based cluster names.
    """
    
    def __init__(self, db_path: str = "../../data/arxiv_papers.db", cache_file: str = "cluster_names_cache.json"):
        self.db_path = db_path
        self.cache_file = cache_file
        self.namer = InfluentialPaperClusterNamer(db_path)
        self._cluster_cache = {}
        self._load_cache()
    
    def _load_cache(self):
        """Load cached cluster names from file."""
        try:
            with open(self.cache_file, 'r') as f:
                self._cluster_cache = json.load(f)
            logger.info(f"Loaded {len(self._cluster_cache)} cached cluster names")
        except FileNotFoundError:
            logger.info("No cache file found, will generate fresh names")
            self._cluster_cache = {}
        except Exception as e:
            logger.error(f"Error loading cache: {e}")
            self._cluster_cache = {}
    
    def _save_cache(self):
        """Save cluster names to cache file."""
        try:
            with open(self.cache_file, 'w') as f:
                json.dump(self._cluster_cache, f, indent=2)
            logger.info(f"Saved {len(self._cluster_cache)} cluster names to cache")
        except Exception as e:
            logger.error(f"Error saving cache: {e}")
    
    def get_cluster_name(self, cluster_id: int) -> Dict:
        """
        Get cluster name and info for a specific cluster.
        Uses cache if available, generates if not.
        """
        cluster_key = str(cluster_id)
        
        # Check cache first
        if cluster_key in self._cluster_cache:
            return self._cluster_cache[cluster_key]
        
        # Generate new name using influential papers approach
        logger.info(f"Generating name for cluster {cluster_id}...")
        
        # Get all clusters since the new approach works on all clusters at once
        all_results = self.namer.analyze_all_clusters()
        
        # Cache all results
        for cid, info in all_results.items():
            self._cluster_cache[cid] = info
        
        self._save_cache()
        
        return all_results.get(cluster_key, self._create_fallback_result(cluster_id, 0))
    
    def get_all_cluster_names(self, max_clusters: int = 16) -> Dict[str, Dict]:
        """
        Get names for all clusters, using cache when possible.
        """
        logger.info(f"Getting names for {max_clusters} clusters...")
        
        # Check if we have all clusters cached
        missing_clusters = []
        for cluster_id in range(max_clusters):
            cluster_key = str(cluster_id)
            if cluster_key not in self._cluster_cache:
                missing_clusters.append(cluster_id)
        
        # If any clusters are missing, regenerate all
        if missing_clusters:
            logger.info(f"Generating names for all clusters (missing: {missing_clusters})")
            all_results = self.namer.analyze_all_clusters(max_clusters)
            
            # Cache all results
            for cid, info in all_results.items():
                self._cluster_cache[cid] = info
            
            self._save_cache()
            return all_results
        else:
            # Return cached results
            return {str(i): self._cluster_cache[str(i)] for i in range(max_clusters) if str(i) in self._cluster_cache}
    
    def refresh_cluster_names(self, max_clusters: int = 16) -> Dict[str, Dict]:
        """
        Force refresh all cluster names (ignore cache).
        """
        logger.info("Force refreshing all cluster names...")
        
        # Clear cache
        self._cluster_cache = {}
        
        # Generate all names fresh using the new approach
        all_results = self.namer.analyze_all_clusters(max_clusters)
        
        # Cache all results
        for cid, info in all_results.items():
            self._cluster_cache[cid] = info
        
        # Save new cache
        self._save_cache()
        
        return all_results
    
    def _create_fallback_result(self, cluster_id: int, paper_count: int) -> Dict:
        """Create a fallback result when analysis fails"""
        return {
            'name': f"Research Cluster {cluster_id}",
            'description': f"Physics research cluster with {paper_count} papers.",
            'keywords': [],
            'paper_count': paper_count,
            'year_range': "Unknown",
            'quality_score': 0.1,
            'top_papers': [],
            'total_citations': 0
        }
    
    def get_cluster_info(self, cluster_id: int) -> Dict:
        """
        Get detailed information about a specific cluster.
        """
        cluster_info = self.get_cluster_name(cluster_id)
        
        # Add additional details if needed
        return cluster_info
    
    def get_cluster_statistics(self) -> Dict:
        """
        Get overall statistics about the clustering.
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get cluster distribution - using correct table and column names
            cursor.execute("""
                SELECT cluster_id, COUNT(*) as paper_count
                FROM filtered_papers 
                WHERE cluster_id IS NOT NULL
                GROUP BY cluster_id
                ORDER BY cluster_id
            """)
            
            cluster_distribution = {}
            total_papers = 0
            
            for row in cursor.fetchall():
                cluster_id = int(row[0])
                paper_count = int(row[1])
                cluster_distribution[cluster_id] = paper_count
                total_papers += paper_count
            
            # Get year range
            cursor.execute("""
                SELECT MIN(year) as earliest,
                       MAX(year) as latest
                FROM filtered_papers 
                WHERE cluster_id IS NOT NULL
            """)
            
            year_range = cursor.fetchone()
            
            conn.close()
            
            return {
                'total_papers': total_papers,
                'total_clusters': len(cluster_distribution),
                'cluster_distribution': cluster_distribution,
                'year_range': {
                    'earliest': int(year_range[0]) if year_range[0] else None,
                    'latest': int(year_range[1]) if year_range[1] else None
                },
                'largest_cluster': max(cluster_distribution.items(), key=lambda x: x[1]) if cluster_distribution else None,
                'smallest_cluster': min(cluster_distribution.items(), key=lambda x: x[1]) if cluster_distribution else None
            }
            
        except Exception as e:
            logger.error(f"Error getting cluster statistics: {e}")
            return {}

# Global instance for API use
cluster_api = ClusterAPIIntegration()

def get_cluster_names_for_api() -> Dict:
    """
    Main function called by the API to get cluster names.
    Returns a dictionary suitable for JSON serialization.
    """
    try:
        logger.info("API request for cluster names...")
        cluster_names = cluster_api.get_all_cluster_names()
        
        # Ensure all values are JSON serializable
        serializable_names = {}
        for cluster_id, info in cluster_names.items():
            serializable_info = {}
            for key, value in info.items():
                if isinstance(value, (np.integer, np.int64)):
                    serializable_info[key] = int(value)
                elif isinstance(value, (np.floating, np.float64)):
                    serializable_info[key] = float(value)
                elif isinstance(value, np.ndarray):
                    serializable_info[key] = value.tolist()
                elif isinstance(value, dict):
                    # Handle nested dictionaries
                    serializable_dict = {}
                    for k, v in value.items():
                        if isinstance(v, (np.integer, np.int64)):
                            serializable_dict[k] = int(v)
                        elif isinstance(v, (np.floating, np.float64)):
                            serializable_dict[k] = float(v)
                        elif isinstance(v, np.ndarray):
                            serializable_dict[k] = v.tolist()
                        else:
                            serializable_dict[k] = v
                    serializable_info[key] = serializable_dict
                else:
                    serializable_info[key] = value
            
            serializable_names[cluster_id] = serializable_info
        
        logger.info(f"Returning names for {len(serializable_names)} clusters")
        return {
            'clusters': serializable_names,
            'status': 'success',
            'message': f'Generated names for {len(serializable_names)} clusters using influential papers approach'
        }
        
    except Exception as e:
        logger.error(f"Error in get_cluster_names_for_api: {e}")
        return {
            'clusters': {},
            'status': 'error',
            'message': f'Error generating cluster names: {str(e)}'
        }

def get_cluster_info_for_api(cluster_id: int) -> Dict:
    """
    Get detailed info for a specific cluster for API use.
    """
    try:
        logger.info(f"API request for cluster {cluster_id} info...")
        cluster_info = cluster_api.get_cluster_info(cluster_id)
        
        # Ensure JSON serializable
        serializable_info = {}
        for key, value in cluster_info.items():
            if isinstance(value, (np.integer, np.int64)):
                serializable_info[key] = int(value)
            elif isinstance(value, (np.floating, np.float64)):
                serializable_info[key] = float(value)
            elif isinstance(value, np.ndarray):
                serializable_info[key] = value.tolist()
            elif isinstance(value, dict):
                # Handle nested dictionaries
                serializable_dict = {}
                for k, v in value.items():
                    if isinstance(v, (np.integer, np.int64)):
                        serializable_dict[k] = int(v)
                    elif isinstance(v, (np.floating, np.float64)):
                        serializable_dict[k] = float(v)
                    elif isinstance(v, np.ndarray):
                        serializable_dict[k] = v.tolist()
                    else:
                        serializable_dict[k] = v
                serializable_info[key] = serializable_dict
            else:
                serializable_info[key] = value
        
        return {
            'cluster_info': serializable_info,
            'status': 'success'
        }
        
    except Exception as e:
        logger.error(f"Error getting cluster {cluster_id} info: {e}")
        return {
            'cluster_info': {},
            'status': 'error',
            'message': str(e)
        }

def refresh_cluster_names_for_api() -> Dict:
    """
    Force refresh all cluster names for API use.
    """
    try:
        logger.info("API request to refresh all cluster names...")
        cluster_names = cluster_api.refresh_cluster_names()
        
        return {
            'clusters': cluster_names,
            'status': 'success',
            'message': f'Refreshed names for {len(cluster_names)} clusters'
        }
        
    except Exception as e:
        logger.error(f"Error refreshing cluster names: {e}")
        return {
            'clusters': {},
            'status': 'error',
            'message': str(e)
        }

if __name__ == "__main__":
    # Test the integration
    print("🧪 Testing Cluster API Integration...")
    
    # Test getting all cluster names
    result = get_cluster_names_for_api()
    print(f"Status: {result['status']}")
    print(f"Message: {result['message']}")
    print(f"Clusters found: {len(result['clusters'])}")
    
    # Show first few clusters
    for i, (cluster_id, info) in enumerate(list(result['clusters'].items())[:3]):
        print(f"\nCluster {cluster_id}: {info['name']}")
        print(f"  Domain: {info.get('primary_domain', 'unknown')}")
        print(f"  Papers: {info.get('paper_count', 0)}")
        print(f"  Keywords: {', '.join(info.get('keywords', [])[:3])}")