#!/usr/bin/env python3
"""
Minimum Feedback Arc Set (MFAS) Analysis
========================================

Implements heuristics to find the minimum number of edges to remove
to make the largest SCC acyclic (DAG). This is NP-hard, so we use
approximation algorithms.
"""

import sqlite3
import pandas as pd
import networkx as nx
import numpy as np
from typing import Dict, List, Tuple, Any, Set
import logging
from collections import defaultdict, Counter
import time
from tqdm import tqdm
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import argparse
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MFASAnalyzer:
    """Minimum Feedback Arc Set analysis for breaking cycles"""
    
    def __init__(self, db_path: str = "../../data/arxiv_papers.db"):
        self.db_path = Path(db_path)
        self.results = {}
    
    def load_largest_scc(self) -> Tuple[nx.DiGraph, List[str], Dict]:
        """Load the largest SCC from the database"""
        
        logger.info("🔍 Loading largest SCC for MFAS analysis...")
        
        with sqlite3.connect(self.db_path) as conn:
            # Load all citations
            citations_df = pd.read_sql_query(
                "SELECT src, dst FROM filtered_citations", conn
            )
            
            # Create full graph
            G = nx.from_pandas_edgelist(
                citations_df, 
                source='src', 
                target='dst', 
                create_using=nx.DiGraph()
            )
            
            # Find SCCs
            logger.info("Computing SCCs to find the largest one...")
            sccs = list(nx.strongly_connected_components(G))
            largest_scc = max(sccs, key=len)
            
            logger.info(f"Found largest SCC with {len(largest_scc):,} nodes")
            
            # Create subgraph of largest SCC
            scc_graph = G.subgraph(largest_scc).copy()
            
            # Load metadata for nodes in largest SCC
            paper_ids_str = "', '".join(largest_scc)
            papers_query = f"""
            SELECT 
                fp.paper_id,
                fp.title,
                fp.year,
                fp.external_arxiv_id,
                fp.cluster_id,
                fp.embedding_x,
                fp.embedding_y,
                fp.degree,
                ap.submitted_date,
                ap.first_seen_date
            FROM filtered_papers fp
            LEFT JOIN arxiv_papers ap ON fp.external_arxiv_id = ap.arxiv_id
            WHERE fp.paper_id IN ('{paper_ids_str}')
            """
            
            papers_df = pd.read_sql_query(papers_query, conn)
            
            # Convert dates
            papers_df['submitted_date'] = pd.to_datetime(papers_df['submitted_date'], errors='coerce')
            papers_df['precise_date'] = papers_df['submitted_date']
            papers_df.loc[papers_df['precise_date'].isna(), 'precise_date'] = pd.to_datetime(
                papers_df.loc[papers_df['precise_date'].isna(), 'year'].astype(str) + '-01-01'
            )
            
            # Add node attributes
            paper_attrs = papers_df.set_index('paper_id').to_dict('index')
            nx.set_node_attributes(scc_graph, paper_attrs)
            
            logger.info(f"✅ Largest SCC loaded: {scc_graph.number_of_nodes():,} nodes, {scc_graph.number_of_edges():,} edges")
            
            return scc_graph, list(largest_scc), paper_attrs
    
    def fast_feedback_arc_set(self, G: nx.DiGraph) -> Tuple[Set[Tuple], nx.DiGraph]:
        """
        Greedy heuristic for Feedback Arc Set using node ordering.
        Faster alternative to explicit cycle enumeration.
        Based on Eades, Lin, Smyth heuristic.
        """
        logger.info("⚡ Fast greedy MFAS using node ordering heuristic...")
        
        G_copy = G.copy()
        removed_edges = set()
        
        # Score = out_degree - in_degree
        scores = {n: G_copy.out_degree(n) - G_copy.in_degree(n) for n in G_copy.nodes()}
        ordering = []
        
        while scores:
            # Select node with highest score
            node = max(scores.items(), key=lambda x: x[1])[0]
            ordering.append(node)
            # Remove from score table
            del scores[node]
            # Update scores
            for neighbor in G_copy.successors(node):
                if neighbor in scores:
                    scores[neighbor] -= 1
            for neighbor in G_copy.predecessors(node):
                if neighbor in scores:
                    scores[neighbor] += 1
        
        # Build position lookup
        pos = {node: i for i, node in enumerate(ordering)}
        
        # Remove backward edges
        for u, v in G_copy.edges():
            if pos[u] > pos[v]:  # Backward in order
                removed_edges.add((u, v))
        
        G_copy.remove_edges_from(removed_edges)
        logger.info(f"✅ Fast MFAS complete: removed {len(removed_edges):,} edges")
        return removed_edges, G_copy
    
    def greedy_cycle_breaking(self, G: nx.DiGraph) -> Tuple[Set[Tuple], nx.DiGraph]:
        """
        Greedy heuristic for finding feedback arc set
        Remove edges that break the most cycles
        """
        
        logger.info("🔄 Running greedy cycle-breaking heuristic...")
        
        G_copy = G.copy()
        removed_edges = set()
        
        # Keep track of cycles broken
        cycles_broken = 0
        
        while not nx.is_directed_acyclic_graph(G_copy):
            # Find all cycles
            try:
                cycles = list(nx.simple_cycles(G_copy))
            except nx.NetworkXNoCycle:
                break
            
            if not cycles:
                break
            
            # Count how many cycles each edge participates in
            edge_cycle_count = defaultdict(int)
            
            for cycle in cycles:
                for i in range(len(cycle)):
                    edge = (cycle[i], cycle[(i + 1) % len(cycle)])
                    edge_cycle_count[edge] += 1
            
            if not edge_cycle_count:
                break
            
            # Remove the edge that breaks the most cycles
            best_edge = max(edge_cycle_count.items(), key=lambda x: x[1])
            edge_to_remove = best_edge[0]
            
            G_copy.remove_edge(*edge_to_remove)
            removed_edges.add(edge_to_remove)
            cycles_broken += best_edge[1]
            
            if len(removed_edges) % 100 == 0:
                logger.info(f"Removed {len(removed_edges):,} edges, broke {cycles_broken} cycles")
        
        logger.info(f"✅ Greedy algorithm complete: removed {len(removed_edges):,} edges")
        return removed_edges, G_copy
    
    def topological_sort_breaking(self, G: nx.DiGraph) -> Tuple[Set[Tuple], nx.DiGraph]:
        """
        Break cycles using topological sort approach
        Assign ranks to nodes and remove edges that go backwards
        """
        
        logger.info("🔄 Running topological sort-based cycle breaking...")
        
        G_copy = G.copy()
        removed_edges = set()
        
        # Use a simpler approach: find cycles and remove edges
        # This is a simplified version that doesn't try to do full cycle detection
        
        # Get all edges
        all_edges = list(G_copy.edges())
        
        # Simple heuristic: remove edges that create immediate cycles
        # For each edge, check if removing it would help break cycles
        edges_to_remove = []
        
        for u, v in all_edges:
            # Temporarily remove the edge
            G_copy.remove_edge(u, v)
            
            # Check if this creates a DAG
            try:
                # Try to do a topological sort
                list(nx.topological_sort(G_copy))
                # If successful, this edge was part of a cycle
                edges_to_remove.append((u, v))
            except nx.NetworkXError:
                # Still has cycles, restore the edge
                G_copy.add_edge(u, v)
        
        # Remove the identified edges
        for u, v in edges_to_remove:
            G_copy.remove_edge(u, v)
            removed_edges.add((u, v))
        
        logger.info(f"✅ Topological sort breaking complete: removed {len(removed_edges):,} edges")
        return removed_edges, G_copy
    
    def chronological_breaking(self, G: nx.DiGraph) -> Tuple[Set[Tuple], nx.DiGraph]:
        """
        Break cycles using chronological order
        Remove edges that go from newer to older papers
        """
        
        logger.info("🔄 Running chronological cycle breaking...")
        
        G_copy = G.copy()
        removed_edges = set()
        
        # Get dates for all nodes
        node_dates = {}
        for node in G_copy.nodes():
            node_data = G_copy.nodes[node]
            precise_date = node_data.get('precise_date')
            year = node_data.get('year')
            
            if precise_date is not None and not pd.isna(precise_date):
                node_dates[node] = precise_date
            elif year is not None:
                node_dates[node] = pd.to_datetime(f"{year}-01-01")
        
        # Count edges that violate chronological order
        chronological_violations = 0
        total_edges = G_copy.number_of_edges()
        
        for src, dst in list(G_copy.edges()):
            src_date = node_dates.get(src)
            dst_date = node_dates.get(dst)
            
            if src_date is not None and dst_date is not None:
                if src_date > dst_date:  # Newer paper citing older paper (normal)
                    continue
                elif src_date < dst_date:  # Older paper citing newer paper (violation)
                    G_copy.remove_edge(src, dst)
                    removed_edges.add((src, dst))
                    chronological_violations += 1
                else:  # Same date
                    # Keep edge but mark as potential violation
                    pass
        
        logger.info(f"✅ Chronological breaking complete: removed {len(removed_edges):,} edges")
        logger.info(f"📅 Chronological violations: {chronological_violations:,} / {total_edges:,} ({chronological_violations/total_edges*100:.2f}%)")
        
        return removed_edges, G_copy
    
    def analyze_removed_edges(self, G: nx.DiGraph, removed_edges: Set[Tuple], method_name: str) -> Dict:
        """Analyze the characteristics of removed edges"""
        
        logger.info(f"📊 Analyzing removed edges for {method_name}...")
        
        # Get edge characteristics
        edge_analysis = {
            'total_removed': len(removed_edges),
            'method': method_name,
            'edge_details': []
        }
        
        for src, dst in list(removed_edges)[:100]:  # Sample first 100 edges
            src_data = G.nodes[src]
            dst_data = G.nodes[dst]
            
            edge_info = {
                'src': src,
                'dst': dst,
                'src_year': src_data.get('year'),
                'dst_year': dst_data.get('year'),
                'src_date': src_data.get('precise_date'),
                'dst_date': dst_data.get('precise_date'),
                'src_cluster': src_data.get('cluster_id'),
                'dst_cluster': dst_data.get('cluster_id')
            }
            
            # Calculate date difference if available
            if edge_info['src_date'] is not None and edge_info['dst_date'] is not None:
                edge_info['date_diff_days'] = (edge_info['src_date'] - edge_info['dst_date']).days
            else:
                edge_info['date_diff_days'] = None
            
            edge_analysis['edge_details'].append(edge_info)
        
        # Calculate statistics
        if edge_analysis['edge_details']:
            date_diffs = [e['date_diff_days'] for e in edge_analysis['edge_details'] if e['date_diff_days'] is not None]
            if date_diffs:
                edge_analysis['avg_date_diff'] = np.mean(date_diffs)
                edge_analysis['min_date_diff'] = min(date_diffs)
                edge_analysis['max_date_diff'] = max(date_diffs)
            
            # Cluster analysis
            same_cluster = sum(1 for e in edge_analysis['edge_details'] 
                             if e['src_cluster'] == e['dst_cluster'] and e['src_cluster'] is not None)
            edge_analysis['same_cluster_ratio'] = same_cluster / len(edge_analysis['edge_details'])
        
        return edge_analysis
    
    def run_all_mfas_methods(self) -> Dict:
        """Run all MFAS methods and compare results"""
        
        logger.info("🚀 Starting comprehensive MFAS analysis...")
        
        # Load largest SCC
        scc_graph, scc_nodes, node_attrs = self.load_largest_scc()
        
        original_edges = scc_graph.number_of_edges()
        original_nodes = scc_graph.number_of_nodes()
        
        logger.info(f"📊 Original SCC: {original_nodes:,} nodes, {original_edges:,} edges")
        
        results = {
            'original_graph': {
                'nodes': original_nodes,
                'edges': original_edges,
                'density': nx.density(scc_graph)
            },
            'methods': {}
        }
        
        # Method 1: Fast Feedback Arc Set
        logger.info("\n" + "="*50)
        logger.info("METHOD 1: Fast Feedback Arc Set")
        logger.info("="*50)
        
        start_time = time.time()
        fast_edges, fast_graph = self.fast_feedback_arc_set(scc_graph.copy())
        fast_time = time.time() - start_time
        
        results['methods']['fast'] = {
            'removed_edges': len(fast_edges),
            'remaining_edges': fast_graph.number_of_edges(),
            'removal_percentage': len(fast_edges) / original_edges * 100,
            'computation_time': fast_time,
            'is_dag': nx.is_directed_acyclic_graph(fast_graph),
            'edge_analysis': self.analyze_removed_edges(scc_graph, fast_edges, "Fast")
        }
        
        # Method 2: Chronological breaking
        logger.info("\n" + "="*50)
        logger.info("METHOD 2: Chronological Breaking")
        logger.info("="*50)
        
        start_time = time.time()
        chrono_edges, chrono_graph = self.chronological_breaking(scc_graph.copy())
        chrono_time = time.time() - start_time
        
        results['methods']['chronological'] = {
            'removed_edges': len(chrono_edges),
            'remaining_edges': chrono_graph.number_of_edges(),
            'removal_percentage': len(chrono_edges) / original_edges * 100,
            'computation_time': chrono_time,
            'is_dag': nx.is_directed_acyclic_graph(chrono_graph),
            'edge_analysis': self.analyze_removed_edges(scc_graph, chrono_edges, "Chronological")
        }
        
        self.results = results
        return results
    
    def generate_mfas_report(self, output_file: str = "mfas_analysis_report.txt"):
        """Generate comprehensive MFAS analysis report"""
        
        logger.info("📋 Generating MFAS analysis report")
        
        with open(output_file, 'w') as f:
            f.write("MINIMUM FEEDBACK ARC SET (MFAS) ANALYSIS\n")
            f.write("=" * 60 + "\n\n")
            
            # Original graph info
            original = self.results['original_graph']
            f.write("ORIGINAL LARGEST SCC:\n")
            f.write("-" * 30 + "\n")
            f.write(f"Nodes: {original['nodes']:,}\n")
            f.write(f"Edges: {original['edges']:,}\n")
            f.write(f"Density: {original['density']:.6f}\n\n")
            
            # Method comparison
            f.write("MFAS METHOD COMPARISON:\n")
            f.write("-" * 30 + "\n")
            f.write(f"{'Method':<15} {'Edges Removed':<15} {'Removal %':<12} {'Time (s)':<10} {'Is DAG':<8}\n")
            f.write("-" * 70 + "\n")
            
            for method_name, method_result in self.results['methods'].items():
                f.write(f"{method_name:<15} {method_result['removed_edges']:<15,} "
                       f"{method_result['removal_percentage']:<12.2f} "
                       f"{method_result['computation_time']:<10.3f} "
                       f"{'✓' if method_result['is_dag'] else '✗':<8}\n")
            
            f.write("\n")
            
            # Detailed analysis for each method
            for method_name, method_result in self.results['methods'].items():
                f.write(f"DETAILED ANALYSIS: {method_name.upper()}\n")
                f.write("-" * 40 + "\n")
                f.write(f"Edges removed: {method_result['removed_edges']:,} ({method_result['removal_percentage']:.2f}%)\n")
                f.write(f"Remaining edges: {method_result['remaining_edges']:,}\n")
                f.write(f"Computation time: {method_result['computation_time']:.3f} seconds\n")
                f.write(f"Result is DAG: {'✓ YES' if method_result['is_dag'] else '✗ NO'}\n")
                
                # Edge analysis
                edge_analysis = method_result['edge_analysis']
                if edge_analysis['edge_details']:
                    f.write(f"\nEdge Analysis (sample of {len(edge_analysis['edge_details'])} edges):\n")
                    
                    if 'avg_date_diff' in edge_analysis:
                        f.write(f"  Average date difference: {edge_analysis['avg_date_diff']:.1f} days\n")
                        f.write(f"  Date range: {edge_analysis['min_date_diff']} to {edge_analysis['max_date_diff']} days\n")
                    
                    if 'same_cluster_ratio' in edge_analysis:
                        f.write(f"  Same cluster edges: {edge_analysis['same_cluster_ratio']*100:.1f}%\n")
                
                f.write("\n")
            
            # Recommendations
            f.write("RECOMMENDATIONS:\n")
            f.write("-" * 20 + "\n")
            
            best_method = min(self.results['methods'].items(), 
                            key=lambda x: x[1]['removed_edges'])
            
            f.write(f"Best method: {best_method[0]} (removes {best_method[1]['removed_edges']:,} edges)\n")
            f.write(f"Minimum edges to remove: {best_method[1]['removed_edges']:,}\n")
            f.write(f"Removal percentage: {best_method[1]['removal_percentage']:.2f}%\n\n")
            
            if best_method[1]['removal_percentage'] < 5:
                f.write("✅ Low removal percentage - cycles are manageable\n")
                f.write("→ Consider using DAG algorithms with minor adaptations\n")
            elif best_method[1]['removal_percentage'] < 15:
                f.write("⚠️  Moderate removal percentage - cycles are significant\n")
                f.write("→ Use SCC condensation or cycle-aware algorithms\n")
            else:
                f.write("❌ High removal percentage - cycles are dominant\n")
                f.write("→ Strongly recommend SCC-aware algorithms\n")
        
        logger.info(f"📋 MFAS report saved to {output_file}")
    
    def plot_mfas_comparison(self, output_file: str = "mfas_comparison.png"):
        """Plot comparison of MFAS methods"""
        
        if not self.results:
            logger.warning("⚠️  No MFAS results to plot")
            return
        
        # Create comparison plot
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 12))
        
        methods = list(self.results['methods'].keys())
        edges_removed = [self.results['methods'][m]['removed_edges'] for m in methods]
        removal_percentages = [self.results['methods'][m]['removal_percentage'] for m in methods]
        computation_times = [self.results['methods'][m]['computation_time'] for m in methods]
        is_dag = [self.results['methods'][m]['is_dag'] for m in methods]
        
        # Plot 1: Edges removed
        bars1 = ax1.bar(methods, edges_removed, color=['#ff7f0e', '#2ca02c', '#d62728'])
        ax1.set_title('Edges Removed by Method')
        ax1.set_ylabel('Number of Edges')
        ax1.tick_params(axis='x', rotation=45)
        
        # Add value labels on bars
        for bar, value in zip(bars1, edges_removed):
            ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(edges_removed)*0.01,
                    f'{value:,}', ha='center', va='bottom')
        
        # Plot 2: Removal percentage
        bars2 = ax2.bar(methods, removal_percentages, color=['#ff7f0e', '#2ca02c', '#d62728'])
        ax2.set_title('Removal Percentage by Method')
        ax2.set_ylabel('Percentage (%)')
        ax2.tick_params(axis='x', rotation=45)
        
        # Add value labels on bars
        for bar, value in zip(bars2, removal_percentages):
            ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(removal_percentages)*0.01,
                    f'{value:.1f}%', ha='center', va='bottom')
        
        # Plot 3: Computation time
        bars3 = ax3.bar(methods, computation_times, color=['#ff7f0e', '#2ca02c', '#d62728'])
        ax3.set_title('Computation Time by Method')
        ax3.set_ylabel('Time (seconds)')
        ax3.tick_params(axis='x', rotation=45)
        
        # Add value labels on bars
        for bar, value in zip(bars3, computation_times):
            ax3.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(computation_times)*0.01,
                    f'{value:.3f}s', ha='center', va='bottom')
        
        # Plot 4: Success rate (DAG creation)
        colors = ['#d62728' if not dag else '#2ca02c' for dag in is_dag]
        bars4 = ax4.bar(methods, [1 if dag else 0 for dag in is_dag], color=colors)
        ax4.set_title('DAG Creation Success')
        ax4.set_ylabel('Success (1=Yes, 0=No)')
        ax4.set_ylim(0, 1.2)
        ax4.tick_params(axis='x', rotation=45)
        
        # Add labels
        for bar, dag in zip(bars4, is_dag):
            ax4.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.1,
                    '✓ DAG' if dag else '✗ Not DAG', ha='center', va='bottom')
        
        plt.tight_layout()
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"📊 MFAS comparison plot saved to {output_file}")


