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


# Debug and monitoring endpoints
@app.get("/api/ping")
async def ping():
    """Ultra-simple ping endpoint that doesn't touch database."""
    return {"status": "pong", "timestamp": datetime.now().isoformat()}

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
async def get_data_bounds():
    """
    Get the coordinate bounds of all data points for camera initialization.
    Returns the min/max X/Y coordinates of all papers with embeddings.
    """
    logger.info("🗺️ Fetching data bounds for camera initialization")
    conn = get_db_connection()
    
    try:
        cursor = conn.cursor()
        
        # Get coordinate bounds using SQL for better performance
        cursor.execute("""
            SELECT MIN(embedding_x) as minX, MAX(embedding_x) as maxX,
                   MIN(embedding_y) as minY, MAX(embedding_y) as maxY,
                   COUNT(*) as total_papers
            FROM filtered_papers 
            WHERE embedding_x IS NOT NULL AND embedding_y IS NOT NULL
              AND embedding_x BETWEEN -50 AND 50  -- Filter out extreme outliers
              AND embedding_y BETWEEN -50 AND 50
        """)
        
        result = cursor.fetchone()
        if not result or result[0] is None:
            return {"error": "No papers with embeddings found"}
        
        bounds = {
            "minX": float(result[0]),
            "maxX": float(result[1]), 
            "minY": float(result[2]),
            "maxY": float(result[3]),
            "total_papers": int(result[4])
        }
        
        # Add some padding (10% on each side)
        width = bounds["maxX"] - bounds["minX"]
        height = bounds["maxY"] - bounds["minY"]
        padding_x = width * 0.1
        padding_y = height * 0.1
        
        bounds["paddedMinX"] = bounds["minX"] - padding_x
        bounds["paddedMaxX"] = bounds["maxX"] + padding_x
        bounds["paddedMinY"] = bounds["minY"] - padding_y
        bounds["paddedMaxY"] = bounds["maxY"] + padding_y
        
        logger.info(f"📊 Data bounds (1-99 percentiles): X[{bounds['minX']:.2f}, {bounds['maxX']:.2f}], Y[{bounds['minY']:.2f}, {bounds['maxY']:.2f}], {bounds['total_papers']} papers")
        return bounds
        
    finally:
        conn.close()


@app.get("/api/nodes/top", response_model=List[Node])
async def get_top_nodes(
    limit: int = Query(2000, description="Number of top nodes to return"),
    min_degree: int = Query(5, description="Minimum degree filter")
):
    """
    Get top N nodes by degree for initial load.
    """
    logger.info(f"📊 Fetching top {limit} nodes with min_degree {min_degree}")
    start_time = time.time()
    
    conn = get_db_connection()
    
    try:
        # Get degree information for all nodes
        logger.debug("🔍 Calculating node degrees...")
        degrees_query = """
            SELECT src as paper_id, COUNT(*) as out_degree
            FROM filtered_citations 
            GROUP BY src
            UNION ALL
            SELECT dst as paper_id, COUNT(*) as in_degree
            FROM filtered_citations 
            GROUP BY dst
        """
        degrees_df = pd.read_sql_query(degrees_query, conn)
        degrees = degrees_df.groupby('paper_id').sum().sort_values('out_degree', ascending=False)
        
        # Get top nodes with embeddings
        top_papers = degrees.head(limit).index.tolist()
        logger.debug(f"🎯 Selected {len(top_papers)} top papers")
        
        if not top_papers:
            logger.warning("⚠️ No papers found with degrees")
            return []
        
        nodes_query = """
            SELECT fp.paper_id, fp.title, fp.embedding_x, fp.embedding_y, 
                   fp.cluster_id, fp.year
            FROM filtered_papers fp
            WHERE fp.paper_id IN ({})
              AND fp.cluster_id IS NOT NULL 
              AND fp.embedding_x IS NOT NULL 
              AND fp.embedding_y IS NOT NULL
        """.format(','.join('?' * len(top_papers)))
        
        papers_df = pd.read_sql_query(nodes_query, conn, params=top_papers)
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
            degree = degrees.loc[node_id, 'out_degree'] if node_id in degrees.index else 0
            
            nodes.append(Node(
                key=node_id,
                attributes={
                    "label": (row['title'] or node_id)[:100],  # Truncate long titles
                    "x": float(row['embedding_x']),
                    "y": float(row['embedding_y']),
                    "size": max(2, 1.2 + np.log1p(degree)),
                    "color": comm_colors.get(cluster_id, "#cccccc"),
                    "community": cluster_id,
                    "degree": int(degree),
                }
            ))
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Returned {len(nodes)} top nodes in {elapsed:.2f}s")
        return nodes
    
    finally:
        conn.close()


