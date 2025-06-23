# 🏗️ GraphManager Refactoring Plan

## 📋 **Current State Analysis**

The current `GraphManager.ts` (982 lines) is a monolithic class handling multiple responsibilities:

### **Current Responsibilities:**
1. **🎯 Level of Detail (LOD) Management** - Lines 85-95, 598-759
2. **🗺️ Viewport & Spatial Calculations** - Lines 352-409
3. **💾 Caching System** - Lines 107-133, 414-458
4. **🧠 Node Importance & Memory Management** - Lines 459-593
5. **🔗 Data Loading & API Communication** - Lines 598-982
6. **📊 Graph State Management** - Lines 312-351

### **Problems with Current Approach:**
- **God Class Anti-pattern**: Single class doing too much
- **Hard to Test**: Complex interdependencies
- **Hard to Maintain**: Changes ripple across unrelated functionality
- **Hard to Understand**: New developers need to understand 982 lines
- **Team Conflicts**: Multiple developers can't work on different parts simultaneously

---

## 🎯 **Proposed Refactored Architecture**

### **File Structure:**
```
src/frontend/src/utils/
├── GraphManager.ts                    # Slim orchestrator (150-200 lines)
├── types/
│   └── GraphTypes.ts                  # Shared interfaces and types
├── viewport/
│   ├── ViewportCalculator.ts          # Coordinate transformations
│   └── LevelOfDetail.ts              # LOD calculation and configuration
├── caching/
│   ├── SpatialCache.ts               # Spatial hashing and caching
│   └── LoadedRegionManager.ts        # Cache region lifecycle management
├── nodes/
│   ├── NodeImportanceCalculator.ts   # Node importance scoring
│   ├── NodeMemoryManager.ts          # Memory management and cleanup
│   └── NodeLoader.ts                 # Node loading strategies
├── edges/
│   └── EdgeLoader.ts                 # Edge loading logic
└── initialization/
    └── GraphInitializer.ts           # Initial setup and bounds fetching
```

---

## 📁 **Detailed Module Specifications**

### **1. 📋 `types/GraphTypes.ts`**
**Role:** Central type definitions and shared interfaces

**Responsibilities:**
- Define all interfaces used across modules
- Export configuration constants
- Maintain type safety across the system

**Extracted from Original:**
- `ViewportBounds` interface (lines 13-20)
- `LoadedRegion` interface (lines 23-29) 
- `NodeImportance` interface (lines 31-39)
- `QuadTreeNode` interface (lines 42-47)
- Configuration constants (lines 60-76)

**Exports:**
```typescript
export interface ViewportBounds { ... }
export interface LoadedRegion { ... }
export interface NodeImportance { ... }
export interface GraphStats { ... }
export interface LODConfiguration { ... }
export const DEFAULT_LOD_CONFIG: LODConfiguration;
```

---

### **2. 🎯 `viewport/LevelOfDetail.ts`**
**Role:** Level of Detail calculation and configuration management

**Responsibilities:**
- Calculate LOD level based on camera ratio
- Provide LOD-based filtering parameters
- Manage LOD configuration
- Determine when to load edges vs nodes only

**Extracted from Original:**
- `calculateLOD()` method (lines 85-95)
- LOD configuration constants (lines 60-76)
- LOD-based decision logic scattered throughout

**Key Methods:**
```typescript
calculateLOD(cameraRatio: number): number
getMaxNodes(lodLevel: number): number  
getMinDegree(lodLevel: number): number
shouldLoadEdges(lodLevel: number): boolean
getConfig(): LODConfiguration
```

**Usage in Original:**
- Used in `loadViewportNodesLOD()` (line 610)
- Referenced in node filtering (lines 650-655)
- Used in removal strategies (lines 759-814)

---

### **3. 🗺️ `viewport/ViewportCalculator.ts`**
**Role:** Viewport bounds calculation and coordinate transformations

**Responsibilities:**
- Convert screen coordinates to graph coordinates
- Calculate viewport bounds in database coordinates
- Provide viewport-related utility functions
- Handle coordinate system transformations

**Extracted from Original:**
- `getViewportBounds()` method (lines 352-409)
- Viewport-related calculations scattered throughout
- Node-in-viewport checks (multiple locations)

