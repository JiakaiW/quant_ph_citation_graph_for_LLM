/**
 * 📡 Standard Loading Strategy
 * 
 * Standard implementation of LoadingStrategy that loads nodes and edges
 * using the existing API endpoints with proper batching and viewport optimization.
 */

import { LoadingStrategy, LoadingResult, ViewportBounds, NodeData, EdgeData } from '../core/UnifiedGraphManager';
import { fetchBoxBatched, fetchEdgesBatch, Node } from '../../api/fetchNodes';
import { NodeServiceImpl } from '../services/NodeService';
import { ViewportServiceImpl } from '../services/ViewportService';
import { RequestManager } from '../api/RequestManager';

export interface StandardLoadingConfig {
  batchSize: number;
  maxNodes: number;
  maxEdges: number;
  minDegree: number;
  timeout: number;
  debug: boolean;
}

interface LODLevel {
  name: string;
  cameraRatio: number;
  maxNodes: number;
  minDegree: number;
  priority: number;
}

interface LoadedRegion {
  bounds: ViewportBounds;
  timestamp: number;
  nodeCount: number;
  lodLevel: number;
  spatialHash: string;
}

interface LoadingBatch {
  id: string;
  priority: number;
  timestamp: number;
  bounds: ViewportBounds;
  lodLevel: number;
  promise: Promise<NodeData[]>;
  controller: AbortController;
}

export class StandardLoadingStrategy implements LoadingStrategy {
  private nodeService: NodeServiceImpl;
  private viewportService: ViewportServiceImpl;
  private requestManager: RequestManager;
  private config: any; // Use any for now to allow LOD and performance config
  
  // LOD system
  private lodLevels: LODLevel[] = [];
  private currentLOD: number = 1;
  
  // Spatial caching
  private loadedRegions: LoadedRegion[] = [];
  private spatialIndex: Map<string, LoadedRegion> = new Map();
  
  // Batch management
  private activeBatches: Map<string, LoadingBatch> = new Map();
  private batchCounter: number = 0;
  
  // Performance tracking
  private lastViewportUpdate: number = 0;
  private viewportUpdateThrottle: number = 500;
  private consecutiveUpdateAttempts: number = 0;
  private maxConsecutiveUpdates: number = 3;
  private lastViewportHash: string = '';
  
  // State management
  private isLoading: boolean = false;
  private maxConcurrentBatches: number = 3;

  constructor(
    nodeService: NodeServiceImpl,
    viewportService: ViewportServiceImpl,
    config: any
  ) {
    this.nodeService = nodeService;
    this.viewportService = viewportService;
    this.requestManager = RequestManager.getInstance();
    this.config = config;
    
    this.initializeLODLevels();
    
    console.log('🚀 StandardLoadingStrategy initialized with LOD system');
  }

  /**
   * 🎯 Initialize LOD levels from config
   */
  private initializeLODLevels(): void {
    if (!this.config?.lod) {
      console.warn('🚀 No LOD config found, using defaults');
      this.lodLevels = this.getDefaultLODLevels();
      return;
    }

    const lodConfig = this.config.lod;
    this.lodLevels = [
      {
        name: 'paper',
        cameraRatio: lodConfig.thresholds.paper || 0.1,
        maxNodes: lodConfig.maxNodes.paper || 10000,
        minDegree: lodConfig.minDegree.paper || 1,
        priority: 10
      },
      {
        name: 'topic',
        cameraRatio: lodConfig.thresholds.topic || 3.0,
        maxNodes: lodConfig.maxNodes.topic || 10000,
        minDegree: lodConfig.minDegree.topic || 1,
        priority: 8
      },
      {
        name: 'field',
        cameraRatio: lodConfig.thresholds.field || 6.0,
        maxNodes: lodConfig.maxNodes.field || 10000,
        minDegree: lodConfig.minDegree.field || 1,
        priority: 6
      },
      {
        name: 'universe',
        cameraRatio: lodConfig.thresholds.universe || 10.0,
        maxNodes: lodConfig.maxNodes.universe || 10000,
        minDegree: lodConfig.minDegree.universe || 1,
        priority: 4
      }
    ].sort((a, b) => a.cameraRatio - b.cameraRatio); // Sort by camera ratio ascending

    console.log('🎯 LOD levels initialized:', this.lodLevels.map(l => l.name));
  }

