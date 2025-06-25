#!/usr/bin/env python3
"""
FastAPI backend server for the citation network visualization.

This server provides API endpoints to fetch graph data from the SQLite database
with intelligent node filtering based on zoom level and spatial indexing using R-Tree.
"""

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import sqlite3
import pandas as pd
import numpy as np
import json
import time
import logging
from typing import List, Optional
from colorspacious import cspace_converter
import os
from datetime import datetime
import sys
import os
import asyncio
import concurrent.futures
import uuid
from functools import wraps

# Add clustering directory to path for cluster name integration
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'clustering'))

# --- Configuration ---
DB_PATH = "../../data/arxiv_papers.db"

# Setup comprehensive logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('api_debug.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# --- Thread Pool Database Manager ---
class CancellableDatabase:
    """
    Thread pool-based database manager with query cancellation support.
    Optimized for small, frequent queries (100 nodes) with fast cancellation.
    """
    
    def __init__(self, max_workers: int = 4):
        self.executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="db_worker"
        )
        self.active_queries: dict = {}
        self.query_stats = {
            "total_queries": 0,
            "cancelled_queries": 0,
            "timeout_queries": 0,
            "successful_queries": 0
        }
    
    async def execute_query(
        self, 
        query: str, 
        params: list = None, 
        timeout: float = 8.0,  # 8 seconds for small queries
        request_id: str = None
    ) -> pd.DataFrame:
        """Execute a cancellable database query in thread pool."""
        
        if request_id is None:
            request_id = str(uuid.uuid4())
        
        if params is None:
            params = []
        
        self.query_stats["total_queries"] += 1
        
        # Submit query to thread pool
        future = self.executor.submit(self._execute_query_sync, query, params)
        self.active_queries[request_id] = {
            "future": future,
            "start_time": time.time(),
            "query": query[:100] + "..." if len(query) > 100 else query
        }
        
        try:
            # Wait for result with timeout
            result = await asyncio.wait_for(
                asyncio.wrap_future(future), 
                timeout=timeout
            )
            self.query_stats["successful_queries"] += 1
            logger.debug(f"✅ Query {request_id[:8]} completed successfully")
            return result
            
        except asyncio.TimeoutError:
            # Cancel the future (prevents result processing)
            future.cancel()
            self.query_stats["timeout_queries"] += 1
            logger.warning(f"⏰ Query {request_id[:8]} timed out after {timeout}s")
            raise HTTPException(
                status_code=408, 
                detail=f"Database query timeout ({timeout}s). Try reducing query complexity."
            )
            
        except asyncio.CancelledError:
            # Query was explicitly cancelled
            future.cancel()
            self.query_stats["cancelled_queries"] += 1
            logger.info(f"🚫 Query {request_id[:8]} was cancelled")
            raise HTTPException(status_code=499, detail="Request cancelled")
            
        except Exception as e:
            # Other database errors
            future.cancel()
            logger.error(f"❌ Query {request_id[:8]} failed: {e}")
            raise HTTPException(status_code=500, detail=f"Database error: {e}")
            
        finally:
            # Clean up
            self.active_queries.pop(request_id, None)
    
    def cancel_query(self, request_id: str) -> bool:
        """Cancel a specific query by request ID."""
        query_info = self.active_queries.get(request_id)
        if query_info:
            future = query_info["future"]
            if not future.done():
                future.cancel()
                logger.info(f"🚫 Cancelled query {request_id[:8]}")
                return True
        return False
    
    def cancel_all_queries(self) -> int:
        """Cancel all active queries. Returns number of cancelled queries."""
        cancelled_count = 0
        for request_id, query_info in list(self.active_queries.items()):
            future = query_info["future"]
            if not future.done():
                future.cancel()
                cancelled_count += 1
        
        logger.info(f"🚫 Cancelled {cancelled_count} active queries")
        return cancelled_count
    
    def get_active_queries(self) -> dict:
        """Get information about currently active queries."""
        active = {}
        current_time = time.time()
        
        for request_id, query_info in self.active_queries.items():
            active[request_id] = {
                "query": query_info["query"],
                "duration": current_time - query_info["start_time"],
                "status": "running" if not query_info["future"].done() else "completed"
            }
        
        return {
            "active_queries": active,
            "stats": self.query_stats,
            "executor_info": {
                "max_workers": self.executor._max_workers,
                "active_threads": len([t for t in self.executor._threads if t.is_alive()]) if hasattr(self.executor, '_threads') else "unknown"
            }
        }
    
    def _execute_query_sync(self, query: str, params: list) -> pd.DataFrame:
        """Execute query synchronously in thread. This is the actual blocking operation."""
        conn = None
        try:
            # Create connection with shorter timeout for small queries
            conn = sqlite3.connect(
                DB_PATH, 
                timeout=5.0,  # 5 second connection timeout
                check_same_thread=False
            )
            conn.row_factory = sqlite3.Row
            
            # Optimize SQLite for fast small queries
            conn.execute("PRAGMA busy_timeout = 5000")  # 5 second busy timeout
            conn.execute("PRAGMA journal_mode = WAL")   # Better concurrency
            conn.execute("PRAGMA synchronous = NORMAL") # Faster writes
            conn.execute("PRAGMA temp_store = memory")  # Use memory for temp tables
            
            # Execute query
            start_time = time.time()
            result = pd.read_sql_query(query, conn, params=params)
            execution_time = time.time() - start_time
            
            logger.debug(f"🔍 SQL query executed in {execution_time:.3f}s, returned {len(result)} rows")
            return result
            
        except Exception as e:
            logger.error(f"❌ Database execution error: {e}")
            raise
        finally:
            if conn:
                conn.close()
    
    def shutdown(self):
        """Shutdown the thread pool executor."""
        logger.info("🔄 Shutting down database thread pool...")
        self.cancel_all_queries()
        self.executor.shutdown(wait=True)  # timeout parameter not supported in Python 3.12
        logger.info("✅ Database thread pool shutdown complete")

