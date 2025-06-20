import pandas as pd
import networkx as nx
from pyvis.network import Network
import numpy as np

# PARAMETERS
TOP_N_NODES = 2000  # Number of most connected nodes to plot

print("Loading data...")
# Load community assignments, edges, and paper metadata
assignments = pd.read_csv("community_assignments_networkx.csv")
edges_df = pd.read_csv("citations.csv")
papers_df = pd.read_csv("papers.csv")

print(f"Original data: {len(assignments)} nodes, {len(edges_df)} edges")

# Build full graph to calculate degrees
print("Building full graph to calculate node degrees...")
G = nx.from_pandas_edgelist(edges_df, 'src', 'dst')

# Calculate degree for each node
print("Calculating node degrees...")
degrees = dict(G.degree())

# Get top N most connected nodes
print(f"Selecting top {TOP_N_NODES} most connected nodes...")
top_nodes = sorted(degrees.items(), key=lambda x: x[1], reverse=True)[:TOP_N_NODES]
top_node_ids = [node for node, degree in top_nodes]

print(f"Top node has {top_nodes[0][1]} connections")
print(f"Bottom node in selection has {top_nodes[-1][1]} connections")

# Create subgraph with top connected nodes
print("Creating subgraph of top connected nodes...")
subG = G.subgraph(top_node_ids)

print(f"Subgraph: {subG.number_of_nodes()} nodes, {subG.number_of_edges()} edges")
print(f"Average degree in subgraph: {sum(dict(subG.degree()).values()) / len(subG):.1f}")

# Filter assignments to top nodes
top_assignments = assignments[assignments['paper_id'].isin(top_node_ids)]
print(f"Top nodes span {top_assignments['community'].nunique()} communities")

# Create a mapping from paper_id to title
print("Loading paper titles...")
paper_titles = dict(zip(papers_df['paper_id'], papers_df['title']))

# Calculate layout using NetworkX spring_layout
print("Calculating node layout using NetworkX (this may take a moment)...")
pos = nx.spring_layout(subG, iterations=50, seed=42)
print("Layout calculation complete.")

# Create Pyvis network
print("Creating interactive visualization...")
net = Network(height="800px", width="100%", bgcolor="#ffffff", font_color="#000000", notebook=False)

# Add nodes with community-based colors
community_colors = {}
unique_communities = top_assignments['community'].unique()
color_palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', 
                 '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
                 '#a6cee3', '#fb9a99', '#fdbf6f', '#cab2d6', '#ffff99']

for i, community in enumerate(unique_communities):
    community_colors[community] = color_palette[i % len(color_palette)]

# Add nodes with pre-calculated positions
for node in subG.nodes():
    degree = subG.degree(node)
    community = top_assignments[top_assignments['paper_id'] == node]['community'].iloc[0]
    color = community_colors[community]
    
    # Size based on degree
    size = max(5, min(30, 5 + np.log(max(degree, 1)) * 3))
    
    # Get title and create hover text
    title = paper_titles.get(node, f"Paper ID: {node[:8]}...")
    display_title = title[:50] + "..." if len(title) > 50 else title
    hover_text = f"Title: {title}<br>Degree: {degree}<br>Community: {community}"
    
    # Get pre-calculated positions
    node_x, node_y = pos[node]
    
    net.add_node(node, 
                label=display_title, 
                color=color, 
                size=size,
                title=hover_text,
                x=node_x * 1000,  # Scale coordinates for visibility
                y=node_y * 1000)

# Add edges
for edge in subG.edges():
    net.add_edge(edge[0], edge[1], width=0.5, color='#cccccc')

# Add physics controls to the HTML page
net.show_buttons(filter_=['physics'])

# Save and show
output_file = f"top_{TOP_N_NODES}_connected_nodes_with_titles_interactive.html"
net.write_html(output_file)
print(f"✅ Interactive visualization saved as {output_file}")
print(f"Open this file and use the controls to find the best layout!")

# Print community statistics for top connected nodes
print(f"\nCommunity statistics for top {TOP_N_NODES} connected nodes:")
community_stats = top_assignments['community'].value_counts()
print(f"Number of communities: {len(community_stats)}")
print(f"Largest community: {community_stats.max()} nodes")
print(f"Smallest community: {community_stats.min()} nodes")
print(f"Average community size: {community_stats.mean():.1f} nodes")

# Show top communities in selection
print(f"\nTop 10 communities in most connected nodes:")
for i, (community, count) in enumerate(community_stats.head(10).items()):
    print(f"Community {community}: {count} nodes")

# Show degree distribution
degrees_in_subgraph = [subG.degree(node) for node in subG.nodes()]
print(f"\nDegree statistics in subgraph:")
print(f"Max degree: {max(degrees_in_subgraph)}")
print(f"Min degree: {min(degrees_in_subgraph)}")
print(f"Average degree: {sum(degrees_in_subgraph) / len(degrees_in_subgraph):.1f}")
print(f"Median degree: {sorted(degrees_in_subgraph)[len(degrees_in_subgraph)//2]}")

# Show some example titles from top connected nodes
print(f"\nExample paper titles from top connected nodes:")
for i, (node, degree) in enumerate(top_nodes[:5]):
    title = paper_titles.get(node, f"Paper ID: {node[:8]}...")
    print(f"Node {i+1} (degree {degree}): {title[:80]}...") 