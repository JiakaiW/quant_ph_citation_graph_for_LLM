# 🧠 Clustering Module

This module implements a modular, GPU-accelerated citation network clustering pipeline for academic papers. It processes 70k+ papers with GPU optimization and automatic optimal cluster detection.

## 📂 Directory Structure

```
src/clustering/
├── 📋 Core Pipeline Files
│   ├── pipeline.py                     # Main orchestration script
│   ├── data_loader.py                  # Database I/O utilities  
│   ├── embeddings.py                   # Node2vec embedding generation
│   ├── clustering.py                   # K-means with elbow method & GPU support
│   ├── dimensionality_reduction.py     # UMAP/t-SNE 2D projection
│   └── export_for_sigma.py             # Visualization data export
│
├── 🛠️ utils/                           # Utility & Debug Scripts
│   ├── check_progress.py               # Monitor pipeline progress
│   ├── debug_pipeline.py               # Test components on subsets
│   ├── analyze_elbow.py                # Visualize elbow method results
│   ├── prepare_database.py             # Database setup & verification
│   ├── demo_gpu_usage.py               # GPU acceleration testing
│   └── monitor_gpu.py                  # Real-time GPU monitoring
│
├── 💾 cache/                           # Cached Results (auto-generated)
│   ├── embeddings_*.npy                # Node2vec embeddings cache
│   ├── cluster_labels_*.npy            # Clustering results cache
│   ├── *_umap_2d_embeddings_*.npy      # 2D projection cache
│   └── elbow_search_*.npy              # Elbow method analysis cache
│
├── 📊 logs/                            # Execution Logs & Visualizations
│   ├── pipeline_*.log                  # Pipeline execution logs
│   ├── precise_elbow.log               # Elbow method analysis log
│   ├── elbow_analysis.png              # Elbow curve visualization
│   └── precise_elbow_analysis.png      # Detailed elbow analysis
│
├── 🗄️ legacy/                          # Deprecated Scripts (moved to project root)
│   └── (Legacy files relocated - see git history for old monolithic scripts)
│
└── 📖 Documentation
    ├── README.md                       # This file
    └── Clustering.md                   # Technical documentation
```

## 🚀 Quick Start

### 1. Basic Usage (Recommended)
```bash
cd src/clustering
python pipeline.py fast    # Uses elbow method to find optimal k automatically
```

### 2. Advanced Usage
```bash
# Full pipeline with custom parameters
python pipeline.py full

# GPU-optimized mode
python pipeline.py gpu

# Monitor progress
python utils/check_progress.py

# Debug on subset
python utils/debug_pipeline.py full 1000
```

## 📈 Key Features

### ⚡ GPU Acceleration
- **PyTorch GPU K-means**: 1.5-3x speedup over CPU
- **cuML GPU UMAP**: 5-10x speedup for 2D projection  
- **Automatic fallback**: Graceful CPU fallback if GPU fails
- **Memory monitoring**: Real-time GPU memory usage tracking

### 🎯 Optimal Cluster Detection
- **Precise elbow method**: Tests k=10 to k=100 with step=1
- **GPU-accelerated analysis**: 91 k-means runs in ~6 minutes
- **Automatic caching**: Elbow results cached for reuse
- **Visualization**: Generates elbow curve plots

### 💾 Intelligent Caching
- **Embeddings**: Node2vec results cached by parameters
- **Clustering**: Results cached by k value and dataset size
- **Projections**: 2D embeddings cached by method and parameters
- **Analysis**: Elbow method results cached for different k ranges

## 📊 Current Results

**Latest Pipeline Run (k=16 optimal):**
- ✅ **60,534 papers** processed (83.5% of 72k filtered dataset)
- ✅ **16 clusters** identified via elbow method
- ✅ **GPU acceleration** working correctly
- ✅ **Processing time**: 56.5 seconds total
- ✅ **Ready for visualization**

**Cluster Distribution:**
- Largest cluster: 8,843 papers
- Most balanced: 3,000-5,000 papers per major cluster
- Quality improvement: k=16 vs k=72 (previous hard-coded)

## 🔧 Troubleshooting

### GPU Issues
```bash
# Test GPU availability
python utils/demo_gpu_usage.py

# Monitor GPU usage
python utils/monitor_gpu.py

# Debug GPU clustering
python utils/debug_pipeline.py gpu
```

### Database Issues
```bash
# Prepare/verify database
python utils/prepare_database.py

# Check processing progress
python utils/check_progress.py monitor
```

### Cache Management
```bash
# Clear all caches
rm -rf cache/*.npy

# Clear specific cache type
rm cache/cluster_labels_*.npy    # Clear clustering cache
rm cache/embeddings_*.npy        # Clear embeddings cache
```

## 📋 Dependencies

### Core Requirements
- `numpy`, `pandas`, `scikit-learn`
- `networkx`, `pecanpy` (node2vec)
- `umap-learn`, `kneed` (elbow method)

### GPU Requirements (Optional)
- `torch` with CUDA support
- `cuml`, `cupy` (RAPIDS ecosystem)
- NVIDIA GPU with CUDA 11.2+

### Visualization
- `matplotlib` (for elbow plots)
- `sigma.js` (web visualization)

## 🎯 Next Steps

1. **Frontend Integration**: Load clustered data in web interface
2. **Cluster Analysis**: Analyze cluster topics and themes  
3. **Interactive Exploration**: Zoom-based dynamic loading
4. **Performance Optimization**: Further GPU acceleration opportunities

## 📚 Technical Details

See [Clustering.md](Clustering.md) for detailed technical documentation including:
- Algorithm implementations
- GPU optimization strategies  
- Caching mechanisms
- Performance benchmarks 