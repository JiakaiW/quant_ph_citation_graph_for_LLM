#!/usr/bin/env python3
"""
Full Citation Graph Acyclicity Analysis
=======================================

Comprehensive analysis using precise dates (up to day) on the complete filtered graph.
Implements all three methods from ChatGPT's suggestions with enhanced chronological precision.
"""

import sqlite3
import pandas as pd
import networkx as nx
import numpy as np
from typing import Dict, List, Tuple, Any
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

class FullAcyclicityAnalyzer:
    """Complete acyclicity analysis with precise date handling"""
    
    def __init__(self, db_path: str = "../../data/arxiv_papers.db"):
        self.db_path = Path(db_path)
        self.results = {}
        
    def load_full_graph_with_precise_dates(self) -> Tuple[nx.DiGraph, pd.DataFrame]:
        """Load the complete filtered graph with precise submission dates"""
        
        logger.info("🔍 Loading complete filtered citation graph with precise dates...")
        
        with sqlite3.connect(self.db_path) as conn:
            # Load all citations from filtered_citations
            logger.info("Loading all citations...")
            citations_df = pd.read_sql_query(
                "SELECT src, dst FROM filtered_citations", conn
            )
            logger.info(f"Loaded {len(citations_df):,} citations")
            
            # Get unique paper IDs
            paper_ids = set(citations_df['src'].unique()) | set(citations_df['dst'].unique())
            logger.info(f"Found {len(paper_ids):,} unique papers in citation network")
            
            # Load paper metadata with precise dates
            paper_ids_str = "', '".join(paper_ids)
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
            
            logger.info("Loading paper metadata with precise dates...")
            papers_df = pd.read_sql_query(papers_query, conn)
            logger.info(f"Loaded metadata for {len(papers_df):,} papers")
            
            # Convert dates to datetime objects
            papers_df['submitted_date'] = pd.to_datetime(papers_df['submitted_date'], errors='coerce')
            papers_df['first_seen_date'] = pd.to_datetime(papers_df['first_seen_date'], errors='coerce')
            
            # Create a precise date field (prefer submitted_date, fallback to year)
            papers_df['precise_date'] = papers_df['submitted_date']
            papers_df.loc[papers_df['precise_date'].isna(), 'precise_date'] = pd.to_datetime(
                papers_df.loc[papers_df['precise_date'].isna(), 'year'].astype(str) + '-01-01'
            )
            
            # Count date coverage
            precise_date_coverage = papers_df['submitted_date'].notna().sum()
            logger.info(f"Papers with precise submission dates: {precise_date_coverage:,} / {len(papers_df):,} ({precise_date_coverage/len(papers_df)*100:.1f}%)")
        
        # Create NetworkX directed graph
        logger.info("Building NetworkX graph...")
        G = nx.from_pandas_edgelist(
            citations_df, 
            source='src', 
            target='dst', 
            create_using=nx.DiGraph()
        )
        
        # Add node attributes
        paper_attrs = papers_df.set_index('paper_id').to_dict('index')
        nx.set_node_attributes(G, paper_attrs)
        
        logger.info(f"✅ Graph created: {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges")
        
        return G, papers_df
    
    def method_1_topological_sort_test(self, G: nx.DiGraph) -> Dict[str, Any]:
        """Method 1: Topological-sort smoke test"""
        
        logger.info("🔍 METHOD 1: Topological Sort Test")
        logger.info("Testing if the graph is a Directed Acyclic Graph (DAG)")
        
        start_time = time.time()
        is_dag = nx.is_directed_acyclic_graph(G)
        elapsed = time.time() - start_time
        
        result = {
            'is_dag': is_dag,
            'node_count': G.number_of_nodes(),
            'edge_count': G.number_of_edges(),
            'computation_time_seconds': elapsed
        }
        
        logger.info(f"✅ Result: {'✓ Perfect DAG' if is_dag else '✗ Contains cycles'}")
        logger.info(f"⏱️  Computation time: {elapsed:.3f} seconds")
        
        self.results['topological_sort'] = result
        return result
    
    def method_2_scc_analysis(self, G: nx.DiGraph) -> Dict[str, Any]:
        """Method 2: SCC (Strongly Connected Components) statistics"""
        
        logger.info("🔍 METHOD 2: SCC Analysis")
        logger.info("Analyzing Strongly Connected Components to find cycle structure")
        
        start_time = time.time()
        
        # Find all strongly connected components
        logger.info("Computing SCCs using Tarjan's algorithm...")
        sccs = list(nx.strongly_connected_components(G))
        
        # Analyze SCC sizes
        scc_sizes = [len(scc) for scc in sccs]
        multi_node_sccs = [scc for scc in sccs if len(scc) > 1]
        multi_node_scc_sizes = [len(scc) for scc in multi_node_sccs]
        
        # Count edges within SCCs
        edges_in_sccs = 0
        scc_details = []
        
        for i, scc in enumerate(multi_node_sccs):
            scc_subgraph = G.subgraph(scc)
            scc_edges = scc_subgraph.number_of_edges()
            edges_in_sccs += scc_edges
            
            # Get some metadata for the largest SCCs
            if len(scc) >= 5:  # Only store details for significant SCCs
                scc_details.append({
                    'scc_id': i,
                    'size': len(scc),
                    'edges': scc_edges,
                    'all_nodes': list(scc),  # Store all nodes for date analysis
                    'sample_nodes': list(scc)[:10],  # Store first 10 nodes for inspection
                    'avg_year': np.mean([G.nodes[node].get('year', 0) for node in scc if G.nodes[node].get('year')])
                })
        
        elapsed = time.time() - start_time
        
        result = {
            'total_sccs': len(sccs),
            'singleton_sccs': len(sccs) - len(multi_node_sccs),
            'non_trivial_sccs': len(multi_node_sccs),
            'largest_scc_size': max(scc_sizes),
            'scc_size_distribution': Counter(scc_sizes),
            'multi_node_scc_sizes': multi_node_scc_sizes,
            'edges_in_sccs': edges_in_sccs,
            'percentage_nodes_in_cycles': (sum(multi_node_scc_sizes) / G.number_of_nodes()) * 100,
            'percentage_edges_in_cycles': (edges_in_sccs / G.number_of_edges()) * 100,
            'scc_details': scc_details,
            'computation_time_seconds': elapsed
        }
        
        # Log results
        logger.info(f"📊 Total SCCs: {result['total_sccs']:,}")
        logger.info(f"📊 Singleton SCCs: {result['singleton_sccs']:,} ({result['singleton_sccs']/result['total_sccs']*100:.2f}%)")
        logger.info(f"📊 Non-trivial SCCs: {result['non_trivial_sccs']:,}")
        logger.info(f"📊 Largest SCC size: {result['largest_scc_size']:,}")
        logger.info(f"📊 Nodes in cycles: {sum(multi_node_scc_sizes):,} ({result['percentage_nodes_in_cycles']:.3f}%)")
        logger.info(f"📊 Edges in cycles: {result['edges_in_sccs']:,} ({result['percentage_edges_in_cycles']:.3f}%)")
        logger.info(f"⏱️  Computation time: {elapsed:.3f} seconds")
        
        self.results['scc_analysis'] = result
        return result
    
    def method_3_precise_feedback_edge_analysis(self, G: nx.DiGraph) -> Dict[str, Any]:
        """Method 3: Feedback-edge fraction with precise dates (up to day)"""
        
        logger.info("🔍 METHOD 3: Precise Feedback Edge Analysis")
        logger.info("Analyzing chronological violations using precise submission dates")
        
        start_time = time.time()
        
        # Get precise date information for nodes
        date_dict = {}
        papers_with_precise_dates = 0
        
        for node in G.nodes():
            node_data = G.nodes[node]
            precise_date = node_data.get('precise_date')
            if precise_date is not None and not pd.isna(precise_date):
                date_dict[node] = precise_date
                papers_with_precise_dates += 1
        
        logger.info(f"📅 Papers with precise dates: {papers_with_precise_dates:,} / {G.number_of_nodes():,} ({papers_with_precise_dates/G.number_of_nodes()*100:.1f}%)")
        
        if papers_with_precise_dates < G.number_of_nodes() * 0.5:
            logger.warning("⚠️  Less than 50% of papers have precise date information")
        
        # Analyze edges for chronological violations
        total_edges_with_dates = 0
        forward_edges = 0  # src_date <= dst_date (chronologically correct)
        backward_edges = 0  # src_date > dst_date (chronological violation)
        same_day_edges = 0
        same_month_edges = 0
        same_year_edges = 0
        
        backward_edge_details = []
        forward_edge_details = []
        
        for src, dst in tqdm(G.edges(), desc="Analyzing edge chronology"):
            src_date = date_dict.get(src)
            dst_date = date_dict.get(dst)
            
            if src_date is not None and dst_date is not None:
                total_edges_with_dates += 1
                
                if src_date < dst_date:
                    forward_edges += 1
                    # Store some forward edge details for analysis
                    if len(forward_edge_details) < 50:
                        forward_edge_details.append({
                            'src': src,
                            'dst': dst,
                            'src_date': src_date.strftime('%Y-%m-%d'),
                            'dst_date': dst_date.strftime('%Y-%m-%d'),
                            'date_diff_days': (dst_date - src_date).days
                        })
                elif src_date > dst_date:
                    backward_edges += 1
                    # Store details of backward edges
                    if len(backward_edge_details) < 100:
                        backward_edge_details.append({
                            'src': src,
                            'dst': dst,
                            'src_date': src_date.strftime('%Y-%m-%d'),
                            'dst_date': dst_date.strftime('%Y-%m-%d'),
                            'date_diff_days': (src_date - dst_date).days
                        })
                else:  # same date
                    same_day_edges += 1
                
                # Additional categorization
                if src_date.year == dst_date.year:
                    same_year_edges += 1
                    if src_date.month == dst_date.month:
                        same_month_edges += 1
        
        elapsed = time.time() - start_time
        
        if total_edges_with_dates == 0:
            logger.error("❌ No edges with date information found")
            result = {
                'method_available': False,
                'reason': 'No edges with date information'
            }
        else:
            backward_ratio = backward_edges / total_edges_with_dates
            
            result = {
                'method_available': True,
                'total_edges': G.number_of_edges(),
                'edges_with_dates': total_edges_with_dates,
                'coverage_percentage': (total_edges_with_dates / G.number_of_edges()) * 100,
                'forward_edges': forward_edges,
                'backward_edges': backward_edges,
                'same_day_edges': same_day_edges,
                'same_month_edges': same_month_edges,
                'same_year_edges': same_year_edges,
                'backward_edge_ratio': backward_ratio,
                'backward_edge_percentage': backward_ratio * 100,
                'backward_edge_details': backward_edge_details,
                'forward_edge_details': forward_edge_details,
                'computation_time_seconds': elapsed
            }
            
            # Log results
            logger.info(f"📅 Edges with precise dates: {total_edges_with_dates:,} / {G.number_of_edges():,} ({result['coverage_percentage']:.1f}%)")
            logger.info(f"📅 Forward citations: {forward_edges:,} ({forward_edges/total_edges_with_dates*100:.2f}%)")
            logger.info(f"📅 Backward citations: {backward_edges:,} ({result['backward_edge_percentage']:.3f}%)")
            logger.info(f"📅 Same-day citations: {same_day_edges:,} ({same_day_edges/total_edges_with_dates*100:.2f}%)")
            logger.info(f"📅 Same-month citations: {same_month_edges:,} ({same_month_edges/total_edges_with_dates*100:.2f}%)")
            logger.info(f"📅 Same-year citations: {same_year_edges:,} ({same_year_edges/total_edges_with_dates*100:.2f}%)")
            
            # Interpretation
            if backward_ratio < 0.001:
                logger.info("✅ Very few chronological violations (<0.1%) - nearly acyclic")
            elif backward_ratio < 0.01:
                logger.info("✅ Few chronological violations (<1%) - mostly acyclic") 
            elif backward_ratio < 0.1:
                logger.info("⚠️  Some chronological violations (<10%) - somewhat cyclic")
            else:
                logger.info("❌ Many chronological violations (>10%) - significantly cyclic")
        
        logger.info(f"⏱️  Computation time: {elapsed:.3f} seconds")
        
        self.results['feedback_edge'] = result
        return result
    
    def generate_comprehensive_report(self, G: nx.DiGraph, output_file: str = "full_acyclicity_report.txt") -> Dict[str, Any]:
        """Generate comprehensive acyclicity analysis report"""
        
        logger.info("📋 Generating comprehensive acyclicity report")
        
        all_results = {
            'graph_stats': {
                'nodes': G.number_of_nodes(),
                'edges': G.number_of_edges(),
                'density': nx.density(G),
                'weakly_connected_components': nx.number_weakly_connected_components(G),
                'strongly_connected_components': nx.number_strongly_connected_components(G)
            },
            'analysis_results': self.results
        }
        
        # Write detailed report
        with open(output_file, 'w') as f:
            f.write("FULL CITATION GRAPH ACYCLICITY ANALYSIS (PRECISE DATES)\n")
            f.write("=" * 70 + "\n\n")
            
            # Graph overview
            f.write("GRAPH OVERVIEW:\n")
            f.write(f"  Nodes: {G.number_of_nodes():,}\n")
            f.write(f"  Edges: {G.number_of_edges():,}\n")
            f.write(f"  Density: {nx.density(G):.8f}\n")
            f.write(f"  Weakly Connected Components: {nx.number_weakly_connected_components(G):,}\n")
            f.write(f"  Strongly Connected Components: {nx.number_strongly_connected_components(G):,}\n\n")
            
            # Method 1 Results
            if 'topological_sort' in self.results:
                f.write("METHOD 1: TOPOLOGICAL SORT TEST\n")
                f.write("-" * 40 + "\n")
                topo_result = self.results['topological_sort']
                f.write(f"Is DAG: {'✓ YES' if topo_result['is_dag'] else '✗ NO'}\n")
                f.write(f"Computation time: {topo_result['computation_time_seconds']:.3f} seconds\n\n")
            
            # Method 2 Results
            if 'scc_analysis' in self.results:
                f.write("METHOD 2: STRONGLY CONNECTED COMPONENTS\n")
                f.write("-" * 40 + "\n")
                scc_result = self.results['scc_analysis']
                f.write(f"Total SCCs: {scc_result['total_sccs']:,}\n")
                f.write(f"Singleton SCCs: {scc_result['singleton_sccs']:,} ({scc_result['singleton_sccs']/scc_result['total_sccs']*100:.2f}%)\n")
                f.write(f"Non-trivial SCCs: {scc_result['non_trivial_sccs']:,}\n")
                f.write(f"Largest SCC: {scc_result['largest_scc_size']:,} nodes\n")
                f.write(f"Nodes in cycles: {scc_result['percentage_nodes_in_cycles']:.3f}%\n")
                f.write(f"Edges in cycles: {scc_result['percentage_edges_in_cycles']:.3f}%\n")
                f.write(f"Computation time: {scc_result['computation_time_seconds']:.3f} seconds\n\n")
                
                # SCC size distribution
                f.write("SCC Size Distribution:\n")
                for size, count in sorted(scc_result['scc_size_distribution'].items()):
                    if size > 1:  # Only show non-trivial SCCs
                        f.write(f"  Size {size}: {count} SCCs\n")
                f.write("\n")
                
                # Large SCC details
                if scc_result['scc_details']:
                    f.write("Large SCC Details (Size >= 5):\n")
                    for scc in scc_result['scc_details'][:10]:  # Show first 10
                        f.write(f"  SCC {scc['scc_id']}: {scc['size']} nodes, {scc['edges']} edges, avg_year: {scc['avg_year']:.1f}\n")
                    f.write("\n")
            
            # Method 3 Results
            if 'feedback_edge' in self.results:
                f.write("METHOD 3: PRECISE FEEDBACK EDGE ANALYSIS (Chronological)\n")
                f.write("-" * 40 + "\n")
                feedback_result = self.results['feedback_edge']
                
                if feedback_result.get('method_available', False):
                    f.write(f"Coverage: {feedback_result['coverage_percentage']:.1f}% of edges have precise date data\n")
                    f.write(f"Forward citations: {feedback_result['forward_edges']:,} ({feedback_result['forward_edges']/feedback_result['edges_with_dates']*100:.2f}%)\n")
                    f.write(f"Backward citations: {feedback_result['backward_edges']:,} ({feedback_result['backward_edge_percentage']:.3f}%)\n")
                    f.write(f"Same-day citations: {feedback_result['same_day_edges']:,} ({feedback_result['same_day_edges']/feedback_result['edges_with_dates']*100:.2f}%)\n")
                    f.write(f"Same-month citations: {feedback_result['same_month_edges']:,} ({feedback_result['same_month_edges']/feedback_result['edges_with_dates']*100:.2f}%)\n")
                    f.write(f"Same-year citations: {feedback_result['same_year_edges']:,} ({feedback_result['same_year_edges']/feedback_result['edges_with_dates']*100:.2f}%)\n")
                    f.write(f"Computation time: {feedback_result['computation_time_seconds']:.3f} seconds\n")
                else:
                    f.write(f"Not available: {feedback_result.get('reason', 'Unknown')}\n")
                f.write("\n")
            
            # Overall assessment
            f.write("OVERALL ASSESSMENT:\n")
            f.write("-" * 40 + "\n")
            
            if 'scc_analysis' in self.results:
                scc_result = self.results['scc_analysis']
                if scc_result['percentage_nodes_in_cycles'] < 0.1:
                    f.write("✅ HIGHLY ACYCLIC: >99.9% of nodes are not in cycles\n")
                elif scc_result['percentage_nodes_in_cycles'] < 1.0:
                    f.write("✅ MOSTLY ACYCLIC: >99% of nodes are not in cycles\n")
                elif scc_result['percentage_nodes_in_cycles'] < 5.0:
                    f.write("⚠️  SOMEWHAT ACYCLIC: >95% of nodes are not in cycles\n")
                else:
                    f.write("❌ SIGNIFICANTLY CYCLIC: <95% of nodes are not in cycles\n")
                
                f.write(f"\nRecommendation for graph algorithms:\n")
                if scc_result['largest_scc_size'] <= 5 and scc_result['percentage_edges_in_cycles'] < 0.1:
                    f.write("→ Safe to treat as DAG for most purposes\n")
                    f.write("→ Spanning forest per component is sufficient\n")
                elif scc_result['non_trivial_sccs'] < 100 and scc_result['largest_scc_size'] < 50:
                    f.write("→ Consider SCC condensation for robustness\n")
                    f.write("→ Cycles are manageable\n")
                else:
                    f.write("→ Strongly recommend SCC-aware algorithms\n")
                    f.write("→ Significant cycle structure present\n")
        
        logger.info(f"📋 Comprehensive report saved to {output_file}")
        return all_results
    
    def plot_scc_distribution(self, output_file: str = "full_scc_distribution.png"):
        """Plot SCC size distribution"""
        if 'scc_analysis' not in self.results:
            logger.warning("⚠️  No SCC analysis results to plot")
            return
        
        scc_result = self.results['scc_analysis']
        size_dist = scc_result['scc_size_distribution']
        
        # Create plots
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6))
        
        # Plot 1: Full distribution (log scale)
        sizes = list(size_dist.keys())
        counts = list(size_dist.values())
        
        ax1.bar(sizes, counts)
        ax1.set_xlabel('SCC Size')
        ax1.set_ylabel('Number of SCCs')
        ax1.set_title('SCC Size Distribution (Full)')
        ax1.set_yscale('log')
        ax1.grid(True, alpha=0.3)
        
        # Plot 2: Non-trivial SCCs only
        non_trivial_sizes = [s for s in sizes if s > 1]
        non_trivial_counts = [size_dist[s] for s in non_trivial_sizes]
        
        if non_trivial_sizes:
            ax2.bar(non_trivial_sizes, non_trivial_counts)
            ax2.set_xlabel('SCC Size')
            ax2.set_ylabel('Number of SCCs')
            ax2.set_title('Non-trivial SCCs (Size > 1)')
            ax2.grid(True, alpha=0.3)
        else:
            ax2.text(0.5, 0.5, 'No non-trivial SCCs found\n(Perfect DAG!)', 
                    ha='center', va='center', transform=ax2.transAxes, fontsize=14)
            ax2.set_title('Non-trivial SCCs (Size > 1)')
        
        plt.tight_layout()
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"📊 SCC distribution plot saved to {output_file}")
    
    def plot_top_scc_date_distributions(self, G: nx.DiGraph, output_file: str = "top_scc_date_distributions.png"):
        """Plot date distributions for the top 10 largest SCCs"""
        
        if 'scc_analysis' not in self.results:
            logger.warning("⚠️  No SCC analysis results to plot")
            return
        
        scc_result = self.results['scc_analysis']
        
        if not scc_result['scc_details']:
            logger.info("ℹ️  No large SCCs to plot")
            return
        
        # Get the top 10 largest SCCs
        top_sccs = sorted(scc_result['scc_details'], key=lambda x: x['size'], reverse=True)[:10]
        
        if not top_sccs:
            logger.info("ℹ️  No large SCCs found")
            return
        
        logger.info(f"📊 Plotting date distributions for top {len(top_sccs)} SCCs")
        
        # Create subplots
        n_sccs = len(top_sccs)
        cols = 3
        rows = (n_sccs + cols - 1) // cols
        
        fig, axes = plt.subplots(rows, cols, figsize=(15, 4 * rows))
        if rows == 1:
            axes = axes.reshape(1, -1)
        
        # Flatten axes for easier indexing
        axes_flat = axes.flatten()
        
        for i, scc_info in enumerate(top_sccs):
            ax = axes_flat[i]
            
            # Get all nodes in this SCC
            scc_nodes = scc_info['all_nodes']  # Use all nodes for date analysis
            
            # Get dates for these nodes
            dates = []
            years = []
            
            for node in scc_nodes:
                node_data = G.nodes[node]
                precise_date = node_data.get('precise_date')
                year = node_data.get('year')
                
                if precise_date is not None and not pd.isna(precise_date):
                    dates.append(precise_date)
                elif year is not None:
                    # Create a date from year
                    dates.append(pd.to_datetime(f"{year}-01-01"))
                
                if year is not None:
                    years.append(year)
            
            if not dates:
                ax.text(0.5, 0.5, f'SCC {scc_info["scc_id"]}\nNo date data', 
                       ha='center', va='center', transform=ax.transAxes)
                ax.set_title(f'SCC {scc_info["scc_id"]} (Size: {scc_info["size"]})')
                continue
            
            # Convert to pandas datetime for easier plotting
            date_series = pd.Series(dates)
            
            # Plot date distribution
            if len(dates) > 1:
                # Histogram of dates
                ax.hist(date_series, bins=min(10, len(dates)), alpha=0.7, edgecolor='black')
                ax.set_xlabel('Submission Date')
                ax.set_ylabel('Number of Papers')
                
                # Add statistics
                date_range = date_series.max() - date_series.min()
                ax.text(0.02, 0.98, f'Date Range: {date_range.days} days\nPapers: {len(dates)}', 
                       transform=ax.transAxes, verticalalignment='top',
                       bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
            else:
                # Single date
                ax.axvline(x=dates[0], color='red', linestyle='--', linewidth=2)
                ax.set_xlabel('Submission Date')
                ax.set_ylabel('Count')
                ax.text(0.02, 0.98, f'Single Date: {dates[0].strftime("%Y-%m-%d")}', 
                       transform=ax.transAxes, verticalalignment='top',
                       bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
            
            ax.set_title(f'SCC {scc_info["scc_id"]} (Size: {scc_info["size"]})')
            ax.grid(True, alpha=0.3)
            
            # Rotate x-axis labels for better readability
            plt.setp(ax.get_xticklabels(), rotation=45, ha='right')
        
        # Hide unused subplots
        for i in range(len(top_sccs), len(axes_flat)):
            axes_flat[i].set_visible(False)
        
        plt.tight_layout()
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"📊 Top SCC date distributions plot saved to {output_file}")
        
        # Also create a summary table
        self._create_scc_date_summary(top_sccs, G, "top_scc_date_summary.txt")
    
    def _create_scc_date_summary(self, top_sccs: List[Dict], G: nx.DiGraph, output_file: str):
        """Create a text summary of date patterns in top SCCs"""
        
        with open(output_file, 'w') as f:
            f.write("TOP 10 LARGEST SCCs - DATE ANALYSIS\n")
            f.write("=" * 50 + "\n\n")
            
            for i, scc_info in enumerate(top_sccs, 1):
                f.write(f"SCC #{i} (ID: {scc_info['scc_id']})\n")
                f.write(f"  Size: {scc_info['size']} nodes\n")
                f.write(f"  Internal edges: {scc_info['edges']}\n")
                f.write(f"  Average year: {scc_info['avg_year']:.1f}\n")
                
                # Get date statistics for all nodes in this SCC
                scc_nodes = scc_info['all_nodes']
                dates = []
                years = []
                
                for node in scc_nodes:
                    node_data = G.nodes[node]
                    precise_date = node_data.get('precise_date')
                    year = node_data.get('year')
                    
                    if precise_date is not None and not pd.isna(precise_date):
                        dates.append(precise_date)
                    if year is not None:
                        years.append(year)
                
                if dates:
                    date_series = pd.Series(dates)
                    f.write(f"  Date range: {date_series.min().strftime('%Y-%m-%d')} to {date_series.max().strftime('%Y-%m-%d')}\n")
                    f.write(f"  Date span: {(date_series.max() - date_series.min()).days} days\n")
                    f.write(f"  Papers with precise dates: {len(dates)}/{len(scc_nodes)}\n")
                else:
                    f.write(f"  No precise dates available\n")
                
                if years:
                    f.write(f"  Year range: {min(years)} to {max(years)}\n")
                    f.write(f"  Year span: {max(years) - min(years)} years\n")
                
                f.write(f"  Sample nodes: {', '.join(scc_nodes[:3])}{'...' if len(scc_nodes) > 3 else ''}\n")
                f.write("\n")
        
        logger.info(f"📋 SCC date summary saved to {output_file}")


def main():
    """Run full acyclicity analysis on complete filtered graph"""
    
    parser = argparse.ArgumentParser(description='Full Citation Graph Acyclicity Analysis')
    parser.add_argument('--db-path', default='../../data/arxiv_papers.db', 
                       help='Path to the SQLite database')
    parser.add_argument('--output-prefix', default='full_analysis',
                       help='Prefix for output files')
    
    args = parser.parse_args()
    
    print("🔬 FULL CITATION GRAPH ACYCLICITY ANALYSIS")
    print("=" * 70)
    print("Using precise submission dates (up to day) on complete filtered graph")
    print("=" * 70)
    
    # Initialize analyzer
    analyzer = FullAcyclicityAnalyzer(args.db_path)
    
    # Load complete graph
    G, papers_df = analyzer.load_full_graph_with_precise_dates()
    
    print(f"\n🔍 Running comprehensive acyclicity analysis on {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges")
    print(f"📅 Papers with precise dates: {papers_df['submitted_date'].notna().sum():,} / {len(papers_df):,}")
    
    # Run all three methods
    analyzer.method_1_topological_sort_test(G)
    analyzer.method_2_scc_analysis(G)
    analyzer.method_3_precise_feedback_edge_analysis(G)
    
    # Generate reports
    results = analyzer.generate_comprehensive_report(G, f"{args.output_prefix}_report.txt")
    analyzer.plot_scc_distribution(f"{args.output_prefix}_scc_distribution.png")
    analyzer.plot_top_scc_date_distributions(G, f"{args.output_prefix}_top_scc_dates.png")
    
    print("\n✅ Full analysis complete! Check these files:")
    print(f"  📋 {args.output_prefix}_report.txt - Comprehensive analysis report")
    print(f"  📊 {args.output_prefix}_scc_distribution.png - SCC size distribution plot")
    print(f"  📅 {args.output_prefix}_top_scc_dates.png - Date distributions for top 10 SCCs")
    print(f"  📋 top_scc_date_summary.txt - Detailed SCC date analysis")
    
    # Quick summary
    if 'scc_analysis' in analyzer.results:
        scc_result = analyzer.results['scc_analysis']
        print(f"\n🎯 QUICK SUMMARY:")
        print(f"  • Total nodes: {G.number_of_nodes():,}")
        print(f"  • Nodes in cycles: {scc_result['percentage_nodes_in_cycles']:.3f}%")
        print(f"  • Largest cycle: {scc_result['largest_scc_size']} nodes")
        print(f"  • Assessment: {'HIGHLY ACYCLIC' if scc_result['percentage_nodes_in_cycles'] < 0.1 else 'MOSTLY ACYCLIC' if scc_result['percentage_nodes_in_cycles'] < 1.0 else 'SOMEWHAT ACYCLIC'}")


if __name__ == "__main__":
    main() 