# 🌳 Tree-First Architecture: DAG-Based Citation Visualization

## 🎯 **Problem Statement**

The current separate node/edge fetching system has critical issues:
- **Disconnected nodes** appear on screen with no visible relationships
- **Edge fetching stops working** after loading some nodes (e.g., 306 nodes + 1098 edges → 0 new edges)
- **Complex sync logic** between viewport caching and edge loading causes bugs
- **Poor user experience** - users see isolated papers with no citation context

## 📊 **MFAS Analysis Results**

Our acyclicity analysis revealed:
- **6,680 nodes** in one giant strongly connected component (the "hairball")  
- **Removing 13.16%** of internal edges (5,871 out of 44,629) creates a clean **DAG**
- **86.84% of edges** (38,714) form natural parent→child citation flows
- **Result**: Every paper has **one clear path** back to foundational papers

## 🏗️ **New Tree-First Architecture** 

### **Core Principle: Connectivity Guarantee**
> *Every loaded node is guaranteed to be connected via tree edges*

### **1. Backend: Split Edge Tables**

```sql
-- Tree edges: 86.84% of edges forming DAG backbone
CREATE TABLE tree_edges (
    src TEXT,
    dst TEXT,
    weight REAL DEFAULT 1.0,
    PRIMARY KEY (src, dst)
);

-- Extra edges: 13.16% of edges providing enrichment
CREATE TABLE extra_edges (
    src TEXT, 
    dst TEXT,
    weight REAL DEFAULT 1.0,
    edge_type TEXT DEFAULT 'shortcut', -- 'shortcut', 'cross_cluster', 'temporal'
    PRIMARY KEY (src, dst)
);

-- Topological levels for efficient overview loading
ALTER TABLE physics_clustering ADD COLUMN topo_level INTEGER;
```

### **2. New API Endpoints**

#### **Primary: Atomic Node+Tree Loading**
```typescript
POST /api/nodes/tree-in-box
{
  minX, maxX, minY, maxY: number,
  maxNodes: number = 1000,
  includeLevels?: number[] // For overview mode
}

Response: {
  nodes: Node[],
  treeEdges: Edge[], // Guaranteed connectivity
  bounds: BoundingBox,
  hasMore: boolean
}
```

#### **Secondary: Progressive Enrichment**  
```typescript
POST /api/edges/extra-for-nodes
{
  nodeIds: string[],
  maxEdges: number = 500
}

Response: {
  extraEdges: Edge[], // Additional connections
  nodeFlags: {[nodeId]: {enriched: boolean}} // Track completion
}
```

### **3. Frontend: Simple Loading Flow**

#### **Phase 1: Tree Constellation (Always Connected)**
```typescript
// 1. User pans/zooms
async updateViewport() {
  const viewport = this.getViewportBounds();
  
  // 2. Fetch nodes + tree edges atomically  
  const {nodes, treeEdges} = await fetchNodeTreeInBox(viewport);
  
  // 3. Add to graph (guaranteed connected)
  this.addNodesAndTreeEdges(nodes, treeEdges);
  
  // 4. UI immediately shows connected structure
  this.renderingComplete();
}
```

#### **Phase 2: Progressive Enrichment (On Demand)**
```typescript
// When user dwells or clicks
async enrichViewport() {
  const visibleNodes = this.getVisibleNodeIds();
  
  // Add extra edges for denser view
  const {extraEdges} = await fetchExtraEdgesForNodes(visibleNodes);
  this.addExtraEdges(extraEdges);
  
  // Mark nodes as fully enriched
  this.markNodesEnriched(visibleNodes);
}
```

### **4. User Experience Flow**

1. **Initial Display** 
   - *Load nodes in viewport + tree edges*
   - *Render as "constellation" showing paper lineage* 
   - *Fast & always connected*

2. **User Pans/Zooms**
   - *Quadtree lookup: "Which nodes in box are missing?"*
   - *Batch fetch missing nodes + their tree edges*
   - *Instant connectivity, no edge duplication*

3. **User Dwells** 
   - *Secondary query for extra edges*
   - *Overlay with lighter stroke (denser connections)*
   - *Cancellable if user keeps panning*

4. **Detail on Demand**
   - *Click node → drawer with full bibliography*
   - *Special highlighting for "backward" citations*

### **5. Backend Optimizations**

#### **Spatial + Topological Indexing**
```sql
-- R-Tree for spatial lookups
CREATE INDEX idx_spatial ON physics_clustering USING rtree(
  embedding_x, embedding_x, embedding_y, embedding_y
);

-- Index tree edges for parent/child lookups  
CREATE INDEX idx_tree_edges_src ON tree_edges(src);
CREATE INDEX idx_tree_edges_dst ON tree_edges(dst);

-- Topological level queries for overview
CREATE INDEX idx_topo_level ON physics_clustering(topo_level);
```

#### **Precomputed Levels**
```python
# Compute distance from roots for overview mode
def compute_topological_levels():
    # Level 0: Papers with no incoming tree edges (roots)
    # Level 1: Papers citing only level 0 papers  
    # Level N: Papers citing papers from level 0..N-1
    pass
```

### **6. Performance Benefits**

| Aspect | Before (Separate Fetch) | After (Tree-First) |
|--------|------------------------|-------------------|
| **Connectivity** | ❌ No guarantee | ✅ Always connected |
| **Load Time** | 2-3 API calls | 1 atomic call |
| **Sync Issues** | ❌ Complex caching bugs | ✅ Simple append-only |
| **Navigation** | ❌ "Grey mush" at zoom-out | ✅ Clear hierarchy |
| **Edge Deduplication** | ❌ Complex overlap logic | ✅ Parent-child uniqueness |

### **7. Edge Completeness Indicator**

```typescript
// Each node tracks enrichment status
interface NodeState {
  id: string;
  hasTreeEdges: boolean;    // Always true after loading
  hasExtraEdges: boolean;   // True after enrichment
  enrichmentRequested: boolean;
}

// UI indicator: "Loading complete" = all visible nodes enriched
function isViewportComplete(): boolean {
  return this.getVisibleNodes().every(node => node.hasExtraEdges);
}
```

### **8. Migration Strategy**

1. **Phase 1**: Generate tree/extra edge tables using MFAS analysis
2. **Phase 2**: Implement new tree-first endpoints  
3. **Phase 3**: Create new TreeFirstGraphManager
4. **Phase 4**: Switch frontend to use tree-first loading
5. **Phase 5**: Remove old separate node/edge endpoints

## 🎉 **Expected Outcomes**

- **✅ No More Disconnected Nodes**: Tree edges guarantee connectivity
- **✅ Simpler Logic**: Append-only loading, no complex sync
- **✅ Better Performance**: Fewer API calls, better caching
- **✅ Natural Navigation**: Users see citation lineage immediately  
- **✅ Progressive Detail**: Extra edges appear on demand
- **✅ Fewer Bugs**: Atomic operations reduce edge cases

This architecture leverages the natural DAG structure of citations to provide a smooth, connected visualization experience. 