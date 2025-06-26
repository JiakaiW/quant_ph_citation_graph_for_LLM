/**
 * 🌳 Tree-First Graph Manager - Eliminates Node/Edge Sync Issues
 * 
 * Revolutionary approach based on DAG structure analysis:
 * - Atomic node+tree loading (guaranteed connectivity)
 * - Progressive enrichment with extra edges
 * - Simple append-only operations (no complex sync)
 * - Clear hierarchical navigation
 * - 4-tier LOD system for scalable visualization
 */

import { Sigma } from 'sigma';
import Graph from 'graphology';
import { fetchBoxBatched, Node } from '../api/fetchNodes';
import { AppConfig } from './config/ConfigLoader';
import { ClusterManager } from './clustering/ClusterManager';
import { debounce } from 'lodash';
import { CoordinateManager } from './coordinates/CoordinateManager';
import { EdgeCacheManager } from './EdgeCacheManager';
import { getConfig } from './config/ConfigLoader';
import { SearchManager } from './search/SearchManager';

interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

interface NodeState {
  hasTreeEdges: boolean;
  hasExtraEdges: boolean;
  enrichmentRequested: boolean;
  lodLevel: LODLevel;
  lastSeen: number;
  priority: number;
}

interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  isLoading: boolean;
  loadingStatus?: {
    state: 'idle' | 'loading_batches' | 'removing_nodes' | 'max_nodes_reached';
    message?: string;
    batchesLoaded?: number;
    maxNodesReached?: boolean;
    removedNodesCount?: number;
  };
  hasMore: boolean;
  lodLevel?: string;
  visibleNodes?: number;
  visibleEdges?: number;
  enrichedNodes?: number;
  datasetBounds?: {
    x: { min: number; max: number };
    y: { min: number; max: number };
  };
  viewportRange?: {
    x: { min: number; max: number };
    y: { min: number; max: number };
  };
}

interface LoaderData {
  nodes: Array<{
    key: string;
    attributes: {
      x: number;
      y: number;
      label?: string;
      degree: number;
      cluster_id: string;
    };
  }>;
  treeEdges?: Array<{ source: string; target: string }>;
  hasMore: boolean;
}

type LODLevel = 'universe' | 'field' | 'topic' | 'paper';

interface ExtendedNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  degree: number;
  cluster_id?: string;
  community?: number;
}

interface EdgeAttributes {
  isTreeEdge: boolean;
  size: number;
  color: string;
  hidden: boolean;
  [key: string]: any;
}

interface ExtraEdge {
  source: string;
  target: string;
  attributes?: {
    [key: string]: any;
  };
}

interface EnrichmentResponse {
  extraEdges: ExtraEdge[];
  nodeFlags: {
    [nodeId: string]: {
      enriched: boolean;
    };
  };
}

interface NodeData {
  key: string;
  x: number;
  y: number;
  cluster_id: number;
  [key: string]: any;
}

interface EdgeData {
  source: string;
  target: string;
  [key: string]: any;
}

interface NodePriorityData {
  nodeId: string;
  degree: number;
  distanceFromCenter: number;
  lastSeen: number;
  lodLevel: LODLevel;
}

export class TreeFirstGraphManager {
  private graph: Graph;
  private sigma: Sigma;
  private config: AppConfig;
  private currentLODLevel: LODLevel = 'universe';
  private nodeStates: Map<string, NodeState> = new Map();
  private lastLoadedCameraState: any = null;
  private clusterManager: ClusterManager;
  private edgeCacheManager: EdgeCacheManager;
  private coordinateManager: CoordinateManager;
  private currentLoadingController: AbortController | null = null;
  private loadedRegions: Set<string> = new Set(); // Track loaded regions
  private currentRegionKey: string | null = null;  // Current region being viewed
  private searchManager: SearchManager | null = null;  // Search manager instance
  private nodePriorityManager = {
    addNode: (data: NodePriorityData) => {
      // Simple implementation that just stores the data
      // This will be replaced with a proper implementation later
      const key = data.nodeId;
      this.nodeStates.set(key, {
        hasTreeEdges: false,
        hasExtraEdges: false,
        enrichmentRequested: false,
        lodLevel: data.lodLevel,
        lastSeen: data.lastSeen,
        priority: data.degree
      });
    }
  };
  private stats: GraphStats = {
    nodeCount: 0,
    edgeCount: 0,
    isLoading: false,
    hasMore: false
  };
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly dwellDelay = 1000; // ms to wait before enriching
  private needsLoad: boolean = true;
  private lastBounds: ViewportBounds | null = null;
  private isLoopRunning: boolean = false;
  private readonly loopInterval = 250; // ms
  private isLoading: boolean = false;