# Global database manager instance
db_manager = CancellableDatabase(max_workers=4)

def with_cancellation(timeout: float = 8.0):
    """Decorator to add cancellation support to database query functions."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request_id = str(uuid.uuid4())
            
            # Extract request object if available for client tracking
            request = None
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break
            
            # Inject cancellation parameters
            kwargs['_request_id'] = request_id
            kwargs['_timeout'] = timeout
            
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                # If the client disconnected, cancel the query
                if request and hasattr(request, 'is_disconnected') and request.is_disconnected():
                    db_manager.cancel_query(request_id)
                raise
        
        return wrapper
    return decorator

app = FastAPI(title="Citation Network API", version="1.0.0")

# Global stats for monitoring
app_stats = {
    "requests_count": 0,
    "start_time": datetime.now(),
    "errors_count": 0,
    "spatial_queries": 0,
    "cache_hits": 0,
    "slow_queries": 0
}

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    app_stats["requests_count"] += 1
    
    # Log incoming request
    logger.info(f"🌐 {request.method} {request.url.path} - Client: {request.client.host}")
    
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        
        # Log slow queries
        if process_time > 2.0:
            app_stats["slow_queries"] += 1
            logger.warning(f"⏰ SLOW QUERY: {request.url.path} took {process_time:.2f}s")
        else:
            logger.info(f"✅ {request.url.path} completed in {process_time:.2f}s")
        
        response.headers["X-Process-Time"] = str(process_time)
        return response
        
    except Exception as e:
        app_stats["errors_count"] += 1
        logger.error(f"❌ Error processing {request.url.path}: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "detail": str(e)}
        )

# Serve static files for React build
if os.path.exists("dist"):
    app.mount("/static", StaticFiles(directory="dist"), name="static")


class Node(BaseModel):
    key: str
    attributes: dict


class Edge(BaseModel):
    source: str
    target: str
    attributes: dict = {}


class GraphData(BaseModel):
    nodes: List[Node]
    edges: List[Edge]


class FrontendError(BaseModel):
    timestamp: str
    message: str
    stack: Optional[str] = None
    componentStack: Optional[str] = None
    errorBoundary: bool = False
    url: str
    userAgent: str


class EdgeBatchRequest(BaseModel):
    node_ids: List[str]
    limit: int = 10000
    priority: Optional[str] = "all"  # "high", "medium", "low", "all"


# Level of Detail thresholds
LOD_THRESHOLDS = {
    "zoomed_out": 0.3,      # ratio < 0.3: only high-degree nodes
    "medium": 1.0,          # 0.3 ≤ ratio < 1.0: medium-degree + centroids
    "zoomed_in": float('inf')  # ratio ≥ 1.0: all nodes in bbox
}

DEGREE_THRESHOLDS = {
    "zoomed_out": 10,       # T₁: minimum degree for zoomed out view
    "medium": 5,            # T₂: minimum degree for medium view
    "zoomed_in": 0          # No degree filter for zoomed in
}


def generate_palette(n_colors):
    """Generate a palette of visually distinct colors."""
    colors = []
    if n_colors == 0:
        return colors
    for h in np.linspace(0, 360, n_colors, endpoint=False):
        jch_color = np.array([50, 50, h])
        rgb_color = np.clip(cspace_converter("JCh", "sRGB1")(jch_color), 0, 1)
        hex_color = "#{:02x}{:02x}{:02x}".format(*(int(c * 255) for c in rgb_color))
        colors.append(hex_color)
    return colors


def get_db_connection():
    """Get a new database connection with error handling."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        logger.debug(f"🔌 Database connection established")
        return conn
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        raise HTTPException(status_code=500, detail=f"Database connection failed: {e}")


def initialize_spatial_index():
    """Initialize R-Tree spatial index for efficient spatial queries."""
    logger.info("🔧 Initializing spatial index...")
    conn = get_db_connection()
    
    try:
        # Check if spatial index already exists
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='papers_spatial_idx'")
        if cursor.fetchone():
            logger.info("✅ Spatial index already exists.")
            return
        
        logger.info("📊 Creating spatial index...")
        
        # Create R-Tree spatial index
        cursor.execute("""
            CREATE VIRTUAL TABLE papers_spatial_idx USING rtree(
                id INTEGER,
                minX REAL, maxX REAL,
                minY REAL, maxY REAL
            )
        """)
        
        # Populate spatial index
        cursor.execute("""
            INSERT INTO papers_spatial_idx (id, minX, maxX, minY, maxY)
            SELECT 
                rowid,
                embedding_x, embedding_x,
                embedding_y, embedding_y
            FROM filtered_papers 
            WHERE embedding_x IS NOT NULL AND embedding_y IS NOT NULL
        """)
        
        conn.commit()
        logger.info("✅ Spatial index created successfully.")
        
    except Exception as e:
        logger.error(f"❌ Error creating spatial index: {e}")
        raise
    finally:
        conn.close()


def get_lod_level(ratio: float) -> str:
    """Determine level of detail based on zoom ratio."""
    if ratio < LOD_THRESHOLDS["zoomed_out"]:
        return "zoomed_out"
    elif ratio < LOD_THRESHOLDS["medium"]:
        return "medium"
    else:
        return "zoomed_in"


@app.on_event("startup")
async def startup_event():
    """Initialize spatial index on startup."""
    logger.info("🚀 Starting Citation Network API...")
    initialize_spatial_index()
    logger.info("✅ API startup complete!")

@app.on_event("shutdown")
async def shutdown_event():
    """Clean shutdown of database thread pool."""
    logger.info("🔄 Shutting down Citation Network API...")
    db_manager.shutdown()
    logger.info("✅ API shutdown complete!")

# Debug and monitoring endpoints
@app.get("/api/ping")
async def ping():
    """Ultra-simple ping endpoint that doesn't touch database."""
    return {"status": "pong", "timestamp": datetime.now().isoformat()}

@app.get("/api/debug/queries")
async def get_active_queries():
    """Get information about active database queries."""
    return db_manager.get_active_queries()

