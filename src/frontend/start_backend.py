#!/usr/bin/env python3
"""
Startup script for the FastAPI backend server.
This script initializes the spatial index and starts the server.
"""

import uvicorn
import os
import sys

# Ensure the current directory is in the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# This script is designed to be run from the `src/frontend` directory
# Example: python start_backend.py

# --- Configuration ---
HOST = "0.0.0.0"
PORT = 8000
# Use the new tree-first endpoints file as the target application
APP_MODULE = "backend_tree_endpoints"
APP_VARIABLE = "app"  # Assuming 'app = FastAPI()' is in the target file
LOG_LEVEL = "info"

def check_for_fastapi_instance(module_name, variable_name):
    try:
        module = __import__(module_name)
        if hasattr(module, variable_name):
            return True
        else:
            return False
    except ImportError:
        return False

if __name__ == "__main__":
    print("🚀 Starting Citation Network FastAPI Backend...")
    print("📊 Database: ../../data/arxiv_papers.db")
    print("🌐 Server will be available at: http://localhost:8000")
    print("📖 API docs at: http://localhost:8000/docs")
    print("🔄 CORS enabled for React dev servers (ports 3000, 5173)")
    print("")
    
    # Start the FastAPI server
    uvicorn.run(
        "backend_tree_endpoints:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    ) 