import { ViewportBounds, LoadResult, BatchProgress } from '../types/GraphTypes';
import { LevelOfDetail } from '../viewport/LevelOfDetail';
import { SpatialCache } from '../caching/SpatialCache';
import { 
  fetchBox, 
  fetchBoxLight, 
  fetchBoxBatched, 
  Node, 
  LightNode, 
  cancelAllRequests 
} from '../api/fetchNodes';

/**
 * 📦 Node Loader
 * 
 * Handles different node loading strategies and API communication.
 * Supports batched loading, lightweight loading, and progressive loading.
 */
export class NodeLoader {
  private lodManager: LevelOfDetail;
  private spatialCache: SpatialCache;
  private currentLoadingSignal: AbortSignal | null = null;
  private batchProgress: BatchProgress | null = null;

  constructor(lodManager: LevelOfDetail, spatialCache: SpatialCache) {
    this.lodManager = lodManager;
    this.spatialCache = spatialCache;
  }

  /**
   * Load nodes using LOD-aware strategy
   */
  async loadNodesLOD(
    bounds: ViewportBounds,
    lodLevel: number,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<LoadResult> {
    console.log(`[NodeLoader] Loading LOD ${lodLevel} nodes for bounds [${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}, ${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}]`);

    // Cancel any previous request
    this.currentLoadingSignal = cancelAllRequests();

    const maxNodes = this.lodManager.getMaxNodes(lodLevel);
    const minDegree = this.lodManager.getMinDegree(lodLevel);

    console.log(`[NodeLoader] LOD ${lodLevel}: max ${maxNodes} nodes, min degree ${minDegree}`);

    try {
      let nodes: (Node | LightNode)[] = [];
      
      if (lodLevel >= 3) {
        // Zoomed out: use lightweight nodes for performance
        console.log(`[NodeLoader] Using lightweight loading for LOD ${lodLevel}`);
        try {
          nodes = await fetchBoxLight(
            bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 
            maxNodes, this.currentLoadingSignal
          );
        } catch (error) {
          console.warn(`[NodeLoader] Lightweight API failed, falling back to full nodes:`, error);
          nodes = await fetchBox(
            bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 
            1.0, maxNodes, this.currentLoadingSignal
          );
        }
      } else {
        // Zoomed in: use full node data with batching for smooth UI
        console.log(`[NodeLoader] Using batched loading for LOD ${lodLevel}`);
        const batchSize = Math.min(100, Math.max(50, maxNodes / 10)); // Adaptive batch size
        
        nodes = await this.loadNodesBatched(
          bounds, batchSize, maxNodes,
          (batchNodes, batchIndex, totalBatches) => {
            console.log(`[NodeLoader] 📦 Batch ${batchIndex}/${totalBatches}: +${batchNodes.length} nodes`);
            this.batchProgress = {current: batchIndex, total: totalBatches};
            
            if (onProgress) {
              onProgress(this.batchProgress);
            }
          }
        );
      }

      console.log(`[NodeLoader] API returned ${nodes.length} nodes for LOD ${lodLevel}`);
      
      if (nodes.length > 0) {
        console.log(`[NodeLoader] Sample node: ${nodes[0].key} at (${nodes[0].attributes.x.toFixed(3)}, ${nodes[0].attributes.y.toFixed(3)}) degree=${nodes[0].attributes.degree}`);
      }

      return {
        nodes,
        addedCount: 0, // Will be set by caller after adding to graph
        filteredCount: 0, // Will be calculated by caller
        skippedCount: 0 // Will be calculated by caller
      };

    } catch (error) {
      console.error('[NodeLoader] Loading failed:', error);
      throw error;
    } finally {
      this.batchProgress = null;
    }
  }

  /**
   * Load nodes using batched strategy with progress callbacks
   */
  async loadNodesBatched(
    bounds: ViewportBounds,
    batchSize: number,
    totalLimit: number = 5000,
    onBatch?: (nodes: Node[], batchIndex: number, totalBatches: number) => void
  ): Promise<Node[]> {
    const allNodes: Node[] = [];
    const totalBatches = Math.ceil(totalLimit / batchSize);
    
    for (let i = 0; i < totalBatches; i++) {
      if (this.currentLoadingSignal?.aborted) {
        console.log(`[NodeLoader] 🚫 Batched loading cancelled at batch ${i + 1}/${totalBatches}`);
        break;
      }

      const currentBatchSize = Math.min(batchSize, totalLimit - allNodes.length);
      
      try {
        const batchNodes = await fetchBox(
          bounds.minX, bounds.maxX, bounds.minY, bounds.maxY,
          1.0, currentBatchSize, this.currentLoadingSignal
        );

        allNodes.push(...batchNodes);

        if (onBatch) {
          onBatch(batchNodes, i + 1, totalBatches);
        }

        // Break if we got fewer nodes than requested (no more available)
        if (batchNodes.length < currentBatchSize) {
          console.log(`[NodeLoader] 📦 Batch ${i + 1}: got ${batchNodes.length} < ${currentBatchSize} requested, ending early`);
          break;
        }

        // Break if we've reached our total limit
        if (allNodes.length >= totalLimit) {
          break;
        }

        // Small delay between batches to keep UI responsive
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }

      } catch (error) {
        console.error(`[NodeLoader] Batch ${i + 1} failed:`, error);
        break;
      }
    }

    console.log(`[NodeLoader] Batched loading complete: ${allNodes.length} total nodes`);
    return allNodes;
  }

