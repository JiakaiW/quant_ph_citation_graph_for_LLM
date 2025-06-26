#!/usr/bin/env python3
"""
Tree-First API Endpoints for Citation Visualization

These endpoints implement the new tree-first architecture where:
1. Nodes + tree edges are fetched atomically (guaranteed connectivity)
2. Extra edges are fetched progressively for enrichment
3. Topological levels enable efficient overview loading

Add these endpoints to backend_fastapi.py or run as separate service.
"""

from fastapi import FastAPI, APIRouter, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import pandas as pd
import logging
from typing import List, Optional, Dict, Any
import time
from sqlalchemy import or_
from sqlalchemy.orm import Session
import json

# --- Configuration & Globals ---
DB_PATH = "../../data/arxiv_papers.db"
TABLE_NAME = "physics_clustering"
logger = logging.getLogger(__name__)

# --- FastAPI Application ---
app = FastAPI(
    title="Citation Network API - Tree-First",
    description="API for serving a citation graph with a guaranteed tree backbone.",
    version="2.0.0"
)

# --- CORS Middleware ---
# Allows the frontend (running on a different port) to communicate with this backend
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:5173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- FastAPI Router ---
router = APIRouter()

# --- Request/Response Models ---

class Bounds(BaseModel):
    minX: float
    maxX: float
    minY: float
    maxY: float

class TreeNodeRequest(BaseModel):
    minX: float
    maxX: float
    minY: float
    maxY: float
    maxNodes: int = 1000
    minDegree: int = 0
    offset: Optional[int] = 0
    edgeType: str = "all"  # "none", "tree", "tree+extra", "all"
    visible_clusters: Optional[str] = None  # Comma-separated list of cluster IDs

class NodeTreeResponse(BaseModel):
    nodes: List[Dict[str, Any]]
    treeEdges: List[Dict[str, Any]]
    bounds: Bounds
    hasMore: bool
    stats: Dict[str, Any]

class ExtraEdgesRequest(BaseModel):
    nodeIds: List[str]
    maxEdges: int = 500

class ExtraEdgesResponse(BaseModel):
    extraEdges: List[Dict]
    nodeFlags: Dict[str, Dict[str, bool]]

class ViewportRequest(BaseModel):
    minX: float
    maxX: float
    minY: float
    maxY: float
    maxNodes: Optional[int] = 1000
    offset: Optional[int] = 0

class FrontendError(BaseModel):
    timestamp: str
    message: str
    stack: Optional[str] = None
    componentStack: Optional[str] = None
    errorBoundary: bool = False
    url: str
    userAgent: str

# --- New Models for Tree-First Architecture ---

class ViewportBounds(BaseModel):
    minX: float
    maxX: float
    minY: float
    maxY: float

class TreeLODConfig(BaseModel):
    cameraRatio: float
    maxTreeLevel: int
    yearThreshold: int
    degreeThreshold: int

class TreeFragmentRequest(BaseModel):
    viewport: ViewportBounds
    lod_config: TreeLODConfig
    max_nodes: int = 1000
    ensure_connectivity: bool = True

class BrokenEdge(BaseModel):
    source_id: str
    target_id: str
    edge_type: str  # "parent" or "child"
    priority: float

class TreeFragmentStats(BaseModel):
    nodeCount: int
    edgeCount: int

class TreeNode(BaseModel):
    key: str
    label: str
    x: float
    y: float
    size: float
    color: str
    degree: int
    cluster_id: int
    treeLevel: int
    publicationYear: int
    parentIds: List[str]
    childIds: List[str]
    isRoot: bool
    isLeaf: bool
    spatialHash: str

class TreeEdge(BaseModel):
    source: str
    target: str
    label: Optional[str] = None
    size: Optional[float] = None
    color: Optional[str] = None
    isTreeEdge: Optional[bool] = True

class TreeFragmentResponse(BaseModel):
    nodes: List[TreeNode]
    tree_edges: List[TreeEdge]
    broken_edges: List[BrokenEdge]
    tree_stats: TreeFragmentStats
    hasMore: Optional[bool] = False

