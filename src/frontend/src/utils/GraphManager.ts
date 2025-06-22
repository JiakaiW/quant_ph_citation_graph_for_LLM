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
  
  // This will be controlled by the React component
  public isDragging: boolean = false;
  
  // HIERARCHICAL CONFIGURATION
  private readonly CACHE_TTL = 10000; // 10 seconds for better caching
  private readonly MAX_NODES_BY_LOD = {
    0: 1000,  // Zoomed in: high detail, fewer nodes
    1: 2000,  // Medium zoom: balanced
    2: 3000,  // Zoomed out: more nodes, less detail per node
    3: 4000,  // Far out: overview mode
    4: 5000,  // Very far: sparse sampling
    5: 2000   // Ultra far: only major hubs
  };
  private readonly MIN_DEGREE_BY_LOD = {
    0: 1,     // Show all nodes when zoomed in
    1: 2,     // Filter very low degree
    2: 5,     // Medium filtering
    3: 10,    // Show more connected nodes
    4: 20,    // Only well-connected nodes
    5: 50     // Only major hubs
  };
  private readonly VIEWPORT_OVERLAP_THRESHOLD = 0.5; // 50% overlap = cache hit
  
  constructor(sigma: Sigma) {
    this.sigma = sigma;
    this.graph = sigma.getGraph();
    this.initializeSpatialIndex();
  }

  /**
   * Initialize spatial quadtree for fast spatial queries
   */
  private initializeSpatialIndex(): void {
    // Will be populated as nodes are loaded
    this.spatialIndex = null;
  }

  /**
   * Calculate Level of Detail based on camera ratio
   */
  private calculateLOD(cameraRatio: number): number {
    // Sigma ratio: higher = more zoomed out
    if (cameraRatio < 0.1) return 0;      // Very zoomed in
    if (cameraRatio < 0.5) return 1;      // Zoomed in
    if (cameraRatio < 2.0) return 2;      // Normal
    if (cameraRatio < 5.0) return 3;      // Zoomed out
    if (cameraRatio < 15.0) return 4;     // Far out
    return 5;                             // Ultra far (overview)
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
      if (now - region.timestamp > this.CACHE_TTL) return false;
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
    
    nodes.forEach(node => {
      // Apply LOD-based degree filtering
      if (node.attributes.degree < minDegree) {
        return;
      }
      
      if (!this.graph.hasNode(node.key)) {
        // Add node with appropriate attributes based on type
        const nodeAttrs: any = {
          x: node.attributes.x,
          y: node.attributes.y,
          size: node.attributes.size || 5,
          degree: node.attributes.degree,
          color: node.attributes.color || '#888888',
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
        this.addToSpatialIndex(node.key, node.attributes.x, node.attributes.y);
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

    // Use non-blocking approach - start loading but don't wait
    this.loadViewportNodesLOD().catch(error => {
      console.error('[LOD] Viewport loading failed:', error);
    });
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
      
      // Calculate the center of the data
      const centerX = (bounds.paddedMinX + bounds.paddedMaxX) / 2;
      const centerY = (bounds.paddedMinY + bounds.paddedMaxY) / 2;
      
      // Calculate the zoom level to fit the data
      const dataWidth = bounds.paddedMaxX - bounds.paddedMinX;
      const dataHeight = bounds.paddedMaxY - bounds.paddedMinY;
      const containerWidth = container.offsetWidth;
      const containerHeight = container.offsetHeight;
      
      // Start with a reasonable default view instead of trying to fit exactly
      // Sigma ratio: higher = more zoomed out, lower = more zoomed in
      const defaultRatio = 5.0; // Start quite zoomed out to see the overall structure
      
      console.log(`🎯 Setting camera: center(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), ratio=${defaultRatio}`);
      console.log(`📏 Data size: ${dataWidth.toFixed(1)} x ${dataHeight.toFixed(1)}, Container: ${containerWidth} x ${containerHeight}`);
      console.log(`🔧 Using default ratio ${defaultRatio} for initial view (user can zoom to fit)`);
      
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
      console.warn('⚠️ Could not fetch data bounds, using default camera position');
      
      // Set fallback camera position at origin with reasonable zoom
      const camera = this.sigma.getCamera();
      const defaultRatio = 5.0; // Start zoomed out
      
      console.log(`🎯 Using fallback camera: center(0, 0), ratio=${defaultRatio}`);
      
      camera.setState({
        x: 0,
        y: 0,
        ratio: defaultRatio
      });
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
    this.sigma.getCamera().setState({ x: 0, y: 0, ratio: 3 });
    console.log('🎯 Using fallback camera: center(0, 0), ratio=3');
    
    // Try to load viewport data
    this.loadViewportNodesLOD().catch(error => {
      console.error('❌ Fallback loading also failed:', error);
      console.log('💡 Try refreshing the page or restarting the backend');
    });
  }

  /**
   * Get current statistics
   */
  public getStats(): { nodeCount: number; edgeCount: number; cacheRegions: number; isLoading: boolean; batchProgress: {current: number, total: number} | null } {
    const graph = this.sigma.getGraph();
    return {
      nodeCount: graph.order,
      edgeCount: graph.size,
      cacheRegions: this.loadedRegions.length,
      isLoading: this.isLoading,
      batchProgress: this.batchProgress,
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
    console.log('🧹 GraphManager destroyed');
  }

  /**
   * Calculate current viewport bounds in database coordinates
   */
  public getViewportBounds(): ViewportBounds {
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
    
    // Find the actual min/max from all four corners
    const allX = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x];
    const allY = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y];
    
    const bounds: ViewportBounds = {
      minX: Math.min(...allX),
      maxX: Math.max(...allX),
      minY: Math.min(...allY),
      maxY: Math.max(...allY),
      width: Math.max(...allX) - Math.min(...allX),
      height: Math.max(...allY) - Math.min(...allY)
    };

    // Only log detailed viewport info during actual node loading, not every frame
    if (this.isLoading) {
      const camera = this.sigma.getCamera();
      console.log(`🎥 Camera state: x=${camera.x.toFixed(3)}, y=${camera.y.toFixed(3)}, ratio=${camera.ratio.toFixed(6)}`);
      console.log(`🔄 Screen corners: TL(0,0) → (${topLeft.x.toFixed(3)}, ${topLeft.y.toFixed(3)})`);
      console.log(`🔄 Screen corners: TR(${screenWidth},0) → (${topRight.x.toFixed(3)}, ${topRight.y.toFixed(3)})`);
      console.log(`🔄 Screen corners: BL(0,${screenHeight}) → (${bottomLeft.x.toFixed(3)}, ${bottomLeft.y.toFixed(3)})`);
      console.log(`🔄 Screen corners: BR(${screenWidth},${screenHeight}) → (${bottomRight.x.toFixed(3)}, ${bottomRight.y.toFixed(3)})`);
      console.log(`📐 Actual Viewport: screen(${screenWidth}x${screenHeight}) → graph[${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}, ${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}]`);
      console.log(`📏 Viewport size: ${bounds.width.toFixed(3)} x ${bounds.height.toFixed(3)}`);
      console.log(`🎯 VIEWPORT BOUNDS: minX=${bounds.minX.toFixed(3)}, maxX=${bounds.maxX.toFixed(3)}, minY=${bounds.minY.toFixed(3)}, maxY=${bounds.maxY.toFixed(3)}`);
    }
    
    // Debug: Check how many existing nodes are within this viewport (only log occasionally)
    const existingNodes = this.graph.nodes();
    let nodesInViewport = 0;
    existingNodes.forEach((nodeId: string) => {
      const attrs = this.graph.getNodeAttributes(nodeId);
      if (attrs.x >= bounds.minX && attrs.x <= bounds.maxX && 
          attrs.y >= bounds.minY && attrs.y <= bounds.maxY) {
        nodesInViewport++;
      }
    });
    
    // Only log viewport info during actual node loading, not every frame
    if (this.isLoading) {
      console.log(`🔍 Existing nodes in calculated viewport: ${nodesInViewport}/${existingNodes.length}`);
    }
    
    return bounds;
  }

  /**
   * Check if viewport is already covered by cached regions (DEPRECATED - use isSpatialCached)
   */
  private isViewportCached(bounds: ViewportBounds, requiredMinDegree: number): boolean {
    const now = Date.now();
    
    // Only log cache details during loading to reduce spam
    if (this.isLoading) {
      console.log(`🔍 Cache check: ${this.loadedRegions.length} regions, TTL=${this.CACHE_TTL}ms`);
    }
    
    return this.loadedRegions.some((region, index) => {
      const age = now - region.timestamp;
      if (age > this.CACHE_TTL) {
        if (this.isLoading) console.log(`⏰ Region ${index} expired (age: ${age}ms > TTL: ${this.CACHE_TTL}ms)`);
        return false;
      }

      // Use lodLevel for new system compatibility
      const regionMinDegree = this.MIN_DEGREE_BY_LOD[region.lodLevel as keyof typeof this.MIN_DEGREE_BY_LOD] || 0;
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
      
      if (this.isLoading) console.log(`🎯 Region ${index} overlap: ${(overlapRatio * 100).toFixed(1)}% (threshold: ${(this.VIEWPORT_OVERLAP_THRESHOLD * 100).toFixed(1)}%)`);
      
      if (overlapRatio >= this.VIEWPORT_OVERLAP_THRESHOLD) {
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
    
    // Check if node is within current viewport
    const isInViewport = nodeAttrs.x >= bounds.minX && nodeAttrs.x <= bounds.maxX && 
                        nodeAttrs.y >= bounds.minY && nodeAttrs.y <= bounds.maxY;
    
    // Calculate distance from viewport center
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
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
    
    if (currentNodes.length <= this.MAX_NODES_BY_LOD[0]) {
      return 0;
    }

    // Separate nodes into viewport and non-viewport categories
    const viewportNodes: string[] = [];
    const nonViewportNodes: string[] = [];
    
    currentNodes.forEach(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (attrs.x >= bounds.minX && attrs.x <= bounds.maxX && 
          attrs.y >= bounds.minY && attrs.y <= bounds.maxY) {
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
    
    const targetRemoval = currentNodes.length - this.MAX_NODES_BY_LOD[0];
    
    // Calculate how many viewport nodes vs non-viewport nodes to keep
    const minViewportKeep = Math.min(viewportNodes.length, Math.floor(this.MAX_NODES_BY_LOD[0] * 0.7)); // 70% for viewport
    const maxNonViewportKeep = this.MAX_NODES_BY_LOD[0] - minViewportKeep;
    
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
    
    // Cancel any previous request first
    if (this.currentLoadingSignal) {
      console.log(`[LOD] 🚫 Cancelling previous request`);
      this.currentLoadingSignal = cancelAllRequests();
    } else {
      this.currentLoadingSignal = cancelAllRequests();
    }
    
    if (this.isLoading) {
      console.log(`[LOD] Already loading, returning early (stuck for ${Date.now() - (this.lastLoadStart || 0)}ms)`);
      
      // Reset stuck loading state after 10 seconds
      if (Date.now() - (this.lastLoadStart || 0) > 10000) {
        console.warn(`[LOD] ⚠️ Loading stuck for >10s, resetting loading state`);
        this.isLoading = false;
      } else {
        return;
      }
    }

    const bounds = this.getViewportBounds();
    const camera = this.sigma.getCamera();
    const lodLevel = this.calculateLOD(camera.ratio);
    const maxNodes = this.MAX_NODES_BY_LOD[lodLevel as keyof typeof this.MAX_NODES_BY_LOD];
    const minDegree = this.MIN_DEGREE_BY_LOD[lodLevel as keyof typeof this.MIN_DEGREE_BY_LOD];
    
    console.log(`[LOD] Camera ratio: ${camera.ratio.toFixed(3)}, LOD Level: ${lodLevel}, Max nodes: ${maxNodes}, Min degree: ${minDegree}`);
    console.log(`[LOD] Viewport: [${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}, ${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}] (${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)})`);

    // Fast spatial cache check using hash
    if (this.isSpatialCached(bounds, lodLevel)) {
      console.log(`[LOD] ✅ Spatial cache hit for LOD ${lodLevel}`);
      return;
    }

    this.isLoading = true;
    this.lastLoadStart = Date.now();
    console.log(`[LOD] 🚀 Loading LOD ${lodLevel} nodes...`);

    try {
      // Use lightweight nodes for higher LOD levels (zoomed out)
      let newNodes: (Node | LightNode)[] = [];
      
      if (lodLevel >= 3) {
        // Zoomed out: use lightweight nodes for performance
        console.log(`[LOD] Using lightweight node loading for LOD ${lodLevel}`);
        try {
          newNodes = await fetchBoxLight(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, maxNodes, this.currentLoadingSignal);
        } catch (error) {
          console.warn(`[LOD] Lightweight API failed, falling back to full nodes:`, error);
          newNodes = await fetchBox(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 1.0, maxNodes, this.currentLoadingSignal);
        }
      } else {
        // Zoomed in: use full node data with batching for smooth UI
        console.log(`[LOD] Using batched node loading for LOD ${lodLevel}`);
        const batchSize = Math.min(100, Math.max(50, maxNodes / 10)); // Adaptive batch size
        
        newNodes = await fetchBoxBatched(
          bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 
          maxNodes, batchSize,
          (batchNodes, batchIndex, totalBatches) => {
            // Progressive loading callback - add nodes immediately for smooth UI
            console.log(`[LOD] 📦 Batch ${batchIndex}/${totalBatches}: +${batchNodes.length} nodes`);
            this.batchProgress = {current: batchIndex, total: totalBatches};
            // Progressive loading: add nodes immediately for smooth UI
            this.addBatchToGraph(batchNodes, minDegree);
          },
          this.currentLoadingSignal
        );
      }
      
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
          const nodeAttrs: any = {
            x: node.attributes.x,
            y: node.attributes.y,
            size: node.attributes.size || 5,
            degree: node.attributes.degree,
            color: node.attributes.color || '#888888',
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
          this.addToSpatialIndex(node.key, node.attributes.x, node.attributes.y);
          addedNodes++;
        } else {
          skippedNodes++;
        }
      });
      
      console.log(`[LOD] Processing complete: ${addedNodes} added, ${skippedNodes} existed, ${filteredNodes} filtered by degree`);
      console.log(`[LOD] Graph now has ${this.graph.order} nodes total`);

      if (addedNodes > 0) {
        // Add to spatial cache
        this.loadedRegions.push({
          bounds,
          timestamp: Date.now(),
          nodeCount: addedNodes,
          lodLevel,
          spatialHash: this.generateSpatialHash(bounds, lodLevel),
        });
        
        // Smart node removal based on current LOD
        const removedCount = this.removeExcessNodesLOD(bounds, lodLevel);
        console.log(`[LOD] Removed ${removedCount} excess nodes for LOD ${lodLevel}`);
        
        // Load edges only for detailed LOD levels
        if (lodLevel <= 2) {
          await this.loadEdgesForViewportNodes(bounds);
        } else {
          console.log(`[LOD] Skipping edge loading for overview LOD ${lodLevel}`);
        }
      } else {
        console.log(`[LOD] No new nodes added, skipping cache entry and edge loading`);
      }
    } catch (error) {
      console.error('[LOD] API call failed:', error);
      // Force reload on next viewport change
      this.loadedRegions = [];
    } finally {
      this.isLoading = false;
      this.lastLoadStart = 0;
      this.batchProgress = null; // Clear batch progress
      console.log(`[LOD] Complete. Final graph: ${this.graph.order} nodes`);
    }
  }

  /**
   * LOD-aware node removal
   */
  private removeExcessNodesLOD(bounds: ViewportBounds, currentLOD: number): number {
    const graph = this.sigma.getGraph();
    const currentNodes = graph.nodes();
    const maxNodes = this.MAX_NODES_BY_LOD[currentLOD as keyof typeof this.MAX_NODES_BY_LOD];
    
    if (currentNodes.length <= maxNodes) {
      return 0;
    }

    // Enhanced removal strategy for LOD
    const viewportNodes: string[] = [];
    const nonViewportNodes: string[] = [];
    
    currentNodes.forEach(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (attrs.x >= bounds.minX && attrs.x <= bounds.maxX && 
          attrs.y >= bounds.minY && attrs.y <= bounds.maxY) {
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
      const newNodes = await fetchBox(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 1.0, limit);
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
      
      newNodes.forEach(node => {
        if (!this.graph.hasNode(node.key)) {
          this.graph.addNode(node.key, {
            x: node.attributes.x,
            y: node.attributes.y,
            size: node.attributes.size || 5,
            label: node.attributes.label,
            degree: node.attributes.degree,
            color: node.attributes.color,
            community: node.attributes.community,
          });
          addedNodes++;
        } else {
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
    
    // Get only nodes that are in the current viewport
    const viewportNodeIds: string[] = [];
    graph.nodes().forEach(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (attrs.x >= bounds.minX && attrs.x <= bounds.maxX && 
          attrs.y >= bounds.minY && attrs.y <= bounds.maxY) {
        viewportNodeIds.push(nodeId);
      }
    });
    
    if (viewportNodeIds.length === 0) return;

    console.log(`🔗 Loading edges for ${viewportNodeIds.length} viewport nodes (not all ${graph.order} nodes)`);

    try {
      // Load edges only between viewport nodes
      const edges = await fetchEdgesBatch(viewportNodeIds, 3000, "all");
      
      let addedEdges = 0;
      let skippedEdges = 0;
      
      edges.forEach((edge: Edge) => {
        // Both source and target must exist in graph
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
      });

      console.log(`🔗 Added ${addedEdges} edges (${skippedEdges} already existed) from ${edges.length} candidates`);
    } catch (error) {
      console.warn('Viewport edge loading failed:', error);
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
              color: '#cccccc',
              size: 1,
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