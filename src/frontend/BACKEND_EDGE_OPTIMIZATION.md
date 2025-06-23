# 🚀 Backend Edge Loading Optimization Guide

## 🚨 **Problem Statement**

The current approach `WHERE source IN (...) OR target IN (...)` with thousands of viewport nodes has **O(N×M) complexity** and creates massive queries that are computationally expensive.

**Issues:**
- Large IN clauses with 5000+ node IDs
- OR conditions prevent database index optimization
- Cartesian product complexity
- Memory overhead from huge query strings
- Poor database query plan optimization

## 🎨 **Rendering Performance Considerations for 70K Nodes + 400K Edges**

**Reality Check:**
- **Memory**: 400K edges × 80 bytes = 32MB (easily fits in L3 cache, not a constraint)
- **Real bottleneck**: WebGL/Canvas rendering performance, not memory usage
- **Visual clarity**: Too many edges create visual noise, reducing usability

**Actual Performance Constraints:**
- **Smooth rendering**: Up to 15K edges render smoothly
- **Acceptable lag**: 15K-25K edges cause minor lag but still usable  
- **Performance degradation**: 25K+ edges cause noticeable rendering delays
- **Visual clutter threshold**: 20K+ edges become difficult to interpret

**Rendering Budget:**
- **Optimal**: 8K-15K edges (smooth interaction)
- **Acceptable**: 15K-25K edges (minor lag)
- **Maximum**: 25K-35K edges (usable but laggy)

## 🎯 **Rendering-Optimized Solutions (Ordered by Efficiency)**

### **Strategy 1: 🧠 Importance-Filtered Edge Loading (BEST for Non-Local)**

#### **Database Schema:**
```sql
-- Add importance metrics to edges table for filtering
ALTER TABLE edges ADD COLUMN (
  bbox_min_x FLOAT, bbox_max_x FLOAT, 
  bbox_min_y FLOAT, bbox_max_y FLOAT,
  weight FLOAT DEFAULT 1.0,           -- Citation strength
  source_degree INT,                  -- Cache source node degree
  target_degree INT,                  -- Cache target node degree
  spatial_distance FLOAT,             -- Euclidean distance between nodes
  importance_score FLOAT              -- Pre-computed importance
);

-- Create composite index for importance-based queries
CREATE INDEX idx_edges_importance ON edges (
  bbox_min_x, bbox_max_x, bbox_min_y, bbox_max_y,
  importance_score DESC, weight DESC
);

-- Pre-compute importance scores (batch job)
UPDATE edges e SET 
  importance_score = (
    (e.weight * 10) +                    -- Citation strength
    (n1.degree + n2.degree) +           -- Node importance
    (1000 / (1 + e.spatial_distance))   -- Spatial locality bonus
  )
FROM nodes n1, nodes n2 
WHERE e.source = n1.node_id AND e.target = n2.node_id;
```

#### **API Endpoint:**
```python
@app.route('/api/edges/importance-filtered', methods=['POST'])
def get_edges_importance_filtered():
    data = request.json
    criteria = data.get('criteria', {})
    
    # MEMORY-EFFICIENT: Importance-based filtering for non-local graphs
    query = """
    SELECT source, target, weight, importance_score
    FROM edges 
    WHERE bbox_min_x <= :max_x 
      AND bbox_max_x >= :min_x
      AND bbox_min_y <= :max_y 
      AND bbox_max_y >= :min_y
      AND weight >= :min_weight
      AND (source_degree >= :min_degree OR target_degree >= :min_degree)
      AND spatial_distance <= :max_distance
    ORDER BY 
      importance_score DESC,
      weight DESC
    LIMIT :limit
    """
    
    edges = db.execute(query, {
        'min_x': data['minX'], 'max_x': data['maxX'],
        'min_y': data['minY'], 'max_y': data['maxY'],
        'min_weight': criteria.get('minWeight', 0.1),
        'min_degree': criteria.get('minNodeDegree', 5),
        'max_distance': criteria.get('maxDistance', 1000),
        'limit': data['limit']
    }).fetchall()
    
    return jsonify(edges)
```

**Performance:** ⚡ **O(log N)** + **Rendering-optimized** (8K-18K edges based on viewport)

---

### **Strategy 2: 🗂️ Pre-computed Adjacency Lists**

#### **Database Schema:**
```sql
-- Pre-computed adjacency table
CREATE TABLE node_adjacency (
  node_id VARCHAR PRIMARY KEY,
  adjacent_nodes JSON,  -- [{"target": "node123", "weight": 0.8}, ...]
  degree INT,
  last_updated TIMESTAMP,
  INDEX(node_id)
);

-- Populate adjacency lists (batch job)
INSERT INTO node_adjacency (node_id, adjacent_nodes, degree)
SELECT 
  source,
  JSON_ARRAYAGG(JSON_OBJECT('target', target, 'weight', weight)) as adjacent_nodes,
  COUNT(*) as degree
FROM edges 
GROUP BY source;
```

