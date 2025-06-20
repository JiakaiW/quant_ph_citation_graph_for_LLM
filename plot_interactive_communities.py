import pandas as pd
import networkx as nx
from pyvis.network import Network
import random
import numpy as np

# PARAMETERS
SAMPLE_PERCENTAGE = 0.05  # 5% of the data
MAX_NODES = 5000  # Safety limit

print("Loading data...")
# Load community assignments and edges
assignments = pd.read_csv("community_assignments_networkx.csv")
edges_df = pd.read_csv("citations.csv")

print(f"Original data: {len(assignments)} nodes, {len(edges_df)} edges")

# Sample nodes
if SAMPLE_PERCENTAGE < 1.0:
    sample_size = min(int(len(assignments) * SAMPLE_PERCENTAGE), MAX_NODES)
    sampled_nodes = random.sample(assignments['paper_id'].tolist(), sample_size)
    print(f"Sampling {sample_size} nodes ({SAMPLE_PERCENTAGE*100:.1f}% of data)")
else:
    sampled_nodes = assignments['paper_id'].tolist()[:MAX_NODES]
    print(f"Using first {len(sampled_nodes)} nodes")

# Filter assignments to sampled nodes
sampled_assignments = assignments[assignments['paper_id'].isin(sampled_nodes)]
print(f"Sampled nodes span {sampled_assignments['community'].nunique()} communities")

# Build subgraph
print("Building subgraph...")
G = nx.from_pandas_edgelist(edges_df, 'src', 'dst')
subG = G.subgraph(sampled_nodes)

print(f"Subgraph: {subG.number_of_nodes()} nodes, {subG.number_of_edges()} edges")

# Create Pyvis network
print("Creating interactive visualization...")
net = Network(height="800px", width="100%", bgcolor="#ffffff", font_color="#000000")

# Add nodes with community-based colors
community_colors = {}
unique_communities = sampled_assignments['community'].unique()
color_palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', 
                 '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
                 '#a6cee3', '#fb9a99', '#fdbf6f', '#cab2d6', '#ffff99']

for i, community in enumerate(unique_communities):
    community_colors[community] = color_palette[i % len(color_palette)]

# Add nodes
for node in subG.nodes():
    community = sampled_assignments[sampled_assignments['paper_id'] == node]['community'].iloc[0]
    color = community_colors[community]
    net.add_node(node, label=node[:8] + "...", color=color, size=10)

# Add edges
for edge in subG.edges():
    net.add_edge(edge[0], edge[1], width=1, color='#cccccc')

# Configure physics for better layout
net.set_options("""
var options = {
  "physics": {
    "forceAtlas2Based": {
      "gravitationalConstant": -50,
      "centralGravity": 0.01,
      "springLength": 100,
      "springConstant": 0.08
    },
    "maxVelocity": 50,
    "minVelocity": 0.1,
    "solver": "forceAtlas2Based",
    "timestep": 0.35
  },
  "nodes": {
    "font": {
      "size": 8
    }
  }
}
""")

# Save and show
output_file = f"interactive_communities_{SAMPLE_PERCENTAGE*100:.0f}percent.html"
net.write_html(output_file)
print(f"✅ Interactive visualization saved as {output_file}")
print(f"Open this file in your web browser to explore the network!")

# Print community statistics for sampled data
print(f"\nCommunity statistics for sampled data:")
community_stats = sampled_assignments['community'].value_counts()
print(f"Number of communities: {len(community_stats)}")
print(f"Largest community: {community_stats.max()} nodes")
print(f"Smallest community: {community_stats.min()} nodes")
print(f"Average community size: {community_stats.mean():.1f} nodes")

# Show top communities in sample
print(f"\nTop 10 communities in sample:")
for i, (community, count) in enumerate(community_stats.head(10).items()):
    print(f"Community {community}: {count} nodes") 