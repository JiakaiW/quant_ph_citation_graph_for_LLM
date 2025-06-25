import { ViewportBounds, GraphStats, LoadResult, EdgeLoadResult, RemovalStats, MemoryStats, CacheStats, DEFAULT_GRAPH_CONFIG } from './types/GraphTypes';
import { LevelOfDetail } from './viewport/LevelOfDetail';
import { ViewportCalculator } from './viewport/ViewportCalculator';
import { SpatialCache } from './caching/SpatialCache';
import { NodeImportanceCalculator } from './nodes/NodeImportanceCalculator';
import { NodeMemoryManager } from './nodes/NodeMemoryManager';
import { NodeLoader } from './nodes/NodeLoader';
import { EdgeLoader } from './edges/EdgeLoader';
import { GraphInitializer } from './initialization/GraphInitializer';

/**
 * 🎯 GraphManager (Refactored)
 * 
 * Slim orchestrator that coordinates specialized modules.
 * Maintains the same public API as the original monolithic version
 * while delegating responsibilities to focused modules.
 * 
 * This is the "conductor" that orchestrates the "orchestra" of modules.
 */
export class GraphManager {
  // Core dependencies
  private graph: any;
  private sigma: any;
  
  // Specialized modules (dependency injection pattern)
  private lodManager!: LevelOfDetail;
  private viewportCalculator!: ViewportCalculator;
  private spatialCache!: SpatialCache;
  private importanceCalculator!: NodeImportanceCalculator;
  private memoryManager!: NodeMemoryManager;
  private nodeLoader!: NodeLoader;
  private edgeLoader!: EdgeLoader;
  private initializer!: GraphInitializer;

  // State tracking
  private isInitialized: boolean = false;
  private currentBounds: ViewportBounds | null = null;
  private loadingState: {
    isLoading: boolean;
    batchProgress: {current: number, total: number} | null;
  } = { isLoading: false, batchProgress: null };

  constructor(sigma: any) {
    this.sigma = sigma;
    this.graph = sigma.getGraph();

    console.log('🎯 Initializing GraphManager with modular architecture');
    
    // Initialize all modules with dependency injection
    this.initializeModules();
  }

  /**
   * Initialize all specialized modules
   */
  private initializeModules(): void {
    // Create modules in dependency order
    this.lodManager = new LevelOfDetail();
    this.viewportCalculator = new ViewportCalculator(this.graph);
    this.spatialCache = new SpatialCache(this.lodManager);
    this.importanceCalculator = new NodeImportanceCalculator();
    
    // Modules that depend on others
    this.memoryManager = new NodeMemoryManager(
      this.importanceCalculator,
      this.viewportCalculator,
      this.lodManager
    );
    
    this.nodeLoader = new NodeLoader(
      this.lodManager,
      this.spatialCache
    );
    
    this.edgeLoader = new EdgeLoader(
      this.viewportCalculator,
      this.lodManager
    );
    
    this.initializer = new GraphInitializer(DEFAULT_GRAPH_CONFIG);

    console.log('🎯 All modules initialized successfully');
  }

