# 🌐 Frontend Directory Organization

This directory contains the complete visualization system for the citation network. Here's what each file/folder contains:

## 🔧 **ACTIVE CODE (Currently Used)**

### **Backend (Python/FastAPI)**
- `backend_fastapi.py` - Main API server with spatial queries
- `start_backend.py` - Production startup script  
- `start_backend_debug.py` - Development startup with verbose logging
- `error_monitor.py` - Automated frontend testing with Playwright
- `test_system.py` - System integration tests
- `requirements.txt` - Python dependencies

### **Frontend (React/TypeScript)**
- `src/` - Main React application source code
  - `App.tsx` - Main application with mode switching UI
  - `components/`
    - `GraphViewportSimple.tsx` - **ACTIVE**: Advanced viewport-based streaming (831 lines)
    - `Graph.tsx` - **FALLBACK**: Simple batch loading mode (270 lines)
    - `DebugPanel.tsx` - Backend monitoring UI panel
    - `DataDebug.tsx` - API testing and status panel
    - `ErrorBoundary.tsx` - React error handling
  - `api/fetchNodes.ts` - API client functions for backend communication
  - `hooks/useViewport.ts` - Camera and viewport utilities
- `package.json` - Node.js dependencies and scripts
- `vite.config.ts` - Vite build configuration
- `index.html` - Main HTML entry point (served by Vite)

## 🗂️ **LEGACY FILES (Not Currently Used)**

### **Old Flask Implementation**
- `static/` - CSS and JS files from old Flask server
  - `css/style.css` - Old styling (replaced by React CSS)
  - `js/app.js` - Old vanilla JS (replaced by React/TypeScript)
- `templates/index.html` - Old Flask template (replaced by React)

### **Component Backups**
- `src/components/Graph.complex.backup.tsx` - Previous complex implementation (kept for reference)

## 🎮 **How It Works**

### **Current Architecture**
1. **Backend**: FastAPI serves spatial queries from SQLite with R-tree indexing
2. **Frontend**: React app with two modes:
   - **⚡ Phase 2** (Default): `GraphViewportSimple.tsx` - Advanced streaming
   - **📊 Phase 1** (Fallback): `Graph.tsx` - Simple batch loading

### **Mode Selection**
The main `App.tsx` provides a toggle button to switch between:
- Advanced viewport-based loading (recommended)
- Simple batch loading (fallback/debugging)

### **Development Setup**
```bash
# Terminal 1: Start backend
python start_backend_debug.py

# Terminal 2: Start frontend  
npm run dev

# Visit: http://localhost:5173
```

### **Production Build**
```bash
npm run build          # Creates dist/ folder
python start_backend.py # Serves React build + API
```

## 🔄 **Auto-Generated Files**
- `node_modules/` - Node.js packages (created by `npm install`)
- `dist/` - Production build output (created by `npm run build`)
- `api_debug.log` - Runtime API logs (created by backend)
- `frontend_errors.log` - Frontend error logs (created by error_monitor.py)
- `frontend_error_report.json` - Error monitoring reports

## 🧭 **Navigation Guide**

- **Want to understand the UI?** → Start with `src/App.tsx`
- **Want to see the graph visualization?** → Look at `src/components/GraphViewportSimple.tsx`  
- **Want to understand the API?** → Check `src/api/fetchNodes.ts` and `backend_fastapi.py`
- **Want to debug issues?** → Use `DebugPanel.tsx` component and `error_monitor.py`
- **Want to add features?** → Modify components in `src/components/`

The system is designed to be modular - each component has a clear responsibility and can be developed/tested independently.

Modern web visualization for citation networks using FastAPI + React + Sigma.js with intelligent Level-of-Detail (LOD) loading.

## 🏗️ Architecture

### Backend (FastAPI)
- **SQLite + R-Tree**: Spatial indexing for efficient viewport queries
- **Smart Node Filtering**: 4 LOD levels based on zoom ratio
- **API Endpoints**: `/api/nodes/top`, `/api/nodes/box`, `/api/edges/box`, `/api/stats`