  constructor(
    sigma: Sigma,
    config: AppConfig,
    clusterManager: ClusterManager,
    searchManager?: SearchManager
  ) {
    this.sigma = sigma;
    this.config = config;
    this.clusterManager = clusterManager;
    this.graph = sigma.getGraph();
    this.edgeCacheManager = new EdgeCacheManager();
    this.coordinateManager = new CoordinateManager(sigma, config.viewport.coordinateScale);
    this.searchManager = searchManager || null;

    // Initialize edge cache after graph is set
    this.edgeCacheManager.setGraph(this.graph);
  }

  public async initialize(): Promise<void> {
    try {
      await this.loadInitialDataAndSetCamera();
      this.initializeEventListeners();
    } catch (error) {
      console.error('Failed to initialize TreeFirstGraphManager:', error);
      this.initializeWithFallback();
    }
  }

  private debouncedCheckForLoad = debounce(async () => {
    const camera = this.sigma.getCamera();
    const currentState = camera.getState();

    // 1. Check for LOD transition
    const newLODLevel = this.calculateLODLevel();
    let needsLoad = false;

    if (newLODLevel !== this.currentLODLevel) {
      this.handleLODTransition(newLODLevel);
      needsLoad = true;
    }

    // 2. Check for significant viewport change if LOD hasn't changed
    const lastState = this.lastLoadedCameraState;
    if (!needsLoad && lastState) {
      const ratioChange = Math.abs(currentState.ratio - lastState.ratio) / lastState.ratio;
      
      const cameraDistance = Math.sqrt(Math.pow(currentState.x - lastState.x, 2) + Math.pow(currentState.y - lastState.y, 2));
      const { width } = this.sigma.getDimensions();
      const viewportWidthInGraphUnits = width / currentState.ratio;
      const positionChange = cameraDistance / viewportWidthInGraphUnits;

      if (ratioChange > 0.1 || positionChange > 0.1) { // 10% change in zoom or position
        needsLoad = true;
      }
    }

    if (needsLoad || !this.lastLoadedCameraState) {
      await this.loadViewportData();
      this.lastLoadedCameraState = currentState; // Update state only after a successful load
    }
  }, 300);

  private async loadInitialDataAndSetCamera(): Promise<void> {
    try {
      // Set initial camera position
      const camera = this.sigma.getCamera();
      camera.setState({
        x: 0,
        y: 0,
        ratio: 1.0
      });

      // Load initial data
      await this.loadViewportData();

      // Calculate position distribution from the loaded nodes
      const positions = Array.from(this.graph.nodes()).map(nodeId => {
        const attrs = this.graph.getNodeAttributes(nodeId);
        return {
          x: attrs.x,
          y: attrs.y
        };
      });

      if (positions.length === 0) {
        console.warn('No initial nodes received for camera bounds calculation');
        return;
      }

      const stats = this.calculatePositionStats(positions);
      console.log('📊 Node position distribution:', stats);

      // Set camera to center on the mean position with padding
      const padding = 1.2; // Add 20% padding
      
      const { width, height } = this.sigma.getDimensions();
      const xRange = Math.max(1, (stats.maxX - stats.minX)) * padding;
      const yRange = Math.max(1, (stats.maxY - stats.minY)) * padding;
      
      // Calculate ratio to fit the graph in the viewport
      const ratio = Math.max(
        xRange / width,
        yRange / height,
        this.config.viewport.minCameraRatio || 0.005
      );

      // Set the camera position
      camera.setState({
        x: (stats.minX + stats.maxX) / 2,
        y: (stats.minY + stats.maxY) / 2,
        ratio: ratio
      });
    } catch (error) {
      console.error('Error in loadInitialDataAndSetCamera:', error);
    }
  }

