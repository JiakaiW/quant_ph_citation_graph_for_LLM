# Development & Debugging Guide

## 🛠️ Complete Setup Instructions

### Backend Setup

1. **Install Python Dependencies**
   ```bash
   cd src/frontend
   pip install -r requirements.txt
   ```

2. **Start Backend (Debug Mode)**
   ```bash
   python start_backend_debug.py
   ```
   
   **OR** (Production Mode - no logs):
   ```bash
   python start_backend.py
   ```

### Frontend Setup

1. **Install Node.js Dependencies**
   ```bash
   cd src/frontend
   npm install
   ```

2. **Start Frontend Development Server**
   ```bash
   npm run dev
   ```

## 🔍 Debugging & Monitoring

### Backend Monitoring

The FastAPI backend provides comprehensive debugging tools:

#### 1. **Debug Endpoints**
- **Health Check**: `http://localhost:8000/api/debug/health`
- **Database Info**: `http://localhost:8000/api/debug/database`
- **Recent Logs**: `http://localhost:8000/api/debug/logs`
- **API Documentation**: `http://localhost:8000/docs`

#### 2. **Log Files**
- **Location**: `src/frontend/api_debug.log`
- **Content**: All API requests, errors, and performance metrics
- **Monitoring**: Real-time log monitoring in debug mode

#### 3. **Performance Monitoring**
- **Slow Queries**: Logged when requests take >2 seconds
- **Request Counts**: Total API calls tracked
- **Error Rates**: Failed requests monitored
- **Spatial Queries**: R-Tree usage statistics

### Frontend Monitoring

#### 1. **Debug Panel**
- **Toggle**: Click "🐛 Debug" button (top-right corner)
- **Features**:
  - Real-time server statistics
  - API request monitoring
  - Backend log viewing
  - Health check button
  - Auto-refresh toggle

#### 2. **Browser Console**
- **React Errors**: Component errors and warnings
- **API Calls**: Network request logs
- **Sigma.js Events**: Graph interaction events
- **Performance**: Rendering time measurements

## 📊 Troubleshooting Common Issues

### 1. **"npm not found" or Wrong Directory**
```bash
# WRONG: Running from project root
npm run dev  # ❌ Error: package.json not found

# CORRECT: Run from frontend directory
cd src/frontend
npm run dev  # ✅ Works
```

### 2. **Module Import Errors**
```bash
# If uvicorn not found:
pip install uvicorn fastapi

# If React types not found:
npm install @types/react @types/react-dom
```

### 3. **File Watching Issues**
The debug startup script disables file watching to avoid errors:
```python
# In start_backend_debug.py
uvicorn.run(reload=False)  # Prevents file watching issues
```

### 4. **Database Connection Issues**
```bash
# Check database exists and has data:
sqlite3 ../../data/arxiv_papers.db "SELECT COUNT(*) FROM filtered_papers"

# Expected output: 72493 (or similar number)
```

### 5. **Port Conflicts**
```bash
# Backend (port 8000)
lsof -i :8000
kill -9 <PID>

# Frontend (port 5173)
lsof -i :5173
kill -9 <PID>
```

## 🎯 Development Workflow

### 1. **Start Development Session**
```bash
# Terminal 1: Backend
cd src/frontend
python start_backend_debug.py

# Terminal 2: Frontend  
cd src/frontend
npm run dev
```

### 2. **Monitor System Health**
- Visit `http://localhost:8000/api/debug/health`
- Check debug panel in React app
- Monitor terminal logs for errors

### 3. **Debug API Issues**
```bash
# Test specific endpoints:
curl http://localhost:8000/api/stats
curl http://localhost:8000/api/nodes/top?limit=5
curl http://localhost:8000/api/debug/health
```

### 4. **Performance Debugging**
- **Slow Queries**: Check `api_debug.log` for ⏰ warnings
- **Memory Usage**: Monitor via debug panel
- **Network Tab**: Check browser DevTools for API timing

## 🎮 Keyboard Shortcuts

- **Debug Panel**: `Ctrl+D` (or click 🐛 button)
- **Refresh Graph**: `F5`
- **Open DevTools**: `F12`
- **Backend Logs**: `Ctrl+Shift+L` (in terminal)

## 📈 Performance Optimization

### Backend Optimizations
- **R-Tree Indexing**: Spatial queries use O(log n) complexity
- **Query Caching**: Degree calculations cached
- **LOD Filtering**: Reduces node count based on zoom level
- **Connection Pooling**: SQLite connections reused

### Frontend Optimizations
- **Debounced Updates**: 300ms throttle on viewport changes
- **Progressive Loading**: Nodes loaded incrementally
- **Memory Management**: Unused nodes cleaned up
- **Render Optimization**: Sigma.js WebGL acceleration

## 🔧 Configuration

### Backend Configuration
```python
# In backend_fastapi.py
LOD_THRESHOLDS = {
    "zoomed_out": 0.3,    # Adjust zoom thresholds
    "medium": 1.0,
    "zoomed_in": float('inf')
}

DEGREE_THRESHOLDS = {
    "zoomed_out": 10,     # Adjust degree filters
    "medium": 5,
    "zoomed_in": 0
}
```

### Frontend Configuration
```typescript
// In Graph.tsx
const DEBOUNCE_TIME = 300;     // API call throttling
const INITIAL_NODES = 2000;    // Initial load size
const VIEWPORT_NODES = 3000;   // Viewport load size
```

## 📋 Deployment Checklist

- [ ] Backend starts without errors
- [ ] Frontend builds successfully
- [ ] API endpoints respond correctly
- [ ] Database has expected data
- [ ] Debug panel shows green status
- [ ] No console errors
- [ ] Performance metrics acceptable
- [ ] CORS configured correctly

## 🚨 Emergency Debugging

If everything breaks:

1. **Check the basics**:
   ```bash
   # Database exists?
   ls -la ../../data/arxiv_papers.db
   
   # Dependencies installed?
   pip list | grep fastapi
   npm list | grep react
   ```

2. **Reset everything**:
   ```bash
   # Kill all processes
   pkill -f uvicorn
   pkill -f vite
   
   # Restart fresh
   cd src/frontend
   python start_backend_debug.py &
   npm run dev
   ```

3. **Check the debug endpoints**:
   - Health: `http://localhost:8000/api/debug/health`
   - Database: `http://localhost:8000/api/debug/database`
   - Logs: `http://localhost:8000/api/debug/logs` 