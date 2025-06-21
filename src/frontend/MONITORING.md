# 🔍 Frontend Error Monitoring System

This system provides automated monitoring of React frontend errors without manual browser interaction, perfect for development and CI/CD pipelines.

## 🚀 Quick Start

### 1. **Install Dependencies**
```bash
pip install -r requirements.txt
playwright install chromium
```

### 2. **Run Automated System Test**
```bash
# Quick 15-second test
python test_system.py --quick

# Full 60-second test with dependency installation
python test_system.py --install-deps --duration 60
```

### 3. **Manual Error Monitoring**
```bash
# Monitor frontend for 30 seconds (headless)
python error_monitor.py --duration 30

# Monitor with visible browser window
python error_monitor.py --visible --duration 45

# Continuous monitoring (runs indefinitely)
python error_monitor.py --watch
```

## 📊 What Gets Monitored

### **Frontend Errors Detected:**
- ✅ **JavaScript Runtime Errors** (uncaught exceptions)
- ✅ **React Component Errors** (via Error Boundaries)
- ✅ **Console Errors & Warnings** (filtered for relevance)
- ✅ **Network Request Failures** (API calls, asset loading)
- ✅ **Container Dimension Issues** (Sigma.js container height errors)

### **Backend Integration:**
- ✅ **Error Logging** to `frontend_errors.log`
- ✅ **Real-time Monitoring** via `/api/frontend-error` endpoint
- ✅ **Performance Tracking** (slow queries, response times)
- ✅ **Health Checks** (backend connectivity, database status)

## 📁 Output Files

| File | Description |
|------|-------------|
| `frontend_error_report.json` | Detailed error report with timestamps |
| `frontend_errors.log` | Backend error log (JSON lines) |
| `api_debug.log` | Backend API request/response log |

## 🛠️ Advanced Usage

### **Error Monitor Options**
```bash
python error_monitor.py \
  --port 5173 \           # Frontend port
  --backend-port 8000 \   # Backend port  
  --duration 120 \        # Monitor for 2 minutes
  --watch \               # Continuous monitoring
  --visible               # Show browser window
```

### **System Test Options**
```bash
python test_system.py \
  --duration 90 \         # Test duration
  --install-deps \        # Install dependencies first
  --quick                 # 15-second quick test
```

## 🔧 Integration Examples

### **CI/CD Pipeline** (GitHub Actions)
```yaml
- name: Test Frontend
  run: |
    cd src/frontend
    python test_system.py --install-deps --duration 30
```

### **Development Workflow**
```bash
# Terminal 1: Start services
python start_backend.py &
npm run dev &

# Terminal 2: Monitor for errors
python error_monitor.py --watch --visible
```

### **Pre-commit Hook**
```bash
#!/bin/bash
cd src/frontend
python test_system.py --quick
if [ $? -ne 0 ]; then
  echo "❌ Frontend errors detected - fix before committing"
  exit 1
fi
```

## 🚨 Common Issues Fixed

### **1. Sigma.js Container Height Error**
```
ERROR: Sigma: Container has no height
```
**Fixed by:** Explicit CSS height rules and `allowInvalidContainer: true`

### **2. API Connection Failures**  
```
ERROR: Failed to fetch /api/nodes/box
```
**Detected by:** Network request monitoring and backend health checks

### **3. React Component Crashes**
```
ERROR: Cannot read property 'x' of undefined
```
**Caught by:** Error Boundaries with automatic backend logging

## 📈 Monitoring Dashboard

The system includes a built-in debug panel accessible at:
- **Frontend:** `http://localhost:5173` (Toggle debug panel)  
- **Backend API:** `http://localhost:8000/api/debug/health`

## 🎯 Best Practices

1. **Run tests before deployment:** `python test_system.py --quick`
2. **Use continuous monitoring during development:** `--watch` mode
3. **Check error reports regularly:** Review `frontend_error_report.json`
4. **Monitor backend logs:** `tail -f api_debug.log`
5. **Set up alerts:** Parse JSON logs for automated notifications

## 🔍 Troubleshooting

### **Error Monitor Won't Start**
```bash
# Check if Playwright is installed
playwright --version

# Reinstall if needed
pip install playwright
playwright install chromium
```

### **Frontend/Backend Not Starting**
```bash
# Check ports are available
lsof -i :5173  # Frontend
lsof -i :8000  # Backend

# Check dependencies
npm install    # Frontend deps
pip install -r requirements.txt  # Backend deps
```

### **No Errors Detected But Issues Exist**
```bash
# Try visible mode to see what's happening
python error_monitor.py --visible --duration 60

# Check backend logs
tail -f api_debug.log
```

This monitoring system provides comprehensive coverage of frontend issues and enables confident deployment of the React + Sigma.js visualization! 