import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt
import random

# PARAMETERS
MAX_NODES = 1000  # Max nodes to plot for clarity

# Load community assignments
assignments = pd.read_csv("community_assignments_networkx.csv")

# Load edges
edges_df = pd.read_csv("citations.csv")

# Find the largest community
largest_community = assignments['community'].value_counts().idxmax()
print(f"Largest community: {largest_community}")

# Filter nodes in the largest community
nodes_in_community = assignments[assignments['community'] == largest_community]['paper_id'].tolist()

# If too many nodes, sample
if len(nodes_in_community) > MAX_NODES:
    nodes_in_community = random.sample(nodes_in_community, MAX_NODES)
    print(f"Sampled {MAX_NODES} nodes from largest community for plotting.")
else:
    print(f"Plotting all {len(nodes_in_community)} nodes in largest community.")

# Build subgraph
G = nx.from_pandas_edgelist(edges_df, 'src', 'dst')
subG = G.subgraph(nodes_in_community)

# Assign colors (all same for largest community, but you can extend this)
color_map = ['tab:blue'] * len(subG.nodes)

# Draw
plt.figure(figsize=(10, 10))
pos = nx.spring_layout(subG, seed=42)  # automatic arrangement
nx.draw_networkx_nodes(subG, pos, node_color=color_map, node_size=20, alpha=0.8)
nx.draw_networkx_edges(subG, pos, alpha=0.3, width=0.3)
plt.title(f"Largest Community #{largest_community} (showing {len(subG.nodes)} nodes)")
plt.axis('off')
plt.tight_layout()
plt.savefig("largest_community_plot.png", dpi=300)
plt.show()
print("Plot saved as largest_community_plot.png") 