**Key Methods:**
```typescript
getViewportBounds(debug?: boolean): ViewportBounds
countNodesInViewport(bounds: ViewportBounds): number
getNodesInViewport(bounds: ViewportBounds): string[]
getNodesOutsideViewport(bounds: ViewportBounds): string[]
isNodeInViewport(nodeId: string, bounds: ViewportBounds): boolean
getDistanceFromViewportCenter(nodeId: string, bounds: ViewportBounds): number
```

**Dependencies:**
- Requires Sigma instance for coordinate transformations
- Used by almost all other modules for spatial calculations

---

### **4. 💾 `caching/SpatialCache.ts`**
**Role:** Spatial hashing and cache management

**Responsibilities:**
- Generate spatial hashes for efficient cache lookups
- Manage loaded region cache
- Implement cache hit/miss logic
- Handle cache expiration and cleanup

**Extracted from Original:**
- `generateSpatialHash()` method (lines 107-115)
- `isSpatialCached()` method (lines 122-133)
- `isViewportCached()` method (lines 414-458)
- Cache management logic throughout

**Key Methods:**
```typescript
generateSpatialHash(bounds: ViewportBounds, lodLevel: number): string
isSpatialCached(bounds: ViewportBounds, lodLevel: number): boolean
isViewportCached(bounds: ViewportBounds, requiredMinDegree: number): boolean
addRegion(bounds: ViewportBounds, nodeCount: number, lodLevel: number): void
clearCache(): void
cleanupExpiredCache(): number
getCacheStats(): CacheStats
```

**Dependencies:**
- Uses LevelOfDetail for TTL and threshold configuration
- Manages LoadedRegion array

---

### **5. 🧠 `nodes/NodeImportanceCalculator.ts`**
**Role:** Node importance scoring for memory management

**Responsibilities:**
- Calculate node importance based on degree, distance, viewport position
- Provide node categorization (viewport vs non-viewport)
- Support batch importance calculations
- Generate removal recommendations

**Extracted from Original:**
- `calculateNodeImportance()` method (lines 464-503)
- Node categorization logic (lines 508-520)
- Importance-based sorting and selection

**Key Methods:**
```typescript
calculateNodeImportance(nodeId: string, nodeAttributes: any, bounds: ViewportBounds): NodeImportance
calculateBatchImportance(nodeIds: string[], getNodeAttributes: Function, bounds: ViewportBounds): NodeImportance[]
sortByImportance(importanceList: NodeImportance[]): NodeImportance[]
selectNodesForRemoval(importanceList: NodeImportance[], targetCount: number): NodeImportance[]
categorizeNodesByViewport(nodeIds: string[], getNodeAttributes: Function, bounds: ViewportBounds): CategoryResult
```

**Dependencies:**
- Uses ViewportBounds for spatial calculations
- Works with graph node attributes

---

### **6. 🗑️ `nodes/NodeMemoryManager.ts`**
**Role:** Memory management and node cleanup

**Responsibilities:**
- Execute node removal based on importance scores
- Manage memory limits and cleanup strategies
- Track node usage and lifecycle
- Implement different removal strategies (LOD-aware vs legacy)

**Extracted from Original:**
- `removeExcessNodes()` method (lines 503-593)
- `removeExcessNodesLOD()` method (lines 759-814)
- Memory management logic and statistics

**Key Methods:**
```typescript
removeExcessNodes(bounds: ViewportBounds, maxNodes: number, strategy: 'legacy' | 'lod'): number
executeRemoval(nodesToRemove: NodeImportance[], graph: any): RemovalStats
trackNodeUsage(nodeId: string): void
getMemoryStats(): MemoryStats
```

**Dependencies:**
- Uses NodeImportanceCalculator for scoring
- Uses ViewportCalculator for spatial logic
- Directly manipulates Sigma graph

---

### **7. 📦 `nodes/NodeLoader.ts`**
**Role:** Node loading strategies and API communication

**Responsibilities:**
- Handle different node loading strategies (batched, lightweight, full)
- Manage API calls for node data
- Implement progressive loading with callbacks
- Handle loading state and error management

**Extracted from Original:**
- `loadViewportNodesLOD()` method (lines 598-759)
- `loadViewportNodes()` method (lines 814-900)
- `addBatchToGraph()` method (lines 143-184)
- Loading progress tracking

