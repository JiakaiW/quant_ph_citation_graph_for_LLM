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
   * 🎯 Ensure a search result node is loaded in the graph
   */
  async ensureNodeLoaded(nodeId: string): Promise<boolean> {
    console.log(`🔗 Ensuring node ${nodeId} is loaded`);

    // Check if node is already in graph
    if (this.graph.hasNode(nodeId)) {
      console.log(`🔗 Node ${nodeId} already loaded`);
      return true;
    }

    try {
      // Use GraphManager's node loader to fetch the node
      const nodeLoader = this.graphManager.getNodeLoader();
      const success = await nodeLoader.loadSpecificNode(nodeId);
      
      if (success) {
        console.log(`🔗 Successfully loaded node ${nodeId}`);
        return true;
      } else {
        console.warn(`🔗 Failed to load node ${nodeId}`);
        return false;
      }
    } catch (error) {
      console.error(`🔗 Error loading node ${nodeId}:`, error);
      return false;
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

    const loadedNeighbors: string[] = [];

    try {
      // Get current neighbors
      const currentNeighbors = this.graph.neighbors(nodeId);
      
      // Use GraphManager's edge loader to fetch neighboring edges
      const edgeLoader = this.graphManager.getEdgeLoader();
      const newEdges = await edgeLoader.loadNodeNeighborhood(nodeId, depth);
      
      // Track newly loaded neighbors
      newEdges.forEach((edge: any) => {
        const [source, target] = [edge.source, edge.target];
        if (source !== nodeId && this.graph.hasNode(source)) {
          loadedNeighbors.push(source);
        }
        if (target !== nodeId && this.graph.hasNode(target)) {
          loadedNeighbors.push(target);
        }
      });

      console.log(`🔗 Loaded ${loadedNeighbors.length} new neighbors for ${nodeId}`);
      return [...currentNeighbors, ...loadedNeighbors];

    } catch (error) {
      console.error(`🔗 Error loading neighbors for ${nodeId}:`, error);
      return this.graph.neighbors(nodeId) || [];
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
      return null;
    }

    const attrs = this.graph.getNodeAttributes(nodeId);
    return {
      x: attrs.x || 0,
      y: attrs.y || 0
    };
  }

  /**
   * 🎯 Center viewport on a specific node
   */
  async centerViewportOnNode(nodeId: string): Promise<void> {
    console.log(`🔗 Centering viewport on node ${nodeId}`);

    // Ensure node is loaded first
    const isLoaded = await this.ensureNodeLoaded(nodeId);
    if (!isLoaded) {
      throw new Error(`Cannot center on node ${nodeId}: failed to load`);
    }

    const position = this.getNodePosition(nodeId);
    if (!position) {
      throw new Error(`Cannot center on node ${nodeId}: no position data`);
    }

    // Use Sigma's camera to animate to the node
    const camera = this.sigma.getCamera();
    
    // Calculate appropriate zoom level for focus
    const currentZoom = camera.ratio;
    const targetZoom = Math.min(currentZoom, 0.5); // Zoom in for better focus

    // Animate camera to node position
    camera.animate(
      { 
        x: position.x, 
        y: position.y, 
        ratio: targetZoom 
      },
      { 
        duration: 1000,
        easing: 'quadInOut'
      }
    );

    console.log(`🔗 Viewport centered on node ${nodeId} at (${position.x}, ${position.y})`);
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
      const isLoaded = await this.ensureNodeLoaded(result.nodeId);
      if (!isLoaded) {
        throw new Error(`Failed to load node ${result.nodeId}`);
      }

      // 2. Load neighbors for better context
      await this.ensureNeighborsLoaded(result.nodeId, 1);

      // 3. Center viewport on the node
      await this.centerViewportOnNode(result.nodeId);

      // 4. Update GraphManager's state if needed
      const viewportCalculator = this.graphManager.getViewportCalculator();
      viewportCalculator.markNodeAsImportant(result.nodeId);

      console.log(`🔗 Successfully handled selection of ${result.nodeId}`);

    } catch (error) {
      console.error(`🔗 Error handling search result selection:`, error);
      throw error;
    }
  }

  /**
   * 🔍 Find nodes in current viewport that match search criteria
   */
  findNodesInViewport(searchQuery: string): string[] {
    const viewportCalculator = this.graphManager.getViewportCalculator();
    const viewportBounds = viewportCalculator.getViewportBounds();
    
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
    const viewportCalculator = this.graphManager.getViewportCalculator();
    const viewportBounds = viewportCalculator.getViewportBounds();
    
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
    const viewportCalculator = this.graphManager.getViewportCalculator();
    const memoryManager = this.graphManager.getNodeMemoryManager();
    
    return {
      nodesInGraph: this.graph.nodes().length,
      edgesInGraph: this.graph.edges().length,
      viewportNodeCount: viewportCalculator.getViewportNodeCount(),
      memoryUsage: memoryManager.getMemoryStats()
    };
  }
} 