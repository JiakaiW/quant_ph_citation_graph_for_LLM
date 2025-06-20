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

## 📂 Project Structure

```
step1_get_arxiv_ids.py   # Fetches arXiv IDs from quant-ph category and stores in SQLite
crawl_and_store.py       # Downloads and caches paper metadata into SQLite
upload_to_neo4j.py       # Loads data from SQLite and writes to Neo4j
arxiv_papers.db          # SQLite database of arXiv IDs with info to tracking when we parsed it and when we analyzeed it
```

### 📊 Database Schema

#### `arxiv_papers.db` - arXiv ID Tracking
Created by `step1_get_arxiv_ids.py`:

| Column | Type | Description |
|--------|------|-------------|
| `arxiv_id` | TEXT (PRIMARY KEY) | arXiv paper ID (e.g., "2301.12345") |
| `submitted_date` | TEXT (NOT NULL) | Paper submission date in YYYY-MM-DD format |
| `first_seen_date` | TEXT (NOT NULL) | ISO timestamp when ID was first discovered |
| `analyzed_date` | TEXT (DEFAULT NULL) | When paper analysis was completed |
| `analysis_status` | TEXT (DEFAULT 'pending') | Status: 'pending', 'completed', 'failed', etc. |

**Features:**
- Smart incremental updates with early stopping
- Leverages arXiv API's newest-first ordering
- Tracks analysis progress for pipeline management
- Stores paper submission dates for temporal analysis
- Indexed on both `first_seen_date` and `submitted_date` for efficient queries

---

## 🛠️ Quick Start

### 1. Fetch arXiv IDs

```bash
python step1_get_arxiv_ids.py
```
This will:
- Create `arxiv_papers.db` with all quant-ph paper IDs
- Generate timestamped files for new IDs found
- Use smart early stopping on subsequent runs


# For using RAPIDS
conda activate web && pip install --extra-index-url=https://pypi.nvidia.com cudf-cu12 cuml-cu12 cugraph-cu12 --upgrade