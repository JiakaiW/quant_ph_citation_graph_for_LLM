# Superconducting Qubit Papers Crawler, Citation Clustering, Cluster Visualization

## 📂 Project Structure

```
├── data/                           # Data storage
│   └── arxiv_papers.db            # SQLite database with paper metadata and citations
├── src/
│   ├── data_accusation/           # Data collection pipeline
│   │   ├── step1_get_arxiv_ids.py
│   │   ├── step2_get_citation_from_semantic_scholar.py
│   │   ├── step3_filter_edges.py
│   │   └── step4_export_csv.py
│   ├── clustering/                # Modular clustering pipeline (see src/clustering/README.md)
│   │   ├── 📋 Core Pipeline Files
│   │   │   ├── pipeline.py        # Main orchestration script
│   │   │   ├── data_loader.py     # Database I/O utilities
│   │   │   ├── embeddings.py      # Node2vec embedding generation
│   │   │   ├── clustering.py      # K-means with elbow method & GPU support
│   │   │   ├── dimensionality_reduction.py  # UMAP/t-SNE 2D projection
│   │   │   └── export_for_sigma.py # Visualization data export
│   │   ├── utils/                 # Debug & utility scripts
│   │   ├── cache/                 # Cached embeddings & results (auto-generated)
│   │   └── logs/                  # Execution logs & visualizations (auto-generated)
│   ├── frontend/                  # Web visualization
│   │   ├── server.py
│   │   ├── templates/
│   │   └── static/
│   └── legacy_scripts/            # Previous monolithic scripts
├── analysis_results/              # Output files and visualizations
└── node_modules/                  # Frontend dependencies
```

## 🚀 Quick Start

### 1. Data Collection
```bash
cd src/data_accusation
python step1_get_arxiv_ids.py
python step2_get_citation_from_semantic_scholar.py
python step3_filter_edges.py
```

### 2. Clustering & Visualization

**Fast Mode (recommended):**
```bash
cd src/clustering
python pipeline.py fast          # Use cached results, skip elbow search
```

**Full Mode (with optimal k detection):**
```bash
cd src/clustering
python pipeline.py full          # Auto-detect optimal k using elbow method
```

**GPU Mode (experimental):**
```bash
cd src/clustering
python pipeline.py gpu           # Use GPU acceleration where possible
```

**Debug Mode (for development):**
```bash
cd src/clustering
python utils/debug_pipeline.py gpu     # Test GPU components on small subset
python utils/debug_pipeline.py full 500  # Test full pipeline on 500 papers
```

### 3. Export & Visualize
```bash
cd src/clustering
python export_for_sigma.py       # Generate JSON for web visualization
cd ../frontend
python server.py                 # Start web interface
```

## 🛠️ GPU Acceleration (Optional)
```bash
conda activate web && pip install --extra-index-url=https://pypi.nvidia.com cudf-cu12 cuml-cu12 cugraph-cu12 --upgrade
```

## 📋 TODO: Frontend Improvements

### 1. ✅ GPU Clustering & Optimal k Detection - COMPLETED
- **Problem**: ~~Hard-coded k=72 clusters, no GPU acceleration~~
- **Goal**: GPU-accelerated clustering with scientifically optimal cluster count
- **Current Status**: ✅ **COMPLETED** - Full pipeline operational with optimal k=16
- **Solution Implemented**: 
  - ✅ Precise elbow method: k=10 to k=100 with step=1 (91 tests in 6 minutes)
  - ✅ PyTorch GPU K-means: 1.5-3x speedup with automatic fallback
  - ✅ cuML GPU UMAP: 5-10x speedup for 2D projection
  - ✅ **60,534 papers clustered** into 16 meaningful communities
  - ✅ Organized codebase with utils/, cache/, logs/, legacy/ structure
- **Result**: k=16 optimal clusters vs k=72 over-segmented (major quality improvement)

### 2. Smart Node Filtering Based on Zoom Level
- **Problem**: Current approach generates huge JSON files with all 70k nodes
- **Goal**: Dynamic node loading based on user zoom level
- **Implementation Plan**:
  - **Zoomed Out**: Show top 2000 most influential nodes (by degree/centrality)
  - **Zoomed In**: Load additional nodes for fine detail
  - **Backend**: API endpoints to fetch filtered nodes from database
  - **Frontend**: Sigma.js with dynamic data loading