@app.get("/api/nodes/box/light", response_model=List[dict])
async def get_nodes_in_box_light(
    minX: float = Query(..., description="Minimum X coordinate"),
    maxX: float = Query(..., description="Maximum X coordinate"),
    minY: float = Query(..., description="Minimum Y coordinate"),
    maxY: float = Query(..., description="Maximum Y coordinate"),
    limit: int = Query(5000, description="Maximum nodes to return")
):
    """
    Get lightweight nodes (position + degree only) in a bounding box for performance.
    Returns minimal data for distant nodes that don't need full details.
    """
    logger.info(f"📦 Fetching {limit} LIGHT nodes in box: X[{minX:.1f}, {maxX:.1f}], Y[{minY:.1f}, {maxY:.1f}]")
    start_time = time.time()
    
    conn = get_db_connection()
    
    try:
        # Query nodes in the spatial box, ordered by degree (most connected first)
        # Use same spatial filtering as regular endpoint (no spatial_index table needed)
        query = """
            SELECT paper_id, embedding_x, embedding_y, cluster_id
            FROM filtered_papers
            WHERE embedding_x >= ? AND embedding_x <= ? 
              AND embedding_y >= ? AND embedding_y <= ?
              AND embedding_x IS NOT NULL 
              AND embedding_y IS NOT NULL
              AND cluster_id IS NOT NULL
            LIMIT ?
        """
        
        params = [minX, maxX, minY, maxY, limit]
        
        nodes_df = pd.read_sql_query(query, conn, params=params)
        
        if nodes_df.empty:
            logger.warning(f"⚠️ No light nodes found in box: X[{minX:.1f}, {maxX:.1f}], Y[{minY:.1f}, {maxY:.1f}]")
            return []
        
        # Calculate degrees for all papers (simplified for performance)
        paper_ids = nodes_df['paper_id'].tolist()
        if paper_ids:
            degree_query = """
                SELECT paper_id, COUNT(*) as degree
                FROM (
                    SELECT src as paper_id FROM filtered_citations WHERE src IN ({})
                    UNION ALL
                    SELECT dst as paper_id FROM filtered_citations WHERE dst IN ({})
                ) GROUP BY paper_id
            """.format(','.join('?' * len(paper_ids)), ','.join('?' * len(paper_ids)))
            
            degrees_df = pd.read_sql_query(degree_query, conn, params=paper_ids + paper_ids)
            degree_dict = dict(zip(degrees_df['paper_id'], degrees_df['degree']))
        else:
            degree_dict = {}
        
        # Add degrees and sort by degree (most connected first)
        nodes_df['degree'] = nodes_df['paper_id'].map(degree_dict).fillna(0)
        nodes_df = nodes_df.sort_values('degree', ascending=False).head(limit)
        
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
        logger.info(f"✅ Returned {len(light_nodes)} light nodes in {elapsed:.2f}s")
        return light_nodes
    
    finally:
        conn.close()