**Key Methods:**
```typescript
loadNodesLOD(bounds: ViewportBounds, lodLevel: number, onProgress?: ProgressCallback): Promise<LoadResult>
loadNodesBatched(bounds: ViewportBounds, batchSize: number, onBatch?: BatchCallback): Promise<Node[]>
loadNodesLight(bounds: ViewportBounds, limit: number): Promise<LightNode[]>
addBatchToGraph(nodes: Node[], minDegree: number, graph: any): number
```

**Dependencies:**
- Uses fetchBox, fetchBoxLight, fetchBoxBatched from API
- Uses LevelOfDetail for filtering parameters
- Coordinates with SpatialCache for caching

---

### **8. 🔗 `edges/EdgeLoader.ts`**
**Role:** Edge loading logic and management

**Responsibilities:**
- Load edges for viewport nodes only
- Manage edge loading strategies
- Handle edge filtering and deduplication
- Coordinate with node loading

**Extracted from Original:**
- `loadEdgesForViewportNodes()` method (lines 906-949)
- `loadEdgesForVisibleNodes()` method (lines 954-982)
- Edge loading coordination logic

**Key Methods:**
```typescript
loadEdgesForViewport(bounds: ViewportBounds, nodeIds: string[]): Promise<EdgeLoadResult>
loadEdgesBatch(nodeIds: string[], limit: number): Promise<Edge[]>
addEdgesToGraph(edges: Edge[], graph: any): number
```

**Dependencies:**
- Uses fetchEdgesBatch from API
- Uses ViewportCalculator to identify viewport nodes
- Directly manipulates Sigma graph

---

### **9. 🚀 `initialization/GraphInitializer.ts`**
**Role:** Initial setup and bounds fetching

**Responsibilities:**
- Handle initial graph setup
- Fetch and set data bounds
- Initialize camera position
- Provide fallback initialization

**Extracted from Original:**
- `initialize()` method (lines 204-291)
- `initializeWithFallback()` method (lines 295-311)
- Camera setup and bounds fetching logic

**Key Methods:**
```typescript
initialize(sigma: Sigma): Promise<void>
initializeWithFallback(sigma: Sigma): void
fetchAndSetBounds(sigma: Sigma): Promise<DataBounds | null>
setCameraPosition(sigma: Sigma, bounds?: DataBounds): void
```

**Dependencies:**
- Uses fetchBounds from API
- Directly manipulates Sigma camera
- Coordinates with other modules for initial loading

---

## 🎭 **Slim GraphManager Architecture**

### **New GraphManager Role:**
The refactored GraphManager becomes a **lightweight orchestrator** that:
- Coordinates between specialized modules
- Maintains high-level state
- Provides the public API interface
- Handles module lifecycle and dependencies

### **GraphManager Structure (~150-200 lines):**

```typescript
export class GraphManager {
  // Core dependencies
  private sigma: Sigma;
  private graph: any;
  
  // Specialized modules
  private lodManager: LevelOfDetail;
  private viewportCalculator: ViewportCalculator;
  private spatialCache: SpatialCache;
  private nodeImportanceCalculator: NodeImportanceCalculator;
  private nodeMemoryManager: NodeMemoryManager;
  private nodeLoader: NodeLoader;
  private edgeLoader: EdgeLoader;
  private initializer: GraphInitializer;
  
  // High-level state
  public isLoading: boolean = false;
  public isDragging: boolean = false;
  public batchProgress: BatchProgress | null = null;
  
  constructor(sigma: Sigma) {
    // Initialize all modules with proper dependency injection
  }
  
  // Public API methods
  public async initialize(): Promise<void>
  public async updateViewport(): Promise<void>
  public async refresh(): Promise<void>
  public getStats(): GraphStats
  public resetLoadingState(): void
  public destroy(): void
  
  // Private orchestration methods
  private async orchestrateNodeLoading(): Promise<void>
  private async orchestrateMemoryManagement(): Promise<void>
  private handleLoadingProgress(): void
}
```

---

## 🔄 **Module Interaction Flow**

### **1. Initialization Flow:**
```
GraphManager.initialize()
  ├── GraphInitializer.initialize()
  │   ├── fetchAndSetBounds()
  │   └── setCameraPosition()
  └── NodeLoader.loadNodesLOD()
      ├── LevelOfDetail.calculateLOD()
      ├── SpatialCache.isSpatialCached()
      └── EdgeLoader.loadEdgesForViewport()
```

