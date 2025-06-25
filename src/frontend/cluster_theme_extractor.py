#!/usr/bin/env python3
"""
🎨 Cluster Theme Extractor

Innovative system to automatically extract meaningful cluster themes and names
from Node2Vec → UMAP → KNN clustering results using multiple complementary approaches:

1. TF-IDF Analysis: Extract most distinctive terms per cluster
2. Title Pattern Mining: Find common patterns in paper titles
3. Venue Analysis: Identify dominant publication venues
4. Temporal Evolution: Track how cluster themes evolve over time
5. Citation Network Analysis: Use citation patterns to infer research areas
6. LLM-based Summarization: Generate human-readable cluster descriptions

This addresses the challenge of interpreting unsupervised clustering results
in academic citation networks.
"""

import sqlite3
import numpy as np
from collections import Counter, defaultdict
import re
import json
from typing import Dict, List, Tuple, Set
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class InfluentialPaperClusterNamer:
    def __init__(self, db_path: str = "../../data/arxiv_papers.db"):
        self.db_path = db_path

    def clean_title(self, title: str) -> str:
        """Clean and normalize paper titles for naming"""
        if not title:
            return ""
        
        # Remove common prefixes and suffixes
        title = re.sub(r'^(on |the |a |an )', '', title.lower())
        title = re.sub(r'(: a |: an |: the ).*$', '', title)
        
        # Remove version numbers and arxiv artifacts
        title = re.sub(r'\s*v\d+\s*$', '', title)
        title = re.sub(r'\s*\(.*\)\s*$', '', title)
        
        # Clean up formatting
        title = re.sub(r'\s+', ' ', title).strip()
        
        return title

    def extract_key_concepts_from_title(self, title: str) -> List[str]:
        """Extract key physics concepts from a paper title"""
        title_lower = title.lower()
        
        # Physics concepts that make good cluster names
        physics_concepts = [
            # Quantum computing
            'quantum computer', 'quantum computing', 'quantum algorithm', 'quantum gate',
            'quantum circuit', 'quantum error correction', 'quantum supremacy',
            'qubit', 'quantum entanglement', 'quantum teleportation',
            
            # Quantum optics
            'quantum optics', 'photon', 'laser', 'optical', 'cavity qed',
            'single photon', 'squeezed light', 'photonic',
            
            # Condensed matter
            'superconductor', 'superconducting', 'superconductivity',
            'topological', 'majorana', 'quantum hall', 'spin',
            'magnetic', 'ferromagnet', 'antiferromagnet',
            
            # Atomic physics
            'cold atom', 'ultracold', 'bose einstein condensate', 'bec',
            'ion trap', 'optical lattice', 'rydberg', 'atom interferometry',
            
            # Field theory
            'quantum field theory', 'gauge theory', 'standard model',
            'symmetry breaking', 'renormalization',
            
            # Many-body
            'many body', 'strongly correlated', 'quantum phase transition',
            'quantum criticality', 'anderson localization'
        ]
        
        found_concepts = []
        for concept in physics_concepts:
            if concept in title_lower:
                found_concepts.append(concept.title())
        
        return found_concepts

    def get_most_influential_papers(self, cluster_id: int, limit: int = 10) -> List[Dict]:
        """Get the most influential papers in a cluster by citation count"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get papers in this cluster with their citation counts
            query = """
                SELECT 
                    fp.paper_id,
                    fp.title,
                    fp.year,
                    COALESCE(citation_counts.in_degree, 0) as citation_count
                FROM filtered_papers fp
                LEFT JOIN (
                    SELECT dst as paper_id, COUNT(*) as in_degree
                    FROM filtered_citations 
                    GROUP BY dst
                ) citation_counts ON fp.paper_id = citation_counts.paper_id
                WHERE fp.cluster_id = ? AND fp.title IS NOT NULL
                ORDER BY citation_count DESC, fp.year DESC
                LIMIT ?
            """
            
            cursor.execute(query, (cluster_id, limit))
            papers = cursor.fetchall()
            conn.close()
            
            result = []
            for paper in papers:
                result.append({
                    'paper_id': paper[0],
                    'title': paper[1],
                    'year': paper[2] if paper[2] else 'Unknown',
                    'citation_count': paper[3]
                })
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting influential papers for cluster {cluster_id}: {e}")
            return []

    def generate_cluster_name_from_papers(self, cluster_id: int, influential_papers: List[Dict]) -> str:
        """Generate cluster name from most influential papers"""
        if not influential_papers:
            return f"Research Cluster {cluster_id}"
        
        # Get the most cited paper
        top_paper = influential_papers[0]
        
        # Extract key concepts from top papers
        all_concepts = []
        for paper in influential_papers[:3]:  # Use top 3 papers
            concepts = self.extract_key_concepts_from_title(paper['title'])
            all_concepts.extend(concepts)
        
        # Count concept frequency
        concept_counts = Counter(all_concepts)
        
        if concept_counts:
            # Use the most common concept
            main_concept = concept_counts.most_common(1)[0][0]
            return main_concept
        
        # Fallback: use a cleaned version of the top paper's title
        clean_title = self.clean_title(top_paper['title'])
        
        # Extract the main subject (first few meaningful words)
        words = clean_title.split()
        if len(words) >= 3:
            # Take first 2-3 meaningful words
            meaningful_words = []
            skip_words = {'in', 'of', 'for', 'with', 'using', 'via', 'through', 'by'}
            
            for word in words[:6]:  # Look at first 6 words
                if len(word) > 2 and word.lower() not in skip_words:
                    meaningful_words.append(word.title())
                if len(meaningful_words) >= 3:
                    break
            
            if meaningful_words:
                return ' '.join(meaningful_words)
        
        # Final fallback
        return f"Research Cluster {cluster_id}"

    def analyze_cluster_by_papers(self, cluster_id: int) -> Dict:
        """Analyze a cluster based on its most influential papers"""
        try:
            influential_papers = self.get_most_influential_papers(cluster_id, 10)
            
            if not influential_papers:
                return self._create_fallback_result(cluster_id, 0)
            
            # Generate cluster name
            cluster_name = self.generate_cluster_name_from_papers(cluster_id, influential_papers)
            
            # Get basic stats
            paper_count = len(influential_papers)
            years = [p['year'] for p in influential_papers if p['year'] != 'Unknown']
            total_citations = sum(p['citation_count'] for p in influential_papers)
            
            # Get top paper details for description
            top_paper = influential_papers[0]
            
            # Create description
            description = f"Research cluster led by '{top_paper['title'][:80]}...' ({top_paper['year']}, {top_paper['citation_count']} citations)"
            
            # Extract keywords from top papers
            keywords = []
            for paper in influential_papers[:5]:
                concepts = self.extract_key_concepts_from_title(paper['title'])
                keywords.extend(concepts)
            
            # Get unique keywords
            unique_keywords = list(dict.fromkeys(keywords))[:5]
            
            return {
                'name': cluster_name,
                'description': description,
                'keywords': unique_keywords,
                'paper_count': paper_count,
                'total_citations': total_citations,
                'top_papers': [
                    {
                        'title': p['title'],
                        'year': p['year'],
                        'citations': p['citation_count']
                    } for p in influential_papers[:5]
                ],
                'quality_score': min(1.0, total_citations / 100.0),  # Based on citation impact
                'year_range': f"{min(years)}-{max(years)}" if years else "Unknown"
            }
            
        except Exception as e:
            logger.error(f"Error analyzing cluster {cluster_id}: {e}")
            return self._create_fallback_result(cluster_id, 0)

    def analyze_all_clusters(self, max_clusters: int = 16) -> Dict[str, Dict]:
        """Analyze all clusters using influential papers approach"""
        logger.info("Starting influential papers-based cluster analysis...")
        
        results = {}
        
        for cluster_id in range(max_clusters):
            logger.info(f"Analyzing cluster {cluster_id}...")
            cluster_info = self.analyze_cluster_by_papers(cluster_id)
            results[str(cluster_id)] = cluster_info
            
            logger.info(f"Cluster {cluster_id}: {cluster_info['name']} ({cluster_info['paper_count']} papers, {cluster_info['total_citations']} total citations)")
        
        return results

    def _create_fallback_result(self, cluster_id: int, paper_count: int) -> Dict:
        """Create a fallback result when analysis fails"""
        return {
            'name': f"Research Cluster {cluster_id}",
            'description': f"Physics research cluster with {paper_count} papers.",
            'keywords': [],
            'paper_count': paper_count,
            'total_citations': 0,
            'top_papers': [],
            'quality_score': 0.1,
            'year_range': "Unknown"
        }

    def save_results(self, results: Dict, output_file: str = "cluster_themes_papers.json"):
        """Save results to JSON file"""
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Results saved to {output_file}")

def main():
    """Main function to run the influential papers-based cluster naming"""
    namer = InfluentialPaperClusterNamer()
    
    logger.info("Starting influential papers-based cluster naming...")
    results = namer.analyze_all_clusters()
    
    # Save results
    namer.save_results(results)
    
    # Print summary
    print("\n" + "="*80)
    print("INFLUENTIAL PAPERS-BASED CLUSTER NAMING RESULTS")
    print("="*80)
    
    for cluster_id, info in results.items():
        print(f"\nCluster {cluster_id}: {info['name']}")
        print(f"  Papers: {info['paper_count']}")
        print(f"  Total Citations: {info['total_citations']}")
        print(f"  Years: {info['year_range']}")
        print(f"  Quality: {info['quality_score']:.2f}")
        if info['top_papers']:
            print(f"  Top Paper: {info['top_papers'][0]['title'][:60]}... ({info['top_papers'][0]['year']}, {info['top_papers'][0]['citations']} citations)")
    
    print("\n" + "="*80)
    print("Analysis complete! Cluster names based on most influential papers.")

if __name__ == "__main__":
    main()