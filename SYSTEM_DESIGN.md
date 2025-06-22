# 🏗️ Citation Network Visualization System Design

## 📋 **System Requirements**

### **Functional Requirements**
1. **Data Visualization**: Display 72,493 research papers as an interactive network graph
2. **Spatial Navigation**: Pan and zoom to explore different regions of the citation space  
3. **Performance**: Handle full dataset with smooth real-time interaction (<200ms response)
4. **Streaming**: Load content incrementally as user navigates (Netflix-like experience)
5. **Scalability**: Support viewport-based loading for datasets of 100k+ nodes

### **Non-Functional Requirements**
1. **Responsiveness**: UI remains interactive during data loading
2. **Memory Efficiency**: Constant memory usage regardless of exploration time
3. **Network Efficiency**: Minimize redundant API calls through spatial caching
4. **Error Recovery**: Graceful handling of network/database failures
5. **Cross-Platform**: Works on desktop and mobile browsers

## 🎯 **System Boundaries & Interfaces**

### **Input Interfaces**
- **User Input**: Mouse/touch pan, zoom, click interactions
- **Database**: SQLite with 72k papers, R-tree spatial index
- **Configuration**: Environment variables, runtime parameters

### **Output Interfaces**  
- **Visual Display**: Interactive graph rendered via WebGL (Sigma.js)
- **API Responses**: JSON data for nodes, edges, statistics
- **Logs**: Structured logging for debugging and monitoring

### **External Dependencies**
- **React 18**: UI framework and state management
- **Sigma.js 3**: Graph rendering and interaction handling
- **FastAPI**: Backend API server with automatic documentation
- **SQLite**: Embedded database with spatial extensions

## 🏛️ **Architecture Principles**

### **Object-Oriented Design** ⭐ **NEW**
1. **GraphManager Class**: Encapsulates all viewport and memory management logic
2. **Clear Responsibilities**: Each class/method has a single, well-defined purpose
3. **Encapsulation**: Internal state hidden behind clean public interfaces
4. **Inheritance & Composition**: Reusable components with clear hierarchies

### **Separation of Concerns**
1. **Backend**: Data access, spatial queries, business logic
2. **Frontend**: User interaction, rendering, state management  
3. **API Layer**: Clean REST interface between backend/frontend
4. **Database**: Data storage and spatial indexing only

### **Single Responsibility**
1. **One component, one purpose**: No multi-responsibility classes
2. **Clear interfaces**: Each module has well-defined inputs/outputs
3. **Testable units**: Each component can be tested in isolation

### **KISS (Keep It Simple)**
1. **Minimal viable architecture**: No premature optimization
2. **Standard patterns**: Use proven architectural patterns
3. **Clear data flow**: Unidirectional data flow where possible

## 📊 **Component Specifications**

### **Backend API Server**

#### **Responsibilities**
- Serve spatial queries from R-tree index
- Provide health checks and debugging endpoints
- Handle CORS for frontend communication
- Log requests and performance metrics

#### **Key Endpoints**
```http
GET  /api/nodes/box?minX={x}&maxX={x}&minY={y}&maxY={y}&limit={n}
POST /api/edges/batch {node_ids: [...], limit: n}
GET  /api/stats
GET  /api/debug/health
```

#### **Input Contracts** ⭐ **SIMPLIFIED**
- `minX, maxX, minY, maxY`: Database coordinate bounds (float, range [-300, 300])
- ~~`ratio`: Zoom level~~ **REMOVED** - LOD now calculated on frontend
- `limit`: Maximum results (int, range [1, 5000])
- `node_ids`: Array of paper IDs (string array, max 1000 items)

#### **Output Contracts**
```typescript
interface Node {
  key: string;
  attributes: {
    label: string;
    x: number;        // Database coordinates [-300, 300]
    y: number;        // Database coordinates [-300, 300]  
    size: number;     // Visual size hint
    color: string;    // Hex color code
    community: number; // Cluster ID [0-15]
    degree: number;   // Citation count [1-2000]
  }
}

interface Edge {
  source: string;   // Paper ID
  target: string;   // Paper ID
  attributes?: {};  // Optional metadata
}
```

### **Frontend Visualization** ⭐ **OBJECT-ORIENTED**

#### **GraphManager Class** - **NEW ARCHITECTURE**
```typescript
class GraphManager {
  // Core responsibilities
  - viewport tracking and bounds calculation
  - spatial caching with intelligent overlap detection  
  - level-of-detail calculation based on viewport size
  - memory management with importance-based node retention
  - automatic edge loading for visible nodes
  
  // Key methods
  + initialize(): Promise<void>
  + getStats(): GraphStats
  + refresh(): Promise<void>
  + destroy(): void
  
  // Private methods (encapsulated)
  - getViewportBounds(): ViewportBounds
  - calculateLOD(bounds): {minDegree, limit}
  - isViewportCached(bounds): boolean
  - calculateNodeImportance(nodeId, bounds): NodeImportance
  - removeExcessNodes(bounds): number
  - loadViewportNodes(bounds): Promise<void>
  - loadEdgesForVisibleNodes(): Promise<void>
}
```

