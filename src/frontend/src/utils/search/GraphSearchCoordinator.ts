import { 
  SearchResult, 
  GraphSearchIntegration,
  SearchState
} from './SearchTypes';

/**
 * 🔗 Graph Search Coordinator
 * 
 * Bridges the search system with GraphManager, handling:
 * - Ensuring search result nodes are loaded in the graph
 * - Managing viewport transitions to show search results
 * - Coordinating with GraphManager's memory and loading systems
 * - Updating search results with graph state information
 */
export class GraphSearchCoordinator implements GraphSearchIntegration {
  private graphManager: any;
  private sigma: any;
  private graph: any;

  constructor(graphManager: any, sigma: any, graph: any) {
    this.graphManager = graphManager;
    this.sigma = sigma;
    this.graph = graph;
  }

  /**
   * 🎯 Ensure a node is loaded in the graph
   */
  async ensureNodeLoaded(nodeId: string): Promise<boolean> {
    console.log(`🔗 Ensuring node ${nodeId} is loaded`);

    try {
      // Always load fresh node data
      const response = await fetch(`/api/nodes?nodeIds=${encodeURIComponent(nodeId)}&limit=1`);
      if (!response.ok) {
        throw new Error(`Node API error: ${response.status}`);
      }

      const nodes = await response.json();
      if (!nodes || nodes.length === 0) {
        throw new Error(`Node ${nodeId} not found`);
      }

      const node = nodes[0];
      
      // Get coordinate manager from services
      const coordinateManager = this.graphManager.getServices().resolve('CoordinateManager');
      if (!coordinateManager) {
        throw new Error('CoordinateManager service not found');
      }
      const coordinateScale = coordinateManager.getCoordinateScale();

      // Prepare node data with proper coordinate scaling
      const nodeData = {
        key: node.key || nodeId,
        x: (node.x || node.attributes?.x || 0) * coordinateScale,
        y: (node.y || node.attributes?.y || 0) * coordinateScale,
        degree: node.degree || node.attributes?.degree || 0,
        cluster_id: Number(node.cluster_id || node.attributes?.cluster_id || node.attributes?.community || 0),
        label: node.label || node.attributes?.label || nodeId
      };

      // Validate coordinates before proceeding
      if (typeof nodeData.x !== 'number' || typeof nodeData.y !== 'number' || 
          isNaN(nodeData.x) || isNaN(nodeData.y)) {
        throw new Error(`Invalid coordinates for node ${nodeId}: x=${nodeData.x}, y=${nodeData.y}`);
      }

      // If node exists, update its attributes
      if (this.graph.hasNode(nodeId)) {
        console.log(`🔗 Updating existing node ${nodeId}`);
        this.graph.setNodeAttributes(nodeId, nodeData);
      } else {
        console.log(`🔗 Adding new node ${nodeId}`);
        const nodeService = this.graphManager.getServices().resolve('NodeService');
        if (!nodeService) {
          throw new Error('NodeService not found');
        }
        nodeService.addNodes([nodeData]);
      }

      // Load edges for the node
      const edgesResponse = await fetch(`/api/edges?nodeId=${encodeURIComponent(nodeId)}`);
      if (!edgesResponse.ok) {
        throw new Error(`Edge API error: ${edgesResponse.status}`);
      }

      const edges = await edgesResponse.json();
      if (edges && Array.isArray(edges)) {
        const edgeService = this.graphManager.getServices().resolve('EdgeService');
        if (!edgeService) {
          throw new Error('EdgeService not found');
        }

        // Remove existing edges for this node
        const existingEdges = this.graph.edges().filter((edgeId: string) => {
          const edge = this.graph.getEdgeAttributes(edgeId);
          return edge.source === nodeId || edge.target === nodeId;
        });
        if (existingEdges.length > 0) {
          edgeService.removeEdges(existingEdges);
        }

        // Add new edges
        edgeService.addEdges(edges.map(edge => ({
          source: edge.source,
          target: edge.target,
          isTreeEdge: false
        })));
      }

      // Final verification that node was added successfully
      if (!this.graph.hasNode(nodeId)) {
        throw new Error(`Node ${nodeId} failed to be added to graph`);
      }

      // Verify node has valid position data
      const attrs = this.graph.getNodeAttributes(nodeId);
      if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number' || 
          isNaN(attrs.x) || isNaN(attrs.y)) {
        throw new Error(`Node ${nodeId} has invalid position data after loading: x=${attrs.x}, y=${attrs.y}`);
      }

      console.log(`🔗 Successfully loaded/updated node ${nodeId} at position (${attrs.x}, ${attrs.y})`);
      return true;

    } catch (error) {
      console.error(`🔗 Error loading node ${nodeId}:`, error);
      throw error; // Re-throw to handle in caller
    }
  }

  /**
   * 🌐 Ensure neighbors of a node are loaded
   */
  async ensureNeighborsLoaded(nodeId: string, depth: number = 1): Promise<string[]> {
    console.log(`🔗 Ensuring neighbors of ${nodeId} are loaded (depth: ${depth})`);

    if (!this.graph.hasNode(nodeId)) {
      console.warn(`🔗 Cannot load neighbors: node ${nodeId} not in graph`);
      return [];
    }

    try {
      // Get current neighbors
      const currentNeighbors = this.graph.neighbors(nodeId);
      console.log(`🔗 Node ${nodeId} currently has ${currentNeighbors.length} neighbors`);
      
      // Current GraphManager doesn't have getEdgeLoader method
      // The viewport loading should have loaded edges for visible nodes
      // For now, just return current neighbors
      return currentNeighbors;

    } catch (error) {
      console.error(`🔗 Error getting neighbors for ${nodeId}:`, error);
      return [];
    }
  }

  /**
   * 👥 Get current neighbors of a node
   */
  getNodeNeighbors(nodeId: string): string[] {
    if (!this.graph.hasNode(nodeId)) {
      return [];
    }
    return this.graph.neighbors(nodeId);
  }

  /**
   * ✅ Check if node is currently in the graph
   */
  isNodeInGraph(nodeId: string): boolean {
    return this.graph.hasNode(nodeId);
  }

  /**
   * 📍 Get node position in graph coordinates
   */
  getNodePosition(nodeId: string): { x: number; y: number } | null {
    if (!this.graph.hasNode(nodeId)) {
      console.warn(`🔍 Node ${nodeId} not found in graph`);
      return null;
    }

    const attrs = this.graph.getNodeAttributes(nodeId);
    console.log(`🔍 Node ${nodeId} attributes:`, attrs);
    
    // Ensure we have valid coordinates
    if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') {
      console.warn(`🔍 Invalid coordinates for node ${nodeId}:`, attrs);
      return null;
    }

    return {
      x: attrs.x,
      y: attrs.y
    };
  }

  /**
   * 🎯 Center viewport on a specific node
   */
  async centerViewportOnNode(nodeId: string): Promise<void> {
    console.log(`🔗 Centering viewport on node ${nodeId}`);

    // Ensure node is loaded first
    await this.ensureNodeLoaded(nodeId);

    const position = this.getNodePosition(nodeId);
    if (!position) {
      throw new Error(`Cannot center on node ${nodeId}: no position data`);
    }

    // Use Sigma's camera to animate to the node
    const camera = this.sigma.getCamera();
    
    // Calculate appropriate zoom level for focus
    const currentZoom = camera.ratio;
    // Use a more moderate zoom level that won't trigger extreme LOD transitions
    const targetZoom = Math.min(currentZoom, 1.0); // Changed from 0.5 to 1.0

    // Quadratic easing function
    const easeInOutQuad = (t: number): number => {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    };

    // Get current camera state for logging
    const currentState = camera.getState();
    console.log(`🎯 Camera state before animation:`, currentState);
    console.log(`🎯 Target position in graph coordinates:`, position);

    // Get coordinate manager from services
    const coordinateManager = this.graphManager.getServices().resolve('CoordinateManager');
    if (!coordinateManager) {
      throw new Error('CoordinateManager service not found');
    }
    const coordinateScale = coordinateManager.getCoordinateScale();
    console.log(`🎯 Using coordinate scale: ${coordinateScale}`);

    // Convert position back to database coordinates for animation
    const dbPosition = coordinateManager.toDbCoords(position.x, position.y);
    console.log(`🎯 Coordinate transformation:`, {
      graphCoords: position,
      dbCoords: dbPosition,
      scale: coordinateScale,
      currentZoom,
      targetZoom
    });

    // Animate camera to node position (using database coordinates)
    camera.animate(
      { 
        x: dbPosition.x, 
        y: dbPosition.y, 
        ratio: targetZoom 
      },
      { 
        duration: 1000,
        easing: easeInOutQuad
      }
    );

    // Get new camera state for verification
    const newState = camera.getState();
    console.log(`🎯 Camera state after animation:`, newState);
    console.log(`🔗 Viewport centered on node ${nodeId} at DB coords (${dbPosition.x}, ${dbPosition.y})`);
  }

  /**
   * 🔄 Update search results with current graph state
   */
  updateSearchResultsWithGraphState(results: SearchResult[]): SearchResult[] {
    return results.map(result => ({
      ...result,
      isInCurrentGraph: this.isNodeInGraph(result.nodeId),
      coordinates: this.getNodePosition(result.nodeId) || result.coordinates
    }));
  }

  /**
   * 🎯 Handle search result selection
   */
  async handleSearchResultSelection(result: SearchResult): Promise<void> {
    console.log(`🔗 Handling selection of search result: ${result.title}`);

    try {
      // 1. Ensure the node is loaded
      await this.ensureNodeLoaded(result.nodeId);

      // 2. Load neighbors for better context
      await this.ensureNeighborsLoaded(result.nodeId, 1);

      // 3. Center viewport on the node
      await this.centerViewportOnNode(result.nodeId);

      console.log(`🔗 Successfully handled selection of ${result.nodeId}`);

    } catch (error) {
      console.error(`🔗 Error handling search result selection:`, error);
      
      // Provide more specific error messages based on the error type
      if (error instanceof Error) {
        if (error.message.includes('CoordinateManager service not found') ||
            error.message.includes('NodeService not found') ||
            error.message.includes('EdgeService not found')) {
          throw new Error('Internal graph services not properly initialized. Please refresh the page.');
        } else if (error.message.includes('Node API error') || 
                   error.message.includes('Edge API error')) {
          throw new Error('Failed to fetch node data from server. Please try again.');
        } else if (error.message.includes('Invalid coordinates')) {
          throw new Error('Node position data is invalid. Please try selecting a different node.');
        } else if (error.message.includes('not found')) {
          throw new Error('Selected node was not found in the database.');
        }
      }
      
      // If no specific error message matches, throw a generic error
      throw new Error('Failed to select search result. Please try again.');
    }
  }

  /**
   * 🔍 Find nodes in current viewport that match search criteria
   */
  findNodesInViewport(searchQuery: string): string[] {
    const viewportBounds = this.graphManager.getViewportBounds();
    
    const matchingNodes: string[] = [];
    
    this.graph.nodes().forEach((nodeId: string) => {
      const attrs = this.graph.getNodeAttributes(nodeId);
      
      // Check if node is in viewport
      if (attrs.x >= viewportBounds.minX && attrs.x <= viewportBounds.maxX &&
          attrs.y >= viewportBounds.minY && attrs.y <= viewportBounds.maxY) {
        
        // Check if node title matches search (simple contains check)
        const title = attrs.title || attrs.label || '';
        if (title.toLowerCase().includes(searchQuery.toLowerCase())) {
          matchingNodes.push(nodeId);
        }
      }
    });

    return matchingNodes;
  }

  /**
   * 📊 Get statistics about search results vs graph state
   */
  getSearchGraphStats(results: SearchResult[]): {
    totalResults: number;
    resultsInGraph: number;
    resultsNotInGraph: number;
    resultsInViewport: number;
  } {
    const viewportBounds = this.graphManager.getViewportBounds();
    
    let resultsInGraph = 0;
    let resultsInViewport = 0;

    results.forEach(result => {
      if (this.isNodeInGraph(result.nodeId)) {
        resultsInGraph++;
        
        const position = this.getNodePosition(result.nodeId);
        if (position && 
            position.x >= viewportBounds.minX && position.x <= viewportBounds.maxX &&
            position.y >= viewportBounds.minY && position.y <= viewportBounds.maxY) {
          resultsInViewport++;
        }
      }
    });

    return {
      totalResults: results.length,
      resultsInGraph,
      resultsNotInGraph: results.length - resultsInGraph,
      resultsInViewport
    };
  }

  /**
   * 🔄 Refresh search results after graph changes
   */
  async refreshSearchResults(currentResults: SearchResult[]): Promise<SearchResult[]> {
    console.log('🔗 Refreshing search results after graph changes');
    
    // Update all results with current graph state
    const updatedResults = this.updateSearchResultsWithGraphState(currentResults);
    
    // Sort to prioritize results that are now in the graph
    updatedResults.sort((a, b) => {
      if (a.isInCurrentGraph && !b.isInCurrentGraph) return -1;
      if (!a.isInCurrentGraph && b.isInCurrentGraph) return 1;
      return b.relevanceScore - a.relevanceScore; // Then by relevance
    });

    return updatedResults;
  }

  /**
   * 🎯 Batch load multiple search results
   */
  async batchLoadSearchResults(results: SearchResult[], maxToLoad: number = 10): Promise<string[]> {
    console.log(`🔗 Batch loading up to ${maxToLoad} search results`);

    const nodesToLoad = results
      .filter(result => !this.isNodeInGraph(result.nodeId))
      .slice(0, maxToLoad)
      .map(result => result.nodeId);

    const loadedNodes: string[] = [];
    
    // Load nodes in parallel
    const loadPromises = nodesToLoad.map(async (nodeId) => {
      const success = await this.ensureNodeLoaded(nodeId);
      if (success) {
        loadedNodes.push(nodeId);
      }
      return success;
    });

    await Promise.all(loadPromises);
    
    console.log(`🔗 Batch loaded ${loadedNodes.length}/${nodesToLoad.length} nodes`);
    return loadedNodes;
  }

  /**
   * 🧹 Cleanup search-related graph state
   */
  cleanup(): void {
    // Clear any search-specific graph state
    // This would be called when search is closed or reset
    console.log('🔗 Cleaning up search coordinator state');
  }

  /**
   * 📈 Get performance metrics for search-graph integration
   */
  getPerformanceMetrics(): {
    nodesInGraph: number;
    edgesInGraph: number;
    viewportNodeCount: number;
    memoryUsage: any;
  } {
    // Current GraphManager doesn't have getViewportCalculator or getNodeMemoryManager
    // Return basic metrics from graph directly
    return {
      nodesInGraph: this.graph.nodes().length,
      edgesInGraph: this.graph.edges().length,
      viewportNodeCount: this.graph.nodes().length, // Approximation
      memoryUsage: {
        totalNodes: this.graph.nodes().length,
        totalEdges: this.graph.edges().length
      }
    };
  }
} 