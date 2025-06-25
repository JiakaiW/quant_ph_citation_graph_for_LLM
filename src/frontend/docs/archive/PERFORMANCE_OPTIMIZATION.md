# Node Degree Performance Optimization

## Overview
This document describes the major performance optimization implemented to improve API response times for node degree filtering.

## Problem
The original API endpoints were computing node degrees on-the-fly using complex SQL subqueries:

```sql
SELECT src as paper_id, COUNT(*) as out_degree
FROM filtered_citations 
GROUP BY src
UNION ALL
SELECT dst as paper_id, COUNT(*) as in_degree
FROM filtered_citations 
GROUP BY dst
```

This approach was computationally expensive, especially for:
- Large datasets (72,493 papers, 60,534 with citations)
- Quality filtering (min_degree parameter)
- Repeated API calls during graph navigation

## Solution
Implemented a precomputed degree system:

### 1. Database Schema Enhancement
Added a `degree` column to the `filtered_papers` table:
```sql
ALTER TABLE filtered_papers ADD COLUMN degree INTEGER DEFAULT 0;
```

### 2. Efficient Degree Computation Script
Created `src/clustering/utils/compute_node_degrees.py` which:
- Uses optimized SQL aggregation with temporary tables
- Computes total degree (in-degree + out-degree) for all papers
- Updates the database in a single transaction
- Creates an index on the degree column for fast filtering

### 3. API Endpoint Optimization
Updated all three main endpoints:
- `/api/nodes/top` - Get top nodes by degree
- `/api/nodes/box` - Get nodes in spatial bounding box
- `/api/nodes/box/light` - Get lightweight nodes for distant viewing

**Before (on-the-fly computation):**
```python
# Complex subquery for each API call
degrees_query = """
    SELECT paper_id, COUNT(*) as degree
    FROM (
        SELECT src as paper_id FROM filtered_citations WHERE src IN (...)
        UNION ALL
        SELECT dst as paper_id FROM filtered_citations WHERE dst IN (...)
    ) GROUP BY paper_id
"""
```

**After (precomputed degrees):**
```python
# Simple query using precomputed values
nodes_query = """
    SELECT paper_id, title, embedding_x, embedding_y, cluster_id, degree
    FROM filtered_papers
    WHERE degree >= ? AND cluster_id IS NOT NULL
    ORDER BY degree DESC
    LIMIT ?
"""
```

## Performance Results

### Degree Computation Benchmark
- **Old method (on-the-fly):** 0.157 seconds for 1000 nodes
- **New method (precomputed):** 0.001 seconds for 1000 nodes
- **Speedup:** 121.6x faster

### API Response Times
- **1000 nodes with min_degree=5:** 0.031 seconds total
- **Database query time:** < 0.001 seconds
- **Network overhead:** ~0.030 seconds

### Database Statistics
- **Total papers:** 72,493
- **Papers with citations:** 60,534 (83.5%)
- **Maximum degree:** 2,734 citations
- **Average degree:** 11.72 citations

### Degree Distribution
- **Isolated (degree 0):** 11,959 papers (16.5%)
- **Low connectivity (1-5):** 22,384 papers (30.9%)
- **Medium connectivity (6-20):** 26,601 papers (36.7%)
- **High connectivity (21-50):** 9,468 papers (13.1%)
- **Very high connectivity (51-100):** 1,574 papers (2.2%)
- **Extremely high connectivity (100+):** 507 papers (0.7%)

## Implementation Details

### Database Indices
Created optimized indices for fast filtering:
```sql
CREATE INDEX idx_filtered_papers_degree ON filtered_papers(degree);
CREATE INDEX idx_filtered_papers_cluster ON filtered_papers(cluster_id);
```

### Quality Filtering
The `min_degree` parameter now works at the database level:
```sql
WHERE degree >= ? AND cluster_id IS NOT NULL
```

This eliminates the need to:
1. Fetch all nodes
2. Compute degrees in Python
3. Filter in application memory

### Memory Efficiency
- Reduced memory usage by eliminating temporary degree dictionaries
- Faster garbage collection due to fewer intermediate objects
- Lower CPU usage on the backend server

## Usage

### Running the Degree Computation
```bash
cd src/clustering/utils
python compute_node_degrees.py
```

### API Usage
All existing API endpoints now automatically use precomputed degrees:
```bash
# Get top 1000 high-quality papers (min 10 citations)
curl "http://localhost:8000/api/nodes/top?limit=1000&min_degree=10"

# Get nodes in spatial region with quality filter
curl "http://localhost:8000/api/nodes/box?minX=-10&maxX=10&minY=-10&maxY=10&min_degree=5"
```

## Maintenance

### Updating Degrees
If the citation network changes, rerun the degree computation:
```bash
python src/clustering/utils/compute_node_degrees.py
```

### Monitoring
The script provides detailed statistics and verification:
- Degree distribution analysis
- Sample verification against manual computation
- Performance benchmarking

## Impact
This optimization provides:
- **121x faster** degree-based queries
- **Reduced server load** during graph exploration
- **Better user experience** with faster API responses
- **Scalable architecture** for larger datasets
- **Consistent performance** regardless of filter complexity

The precomputed degree system is essential for real-time graph visualization with quality filtering on large citation networks. 