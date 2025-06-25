# Coordinate System Rules for Citation Network Visualization

## 🎯 **FUNDAMENTAL RULE: FIXED COORDINATE SPACE**

**Rule**: All 72,493 nodes exist in a **FIXED 2D embedding space** with immutable coordinates. The visualization system must NEVER alter this coordinate space.

### Mathematical Definition

```
Database Coordinate Space:
- X range: [-269.1, 273.1] (total width: 542.2 units)  
- Y range: [-299.4, 272.5] (total height: 571.9 units)
- Center: (2.0, -13.5)
- Each node has FIXED coordinates (x, y) that NEVER change
```

### Viewport Definition

```
Viewport State:
- center_x, center_y: Camera position in database coordinate space
- viewport_width, viewport_height: Size of visible area in database units
- zoom_ratio: Scaling factor (higher = more zoomed in)

Visible Region Calculation:
minX = center_x - viewport_width/2
maxX = center_x + viewport_width/2  
minY = center_y - viewport_height/2
maxY = center_y + viewport_height/2
```

## 🚨 **VIOLATIONS TO PREVENT**

### ❌ **Violation 1: Camera Auto-Adjustment**
- **Problem**: Adding/removing nodes causes Sigma.js camera to auto-adjust
- **Result**: Viewport jumps to different coordinate regions unexpectedly
- **Solution**: Disable auto-fitting, maintain explicit camera control

### ❌ **Violation 2: Coordinate Space Mutation** 
- **Problem**: Node positions change based on what's currently loaded
- **Result**: Same database coordinates appear in different screen positions
- **Solution**: All nodes use database coordinates directly, no transformation

### ❌ **Violation 3: Content-Dependent Positioning**
- **Problem**: Camera position depends on which nodes are currently loaded
- **Result**: Adding nodes in area A causes viewport to shift to area B
- **Solution**: Camera position determined by user interaction only

## ✅ **CORRECT WORKFLOW**

### Step 1: User Interaction
```
User drags → Sigma camera moves to (new_x, new_y, new_ratio)
User zooms → Sigma camera changes ratio only
```

### Step 2: Viewport Calculation
```
viewport_width = base_width / zoom_ratio
viewport_height = base_height / zoom_ratio
query_bounds = {
  minX: new_x - viewport_width/2,
  maxX: new_x + viewport_width/2,
  minY: new_y - viewport_height/2, 
  maxY: new_y + viewport_height/2
}
```

### Step 3: Database Query
```
nodes = R_tree.query(query_bounds.minX, query_bounds.maxX, 
                     query_bounds.minY, query_bounds.maxY, limit)
```

### Step 4: Node Rendering
```
For each node:
  sigma_node.x = database_node.x  // DIRECT mapping, no transformation
  sigma_node.y = database_node.y  // DIRECT mapping, no transformation
  sigma_node.size = calculate_size(database_node.degree, zoom_ratio)
```

### Step 5: Camera Stability
```
// Camera position must NEVER change due to node addition/removal
// Only user pan/zoom should change camera
sigma.camera.setState({x: new_x, y: new_y, ratio: new_ratio})
```

## 🔧 **IMPLEMENTATION REQUIREMENTS**

1. **Camera Lock**: Camera position changes ONLY from user input
2. **Direct Coordinates**: `sigma_node.x = db_node.x` (no offset/scaling)
3. **Viewport-Only Queries**: R-tree queries based on camera viewport only
4. **Size Scaling**: Only node size/edge width scale with zoom, not positions
5. **State Isolation**: Adding/removing nodes must not affect camera state

## 🎯 **SUCCESS CRITERIA**

- ✅ Dragging to same area always shows same nodes
- ✅ Adding nodes doesn't change viewport position  
- ✅ Zoom level affects size only, not spatial relationships
- ✅ Camera coordinates directly correspond to database coordinates
- ✅ Multiple zoom cycles maintain spatial consistency

---

**This rule ensures the citation network maintains its scientific clustering structure while providing smooth, predictable navigation.** 