  /**
   * 📊 Get default LOD levels if config is missing
   */
  private getDefaultLODLevels(): LODLevel[] {
    return [
      { name: 'paper', cameraRatio: 0.1, maxNodes: 10000, minDegree: 1, priority: 10 },
      { name: 'topic', cameraRatio: 3.0, maxNodes: 10000, minDegree: 1, priority: 8 },
      { name: 'field', cameraRatio: 6.0, maxNodes: 10000, minDegree: 1, priority: 6 },
      { name: 'universe', cameraRatio: 10.0, maxNodes: 10000, minDegree: 1, priority: 4 }
    ];
  }

  /**
   * 🔍 Calculate current LOD level based on camera ratio
   */
  private calculateLOD(cameraRatio: number): number {
    for (let i = 0; i < this.lodLevels.length; i++) {
      if (cameraRatio < this.lodLevels[i].cameraRatio) {
        return i;
      }
    }
    return this.lodLevels.length - 1; // Most zoomed out level
  }

  /**
   * 🗺️ Generate spatial hash for region caching
   */
  private generateSpatialHash(bounds: ViewportBounds, lodLevel: number): string {
    const gridSize = Math.pow(2, lodLevel + 2); // Larger grid for higher LOD
    const gridX = Math.floor(bounds.minX / gridSize);
    const gridY = Math.floor(bounds.minY / gridSize);
    const gridW = Math.ceil(bounds.width / gridSize);
    const gridH = Math.ceil(bounds.height / gridSize);
    return `${lodLevel}:${gridX},${gridY},${gridW},${gridH}`;
  }

  /**
   * 🔍 Check if viewport region is already cached
   */
  private isSpatialCached(bounds: ViewportBounds, lodLevel: number): boolean {
    const targetHash = this.generateSpatialHash(bounds, lodLevel);
    const now = Date.now();
    const cacheTTL = this.config?.performance?.cache?.ttl || 10000;
    
    return this.loadedRegions.some(region => {
      if (now - region.timestamp > cacheTTL) return false;
      if (region.lodLevel !== lodLevel) return false;
      return region.spatialHash === targetHash;
    });
  }

  /**
   * 🧹 Clean up old cached regions
   */
  private cleanupOldRegions(): void {
    const now = Date.now();
    const cacheTTL = this.config?.performance?.cache?.ttl || 10000;
    const maxRegions = this.config?.performance?.cache?.maxRegions || 100;
    
    // Remove expired regions
    this.loadedRegions = this.loadedRegions.filter(region => {
      if (now - region.timestamp > cacheTTL) {
        this.spatialIndex.delete(region.spatialHash);
        return false;
      }
      return true;
    });
    
    // Limit total regions
    if (this.loadedRegions.length > maxRegions) {
      const toRemove = this.loadedRegions.length - maxRegions;
      const removed = this.loadedRegions.splice(0, toRemove);
      removed.forEach(region => this.spatialIndex.delete(region.spatialHash));
    }
  }

