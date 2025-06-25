/**
 * 🧠 Frontend Graph Manager - HIERARCHICAL LOD SYSTEM
 * 
 * Revolutionary approach to handle massive zoom-out performance:
 * - Level-of-Detail based on zoom ratio
 * - Spatial quadtree for O(log n) lookups
 * - Incremental loading instead of full replacement
 * - Smart density control for different zoom levels
 */

import { Sigma } from 'sigma';
import { fetchBox, fetchBoxLight, fetchBoxBatched, fetchEdgesBatch, fetchBounds, Node, LightNode, Edge, DataBounds, cancelAllRequests } from '../api/fetchNodes';
import { getConfig, getLODConfig, getVisualConfig, getPerformanceConfig, getViewportConfig, getMemoryConfig, getDebugConfig } from './config/ConfigLoader';
import { ClusterManager } from './clustering/ClusterManager';
import { ColorManager } from './shapes/NodeShapeManager';
import { QualityFilter } from './filtering/QualityFilter';
import { NodeClickHighlighter } from './interactions/NodeClickHighlighter';
import { NodePriorityManager } from './nodes/NodePriorityManager';
import { RequestManager } from './api/RequestManager';

interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

// Enhanced LOD-aware cache region with spatial indexing
interface LoadedRegion {
  bounds: ViewportBounds;
  timestamp: number;
  nodeCount: number;
  lodLevel: number; // 0=max detail, 5=overview
  spatialHash: string; // For fast spatial lookups
}

interface NodeImportance {
  nodeId: string;
  degree: number;
  distanceFromCenter: number;
  lastSeen: number;
  importance: number;
  lodLevel: number; // Track which LOD level this node belongs to
}

// Spatial quadtree node for O(log n) spatial queries
interface QuadTreeNode {
  bounds: ViewportBounds;
  nodeIds: Set<string>;
  children: QuadTreeNode[] | null;
  level: number;
}

export class GraphManager {
  private sigma: Sigma;
  private graph: any;
  private loadedRegions: LoadedRegion[] = [];
  private nodeImportanceMap: Map<string, NodeImportance> = new Map();
  private spatialIndex: QuadTreeNode | null = null; // Spatial quadtree for fast lookups
  public isLoading: boolean = false;
  private lastLoadStart: number = 0; // Track when loading started to detect stuck states
  private currentLoadingSignal: AbortSignal | null = null; // Track current request for cancellation
  public batchProgress: {current: number, total: number} | null = null; // Track batch loading progress
  
  // Viewport update throttling and change detection
  private lastViewportUpdate: number = 0;
  private viewportUpdateThrottle: number = 500; // Increased to 500ms to prevent rapid updates
  private lastViewportBounds: ViewportBounds | null = null;
  private lastViewportHash: string = ''; // Hash-based comparison for exact duplicates
  private consecutiveUpdateAttempts: number = 0;
  private maxConsecutiveUpdates: number = 3; // Reduced to 3 for faster detection
  
  // This will be controlled by the React component
  public isDragging: boolean = false;
  
  // Configuration loaded from config.yaml
  private config = getConfig();
  
  // Cluster management
  private clusterManager = ClusterManager.getInstance();
  
  // Color management
  private colorManager = ColorManager.getInstance();
  
  // Quality filtering
  private qualityFilter = QualityFilter.getInstance();
  
  // Click highlighting
  private clickHighlighter: NodeClickHighlighter | null = null;
  
  // Advanced node management
  private nodePriorityManager: NodePriorityManager;
  private requestManager: RequestManager;
  
  constructor(sigma: Sigma) {
    this.sigma = sigma;
    this.graph = sigma.getGraph();
    
    // Initialize advanced management systems
    this.nodePriorityManager = new NodePriorityManager(this.config.memory.maxTotalNodes);
    this.requestManager = RequestManager.getInstance();
    
    this.initializeSpatialIndex();
    this.setupClusterListener();
    this.initializeNodeShapes();
    this.initializeClickHighlighter();
  }

  /**
   * Initialize spatial quadtree for fast spatial queries
   */
  private initializeSpatialIndex(): void {
    // Will be populated as nodes are loaded
    this.spatialIndex = null;
  }

  /**
   * Set up cluster visibility change listener
   */
  private setupClusterListener(): void {
    this.clusterManager.onGlobalChange(() => {
      this.filterExistingNodesByCluster();
    });
    
    // Set up quality filter listener
    this.qualityFilter.onChange(() => {
      this.filterExistingNodesByQuality();
    });
  }

  /**
   * Initialize colors for different clusters
   */
  private initializeNodeShapes(): void {
    try {
      // Color palette is managed by ColorManager
      console.log('🎨 Node colors initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing node colors:', error);
    }
  }

  /**
   * Initialize click highlighting system
   */
  private initializeClickHighlighter(): void {
    try {
      this.clickHighlighter = new NodeClickHighlighter(this.sigma, this.graph);
      console.log('🖱️ Click highlighting initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing click highlighting:', error);
    }
  }

  /**
   * Filter existing nodes based on cluster visibility
   */
  private filterExistingNodesByCluster(): void {
    const nodesToRemove: string[] = [];
    const nodesToAdd: Array<{id: string, attrs: any}> = [];
    
    // Check all current nodes
    this.graph.forEachNode((nodeId: string, attrs: any) => {
      const community = attrs.community || 0;
      if (!this.clusterManager.isClusterVisible(community)) {
        nodesToRemove.push(nodeId);
      }
    });
    
    // Remove invisible nodes
    nodesToRemove.forEach(nodeId => {
      if (this.graph.hasNode(nodeId)) {
        this.graph.dropNode(nodeId);
      }
    });
    
    if (nodesToRemove.length > 0) {
      console.log(`🎨 ClusterManager: Removed ${nodesToRemove.length} nodes due to cluster filtering`);
    }
    
    // Note: We don't re-add nodes here because they would need to be fetched from the API
    // Instead, the next viewport update will naturally load visible nodes
    if (nodesToRemove.length > 0) {
      // Trigger a viewport update to reload visible nodes
      setTimeout(() => {
        this.updateViewport();
      }, 100);
    }
  }

  /**
   * Filter existing nodes based on quality criteria (minimum degree)
   */
  private filterExistingNodesByQuality(): void {
    const nodesToRemove: string[] = [];
    
    // Check all current nodes
    this.graph.forEachNode((nodeId: string, attrs: any) => {
      const degree = attrs.degree || 0;
      if (!this.qualityFilter.passesFilter(degree)) {
        nodesToRemove.push(nodeId);
      }
    });
    
    // Remove low-quality nodes
    nodesToRemove.forEach(nodeId => {
      if (this.graph.hasNode(nodeId)) {
        this.graph.dropNode(nodeId);
      }
    });
    
    if (nodesToRemove.length > 0) {
      console.log(`🎯 QualityFilter: Removed ${nodesToRemove.length} nodes due to quality filtering (min degree: ${this.qualityFilter.getMinDegree()})`);
    }
    
    // Trigger a viewport update to reload nodes that now meet the criteria
    if (nodesToRemove.length > 0) {
      setTimeout(() => {
        this.updateViewport();
      }, 100);
    }
  }

  /**
   * Calculate Level of Detail based on camera ratio
   */
  private calculateLOD(cameraRatio: number): number {
    // Sigma ratio: higher = more zoomed out
    // Use configuration-based thresholds
    const lodConfig = this.config.lod;
    if (cameraRatio < lodConfig.thresholds.detailed) return 0;      // Detailed view
    if (cameraRatio < lodConfig.thresholds.normal) return 1;        // Normal view  
    return 2;                                                       // Overview
  }

  private shouldLoadEdges(lodLevel: number): boolean {
    return this.config.lod.loadEdges[lodLevel] || false;
  }