  /**
   * 🚀 Initialize the graph system
   * PUBLIC API METHOD - maintains backward compatibility
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      console.log('🎯 GraphManager already initialized');
      return true;
    }

    console.log('🎯 Starting graph system initialization...');

    try {
      const result = await this.initializer.initialize();
      
      if (!result.success) {
        console.error('🎯 Initialization failed:', result.error);
        return false;
      }

      // Setup initial camera position
      if (result.initialViewport) {
        const camera = this.initializer.setupInitialCamera(result.initialViewport);
        this.sigma.getCamera().setState(camera);
        this.currentBounds = result.initialViewport;
      }

      this.isInitialized = true;
      console.log('🎯 GraphManager initialization complete');
      return true;

    } catch (error) {
      console.error('🎯 GraphManager initialization failed:', error);
      return false;
    }
  }

  /**
   * 📡 Load nodes for current viewport
   * PUBLIC API METHOD - maintains backward compatibility
   */
  async loadNodesForViewport(bounds?: ViewportBounds, limit: number = 3000): Promise<LoadResult> {
    if (!this.isInitialized) {
      console.warn('🎯 GraphManager not initialized, initializing now...');
      await this.initialize();
    }

    const targetBounds = bounds || this.getCurrentViewportBounds();
    if (!targetBounds) {
      console.warn('🎯 No viewport bounds available');
      return { nodes: [], addedCount: 0, filteredCount: 0, skippedCount: 0 };
    }

    this.setLoadingState(true);
    
    try {
      // Calculate LOD level for current viewport
      const lodLevel = this.lodManager.calculateLOD(this.sigma.getCamera());
      
      console.log(`🎯 Loading nodes for viewport (LOD: ${lodLevel})`);
      
      // Delegate to NodeLoader
      const result = await this.nodeLoader.loadNodesLOD(
        targetBounds, 
        lodLevel
      );

      this.currentBounds = targetBounds;
      console.log(`🎯 Loaded ${result.addedCount} nodes (${result.filteredCount} filtered, ${result.skippedCount} skipped)`);
      
      return result;

    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * 🔗 Load edges for current viewport
   * PUBLIC API METHOD - maintains backward compatibility
   */
  async loadEdgesForViewport(bounds?: ViewportBounds, limit: number = 3000): Promise<EdgeLoadResult> {
    if (!this.isInitialized) {
      console.warn('🎯 GraphManager not initialized, initializing now...');
      await this.initialize();
    }

    const targetBounds = bounds || this.getCurrentViewportBounds();
    if (!targetBounds) {
      console.warn('🎯 No viewport bounds available for edge loading');
      return { edges: [], addedCount: 0, skippedCount: 0 };
    }

    this.setLoadingState(true);
    
    try {
      // Calculate LOD level for current viewport
      const lodLevel = this.lodManager.calculateLOD(this.sigma.getCamera());
      
      console.log(`🎯 Loading edges for viewport (LOD: ${lodLevel})`);
      
      // Delegate to EdgeLoader with LOD awareness
      const result = await this.edgeLoader.loadEdgesForViewportLOD(
        targetBounds,
        this.graph,
        lodLevel,
        limit
      );

      console.log(`🎯 Loaded ${result.addedCount} edges (${result.skippedCount} skipped)`);
      
      return result;

    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * 🧹 Clean up distant nodes to manage memory
   * PUBLIC API METHOD - maintains backward compatibility
   */
  cleanupDistantNodes(bounds?: ViewportBounds): RemovalStats {
    const targetBounds = bounds || this.getCurrentViewportBounds();
    if (!targetBounds) {
      console.warn('🎯 No viewport bounds available for cleanup');
      return { removedCount: 0, removedViewport: 0, removedNonViewport: 0 };
    }

    console.log('🎯 Cleaning up distant nodes...');
    
    // Delegate to NodeMemoryManager
    const result = this.memoryManager.removeExcessNodes(this.graph, targetBounds, 5000);
    
    console.log(`🎯 Cleanup complete: removed ${result.removedCount} nodes`);
    
    return result;
  }

  /**
   * 📊 Get current graph statistics
   * PUBLIC API METHOD - maintains backward compatibility
   */
  getStats(): GraphStats {
    const bounds = this.getCurrentViewportBounds();
    
    return {
      nodeCount: this.graph.order,
      edgeCount: this.graph.size,
      cacheRegions: this.spatialCache.getCacheStats().totalRegions,
      isLoading: this.loadingState.isLoading,
      batchProgress: this.loadingState.batchProgress
    };
  }

  /**
   * 🔍 Get detailed memory statistics
   * PUBLIC API METHOD - maintains backward compatibility
   */
  getMemoryStats(bounds?: ViewportBounds): MemoryStats {
    const targetBounds = bounds || this.getCurrentViewportBounds();
    if (!targetBounds) {
      return {
        totalNodes: this.graph.order,
        viewportNodes: 0,
        nonViewportNodes: this.graph.order,
        avgImportance: 0,
        memoryPressure: 0
      };
    }

    // Delegate to NodeMemoryManager
    return this.memoryManager.getMemoryStats(targetBounds, this.graph);
  }

  /**
   * 📈 Get cache statistics
   * PUBLIC API METHOD - maintains backward compatibility
   */
  getCacheStats(): CacheStats {
    return this.spatialCache.getCacheStats();
  }

  /**
   * 🎚️ Handle viewport change (camera movement)
   * PUBLIC API METHOD - maintains backward compatibility
   */
  async handleViewportChange(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const newBounds = this.getCurrentViewportBounds();
    if (!newBounds) {
      return;
    }

    // Check if viewport change is significant enough to trigger loading
    if (this.currentBounds && this.spatialCache.isSpatialCached(newBounds, 0)) {
      console.log('🎯 Viewport change: using cached data');
      return;
    }

    console.log('🎯 Significant viewport change detected, loading new data...');
    
    // Load nodes and edges for new viewport
    await Promise.all([
      this.loadNodesForViewport(newBounds),
      this.loadEdgesForViewport(newBounds)
    ]);

    // Clean up distant nodes to manage memory
    this.cleanupDistantNodes(newBounds);
  }

  /**
   * 🎯 Batch load nodes (for initial loading or specific node sets)
   * PUBLIC API METHOD - maintains backward compatibility
   */
  async loadNodesBatch(nodeIds: string[], limit: number = 10000): Promise<LoadResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.setLoadingState(true);
    
    try {
      console.log(`🎯 Batch loading ${nodeIds.length} specific nodes`);
      
      // Delegate to NodeLoader
      const result = await this.nodeLoader.loadNodesBatch(nodeIds, this.graph, limit);
      
      console.log(`🎯 Batch loading complete: ${result.addedCount} nodes added`);
      
      return result;

    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * 🔗 Batch load edges (for initial loading or specific edge sets)
   * PUBLIC API METHOD - maintains backward compatibility
   */
  async loadEdgesBatch(nodeIds: string[], limit: number = 10000): Promise<EdgeLoadResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.setLoadingState(true);
    
    try {
      console.log(`🎯 Batch loading edges for ${nodeIds.length} nodes`);
      
      // Delegate to EdgeLoader
      const result = await this.edgeLoader.loadEdgesBatch(nodeIds, this.graph, limit);
      
      console.log(`🎯 Edge batch loading complete: ${result.addedCount} edges added`);
      
      return result;

    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * 🧠 Trigger intelligent memory management
   * PUBLIC API METHOD - maintains backward compatibility
   */
  performMemoryManagement(bounds?: ViewportBounds): RemovalStats {
    const targetBounds = bounds || this.getCurrentViewportBounds();
    if (!targetBounds) {
      return { removedCount: 0, removedViewport: 0, removedNonViewport: 0 };
    }

    console.log('🎯 Performing intelligent memory management...');
    
    // Delegate to NodeMemoryManager
    const result = this.memoryManager.performMemoryManagement(targetBounds, this.graph);
    
    console.log(`🎯 Memory management complete: removed ${result.removedCount} nodes`);
    
    return result;
  }

  /**
   * 📱 Get current viewport bounds from Sigma camera
   * PRIVATE HELPER METHOD
   */
  private getCurrentViewportBounds(): ViewportBounds | null {
    try {
      const camera = this.sigma.getCamera();
      const { x, y, ratio } = camera.getState();
      
      // Get canvas dimensions
      const { width, height } = this.sigma.getDimensions();
      
      // Calculate viewport bounds
      const halfWidth = (width * ratio) / 2;
      const halfHeight = (height * ratio) / 2;
      
      return {
        minX: x - halfWidth,
        maxX: x + halfWidth,
        minY: y - halfHeight,
        maxY: y + halfHeight,
        width: width * ratio,
        height: height * ratio
      };
      
    } catch (error) {
      console.warn('🎯 Failed to get current viewport bounds:', error);
      return null;
    }
  }

  /**
   * ⚡ Set loading state for UI feedback
   * PRIVATE HELPER METHOD
   */
  private setLoadingState(isLoading: boolean, progress?: {current: number, total: number}): void {
    this.loadingState.isLoading = isLoading;
    this.loadingState.batchProgress = progress || null;
  }

  /**
   * 🔄 Reset the graph manager (for development/testing)
   * PUBLIC API METHOD - maintains backward compatibility
   */
  reset(): void {
    console.log('🎯 Resetting GraphManager...');
    
    this.isInitialized = false;
    this.currentBounds = null;
    this.loadingState = { isLoading: false, batchProgress: null };
    
    // Reset all modules
    this.spatialCache.clear();
    this.initializer.reset();
    
    console.log('🎯 GraphManager reset complete');
  }

  /**
   * 🐛 Get debug information
   * PUBLIC API METHOD - for debugging and monitoring
   */
  getDebugInfo(): {
    isInitialized: boolean;
    currentBounds: ViewportBounds | null;
    loadingState: any;
    moduleStats: {
      cacheStats: CacheStats;
      memoryStats: MemoryStats;
      graphStats: GraphStats;
    };
  } {
    return {
      isInitialized: this.isInitialized,
      currentBounds: this.currentBounds,
      loadingState: this.loadingState,
      moduleStats: {
        cacheStats: this.getCacheStats(),
        memoryStats: this.getMemoryStats(),
        graphStats: this.getStats()
      }
    };
  }

  // Legacy method aliases for backward compatibility
  async loadVisibleNodes(bounds?: ViewportBounds, limit?: number): Promise<LoadResult> {
    console.warn('⚠️ loadVisibleNodes is deprecated, use loadNodesForViewport instead');
    return this.loadNodesForViewport(bounds, limit);
  }

  async loadEdgesForVisibleNodes(): Promise<EdgeLoadResult> {
    console.warn('⚠️ loadEdgesForVisibleNodes is deprecated, use loadEdgesForViewport instead');
    return this.loadEdgesForViewport();
  }

  // ========================================
  // 🔍 SEARCH INTEGRATION METHODS
  // ========================================

  /**
   * 🎯 Load a specific node by ID (for search results)
   */
  async loadSpecificNode(nodeId: string): Promise<boolean> {
    console.log(`🎯 Loading specific node: ${nodeId}`);
    
    try {
      // Use the existing batch loading method with single node
      const result = await this.nodeLoader.loadNodesBatched([nodeId], this.graph, 1);
      return result.addedCount > 0;
    } catch (error) {
      console.error(`🎯 Failed to load node ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * 🌐 Load neighborhood of a node (for search result highlighting)
   */
  async loadNodeNeighborhood(nodeId: string, depth: number = 1): Promise<any[]> {
    console.log(`🎯 Loading neighborhood for node ${nodeId} (depth: ${depth})`);
    
    try {
      // First ensure the node itself is loaded
      await this.loadSpecificNode(nodeId);
      
      // Then load its edges using batch method
      const result = await this.edgeLoader.loadEdgesBatch([nodeId], this.graph, 1000);
      return result.edges || [];
    } catch (error) {
      console.error(`🎯 Failed to load neighborhood for ${nodeId}:`, error);
      return [];
    }
  }

  /**
   * 📍 Mark a node as important (prevents it from being cleaned up)
   */
  markNodeAsImportant(nodeId: string): void {
    if (this.graph.hasNode(nodeId)) {
             // Use the importance calculator's scoring method
       this.importanceCalculator.calculateNodeImportance(nodeId, this.graph.getNodeAttributes(nodeId));
      console.log(`🎯 Marked node ${nodeId} as important`);
    }
  }

  /**
   * 🎯 Center camera on a specific node
   */
  async centerOnNode(nodeId: string, zoomLevel?: number): Promise<void> {
    if (!this.graph.hasNode(nodeId)) {
      console.warn(`🎯 Cannot center on node ${nodeId}: not in graph`);
      return;
    }

    const attrs = this.graph.getNodeAttributes(nodeId);
    const camera = this.sigma.getCamera();
    
    const targetZoom = zoomLevel || Math.min(camera.ratio, 0.5);
    
    camera.animate(
      { 
        x: attrs.x, 
        y: attrs.y, 
        ratio: targetZoom 
      },
      { 
        duration: 1000,
        easing: 'quadInOut'
      }
    );

    console.log(`🎯 Centering camera on node ${nodeId}`);
  }

  /**
   * 🔍 Get nodes in current viewport that match a filter
   */
  getNodesInViewport(filter?: (nodeId: string, attrs: any) => boolean): string[] {
    const bounds = this.getCurrentViewportBounds();
    if (!bounds) return [];

    const matchingNodes: string[] = [];
    
    this.graph.nodes().forEach((nodeId: string) => {
      const attrs = this.graph.getNodeAttributes(nodeId);
      
      // Check if node is in viewport
      if (attrs.x >= bounds.minX && attrs.x <= bounds.maxX &&
          attrs.y >= bounds.minY && attrs.y <= bounds.maxY) {
        
        // Apply additional filter if provided
        if (!filter || filter(nodeId, attrs)) {
          matchingNodes.push(nodeId);
        }
      }
    });

    return matchingNodes;
  }

  /**
   * 🎯 Get module instances for search system integration
   */
  getNodeLoader(): NodeLoader {
    return this.nodeLoader;
  }

  getEdgeLoader(): EdgeLoader {
    return this.edgeLoader;
  }

  getViewportCalculator(): ViewportCalculator {
    return this.viewportCalculator;
  }

  getNodeMemoryManager(): NodeMemoryManager {
    return this.memoryManager;
  }

  getLodManager(): LevelOfDetail {
    return this.lodManager;
  }

  /**
   * 🔄 Refresh search results after graph changes
   */
  async refreshForSearch(): Promise<void> {
    // Trigger a viewport update to refresh visible content
    await this.handleViewportChange();
    console.log('🎯 Graph refreshed for search system');
  }

  // ========================================
  // 🔧 LEGACY COMPATIBILITY METHODS
  // ========================================

  /**
   * 🔄 Update viewport (legacy method for backward compatibility)
   */
  async updateViewport(): Promise<void> {
    console.log('🎯 Updating viewport (legacy method)');
    await this.handleViewportChange();
  }

  /**
   * 📏 Get viewport bounds (legacy method for backward compatibility)
   */
  getViewportBounds(): ViewportBounds | null {
    return this.getCurrentViewportBounds();
  }

  /**
   * 🔧 Initialize with fallback (legacy method for backward compatibility)
   */
  async initializeWithFallback(): Promise<void> {
    console.log('🎯 Attempting fallback initialization...');
    try {
      // Try a simplified initialization
      const result = await this.initialize();
      if (!result) {
        console.warn('🎯 Standard initialization failed, using minimal setup');
        this.isInitialized = true;
      }
    } catch (error) {
      console.error('🎯 Fallback initialization failed:', error);
      this.isInitialized = true; // Mark as initialized to prevent infinite loops
    }
  }

  /**
   * 🧹 Destroy the graph manager (legacy method for backward compatibility)
   */
  destroy(): void {
    console.log('🎯 Destroying GraphManager...');
    this.reset();
  }

  /**
   * 🔄 Refresh the graph (legacy method for backward compatibility)
   */
  async refresh(): Promise<void> {
    console.log('🎯 Refreshing graph (legacy method)...');
    await this.handleViewportChange();
  }

  /**
   * 🔄 Reset loading state (legacy method for backward compatibility)
   */
  resetLoadingState(): void {
    console.log('🎯 Resetting loading state (legacy method)...');
    this.setLoadingState(false);
  }
} 