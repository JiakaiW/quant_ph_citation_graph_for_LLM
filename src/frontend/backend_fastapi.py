#!/usr/bin/env python3
"""
FastAPI backend server for the citation network visualization.
This version uses the Tree-First architecture endpoints.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import os
import sys

# Add the parent directory to the path to allow imports from sibling directories
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('api_debug.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# --- FastAPI App Initialization ---
app = FastAPI(
    title="Citation Network API (Tree-First)",
    description="API for the Tree-First citation graph visualization",
    version="2.0.0"
)

# --- CORS Middleware ---
# Allows the frontend (running on localhost:5173) to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Import and Include Tree-First API Endpoints ---
# This is the core of the new architecture. All endpoint logic is in the other file.
try:
    from backend_tree_endpoints import router as tree_router
    app.include_router(tree_router)
    logger.info("🌳 Successfully imported and included Tree-First API endpoints.")
except ImportError as e:
    logger.critical(f"❌ Failed to import Tree-First endpoints from backend_tree_endpoints.py: {e}", exc_info=True)
    # This is a fatal error, so we exit.
    sys.exit(1)
    
# --- Generic Health Check Endpoint ---
@app.get("/api/ping")
async def ping():
    """A simple endpoint to check if the server is running."""
    return {"status": "ok", "message": "pong from Tree-First backend"}

# --- Main Entry Point ---
# This allows running the server directly with `python backend_fastapi.py`
# although using `start_backend.py` is recommended.
if __name__ == "__main__":
    import uvicorn
    logger.info("🚀 Starting FastAPI server with Uvicorn...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info") 