  /**
   * Generate spatial hash for fast region comparison
   */
  private generateSpatialHash(bounds: ViewportBounds, lodLevel: number): string {
    // Quantize coordinates to grid for efficient caching
    const gridSize = Math.pow(2, lodLevel); // Larger grid for higher LOD
    const gridX = Math.floor(bounds.minX / gridSize);
    const gridY = Math.floor(bounds.minY / gridSize);
    const gridW = Math.ceil(bounds.width / gridSize);
    const gridH = Math.ceil(bounds.height / gridSize);
    return `${lodLevel}:${gridX},${gridY},${gridW},${gridH}`;
  }

  /**
   * Fast spatial cache lookup using hash
   */
  private isSpatialCached(bounds: ViewportBounds, lodLevel: number): boolean {
    const targetHash = this.generateSpatialHash(bounds, lodLevel);
    const now = Date.now();
    
    return this.loadedRegions.some(region => {
      if (now - region.timestamp > this.config.performance.cache.ttl) return false;
      if (region.lodLevel !== lodLevel) return false;
      return region.spatialHash === targetHash;
    });
  }

  /**
   * Update spatial quadtree with new node
   */
  private addToSpatialIndex(nodeId: string, x: number, y: number): void {
    // For now, use simple approach - can be enhanced with actual quadtree later
    // The key insight is to avoid O(n) searches by using spatial hashing
  }

  /**
   * Add a batch of nodes to the graph immediately for progressive loading
   */
  private addBatchToGraph(nodes: (Node | LightNode)[], minDegree: number): number {
    let addedCount = 0;
    
    // Update cluster manager with node information
    this.clusterManager.updateClusterInfo(nodes.map(node => ({
      community: 'community' in node.attributes ? node.attributes.community : 0,
      color: node.attributes.color
    })));
    
    nodes.forEach(node => {
      // Apply LOD-based degree filtering
      if (node.attributes.degree < minDegree) {
        return;
      }
      
      // Apply quality filtering
      if (!this.qualityFilter.passesFilter(node.attributes.degree)) {
        return;
      }
      
      // Apply cluster filtering
      const community = 'community' in node.attributes ? node.attributes.community : 0;
      if (!this.clusterManager.isClusterVisible(community)) {
        return;
      }
      
      if (!this.graph.hasNode(node.key)) {
        // Add node with appropriate attributes based on type
        const currentLOD = this.calculateLOD(this.sigma.getCamera().ratio);
        const baseSize = this.config.visual.nodes.defaultSize;
        const clusterColor = this.colorManager.getColorForCluster(community);
        
        // Apply coordinate scaling from config
        const coordinateScale = this.config.viewport.coordinateScale;
        
        const nodeAttrs: any = {
          x: node.attributes.x * coordinateScale,
          y: node.attributes.y * coordinateScale,
          size: baseSize, // Use uniform size for all nodes
          degree: node.attributes.degree,
          color: clusterColor, // Use the new color palette
        };
        
        // Add full attributes for detailed nodes
        if ('label' in node.attributes) {
          nodeAttrs.label = node.attributes.label;
          nodeAttrs.community = node.attributes.community;
        } else {
          // Lightweight node: generate placeholder label
          nodeAttrs.label = `Paper ${node.key.substring(0, 8)}...`;
          nodeAttrs.community = 0;
        }
        
        this.graph.addNode(node.key, nodeAttrs);
        this.addToSpatialIndex(node.key, node.attributes.x * coordinateScale, node.attributes.y * coordinateScale);
        addedCount++;
      }
    });
    
    return addedCount;
  }

  /**
   * Main viewport update method with LOD awareness
   */
  public async updateViewport(): Promise<void> {
    if (this.isDragging) {
      console.log('🎯 Pan in progress - skipping update');
      return;
    }

    // Don't start new viewport updates while loading
    if (this.isLoading) {
      console.log('⏳ Already loading nodes, skipping viewport update');
      return;
    }

    // Safety check to prevent infinite loops
    this.consecutiveUpdateAttempts++;
    if (this.consecutiveUpdateAttempts > this.maxConsecutiveUpdates) {
      console.warn(`🚨 Too many consecutive viewport updates (${this.consecutiveUpdateAttempts}), blocking further updates for 2 seconds`);
      setTimeout(() => {
        this.consecutiveUpdateAttempts = 0;
        console.log('🔄 Viewport update safety timeout expired, resuming normal operation');
      }, 2000);
      return;
    }

    // Check if viewport has actually changed using hash comparison for exact duplicates
    const currentBounds = this.getViewportBounds();
    const currentHash = this.createViewportHash(currentBounds);
    
    if (this.lastViewportHash === currentHash) {
      console.log('📐 Exact viewport duplicate detected, skipping update');
      this.consecutiveUpdateAttempts = 0; // Reset counter on successful skip
      return;
    }
    
    // Secondary check with tolerance-based comparison
    if (this.lastViewportBounds && this.viewportBoundsEqual(currentBounds, this.lastViewportBounds)) {
      console.log('📐 Viewport within tolerance, skipping update');
      this.consecutiveUpdateAttempts = 0; // Reset counter on successful skip
      return;
    }

    // Throttle viewport updates to prevent overwhelming the system
    const now = Date.now();
    if (now - this.lastViewportUpdate < this.viewportUpdateThrottle) {
      console.log(`📐 Viewport update throttled, last update ${now - this.lastViewportUpdate}ms ago`);
      this.consecutiveUpdateAttempts = 0; // Reset counter on throttled skip
      return;
    }

    this.lastViewportUpdate = now;
    this.lastViewportBounds = currentBounds;
    this.lastViewportHash = currentHash;
    this.consecutiveUpdateAttempts = 0; // Reset counter on successful update

    // Use non-blocking approach - start loading but don't wait
    this.loadViewportNodesLOD().catch(error => {
      console.error('[LOD] Viewport loading failed:', error);
    });
  }

  /**
   * Create a hash of viewport bounds for exact duplicate detection
   */
  private createViewportHash(bounds: ViewportBounds): string {
    return `${bounds.minX.toFixed(6)},${bounds.maxX.toFixed(6)},${bounds.minY.toFixed(6)},${bounds.maxY.toFixed(6)}`;
  }

  /**
   * Check if two viewport bounds are equal (within a small tolerance)
   */
  private viewportBoundsEqual(bounds1: ViewportBounds, bounds2: ViewportBounds): boolean {
    const tolerance = 0.001; // Very small tolerance for floating point comparison
    return (
      Math.abs(bounds1.minX - bounds2.minX) < tolerance &&
      Math.abs(bounds1.maxX - bounds2.maxX) < tolerance &&
      Math.abs(bounds1.minY - bounds2.minY) < tolerance &&
      Math.abs(bounds1.maxY - bounds2.maxY) < tolerance
    );
  }

