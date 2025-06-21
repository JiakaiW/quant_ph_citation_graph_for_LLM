#!/usr/bin/env python3
"""
Startup script for the FastAPI backend server.
This script initializes the spatial index and starts the server.
"""

import uvicorn
import sys
import os

# Add the current directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("🚀 Starting Citation Network FastAPI Backend...")
    print("📊 Database: ../../data/arxiv_papers.db")
    print("🌐 Server will be available at: http://localhost:8000")
    print("📖 API docs at: http://localhost:8000/docs")
    print("🔄 CORS enabled for React dev servers (ports 3000, 5173)")
    print("")
    
    # Start the FastAPI server
    uvicorn.run(
        "backend_fastapi:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    ) 