  /**
   * 🎯 Main loading implementation with LOD awareness
   */
  async loadViewport(bounds: ViewportBounds): Promise<LoadingResult> {
    // Throttle viewport updates
    const now = Date.now();
    if (now - this.lastViewportUpdate < this.viewportUpdateThrottle) {
      console.log('🚀 Viewport update throttled');
      return { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
    }

    // Prevent infinite loops
    this.consecutiveUpdateAttempts++;
    if (this.consecutiveUpdateAttempts > this.maxConsecutiveUpdates) {
      console.warn('🚀 Too many consecutive updates, blocking');
      setTimeout(() => { this.consecutiveUpdateAttempts = 0; }, 2000);
      return { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
    }

    // Check for duplicate viewports
    const currentHash = this.createViewportHash(bounds);
    if (this.lastViewportHash === currentHash) {
      console.log('🚀 Duplicate viewport detected, skipping');
      this.consecutiveUpdateAttempts = 0;
      return { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
    }

    try {
      this.lastViewportUpdate = now;
      this.lastViewportHash = currentHash;
      this.consecutiveUpdateAttempts = 0;

      // Get current camera state and calculate LOD
      const viewport = this.viewportService.getCurrentViewport();
      const cameraRatio = viewport.cameraRatio;
      const currentLOD = this.calculateLOD(cameraRatio);
      const lodLevel = this.lodLevels[currentLOD];

      console.log(`🚀 Loading viewport: LOD=${lodLevel.name} (${currentLOD}), ratio=${cameraRatio.toFixed(3)}`);

      // Check spatial cache
      if (this.isSpatialCached(bounds, currentLOD)) {
        console.log('🚀 Viewport region cached, skipping load');
        return { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
      }

      // Cancel conflicting batches
      this.cancelConflictingBatches(bounds, currentLOD);

      // Load nodes for this viewport and LOD level
      const nodes = await this.loadViewportNodesWithLOD(bounds, currentLOD, lodLevel);

      // Update spatial cache
      this.updateSpatialCache(bounds, currentLOD, nodes.length);

      // Clean up old cache entries
      this.cleanupOldRegions();

      // We don't load edges in this strategy (performance optimization)
      const result: LoadingResult = {
        nodes,
        edges: [], // No edges for performance
        stats: {
          nodeCount: nodes.length,
          edgeCount: 0
        }
      };

      console.log(`🚀 Loaded ${nodes.length} nodes for LOD level ${lodLevel.name}`);
      return result;

    } catch (error) {
      console.error('🚀 Error loading viewport:', error);
      return { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
    }
  }

  /**
   * 🔍 Load specific node with neighbors (for search functionality)
   */
  async loadNode(nodeId: string): Promise<NodeData | null> {
    try {
      console.log(`🚀 Loading specific node: ${nodeId}`);
      
      // Use high priority request
      const requestKey = `node-${nodeId}`;
      const result = await this.requestManager.queueRequest(
        'nodes',
        requestKey,
        100, // High priority
        async (signal: AbortSignal) => {
          return await this.nodeService.getNodesInBounds({
            minX: -Infinity,
            maxX: Infinity,
            minY: -Infinity,
            maxY: Infinity,
            width: 0,
            height: 0
          }, { 
            nodeIds: [nodeId],
            limit: 1,
            minDegree: 0
          });
        }
      );

      if (result && result.length > 0) {
        console.log(`🚀 Successfully loaded node ${nodeId}`);
        return result[0];
      }
      
      return null;
    } catch (error) {
      console.error(`🚀 Error loading node ${nodeId}:`, error);
      return null;
    }
  }

  /**
   * 🔍 Load neighbors of a specific node (for search highlighting)
   */
  async loadNodeNeighbors(nodeId: string, depth: number = 1): Promise<NodeData[]> {
    try {
      console.log(`🚀 Loading neighbors of ${nodeId} (depth: ${depth})`);
      
      // For now, we focus on direct neighbors only (depth=1)
      // This can be enhanced later for multi-hop neighbors
      const requestKey = `neighbors-${nodeId}-${depth}`;
      
      const result = await this.requestManager.queueRequest(
        'nodes',
        requestKey,
        90, // High priority
        async (signal: AbortSignal) => {
          // Get a wider bounds around the target node to capture neighbors
          const targetNode = await this.loadNode(nodeId);
          if (!targetNode) {
            return [];
          }

          const padding = 1000; // Coordinate units
          const bounds: ViewportBounds = {
            minX: targetNode.x - padding,
            maxX: targetNode.x + padding,
            minY: targetNode.y - padding,
            maxY: targetNode.y + padding,
            width: padding * 2,
            height: padding * 2
          };

          return await this.nodeService.getNodesInBounds(bounds, {
            limit: 50, // Reasonable neighbor limit
            minDegree: 1
          });
        }
      );

      console.log(`🚀 Loaded ${result.length} potential neighbors for ${nodeId}`);
      return result || [];

    } catch (error) {
      console.error(`🚀 Error loading neighbors for ${nodeId}:`, error);
      return [];
    }
  }

  /**
   * 📦 Load viewport nodes with LOD awareness and batching
   */
  private async loadViewportNodesWithLOD(
    bounds: ViewportBounds, 
    lodIndex: number, 
    lodLevel: LODLevel
  ): Promise<NodeData[]> {
    const batchId = `viewport-${this.batchCounter++}`;
    const controller = new AbortController();

    try {
      this.isLoading = true;

      // Limit concurrent batches
      if (this.activeBatches.size >= this.maxConcurrentBatches) {
        console.log('🚀 Max concurrent batches reached, waiting...');
        await this.waitForBatchSlot();
      }

      // Create batch
      const batch: LoadingBatch = {
        id: batchId,
        priority: lodLevel.priority,
        timestamp: Date.now(),
        bounds: bounds,
        lodLevel: lodIndex,
        controller,
        promise: this.executeBatchLoad(bounds, lodLevel, controller.signal)
      };

      this.activeBatches.set(batchId, batch);

      // Execute the batch
      const nodes = await batch.promise;
      
      return nodes;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚀 Batch ${batchId} was cancelled`);
        return [];
      }
      console.error(`🚀 Error in batch ${batchId}:`, error);
      return [];
    } finally {
      this.activeBatches.delete(batchId);
      this.isLoading = false;
    }
  }

  /**
   * ⚙️ Execute the actual batch loading
   */
  private async executeBatchLoad(
    bounds: ViewportBounds,
    lodLevel: LODLevel,
    signal: AbortSignal
  ): Promise<NodeData[]> {
    const requestKey = `batch-${Date.now()}-${Math.random()}`;
    
    return await this.requestManager.queueRequest(
      'nodes',
      requestKey,
      lodLevel.priority,
      async (requestSignal: AbortSignal) => {
        // Create combined signal that responds to both batch and request cancellation
        const combinedController = new AbortController();
        
        const abortHandler = () => combinedController.abort();
        signal.addEventListener('abort', abortHandler);
        requestSignal.addEventListener('abort', abortHandler);

        try {
          return await this.nodeService.getNodesInBounds(bounds, {
            limit: lodLevel.maxNodes,
            minDegree: lodLevel.minDegree,
            signal: combinedController.signal
          });
        } finally {
          signal.removeEventListener('abort', abortHandler);
          requestSignal.removeEventListener('abort', abortHandler);
        }
      }
    );
  }

  /**
   * ⏳ Wait for a batch slot to become available
   */
  private async waitForBatchSlot(): Promise<void> {
    return new Promise((resolve) => {
      const checkSlot = () => {
        if (this.activeBatches.size < this.maxConcurrentBatches) {
          resolve();
        } else {
          setTimeout(checkSlot, 100);
        }
      };
      checkSlot();
    });
  }

  /**
   * 🚫 Cancel conflicting batches
   */
  private cancelConflictingBatches(bounds: ViewportBounds, lodLevel: number): void {
    for (const [batchId, batch] of this.activeBatches.entries()) {
      // Cancel batches for different LOD levels
      if (batch.lodLevel !== lodLevel) {
        console.log(`🚫 Cancelling conflicting batch ${batchId} (LOD ${batch.lodLevel} != ${lodLevel})`);
        batch.controller.abort();
        this.activeBatches.delete(batchId);
      }
    }
  }

  /**
   * 💾 Update spatial cache with loaded region
   */
  private updateSpatialCache(bounds: ViewportBounds, lodLevel: number, nodeCount: number): void {
    const spatialHash = this.generateSpatialHash(bounds, lodLevel);
    const region: LoadedRegion = {
      bounds,
      timestamp: Date.now(),
      nodeCount,
      lodLevel,
      spatialHash
    };

    this.loadedRegions.push(region);
    this.spatialIndex.set(spatialHash, region);
  }

  /**
   * 🔧 Create viewport hash for duplicate detection
   */
  private createViewportHash(bounds: ViewportBounds): string {
    return `${bounds.minX.toFixed(6)},${bounds.maxX.toFixed(6)},${bounds.minY.toFixed(6)},${bounds.maxY.toFixed(6)}`;
  }

  /**
   * 📊 Get loading statistics
   */
  getStats(): any {
    return {
      isLoading: this.isLoading,
      activeBatches: this.activeBatches.size,
      loadedRegions: this.loadedRegions.length,
      currentLOD: this.currentLOD,
      lodLevels: this.lodLevels.map(l => l.name),
      requestManager: this.requestManager.getStatus()
    };
  }

  /**
   * 🧹 Cleanup resources
   */
  dispose(): void {
    // Cancel all active batches
    for (const batch of this.activeBatches.values()) {
      batch.controller.abort();
    }
    this.activeBatches.clear();

    // Clear spatial cache
    this.loadedRegions = [];
    this.spatialIndex.clear();

    console.log('🚀 StandardLoadingStrategy disposed');
  }
} 