# --- New Models for Phase 3 ---

class TreePathRequest(BaseModel):
    startNodeId: str
    targetNodeIds: List[str]
    maxPathLength: int = 10

class TreePathResponse(BaseModel):
    path: Optional[List[str]] = None

class NodeFragmentRequest(BaseModel):
    centerNodeId: str
    radius: int = 2
    maxNodes: int = 50

class TreeChildrenRequest(BaseModel):
    nodeId: str
    depth: int = 1

class ExtraEdgeRequest(BaseModel):
    nodeIds: List[str]

class ExtraEdgeResponse(BaseModel):
    extraEdges: List[Dict[str, Any]]

class RegionAnalysisRequest(BaseModel):
    viewport: ViewportBounds
    lod_config: TreeLODConfig

class MissingRegionsResponse(BaseModel):
    missing_regions: List[ViewportBounds]

# --- Search Endpoints ---
@router.get("/api/search", response_model=List[dict])
async def search_papers(
    q: str = Query(..., description="Search query (title, authors, abstract)"),
    limit: int = Query(100, description="Maximum results to return"),
    offset: int = Query(0, description="Offset for pagination"),
    include_abstract: bool = Query(False, description="Include abstract in results"),
    min_citations: int = Query(0, description="Minimum citation count filter"),
    year_from: Optional[int] = Query(None, description="Minimum publication year"),
    year_to: Optional[int] = Query(None, description="Maximum publication year")
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
        # Create database connection
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        
        # Build search SQL using available tables
        base_sql = f"""
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
        FROM {TABLE_NAME} fp
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
        params: List[Any] = [search_pattern, search_pattern]  # 2 parameters for relevance + WHERE
        
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
        df = pd.read_sql_query(base_sql, conn, params=params)
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
    finally:
        if 'conn' in locals():
            conn.close()

# --- Database Helper Functions ---

def get_tree_db_connection():
    """Get database connection optimized for tree queries."""
    conn = sqlite3.connect("../../data/arxiv_papers.db", timeout=30.0)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL") 
    conn.execute("PRAGMA temp_store = memory")
    conn.execute("PRAGMA mmap_size = 268435456")  # 256MB
    return conn

# --- New Tree-First Endpoints ---

async def extract_connected_tree_fragment(viewport: ViewportBounds, lod_config: TreeLODConfig):
    """
    1. Spatial Query: Find all nodes in viewport using R-Tree
    2. Connectivity Analysis: For each node, find tree path to root
    3. Gap Filling: Add intermediate nodes to maintain connectivity
    4. LOD Filtering: Remove low-priority nodes while preserving connectivity
    5. Broken Edge Detection: Find edges that exit the loaded region
    """
    logger.info("extract_connected_tree_fragment not implemented")
    # This is a placeholder implementation.
    return TreeFragmentResponse(
        nodes=[],
        tree_edges=[],
        broken_edges=[],
        tree_stats=TreeFragmentStats(nodeCount=0, edgeCount=0)
    )

@router.post("/api/tree-fragments/in-viewport", response_model=TreeFragmentResponse, summary="Get Connected Tree Fragments in Viewport")
async def get_tree_fragments(request: TreeFragmentRequest) -> TreeFragmentResponse:
    """
    Returns connected tree fragments that intersect the viewport.
    GUARANTEES: Every returned node has a path to at least one root node.
    """
    try:
        fragment = await extract_connected_tree_fragment(request.viewport, request.lod_config)
        return fragment
    except Exception as e:
        logger.error(f"❌ Failed to get tree fragments: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/nodes/tree-in-box", response_model=NodeTreeResponse, summary="Get Nodes and Tree Edges in Viewport")
async def get_nodes_with_tree_edges(request: TreeNodeRequest) -> NodeTreeResponse:
    start_time = time.time()
    conn = get_tree_db_connection()
    
    try:
        # Base query for nodes within the viewport with degree filter
        node_query = f"""
            SELECT * FROM {TABLE_NAME}
            WHERE embedding_x >= {request.minX} AND embedding_x <= {request.maxX}
              AND embedding_y >= {request.minY} AND embedding_y <= {request.maxY}
              AND degree >= {request.minDegree}
        """

        # Add cluster filter if visible_clusters is provided
        if request.visible_clusters:
            cluster_ids = [int(cid) for cid in request.visible_clusters.split(',')]
            cluster_ids_str = ','.join(str(cid) for cid in cluster_ids)
            node_query += f" AND cluster_id IN ({cluster_ids_str})"
        
        # Count total nodes in the box first
        count_query = f"SELECT COUNT(*) as count FROM ({node_query}) as subquery"
        total_in_box_df = pd.read_sql_query(count_query, conn)
        total_in_box = total_in_box_df['count'][0]

        # Apply ordering, pagination (offset and limit)
        paginated_node_query = f"""
            {node_query}
            ORDER BY degree DESC
            LIMIT {request.maxNodes}
            OFFSET {request.offset}
        """
        nodes_df = pd.read_sql_query(paginated_node_query, conn)
        
        if nodes_df.empty:
            return NodeTreeResponse(
                nodes=[], 
                treeEdges=[], 
                bounds=Bounds(minX=request.minX, maxX=request.maxX, minY=request.minY, maxY=request.maxY), 
                hasMore=False, 
                stats={}
            )

        node_keys = set(nodes_df['paper_id'])
        node_keys_str = "', '".join(node_keys)
        
        # Get edges based on edgeType parameter
        edges_list = []
        if request.edgeType != "none":
            # Always get tree edges for tree and tree+extra modes
            if request.edgeType in ["tree", "tree+extra", "all"]:
                tree_edges_query = f"""
                    SELECT src, dst FROM tree_edges
                    WHERE src IN ('{node_keys_str}') AND dst IN ('{node_keys_str}')
                """
                tree_edges_df = pd.read_sql_query(tree_edges_query, conn)
                edges_list.extend([
                    {"source": row['src'], "target": row['dst'], "attributes": {"isTreeEdge": True, "weight": 1.0}}
                    for _, row in tree_edges_df.iterrows()
                ])

            # Get extra edges for tree+extra and all modes
            if request.edgeType in ["tree+extra", "all"]:
                extra_edges_query = f"""
                    SELECT src, dst FROM extra_edges
                    WHERE src IN ('{node_keys_str}') AND dst IN ('{node_keys_str}')
                """
                extra_edges_df = pd.read_sql_query(extra_edges_query, conn)
                edges_list.extend([
                    {"source": row['src'], "target": row['dst'], "attributes": {"isTreeEdge": False, "weight": 0.5}}
                    for _, row in extra_edges_df.iterrows()
                ])

        has_more = bool(((request.offset or 0) + len(nodes_df)) < total_in_box)
        
        # Convert nodes to the format expected by the frontend
        nodes_list = []
        for _, row in nodes_df.iterrows():
            nodes_list.append({
                "key": row['paper_id'],
                "attributes": {
                    "label": row['title'],
                    "x": row['embedding_x'],
                    "y": row['embedding_y'],
                    "size": 5,
                    "color": generate_cluster_color(row['cluster_id']),
                    "cluster_id": row['cluster_id'],
                    "year": row['year'],
                    "degree": row['degree']
                }
            })

        response = NodeTreeResponse(
            nodes=nodes_list,
            treeEdges=edges_list,
            bounds=Bounds(minX=request.minX, maxX=request.maxX, minY=request.minY, maxY=request.maxY),
            hasMore=has_more,
            stats={
                "totalInBox": total_in_box,
                "returned": len(nodes_df),
                "offset": request.offset,
                "limit": request.maxNodes
            }
        )
        return response
    finally:
        conn.close()

@router.post("/api/edges/extra-for-nodes", response_model=ExtraEdgesResponse)
async def get_extra_edges(request: ExtraEdgesRequest) -> ExtraEdgesResponse:
    """Get extra (non-tree) edges for a set of nodes."""
    start_time = time.time()
    conn = get_tree_db_connection()
    
    try:
        # Format node IDs for SQL query
        node_ids_str = "', '".join(request.nodeIds)
        
        # Get extra edges where either source or target is in the requested nodes
        extra_edges_query = f"""
            SELECT src, dst, weight FROM extra_edges
            WHERE (src IN ('{node_ids_str}') OR dst IN ('{node_ids_str}'))
            ORDER BY weight DESC
            LIMIT {request.maxEdges}
        """
        
        extra_edges_df = pd.read_sql_query(extra_edges_query, conn)
        
        # Convert edges to the format expected by the frontend
        edges_list = [
            {
                "source": row['src'],
                "target": row['dst'],
                "attributes": {
                    "weight": float(row['weight']),
                    "isTreeEdge": False
                }
            }
            for _, row in extra_edges_df.iterrows()
        ]
        
        # Mark nodes as enriched if we got all their extra edges
        node_flags = {
            node_id: {"enriched": False}
            for node_id in request.nodeIds
        }
        
        # Count edges per node to determine enrichment
        for edge in edges_list:
            src = edge['source']
            dst = edge['target']
            if src in node_flags:
                node_flags[src]['enriched'] = True
            if dst in node_flags:
                node_flags[dst]['enriched'] = True
        
        return ExtraEdgesResponse(
            extraEdges=edges_list,
            nodeFlags=node_flags
        )
    finally:
        conn.close()

@router.get("/api/overview/topological", summary="Get High-Level Topological Overview")
async def get_topological_overview(
    maxLevels: int = Query(5, description="Maximum topological levels"),
    maxNodesPerLevel: int = Query(50, description="Maximum nodes per level")
) -> Dict[str, Any]:
    """
    ## 🗺️ Get a High-Level Topological Overview of the Graph
    """
    logger.info(f"📊 Topological overview: {maxLevels} levels, {maxNodesPerLevel} nodes/level")
    start_time = time.time()
    
    conn = get_tree_db_connection()
    
    try:
        overview_nodes = []
        level_stats = {}
        
        for level in range(maxLevels):
            # Get top nodes at this level
            level_query = f"""
                SELECT paper_id, title, embedding_x, embedding_y, cluster_id, degree
                FROM physics_clustering 
                WHERE topo_level = {level}
                ORDER BY degree DESC
                LIMIT {maxNodesPerLevel}
            """
            
            level_df = pd.read_sql_query(level_query, conn)
            level_stats[level] = len(level_df)
            
            for _, node in level_df.iterrows():
                overview_nodes.append({
                    "key": node['paper_id'],
                    "level": level,
                    "attributes": {
                        "label": node['title'][:30] + "...",
                        "x": float(node['embedding_x']),
                        "y": float(node['embedding_y']),
                        "size": 8 + level * 2,  # Bigger nodes at higher levels
                        "color": generate_level_color(level),
                        "degree": int(node['degree'])
                    }
                })
        
        elapsed = time.time() - start_time
        
        return {
            "nodes": overview_nodes,
            "levelStats": level_stats,
            "loadTime": elapsed,
            "totalLevels": maxLevels
        }
        
    except Exception as e:
        logger.error(f"❌ Overview failed: {e}")
        raise HTTPException(status_code=500, detail=f"Overview error: {e}")
    finally:
        conn.close()

@router.get("/api/bounds", summary="Get Dataset Coordinate Bounds")
async def get_data_bounds() -> Dict[str, Any]:
    """
    Get the coordinate bounds of all data points for camera initialization.
    Returns the min/max X/Y coordinates of all papers with embeddings.
    """
    conn = get_tree_db_connection()
    try:
        # Get coordinate bounds using SQL for better performance
        bounds_query = f"""
            SELECT MIN(embedding_x) as minX, MAX(embedding_x) as maxX,
                   MIN(embedding_y) as minY, MAX(embedding_y) as maxY,
                   COUNT(*) as total_papers
            FROM {TABLE_NAME} 
            WHERE embedding_x IS NOT NULL AND embedding_y IS NOT NULL
              AND embedding_x BETWEEN -50 AND 50  -- Filter out extreme outliers
              AND embedding_y BETWEEN -50 AND 50
        """
        
        result_df = pd.read_sql_query(bounds_query, conn)
        
        if result_df.empty:
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
        
        return bounds
    finally:
        conn.close()

@router.post("/api/frontend-error")
async def log_frontend_error(error: FrontendError):
    """Log frontend JavaScript errors for monitoring and debugging."""
    logger.error(f"🚨 FRONTEND ERROR: {error.message}")
    logger.error(f"   URL: {error.url}")
    logger.error(f"   Timestamp: {error.timestamp}")
    logger.error(f"   Error Boundary: {error.errorBoundary}")
    
    if error.stack:
        logger.error(f"   Stack: {error.stack}")
    
    if error.componentStack:
        logger.error(f"   Component Stack: {error.componentStack}")
    
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

@router.get("/api/nodes")
async def get_nodes(
    nodeIds: str = Query(..., description="Comma-separated list of node IDs"),
    limit: int = Query(100, description="Maximum number of nodes to return")
):
    """
    🎯 Get nodes by their IDs.
    Returns node data including coordinates, cluster, and degree.
    """
    logger.info(f"🎯 Fetching nodes: {nodeIds} (limit={limit})")
    
    try:
        # Split and validate node IDs
        node_ids = [nid.strip() for nid in nodeIds.split(',') if nid.strip()]
        if not node_ids:
            raise HTTPException(status_code=400, detail="No valid node IDs provided")
            
        # Create database connection
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        
        # Query for nodes
        sql = f"""
        SELECT 
            fp.paper_id as key,
            COALESCE(ap.title, fp.title) as label,
            fp.embedding_x as x,
            fp.embedding_y as y,
            fp.degree,
            fp.cluster_id as community
        FROM {TABLE_NAME} fp
        LEFT JOIN arxiv_papers ap ON fp.paper_id = ap.arxiv_id
        WHERE fp.paper_id IN ({','.join(['?' for _ in node_ids])})
        AND fp.embedding_x IS NOT NULL 
        AND fp.embedding_y IS NOT NULL
        LIMIT ?
        """
        
        # Execute query
        df = pd.read_sql_query(sql, conn, params=[*node_ids, limit])
        
        if df.empty:
            logger.warning(f"🎯 No nodes found for IDs: {nodeIds}")
            return []
            
        # Format results with nested attributes
        results = []
        for _, row in df.iterrows():
            node = {
                "key": row['key'],
                "attributes": {
                    "x": float(row['x']),
                    "y": float(row['y']),
                    "degree": int(row['degree']) if pd.notna(row['degree']) else 0,
                    "cluster_id": int(row['community']) if pd.notna(row['community']) else 0,
                    "label": row['label']
                }
            }
            results.append(node)
            
        logger.info(f"🎯 Found {len(results)} nodes")
        return results
        
    except Exception as e:
        logger.error(f"❌ Error fetching nodes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
        
    finally:
        if 'conn' in locals():
            conn.close()

@router.get("/api/edges")
async def get_edges(
    nodeId: str = Query(..., description="Node ID to get edges for"),
    limit: int = Query(1000, description="Maximum number of edges to return")
):
    """
    🔗 Get edges for a specific node.
    Returns both incoming and outgoing edges.
    """
    logger.info(f"🔗 Fetching edges for node: {nodeId} (limit={limit})")
    
    try:
        # Create database connection
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        
        # Query for edges
        sql = f"""
        SELECT DISTINCT
            source_id as source,
            target_id as target,
            'citation' as type
        FROM citations
        WHERE source_id = ? OR target_id = ?
        LIMIT ?
        """
        
        # Execute query
        df = pd.read_sql_query(sql, conn, params=[nodeId, nodeId, limit])
        
        if df.empty:
            logger.warning(f"🔗 No edges found for node: {nodeId}")
            return []
            
        # Format results
        results = []
        for _, row in df.iterrows():
            edge = {
                "source": row['source'],
                "target": row['target'],
                "type": row['type']
            }
            results.append(edge)
            
        logger.info(f"🔗 Found {len(results)} edges for node {nodeId}")
        return results
        
    except Exception as e:
        logger.error(f"❌ Error fetching edges: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
        
    finally:
        if 'conn' in locals():
            conn.close()

# --- Helper Functions ---

def generate_cluster_color(cluster_id: int) -> str:
    """Generate consistent color for cluster ID."""
    # Simple hash-based color generation
    hash_val = hash(cluster_id) % 360
    return f"hsl({hash_val}, 70%, 60%)"

def generate_level_color(level: int) -> str:
    """Generate a color for a topological level."""
    colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"]
    return colors[level % len(colors)]

# --- New Endpoints for Phase 3 ---

@router.post("/api/tree-path/find", response_model=TreePathResponse)
async def find_tree_path(request: TreePathRequest) -> TreePathResponse:
    """Find shortest tree path between nodes (for search connectivity)"""
    # Placeholder implementation
    return TreePathResponse(path=[])

@router.post("/api/tree-fragment/around-node", response_model=TreeFragmentResponse)
async def get_tree_fragment_around_node(request: NodeFragmentRequest) -> TreeFragmentResponse:
    """Load tree fragment centered on specific node (for search results)"""
    # Placeholder implementation
    return TreeFragmentResponse(
        nodes=[],
        tree_edges=[],
        broken_edges=[],
        tree_stats=TreeFragmentStats(nodeCount=0, edgeCount=0),
        hasMore=False
    )

@router.post("/api/tree-children/for-node", response_model=TreeFragmentResponse)
async def get_tree_children_for_node(request: TreeChildrenRequest) -> TreeFragmentResponse:
    """Load tree children for node expansion (tree enrichment)"""
    # Placeholder implementation
    return TreeFragmentResponse(
        nodes=[],
        tree_edges=[],
        broken_edges=[],
        tree_stats=TreeFragmentStats(nodeCount=0, edgeCount=0),
        hasMore=False
    )

@router.post("/api/extra-edges/for-nodes", response_model=ExtraEdgeResponse)
async def get_extra_edges_for_nodes(request: ExtraEdgeRequest) -> ExtraEdgeResponse:
    """Load extra edges between nodes (cycle shortcuts from extra_edges table)"""
    # Placeholder implementation
    return ExtraEdgeResponse(extraEdges=[])

@router.post("/api/tree-regions/missing", response_model=MissingRegionsResponse)
async def find_missing_tree_regions(request: RegionAnalysisRequest) -> MissingRegionsResponse:
    """Analyze which tree regions need loading for given viewport"""
    # Placeholder implementation
    return MissingRegionsResponse(missing_regions=[])

# --- Include the router in the main app ---
app.include_router(router)

# --- FastAPI Integration ---
"""
Add these endpoints to backend_fastapi.py:

@app.post("/api/nodes/tree-in-box", response_model=NodeTreeResponse)
async def api_get_nodes_with_tree_edges(request: TreeNodeRequest):
    return await get_nodes_with_tree_edges(request)

@app.post("/api/edges/extra-for-nodes", response_model=ExtraEdgesResponse)  
async def api_get_extra_edges_for_nodes(request: ExtraEdgesRequest):
    return await get_extra_edges_for_nodes(request)

@app.get("/api/overview/topological")
async def api_get_topological_overview(
    maxLevels: int = Query(5, description="Maximum topological levels to include"),
    maxNodesPerLevel: int = Query(50, description="Maximum nodes per level")
):
    return await get_topological_overview(maxLevels, maxNodesPerLevel)
""" 