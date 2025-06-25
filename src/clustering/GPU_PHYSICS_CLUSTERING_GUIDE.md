# 🚀 GPU Physics-Based Clustering Guide

## Overview

This guide explains how to use the new **GPU-accelerated ForceAtlas2 + DBSCAN clustering** system that replaces the Node2Vec → UMAP → KMeans pipeline with a physics-based approach.

### Why Physics-Based Clustering?

**Problem with Current Approach:**
- Node2Vec + UMAP + KMeans creates clusters based on citation patterns
- Papers in same cluster cite similarly but may not be in same research field
- Results in long-range citations outside clusters

**Physics-Based Solution:**
- ForceAtlas2 treats citations as physical forces (attraction)
- Natural communities emerge as stable spatial configurations
- DBSCAN finds dense regions in the resulting 2D space
- **Result**: Papers that cite each other cluster together spatially

## 🔧 Installation

### Option 1: GPU Acceleration (Recommended)

**Requirements:**
- NVIDIA GPU with CUDA support
- CUDA 11.8+ or 12.0+
- 8GB+ GPU memory for 70K nodes

**Install RAPIDS:**
```bash
# Create new conda environment
conda create -n gpu_clustering python=3.10
conda activate gpu_clustering

# Install RAPIDS (adjust CUDA version as needed)
conda install -c rapidsai -c conda-forge -c nvidia rapids=23.12 python=3.10 cudatoolkit=11.8

# Install additional dependencies
pip install fa2 networkx scikit-learn
```

### Option 2: CPU Fallback

**If no GPU available:**
```bash
pip install -r requirements_gpu.txt
```

## 🚀 Usage

### Basic Usage

```bash
# Navigate to clustering directory
cd src/clustering

# Run full pipeline on all 70K papers (GPU recommended)
python gpu_physics_clustering.py

# Debug mode (5K papers subset)
python gpu_physics_clustering.py --debug

# Custom parameters
python gpu_physics_clustering.py \
    --fa2-iterations 1500 \
    --dbscan-eps 0.3 \
    --dbscan-min-samples 10
```

### Advanced Options

```bash
# Force CPU mode (no GPU)
python gpu_physics_clustering.py --no-gpu

# Process limited number of papers
python gpu_physics_clustering.py --max-papers 10000

# Validate existing clustering results
python gpu_physics_clustering.py --validate
```

## ⚙️ Parameter Tuning

### ForceAtlas2 Parameters

| Parameter | Default | Description | Tuning Guide |
|-----------|---------|-------------|--------------|
| `fa2_iterations` | 1000 | Number of layout iterations | More = better quality, slower |
| `fa2_gravity` | 1.0 | Global attraction strength | Higher = tighter clusters |
| `fa2_scaling_ratio` | 2.0 | Force scaling | Higher = more spread out |
| `fa2_barnes_hut_theta` | 0.5 | Approximation accuracy | Lower = more accurate, slower |

### DBSCAN Parameters

| Parameter | Default | Description | Tuning Guide |
|-----------|---------|-------------|--------------|
| `dbscan_eps` | 0.5 | Clustering radius | Lower = more clusters |
| `dbscan_min_samples` | 5 | Min points per cluster | Higher = fewer, denser clusters |

### Recommended Parameter Sets

**For Dense Citation Networks:**
```bash
python gpu_physics_clustering.py \
    --dbscan-eps 0.3 \
    --dbscan-min-samples 10 \
    --fa2-gravity 1.5
```

**For Sparse Citation Networks:**
```bash
python gpu_physics_clustering.py \
    --dbscan-eps 0.8 \
    --dbscan-min-samples 3 \
    --fa2-gravity 0.5
```

## 📊 Expected Performance

### GPU Performance (RTX 3060+)
- **70K nodes**: ~60-120 seconds total
- **ForceAtlas2**: ~45-90 seconds
- **DBSCAN**: ~5-15 seconds
- **Memory**: ~4-6GB GPU RAM

### CPU Performance
- **70K nodes**: ~30-60 minutes total
- **ForceAtlas2**: ~25-50 minutes
- **DBSCAN**: ~2-5 minutes
- **Memory**: ~8-16GB system RAM