  /**
   * Load lightweight nodes for overview modes
   */
  async loadNodesLight(
    bounds: ViewportBounds,
    limit: number = 5000
  ): Promise<LightNode[]> {
    console.log(`[NodeLoader] Loading ${limit} lightweight nodes`);
    
    try {
      this.currentLoadingSignal = cancelAllRequests();
      
      const nodes = await fetchBoxLight(
        bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 
        limit, this.currentLoadingSignal
      );

      console.log(`[NodeLoader] Lightweight loading complete: ${nodes.length} nodes`);
      return nodes;

    } catch (error) {
      console.error('[NodeLoader] Lightweight loading failed:', error);
      throw error;
    }
  }

  /**
   * Add batch of nodes to graph with filtering
   */
  addBatchToGraph(
    nodes: (Node | LightNode)[], 
    minDegree: number, 
    graph: any
  ): { addedCount: number; filteredCount: number; skippedCount: number } {
    let addedCount = 0;
    let filteredCount = 0;
    let skippedCount = 0;
    
    nodes.forEach(node => {
      // Apply LOD-based degree filtering
      if (node.attributes.degree < minDegree) {
        filteredCount++;
        return;
      }
      
      if (!graph.hasNode(node.key)) {
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
        
        graph.addNode(node.key, nodeAttrs);
        addedCount++;
      } else {
        skippedCount++;
      }
    });
    
    console.log(`[NodeLoader] Added ${addedCount} nodes, filtered ${filteredCount} by degree, skipped ${skippedCount} existing`);
    
    return { addedCount, filteredCount, skippedCount };
  }

  /**
   * Load nodes with caching support
   */
  async loadNodesWithCache(
    bounds: ViewportBounds,
    lodLevel: number,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<LoadResult> {
    // Check cache first
    if (this.spatialCache.isSpatialCached(bounds, lodLevel)) {
      console.log(`[NodeLoader] ♻️ Cache hit for LOD ${lodLevel}`);
      return {
        nodes: [],
        addedCount: 0,
        filteredCount: 0,
        skippedCount: 0
      };
    }

    // Load from API
    const result = await this.loadNodesLOD(bounds, lodLevel, onProgress);
    
    // Add to cache if successful
    if (result.nodes.length > 0) {
      this.spatialCache.addRegion(bounds, result.nodes.length, lodLevel);
    }

    return result;
  }

  /**
   * Get current batch progress
   */
  getBatchProgress(): BatchProgress | null {
    return this.batchProgress;
  }

  /**
   * Cancel current loading operation
   */
  cancelLoading(): void {
    if (this.currentLoadingSignal) {
      console.log('[NodeLoader] 🚫 Cancelling current loading operation');
      this.currentLoadingSignal = cancelAllRequests();
    }
  }

  /**
   * Check if currently loading
   */
  isLoading(): boolean {
    return this.currentLoadingSignal !== null && !this.currentLoadingSignal.aborted;
  }

  /**
   * Load nodes with fallback strategy
   */
  async loadNodesWithFallback(
    bounds: ViewportBounds,
    lodLevel: number,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<LoadResult> {
    try {
      // Try primary loading strategy
      return await this.loadNodesLOD(bounds, lodLevel, onProgress);
    } catch (primaryError) {
      console.warn('[NodeLoader] Primary loading failed, trying fallback:', primaryError);
      
      try {
        // Fallback to simple box loading
        this.currentLoadingSignal = cancelAllRequests();
        const maxNodes = this.lodManager.getMaxNodes(lodLevel);
        
        const nodes = await fetchBox(
          bounds.minX, bounds.maxX, bounds.minY, bounds.maxY,
          1.0, maxNodes, this.currentLoadingSignal
        );

        console.log(`[NodeLoader] Fallback loading successful: ${nodes.length} nodes`);
        
        return {
          nodes,
          addedCount: 0,
          filteredCount: 0,
          skippedCount: 0
        };
      } catch (fallbackError) {
        console.error('[NodeLoader] Fallback loading also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Get loading statistics
   */
  getLoadingStats(): {
    isLoading: boolean;
    batchProgress: BatchProgress | null;
    hasActiveSignal: boolean;
  } {
    return {
      isLoading: this.isLoading(),
      batchProgress: this.batchProgress,
      hasActiveSignal: this.currentLoadingSignal !== null
    };
  }
} 