#### **Key Improvements**
1. **No Ratio Parameter**: LOD calculated from viewport area, not backend ratio
2. **Intelligent Memory Management**: Keeps important nodes (high degree, near center)
3. **Spatial Caching**: 30% overlap threshold with 5-second TTL
4. **Protected Nodes**: Always keeps 100 most important nodes to prevent blank screen
5. **Encapsulated Logic**: All viewport management in single class

#### **Data Flow** ⭐ **SIMPLIFIED**
```
User Interaction → Camera Update → GraphManager.updateViewport() → 
Cache Check → API Query (if needed) → Frontend LOD Filter → 
Graph Update → Memory Management → Visual Render
```

#### **Performance Targets**
- **Initial Load**: <500ms to first nodes
- **Viewport Change**: <200ms to new content
- **Memory Usage**: <100MB regardless of exploration
- **Cache Hit Rate**: >70% for typical navigation

### **Development Tools**

#### **Single Development Script**
```bash
# One command starts everything
python start.py --dev  # Backend + frontend + monitoring
```

#### **Single Test Command**  
```bash
# One command tests everything
python start.py --test  # Backend API + Frontend rendering + Integration
```

#### **Single Debug Interface**
- **Health Check**: Built into frontend UI (toggle button)
- **Error Monitoring**: Automatic browser testing
- **Performance Metrics**: Real-time display in debug panel

## 🔧 **Implementation Standards**

### **Object-Oriented Principles** ⭐ **NEW**
```typescript
// Encapsulation: Private methods and state
class GraphManager {
  private sigma: Sigma;
  private loadedRegions: LoadedRegion[] = [];
  private nodeImportanceMap: Map<string, NodeImportance> = new Map();
  
  // Public interface
  public async initialize(): Promise<void> { /* ... */ }
  public getStats(): GraphStats { /* ... */ }
  
  // Private implementation details
  private calculateNodeImportance(nodeId: string): NodeImportance { /* ... */ }
}

// Single Responsibility: Each method has one clear purpose
private async loadViewportNodes(bounds: ViewportBounds): Promise<void>
private removeExcessNodes(bounds: ViewportBounds): number
private calculateLOD(bounds: ViewportBounds): {minDegree: number, limit: number}
```

### **Error Handling**
```typescript
// All errors must be handled with specific types
interface APIError {
  type: 'network' | 'timeout' | 'server' | 'validation';
  message: string;
  retryable: boolean;
}

// All async operations must have timeouts
const response = await fetchWithTimeout(url, { timeout: 5000 });
```

### **Logging Standards**
```python
# Backend: Structured JSON logs (no more ratio parameter)
logger.info("spatial_query", {
  "bounds": [minX, maxX, minY, maxY],
  "limit": limit,
  "result_count": len(nodes),
  "duration_ms": duration
})
```

```typescript  
// Frontend: Console logs with emojis for easy scanning
console.log('🧠 GraphManager initialized');
console.log('🎯 LOD calculated:', { minDegree, limit, viewportArea });
console.log('🗑️ Memory management:', { removed, kept, protected });
```

### **Testing Requirements**
- **Unit Tests**: Each GraphManager method tested in isolation
- **Integration Tests**: Full API → GraphManager → User flow  
- **Performance Tests**: Memory management with 10k+ nodes
- **Error Tests**: Network failures, malformed data

### **Code Organization** ⭐ **UPDATED**
```
src/frontend/
├── start.py              # Single startup script
├── backend_fastapi.py    # API server (ratio parameter removed)
├── src/
│   ├── Graph.tsx         # Simple component using GraphManager
│   ├── utils/
│   │   └── GraphManager.ts # Object-oriented graph management
│   ├── api/              # API client functions (simplified)
│   └── components/       # React components
└── test/                 # All tests
```

## 🎯 **Success Metrics**

### **User Experience**
- Users can explore 72k papers smoothly
- No loading delays during normal navigation  
- Clear visual feedback during data loading
- Works on mobile and desktop browsers

### **Developer Experience**
- Single command to start development environment
- Clear error messages with actionable information
- Easy to add new features without breaking existing ones
- Comprehensive test coverage for confidence

### **System Performance**
- Handles full 72k dataset in production
- <200ms API response times at 95th percentile
- <100MB frontend memory usage
- 99.9% uptime in production deployment

## 🚧 **Migration Plan**

### **✅ Phase 1: Cleanup (COMPLETE)**
1. ✅ Remove redundant files and scripts
2. ✅ Consolidate to single graph component
3. ✅ Single startup script
4. ✅ Clean up API endpoints

### **✅ Phase 2: Architecture (COMPLETE)**
1. ✅ Object-oriented GraphManager class
2. ✅ Remove unnecessary ratio parameter
3. ✅ Intelligent memory management
4. ✅ Frontend-based level of detail

### **🔄 Phase 3: Polish (In Progress)**
1. 🔄 Mobile optimization
2. 🔄 Advanced features (search, filtering)
3. 🔄 Production deployment
4. 🔄 Documentation and onboarding

---

**This design now follows true object-oriented principles with clean encapsulation, intelligent memory management, and simplified API contracts.** 