@app.post("/api/debug/cancel-queries")
async def cancel_all_queries():
    """Cancel all active database queries (emergency stop)."""
    cancelled_count = db_manager.cancel_all_queries()
    return {
        "message": f"Cancelled {cancelled_count} active queries",
        "cancelled_count": cancelled_count,
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/debug/cancel-query/{request_id}")
async def cancel_specific_query(request_id: str):
    """Cancel a specific database query by request ID."""
    success = db_manager.cancel_query(request_id)
    return {
        "success": success,
        "message": f"Query {request_id} {'cancelled' if success else 'not found or already completed'}",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/debug/health")
async def health_check():
    """Health check endpoint with detailed system information."""
    try:
        # Test database connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM filtered_papers")
        db_count = cursor.fetchone()[0]
        conn.close()
        
        uptime = datetime.now() - app_stats["start_time"]
        
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "uptime_seconds": uptime.total_seconds(),
            "database": {
                "connected": True,
                "paper_count": db_count
            },
            "stats": app_stats
        }
    except Exception as e:
        logger.error(f"❌ Health check failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "unhealthy",
                "error": str(e),
                "stats": app_stats
            }
        )


@app.get("/api/debug/logs")
async def get_recent_logs():
    """Get recent log entries for debugging."""
    try:
        if os.path.exists('api_debug.log'):
            with open('api_debug.log', 'r') as f:
                lines = f.readlines()
                # Return last 50 lines
                return {"logs": lines[-50:]}
        else:
            return {"logs": ["No log file found"]}
    except Exception as e:
        return {"error": f"Could not read logs: {e}"}


@app.get("/api/debug/database")
async def debug_database():
    """Get detailed database information for debugging."""
    conn = get_db_connection()
    
    try:
        cursor = conn.cursor()
        
        # Get table info
        tables_info = {}
        for table in ['filtered_papers', 'filtered_citations', 'papers_spatial_idx']:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                tables_info[table] = {"count": count, "exists": True}
            except Exception as e:
                tables_info[table] = {"error": str(e), "exists": False}
        
        # Get sample data
        cursor.execute("""
            SELECT paper_id, title, embedding_x, embedding_y, cluster_id 
            FROM filtered_papers 
            WHERE embedding_x IS NOT NULL 
            LIMIT 3
        """)
        sample_papers = [dict(row) for row in cursor.fetchall()]
        
        # Get coordinate bounds
        cursor.execute("""
            SELECT MIN(embedding_x) as minX, MAX(embedding_x) as maxX,
                   MIN(embedding_y) as minY, MAX(embedding_y) as maxY
            FROM filtered_papers 
            WHERE embedding_x IS NOT NULL
        """)
        bounds = dict(cursor.fetchone())
        
        return {
            "tables": tables_info,
            "sample_papers": sample_papers,
            "coordinate_bounds": bounds
        }
        
    finally:
        conn.close()


@app.get("/api/bounds")
@with_cancellation(timeout=5.0)  # 5 seconds for bounds query
async def get_data_bounds(
    _request_id: str = None,  # Injected by decorator
    _timeout: float = None    # Injected by decorator
):
    """
    Get the coordinate bounds of all data points for camera initialization.
    Returns the min/max X/Y coordinates of all papers with embeddings.
    """
    logger.info(f"🗺️ Fetching data bounds {_request_id[:8]} for camera initialization")
    start_time = time.time()
    
    try:
        # Get coordinate bounds using SQL for better performance
        bounds_query = """
            SELECT MIN(embedding_x) as minX, MAX(embedding_x) as maxX,
                   MIN(embedding_y) as minY, MAX(embedding_y) as maxY,
                   COUNT(*) as total_papers
            FROM filtered_papers 
            WHERE embedding_x IS NOT NULL AND embedding_y IS NOT NULL
              AND embedding_x BETWEEN -50 AND 50  -- Filter out extreme outliers
              AND embedding_y BETWEEN -50 AND 50
        """
        
        # Execute query with cancellation support
        result_df = await db_manager.execute_query(
            bounds_query,
            [],
            timeout=_timeout,
            request_id=_request_id
        )
        
        if result_df.empty:
            logger.warning("⚠️ No coordinate data found")
            return {
                "minX": -10, "maxX": 10, "minY": -10, "maxY": 10,
                "total_papers": 0
            }
        
        result = result_df.iloc[0].to_dict()
        
        # Add some padding to the bounds (5% on each side)
        padding_x = (result['maxX'] - result['minX']) * 0.05
        padding_y = (result['maxY'] - result['minY']) * 0.05
        
        bounds = {
            "minX": float(result['minX'] - padding_x),
            "maxX": float(result['maxX'] + padding_x),
            "minY": float(result['minY'] - padding_y),
            "maxY": float(result['maxY'] + padding_y),
            "total_papers": int(result['total_papers'])
        }
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Bounds {_request_id[:8]} computed in {elapsed:.2f}s: {bounds['total_papers']} papers")
        return bounds
    
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ Bounds query {_request_id[:8]} failed after {elapsed:.2f}s: {e}")
        raise