#### **API Endpoint:**
```python
@app.route('/api/edges/adjacency', methods=['POST'])  
def get_edges_adjacency():
    node_ids = request.json['nodeIds']
    
    # EFFICIENT: O(1) per node lookup
    query = """
    SELECT node_id, adjacent_nodes 
    FROM node_adjacency 
    WHERE node_id IN :node_ids
    """
    
    results = db.execute(query, {'node_ids': tuple(node_ids)}).fetchall()
    return jsonify(results)
```

**Performance:** ⚡ **O(1) per node** + JSON parsing overhead

---

### **Strategy 3: 📦 Batched Queries (FALLBACK)**

#### **API Endpoint:**
```python
@app.route('/api/edges/batch', methods=['POST'])
def get_edges_batch():
    node_ids = request.json['nodeIds']  # Max 100 nodes per batch
    limit = request.json['limit']
    
    # OPTIMIZED: Use EXISTS instead of IN + OR
    query = """
    WITH viewport_nodes AS (
      SELECT unnest(:node_ids) as node_id
    )
    SELECT DISTINCT e.source, e.target, e.weight
    FROM edges e
    WHERE EXISTS (
      SELECT 1 FROM viewport_nodes v 
      WHERE v.node_id = e.source OR v.node_id = e.target
    )
    LIMIT :limit
    """
    
    edges = db.execute(query, {
        'node_ids': node_ids,
        'limit': limit
    }).fetchall()
    
    return jsonify(edges)
```

**Performance:** ⚡ **O(N log M)** - much better than O(N×M)

---

### **Strategy 4: 🏗️ Graph Partitioning (ADVANCED)**

#### **Database Schema:**
```sql
-- Spatial graph partitions
CREATE TABLE graph_partitions (
  partition_id INT PRIMARY KEY,
  min_x FLOAT, max_x FLOAT,
  min_y FLOAT, max_y FLOAT,
  node_count INT,
  edge_blob LONGBLOB,  -- Compressed edge list
  SPATIAL INDEX(min_x, max_x, min_y, max_y)
);
```

#### **Pre-computation Script:**
```python
def create_partitions():
    # Divide graph into spatial grid (e.g., 10x10 = 100 partitions)
    for i in range(10):
        for j in range(10):
            partition_bounds = calculate_partition_bounds(i, j)
            edges_in_partition = get_edges_in_bounds(partition_bounds)
            
            # Compress and store edge list
            compressed_edges = gzip.compress(json.dumps(edges_in_partition).encode())
            
            db.execute("""
                INSERT INTO graph_partitions 
                (partition_id, min_x, max_x, min_y, max_y, edge_blob)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (i*10+j, *partition_bounds, compressed_edges))
```

**Performance:** ⚡ **O(1)** for partition lookup + decompression

---

## 🎯 **Implementation Recommendation**

### **Phase 1: Quick Win (1-2 days)**
Implement **Strategy 3: Batched Queries** as immediate improvement:
- ✅ No schema changes required
- ✅ 10x-50x performance improvement over current approach
- ✅ Uses EXISTS instead of IN+OR for better query optimization

### **Phase 2: Optimal Solution (1 week)**
Implement **Strategy 1: Spatial Edge Indexing**:
- ✅ Best long-term performance 
- ✅ Scales to millions of edges
- ✅ Leverages database spatial indexing capabilities

### **Phase 3: Advanced Optimization (2-3 weeks)**
Consider **Strategy 2: Adjacency Lists** for ultra-high performance:
- ✅ Fastest possible edge queries
- ✅ Pre-computed results
- ✅ Ideal for read-heavy workloads with 72,493 papers

---

## 📊 **Performance Comparison**

| Strategy | Complexity | Query Time (est.) | Memory | Implementation |
|----------|------------|-------------------|---------|----------------|
| **Current (IN+OR)** | O(N×M) | 2000-5000ms | High | ❌ Inefficient |
| **Batched EXISTS** | O(N log M) | 200-500ms | Medium | ✅ Easy |
| **Spatial Index** | O(log N) | 50-100ms | Low | ✅ Recommended |
| **Adjacency Lists** | O(1) | 10-20ms | Medium | ✅ Best Performance |
| **Graph Partitions** | O(1) | 5-10ms | Low | 🔧 Advanced |

**N** = number of viewport nodes (1000-5000)  
**M** = total edges in database (~500K-1M)

---

## 🔧 **Frontend Integration**

The EdgeLoader now supports multiple strategies with automatic fallback:

```typescript
// 1. Try spatial query (fastest)
const edges = await this.fetchEdgesSpatial(bounds, limit);

// 2. Fallback to batched node query (if spatial not available) 
const edges = await this.fetchEdgesNodeBased(bounds, limit);

// 3. Final fallback to adjacency lists (if available)
const edges = await this.fetchEdgesAdjacency(bounds, limit);
```

This provides **graceful degradation** and allows incremental backend optimization without breaking the frontend.

---

## 🚀 **Expected Performance Gains**

- **Current approach**: 2-5 seconds for edge loading
- **Batched approach**: 200-500ms (10x improvement)
- **Spatial indexing**: 50-100ms (50x improvement) 
- **Adjacency lists**: 10-20ms (250x improvement)

The **spatial indexing approach is recommended** as it provides the best balance of performance, maintainability, and scalability for your citation network visualization with 72,493 papers. 