  private initializeWithFallback(): void {
    console.log('🔄 Initializing TreeFirstGraphManager with fallback data...');
    
    // Use hardcoded camera position for quantum physics dataset
    const camera = this.sigma.getCamera();
    camera.setState({ x: 0, y: 0, ratio: 1.0 });
    
    // Try to load viewport data
    this.loadViewportNodesLOD().catch(error => {
      console.error('❌ Fallback loading failed:', error);
      console.log('💡 Try refreshing the page or restarting the backend');
    });
  }

  private addNodesAndEdges(data: LoaderData): void {
    const lodLevel = this.calculateLODLevel();
    const sortedNodes = this.sortNodesByImportance(data.nodes);
    const ratio = this.sigma.getCamera().ratio;
    const isDetailedView = ratio < 2.0;

    // Add nodes
    sortedNodes.forEach(node => {
      const graphCoords = this.coordinateManager.toGraphCoords(
        node.attributes.x,
        node.attributes.y
      );

      if (!this.graph.hasNode(node.key)) {
        const nodeAttrs = {
          ...node.attributes,
          x: graphCoords.x,
          y: graphCoords.y,
          size: this.calculateNodeSize(node.attributes.degree, lodLevel),
          degree: node.attributes.degree,
          color: this.clusterManager.getClusterColor(parseInt(node.attributes.cluster_id, 10)),
          label: isDetailedView ? (node.attributes.label || `Node ${node.key.substring(0, 8)}...`) : null,
          cluster_id: node.attributes.cluster_id
        };

        this.graph.addNode(node.key, nodeAttrs);
      }
    });

    // Add edges (they will be hidden by default due to the edge reducer)
    if (data.treeEdges) {
      data.treeEdges.forEach(edge => {
        if (!this.graph.hasEdge(edge.source, edge.target)) {
          const edgeAttrs = {
            isTreeEdge: true,
            size: this.calculateEdgeSize(lodLevel),
            color: 'rgba(68, 68, 68, 0.7)',
            hidden: true // Hidden by default
          };
          
          this.graph.addEdge(edge.source, edge.target, edgeAttrs);
          this.edgeCacheManager.addEdge(edge.source, edge.target, true);
        }
      });
    }

    // Update stats with new counts
    this.updateStats({ 
      hasMore: data.hasMore,
      nodeCount: this.graph.order,
      edgeCount: this.graph.size,
      visibleNodes: this.getVisibleNodes().length,
      visibleEdges: this.graph.edges().length
    });

    // Force a single render update
    this.sigma.refresh();
  }

