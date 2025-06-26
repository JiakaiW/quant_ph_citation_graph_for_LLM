/**
 * 🚀 Enhanced Loading Strategy (Phase 2)
 * 
 * Advanced loading strategy with LOD system, search support, and performance optimization.
 * Features from original GraphManager:
 * - Level of Detail (LOD) based loading with config-driven thresholds
 * - Batched loading with query cancellation via RequestManager
 * - Spatial caching and region management
 * - Search functionality support (load specific nodes + neighbors)
 * - Nodes-only loading (no edges for performance)
 * - Viewport-aware smart loading with throttling
 * - Config integration for visual settings and thresholds
 */

import { LoadingStrategy, LoadingResult, ViewportBounds, NodeData, EdgeData } from '../core/UnifiedGraphManager';
import { fetchBoxBatched, Node } from '../../api/fetchNodes';
import { RequestManager } from '../api/RequestManager';
import { ViewportServiceImpl } from '../services/ViewportService';

/**
 * LOD Configuration from config.yaml
 */
interface LODConfig {
  thresholds: {
    paper: number;
    topic: number;
    field: number;
    universe: number;
  };
  maxNodes: {
    paper: number;
    topic: number;
    field: number;
    universe: number;
  };
  minDegree: {
    paper: number;
    topic: number;
    field: number;
    universe: number;
  };
}

/**
 * Performance Configuration
 */
interface PerformanceConfig {
  cache: {
    ttl: number;
    maxRegions: number;
    overlapThreshold: number;
  };
  loading: {
    batchSize: number;
    maxConcurrentBatches: number;
    smartTermination: boolean;
  };
}

/**
 * Enhanced Loading Strategy Configuration
 */
export interface EnhancedLoadingConfig {
  batchSize: number;
  maxNodes: number;
  maxEdges: number;
  minDegree: number;
  timeout: number;
  debug: boolean;
  lod?: LODConfig;
  performance?: PerformanceConfig;
  viewport?: {
    coordinateScale: number;
  };
}

/**
 * LOD Level Definition
 */
interface LODLevel {
  name: string;
  cameraRatio: number;
  maxNodes: number;
  minDegree: number;
  priority: number;
}

/**
 * Cached Region Information
 */
interface LoadedRegion {
  bounds: ViewportBounds;
  timestamp: number;
  nodeCount: number;
  lodLevel: number;
  spatialHash: string;
}

/**
 * Loading Batch for Request Management
 */
interface LoadingBatch {
  id: string;
  priority: number;
  timestamp: number;
  bounds: ViewportBounds;
  lodLevel: number;
  controller: AbortController;
}

export class EnhancedLoadingStrategy implements LoadingStrategy {
  private config: EnhancedLoadingConfig;
  private requestManager: RequestManager;
  private sigma: any; // Sigma instance for camera access
  private viewportService: ViewportServiceImpl;
  
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
  private loadedRegionKeys: Set<string> = new Set();

  constructor(
    config: EnhancedLoadingConfig,
    sigma: any,
    viewportService: ViewportServiceImpl
  ) {
    this.config = config;
    this.sigma = sigma;
    this.viewportService = viewportService;
    this.requestManager = RequestManager.getInstance();
    
    this.initializeLODLevels();
    this.maxConcurrentBatches = config.performance?.loading?.maxConcurrentBatches || 3;
    
    console.log('🚀 EnhancedLoadingStrategy initialized with LOD system');
  }

  // LoadingStrategy interface implementation
  async initialize(bounds: ViewportBounds): Promise<void> {
    // Clear any existing state
    this.loadedRegions = [];
    this.spatialIndex.clear();
    this.activeBatches.clear();
    this.loadedRegionKeys.clear();
    
    // Initialize LOD system
    this.initializeLODLevels();
    
    if (this.config.debug) {
      console.log('🚀 EnhancedLoadingStrategy initialized with bounds:', bounds);
    }
  }