### Frontend (React + Sigma.js v2)
- **Dynamic Loading**: Loads nodes based on viewport and zoom level
- **Debounced Updates**: 300ms throttle to avoid API spam
- **Real-time Stats**: Shows node/edge count and camera position

## 🚀 Quick Start

### 1. Backend Setup
```bash
cd src/frontend

# Install Python dependencies
pip install -r requirements.txt

# Start FastAPI server (creates spatial index automatically)
python start_backend.py
```

The backend will be available at:
- **API**: http://localhost:8000
- **Docs**: http://localhost:8000/docs

### 2. Frontend Setup
```bash
# Install Node.js dependencies
npm install

# Start React development server
npm run dev
```

The frontend will be available at:
- **App**: http://localhost:5173

## 📊 Level of Detail (LOD) System

The system automatically adjusts node density based on zoom level:

| Zoom Level | Ratio Range | Node Filter | Description |
|------------|-------------|-------------|-------------|
| **Zoomed Out** | < 0.3 | degree ≥ 10 | High-degree hubs only |
| **Medium** | 0.3 - 1.0 | degree ≥ 5 | Medium-degree + cluster centroids |
| **Zoomed In** | ≥ 1.0 | All nodes | Full detail in viewport |

## 🔧 API Endpoints

### GET `/api/nodes/top`
Get top N nodes by degree for initial load.
- `limit`: Number of nodes (default: 2000)
- `min_degree`: Minimum degree filter (default: 5)

### GET `/api/nodes/box`
Get nodes within viewport bounding box with LOD filtering.
- `minX`, `maxX`, `minY`, `maxY`: Bounding box coordinates
- `ratio`: Zoom ratio for LOD determination
- `limit`: Maximum nodes to return (default: 5000)

### GET `/api/edges/box`
Get edges for specific nodes.
- `node_ids`: Comma-separated node IDs
- `limit`: Maximum edges (default: 10000)

### GET `/api/stats`
Get database statistics and coordinate bounds.

## 📁 Project Structure

```
src/frontend/
├── backend_fastapi.py      # FastAPI server with spatial indexing
├── start_backend.py        # Server startup script
├── requirements.txt        # Python dependencies
├── package.json           # Node.js dependencies
├── src/
│   ├── components/
│   │   └── Graph.tsx      # Main Sigma.js graph component
│   ├── hooks/
│   │   └── useViewport.ts # Camera state hook with debouncing
│   ├── api/
│   │   └── fetchNodes.ts  # API client functions
│   ├── App.tsx           # Main React component
│   └── main.tsx          # React entry point
└── export_for_sigma.py   # Legacy export script (moved from clustering/)
```

## 🎯 Development Workflow

1. **Backend Development**: Test endpoints with http://localhost:8000/docs
2. **Frontend Development**: React + Vite hot reload on port 5173
3. **Database**: SQLite with R-Tree spatial index (auto-created)
4. **Debugging**: Check browser console and FastAPI logs

## 📈 Performance Features

- **Spatial Index**: R-Tree for O(log n) viewport queries
- **Smart Caching**: Tracks loaded nodes to avoid duplicate requests
- **Debounced Loading**: 300ms throttle on camera movements
- **Efficient Updates**: Only fetches significant viewport changes
- **Edge Optimization**: Loads edges only for visible nodes

## 🔗 Integration

This frontend integrates with the existing clustering pipeline:

1. **Data Source**: Uses `filtered_papers` and `filtered_citations` tables
2. **Embeddings**: Displays 2D UMAP projections as node positions  
3. **Clusters**: Color-codes nodes by cluster ID from k-means results
4. **Degree**: Node sizes based on citation degree centrality

## 🛠️ Troubleshooting

- **Empty Graph**: Check if clustering pipeline has run and populated embeddings
- **Slow Loading**: Reduce LOD thresholds or increase debounce timeout
- **CORS Errors**: Ensure FastAPI CORS settings match your frontend port
- **Database Lock**: Stop any running clustering processes before starting backend 