import { ViewportBounds, EdgeLoadResult } from '../types/GraphTypes';
import { ViewportCalculator } from '../viewport/ViewportCalculator';
import { LevelOfDetail } from '../viewport/LevelOfDetail';

// Edge interface for type safety
export interface Edge {
  source: string;
  target: string;
  weight?: number;
}

/**
 * 🔗 Edge Loader
 * 
 * Handles edge loading logic and management.
 * Uses efficient strategy: load edges only for viewport nodes to avoid
 * the spatial complexity problem (edges don't have direct coordinates).
 */
export class EdgeLoader {
  private viewportCalculator: ViewportCalculator;
  private lodManager: LevelOfDetail;

  constructor(viewportCalculator: ViewportCalculator, lodManager: LevelOfDetail) {
    this.viewportCalculator = viewportCalculator;
    this.lodManager = lodManager;
  }

  /**
   * Load edges for viewport using SPATIAL STRATEGY (HIGHLY EFFICIENT)
   * 
   * This solves the core problem with much better performance:
   * 1. Nodes have (x,y) coordinates → R-Tree spatial query works
   * 2. Edges connect two nodes → Use spatial bounding box approach
   * 
   * NEW EFFICIENT STRATEGY:
   * 1. Query backend for edges whose bounding box intersects viewport
   * 2. Backend uses spatial index on edge bounding boxes
   * 3. Much faster than IN clauses with thousands of node IDs
   */
  async loadEdgesForViewport(
    bounds: ViewportBounds, 
    graph: any,
    limit: number = 3000
  ): Promise<EdgeLoadResult> {
    console.log(`🔗 Loading edges for viewport using spatial bounding box strategy`);

    try {
      // HIGHLY EFFICIENT: Spatial query for edges
      // Backend will use spatial index: WHERE edge_bbox INTERSECTS viewport_bbox
      const edges = await this.fetchEdgesSpatial(bounds, limit);
      
      let addedEdges = 0;
      let skippedEdges = 0;
      
      edges.forEach((edge: Edge) => {
        // CRITICAL: Both source and target must exist in graph
        // This prevents orphaned edges and ensures visual consistency
        if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
          if (!graph.hasEdge(edge.source, edge.target)) {
            graph.addEdge(edge.source, edge.target, {
              color: '#cccccc',
              size: 1,
            });
            addedEdges++;
          } else {
            skippedEdges++;
          }
        }
        // Note: We silently ignore edges where one endpoint is missing
        // This is expected behavior when viewport contains partial subgraph
      });

      console.log(`🔗 Added ${addedEdges} edges (${skippedEdges} already existed) from ${edges.length} candidates`);
      
      return { edges, addedCount: addedEdges, skippedCount: skippedEdges };

    } catch (error) {
      console.warn('🔗 Viewport edge loading failed:', error);
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }
  }

  /**
   * Load edges with LOD awareness
   * Only load edges for detailed zoom levels to improve performance
   */
  async loadEdgesForViewportLOD(
    bounds: ViewportBounds,
    graph: any,
    lodLevel: number,
    limit: number = 3000
  ): Promise<EdgeLoadResult> {
    // Check if edges should be loaded for this LOD level
    if (!this.lodManager.shouldLoadEdges(lodLevel)) {
      console.log(`🔗 Skipping edge loading for overview LOD ${lodLevel}`);
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }

    console.log(`🔗 Loading edges for LOD ${lodLevel}`);
    return this.loadEdgesForViewport(bounds, graph, limit);
  }

  /**
   * Load edges for specific nodes (batch loading)
   */
  async loadEdgesBatch(
    nodeIds: string[], 
    graph: any,
    limit: number = 10000
  ): Promise<EdgeLoadResult> {
    if (nodeIds.length === 0) {
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }

    console.log(`🔗 Loading edges for ${nodeIds.length} specific nodes`);

    try {
      const edges = await this.fetchEdgesBatched(nodeIds, limit);
      
      const result = this.addEdgesToGraph(edges, graph);
      console.log(`🔗 Batch loading: added ${result.addedCount} edges, skipped ${result.skippedCount}`);
      
      return { edges, addedCount: result.addedCount, skippedCount: result.skippedCount };

    } catch (error) {
      console.warn('🔗 Batch edge loading failed:', error);
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }
  }

  /**
   * Add edges to graph with validation
   */
  addEdgesToGraph(edges: Edge[], graph: any): { addedCount: number; skippedCount: number } {
    let addedCount = 0;
    let skippedCount = 0;

    edges.forEach((edge: Edge) => {
      // Validate both endpoints exist
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        if (!graph.hasEdge(edge.source, edge.target)) {
          graph.addEdge(edge.source, edge.target, {
            color: '#cccccc',
            size: 1, // Fixed: Use smaller edge size to prevent visual clutter
          });
          addedCount++;
        } else {
          skippedCount++;
        }
      }
    });

    return { addedCount, skippedCount };
  }

  /**
   * Smart edge loading with progressive enhancement
   * Loads high-importance edges first (between high-degree nodes)
   */
  async loadEdgesProgressive(
    bounds: ViewportBounds,
    graph: any,
    lodLevel: number
  ): Promise<EdgeLoadResult> {
    if (!this.lodManager.shouldLoadEdges(lodLevel)) {
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }

    const viewportNodeIds = this.viewportCalculator.getNodesInViewport(bounds);
    
    if (viewportNodeIds.length === 0) {
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }

    // Sort nodes by degree (high-degree nodes first)
    const nodesByDegree = viewportNodeIds
      .map(nodeId => ({
        nodeId,
        degree: graph.getNodeAttributes(nodeId).degree || 0
      }))
      .sort((a, b) => b.degree - a.degree);

    console.log(`🔗 Progressive edge loading: ${nodesByDegree.length} nodes, focusing on high-degree nodes first`);

    // Load edges for high-degree nodes first (they're more visually important)
    const highDegreeNodes = nodesByDegree
      .slice(0, Math.min(50, nodesByDegree.length)) // Top 50 or all if fewer
      .map(item => item.nodeId);

    try {
      const result = await this.loadEdgesBatch(highDegreeNodes, graph, 2000);
      console.log(`🔗 Progressive loading complete: ${result.addedCount} edges for high-importance nodes`);
      return result;
    } catch (error) {
      console.warn('🔗 Progressive edge loading failed:', error);
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }
  }



  /**
   * Get edge statistics for debugging
   */
  getEdgeStats(bounds: ViewportBounds, graph: any): {
    totalEdges: number;
    viewportEdges: number;
    distantEdges: number;
    orphanedEdges: number;
  } {
    const viewportNodeIds = new Set(this.viewportCalculator.getNodesInViewport(bounds));
    const allEdges = graph.edges();
    
    let viewportEdges = 0;
    let distantEdges = 0;
    let orphanedEdges = 0;

    allEdges.forEach((edgeId: string) => {
      const [source, target] = graph.extremities(edgeId);

      // Check if nodes still exist (orphaned edge detection)
      if (!graph.hasNode(source) || !graph.hasNode(target)) {
        orphanedEdges++;
        return;
      }

      // Check if at least one endpoint is in viewport
      if (viewportNodeIds.has(source) || viewportNodeIds.has(target)) {
        viewportEdges++;
      } else {
        distantEdges++;
      }
    });

    return {
      totalEdges: allEdges.length,
      viewportEdges,
      distantEdges,
      orphanedEdges
    };
  }

  /**
   * 🚀 HIGHLY EFFICIENT: Fetch edges using spatial bounding box query
   * 
   * Backend Implementation Options:
   * 1. Spatial Index on Edge Bounding Boxes
   * 2. Pre-computed Adjacency Lists
   * 3. Graph Partitioning
   */
  private async fetchEdgesSpatial(bounds: ViewportBounds, limit: number): Promise<Edge[]> {
    try {
      // Strategy 1: Spatial bounding box query (recommended)
      const response = await fetch('/api/edges/spatial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minX: bounds.minX,
          maxX: bounds.maxX,
          minY: bounds.minY,
          maxY: bounds.maxY,
          limit: limit,
          strategy: 'spatial_bbox' // Tell backend to use spatial index
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const edges = await response.json();
      console.log(`🔗 Spatial edge query returned ${edges.length} edges`);
      return edges;

    } catch (error) {
      console.warn('🔗 Spatial edge query failed, falling back to node-based query:', error);
      return this.fetchEdgesNodeBased(bounds, limit);
    }
  }

  /**
   * 🔄 Fallback: Node-based edge query (less efficient but reliable)
   */
  private async fetchEdgesNodeBased(bounds: ViewportBounds, limit: number): Promise<Edge[]> {
    // Get viewport nodes first
    const viewportNodeIds = this.viewportCalculator.getNodesInViewport(bounds);
    
    if (viewportNodeIds.length === 0) {
      return [];
    }

    // Use batch strategy to avoid huge IN clauses
    return this.fetchEdgesBatched(viewportNodeIds, limit);
  }

  /**
   * 📦 Batch edge fetching to avoid huge IN clauses
   */
  private async fetchEdgesBatched(nodeIds: string[], limit: number): Promise<Edge[]> {
    const BATCH_SIZE = 100; // Process 100 nodes at a time
    const allEdges: Edge[] = [];
    
    for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
      const batch = nodeIds.slice(i, i + BATCH_SIZE);
      
      try {
        const response = await fetch('/api/edges/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeIds: batch,
            limit: Math.ceil(limit / (nodeIds.length / BATCH_SIZE))
          })
        });

        if (response.ok) {
          const batchEdges = await response.json();
          allEdges.push(...batchEdges);
          
          // Stop if we've reached our limit
          if (allEdges.length >= limit) {
            break;
          }
        }
      } catch (error) {
        console.warn(`🔗 Batch ${i / BATCH_SIZE + 1} failed:`, error);
      }
    }

    return allEdges.slice(0, limit);
  }

  /**
   * 🏗️ Alternative: Use pre-computed adjacency lists
   */
  private async fetchEdgesAdjacency(bounds: ViewportBounds, limit: number): Promise<Edge[]> {
    const viewportNodeIds = this.viewportCalculator.getNodesInViewport(bounds);
    
    if (viewportNodeIds.length === 0) {
      return [];
    }

    try {
      // Query pre-computed adjacency table
      const response = await fetch('/api/edges/adjacency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeIds: viewportNodeIds,
          limit: limit
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const adjacencyData = await response.json();
      
      // Convert adjacency lists to edge format
      const edges: Edge[] = [];
      adjacencyData.forEach((nodeData: any) => {
        nodeData.adjacent_nodes.forEach((adj: any) => {
          if (edges.length < limit) {
            edges.push({
              source: nodeData.node_id,
              target: adj.target,
              weight: adj.weight || 1.0
            });
          }
        });
      });

      console.log(`🔗 Adjacency query returned ${edges.length} edges`);
      return edges;

    } catch (error) {
      console.warn('🔗 Adjacency query failed:', error);
      return [];
    }
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use loadEdgesForViewport instead
   */
  async loadEdgesForVisibleNodes(graph: any): Promise<EdgeLoadResult> {
    console.warn('⚠️ loadEdgesForVisibleNodes is deprecated, use loadEdgesForViewport instead');
    
    const nodeIds = graph.nodes();
    if (nodeIds.length === 0) {
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }

    return this.loadEdgesBatch(nodeIds, graph, 2000);
  }

  /**
   * 🎨 RENDERING-OPTIMIZED: Load edges with focus on visual performance
   * 
   * For non-local graphs (70K nodes, 400K edges), optimize for:
   * 1. Smooth rendering performance (WebGL/Canvas limits)
   * 2. Visual clarity (avoid edge clutter)
   * 3. Interactive responsiveness (fast add/remove operations)
   */
  async loadEdgesRenderingOptimized(
    bounds: ViewportBounds, 
    graph: any,
    maxEdgesForRendering: number = 15000  // Rendering performance limit
  ): Promise<EdgeLoadResult> {
    console.log(`🎨 Rendering-optimized edge loading (max ${maxEdgesForRendering} edges for smooth rendering)`);

    // Step 1: Check current rendering load
    const currentEdgeCount = graph.size;
    if (currentEdgeCount >= maxEdgesForRendering) {
      console.log(`🎨 Rendering limit reached (${currentEdgeCount}/${maxEdgesForRendering}), optimizing display`);
      await this.optimizeEdgesForRendering(graph, bounds, maxEdgesForRendering * 0.8); // Keep 80%
    }

    // Step 2: Load edges with visual importance filtering
    const availableSlots = maxEdgesForRendering - graph.size;
    if (availableSlots <= 0) {
      console.log(`🎨 No rendering slots available for new edges`);
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }

    try {
      // Strategy: Load visually important edges for viewport
      const edges = await this.fetchEdgesWithVisualImportance(bounds, availableSlots);
      
      const result = this.addEdgesToGraph(edges, graph);
      console.log(`🎨 Rendering-optimized loading: ${result.addedCount} edges added (${graph.size}/${maxEdgesForRendering} total)`);
      
      return { edges, addedCount: result.addedCount, skippedCount: result.skippedCount };

    } catch (error) {
      console.warn('🎨 Rendering-optimized edge loading failed:', error);
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }
  }

  /**
   * 🎯 Fetch edges with importance filtering for non-local graphs
   */
  private async fetchEdgesWithImportanceFilter(
    bounds: ViewportBounds, 
    limit: number
  ): Promise<Edge[]> {
    try {
      // Strategy: Multi-criteria edge importance for non-local graphs
      const response = await fetch('/api/edges/importance-filtered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minX: bounds.minX,
          maxX: bounds.maxX,
          minY: bounds.minY,
          maxY: bounds.maxY,
          limit: limit,
          criteria: {
            // Prioritize edges by multiple factors
            minWeight: 0.1,           // Citation strength threshold
            minNodeDegree: 5,         // Connect important nodes
            maxDistance: 1000,        // Spatial distance limit (for some locality)
            preferViewportNodes: true, // Boost edges with viewport endpoints
            includeHubConnections: true // Always include high-degree node edges
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const edges = await response.json();
      console.log(`🎯 Importance-filtered query returned ${edges.length} high-value edges`);
      return edges;

    } catch (error) {
      console.warn('🎯 Importance-filtered query failed, falling back:', error);
      return this.fetchEdgesSpatial(bounds, limit);
    }
  }

  /**
   * 🎨 Optimize edges for better rendering performance
   */
  private async optimizeEdgesForRendering(
    graph: any, 
    currentBounds: ViewportBounds, 
    targetEdgeCount: number
  ): Promise<number> {
    return this.evictLeastImportantEdges(graph, currentBounds, targetEdgeCount);
  }

  /**
   * 🎯 Fetch edges optimized for visual clarity and rendering performance
   */
  private async fetchEdgesWithVisualImportance(
    bounds: ViewportBounds, 
    limit: number
  ): Promise<Edge[]> {
    // Use the existing importance filter but with rendering-focused criteria
    return this.fetchEdgesWithImportanceFilter(bounds, limit);
  }

  /**
   * 🗑️ Evict least important edges to free memory
   */
  private async evictLeastImportantEdges(
    graph: any, 
    currentBounds: ViewportBounds, 
    targetEdgeCount: number
  ): Promise<number> {
    const currentEdges = graph.edges();
    const edgesToRemove = currentEdges.length - targetEdgeCount;
    
    if (edgesToRemove <= 0) {
      return 0;
    }

    console.log(`🗑️ Evicting ${edgesToRemove} least important edges`);

    // Score edges by importance (lower score = less important)
    const edgeScores: Array<{edgeId: string, score: number}> = [];
    
    currentEdges.forEach((edgeId: string) => {
      const [source, target] = graph.extremities(edgeId);
      const sourceAttrs = graph.getNodeAttributes(source);
      const targetAttrs = graph.getNodeAttributes(target);
      
      // Calculate edge importance score
      let score = 0;
      
      // Factor 1: Are endpoints in current viewport? (high importance)
      const sourceInViewport = this.isNodeInBounds(sourceAttrs, currentBounds);
      const targetInViewport = this.isNodeInBounds(targetAttrs, currentBounds);
      if (sourceInViewport || targetInViewport) score += 100;
      if (sourceInViewport && targetInViewport) score += 200; // Both in viewport = very important
      
      // Factor 2: Node degrees (connect important nodes)
      score += (sourceAttrs.degree || 0) + (targetAttrs.degree || 0);
      
      // Factor 3: Edge weight (citation strength)
      const edgeAttrs = graph.getEdgeAttributes(edgeId);
      score += (edgeAttrs.weight || 1) * 10;
      
      // Factor 4: Recency (recently added edges are more important)
      score += (edgeAttrs.addedTimestamp || 0) / 1000;
      
      edgeScores.push({ edgeId, score });
    });

    // Sort by score (ascending = least important first)
    edgeScores.sort((a, b) => a.score - b.score);
    
    // Remove least important edges
    let removedCount = 0;
    for (let i = 0; i < edgesToRemove && i < edgeScores.length; i++) {
      const { edgeId } = edgeScores[i];
      if (graph.hasEdge(edgeId)) {
        graph.dropEdge(edgeId);
        removedCount++;
      }
    }

    console.log(`🗑️ Evicted ${removedCount} edges, graph now has ${graph.size} edges`);
    return removedCount;
  }

  /**
   * 🎚️ Adaptive edge loading based on viewport size and zoom level
   */
  async loadEdgesAdaptive(
    bounds: ViewportBounds,
    graph: any,
    lodLevel: number
  ): Promise<EdgeLoadResult> {
    // Calculate viewport area to determine strategy
    const viewportArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    const totalDataArea = 10000; // Approximate total data bounds area
    const viewportRatio = viewportArea / totalDataArea;

    console.log(`🎚️ Adaptive loading: viewport covers ${(viewportRatio * 100).toFixed(1)}% of data`);

    // Strategy selection based on viewport size
    if (viewportRatio > 0.5) {
      // Large viewport: Use aggressive filtering to prevent rendering lag
      console.log(`🎚️ Large viewport detected, using strict filtering`);
      return this.loadEdgesRenderingOptimized(bounds, graph, 8000);
      
    } else if (viewportRatio > 0.1) {
      // Medium viewport: Balanced approach
      console.log(`🎚️ Medium viewport detected, using balanced loading`);
      return this.loadEdgesRenderingOptimized(bounds, graph, 12000);
      
    } else {
      // Small viewport: Can afford more edges for detail
      console.log(`🎚️ Small viewport detected, using detailed loading`);
      return this.loadEdgesRenderingOptimized(bounds, graph, 18000);
    }
  }

  /**
   * 📊 Get memory usage statistics
   */
  getMemoryStats(graph: any): {
    nodeCount: number;
    edgeCount: number;
    estimatedMemoryMB: number;
    memoryPressure: number;
  } {
    const nodeCount = graph.order;
    const edgeCount = graph.size;
    
    // Rough memory estimation
    const nodeMemory = nodeCount * 200; // ~200 bytes per node (attributes)
    const edgeMemory = edgeCount * 50;   // ~50 bytes per edge
    const estimatedMemoryMB = (nodeMemory + edgeMemory) / (1024 * 1024);
    
    // Memory pressure calculation (0-1 scale)
    const maxRecommendedEdges = 10000; // For 70K node dataset
    const memoryPressure = Math.min(1.0, edgeCount / maxRecommendedEdges);
    
    return {
      nodeCount,
      edgeCount,
      estimatedMemoryMB,
      memoryPressure
    };
  }

  /**
   * 🧹 Cleanup distant edges that are no longer relevant
   */
  cleanupDistantEdges(bounds: ViewportBounds, graph: any, maxDistance: number = 2000): number {
    const allEdges = graph.edges();
    let removedCount = 0;
    
    allEdges.forEach((edgeId: string) => {
      const [source, target] = graph.extremities(edgeId);
      const sourceAttrs = graph.getNodeAttributes(source);
      const targetAttrs = graph.getNodeAttributes(target);
      
      // Calculate distance from viewport center
      const viewportCenterX = (bounds.minX + bounds.maxX) / 2;
      const viewportCenterY = (bounds.minY + bounds.maxY) / 2;
      
      const sourceDistance = Math.sqrt(
        Math.pow(sourceAttrs.x - viewportCenterX, 2) + 
        Math.pow(sourceAttrs.y - viewportCenterY, 2)
      );
      
      const targetDistance = Math.sqrt(
        Math.pow(targetAttrs.x - viewportCenterX, 2) + 
        Math.pow(targetAttrs.y - viewportCenterY, 2)
      );
      
      // Remove edge if both endpoints are very far from viewport
      if (sourceDistance > maxDistance && targetDistance > maxDistance) {
        graph.dropEdge(edgeId);
        removedCount++;
      }
    });

    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} distant edges (>${maxDistance} units from viewport)`);
    }

    return removedCount;
  }

  /**
   * Helper: Check if node is within bounds
   */
  private isNodeInBounds(nodeAttrs: any, bounds: ViewportBounds): boolean {
    return nodeAttrs.x >= bounds.minX && nodeAttrs.x <= bounds.maxX &&
           nodeAttrs.y >= bounds.minY && nodeAttrs.y <= bounds.maxY;
  }
} 