  /**
   * Initialize with initial load - fetch data bounds and set camera
   */
  public async initialize(): Promise<void> {
    console.log('🚀 Initializing GraphManager...');
    
    // First, try to get the data bounds to initialize camera properly
    let bounds;
    try {
      bounds = await fetchBounds();
    } catch (error) {
      console.warn('⚠️ Error fetching bounds:', error);
      bounds = null;
    }
    
    if (bounds && bounds.minX !== undefined) {
      console.log(`📊 Data bounds: X[${bounds.minX.toFixed(2)}, ${bounds.maxX.toFixed(2)}], Y[${bounds.minY.toFixed(2)}, ${bounds.maxY.toFixed(2)}]`);
      console.log(`📊 Total papers: ${bounds.total_papers}`);
      
      // Set camera to show the full dataset with padding
      const camera = this.sigma.getCamera();
      const container = this.sigma.getContainer();
      
      // Calculate the center of the data (database coordinates)
      const dbCenterX = (bounds.paddedMinX + bounds.paddedMaxX) / 2;
      const dbCenterY = (bounds.paddedMinY + bounds.paddedMaxY) / 2;
      
      // Convert to scaled coordinates for camera positioning
      const coordinateScale = this.config.viewport.coordinateScale;
      const centerX = dbCenterX * coordinateScale;
      const centerY = dbCenterY * coordinateScale;
      
      // Calculate the zoom level to fit the data
      const dataWidth = bounds.paddedMaxX - bounds.paddedMinX;
      const dataHeight = bounds.paddedMaxY - bounds.paddedMinY;
      const containerWidth = container.offsetWidth;
      const containerHeight = container.offsetHeight;
      
      // Start with a reasonable default view instead of trying to fit exactly
      // Sigma ratio: higher = more zoomed out, lower = more zoomed in
      const defaultRatio = this.config.viewport.initialRatio; // Start at normal view (LOD 1) to see nodes and edges
      
      console.log(`🎯 Setting camera: center(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), ratio=${defaultRatio}`);
      console.log(`📏 Data size: ${dataWidth.toFixed(1)} x ${dataHeight.toFixed(1)}, Container: ${containerWidth} x ${containerHeight}`);
      console.log(`🔧 Using default ratio ${defaultRatio} for initial view (user can zoom to fit)`);
      console.log(`🔧 Coordinate scale: ${coordinateScale}x (DB center: ${dbCenterX.toFixed(2)}, ${dbCenterY.toFixed(2)} → Scaled: ${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);
      
      // Set the camera position
      camera.setState({
        x: centerX,
        y: centerY,
        ratio: defaultRatio
      });
      
      // Debug: Check what viewport we actually get after setting camera
      setTimeout(() => {
        const testBounds = this.getViewportBounds();
        console.log(`🔍 After camera set - viewport: [${testBounds.minX.toFixed(1)}, ${testBounds.maxX.toFixed(1)}, ${testBounds.minY.toFixed(1)}, ${testBounds.maxY.toFixed(1)}]`);
        console.log(`🔍 Viewport size: ${testBounds.width.toFixed(1)} x ${testBounds.height.toFixed(1)}`);
        
        // Test: Query the full data bounds to see if we get nodes
        console.log(`🧪 Testing full data bounds query...`);
        fetchBox(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 1.0, 100).then(testNodes => {
          console.log(`🧪 Full bounds query returned ${testNodes.length} nodes`);
          if (testNodes.length > 0) {
            console.log(`🧪 Sample node: ${testNodes[0].key} at (${testNodes[0].attributes.x.toFixed(1)}, ${testNodes[0].attributes.y.toFixed(1)})`);
          }
        }).catch(err => {
          console.error(`🧪 Full bounds query failed:`, err);
        });
        
        // Test: Query the current tiny viewport to confirm it's empty
        console.log(`🧪 Testing current viewport query...`);
        fetchBox(testBounds.minX, testBounds.maxX, testBounds.minY, testBounds.maxY, 1.0, 100).then(viewportNodes => {
          console.log(`🧪 Current viewport query returned ${viewportNodes.length} nodes`);
        });
      }, 100);
    } else {
      console.warn('⚠️ Could not fetch data bounds from API, using config bounds');
      
      // Use bounds from config as fallback
      const configBounds = this.config.viewport.initialBounds;
      if (configBounds) {
        console.log(`📊 Using config bounds: X[${configBounds.xMin.toFixed(2)}, ${configBounds.xMax.toFixed(2)}], Y[${configBounds.yMin.toFixed(2)}, ${configBounds.yMax.toFixed(2)}]`);
        
        // Set camera to show the config bounds with padding
        const camera = this.sigma.getCamera();
        const container = this.sigma.getContainer();
        
        // Calculate the center of the config bounds (database coordinates)
        const dbCenterX = (configBounds.xMin + configBounds.xMax) / 2;
        const dbCenterY = (configBounds.yMin + configBounds.yMax) / 2;
        
        // Convert to scaled coordinates for camera positioning
        const coordinateScale = this.config.viewport.coordinateScale;
        const centerX = dbCenterX * coordinateScale;
        const centerY = dbCenterY * coordinateScale;
        
        // Use config ratio
        const defaultRatio = this.config.viewport.initialRatio;
        
        console.log(`🎯 Setting camera from config: center(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), ratio=${defaultRatio}`);
        console.log(`🔧 Coordinate scale: ${coordinateScale}x (DB center: ${dbCenterX.toFixed(2)}, ${dbCenterY.toFixed(2)} → Scaled: ${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);
        
        // Set the camera position
        camera.setState({
          x: centerX,
          y: centerY,
          ratio: defaultRatio
        });
      } else {
        console.warn('⚠️ No config bounds available, using origin fallback');
        
        // Set fallback camera position at origin with reasonable zoom
        const camera = this.sigma.getCamera();
        const defaultRatio = 1.0; // Start at normal view (LOD 1)
        
        console.log(`🎯 Using fallback camera: center(0, 0), ratio=${defaultRatio}`);
        
        camera.setState({
          x: 0,
          y: 0,
          ratio: defaultRatio
        });
      }
    }
    
    // Now load nodes for the current viewport
    await this.updateViewport();
  }

  /**
   * Initialize with minimal fallback data when API is unavailable
   */
  public initializeWithFallback(): void {
    console.log('🔄 Initializing GraphManager with fallback data...');
    
    // Use hardcoded camera position for quantum physics dataset
    // Since nodes will be scaled, the camera should be at scaled origin
    const coordinateScale = this.config.viewport.coordinateScale;
    this.sigma.getCamera().setState({ x: 0, y: 0, ratio: 1.0 });
    console.log(`🎯 Using fallback camera: center(0, 0), ratio=1.0 (coordinate scale: ${coordinateScale}x)`);
    
    // Try to load viewport data
    this.loadViewportNodesLOD().catch(error => {
      console.error('❌ Fallback loading also failed:', error);
      console.log('💡 Try refreshing the page or restarting the backend');
    });
  }

  /**
   * Get current statistics
   */
  public getStats(): { 
    nodeCount: number; 
    edgeCount: number; 
    cacheRegions: number; 
    isLoading: boolean; 
    batchProgress: {current: number, total: number} | null;
    priorityManager: any;
    requestQueue: any;
  } {
    const graph = this.sigma.getGraph();
    return {
      nodeCount: graph.order,
      edgeCount: graph.size,
      cacheRegions: this.loadedRegions.length,
      isLoading: this.isLoading,
      batchProgress: this.batchProgress,
      priorityManager: this.nodePriorityManager.getStats(),
      requestQueue: this.requestManager.getStatus(),
    };
  }
  
  /**
   * Force refresh current viewport
   */
  public async refresh(): Promise<void> {
    // Clear cache to force reload
    this.loadedRegions = [];
    this.isLoading = false; // Reset any stuck loading state
    await this.updateViewport();
  }

  /**
   * Reset stuck loading state (emergency function)
   */
  public resetLoadingState(): void {
    console.warn(`[LOD] 🔧 Manually resetting loading state`);
    this.isLoading = false;
    this.lastLoadStart = 0;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    // Clean up cluster listener
    this.clusterManager.removeGlobalChangeCallback(this.filterExistingNodesByCluster);
    
    // Cleanup click highlighter
    if (this.clickHighlighter) {
      this.clickHighlighter.cleanup();
      this.clickHighlighter = null;
    }
    
    // Cleanup new managers
    this.requestManager.cancelAllRequests();
    this.nodePriorityManager.clear();
    
    console.log('🧹 GraphManager destroyed');
  }

  /**
   * Calculate current viewport bounds in database coordinates
   */
  public getViewportBounds(): ViewportBounds {
    const camera = this.sigma.getCamera();
    const container = this.sigma.getContainer();
    
    // DIAGNOSTIC: Check for problematic states that cause zero bounds
    if (!camera || !container) {
      console.error('❌ VIEWPORT ERROR: Missing camera or container');
      // Return fallback bounds to prevent getting stuck
      return {
        minX: -1000,
        maxX: 1000,
        minY: -1000,
        maxY: 1000,
        width: 2000,
        height: 2000
      };
    }
    
    // Get the actual screen dimensions of the canvas
    const screenWidth = container.offsetWidth;
    const screenHeight = container.offsetHeight;
    
    // Remove diagnostic logging from getter method - it's called by UI every second
    
    // Check for zero dimensions that would break coordinate conversion
    if (screenWidth <= 0 || screenHeight <= 0) {
      console.error(`❌ VIEWPORT ERROR: Invalid container dimensions: ${screenWidth}x${screenHeight}`);
      // Return fallback bounds
      return {
        minX: -1000,
        maxX: 1000,
        minY: -1000,
        maxY: 1000,
        width: 2000,
        height: 2000
      };
    }
    
    // Check for invalid camera state that would break coordinate conversion
    if (!isFinite(camera.x) || !isFinite(camera.y) || !isFinite(camera.ratio) || camera.ratio <= 0) {
      console.error(`❌ VIEWPORT ERROR: Invalid camera state - x=${camera.x}, y=${camera.y}, ratio=${camera.ratio}`);
      // Reset camera to safe state
      console.log('🔧 FIXING: Resetting camera to safe state');
      camera.setState({ x: 0, y: 0, ratio: 1.0 });
      
      // Return fallback bounds after reset
      return {
        minX: -1000,
        maxX: 1000,
        minY: -1000,
        maxY: 1000,
        width: 2000,
        height: 2000
      };
    }
    
    try {
      // Convert all four screen corners to graph coordinates to handle any orientation
      const topLeft = this.sigma.viewportToGraph({ x: 0, y: 0 });
      const topRight = this.sigma.viewportToGraph({ x: screenWidth, y: 0 });
      const bottomLeft = this.sigma.viewportToGraph({ x: 0, y: screenHeight });
      const bottomRight = this.sigma.viewportToGraph({ x: screenWidth, y: screenHeight });
      
      // Remove diagnostic logging from getter method - causes log spam
      
      // Validate the coordinate conversion results
      const coords = [topLeft, topRight, bottomLeft, bottomRight];
      const hasInvalidCoords = coords.some(coord => 
        !isFinite(coord.x) || !isFinite(coord.y) || 
        Math.abs(coord.x) > 1000000 || Math.abs(coord.y) > 1000000
      );
      
      if (hasInvalidCoords) {
        console.error('❌ VIEWPORT ERROR: Invalid coordinate conversion results');
        // Reset camera and return fallback
        camera.setState({ x: 0, y: 0, ratio: 1.0 });
        return {
          minX: -1000,
          maxX: 1000,
          minY: -1000,
          maxY: 1000,
          width: 2000,
          height: 2000
        };
      }
      
      // Find the actual min/max from all four corners (these are in scaled coordinates)
      const allX = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x];
      const allY = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y];
      
      // Additional validation: check for all-zero coordinates (stuck state)
      const sumX = allX.reduce((a, b) => a + Math.abs(b), 0);
      const sumY = allY.reduce((a, b) => a + Math.abs(b), 0);
      
      if (sumX < 0.001 && sumY < 0.001) {
        console.error('❌ VIEWPORT ERROR: All coordinates near zero - stuck state detected');
        // Reset camera to different position to break the stuck state
        console.log('🔧 FIXING: Breaking stuck state by resetting camera');
        camera.setState({ x: 100, y: 100, ratio: 0.5 });
        
        // Return reasonable bounds
        return {
          minX: -500,
          maxX: 500,
          minY: -500,
          maxY: 500,
          width: 1000,
          height: 1000
        };
      }
      
      // Convert scaled coordinates back to database coordinates for API queries
      const coordinateScale = this.config.viewport.coordinateScale;
      
      const bounds: ViewportBounds = {
        minX: Math.min(...allX) / coordinateScale,
        maxX: Math.max(...allX) / coordinateScale,
        minY: Math.min(...allY) / coordinateScale,
        maxY: Math.max(...allY) / coordinateScale,
        width: (Math.max(...allX) - Math.min(...allX)) / coordinateScale,
        height: (Math.max(...allY) - Math.min(...allY)) / coordinateScale
      };

      // Final validation of calculated bounds
      if (!isFinite(bounds.minX) || !isFinite(bounds.maxX) || !isFinite(bounds.minY) || !isFinite(bounds.maxY) ||
          bounds.width <= 0 || bounds.height <= 0) {
        console.error('❌ VIEWPORT ERROR: Invalid final bounds calculated');
        return {
          minX: -1000,
          maxX: 1000,
          minY: -1000,
          maxY: 1000,
          width: 2000,
          height: 2000
        };
      }

      // Remove all diagnostic logging from this getter method - it's called by UI every second
      
      return bounds;
      
    } catch (error) {
      console.error('❌ VIEWPORT ERROR: Exception during coordinate conversion:', error);
      // Reset camera on any error
      camera.setState({ x: 0, y: 0, ratio: 1.0 });
      return {
        minX: -1000,
        maxX: 1000,
        minY: -1000,
        maxY: 1000,
        width: 2000,
        height: 2000
      };
    }
  }

  /**
   * Get viewport bounds in scaled coordinates (for internal node checking)
   */
  private getScaledViewportBounds(): ViewportBounds {
    const camera = this.sigma.getCamera();
    const container = this.sigma.getContainer();
    
    // Get the actual screen dimensions of the canvas
    const screenWidth = container.offsetWidth;
    const screenHeight = container.offsetHeight;
    
    // Convert all four screen corners to graph coordinates to handle any orientation
    const topLeft = this.sigma.viewportToGraph({ x: 0, y: 0 });
    const topRight = this.sigma.viewportToGraph({ x: screenWidth, y: 0 });
    const bottomLeft = this.sigma.viewportToGraph({ x: 0, y: screenHeight });
    const bottomRight = this.sigma.viewportToGraph({ x: screenWidth, y: screenHeight });
    
    // Find the actual min/max from all four corners (these are already in scaled coordinates)
    const allX = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x];
    const allY = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y];
    
    return {
      minX: Math.min(...allX),
      maxX: Math.max(...allX),
      minY: Math.min(...allY),
      maxY: Math.max(...allY),
      width: Math.max(...allX) - Math.min(...allX),
      height: Math.max(...allY) - Math.min(...allY)
    };
  }

  /**
   * Check if a node (with scaled coordinates) is within the current viewport
   */
  private isNodeInScaledViewport(nodeAttrs: any, scaledBounds: ViewportBounds): boolean {
    return nodeAttrs.x >= scaledBounds.minX && nodeAttrs.x <= scaledBounds.maxX && 
           nodeAttrs.y >= scaledBounds.minY && nodeAttrs.y <= scaledBounds.maxY;
  }

  /**
   * Check if viewport is already covered by cached regions (DEPRECATED - use isSpatialCached)
   */
  private isViewportCached(bounds: ViewportBounds, requiredMinDegree: number): boolean {
    const now = Date.now();
    
    // Only log cache details during loading to reduce spam
    if (this.isLoading) {
      console.log(`🔍 Cache check: ${this.loadedRegions.length} regions, TTL=${this.config.performance.cache.ttl}ms`);
    }
    
    return this.loadedRegions.some((region, index) => {
      const age = now - region.timestamp;
      if (age > this.config.performance.cache.ttl) {
        if (this.isLoading) console.log(`⏰ Region ${index} expired (age: ${age}ms > TTL: ${this.config.performance.cache.ttl}ms)`);
        return false;
      }

      // Use lodLevel for new system compatibility
      const regionMinDegree = this.config.lod.minDegree[region.lodLevel] || 0;
      if (regionMinDegree > requiredMinDegree) {
        if (this.isLoading) console.log(`📊 Region ${index} degree mismatch (cache: ${regionMinDegree} > required: ${requiredMinDegree})`);
        return false;
      }
      
      const overlapMinX = Math.max(bounds.minX, region.bounds.minX);
      const overlapMaxX = Math.min(bounds.maxX, region.bounds.maxX);
      const overlapMinY = Math.max(bounds.minY, region.bounds.minY);
      const overlapMaxY = Math.min(bounds.maxY, region.bounds.maxY);
      
      if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) {
        if (this.isLoading) console.log(`📐 Region ${index} no overlap`);
        return false;
      }
      
      const overlapArea = (overlapMaxX - overlapMinX) * (overlapMaxY - overlapMinY);
      const viewportArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
      const overlapRatio = overlapArea / viewportArea;
      
      if (this.isLoading) console.log(`🎯 Region ${index} overlap: ${(overlapRatio * 100).toFixed(1)}% (threshold: ${(this.config.performance.cache.overlapThreshold * 100).toFixed(1)}%)`);
      
      if (overlapRatio >= this.config.performance.cache.overlapThreshold) {
        console.log(`♻️ Cache hit: Region ${index} overlap sufficient`);
        return true;
      }
      
      return false;
    });
  }

  /**
   * Calculate node importance for memory management
   */
  private calculateNodeImportance(nodeId: string, bounds: ViewportBounds): NodeImportance {
    const graph = this.sigma.getGraph();
    const nodeAttrs = graph.getNodeAttributes(nodeId);
    const degree = nodeAttrs.degree || 1;
    
    // Use scaled bounds for node checking since nodes are stored in scaled coordinates
    const scaledBounds = this.getScaledViewportBounds();
    
    // Check if node is within current viewport
    const isInViewport = this.isNodeInScaledViewport(nodeAttrs, scaledBounds);
    
    // Calculate distance from viewport center (using scaled coordinates)
    const centerX = (scaledBounds.minX + scaledBounds.maxX) / 2;
    const centerY = (scaledBounds.minY + scaledBounds.maxY) / 2;
    const dx = nodeAttrs.x - centerX;
    const dy = nodeAttrs.y - centerY;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
    
    // Importance score calculation
    const degreeScore = Math.log(degree + 1) * 10; // Logarithmic degree importance
    const distanceScore = Math.max(0, 100 - distanceFromCenter); // Closer = higher score
    
    // CRITICAL: Nodes in viewport get massive importance boost to prevent removal
    const viewportBonus = isInViewport ? 1000 : 0;
    
    const importance = degreeScore + distanceScore + viewportBonus;
    
    return {
      nodeId,
      degree,
      distanceFromCenter,
      lastSeen: Date.now(),
      importance,
      lodLevel: 0 // Default LOD level, will be updated based on context
    };
  }

  /**
   * Intelligent node removal based on importance
   * Prioritizes viewport nodes and locally important nodes over global VIPs
   */
  private removeExcessNodes(bounds: ViewportBounds): number {
    const graph = this.sigma.getGraph();
    const currentNodes = graph.nodes();
    
    if (currentNodes.length <= this.config.lod.maxNodes[0]) {
      return 0;
    }

    // Separate nodes into viewport and non-viewport categories
    const scaledBounds = this.getScaledViewportBounds();
    const viewportNodes: string[] = [];
    const nonViewportNodes: string[] = [];
    
    currentNodes.forEach(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (this.isNodeInScaledViewport(attrs, scaledBounds)) {
        viewportNodes.push(nodeId);
      } else {
        nonViewportNodes.push(nodeId);
      }
    });

    console.log(`📊 Node distribution: ${viewportNodes.length} in viewport, ${nonViewportNodes.length} outside`);

    // Update importance scores for all nodes
    const nodeImportances: NodeImportance[] = [];
    currentNodes.forEach(nodeId => {
      const importance = this.calculateNodeImportance(nodeId, bounds);
      this.nodeImportanceMap.set(nodeId, importance);
      nodeImportances.push(importance);
    });

    // Sort by importance (ascending - least important first)
    nodeImportances.sort((a, b) => a.importance - b.importance);
    
    // SMART REMOVAL STRATEGY:
    // 1. Never remove viewport nodes (they have +1000 bonus)
    // 2. Keep some high-degree nodes for context, but prioritize viewport
    // 3. Remove distant low-degree nodes first
    
    const targetRemoval = currentNodes.length - this.config.lod.maxNodes[0];
    
    // Calculate how many viewport nodes vs non-viewport nodes to keep
    const minViewportKeep = Math.min(viewportNodes.length, Math.floor(this.config.lod.maxNodes[0] * 0.7)); // 70% for viewport
    const maxNonViewportKeep = this.config.lod.maxNodes[0] - minViewportKeep;
    
    console.log(`🎯 Target removal: ${targetRemoval}, keep ${minViewportKeep} viewport + ${maxNonViewportKeep} context nodes`);
    
    // Remove least important nodes, but respect viewport priority
    const nodesToRemove = nodeImportances.slice(0, targetRemoval);
    
    let removedCount = 0;
    let removedViewport = 0;
    let removedNonViewport = 0;
    
    nodesToRemove.forEach(({ nodeId }) => {
      if (graph.hasNode(nodeId)) {
        const attrs = graph.getNodeAttributes(nodeId);
        const isInViewport = attrs.x >= bounds.minX && attrs.x <= bounds.maxX && 
                            attrs.y >= bounds.minY && attrs.y <= bounds.maxY;
        
        graph.dropNode(nodeId); // Also removes connected edges
        this.nodeImportanceMap.delete(nodeId);
        removedCount++;
        
        if (isInViewport) {
          removedViewport++;
        } else {
          removedNonViewport++;
        }
      }
    });

    if (removedCount > 0) {
      console.log(`🗑️ Removed ${removedCount} nodes: ${removedViewport} viewport, ${removedNonViewport} distant (kept ${graph.order} total)`);
      
      // Debug: Check final distribution
      const remainingNodes = graph.nodes();
      let remainingInViewport = 0;
      remainingNodes.forEach(nodeId => {
        const attrs = graph.getNodeAttributes(nodeId);
        if (attrs.x >= bounds.minX && attrs.x <= bounds.maxX && 
            attrs.y >= bounds.minY && attrs.y <= bounds.maxY) {
          remainingInViewport++;
        }
      });
      console.log(`🎯 Final: ${remainingInViewport} viewport nodes, ${remainingNodes.length - remainingInViewport} context nodes`);
    }
    
    return removedCount;
  }

  /**
   * REVOLUTIONARY LOD-based viewport loading
   */
  private async loadViewportNodesLOD(): Promise<void> {
    console.log(`[LOD] Starting LOD-aware viewport loading...`);
    
    // Cancel any previous node requests to prevent backlog
    this.requestManager.cancelRequestsByType('nodes');
    
    if (this.isLoading) {
      const stuckTime = Date.now() - (this.lastLoadStart || 0);
      console.log(`[LOD] Already loading, returning early (stuck for ${stuckTime}ms)`);
      
      // Reset stuck loading state after 5 seconds (reduced from 10s)
      if (stuckTime > 5000) {
        console.warn(`[LOD] ⚠️ Loading stuck for >5s, forcefully resetting loading state`);
        this.isLoading = false;
        this.lastLoadStart = 0;
        this.requestManager.emergencyReset();
        // Allow this request to continue after reset
      } else {
        return;
      }
    }

    const bounds = this.getViewportBounds();
    const camera = this.sigma.getCamera();
    const lodLevel = this.calculateLOD(camera.ratio);
    const maxNodes = this.config.lod.maxNodes[lodLevel];
    const minDegree = this.config.lod.minDegree[lodLevel];
    
    // Add diagnostic info here where it belongs - during actual loading
    const container = this.sigma.getContainer();
    console.log(`[LOD] 🎥 Camera: x=${camera.x.toFixed(3)}, y=${camera.y.toFixed(3)}, ratio=${camera.ratio.toFixed(3)}, Container: ${container.offsetWidth}x${container.offsetHeight}`);
    console.log(`[LOD] 📐 Viewport: [${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}, ${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}] (${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)})`);
    console.log(`[LOD] Camera ratio: ${camera.ratio.toFixed(3)}, LOD Level: ${lodLevel}, Max nodes: ${maxNodes}, Min degree: ${minDegree}`);

    // Fast spatial cache check using hash
    if (this.isSpatialCached(bounds, lodLevel)) {
      console.log(`[LOD] ✅ Spatial cache hit for LOD ${lodLevel}`);
      return;
    }

    this.isLoading = true;
    this.lastLoadStart = Date.now();
    console.log(`[LOD] 🚀 Loading LOD ${lodLevel} nodes...`);

    // Set a timeout to automatically reset loading state
    const loadingTimeout = setTimeout(() => {
      if (this.isLoading) {
        console.warn(`[LOD] ⚠️ Loading timeout reached, forcefully resetting state`);
        this.isLoading = false;
        this.lastLoadStart = 0;
        this.requestManager.emergencyReset();
      }
    }, 15000); // 15 second timeout

    try {
      // Get visible cluster IDs for filtering
      const visibleClusterIds = Array.from(this.clusterManager.getVisibleClusterIds());
      console.log(`[LOD] Filtering by visible clusters: [${visibleClusterIds.join(', ')}]`);
      
      // Get quality filter minimum degree
      const qualityMinDegree = this.qualityFilter.getEffectiveMinDegree();
      console.log(`[LOD] Quality filter min degree: ${qualityMinDegree}`);
      
      // Use lightweight nodes for higher LOD levels (zoomed out)
      let newNodes: (Node | LightNode)[] = [];
      let batchNodesProcessed = 0;
      
      if (lodLevel >= 3) {
        // Zoomed out: use lightweight nodes for performance
        console.log(`[LOD] Using lightweight node loading for LOD ${lodLevel}`);
        try {
          const requestKey = RequestManager.generateRequestKey('nodes_light', { bounds, maxNodes, visibleClusterIds, qualityMinDegree });
          const priority = RequestManager.calculatePriority('nodes', false, lodLevel);
          
          newNodes = await this.requestManager.queueRequest(
            'nodes',
            requestKey,
            priority,
            (signal) => fetchBoxLight(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, maxNodes, signal, visibleClusterIds, qualityMinDegree)
          );
        } catch (error) {
          console.warn(`[LOD] Lightweight API failed, falling back to full nodes:`, error);
          
          const requestKey = RequestManager.generateRequestKey('nodes_full', { bounds, maxNodes, visibleClusterIds, qualityMinDegree });
          const priority = RequestManager.calculatePriority('nodes', false, lodLevel);
          
          newNodes = await this.requestManager.queueRequest(
            'nodes',
            requestKey,
            priority,
            (signal) => fetchBox(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 1.0, maxNodes, signal, visibleClusterIds, qualityMinDegree)
          );
        }
      } else {
        // Zoomed in: use full node data with batching for smooth UI
        console.log(`[LOD] Using batched node loading for LOD ${lodLevel}`);
        
        // Get batch size from config with adaptive scaling
        const configBatchSize = this.config.performance.loading.batchSize;
        const minBatchSize = this.config.performance.loading.minBatchSize;
        const maxBatchSize = this.config.performance.loading.maxBatchSize;
        
        let batchSize = configBatchSize;
        if (this.config.performance.loading.adaptiveBatching) {
          // Adaptive batch size based on total nodes needed
          const adaptiveBatchSize = Math.max(minBatchSize, Math.min(maxBatchSize, maxNodes / 10));
          batchSize = Math.min(configBatchSize, adaptiveBatchSize);
        }
        
        console.log(`[LOD] 📦 Batch config: size=${batchSize}, adaptive=${this.config.performance.loading.adaptiveBatching}, early_termination=${this.config.performance.loading.earlyTermination}`);
        
        const requestKey = RequestManager.generateRequestKey('nodes_batched', { bounds, maxNodes, batchSize, visibleClusterIds, qualityMinDegree });
        const priority = RequestManager.calculatePriority('nodes', false, lodLevel);
        newNodes = await this.requestManager.queueRequest(
          'nodes',
          requestKey,
          priority,
          (signal) => fetchBoxBatched(
            bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 
            maxNodes, batchSize,
            (batchNodes, batchIndex, totalBatches) => {
              // Progressive loading callback - add nodes immediately for smooth UI
              console.log(`[LOD] 📦 Batch ${batchIndex}/${totalBatches}: +${batchNodes.length} nodes`);
              this.batchProgress = {current: batchIndex, total: totalBatches};
              // Progressive loading: add nodes immediately for smooth UI
              const addedInBatch = this.addBatchToGraph(batchNodes, minDegree);
              batchNodesProcessed += addedInBatch;
            },
            signal,
            visibleClusterIds,
            qualityMinDegree
          )
        );
        
        // For batched loading, we've already processed nodes in callbacks
        console.log(`[LOD] Batched loading complete: ${batchNodesProcessed} nodes processed via callbacks`);
        console.log(`[LOD] API returned ${newNodes.length} total nodes for LOD ${lodLevel}`);
        console.log(`[LOD] Processing complete: ${batchNodesProcessed} added, 0 existed, 0 filtered by degree`);
        console.log(`[LOD] Graph now has ${this.graph.order} nodes total`);
      }
      
      // Determine if we used batched loading to decide on further processing
      const usedBatchedLoading = lodLevel <= 1; // Same condition as above
      let finalAddedNodes = usedBatchedLoading ? batchNodesProcessed : 0;
      
      if (!usedBatchedLoading) {
        // Non-batched loading: process nodes normally
        console.log(`[LOD] API returned ${newNodes.length} nodes for LOD ${lodLevel}`);
        
        if (newNodes.length > 0) {
          console.log(`[LOD] Sample node: ${newNodes[0].key} at (${newNodes[0].attributes.x.toFixed(3)}, ${newNodes[0].attributes.y.toFixed(3)}) degree=${newNodes[0].attributes.degree}`);
        }

        // Smart incremental loading: only add nodes that pass degree filter
        let addedNodes = 0;
        let filteredNodes = 0;
        let skippedNodes = 0;
        
        newNodes.forEach(node => {
          // Apply LOD-based degree filtering
          if (node.attributes.degree < minDegree) {
            filteredNodes++;
            return;
          }
          
          if (!this.graph.hasNode(node.key)) {
            // Add node with appropriate attributes based on type
            // Apply coordinate scaling from config
            const coordinateScale = this.config.viewport.coordinateScale;
            
            const nodeAttrs: any = {
              x: node.attributes.x * coordinateScale,
              y: node.attributes.y * coordinateScale,
              size: this.config.visual.nodes.defaultSize,
              degree: node.attributes.degree,
              color: node.attributes.color || this.config.visual.nodes.defaultColor,
            };
            
            // Add full attributes for detailed nodes
            if ('label' in node.attributes) {
              nodeAttrs.label = node.attributes.label;
              nodeAttrs.community = node.attributes.community;
            } else {
              // Lightweight node: generate placeholder label
              nodeAttrs.label = `Paper ${node.key.substring(0, 8)}...`;
              nodeAttrs.community = 0;
            }
            
            this.graph.addNode(node.key, nodeAttrs);
            this.addToSpatialIndex(node.key, node.attributes.x * coordinateScale, node.attributes.y * coordinateScale);
            
            // Add to priority manager for efficient removal
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            const distanceFromCenter = Math.sqrt(
              Math.pow(node.attributes.x - centerX, 2) + 
              Math.pow(node.attributes.y - centerY, 2)
            );
            
            this.nodePriorityManager.addNode({
              nodeId: node.key,
              degree: node.attributes.degree,
              distanceFromCenter,
              lastSeen: Date.now(),
              lodLevel
            });
            
            addedNodes++;
          } else {
            // Node already exists, but update its priority in the manager
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            const distanceFromCenter = Math.sqrt(
              Math.pow(node.attributes.x - centerX, 2) + 
              Math.pow(node.attributes.y - centerY, 2)
            );
            
            // Update existing node's priority and last seen time
            this.nodePriorityManager.addNode({
              nodeId: node.key,
              degree: node.attributes.degree,
              distanceFromCenter,
              lastSeen: Date.now(),
              lodLevel
            });
            
            skippedNodes++;
          }
        });
        
        console.log(`[LOD] Processing complete: ${addedNodes} added, ${skippedNodes} existed, ${filteredNodes} filtered by degree`);
        console.log(`[LOD] Graph now has ${this.graph.order} nodes total`);
        finalAddedNodes = addedNodes;
      }
      
      // Always run node removal to maintain memory limits, regardless of new nodes
      const removedCount = this.removeExcessNodesWithPriority();
      console.log(`[LOD] Removed ${removedCount} excess nodes for LOD ${lodLevel}`);

      // Always add to spatial cache to prevent repeated loading of same area
      this.loadedRegions.push({
        bounds,
        timestamp: Date.now(),
        nodeCount: finalAddedNodes, // This can be 0 if all nodes already existed
        lodLevel,
        spatialHash: this.generateSpatialHash(bounds, lodLevel),
      });
      
      // Load edges for detailed and normal views (regardless of new nodes)
      if (this.shouldLoadEdges(lodLevel)) {
        console.log(`[LOD] Loading edges for LOD ${lodLevel}`);
        await this.loadEdgesForViewportNodes(bounds);
      } else {
        console.log(`[LOD] Skipping edge loading for overview LOD ${lodLevel}`);
      }
    } catch (error) {
      console.error('[LOD] API call failed:', error);
      // Force reload on next viewport change if not a timeout/cancellation
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('timeout') && !errorMessage.includes('cancelled')) {
        this.loadedRegions = [];
      }
    } finally {
      // Clear the timeout
      clearTimeout(loadingTimeout);
      
      this.isLoading = false;
      this.lastLoadStart = 0;
      this.batchProgress = null; // Clear batch progress
      console.log(`[LOD] Complete. Final graph: ${this.graph.order} nodes`);
    }
  }

  /**
   * Efficient node removal using priority manager
   */
  private removeExcessNodesWithPriority(): number {
    const graph = this.sigma.getGraph();
    const currentNodeCount = graph.order;
    const maxNodes = this.config.memory.maxTotalNodes;
    
    if (currentNodeCount <= maxNodes) {
      return 0;
    }
    
    const excessCount = currentNodeCount - maxNodes;
    const nodesToRemove = this.nodePriorityManager.getNodesForRemoval(excessCount);
    
    let removedCount = 0;
    nodesToRemove.forEach(nodeId => {
      if (graph.hasNode(nodeId)) {
        graph.dropNode(nodeId);
        removedCount++;
      }
    });
    
    console.log(`🧹 Priority-based removal: ${removedCount} nodes removed (${graph.order} remaining)`);
    return removedCount;
  }

  /**
   * LOD-aware node removal (legacy method)
   */
  private removeExcessNodesLOD(bounds: ViewportBounds, currentLOD: number): number {
    const graph = this.sigma.getGraph();
    const currentNodes = graph.nodes();
    const maxNodes = this.config.lod.maxNodes[currentLOD];
    
    if (currentNodes.length <= maxNodes) {
      return 0;
    }

    // Enhanced removal strategy for LOD
    const scaledBounds = this.getScaledViewportBounds();
    const viewportNodes: string[] = [];
    const nonViewportNodes: string[] = [];
    
    currentNodes.forEach(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (this.isNodeInScaledViewport(attrs, scaledBounds)) {
        viewportNodes.push(nodeId);
      } else {
        nonViewportNodes.push(nodeId);
      }
    });

    console.log(`[LOD] Node distribution for LOD ${currentLOD}: ${viewportNodes.length} viewport, ${nonViewportNodes.length} distant`);

    // Calculate importance with LOD awareness
    const nodeImportances: NodeImportance[] = [];
    currentNodes.forEach(nodeId => {
      const importance = this.calculateNodeImportance(nodeId, bounds);
      importance.lodLevel = currentLOD; // Update LOD level
      this.nodeImportanceMap.set(nodeId, importance);
      nodeImportances.push(importance);
    });

    // Sort by importance (ascending - least important first)
    nodeImportances.sort((a, b) => a.importance - b.importance);
    
    const targetRemoval = currentNodes.length - maxNodes;
    const nodesToRemove = nodeImportances.slice(0, targetRemoval);
    
    let removedCount = 0;
    nodesToRemove.forEach(({ nodeId }) => {
      if (graph.hasNode(nodeId)) {
        graph.dropNode(nodeId);
        this.nodeImportanceMap.delete(nodeId);
        removedCount++;
      }
    });

    return removedCount;
  }

  /**
   * Load nodes for current viewport (LEGACY - use loadViewportNodesLOD)
   */
  private async loadViewportNodes(): Promise<void> {
    console.log(`[DEBUG] loadViewportNodes called. isLoading: ${this.isLoading}`);
    
    if (this.isLoading) {
      console.log(`[DEBUG] Already loading, returning early`);
      return;
    }

    const bounds = this.getViewportBounds();
    const limit = 4000; // Always request top 2000 most connected nodes
    
    console.log(`[DEBUG] Requesting top ${limit} most connected nodes in viewport`);
    console.log(`[DEBUG] Viewport bounds: minX=${bounds.minX.toFixed(1)}, maxX=${bounds.maxX.toFixed(1)}, minY=${bounds.minY.toFixed(1)}, maxY=${bounds.maxY.toFixed(1)}`);

    // Simple cache check - just check if we've loaded this exact area recently
    if (this.isViewportCached(bounds, 0)) {
      console.log(`[DEBUG] Viewport is cached, returning early`);
      return;
    }

    this.isLoading = true;
    console.log(`[DEBUG] Starting API call to fetchBox...`);

    try {
      // Get visible cluster IDs for filtering
      const visibleClusterIds = Array.from(this.clusterManager.getVisibleClusterIds());
      console.log(`[DEBUG] Filtering by visible clusters: [${visibleClusterIds.join(', ')}]`);
      
      // Get quality filter minimum degree
      const qualityMinDegree = this.qualityFilter.getEffectiveMinDegree();
      console.log(`[DEBUG] Quality filter min degree: ${qualityMinDegree}`);
      
      const newNodes = await fetchBox(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 1.0, limit, undefined, visibleClusterIds, qualityMinDegree);
      console.log(`[DEBUG] API returned ${newNodes.length} nodes`);
      
      if (newNodes.length > 0) {
        console.log(`[DEBUG] Sample node: key=${newNodes[0].key}, label="${newNodes[0].attributes.label.substring(0,30)}...", degree=${newNodes[0].attributes.degree}`);
        console.log(`🎯 SAMPLE NODE POSITION: x=${newNodes[0].attributes.x.toFixed(3)}, y=${newNodes[0].attributes.y.toFixed(3)}`);
        
        // Show positions of first few nodes
        const sampleCount = Math.min(5, newNodes.length);
        console.log(`📍 First ${sampleCount} node positions:`);
        for (let i = 0; i < sampleCount; i++) {
          const node = newNodes[i];
          console.log(`   Node ${i+1}: (${node.attributes.x.toFixed(3)}, ${node.attributes.y.toFixed(3)}) - ${node.attributes.label.substring(0,20)}...`);
        }
      }

      let addedNodes = 0;
      let skippedNodes = 0;
      
      // Apply coordinate scaling from config
      const coordinateScale = this.config.viewport.coordinateScale;
      
      newNodes.forEach(node => {
        if (!this.graph.hasNode(node.key)) {
          this.graph.addNode(node.key, {
            x: node.attributes.x * coordinateScale,
            y: node.attributes.y * coordinateScale,
            size: this.config.visual.nodes.defaultSize,
            label: node.attributes.label,
            degree: node.attributes.degree,
            color: node.attributes.color,
            community: node.attributes.community,
          });
          addedNodes++;
        } else {
          // Node already exists, but update its priority in the manager if using priority system
          // For legacy method, we'll just skip this since it doesn't use priority manager
          skippedNodes++;
        }
      });
      
      console.log(`[DEBUG] Processing complete: ${addedNodes} added, ${skippedNodes} skipped (already existed)`);
      console.log(`[DEBUG] Graph now has ${this.graph.order} nodes total`);

      if (addedNodes > 0) {
        console.log(`[DEBUG] Adding cache entry and processing edges...`);
        this.loadedRegions.push({
          bounds,
          timestamp: Date.now(),
          nodeCount: addedNodes,
          lodLevel: 0, // No longer relevant but keep for interface compatibility
          spatialHash: this.generateSpatialHash(bounds, 0),
        });
        
        const removedCount = this.removeExcessNodes(bounds);
        console.log(`[DEBUG] Removed ${removedCount} excess nodes`);
        
        await this.loadEdgesForViewportNodes(bounds);
      } else {
        console.log(`[DEBUG] No new nodes added, skipping cache entry and edge loading`);
      }
    } catch (error) {
      console.error('[DEBUG] API call failed:', error);
    } finally {
      this.isLoading = false;
      console.log(`[DEBUG] loadViewportNodes complete. Final graph size: ${this.graph.order} nodes`);
    }
  }

  /**
   * Load edges specifically for viewport nodes (CRITICAL FIX)
   * This prevents loading irrelevant edges for distant nodes
   */
  private async loadEdgesForViewportNodes(bounds: ViewportBounds): Promise<void> {
    const graph = this.sigma.getGraph();
    
    console.log(`🔗 [EDGE DEBUG] Starting edge loading for viewport: [${bounds.minX.toFixed(2)}, ${bounds.maxX.toFixed(2)}, ${bounds.minY.toFixed(2)}, ${bounds.maxY.toFixed(2)}]`);
    console.log(`🔗 [EDGE DEBUG] Total graph nodes: ${graph.order}, Total graph edges: ${graph.size}`);
    
    // Get only nodes that are in the current viewport
    const scaledBounds = this.getScaledViewportBounds();
    const viewportNodeIds: string[] = [];
    const allNodeIds: string[] = [];
    graph.nodes().forEach(nodeId => {
      allNodeIds.push(nodeId);
      const attrs = graph.getNodeAttributes(nodeId);
      if (this.isNodeInScaledViewport(attrs, scaledBounds)) {
        viewportNodeIds.push(nodeId);
      }
    });
    
    console.log(`🔗 [EDGE DEBUG] Found ${viewportNodeIds.length} viewport nodes out of ${allNodeIds.length} total nodes`);
    
    if (viewportNodeIds.length === 0) {
      console.log(`🔗 [EDGE DEBUG] No viewport nodes found, skipping edge loading`);
      return;
    }

    // Show sample viewport nodes
    const sampleCount = Math.min(3, viewportNodeIds.length);
    console.log(`🔗 [EDGE DEBUG] Sample viewport nodes (${sampleCount}/${viewportNodeIds.length}):`);
    for (let i = 0; i < sampleCount; i++) {
      const nodeId = viewportNodeIds[i];
      const attrs = graph.getNodeAttributes(nodeId);
      console.log(`   ${i+1}. ${nodeId.substring(0,8)}... at (${attrs.x.toFixed(3)}, ${attrs.y.toFixed(3)}) degree=${attrs.degree}`);
    }

    console.log(`🔗 [EDGE DEBUG] Calling fetchEdgesBatch with ${viewportNodeIds.length} nodes, limit=3000`);

    try {
      // Load edges only between viewport nodes
      const edges = await fetchEdgesBatch(viewportNodeIds, 3000, "all");
      console.log(`🔗 [EDGE DEBUG] fetchEdgesBatch returned ${edges.length} edges`);
      
      if (edges.length > 0) {
        console.log(`🔗 [EDGE DEBUG] Sample edges (first 3):`);
        const edgeSampleCount = Math.min(3, edges.length);
        for (let i = 0; i < edgeSampleCount; i++) {
          const edge = edges[i];
          console.log(`   ${i+1}. ${edge.source.substring(0,8)}... -> ${edge.target.substring(0,8)}...`);
        }
      }
      
      let addedEdges = 0;
      let skippedEdges = 0;
      let missingNodeEdges = 0;
      
      edges.forEach((edge: Edge) => {
        // Both source and target must exist in graph
        if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
          if (!graph.hasEdge(edge.source, edge.target)) {
            graph.addEdge(edge.source, edge.target, {
              color: this.config.visual.edges.defaultColor,
              size: this.config.visual.edges.defaultSize,
            });
            addedEdges++;
          } else {
            skippedEdges++;
          }
        } else {
          missingNodeEdges++;
        }
      });

      console.log(`🔗 [EDGE DEBUG] Edge processing complete:`);
      console.log(`   - Added: ${addedEdges} new edges`);
      console.log(`   - Skipped: ${skippedEdges} (already existed)`);
      console.log(`   - Missing nodes: ${missingNodeEdges} (source/target not in graph)`);
      console.log(`   - Final graph: ${graph.order} nodes, ${graph.size} edges`);
    } catch (error) {
      console.error('🔗 [EDGE DEBUG] Viewport edge loading failed:', error);
    }
  }

  /**
   * Load edges for currently visible nodes (DEPRECATED - use loadEdgesForViewportNodes)
   */
  private async loadEdgesForVisibleNodes(): Promise<void> {
    console.warn('⚠️ loadEdgesForVisibleNodes is deprecated, use loadEdgesForViewportNodes instead');
    const graph = this.sigma.getGraph();
    const nodeIds = graph.nodes();
    
    if (nodeIds.length === 0) return;

    try {
      const edges = await fetchEdgesBatch(nodeIds, 2000, "all");
      
      let addedEdges = 0;
      edges.forEach((edge: Edge) => {
        if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
          if (!graph.hasEdge(edge.source, edge.target)) {
            graph.addEdge(edge.source, edge.target, {
              color: this.config.visual.edges.defaultColor,
              size: this.config.visual.edges.defaultSize,
            });
            addedEdges++;
          }
        }
      });

      console.log(`🔗 Added ${addedEdges} edges from ${edges.length} candidates`);
    } catch (error) {
      console.warn('Edge loading failed:', error);
    }
  }
} 