@app.get("/api/nodes/top", response_model=List[Node])
async def get_top_nodes(
    limit: int = Query(2000, description="Number of top nodes to return"),
    min_degree: int = Query(5, description="Minimum degree filter"),
    visible_clusters: str = Query("", description="Comma-separated list of visible cluster IDs (empty = all clusters)")
):
    """
    Get top N nodes by degree for initial load.
    """
    logger.info(f"📊 Fetching top {limit} nodes with min_degree {min_degree}")
    start_time = time.time()
    
    conn = get_db_connection()
    
    try:
        # Parse visible clusters filter
        cluster_filter = ""
        cluster_params = []
        if visible_clusters.strip():
            try:
                cluster_ids = [int(x.strip()) for x in visible_clusters.split(',') if x.strip()]
                if cluster_ids:
                    cluster_filter = f" AND fp.cluster_id IN ({','.join('?' * len(cluster_ids))})"
                    cluster_params = cluster_ids
            except ValueError:
                logger.warning(f"Invalid cluster IDs: {visible_clusters}")
        
        # Get top nodes using precomputed degrees - much faster!
        nodes_query = """
            SELECT fp.paper_id, fp.title, fp.embedding_x, fp.embedding_y, 
                   fp.cluster_id, fp.year, fp.degree
            FROM filtered_papers fp
            WHERE fp.cluster_id IS NOT NULL 
              AND fp.embedding_x IS NOT NULL 
              AND fp.embedding_y IS NOT NULL
              AND fp.degree >= ?
              {}
            ORDER BY fp.degree DESC
            LIMIT ?
        """.format(cluster_filter)
        
        params = [min_degree] + cluster_params + [limit]
        papers_df = pd.read_sql_query(nodes_query, conn, params=params)
        logger.debug(f"📋 Found {len(papers_df)} papers with embeddings")
        
        if len(papers_df) == 0:
            logger.warning("⚠️ No papers found with embeddings")
            return []
        
        # Generate color palette
        unique_clusters = sorted(papers_df['cluster_id'].unique())
        palette = generate_palette(len(unique_clusters))
        comm_colors = {cluster_id: palette[i] for i, cluster_id in enumerate(unique_clusters)}
        
        # Format nodes
        nodes = []
        for _, row in papers_df.iterrows():
            node_id = row['paper_id']
            cluster_id = int(row['cluster_id'])
            degree = int(row['degree'])
            
            nodes.append(Node(
                key=node_id,
                attributes={
                    "label": (row['title'] or node_id)[:100],  # Truncate long titles
                    "x": float(row['embedding_x']),
                    "y": float(row['embedding_y']),
                    "size": max(2, 1.2 + np.log1p(degree)),
                    "color": comm_colors.get(cluster_id, "#cccccc"),
                    "community": cluster_id,
                    "degree": degree,
                }
            ))
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Returned {len(nodes)} top nodes in {elapsed:.2f}s")
        return nodes
    
    finally:
        conn.close()


@app.get("/api/nodes/box/light", response_model=List[dict])
@with_cancellation(timeout=6.0)  # 6 seconds for light node queries
async def get_nodes_in_box_light(
    minX: float = Query(..., description="Minimum X coordinate"),
    maxX: float = Query(..., description="Maximum X coordinate"),
    minY: float = Query(..., description="Minimum Y coordinate"),
    maxY: float = Query(..., description="Maximum Y coordinate"),
    limit: int = Query(5000, description="Maximum nodes to return"),
    visible_clusters: str = Query("", description="Comma-separated list of visible cluster IDs (empty = all clusters)"),
    min_degree: int = Query(0, description="Minimum degree filter for quality control"),
    _request_id: str = None,  # Injected by decorator
    _timeout: float = None    # Injected by decorator
):
    """
    Get lightweight nodes (minimal attributes) within a bounding box for fast rendering.
    This endpoint returns only essential data: position, size, color, degree.
    """
    app_stats["spatial_queries"] += 1
    
    logger.info(f"💡 Light nodes query {_request_id[:8]}: bbox({minX:.1f},{maxX:.1f},{minY:.1f},{maxY:.1f}) limit={limit}")
    start_time = time.time()
    
    try:
        # Parse visible clusters filter
        cluster_filter = ""
        cluster_params = []
        if visible_clusters.strip():
            try:
                cluster_ids = [int(x.strip()) for x in visible_clusters.split(',') if x.strip()]
                if cluster_ids:
                    cluster_filter = f" AND cluster_id IN ({','.join('?' * len(cluster_ids))})"
                    cluster_params = cluster_ids
            except ValueError:
                logger.warning(f"Invalid cluster IDs: {visible_clusters}")
        
        # Query nodes in the spatial box using precomputed degrees - much faster!
        query = """
            SELECT paper_id, embedding_x, embedding_y, cluster_id, degree
            FROM filtered_papers
            WHERE embedding_x >= ? AND embedding_x <= ? 
              AND embedding_y >= ? AND embedding_y <= ?
              AND embedding_x IS NOT NULL 
              AND embedding_y IS NOT NULL
              AND cluster_id IS NOT NULL
              AND degree >= ?
              {}
            ORDER BY degree DESC
            LIMIT ?
        """.format(cluster_filter)
        
        params = [minX, maxX, minY, maxY, min_degree] + cluster_params + [limit]
        
        # Execute query with cancellation support
        nodes_df = await db_manager.execute_query(
            query,
            params,
            timeout=_timeout,
            request_id=_request_id
        )
        
        if nodes_df.empty:
            logger.warning(f"⚠️ No light nodes found in box: X[{minX:.1f}, {maxX:.1f}], Y[{minY:.1f}, {maxY:.1f}]")
            return []
        
        # Generate colors for communities
        unique_clusters = nodes_df['cluster_id'].dropna().unique()
        if len(unique_clusters) > 0:
            colors = generate_palette(len(unique_clusters))
            cluster_colors = dict(zip(unique_clusters, colors))
        else:
            cluster_colors = {}
        
        # Format lightweight nodes
        light_nodes = []
        for _, row in nodes_df.iterrows():
            degree = int(row['degree'])
            # Minimal size calculation based on degree
            size = max(3, min(15, 3 + (degree / 50)))
            
            # Get color
            cluster_id = row['cluster_id']
            if pd.notna(cluster_id) and cluster_id in cluster_colors:
                color = cluster_colors[cluster_id]
            else:
                color = "#888888"  # Default gray
            
            light_nodes.append({
                "key": row['paper_id'],
                "attributes": {
                    "x": float(row['embedding_x']),
                    "y": float(row['embedding_y']), 
                    "size": size,
                    "degree": degree,
                    "color": color
                }
            })
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Light nodes {_request_id[:8]} returned {len(light_nodes)} nodes in {elapsed:.2f}s")
        return light_nodes
    
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ Light nodes {_request_id[:8]} failed after {elapsed:.2f}s: {e}")
        raise


