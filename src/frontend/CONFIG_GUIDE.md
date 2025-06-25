# 🎛️ Configuration System Guide

This document explains how to use the new centralized configuration system for the Citation Network Visualization.

## Overview

All visual styling, performance settings, and behavioral constants have been moved from scattered hardcoded values throughout the codebase into a single YAML configuration file: `config.yaml`.

## Configuration File Location

- **Source**: `src/frontend/config.yaml`
- **Runtime**: `src/frontend/public/config.yaml` (automatically copied)

## Key Benefits

1. **🎨 Easy Customization**: Change colors, sizes, and thresholds without touching code
2. **⚡ Performance Tuning**: Adjust cache settings, batch sizes, and LOD parameters
3. **🔧 Development**: Hot-reload configuration during development
4. **📊 Consistency**: All related constants are grouped together logically

## Configuration Sections

### Visual Styling (`visual`)
```yaml
visual:
  nodes:
    defaultSize: 3           # Node radius/size
    defaultColor: "#888888"  # Fallback node color
    minSize: 1              # Minimum node size
    maxSize: 20             # Maximum node size
    
  edges:
    defaultSize: 1          # Edge width/thickness
    defaultColor: "#cccccc" # Edge color (light gray)
    minSize: 0.1           # Minimum edge thickness
    maxSize: 5             # Maximum edge thickness

  search:
    focusNodeColor: "#ff6b6b"     # Selected paper color
    focusNodeSize: 15             # Size for focused nodes
    neighborNodeColor: "#4ecdc4"  # Neighbor color
    # ... more search styling
```

### Level of Detail (`lod`)
```yaml
lod:
  thresholds:
    detailed: 0.5    # Camera ratio threshold for detailed view
    normal: 3.0      # Camera ratio threshold for normal view
    
  maxNodes:
    0: 1000   # Max nodes in detailed view (LOD 0)
    1: 2500   # Max nodes in normal view (LOD 1)
    2: 1500   # Max nodes in overview (LOD 2)
    
  minDegree:
    0: 1      # Min degree filter for detailed view
    1: 2      # Min degree filter for normal view
    2: 10     # Min degree filter for overview
    
  loadEdges:
    0: true   # Load edges in detailed view
    1: true   # Load edges in normal view
    2: false  # Skip edges in overview
```

### Performance & Caching (`performance`)
```yaml
performance:
  cache:
    ttl: 10000                    # Cache lifetime (ms)
    maxRegions: 100               # Max cached regions
    overlapThreshold: 0.5         # Cache hit threshold
    
  loading:
    batchSize: 100               # Default batch size
    maxBatchSize: 1000           # Maximum batch size
    adaptiveBatching: true       # Enable adaptive batching
    
  api:
    timeout: 10000               # API timeout (ms)
    maxRetries: 3                # Retry attempts
```

## Usage in Code

### Import Configuration
```typescript
import { getConfig, getVisualConfig, getLODConfig } from './config/ConfigLoader';

// Get full configuration
const config = getConfig();

// Get specific sections
const visualConfig = getVisualConfig();
const lodConfig = getLODConfig();
```

### Using Configuration Values
```typescript
// Instead of hardcoded values:
// size: 3
// color: '#cccccc'

// Use configuration:
size: this.config.visual.nodes.defaultSize,
color: this.config.visual.edges.defaultColor,

// LOD thresholds:
if (cameraRatio < this.config.lod.thresholds.detailed) return 0;
if (cameraRatio < this.config.lod.thresholds.normal) return 1;
return 2;
```

### Runtime Configuration Updates
```typescript
// For debugging/tuning during development
const configLoader = ConfigLoader.getInstance();

// Update specific values
configLoader.updateConfig({
  visual: {
    nodes: { defaultSize: 5 }
  }
});

// Hot reload from file
await configLoader.reloadConfig();
```

## Configuration Migration

### Before (Hardcoded)
```typescript
private readonly MAX_NODES_BY_LOD = {
  0: 1000,
  1: 2500, 
  2: 1500
};

// Scattered throughout code:
size: 3,
color: '#cccccc',
```

### After (Configuration-Based)
```typescript
private config = getConfig();

// Centralized access:
size: this.config.visual.nodes.defaultSize,
color: this.config.visual.edges.defaultColor,
maxNodes: this.config.lod.maxNodes[lodLevel],
```

## Common Customizations

### Make Nodes Larger
```yaml
visual:
  nodes:
    defaultSize: 5  # Increase from 3 to 5
```

### Change Edge Color
```yaml
visual:
  edges:
    defaultColor: "#ff6b6b"  # Red edges instead of gray
```

### Adjust LOD Thresholds
```yaml
lod:
  thresholds:
    detailed: 0.3  # Switch to detailed view earlier
    normal: 2.0    # Switch to normal view earlier
```

### Increase Cache Performance
```yaml
performance:
  cache:
    ttl: 30000        # Cache for 30 seconds instead of 10
    maxRegions: 200   # Double the cache size
```

### Adjust Node Limits
```yaml
lod:
  maxNodes:
    0: 2000  # More nodes in detailed view
    1: 5000  # More nodes in normal view
    2: 3000  # More nodes in overview
```

## Development Tips

1. **Live Editing**: Edit `config.yaml` and call `configLoader.reloadConfig()` in browser console
2. **Validation**: The system falls back to defaults if YAML is invalid
3. **Type Safety**: All configuration values are strongly typed in TypeScript
4. **Performance**: Configuration is loaded once at startup and cached
5. **Debugging**: Configuration values are logged at startup for verification

## File Structure

```
src/frontend/
├── config.yaml                    # Main configuration file
├── public/config.yaml             # Runtime copy (auto-generated)
├── src/utils/config/
│   └── ConfigLoader.ts            # Configuration management system
└── src/utils/GraphManager.ts      # Uses configuration instead of hardcoded values
```

## Future Enhancements

- **Environment-specific configs**: `config.dev.yaml`, `config.prod.yaml`
- **User preferences**: Save user customizations to localStorage
- **UI Configuration Panel**: In-app configuration editor
- **Validation**: JSON Schema validation for configuration files
- **Documentation**: Auto-generate configuration documentation from types 