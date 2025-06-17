# Superconducting Qubit Papers Crawler & Citation Clustering

This project builds a database of arXiv `quant-ph` papers, with a focus on identifying and clustering experimental superconducting qubit papers based on citation structure — **no embeddings required**.

---

## 🔧 Features

- 🚀 Efficient crawl of arXiv + Semantic Scholar metadata
- 💾 Store metadata and citation edges in local **SQLite**
- 🔗 Build citation graph in **Neo4j (local Windows Neo4j Desktop outside WSL2)** for visualization and clustering
- 🧠 Louvain community detection (pure graph-based)
- 🔍 Identify and extract clusters focused on superconducting qubits (e.g., transmon, fluxonium)

---

📂 Project Structure

crawl_and_store.py       # Downloads and caches paper metadata into SQLite
upload_to_neo4j.py       # Loads data from SQLite and writes to Neo4j
arxiv_citation.db        # SQLite cache of metadata and citations

---

## 🛠️ Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/JiakaiW/parse_paper
cd parse_paper
pip install -r requirements.txt