@app.get("/api/nodes/box", response_model=List[Node])
@with_cancellation(timeout=8.0)  # 8 seconds for small node queries
async def get_nodes_in_box(
    minX: float = Query(..., description="Minimum X coordinate"),
    maxX: float = Query(..., description="Maximum X coordinate"),
    minY: float = Query(..., description="Minimum Y coordinate"),
    maxY: float = Query(..., description="Maximum Y coordinate"),
    ratio: float = Query(1.0, description="DEPRECATED: Zoom ratio (ignored)"),
    limit: int = Query(5000, description="Maximum nodes to return"),
    offset: int = Query(0, description="Offset for pagination/batching"),
    visible_clusters: str = Query("", description="Comma-separated list of visible cluster IDs (empty = all clusters)"),
    min_degree: int = Query(0, description="Minimum degree filter for quality control"),
    _request_id: str = None,  # Injected by decorator
    _timeout: float = None    # Injected by decorator
):
    """
    Get nodes within a bounding box with cancellation support.
    Level-of-detail filtering is now handled on the frontend based on viewport size.
    """
    app_stats["spatial_queries"] += 1
    
    logger.info(f"🗺️ Spatial query {_request_id[:8]}: bbox({minX:.1f},{maxX:.1f},{minY:.1f},{maxY:.1f}) limit={limit}")
    start_time = time.time()
    
    try:
        # Parse visible clusters filter
        cluster_filter = ""
        cluster_params = []
        if visible_clusters.strip():
            try:
                cluster_ids = [int(x.strip()) for x in visible_clusters.split(',') if x.strip()]
                if cluster_ids:
                    cluster_filter = f" AND fp.cluster_id IN ({','.join('?' * len(cluster_ids))})"
                    cluster_params = cluster_ids
            except ValueError:
                logger.warning(f"Invalid cluster IDs: {visible_clusters}")
        
        # Use spatial index with precomputed degrees for efficient querying
        spatial_query = """
            SELECT fp.paper_id, fp.title, fp.embedding_x, fp.embedding_y, 
                   fp.cluster_id, fp.year, fp.degree
            FROM papers_spatial_idx si
            JOIN filtered_papers fp ON si.id = fp.rowid
            WHERE si.maxX >= ? AND si.minX <= ? 
              AND si.maxY >= ? AND si.minY <= ?
              AND fp.cluster_id IS NOT NULL
              AND fp.degree >= ?
              {}
            ORDER BY fp.degree DESC
            LIMIT ? OFFSET ?
        """.format(cluster_filter)
        
        params = [minX, maxX, minY, maxY, min_degree] + cluster_params + [limit, offset]
        
        # Execute query with cancellation support
        papers_df = await db_manager.execute_query(
            spatial_query, 
            params, 
            timeout=_timeout,
            request_id=_request_id
        )
        
        logger.debug(f"🔍 Spatial index returned {len(papers_df)} papers")
        
        if len(papers_df) == 0:
            logger.debug("📭 No papers found in spatial query")
            return []
        
        # Generate color palette
        unique_clusters = sorted(papers_df['cluster_id'].unique())
        palette = generate_palette(len(unique_clusters))
        comm_colors = {cluster_id: palette[i] for i, cluster_id in enumerate(unique_clusters)}
        
        # Format nodes
        nodes = []
        for _, row in papers_df.iterrows():
            node_id = row['paper_id']
            cluster_id = int(row['cluster_id'])
            degree = int(row['degree'])
            
            nodes.append(Node(
                key=node_id,
                attributes={
                    "label": (row['title'] or node_id)[:100],
                    "x": float(row['embedding_x']),
                    "y": float(row['embedding_y']),
                    "size": max(2, 1.2 + np.log1p(degree)),
                    "color": comm_colors.get(cluster_id, "#cccccc"),
                    "community": cluster_id,
                    "degree": degree,
                }
            ))
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Spatial query {_request_id[:8]} returned {len(nodes)} nodes in {elapsed:.2f}s")
        return nodes
    
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ Spatial query {_request_id[:8]} failed after {elapsed:.2f}s: {e}")
        raise


@app.post("/api/edges/batch", response_model=List[Edge])
@with_cancellation(timeout=10.0)  # 10 seconds for edge queries (can be larger)
async def get_edges_batch(
    request: EdgeBatchRequest,
    _request_id: str = None,  # Injected by decorator
    _timeout: float = None    # Injected by decorator
):
    """
    Get edges for a batch of nodes using POST to avoid HTTP 431 errors.
    Supports priority-based edge loading for performance optimization with cancellation.
    """
    logger.info(f"🔗 Batch fetching edges {_request_id[:8]}: {len(request.node_ids)} nodes (limit={request.limit}, priority={request.priority})")
    start_time = time.time()
    
    try:
        node_list = [node_id.strip() for node_id in request.node_ids if node_id.strip()]
        
        if not node_list:
            return []
        
        # Build priority-based query if needed
        priority_filter = ""
        if request.priority != "all":
            # Add edge weight/citation count filtering in future
            # For now, treat all edges equally
            pass
        
        # Query edges where at least one node is in our viewport
        # But both source and target must exist in the graph (we'll filter this in frontend)
        edges_query = f"""
            SELECT src, dst 
            FROM filtered_citations 
            WHERE src IN ({','.join('?' * len(node_list))}) 
               OR dst IN ({','.join('?' * len(node_list))})
            {priority_filter}
            LIMIT ?
        """
        
        params = node_list + node_list + [request.limit]
        
        # Execute query with cancellation support
        edges_df = await db_manager.execute_query(
            edges_query,
            params,
            timeout=_timeout,
            request_id=_request_id
        )
        
        # Format edges
        edges = []
        for _, row in edges_df.iterrows():
            edges.append(Edge(
                source=row['src'],
                target=row['dst'],
                attributes={"type": "line", "size": 0.4, "priority": request.priority}
            ))
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Batch {_request_id[:8]} returned {len(edges)} edges in {elapsed:.2f}s")
        return edges
    
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ Edge batch {_request_id[:8]} failed after {elapsed:.2f}s: {e}")
        raise


