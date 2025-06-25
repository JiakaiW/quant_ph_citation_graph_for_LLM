# 🎯 Coordinate Scaling System

## Overview

The Citation Network Visualization now includes a **global coordinate scaling system** that allows you to control the spacing between nodes by adjusting a single parameter.

## Quick Usage

To make nodes **5x more spread out** (less cramped), simply change this line in your configuration:

```yaml
# In config.yaml or public/config.yaml
viewport:
  coordinateScale: 5.0  # Change from 1.0 to 5.0
```

## Configuration Location

You can modify the coordinate scaling in either of these files:
- `src/frontend/config.yaml` (development)
- `src/frontend/public/config.yaml` (production)

## Scale Values

| Scale Value | Effect | Use Case |
|-------------|--------|----------|
| `1.0` | Original spacing | Default, nodes as stored in database |
| `2.0` | 2x more spread out | Moderate spacing increase |
| `5.0` | 5x more spread out | Significant spacing for dense graphs |
| `10.0` | 10x more spread out | Maximum spacing for very dense data |
| `0.5` | 2x more compressed | Tighter spacing (rarely needed) |

## How It Works

### Architecture
The system operates at the **single point of truth** where nodes are added to the graph:

1. **Database coordinates**: Nodes stored in database with original positions
2. **API queries**: Viewport bounds converted back to database coordinates  
3. **Node rendering**: Coordinates multiplied by `coordinateScale` when added to graph
4. **Camera positioning**: Initial camera position scaled to match node positions

### Object-Oriented Design
The scaling is implemented cleanly in the `GraphManager` class:

```typescript
// Single place where scaling is applied
const coordinateScale = this.config.viewport.coordinateScale;
const nodeAttrs: any = {
  x: node.attributes.x * coordinateScale,
  y: node.attributes.y * coordinateScale,
  // ... other attributes
};
```

### Coordinate System Integrity
- ✅ **Database queries**: Use original coordinates (auto-converted)
- ✅ **Node positions**: Scaled for display
- ✅ **Viewport calculations**: Automatically handle both coordinate systems
- ✅ **Camera positioning**: Scaled to match node positions
- ✅ **Spatial indexing**: Uses scaled coordinates for consistency

## Benefits

1. **🎛️ Single Parameter Control**: Change one number to adjust entire graph spacing
2. **🔧 No Code Changes**: Pure configuration change, no programming required  
3. **⚡ Real-time**: Takes effect immediately on page refresh
4. **🎯 Precise Control**: Fine-tune spacing with decimal values (e.g., 2.5x)
5. **🧠 Maintains Relationships**: Relative positions preserved perfectly
6. **📊 Database Integrity**: Original data unchanged

## Implementation Details

### Viewport Bounds Conversion
The system automatically handles coordinate system conversion:

```typescript
// Viewport bounds returned in database coordinates for API queries
public getViewportBounds(): ViewportBounds {
  // Convert scaled screen coordinates back to database coordinates
  const coordinateScale = this.config.viewport.coordinateScale;
  return {
    minX: Math.min(...allX) / coordinateScale,
    maxX: Math.max(...allX) / coordinateScale,
    // ... automatically scaled for API compatibility
  };
}
```

### Node Checking
Internal node operations use scaled coordinates:

```typescript
// Helper method for viewport checking
private isNodeInScaledViewport(nodeAttrs: any, scaledBounds: ViewportBounds): boolean {
  return nodeAttrs.x >= scaledBounds.minX && nodeAttrs.x <= scaledBounds.maxX && 
         nodeAttrs.y >= scaledBounds.minY && nodeAttrs.y <= scaledBounds.maxY;
}
```

## Troubleshooting

### Issue: Nodes don't appear after scaling
**Solution**: The camera might need repositioning. The system automatically handles this, but if issues persist, try refreshing the page.

### Issue: Performance impact
**Solution**: Coordinate scaling has **zero performance impact** - it's a simple multiplication applied once when nodes are loaded.

### Issue: Viewport queries fail
**Solution**: The system automatically converts between coordinate systems. If issues persist, check that `coordinateScale` is a positive number.

## Advanced Usage

### Dynamic Scaling
For advanced users, the scaling can be changed programmatically:

```typescript
// Update config and refresh
const config = getConfig();
config.viewport.coordinateScale = 3.0;
await graphManager.refresh();
```

### Custom Scaling Per Cluster
While not currently implemented, the architecture supports per-cluster scaling by modifying the `addBatchToGraph` method.

---

**Result**: With `coordinateScale: 5.0`, your 70,000 nodes will be 5x more spread out, making the visualization much less cramped while maintaining all scientific clustering relationships. 