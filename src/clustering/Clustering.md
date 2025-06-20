Here's a polished roadmap to use **cuGraph** in Python to achieve your clustering goals with the 70K×400K citation graph:

---

## 🧭 Stage 1: Load your data into cuGraph

```python
import cudf, cugraph

# Load filtered CSVs
nodes_df = cudf.read_csv("papers.csv")  # Contains 'paper_id' and metadata
edges_df = cudf.read_csv("citations.csv")  # Columns: 'src', 'dst'
```

* If `paper_id` is a string, cuGraph can handle it directly as of v24+, or you can optionally remap it to integers using `factorize()` and keep a mapping.

---

## 📦 Stage 2: Build a cuGraph graph object

```python
G = cugraph.Graph(directed=False)
G.from_cudf_edgelist(edges_df, source="src", destination="dst", renumber=True)
```

* Undirected graph is suitable for community detection.
* `renumber=True` compresses to integer vertex IDs and stores a mapping.

---

## 🔍 Stage 3: Run Louvain or Leiden clustering

### Louvain

```python
parts_df, modularity = cugraph.louvain(G, resolution=1.0, max_level=100)
```

* `parts_df` has two columns: `vertex`, `partition`
* `modularity` gives the overall partition quality ([docs.rapids.ai][1], [arxiv.org][2], [docs.rapids.ai][3])

### (Optional) Leiden

```python
parts_df = cugraph.leiden(G, resolution=1.0, max_iter=10)
```

* Leiden often produces higher-quality clusters ([en.wikipedia.org][4])

---

## 📤 Stage 4: Retrieve paper IDs for a given cluster

Combine `parts_df` with your node metadata:

```python
# If using renumbered IDs
nv_map = G.renumber_map  # cudf DataFrame mapping integer vertex → original paper_id

results = parts_df.merge(nv_map, left_on="vertex", right_on="vertex") \
                   .merge(nodes_df, on="paper_id")

# To export cluster #42
cluster_42 = results[results["partition"] == 42]
cluster_42.to_pandas().to_csv("cluster_42_papers.csv", index=False)
```

---

## 🧪 Stage 5: Export clusters for all communities (optional)

```python
results.to_pandas().to_csv("all_paper_clusters.csv", index=False)
```

Fields: `paper_id`, metadata, and `partition` (cluster ID).

---

## 📈 Stage 6: (Optional) Embeddings → Visual layout

```python
import cugraph.dask as cdg  # or use cuGraph directly
emb_df = cugraph.node2vec(G, ...).to_pandas()

# You can combine embeddings with partitions:
viz_df = emb_df.merge(results.to_pandas(), on="paper_id")
viz_df.to_csv("embeddings_plus_cluster.csv", index=False)
```

You can then plot (e.g. UMAP or t-SNE) in Python:

```python
import pandas as pd, umap, plotly.express as px
df = pd.read_csv("embeddings_plus_cluster.csv")
um = umap.UMAP(n_neighbors=15, min_dist=0.1, n_components=2).fit_transform(df.iloc[:,1:17])
df[['x','y']] = um
px.scatter(df, x='x', y='y', color='partition')
```

---

## ✅ Development checklist

1. **Load CSVs** into cuDF DataFrames
2. **Build cuGraph Graph**, renumber and invert node IDs
3. **Run Louvain / Leiden** to get cluster assignments
4. **Merge with node metadata** (title, year)
5. **Filter + export** list for target clusters (e.g., superconducting qubit literature)
6. **Optional**: generate embeddings + 2D layout for visualization

---

### 🧠 Why this works well

* cuGraph is optimized for \~100K nodes × 400K edges
* Louvain (and Leiden) are GPU-accelerated and fast ([docs.rapids.ai][1], [networkx.org][5], [arxiv.org][2], [en.wikipedia.org][6])
* The workflow is entirely in Python, no Neo4j or Gephi needed
* Final outputs are CSVs – easy to inspect, tag, or visualize downstream

---

Would you like me to draft this into a ready-to-run notebook or script (including CSV output for selecting superconducting qubit clusters)?

[1]: https://docs.rapids.ai/api/cugraph/legacy/api_docs/api/cugraph/cugraph.louvain/?utm_source=chatgpt.com "cugraph.louvain - RAPIDS Docs"
[2]: https://arxiv.org/abs/2501.19004?utm_source=chatgpt.com "CPU vs. GPU for Community Detection: Performance Insights from GVE-Louvain and $ν$-Louvain"
[3]: https://docs.rapids.ai/api/cugraph/stable/api_docs/cugraph/community/?utm_source=chatgpt.com "Community — cugraph-docs 25.04.00 documentation - RAPIDS Docs"
[4]: https://en.wikipedia.org/wiki/Leiden_algorithm?utm_source=chatgpt.com "Leiden algorithm"
[5]: https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.community.louvain.louvain_communities.html?utm_source=chatgpt.com "louvain_communities — NetworkX 3.5 documentation"
[6]: https://en.wikipedia.org/wiki/Louvain_method?utm_source=chatgpt.com "Louvain method"