  async loadViewport(bounds: ViewportBounds): Promise<LoadingResult> {
    try {
      // Check if we should throttle updates
      const now = Date.now();
      if (now - this.lastViewportUpdate < this.viewportUpdateThrottle) {
        return { nodes: [], edges: [], hasMore: false };
      }
      this.lastViewportUpdate = now;

      // Get current LOD level based on camera ratio
      const cameraRatio = this.getCurrentCameraRatio();
      const lodIndex = this.calculateLOD(cameraRatio);
      const lodLevel = this.lodLevels[lodIndex];

      // Cancel any conflicting batches
      this.cancelConflictingBatches(bounds, lodIndex);

      // Load nodes for current viewport and LOD level
      const nodes = await this.loadViewportNodesWithLOD(bounds, lodIndex, lodLevel);

      // Update spatial cache
      this.updateSpatialCache(bounds, lodIndex, nodes.length);

      // Return results (no edges in Phase 2)
      return {
        nodes,
        edges: [], // Phase 2: No edges
        hasMore: nodes.length >= lodLevel.maxNodes,
        stats: {
          lodLevel: lodLevel.name,
          cameraRatio,
          nodeCount: nodes.length
        }
      };

    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('🚀 Error in loadViewport:', error.message);
      } else {
        console.error('🚀 Unknown error in loadViewport');
      }
      throw error;
    }
  }

  cleanup(): void {
    // Cancel all active batches
    for (const batch of this.activeBatches.values()) {
      batch.controller.abort();
    }
    this.activeBatches.clear();

    // Clear spatial cache
    this.loadedRegions = [];
    this.spatialIndex.clear();
    this.loadedRegionKeys.clear();

    console.log('🚀 EnhancedLoadingStrategy cleaned up');
  }

  // Enhanced functionality methods

  /**
   * 🎯 Initialize LOD levels from config
   */
  private initializeLODLevels(): void {
    if (!this.config.lod) {
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
    const cacheTTL = this.config.performance?.cache?.ttl || 10000;
    
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
    const cacheTTL = this.config.performance?.cache?.ttl || 10000;
    const maxRegions = this.config.performance?.cache?.maxRegions || 100;
    
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
  private async loadViewportNodesWithLOD(
    bounds: ViewportBounds, 
    lodIndex: number, 
    lodLevel: LODLevel
  ): Promise<NodeData[]> {
    try {
      // Wait for a batch slot
      await this.waitForBatchSlot();
      
      // Create abort controller for this batch
      const controller = new AbortController();
      const batchId = `batch-${++this.batchCounter}`;
      
      // Register batch
      this.activeBatches.set(batchId, {
        id: batchId,
        priority: lodLevel.priority,
        timestamp: Date.now(),
        bounds,
        lodLevel: lodIndex,
        controller
      });
      
      // Execute batch load
      const rawNodes = await this.executeBatchLoad(bounds, lodLevel, controller.signal);
      
      // Transform nodes to NodeData format
      const coordinateScale = this.config.viewport?.coordinateScale || 1000;
      const nodes: NodeData[] = rawNodes.map(node => {
        const cluster_id = typeof node.attributes.cluster_id === 'number' 
          ? node.attributes.cluster_id 
          : typeof node.attributes.community === 'number'
          ? node.attributes.community
          : 0;

        return {
          key: node.key,
          x: node.attributes.x * coordinateScale,
          y: node.attributes.y * coordinateScale,
          degree: node.attributes.degree || 0,
          cluster_id,
          label: node.attributes.label || node.key
        };
      });
      
      // Cleanup batch
      this.activeBatches.delete(batchId);
      
      return nodes;
      
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('🚀 Error in loadViewportNodesWithLOD:', error.message);
      } else {
        console.error('🚀 Unknown error in loadViewportNodesWithLOD');
      }
      return [];
    }
  }

  /**
   * ⚙️ Execute the actual batch loading
   */
  private async executeBatchLoad(
    bounds: ViewportBounds,
    lodLevel: LODLevel,
    signal: AbortSignal
  ): Promise<Node[]> {
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
          const apiResult = await fetchBoxBatched(
            bounds.minX,
            bounds.maxX,
            bounds.minY,
            bounds.maxY,
            lodLevel.maxNodes,
            this.config.batchSize,
            undefined, // onBatch callback not needed
            combinedController.signal
          );

          if (!apiResult || !Array.isArray(apiResult)) {
            return [];
          }

          // Filter by degree
          return apiResult.filter((node: Node) => 
            (node.attributes.degree || 0) >= lodLevel.minDegree
          );

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
   * 📹 Get current camera ratio from sigma instance
   */
  private getCurrentCameraRatio(): number {
    if (this.sigma && this.sigma.getCamera) {
      return this.sigma.getCamera().ratio;
    }
    return 1.0; // Default ratio
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
} 