## 🎯 Quality Validation

### Automatic Validation
```bash
python gpu_physics_clustering.py --validate
```

**Key Metrics:**
- **Intra-cluster citation density**: Should be >0.6 for good clustering
- **Average cluster size**: Typically 50-500 papers per cluster
- **Total clusters**: Usually 100-300 clusters for 70K papers

### Manual Validation

**Check Results in Database:**
```sql
-- Cluster size distribution
SELECT cluster_id, COUNT(*) as size 
FROM filtered_papers 
WHERE cluster_id IS NOT NULL 
GROUP BY cluster_id 
ORDER BY size DESC;

-- Sample papers from largest cluster
SELECT paper_id, title, embedding_x, embedding_y 
FROM filtered_papers 
WHERE cluster_id = 0 
LIMIT 10;
```

## 🔧 Troubleshooting

### GPU Issues

**CUDA Out of Memory:**
```bash
# Reduce batch size or use CPU
python gpu_physics_clustering.py --no-gpu
```

**RAPIDS Import Error:**
```bash
# Check RAPIDS installation
python -c "import cudf, cugraph, cuml; print('RAPIDS OK')"

# Reinstall if needed
conda install -c rapidsai -c conda-forge -c nvidia rapids=23.12
```

### Performance Issues

**ForceAtlas2 Too Slow:**
```bash
# Reduce iterations
python gpu_physics_clustering.py --fa2-iterations 500

# Enable Barnes-Hut optimization (default: enabled)
```

**Too Many Small Clusters:**
```bash
# Increase DBSCAN epsilon
python gpu_physics_clustering.py --dbscan-eps 0.8
```

**Too Few Large Clusters:**
```bash
# Decrease DBSCAN epsilon
python gpu_physics_clustering.py --dbscan-eps 0.3
```

## 📈 Integration with Frontend

### Database Schema

The pipeline saves results to `filtered_papers` table:
- `embedding_x`, `embedding_y`: 2D positions from ForceAtlas2
- `cluster_id`: Cluster assignment from DBSCAN
- `cluster_size`: Number of papers in cluster
- `processed_date`: When clustering was performed

### Frontend Updates

**No changes needed!** The existing frontend automatically uses:
- `embedding_x`, `embedding_y` for node positions
- `cluster_id` for cluster coloring and filtering
- Existing cluster naming system works with new clusters

## 🔄 Migration from Node2Vec

### Backup Current Results
```bash
# Backup current clustering
sqlite3 ../../data/arxiv_papers.db "
CREATE TABLE backup_clustering AS 
SELECT paper_id, embedding_x, embedding_y, cluster_id 
FROM filtered_papers 
WHERE cluster_id IS NOT NULL;
"
```

### Run New Clustering
```bash
# Clear old results and run new clustering
python gpu_physics_clustering.py
```

### Compare Results
```bash
# Validate new clustering quality
python gpu_physics_clustering.py --validate

# Manual comparison in frontend visualization
```

## 🎯 Expected Improvements

### Scientific Accuracy
- **Higher intra-cluster citation density** (papers cite within cluster)
- **Clearer research area boundaries** (distinct subfields)
- **Better spatial organization** (related papers are nearby)

### Visualization Quality
- **More intuitive clusters** (visual blobs = research areas)
- **Reduced long-range citations** when clicking nodes
- **Better cluster naming** (based on influential papers)

## 📚 References

- **ForceAtlas2**: Jacomy, M. et al. "ForceAtlas2, a Continuous Graph Layout Algorithm"
- **RAPIDS cuGraph**: https://github.com/rapidsai/cugraph
- **DBSCAN**: Ester, M. et al. "A density-based algorithm for discovering clusters"

## 💡 Next Steps

1. **Run initial test**: `python gpu_physics_clustering.py --debug`
2. **Validate results**: `python gpu_physics_clustering.py --validate`
3. **Full pipeline**: `python gpu_physics_clustering.py`
4. **Check frontend**: Verify improved clustering in visualization
5. **Fine-tune**: Adjust parameters based on validation metrics 