def main():
    """Run MFAS analysis on the largest SCC"""
    
    parser = argparse.ArgumentParser(description='Minimum Feedback Arc Set Analysis')
    parser.add_argument('--db-path', default='../../data/arxiv_papers.db', 
                       help='Path to the SQLite database')
    parser.add_argument('--output-prefix', default='mfas',
                       help='Prefix for output files')
    
    args = parser.parse_args()
    
    print("🧠 MINIMUM FEEDBACK ARC SET (MFAS) ANALYSIS")
    print("=" * 60)
    print("Breaking the largest SCC into a DAG using heuristics")
    print("=" * 60)
    
    # Initialize analyzer
    analyzer = MFASAnalyzer(args.db_path)
    
    # Run all MFAS methods
    results = analyzer.run_all_mfas_methods()
    
    # Generate reports
    analyzer.generate_mfas_report(f"{args.output_prefix}_report.txt")
    analyzer.plot_mfas_comparison(f"{args.output_prefix}_comparison.png")
    
    print("\n✅ MFAS analysis complete! Check these files:")
    print(f"  📋 {args.output_prefix}_report.txt - Detailed MFAS analysis")
    print(f"  📊 {args.output_prefix}_comparison.png - Method comparison plot")
    
    # Quick summary
    best_method = min(results['methods'].items(), key=lambda x: x[1]['removed_edges'])
    print(f"\n🎯 QUICK SUMMARY:")
    print(f"  • Largest SCC: {results['original_graph']['nodes']:,} nodes, {results['original_graph']['edges']:,} edges")
    print(f"  • Best method: {best_method[0]} (removes {best_method[1]['removed_edges']:,} edges)")
    print(f"  • Removal percentage: {best_method[1]['removal_percentage']:.2f}%")
    print(f"  • Result is DAG: {'✓ YES' if best_method[1]['is_dag'] else '✗ NO'}")


if __name__ == "__main__":
    main() 