  private calculatePositionStats(positions: Array<{ x: number; y: number }>): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    meanX: number;
    meanY: number;
  } {
    if (positions.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, meanX: 0, meanY: 0 };
    }

    const stats = positions.reduce((acc, pos) => ({
      minX: Math.min(acc.minX, pos.x),
      maxX: Math.max(acc.maxX, pos.x),
      minY: Math.min(acc.minY, pos.y),
      maxY: Math.max(acc.maxY, pos.y),
      sumX: acc.sumX + pos.x,
      sumY: acc.sumY + pos.y
    }), {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      sumX: 0,
      sumY: 0
    });

    return {
      minX: stats.minX,
      maxX: stats.maxX,
      minY: stats.minY,
      maxY: stats.maxY,
      meanX: stats.sumX / positions.length,
      meanY: stats.sumY / positions.length
    };
  }

  private calculateLODLevel(): LODLevel {
    const ratio = this.sigma.getCamera().ratio;
    const thresholds = this.config.lod.thresholds;
    
    if (ratio >= thresholds.universe) return 'universe';
    if (ratio >= thresholds.field) return 'field';
    if (ratio >= thresholds.topic) return 'topic';
    return 'paper';
  }

  private handleLODTransition(newLevel: LODLevel): void {
    const oldLevel = this.currentLODLevel;
    console.log(`🔄 LOD transition: ${oldLevel} -> ${newLevel}`);
    this.currentLODLevel = newLevel;
    this.updateStats({ lodLevel: newLevel });
    
    const oldValue = this.getLODValue(oldLevel);
    const newValue = this.getLODValue(newLevel);
    
    // Zooming out to a less detailed level
    if (newValue > oldValue) {
      console.log('Zooming out, pruning less important nodes...');
      const minDegree = this.config.lod.minDegree[newLevel] || 1;
      
      // Batch collect nodes to remove
      const nodesToRemove: string[] = [];
      this.graph.forEachNode((nodeId, attrs) => {
        if (attrs.degree < minDegree) {
          nodesToRemove.push(nodeId);
        }
      });

      // Batch remove nodes
      if (nodesToRemove.length > 0) {
        // Use requestAnimationFrame to avoid blocking the main thread
        requestAnimationFrame(() => {
          nodesToRemove.forEach(nodeId => {
            this.graph.dropNode(nodeId);
            this.nodeStates.delete(nodeId);
          });
          this.sigma.refresh();
          console.log(`Pruning complete. Graph now has ${this.graph.order} nodes.`);
        });
      }
    }
  }

  private getLODValue(level: LODLevel): number {
    const values = { universe: 3, field: 2, topic: 1, paper: 0 };
    return values[level];
  }

  private updateVisualSettings(level: LODLevel): void {
    const ratio = this.sigma.getCamera().ratio;
    const settings = {
      universe: { size: this.config.visual.nodes.defaultSize, labelSize: 0 },
      field: { size: this.config.visual.nodes.defaultSize, labelSize: 12 },
      topic: { size: this.config.visual.nodes.defaultSize, labelSize: 14 },
      paper: { size: this.config.visual.nodes.defaultSize, labelSize: 16 }
    };

    // Prepare updates in bulk
    const nodeUpdates = new Map();
    const edgeUpdates = new Map();

    // Collect all node updates
    this.graph.forEachNode((node, attrs) => {
      const newSettings = settings[level];
      const clusterColor = this.clusterManager.getClusterColor(parseInt(attrs.cluster_id, 10));
      
      if (attrs.size !== newSettings.size || 
          attrs.labelSize !== newSettings.labelSize ||
          attrs.color !== clusterColor) {
        nodeUpdates.set(node, {
          size: newSettings.size,
          labelSize: newSettings.labelSize,
          color: clusterColor,
          label: ratio < 2.0 ? attrs.label : null // Only show labels when zoomed in
        });
      }
    });

    // Collect all edge updates
    this.graph.forEachEdge((edge, attrs) => {
      const isTreeEdge = attrs.isTreeEdge === true;
      const shouldShow = level === 'paper' || 
                        (level === 'topic' && ratio < 3.0) || 
                        (isTreeEdge && ratio < 6.0);
      
      if (attrs.hidden !== !shouldShow) {
        edgeUpdates.set(edge, {
          hidden: !shouldShow
        });
      }
    });

    // Apply updates in batches using requestAnimationFrame
    if (nodeUpdates.size > 0 || edgeUpdates.size > 0) {
      requestAnimationFrame(() => {
        // Process node updates in chunks of 1000
        const BATCH_SIZE = 1000;
        const nodeEntries = Array.from(nodeUpdates.entries());
        const edgeEntries = Array.from(edgeUpdates.entries());

        for (let i = 0; i < nodeEntries.length; i += BATCH_SIZE) {
          const batch = nodeEntries.slice(i, i + BATCH_SIZE);
          batch.forEach(([node, attrs]) => {
            this.graph.mergeNodeAttributes(node, attrs);
          });
        }

        for (let i = 0; i < edgeEntries.length; i += BATCH_SIZE) {
          const batch = edgeEntries.slice(i, i + BATCH_SIZE);
          batch.forEach(([edge, attrs]) => {
            this.graph.mergeEdgeAttributes(edge, attrs);
          });
        }

        // Single render update after all changes
        this.sigma.refresh();
      });
    }
  }

  private resetDwellTimer(): void {
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
    }
    this.dwellTimer = setTimeout(() => {
      this.needsLoad = true;
    }, this.dwellDelay);
  }

  public destroy(): void {
    // Cancel any pending operations
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
    
    // Clear all data
    this.graph.clear();
    this.nodeStates.clear();
    
    // Remove event listeners
    this.sigma.getCamera().removeListener('updated', this.debouncedCheckForLoad);
  }

  public refresh(): void {
    // Cancel any pending operations
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
    
    // Clear all data
    this.graph.clear();
    this.nodeStates.clear();
    
    // Reload data
    this.loadViewportData();
  }
  
  private getViewportBounds(): ViewportBounds {
    const camera = this.sigma.getCamera();
    const { width, height } = this.sigma.getDimensions();
    const ratio = camera.ratio;
    
    // Convert screen dimensions to graph coordinates
    const graphWidth = width / ratio;
    const graphHeight = height / ratio;
    
    // Convert graph coordinates to database coordinates using CoordinateManager
    const minPoint = this.coordinateManager.toDbCoords(
      camera.x - graphWidth / 2,
      camera.y - graphHeight / 2
    );
    const maxPoint = this.coordinateManager.toDbCoords(
      camera.x + graphWidth / 2,
      camera.y + graphHeight / 2
    );
    
    return {
      minX: minPoint.x,
      maxX: maxPoint.x,
      minY: minPoint.y,
      maxY: maxPoint.y,
      width: maxPoint.x - minPoint.x,
      height: maxPoint.y - minPoint.y
    };
  }

  private isNodeInViewport(nodeAttrs: any): boolean {
    // Use CoordinateManager to check if node is in viewport
    return this.coordinateManager.isPointInViewport(nodeAttrs.x, nodeAttrs.y);
  }

  private getRegionKey(bounds: ViewportBounds, lodLevel: LODLevel): string {
    // Create a key that represents this viewport region at this LOD level
    // Round coordinates to create discrete regions
    const precision = this.getRegionPrecision(lodLevel);
    const minX = Math.floor(bounds.minX * precision) / precision;
    const maxX = Math.ceil(bounds.maxX * precision) / precision;
    const minY = Math.floor(bounds.minY * precision) / precision;
    const maxY = Math.ceil(bounds.maxY * precision) / precision;
    return `${lodLevel}:${minX},${maxX},${minY},${maxY}`;
  }

  private getRegionPrecision(lodLevel: LODLevel): number {
    // Higher precision (more decimal places) for zoomed in views
    switch (lodLevel) {
      case 'universe': return 1;
      case 'field': return 10;
      case 'topic': return 100;
      case 'paper': return 1000;
    }
  }

  private needsLoading(bounds: ViewportBounds, lodLevel: LODLevel): boolean {
    const regionKey = this.getRegionKey(bounds, lodLevel);
    // Need to load if:
    // 1. We're in a new region
    // 2. We're at a more detailed LOD level than when we last loaded this region
    if (this.currentRegionKey !== regionKey) {
      this.currentRegionKey = regionKey;
      if (!this.loadedRegions.has(regionKey)) {
        return true;
      }
    }
    return false;
  }

  private markRegionLoaded(bounds: ViewportBounds, lodLevel: LODLevel): void {
    const regionKey = this.getRegionKey(bounds, lodLevel);
    this.loadedRegions.add(regionKey);
  }

  private async loadViewportData(): Promise<void> {
    // Cancel any ongoing loading operation
    if (this.currentLoadingController) {
      this.currentLoadingController.abort();
      this.currentLoadingController = null;
    }

    const bounds = this.getViewportBounds();
    const lodLevel = this.calculateLODLevel();

    // Check if we need to load this region
    if (!this.needsLoading(bounds, lodLevel)) {
      this.updateStats({
        loadingStatus: {
          state: 'idle',
          message: 'Region already loaded'
        }
      });
      return;
    }

    if (this.isLoading) {
      this.updateStats({
        loadingStatus: {
          state: 'loading_batches',
          message: 'Already loading viewport data, skipping...',
          batchesLoaded: 0
        }
      });
      return;
    }

    this.currentLoadingController = new AbortController();

    // Check if we've hit the max nodes limit
    const maxNodesReached = this.graph.order >= this.config.backend.maxNodeLimit;
    if (maxNodesReached && lodLevel === 'universe') {
      this.updateStats({
        loadingStatus: {
          state: 'max_nodes_reached',
          message: `Maximum node limit (${this.config.backend.maxNodeLimit}) reached in universe view`,
          maxNodesReached: true
        },
        hasMore: false
      });
      return;
    }

    try {
      this.isLoading = true;
      this.updateStats({ 
        isLoading: true,
        loadingStatus: {
          state: 'loading_batches',
          message: 'Loading viewport data in batches...',
          batchesLoaded: 0
        }
      });

      let batchesLoaded = 0;
      let hasMore = true;
      let totalNodesLoaded = 0;

      while (hasMore && !this.currentLoadingController.signal.aborted) {
        // Check node limit before each batch
        const remainingNodeCapacity = this.config.backend.maxNodeLimit - this.graph.order;
        if (remainingNodeCapacity <= 0) {
          this.updateStats({
            loadingStatus: {
              state: 'max_nodes_reached',
              message: `Maximum node limit (${this.config.backend.maxNodeLimit}) reached after ${batchesLoaded} batches`,
              maxNodesReached: true,
              batchesLoaded
            },
            hasMore: false
          });
          break;
        }

        // Adjust batch size to not exceed remaining capacity
        const adjustedBatchSize = Math.min(100, remainingNodeCapacity);

        const response = await fetchBoxBatched(
          bounds.minX,
          bounds.maxX,
          bounds.minY,
          bounds.maxY,
          remainingNodeCapacity,
          adjustedBatchSize,
          (nodes, batchIndex) => {
            // Check if aborted before processing each batch
            if (!this.currentLoadingController?.signal.aborted) {
              this.processBatchNodes(nodes, lodLevel);
              totalNodesLoaded += nodes.length;
              this.updateStats({
                loadingStatus: {
                  state: 'loading_batches',
                  message: `Loading viewport data in batches... (${totalNodesLoaded} nodes)`,
                  batchesLoaded: batchIndex + 1
                }
              });
            }
          },
          this.currentLoadingController.signal  // Pass the abort signal to fetchBoxBatched
        );

        if (!response || response.length === 0) break;
        
        hasMore = response.length === adjustedBatchSize && totalNodesLoaded < remainingNodeCapacity;
        batchesLoaded++;
      }

      // Mark this region as loaded only if we completed loading successfully
      if (!this.currentLoadingController.signal.aborted) {
        this.markRegionLoaded(bounds, lodLevel);
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Batch loading cancelled due to viewport change');
        this.updateStats({
          loadingStatus: {
            state: 'idle',
            message: 'Loading cancelled due to viewport change'
          }
        });
      } else {
        console.error('Error loading viewport data:', error);
      }
    } finally {
      this.isLoading = false;
      if (!this.currentLoadingController?.signal.aborted) {
        this.updateStats({ 
          isLoading: false,
          loadingStatus: {
            state: 'idle',
            message: this.graph.order >= this.config.backend.maxNodeLimit ? 
              `Loading complete (max ${this.config.backend.maxNodeLimit} nodes reached)` : 
              'Loading complete'
          }
        });
      }
      this.currentLoadingController = null;
    }
  }

  private processBatchNodes(nodes: Node[], lodLevel: LODLevel): void {
    const minDegree = this.config.lod.minDegree[lodLevel] || 1;
    
    nodes.forEach(node => {
      const attrs = node.attributes as ExtendedNodeAttributes;
      if (attrs.degree >= minDegree && !this.graph.hasNode(node.key)) {
        // Convert database coordinates to graph coordinates
        const graphCoords = this.coordinateManager.toGraphCoords(attrs.x, attrs.y);
        
        this.graph.addNode(node.key, {
          ...attrs,
          x: graphCoords.x,
          y: graphCoords.y,
          size: this.calculateNodeSize(attrs.degree, lodLevel),
          color: this.clusterManager.getClusterColor(parseInt((attrs.cluster_id || 'unknown').toString(), 10))
        });
        
        // Add to spatial index using graph coordinates
        this.addToSpatialIndex(node.key, graphCoords.x, graphCoords.y);
      }
    });

    this.sigma.refresh();
  }

  /**
   * Removes nodes that are far from the current viewport to make room for new nodes.
   * Prioritizes keeping nodes with higher degree and those closer to the viewport center.
   */
  private removeNodesOutsideViewport(): void {
    const bounds = this.getViewportBounds();
    let removedCount = 0;

    this.updateStats({
      loadingStatus: {
        state: 'removing_nodes',
        message: 'Removing nodes outside viewport...',
        removedNodesCount: 0
      }
    });

    this.graph.forEachNode((node, attrs) => {
      if (!this.isNodeInViewport(attrs)) {
        this.graph.dropNode(node);
        removedCount++;
      }
    });

    if (removedCount > 0) {
      this.updateStats({
        loadingStatus: {
          state: 'removing_nodes',
          message: `Removed ${removedCount} nodes outside viewport`,
          removedNodesCount: removedCount
        }
      });
    } else {
      this.updateStats({
        loadingStatus: {
          state: 'idle',
          message: 'No nodes removed'
        }
      });
    }
  }

  private sortNodesByImportance(nodes: LoaderData['nodes']): LoaderData['nodes'] {
    return nodes.sort((a, b) => {
      // Calculate importance score based on degree and other attributes
      const scoreA = this.calculateNodeImportance(a);
      const scoreB = this.calculateNodeImportance(b);
      return scoreB - scoreA; // Sort in descending order
    });
  }

  private calculateNodeImportance(node: LoaderData['nodes'][0]): number {
    const degree = node.attributes.degree || 1;
    const hasLabel = !!node.attributes.label;
    const clusterSize = this.clusterManager.getClusterSize(node.attributes.cluster_id) || 1;
    
    // Weighted importance score
    return (
      Math.log(Math.max(1, degree)) * 10 +  // Degree importance (log scale)
      (hasLabel ? 5 : 0) +                  // Bonus for nodes with labels
      Math.log(Math.max(1, clusterSize)) * 2 // Cluster size importance (log scale)
    );
  }

  private calculateNodeSize(degree: number, lodLevel: LODLevel): number {
    // Use the config value directly, no LOD-based scaling
    return this.config.visual.nodes.defaultSize;
  }

  private calculateEdgeSize(lodLevel: LODLevel): number {
    const sizes: Record<LODLevel, number> = {
      universe: 3,
      field: 2,
      topic: 1.5,
      paper: 1
    };
    return sizes[lodLevel];
  }

  private async enrichViewport(): Promise<void> {
    const visibleNodes = this.getVisibleNodes();
    if (visibleNodes.length === 0) return;

    // Don't enrich in universe view
    if (this.currentLODLevel === 'universe') return;

    try {
      const response = await fetch('/api/edges/extra-for-nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds: visibleNodes })
      });

      if (!response.ok) throw new Error('Failed to fetch extra edges');
      
      const data: EnrichmentResponse = await response.json();
      
      // Add extra edges with standard rendering but distinct style
      data.extraEdges.forEach(edge => {
        if (!this.graph.hasEdge(edge.source, edge.target)) {
          const edgeAttributes: EdgeAttributes = {
            ...edge.attributes,
            isTreeEdge: false,  // Mark as non-tree edge
            size: 1,           // Thinner for extra edges
            color: '#C62828',  // Red for extra edges
            weight: 0.5,
            hidden: this.currentLODLevel === 'universe'
          };
          
          this.graph.addEdge(edge.source, edge.target, edgeAttributes);
        }
      });

      // Update node states
      Object.entries(data.nodeFlags).forEach(([nodeId, flags]) => {
        const state = this.nodeStates.get(nodeId);
        if (state) {
          state.hasExtraEdges = flags.enriched;
          state.enrichmentRequested = true;
        }
      });

    } catch (error) {
      console.error('Enrichment failed:', error);
    }
  }

  private getVisibleNodes(): string[] {
    return this.graph.nodes().filter(nodeId => {
      const attrs = this.graph.getNodeAttributes(nodeId);
      return !attrs.hidden;
    });
  }

  private updateStats(newStats: Partial<GraphStats>): void {
    this.stats = { ...this.stats, ...newStats };
  }
  
  public getStats(): GraphStats {
    const visibleNodes = this.getVisibleNodes();
    const bounds = this.coordinateManager.getViewportBoundsInDb();
    const datasetBounds = this.coordinateManager.getDatasetBounds();

    return {
      nodeCount: this.graph.order,
      edgeCount: this.graph.size,
      isLoading: this.stats.isLoading,
      loadingStatus: this.stats.loadingStatus,
      hasMore: this.stats.hasMore,
      lodLevel: this.currentLODLevel,
      visibleNodes: visibleNodes.length,
      visibleEdges: this.graph.edges().length,
      enrichedNodes: this.stats.enrichedNodes,
      datasetBounds: datasetBounds ? {
        x: { min: datasetBounds.minX, max: datasetBounds.maxX },
        y: { min: datasetBounds.minY, max: datasetBounds.maxY }
      } : undefined,
      viewportRange: {
        x: { min: bounds.minX, max: bounds.maxX },
        y: { min: bounds.minY, max: bounds.maxY }
      }
    };
  }
  
  // Helper method to check if an edge is part of the tree structure
  private isTreeEdge(edgeId: string): boolean {
    const attributes = this.graph.getEdgeAttributes(edgeId);
    return attributes.isTreeEdge === true;
  }

  // Helper method to get all tree edges
  private getTreeEdges(): string[] {
    return this.graph.edges().filter(edgeId => this.isTreeEdge(edgeId));
  }

  public resetCamera(): void {
    // Reset camera to initial state with default ratio
    this.sigma.getCamera().setState({ 
      x: 0, 
      y: 0, 
      ratio: this.config.viewport.initialRatio || 1.0 
    });
    
    // Force a reload of the viewport
    this.needsLoad = true;
  }

  private initializeEventListeners(): void {
    // Listen for camera updates
    this.sigma.getCamera().on('updated', () => {
      const newLodLevel = this.calculateLODLevel();
      
      // Always handle LOD transitions
      if (newLodLevel !== this.currentLODLevel) {
        this.handleLODTransition(newLodLevel);
      }

      // Get current bounds and check if we need to load
      const bounds = this.getViewportBounds();
      if (this.needsLoading(bounds, newLodLevel)) {
        // Reset the dwell timer on every camera update
        this.resetDwellTimer();
        
        // Trigger loading after a short delay
        this.debouncedLoadViewportData();
      }

      // Update visual settings based on new LOD level
      this.updateVisualSettings(newLodLevel);
    });

    // Add click handler for stage (whitespace) clicks
    this.sigma.on('clickStage', () => {
      // Clear any active search highlights
      if (this.searchManager) {
        this.searchManager.clearSearch();
      }
      
      // Hide all edges
      this.graph.forEachEdge((edge: string) => {
        this.graph.setEdgeAttribute(edge, 'hidden', true);
      });
      
      this.sigma.refresh();
    });

    // Add click handler for node clicks
    this.sigma.on('clickNode', (event: { node: string }) => {
      const nodeId = event.node;
      
      // Show edges connected to this node
      const edges = this.edgeCacheManager.getEdgesForNode(nodeId);
      edges.forEach(edge => {
        const edgeId = this.graph.edge(edge.source, edge.target);
        if (edgeId) {
          this.graph.setEdgeAttribute(edgeId, 'hidden', false);
        }
      });
      
      this.sigma.refresh();
    });
  }

  private debouncedLoadViewportData = debounce(async () => {
    await this.loadViewportData();
  }, 250); // 250ms delay to avoid too frequent loading

  private addToSpatialIndex(nodeId: string, x: number, y: number): void {
    // Implementation will be added later when we implement spatial indexing
    // For now, this is just a placeholder
  }

  public setSearchManager(searchManager: SearchManager): void {
    this.searchManager = searchManager;
  }

  // Add getter methods
  public getSigma(): Sigma {
    return this.sigma;
  }

  public getGraph(): Graph {
    return this.graph;
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  /**
   * Add a node from search results to the graph
   */
  public addNodeFromSearch(nodeData: { key: string; attributes: any }): void {
    if (!this.graph.hasNode(nodeData.key)) {
      // Convert database coordinates to graph coordinates
      const graphCoords = this.coordinateManager.toGraphCoords(
        nodeData.attributes.x,
        nodeData.attributes.y
      );

      console.log(`🔍 Adding search node ${nodeData.key}:`, {
        dbCoords: { x: nodeData.attributes.x, y: nodeData.attributes.y },
        graphCoords
      });

      this.graph.addNode(nodeData.key, {
        ...nodeData.attributes,
        x: graphCoords.x,
        y: graphCoords.y,
        size: this.config.visual.nodes.defaultSize,
        color: this.config.visual.nodes.defaultColor
      });
    }
  }

  /**
   * Legacy method to maintain compatibility with old code
   */
  private async loadViewportNodesLOD(): Promise<void> {
    await this.loadViewportData();
  }
} 