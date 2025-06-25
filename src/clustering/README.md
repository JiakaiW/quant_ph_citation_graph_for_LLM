# 🧠 Clustering Module

This module implements the citation network clustering pipeline. The current approach uses a physics-based layout (ForceAtlas2) and a variable-density clustering algorithm (HDBSCAN) to identify research communities. This method is GPU-accelerated using RAPIDS cuGraph and cuML.

## 📂 Directory Structure

```
src/clustering/
├── 🚀 Current Pipeline (ForceAtlas2 + HDBSCAN)
│   ├── physics_clustering_migration.py # Main script to run the new pipeline and update the DB
│   ├── gpu_physics_clustering.py       # Core logic for GPU-accelerated ForceAtlas2
│   └── data_loader.py                  # Database I/O utilities (shared)
│
├──  legacy_node2vec/                  # Old pipeline (Node2Vec + UMAP + KMeans)
│   ├── pipeline.py                     # Main orchestration script for the old pipeline
│   ├── embeddings.py                   # Node2vec embedding generation
│   ├── dimensionality_reduction.py     # UMAP/t-SNE 2D projection
│   ├── clustering.py                   # K-means with elbow method
│   └── ... (cached .npy files)         # Old cached results
│
├── 🔎 Cluster Analysis & Naming
│   ├── CLUSTER_NAMING_SYSTEM.md        # Documentation on the cluster naming process
│   ├── cluster_theme_extractor.py      # Extracts themes from clusters
│   ├── cluster_api_integration.py      # Integrates themes with the API
│   └── ... (JSON cache files)          # Cached cluster names and themes
│
├── 🛠️ utils/                           # Utility & Debug Scripts
│   ├── prepare_database.py             # Database setup & verification
│   ├── check_progress.py               # Monitor pipeline progress
│   └── monitor_gpu.py                  # Real-time GPU monitoring
│
├── 💾 cache/                           # General-purpose cache
│
├── 📊 logs/                            # Execution Logs
│
└── 📖 Documentation
    ├── README.md                       # This file
    └── GPU_PHYSICS_CLUSTERING_GUIDE.md # Guide for the new GPU pipeline
```

## 🚀 Quick Start

To run the latest clustering pipeline and update the `physics_clustering` table in the database:

```bash
cd src/clustering
python physics_clustering_migration.py
```

To compare the results of the new pipeline with the old one:
```bash
python physics_clustering_migration.py --compare
```

## 📈 Key Features

### ⚡ GPU Acceleration (RAPIDS)
- **cuGraph ForceAtlas2**: Massively parallel graph layout algorithm.
- **cuML HDBSCAN**: GPU-accelerated hierarchical clustering that excels at variable-density data.
- **Full Pipeline Speed**: Processes >70k papers and >400k citation edges in **under 10 seconds** on an NVIDIA A100. This is a ~360x speedup over the previous CPU-based pipeline which took ~60 minutes.

### 🔬 High-Quality Physics-Based Clustering
- **ForceAtlas2 Layout**: Simulates physical forces (attraction/repulsion) to arrange nodes. Its `lin_log` mode is particularly effective at revealing community structures in citation networks.
- **HDBSCAN for Variable Density**: Unlike KMeans or DBSCAN which struggle with the structure of citation graphs (one super-dense core, many sparse communities), HDBSCAN can identify clusters of varying shapes and densities, which is a perfect match for this data. It also correctly identifies "noise" points that don't belong to any cluster.

## 📊 Current Results

**Latest Pipeline Run (ForceAtlas2 + HDBSCAN):**
- ✅ **72,493 papers** processed
- ✅ **~100 meaningful clusters** identified
- ✅ **~27,000 papers** correctly identified as noise (weakly connected nodes, expected for this type of network)
- ✅ **Largest cluster** contains ~18k papers, representing a major subfield.
- ✅ **Intra-cluster citation density** is significantly improved over the old method, indicating more cohesive communities.

## 🔧 Troubleshooting

### GPU Issues
```bash
# Verify RAPIDS installation and see GPU
python -c "import cudf; print(cudf.DataFrame())"

# Monitor GPU usage during a run
watch -n 0.5 nvidia-smi
```

### Database Issues
```bash
# Prepare/verify database schema
python utils/prepare_database.py

# Check processing progress (if you add logging to the migration script)
tail -f logs/migration.log
```

## 📋 Dependencies

### Core Requirements
- `numpy`, `pandas`, `scikit-learn`, `igraph`

### GPU Requirements (RAPIDS)
- `cuml`, `cupy`, `cudf`, `cugraph`
- NVIDIA GPU with CUDA 11.2+

## 📚 Technical Details

For a deep dive into the implementation and the rationale behind choosing ForceAtlas2 and HDBSCAN, see the [GPU Physics Clustering Guide](GPU_PHYSICS_CLUSTERING_GUIDE.md). 