# Keep the old GET endpoint for backward compatibility
@app.get("/api/edges/box", response_model=List[Edge])
async def get_edges_in_box(
    node_ids: str = Query(..., description="Comma-separated node IDs"),
    limit: int = Query(10000, description="Maximum edges to return")
):
    """
    Get edges for a specific set of nodes.
    DEPRECATED: Use POST /api/edges/batch for large node sets to avoid HTTP 431 errors.
    """
    logger.info(f"🔗 Fetching edges for {len(node_ids.split(','))} nodes (limit={limit})")
    start_time = time.time()
    
    conn = get_db_connection()
    
    try:
        node_list = [node_id.strip() for node_id in node_ids.split(',') if node_id.strip()]
        
        if not node_list:
            return []
        
        # Query edges where at least one node is in our viewport
        edges_query = """
            SELECT src, dst 
            FROM filtered_citations 
            WHERE src IN ({}) OR dst IN ({})
            LIMIT ?
        """.format(','.join('?' * len(node_list)), ','.join('?' * len(node_list)))
        
        params = node_list + node_list + [limit]
        edges_df = pd.read_sql_query(edges_query, conn, params=params)
        
        # Format edges
        edges = []
        for _, row in edges_df.iterrows():
            edges.append(Edge(
                source=row['src'],
                target=row['dst'],
                attributes={"type": "line", "size": 0.4}
            ))
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Returned {len(edges)} edges in {elapsed:.2f}s")
        return edges
    
    finally:
        conn.close()


@app.get("/api/stats")
async def get_stats():
    """Get database statistics."""
    logger.debug("📊 Fetching database statistics")
    conn = get_db_connection()
    
    try:
        cursor = conn.cursor()
        
        # Get basic counts
        cursor.execute("SELECT COUNT(*) FROM filtered_papers")
        total_papers = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM filtered_citations")
        total_citations = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(DISTINCT cluster_id) FROM filtered_papers WHERE cluster_id IS NOT NULL")
        total_clusters = cursor.fetchone()[0]
        
        # Get coordinate bounds
        cursor.execute("""
            SELECT MIN(embedding_x), MAX(embedding_x), MIN(embedding_y), MAX(embedding_y)
            FROM filtered_papers 
            WHERE embedding_x IS NOT NULL AND embedding_y IS NOT NULL
        """)
        bounds = cursor.fetchone()
        
        uptime = datetime.now() - app_stats["start_time"]
        
        stats = {
            "total_papers": total_papers,
            "total_citations": total_citations,
            "total_clusters": total_clusters,
            "coordinate_bounds": {
                "minX": bounds[0],
                "maxX": bounds[1],
                "minY": bounds[2],
                "maxY": bounds[3]
            },
            "server_stats": {
                **app_stats,
                "uptime_seconds": uptime.total_seconds()
            }
        }
        
        logger.debug(f"📈 Stats: {total_papers} papers, {total_citations} citations, {total_clusters} clusters")
        return stats
    
    finally:
        conn.close()


@app.post("/api/frontend-error")
async def log_frontend_error(error: FrontendError):
    """
    Log frontend JavaScript errors for monitoring and debugging.
    """
    logger.error(f"🚨 FRONTEND ERROR: {error.message}")
    logger.error(f"   URL: {error.url}")
    logger.error(f"   Timestamp: {error.timestamp}")
    logger.error(f"   Error Boundary: {error.errorBoundary}")
    
    if error.stack:
        logger.error(f"   Stack: {error.stack}")
    
    if error.componentStack:
        logger.error(f"   Component Stack: {error.componentStack}")
    
    # Increment error counter
    app_stats["errors_count"] += 1
    
    # Save to error log file
    error_log = {
        "timestamp": error.timestamp,
        "type": "frontend_error",
        "message": error.message,
        "stack": error.stack,
        "componentStack": error.componentStack,
        "errorBoundary": error.errorBoundary,
        "url": error.url,
        "userAgent": error.userAgent
    }
    
    try:
        with open("frontend_errors.log", "a") as f:
            f.write(json.dumps(error_log) + "\n")
    except Exception as e:
        logger.error(f"Failed to write to error log: {e}")
    
    return {"status": "logged", "message": "Frontend error logged successfully"}