@app.get("/api/nodes/box", response_model=List[Node])
async def get_nodes_in_box(
    minX: float = Query(..., description="Minimum X coordinate"),
    maxX: float = Query(..., description="Maximum X coordinate"),
    minY: float = Query(..., description="Minimum Y coordinate"),
    maxY: float = Query(..., description="Maximum Y coordinate"),
    ratio: float = Query(1.0, description="DEPRECATED: Zoom ratio (ignored)"),
    limit: int = Query(5000, description="Maximum nodes to return"),
    offset: int = Query(0, description="Offset for pagination/batching")
):
    """
    Get nodes within a bounding box.
    Level-of-detail filtering is now handled on the frontend based on viewport size.
    """
    app_stats["spatial_queries"] += 1
    
    logger.info(f"🗺️ Spatial query: bbox({minX:.1f},{maxX:.1f},{minY:.1f},{maxY:.1f}) limit={limit}")
    start_time = time.time()
    
    conn = get_db_connection()
    
    try:
        # Use spatial index for efficient querying
        spatial_query = """
            SELECT fp.paper_id, fp.title, fp.embedding_x, fp.embedding_y, 
                   fp.cluster_id, fp.year
            FROM papers_spatial_idx si
            JOIN filtered_papers fp ON si.id = fp.rowid
            WHERE si.maxX >= ? AND si.minX <= ? 
              AND si.maxY >= ? AND si.minY <= ?
              AND fp.cluster_id IS NOT NULL
        """
        
        papers_df = pd.read_sql_query(spatial_query, conn, params=[minX, maxX, minY, maxY])
        logger.debug(f"🔍 Spatial index returned {len(papers_df)} papers")
        
        if len(papers_df) == 0:
            logger.debug("📭 No papers found in spatial query")
            return []
        
        # Get degrees for all papers and order by degree
        paper_ids = papers_df['paper_id'].tolist()
        if paper_ids:
            degree_query = """
                SELECT paper_id, COUNT(*) as degree
                FROM (
                    SELECT src as paper_id FROM filtered_citations WHERE src IN ({})
                    UNION ALL
                    SELECT dst as paper_id FROM filtered_citations WHERE dst IN ({})
                ) GROUP BY paper_id
                ORDER BY degree DESC
            """.format(','.join('?' * len(paper_ids)), ','.join('?' * len(paper_ids)))
            
            degrees_df = pd.read_sql_query(degree_query, conn, params=paper_ids + paper_ids)
            degree_dict = dict(zip(degrees_df['paper_id'], degrees_df['degree']))
        else:
            degree_dict = {}
        
        # Sort papers by degree (most connected first) and apply offset/limit
        papers_df['degree'] = papers_df['paper_id'].map(degree_dict).fillna(0)
        papers_df = papers_df.sort_values('degree', ascending=False).iloc[offset:offset+limit]
        
        # Generate color palette
        unique_clusters = sorted(papers_df['cluster_id'].unique())
        palette = generate_palette(len(unique_clusters))
        comm_colors = {cluster_id: palette[i] for i, cluster_id in enumerate(unique_clusters)}
        
        # Format nodes
        nodes = []
        for _, row in papers_df.iterrows():
            node_id = row['paper_id']
            cluster_id = int(row['cluster_id'])
            degree = degree_dict.get(node_id, 0)
            
            nodes.append(Node(
                key=node_id,
                attributes={
                    "label": (row['title'] or node_id)[:100],
                    "x": float(row['embedding_x']),
                    "y": float(row['embedding_y']),
                    "size": max(2, 1.2 + np.log1p(degree)),
                    "color": comm_colors.get(cluster_id, "#cccccc"),
                    "community": cluster_id,
                    "degree": int(degree),
                }
            ))
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Spatial query returned {len(nodes)} nodes in {elapsed:.2f}s")
        return nodes
    
    finally:
        conn.close()


@app.post("/api/edges/batch", response_model=List[Edge])
async def get_edges_batch(request: EdgeBatchRequest):
    """
    Get edges for a batch of nodes using POST to avoid HTTP 431 errors.
    Supports priority-based edge loading for performance optimization.
    """
    logger.info(f"🔗 Batch fetching edges for {len(request.node_ids)} nodes (limit={request.limit}, priority={request.priority})")
    start_time = time.time()
    
    conn = get_db_connection()
    
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
        
        # Query edges BETWEEN the specified nodes (both source AND target must be in our set)
        edges_query = f"""
            SELECT src, dst 
            FROM filtered_citations 
            WHERE src IN ({','.join('?' * len(node_list))}) 
              AND dst IN ({','.join('?' * len(node_list))})
            {priority_filter}
            LIMIT ?
        """
        
        params = node_list + node_list + [request.limit]
        edges_df = pd.read_sql_query(edges_query, conn, params=params)
        
        # Format edges
        edges = []
        for _, row in edges_df.iterrows():
            edges.append(Edge(
                source=row['src'],
                target=row['dst'],
                attributes={"type": "line", "size": 0.4, "priority": request.priority}
            ))
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Batch returned {len(edges)} edges in {elapsed:.2f}s")
        return edges
    
    finally:
        conn.close()


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
        
        # Query edges BETWEEN the specified nodes (both source AND target must be in our set)
        edges_query = """
            SELECT src, dst 
            FROM filtered_citations 
            WHERE src IN ({}) AND dst IN ({})
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 