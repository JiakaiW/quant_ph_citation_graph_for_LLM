# Superconducting Qubit Papers Crawler & Citation Clustering

This project builds a database of arXiv `quant-ph` papers, with a focus on identifying and clustering experimental superconducting qubit papers based on citation structure — **no embeddings required**.

---

## 🔧 Features

- 🚀 Efficient crawl of arXiv + Semantic Scholar metadata
- 💾 Store metadata and citation edges in local **SQLite**
- 🔗 Build citation graph in **Neo4j (local)** for visualization and clustering
- 🧠 Louvain community detection (pure graph-based)
- 🔍 Identify and extract clusters focused on superconducting qubits (e.g., transmon, fluxonium)

---

## 🛠️ Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/qubit-citation-graph
cd qubit-citation-graph
pip install -r requirements.txt