@app.get("/api/search", response_model=List[dict])
@with_cancellation(timeout=10.0)  # 10 seconds for search queries
async def search_papers(
    q: str = Query(..., description="Search query (title, authors, abstract)"),
    limit: int = Query(100, description="Maximum results to return"),
    offset: int = Query(0, description="Offset for pagination"),
    include_abstract: bool = Query(False, description="Include abstract in results"),
    min_citations: int = Query(0, description="Minimum citation count filter"),
    year_from: Optional[int] = Query(None, description="Minimum publication year"),
    year_to: Optional[int] = Query(None, description="Maximum publication year"),
    _request_id: str = None,  # Injected by decorator
    _timeout: float = None    # Injected by decorator
):
    """
    🔍 Search academic papers by title, authors, or abstract.
    
    Returns papers matching the search query with relevance scoring.
    """
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters")
    
    search_query = q.strip().lower()
    logger.info(f"🔍 Search query: '{search_query}' (limit={limit}, offset={offset})")
    
    try:
        # Build search SQL using available tables (filtered_papers + arxiv_papers)
        base_sql = """
        SELECT 
            fp.paper_id as arxiv_id,
            COALESCE(ap.title, fp.title) as title,
            fp.year,
            fp.embedding_x as x,
            fp.embedding_y as y,
            fp.degree,
            fp.cluster_id as community,
            -- Relevance scoring: title match only (no authors/abstract available)
            (
                CASE WHEN LOWER(COALESCE(ap.title, fp.title)) LIKE ? THEN 100 ELSE 0 END +
                -- Boost by degree (connection count) as proxy for importance
                CASE WHEN fp.degree > 0 THEN LOG(fp.degree + 1) * 10 ELSE 0 END
            ) as relevance_score
        FROM filtered_papers fp
        LEFT JOIN arxiv_papers ap ON fp.paper_id = ap.arxiv_id
        WHERE (
            LOWER(COALESCE(ap.title, fp.title)) LIKE ?
        )
        AND fp.embedding_x IS NOT NULL 
        AND fp.embedding_y IS NOT NULL
        AND fp.cluster_id IS NOT NULL
        """
        
        # Search pattern with wildcards
        search_pattern = f"%{search_query}%"
        params = [search_pattern, search_pattern]  # 2 parameters for relevance + WHERE
        
        # Add filters
        if min_citations > 0:
            base_sql += " AND fp.degree >= ?"
            params.append(min_citations)
        
        if year_from:
            base_sql += " AND fp.year >= ?"
            params.append(year_from)
            
        if year_to:
            base_sql += " AND fp.year <= ?"
            params.append(year_to)
        
        # Order by relevance and limit
        base_sql += """
        ORDER BY relevance_score DESC, fp.degree DESC
        LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])
        
        # Execute search
        start_time = time.time()
        df = await db_manager.execute_query(base_sql, params, timeout=_timeout, request_id=_request_id)
        search_time = time.time() - start_time
        
        if df.empty:
            logger.info(f"🔍 No results found for query: '{search_query}'")
            return []
        
        # Format results
        results = []
        for _, row in df.iterrows():
            result = {
                "nodeId": row['arxiv_id'],
                "title": row['title'],
                "authors": [],  # Not available in current database
                "year": int(row['year']) if pd.notna(row['year']) else None,
                "citationCount": int(row['degree']) if pd.notna(row['degree']) else 0,  # Use degree as proxy
                "relevanceScore": float(row['relevance_score']) / 100.0,  # Normalize to 0-1
                "coordinates": {
                    "x": float(row['x']) if pd.notna(row['x']) else 0,
                    "y": float(row['y']) if pd.notna(row['y']) else 0
                },
                "degree": int(row['degree']) if pd.notna(row['degree']) else 0,
                "community": int(row['community']) if pd.notna(row['community']) else 0
            }
            
            # Abstract not available in current database
            if include_abstract:
                result["abstract"] = None
            
            results.append(result)
        
        logger.info(f"✅ Search completed in {search_time:.3f}s: {len(results)} results for '{search_query}'")
        return results
        
    except Exception as e:
        logger.error(f"❌ Search failed for query '{search_query}': {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.get("/api/search/suggestions", response_model=List[str])
@with_cancellation(timeout=5.0)
async def get_search_suggestions(
    q: str = Query(..., description="Partial query for suggestions"),
    limit: int = Query(10, description="Maximum suggestions to return"),
    _request_id: str = None,
    _timeout: float = None
):
    """
    💡 Get search suggestions based on partial query.
    
    Returns common paper titles and author names that match the partial query.
    """
    if not q or len(q.strip()) < 2:
        return []
    
    partial_query = q.strip().lower()
    logger.debug(f"💡 Getting suggestions for: '{partial_query}'")
    
    try:
        # Get title suggestions from available tables
        title_sql = """
        SELECT DISTINCT COALESCE(ap.title, fp.title) as title
        FROM filtered_papers fp
        LEFT JOIN arxiv_papers ap ON fp.paper_id = ap.arxiv_id
        WHERE LOWER(COALESCE(ap.title, fp.title)) LIKE ?
        AND fp.embedding_x IS NOT NULL
        ORDER BY fp.degree DESC
        LIMIT ?
        """
        
        search_pattern = f"%{partial_query}%"
        
        # Execute title query
        title_df = await db_manager.execute_query(
            title_sql, [search_pattern, limit], 
            timeout=_timeout, request_id=f"{_request_id}_titles"
        )
        
        suggestions = []
        
        # Add title suggestions
        for _, row in title_df.iterrows():
            if row['title'] and len(suggestions) < limit:
                suggestions.append(row['title'])
        
        logger.debug(f"💡 Generated {len(suggestions)} suggestions for '{partial_query}'")
        return suggestions[:limit]
        
    except Exception as e:
        logger.error(f"❌ Failed to get suggestions for '{partial_query}': {e}")
        return []


@app.get("/api/search/node/{node_id}")
@with_cancellation(timeout=5.0)
async def get_node_details(
    node_id: str,
    _request_id: str = None,
    _timeout: float = None
):
    """
    📄 Get detailed information about a specific node/paper.
    
    Used when selecting a search result to get full paper details.
    """
    logger.info(f"📄 Getting details for node: {node_id}")
    
    try:
        sql = """
        SELECT 
            fp.paper_id as arxiv_id,
            COALESCE(ap.title, fp.title) as title,
            fp.year,
            fp.embedding_x as x,
            fp.embedding_y as y,
            fp.degree,
            fp.cluster_id as community
        FROM filtered_papers fp
        LEFT JOIN arxiv_papers ap ON fp.paper_id = ap.arxiv_id
        WHERE fp.paper_id = ?
        """
        
        df = await db_manager.execute_query(sql, [node_id], timeout=_timeout, request_id=_request_id)
        
        if df.empty:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        
        row = df.iloc[0]
        
        result = {
            "nodeId": row['arxiv_id'],
            "title": row['title'],
            "authors": [],  # Not available in current database
            "abstract": None,  # Not available in current database
            "year": int(row['year']) if pd.notna(row['year']) else None,
            "citationCount": int(row['degree']) if pd.notna(row['degree']) else 0,  # Use degree as proxy
            "coordinates": {
                "x": float(row['x']) if pd.notna(row['x']) else 0,
                "y": float(row['y']) if pd.notna(row['y']) else 0
            },
            "degree": int(row['degree']) if pd.notna(row['degree']) else 0,
            "community": int(row['community']) if pd.notna(row['community']) else 0
        }
        
        logger.info(f"✅ Retrieved details for node: {node_id}")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get details for node {node_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get node details: {str(e)}")


@app.get("/api/clusters/names")
async def get_cluster_names():
    """
    Get cluster names and themes generated from paper titles and content.
    Uses intelligent analysis to provide meaningful cluster names instead of just numbers.
    """
    logger.info("🎨 Fetching cluster names...")
    start_time = time.time()
    
    try:
        # Try to import the cluster name provider
        try:
            from cluster_api_integration import get_cluster_names_for_api
            result = get_cluster_names_for_api()
            cluster_names = result.get('clusters', {})
        except ImportError as e:
            logger.warning(f"⚠️ Cluster name provider not available: {e}")
            # Fallback: return basic cluster info from database
            cluster_names = await _get_basic_cluster_info()
        
        process_time = time.time() - start_time
        logger.info(f"✅ Retrieved {len(cluster_names)} cluster names in {process_time:.2f}s")
        
        # Convert numpy types to Python types for JSON serialization
        def convert_numpy_types(obj):
            if isinstance(obj, dict):
                return {k: convert_numpy_types(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_numpy_types(v) for v in obj]
            elif hasattr(obj, 'item'):  # numpy scalar
                return obj.item()
            elif hasattr(obj, 'tolist'):  # numpy array
                return obj.tolist()
            else:
                return obj
        
        converted_cluster_names = convert_numpy_types(cluster_names)
        
        return {
            "clusters": converted_cluster_names,
            "metadata": {
                "total_clusters": len(cluster_names),
                "generation_time": float(process_time),
                "timestamp": datetime.now().isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to get cluster names: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get cluster names: {e}")


@app.get("/api/clusters/{cluster_id}/info")
async def get_cluster_info(cluster_id: int):
    """Get detailed information about a specific cluster."""
    logger.info(f"🔍 Fetching info for cluster {cluster_id}...")
    
    try:
        # Try to use the cluster name provider
        try:
            from cluster_api_integration import get_cluster_info_for_api
            result = get_cluster_info_for_api(cluster_id)
            cluster_info = result.get('cluster_info', {})
        except ImportError:
            # Fallback to basic database info
            cluster_info = await _get_basic_cluster_info_single(cluster_id)
        
        return cluster_info
        
    except Exception as e:
        logger.error(f"❌ Failed to get cluster {cluster_id} info: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get cluster info: {e}")


@app.post("/api/clusters/refresh")
async def refresh_cluster_names():
    """Force refresh of cluster names (regenerate from database)."""
    logger.info("🔄 Refreshing cluster names...")
    start_time = time.time()
    
    try:
        # Try to use the cluster name provider
        try:
            from cluster_api_integration import refresh_cluster_names_for_api
            result = refresh_cluster_names_for_api()
            cluster_names = result.get('clusters', {})
        except ImportError:
            # Fallback: return basic cluster info
            cluster_names = await _get_basic_cluster_info()
        
        process_time = time.time() - start_time
        logger.info(f"✅ Refreshed {len(cluster_names)} cluster names in {process_time:.2f}s")
        
        return {
            "clusters": cluster_names,
            "metadata": {
                "total_clusters": len(cluster_names),
                "generation_time": process_time,
                "timestamp": datetime.now().isoformat(),
                "refreshed": True
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to refresh cluster names: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to refresh cluster names: {e}")


async def _get_basic_cluster_info() -> dict:
    """Fallback function to get basic cluster info from database."""
    conn = get_db_connection()
    
    try:
        # Get cluster statistics
        cluster_query = """
            SELECT 
                cluster_id,
                COUNT(*) as paper_count,
                MIN(year) as min_year,
                MAX(year) as max_year,
                GROUP_CONCAT(title, ' | ') as sample_titles
            FROM filtered_papers 
            WHERE cluster_id IS NOT NULL
            GROUP BY cluster_id
            ORDER BY cluster_id
        """
        
        clusters_df = pd.read_sql_query(cluster_query, conn)
        
        cluster_names = {}
        for _, row in clusters_df.iterrows():
            cluster_id = int(row['cluster_id'])
            cluster_names[cluster_id] = {
                'name': f'Research Area {cluster_id}',
                'description': f'Research cluster with {row["paper_count"]} papers spanning {row["min_year"]}-{row["max_year"]}',
                'keywords': [],
                'paper_count': int(row['paper_count']),
                'year_range': (int(row['min_year']) if row['min_year'] else None, 
                              int(row['max_year']) if row['max_year'] else None),
                'quality_score': 0.0,
                'sample_titles': row['sample_titles'].split(' | ')[:3] if row['sample_titles'] else []
            }
        
        return cluster_names
        
    finally:
        conn.close()


async def _get_basic_cluster_info_single(cluster_id: int) -> dict:
    """Fallback function to get basic info for a single cluster."""
    conn = get_db_connection()
    
    try:
        # Get cluster statistics
        cluster_query = """
            SELECT 
                COUNT(*) as paper_count,
                MIN(year) as min_year,
                MAX(year) as max_year,
                GROUP_CONCAT(title, ' | ') as sample_titles
            FROM filtered_papers 
            WHERE cluster_id = ?
        """
        
        result = conn.execute(cluster_query, (cluster_id,)).fetchone()
        
        if not result:
            return {
                'name': f'Cluster {cluster_id}',
                'description': 'No data available',
                'keywords': [],
                'paper_count': 0,
                'year_range': (None, None),
                'quality_score': 0.0,
                'sample_titles': []
            }
        
        return {
            'name': f'Research Area {cluster_id}',
            'description': f'Research cluster with {result["paper_count"]} papers spanning {result["min_year"]}-{result["max_year"]}',
            'keywords': [],
            'paper_count': int(result['paper_count']),
            'year_range': (int(result['min_year']) if result['min_year'] else None, 
                          int(result['max_year']) if result['max_year'] else None),
            'quality_score': 0.0,
            'sample_titles': result['sample_titles'].split(' | ')[:3] if result['sample_titles'] else []
        }
        
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 