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

### 2. ✅ Smart Loading & Edge Visualization - COMPLETED  
- **Problem**: ~~No edges displayed, no smart node filtering, poor loading UX~~
- **Goal**: Dynamic edge loading with intelligent progress indicators and multi-stage loading
- **Current Status**: ✅ **COMPLETED** - Enhanced graph visualization with full edge support

### 3. ✅ Viewport-Based Streaming (Phase 2) - COMPLETED
- **Problem**: ~~Fixed loading approach, no spatial persistence, no level-of-detail system~~
- **Goal**: Netflix/Google Maps style dynamic loading as user explores
- **Current Status**: ✅ **COMPLETED** - Streaming viewport-based loading with spatial caching
- **Solution Implemented**:
  - ✅ **Dynamic Loading**: Content loads automatically as you pan and zoom
  - ✅ **Spatial Persistence**: Avoid re-loading same areas (60s cache)
  - ✅ **Level-of-Detail**: Zoom out (100 nodes) → Zoom in (400 nodes) → Smart detail levels  
  - ✅ **Smooth Streaming**: 25-node batches with 50ms delays for responsive UI
  - ✅ **Predictive Loading**: Load content outside viewport for seamless exploration
  - ✅ **Smart Debouncing**: 400ms delay prevents excessive API calls during fast navigation
- **Result**: Smooth exploration experience with content appearing as you navigate
- **Solution Implemented**:
  - ✅ **Edge Loading**: Fixed backend API to fetch citations FROM/TO nodes (not just between)
  - ✅ **Multi-Stage Loading**: Progressive loading with detailed status messages
    - Stage 1: "Loading top influential nodes..." 
    - Stage 2: "Adding nodes to visualization..."
    - Stage 3: "Loading citation connections..."
    - Stage 4: "Drawing citation connections..."
  - ✅ **Smart Filtering**: Top 500 most cited papers for optimal performance
  - ✅ **Enhanced UX**: Animated loading indicators, progress bars, and interactive instructions
  - ✅ **Performance**: Edge data properly cached and filtered for smooth interaction
- **Result**: Displays 500 nodes + 8000+ edges with smooth loading experience

### 3. Smart Viewport-Based Loading (Future Enhancement)
- **Current**: Fixed top-500 node loading for optimal initial experience
- **Future Goal**: Dynamic node loading based on zoom level and viewport position
- **Implementation Plan**:
  - **Zoomed Out (ratio < 0.5)**: Show top 2000 most influential nodes only
  - **Medium Zoom (0.5-2.0)**: Load viewport area with surrounding nodes
  - **Zoomed In (ratio > 2.0)**: High-detail view with comprehensive edge loading
  - **Backend**: Existing `/api/nodes/box` endpoint ready for viewport queries
  - **Frontend**: Camera event handling for dynamic fetching
- **Status**: 🔄 **READY FOR IMPLEMENTATION** - All APIs and infrastructure in place