### **2. Viewport Update Flow:**
```
GraphManager.updateViewport()
  ├── ViewportCalculator.getViewportBounds()
  ├── LevelOfDetail.calculateLOD()
  ├── SpatialCache.isSpatialCached()
  └── IF cache miss:
      ├── NodeLoader.loadNodesLOD()
      ├── NodeMemoryManager.removeExcessNodes()
      │   └── NodeImportanceCalculator.calculateBatchImportance()
      └── EdgeLoader.loadEdgesForViewport()
```

### **3. Memory Management Flow:**
```
NodeMemoryManager.removeExcessNodes()
  ├── ViewportCalculator.getNodesInViewport()
  ├── NodeImportanceCalculator.calculateBatchImportance()
  ├── NodeImportanceCalculator.selectNodesForRemoval()
  └── Execute removal on Sigma graph
```

---

## 📊 **Benefits of This Architecture**

### **1. Single Responsibility Principle:**
- Each module has one clear, focused purpose
- Easy to understand and reason about individual components

### **2. Testability:**
- Each module can be unit tested in isolation
- Mock dependencies for focused testing
- Clear interfaces make testing straightforward

### **3. Maintainability:**
- Changes are isolated to relevant modules
- Bug fixes don't risk breaking unrelated functionality
- Easy to add new features without touching existing code

### **4. Team Development:**
- Multiple developers can work on different modules simultaneously
- Clear module boundaries prevent merge conflicts
- Easier code reviews focused on specific functionality

### **5. Reusability:**
- Modules can be reused in other contexts
- Clear interfaces allow for easy composition
- Configuration-driven behavior

### **6. Performance:**
- Lazy loading of modules when needed
- Better memory management through focused responsibilities
- Easier to optimize individual components

---

## 🚀 **Migration Strategy**

### **Phase 1: Create New Modules**
1. Create all new module files with their interfaces
2. Implement core functionality in each module
3. Add comprehensive unit tests for each module

### **Phase 2: Create Slim GraphManager**
1. Implement new GraphManager that uses the modules
2. Ensure API compatibility with existing code
3. Add integration tests

### **Phase 3: Switch Implementation**
1. Update Graph.tsx to use new GraphManager
2. Run extensive testing to ensure functionality parity
3. Remove old GraphManager implementation

### **Phase 4: Optimization**
1. Fine-tune module interactions
2. Add performance monitoring
3. Optimize based on real usage patterns

---

## 🧪 **Testing Strategy**

### **Unit Tests (Per Module):**
- **LevelOfDetail**: Test LOD calculations with various camera ratios
- **ViewportCalculator**: Test coordinate transformations and bounds calculations
- **SpatialCache**: Test cache hit/miss logic and expiration
- **NodeImportanceCalculator**: Test importance scoring algorithms
- **NodeMemoryManager**: Test removal strategies and statistics
- **NodeLoader**: Test loading strategies and progress tracking
- **EdgeLoader**: Test edge loading and filtering

### **Integration Tests:**
- Test module interactions and data flow
- Test complete loading scenarios
- Test error handling and recovery

### **Performance Tests:**
- Compare performance with original implementation
- Test memory usage and cleanup
- Test loading times and responsiveness

---

## 📋 **Implementation Checklist**

- [ ] Create `types/GraphTypes.ts` with all interfaces
- [ ] Implement `viewport/LevelOfDetail.ts`
- [ ] Implement `viewport/ViewportCalculator.ts`
- [ ] Implement `caching/SpatialCache.ts`
- [ ] Implement `nodes/NodeImportanceCalculator.ts`
- [ ] Implement `nodes/NodeMemoryManager.ts`
- [ ] Implement `nodes/NodeLoader.ts`
- [ ] Implement `edges/EdgeLoader.ts`
- [ ] Implement `initialization/GraphInitializer.ts`
- [ ] Create slim `GraphManager.ts`
- [ ] Write unit tests for all modules
- [ ] Write integration tests
- [ ] Update Graph.tsx to use new GraphManager
- [ ] Perform comprehensive testing
- [ ] Remove old GraphManager implementation

---

This refactoring plan transforms a 982-line monolithic class into a well-structured, maintainable system of focused modules that work together through clear interfaces and dependency injection. 