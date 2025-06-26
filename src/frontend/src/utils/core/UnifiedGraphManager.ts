/**
 * 🌟 Unified Graph Manager - Clean Architecture
 * 
 * Consolidates the functionality from both GraphManager and TreeFirstGraphManager
 * into a single, well-designed class using proper object-oriented principles:
 * 
 * - Strategy pattern for different loading strategies
 * - Dependency injection for loose coupling
 * - Clear separation of concerns
 * - Event-driven architecture
 * - Proper error handling and resource management
 */

import { Sigma } from 'sigma';
import Graph from 'graphology';
import { BaseManager, ManagerConfig } from './BaseManager';
import { ServiceContainer } from './ServiceContainer';
import { AppConfig, TreeConfig } from '../config/ConfigLoader';
import { NodeData, EdgeData, TreeLoadingResult, TreeGraphStats, EnrichmentResult } from '../types'; // Import from types.ts
import { SpatialTreeLoadingStrategy } from '../strategies/SpatialTreeLoadingStrategy';
import { TreeNodeService } from '../services/TreeNodeService';
import { TreeEdgeService } from '../services/TreeEdgeService';
import { TreeStateManagerImpl as TreeStateManager } from '../core/TreeStateManager';
import { TreeSearchCoordinator } from '../search/TreeSearchCoordinator';

// Core interfaces
export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  isLoading: boolean;
  hasMore: boolean;
  lodLevel?: string;
  connectivity?: string;
  loadingStatus?: {
    state: 'idle' | 'loading' | 'removing' | 'error';
    message?: string;
    progress?: number;
  };
}

// Strategy interfaces
export interface LoadingStrategy {
  initialize(bounds: ViewportBounds): Promise<void>;
  loadViewport(bounds: ViewportBounds): Promise<LoadingResult>;
  cleanup(): void;
}

export interface LoadingResult {
  nodes: NodeData[];
  edges: EdgeData[];
  hasMore: boolean;
  stats?: any;
}

export interface RenderingStrategy {
  applyNodeStyle(nodeId: string, nodeData: NodeData): any;
  applyEdgeStyle(edgeId: string, edgeData: EdgeData): any;
  updateLODSettings(lodLevel: string): void;
  getRenderingSettings(): any;
}

// Services
export interface NodeService {
  addNodes(nodes: NodeData[]): void;
  removeNodes(nodeIds: string[]): void;
  getNodesByViewport(bounds: ViewportBounds): NodeData[];
  getNodeCount(): number;
  hasNode(nodeId: string): boolean;
  getLoadedNodeIds(): string[];
  getNode(nodeId: string): NodeData | undefined;
}

export interface EdgeService {
  addEdges(edges: EdgeData[]): void;
  removeEdges(edgeIds: string[]): void;
  getEdgesForNodes(nodeIds: string[]): EdgeData[];
  getEdgeCount(): number;
}

export interface ViewportService {
  getCurrentBounds(): ViewportBounds;
  isViewportChanged(threshold: number): boolean;
  onViewportChange(callback: (bounds: ViewportBounds) => void): void;
  centerOn(x: number, y: number, ratio?: number): void;
}

// Configuration
export interface UnifiedGraphConfig extends ManagerConfig {
  loadingStrategy: 'standard' | 'enhanced' | 'tree-first' | 'adaptive';
  renderingStrategy: 'standard' | 'lod' | 'performance';
  maxNodes: number;
  maxEdges: number;
  viewportUpdateThreshold: number;
  debugMode: boolean;
}

// Events
export interface GraphManagerEvents {
  'initialized': {};
  'destroyed': {};
  'error': { error: Error; context: string };
  'viewport-changed': { bounds: ViewportBounds };
  'loading-started': { strategy: string };
  'loading-completed': { result: LoadingResult };
  'loading-failed': { error: Error };
  'nodes-added': { count: number };
  'nodes-removed': { count: number };
  'edges-added': { count: number };
  'edges-removed': { count: number };
  'stats-updated': { stats: GraphStats };
  'search:highlighted': { 
    focusNodes: string[]; 
    neighborNodes: string[]; 
    originalNodeStyles: Map<string, any>; 
    originalEdgeStyles: Map<string, any>; 
  };
  'search:cleared': {};
  'search:failed': { error: Error };
  'tree:enrichment-completed': {
    treeNodeCount: number;
    extraEdgeCount: number;
    enrichmentType: 'tree' | 'extra-edges' | 'both';
  };
}

export class UnifiedGraphManager {
  private sigma: Sigma;
  private graph: Graph;
  private services: ServiceContainer;
  private appConfig: AppConfig;
  private config: UnifiedGraphConfig;
  
  // Strategy instances
  private loadingStrategy: LoadingStrategy;
  private renderingStrategy: RenderingStrategy;
  
  // Services
  private nodeService: NodeService;
  private edgeService: EdgeService;
  private viewportService: ViewportService;
  
  // Tree-specific services & strategies
  private spatialTreeLoadingStrategy?: SpatialTreeLoadingStrategy;
  private treeNodeService?: TreeNodeService;
  private treeEdgeService?: TreeEdgeService;
  private treeStateManager?: TreeStateManager;
  private treeSearchCoordinator?: TreeSearchCoordinator;
  
  // State management
  private isInitialized: boolean = false;
  private isDestroyed: boolean = false;
  private eventListeners: Map<keyof GraphManagerEvents, Function[]> = new Map();
  
  // Current state
  private currentStats: GraphStats = {
    nodeCount: 0,
    edgeCount: 0,
    isLoading: false,
    hasMore: false
  };
  
  private isUpdatingViewport: boolean = false;
  private updateViewportTimer: number | null = null;
  private dwellTimer: number | null = null;
  private currentLODConfig: any;

  constructor(
    sigma: Sigma,
    appConfig: AppConfig,
    services: ServiceContainer,
    graphConfig: UnifiedGraphConfig
  ) {
    this.config = graphConfig;
    
    this.sigma = sigma;
    this.graph = sigma.getGraph();
    this.appConfig = appConfig;
    this.services = services;
    
    // Initialize services
    this.nodeService = services.resolve<NodeService>('NodeService');
    this.edgeService = services.resolve<EdgeService>('EdgeService');
    this.viewportService = services.resolve<ViewportService>('ViewportService');
    
    if (this.config.loadingStrategy === 'tree-first') {
      // Initialize tree-specific services
      this.treeNodeService = services.resolve<TreeNodeService>('TreeNodeService');
      this.treeEdgeService = services.resolve<TreeEdgeService>('TreeEdgeService');
      this.treeStateManager = services.resolve<TreeStateManager>('TreeStateManager');
      
      // Initialize tree-spatial loading strategy
      this.spatialTreeLoadingStrategy = services.resolve<SpatialTreeLoadingStrategy>('SpatialTreeLoadingStrategy');
      
      // Initialize tree-aware search coordinator
      this.treeSearchCoordinator = services.resolve<TreeSearchCoordinator>('TreeSearchCoordinator');
      this.loadingStrategy = this.spatialTreeLoadingStrategy;
    } else {
      // Initialize strategies
      this.loadingStrategy = this.createLoadingStrategy();
    }

    this.renderingStrategy = this.createRenderingStrategy();
  }

  /**
   * Event handling methods
   */
  protected emit<K extends keyof GraphManagerEvents>(
    event: K, 
    data: GraphManagerEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in UnifiedGraphManager event listener for ${String(event)}:`, error);
      }
    });
  }

  public on<K extends keyof GraphManagerEvents>(
    event: K, 
    callback: (data: GraphManagerEvents[K]) => void
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  public off<K extends keyof GraphManagerEvents>(
    event: K, 
    callback: (data: GraphManagerEvents[K]) => void
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Protected helper for error handling
   */
  protected handleError(error: Error, context: string): void {
    const errorMessage = `UnifiedGraphManager error in ${context}: ${error.message}`;
    console.error(errorMessage, error);
    this.emit('error', { error, context });
  }

  /**
   * Protected helper for safe initialization
   */
  protected async safeInitialize(initFn: () => Promise<void>): Promise<void> {
    if (this.isInitialized) {
      console.warn('UnifiedGraphManager already initialized');
      return;
    }

    if (this.isDestroyed) {
      throw new Error('Cannot initialize destroyed UnifiedGraphManager');
    }

    try {
      await initFn();
      this.isInitialized = true;
      this.emit('initialized', {});
      
      if (this.config.debug) {
        console.log('✅ UnifiedGraphManager initialized successfully');
      }
    } catch (error) {
      this.handleError(error as Error, 'initialization');
      throw error;
    }
  }

  /**
   * Protected helper for safe cleanup
   */
  protected safeDestroy(destroyFn: () => void): void {
    if (this.isDestroyed) {
      console.warn('UnifiedGraphManager already destroyed');
      return;
    }

    try {
      destroyFn();
      this.isDestroyed = true;
      this.isInitialized = false;
      this.emit('destroyed', {});
      
      // Clear all event listeners
      this.eventListeners.clear();
      
      if (this.config.debug) {
        console.log('🗑️ UnifiedGraphManager destroyed successfully');
      }
    } catch (error) {
      this.handleError(error as Error, 'destruction');
    }
  }

  /**
   * Initialize the graph manager
   */
  async initialize(): Promise<void> {
    await this.safeInitialize(async () => {
      // Setup event listeners
      this.setupEventListeners();
      
      // Initialize strategies
      if (this.loadingStrategy.initialize) {
        const initialBounds = this.viewportService.getCurrentBounds();
        await this.loadingStrategy.initialize(initialBounds);
      }
      
      // Setup viewport monitoring
      this.setupViewportMonitoring();
      
      // Apply initial rendering settings
      this.applyRenderingSettings();
      
      // Load initial data
      await this.loadInitialData();
      
      console.log(`🌟 UnifiedGraphManager initialized with ${this.config.loadingStrategy} strategy`);
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.safeDestroy(() => {
      // Clear viewport update timer
      if (this.updateViewportTimer) {
        clearTimeout(this.updateViewportTimer);
        this.updateViewportTimer = null;
      }
      
      // Cleanup strategies
      if (this.loadingStrategy.cleanup) {
        this.loadingStrategy.cleanup();
      }
      
      // Clear graph
      this.graph.clear();
      
      console.log('🌟 UnifiedGraphManager destroyed');
    });
  }

  /**
   * Update viewport and load new data
   */
  async updateViewport(): Promise<void> {
    if (this.isUpdatingViewport) return;
    this.isUpdatingViewport = true;

    try {
      const viewport = this.viewportService.getCurrentBounds();
      if (this.config.loadingStrategy === 'tree-first' && this.spatialTreeLoadingStrategy && this.treeStateManager) {
          // Use spatial-tree hybrid loading
          const result = await this.spatialTreeLoadingStrategy.loadViewport(viewport);
          
          // Validate connectivity of loaded data
          const disconnectedNodes = this.treeStateManager.findDisconnectedNodes();
          if (disconnectedNodes.length > 0) {
            console.warn(`Found ${disconnectedNodes.length} disconnected nodes, fixing...`);
            await this.fixDisconnectedNodes(disconnectedNodes);
          }
          
          // Trigger enrichment if user is dwelling
          this.scheduleEnrichmentIfDwelling();
          
          this.emit('viewport-changed', { bounds: viewport });
          this.emit('loading-completed', { result: result as any });
      } else {
        const result = await this.loadingStrategy.loadViewport(viewport);
        await this.processLoadingResult(result);
      }
    } catch (error) {
      this.handleError(error as Error, 'viewport-update');
    } finally {
      this.isUpdatingViewport = false;
    }
  }

  /**
   * Get current statistics
   */
  getStats(): GraphStats {
    return {
      ...this.currentStats,
      nodeCount: this.nodeService.getNodeCount(),
      edgeCount: this.edgeService.getEdgeCount()
    };
  }

  /**
   * Refresh the graph
   */
  async refresh(): Promise<void> {
    if (!this.isInitialized) return;
    
    try {
      // Clear current data
      this.graph.clear();
      
      // Reset stats
      this.currentStats = {
        nodeCount: 0,
        edgeCount: 0,
        isLoading: false,
        hasMore: false
      };
      
      // Reload data
      await this.loadInitialData();
      
    } catch (error) {
      this.handleError(error as Error, 'refresh');
    }
  }

  /**
   * Center viewport on specific coordinates
   */
  centerOn(x: number, y: number, ratio?: number): void {
    this.viewportService.centerOn(x, y, ratio);
  }

  /**
   * Search for and highlight nodes (Enhanced Phase 2 functionality)
   */
  async searchAndHighlight(query: string): Promise<NodeData[]> {
    if (this.isDestroyed || !this.isInitialized) return [];

    this.emit('loading-started', { strategy: 'search' });

    if (this.config.loadingStrategy === 'tree-first' && this.treeSearchCoordinator && this.treeNodeService && this.treeEdgeService) {
      try {
        // Step 1: Execute search (assuming searchApi exists on services)
        const searchApi = this.services.resolve<any>('SearchApi');
        const searchResults = await searchApi.search(query);
        
        // Step 2: Load search results with tree connectivity
        const loadedNodes: NodeData[] = [];
        for (const result of searchResults) {
          await this.treeSearchCoordinator.loadSearchResultWithConnectivity(result);
          
          const nodeData = this.treeNodeService.getNode(result.nodeId);
          if (nodeData) {
            loadedNodes.push(nodeData);
          }
        }
        
        // Step 3: Find tree neighbors for context
        const allNeighbors = new Set<string>();
        for (const node of loadedNodes) {
          const neighbors = this.treeEdgeService.getTreeNeighbors(node.nodeId, 1);
          neighbors.forEach(n => allNeighbors.add(n));
        }
        
        // Step 4: Apply visual highlighting
        await this.highlightSearchResults(loadedNodes);
        
        this.emit('search:highlighted', { 
          focusNodes: loadedNodes.map(n => n.nodeId),
          neighborNodes: Array.from(allNeighbors),
          originalNodeStyles: new Map(), // Placeholder, implementation needed
          originalEdgeStyles: new Map() // Placeholder, implementation needed
        });
        
        return loadedNodes;
        
      } catch (error) {
        this.emit('search:failed', { error: error as Error });
        throw error;
      }
    } else {
      // Fallback to original implementation
      return this.originalSearchAndHighlight(query);
    }
  }

  private async originalSearchAndHighlight(query: string): Promise<NodeData[]> {
      try {
        console.log(`🚀 Search started for query: "${query}"`);
        await this.clearSearchHighlight();

        // Step 1: Execute search
        const searchResults = await this.services.resolve<any>('SearchApi').search(query);
        if (!searchResults || searchResults.length === 0) {
          console.log(`🤷 No results found for "${query}"`);
          this.emit('loading-completed', { result: { nodes: [], edges: [], hasMore: false } });
          return [];
        }
        
        const targetNodes: NodeData[] = [];

        // Step 2: Load search results and their immediate neighbors
        for (const result of searchResults) {
          // Load the main search result node
          const targetNode = await this.loadSpecificNode(result.nodeId);
          if (targetNode) {
            targetNodes.push(targetNode);
            
            // Step 3: Load its neighbors for context
            const neighbors = await this.loadNodeNeighbors(result.nodeId, targetNode);
            
            // Ensure target node and neighbors are in the graph
            this.addNodeToGraph(targetNode);
            for (const neighbor of neighbors) {
              this.addNodeToGraph(neighbor);
            }
          }
        }

        // Step 4: Apply visual highlighting
        await this.highlightSearchResults(targetNodes);
        
        console.log(`✅ Search completed. Highlighted ${targetNodes.length} nodes.`);
        this.emit('loading-completed', { result: { nodes: targetNodes, edges: [], hasMore: false } });

        return targetNodes;

      } catch (error) {
        this.handleError(error as Error, 'searchAndHighlight');
        this.emit('loading-failed', { error: error as Error });
        return [];
      }
  }

  /**
   * 🔍 Load specific node by ID (for search functionality)
   */
  private async loadSpecificNode(nodeId: string): Promise<NodeData | null> {
    try {
      const response = await this.services
        .resolve<any>('ApiClient')
        .getNodes([nodeId]);
      if (response && response.nodes.length > 0) {
        const rawNode = response.nodes[0];
        const nodeData: NodeData = {
          nodeId: rawNode.id,
          label: rawNode.label || rawNode.title,
          x: rawNode.x,
          y: rawNode.y,
          size: rawNode.size || 1,
          color: rawNode.color || '#000',
          degree: rawNode.degree,
          cluster_id: rawNode.community,
        };
        this.addNodeToGraph(nodeData);
        return nodeData;
      }
      return null;
    } catch (error) {
      this.handleError(error as Error, 'loadSpecificNode');
      return null;
    }
  }

  /**
   * 🔍 Load neighbors of a specific node
   */
  private async loadNodeNeighbors(
    nodeId: string,
    centerNode: NodeData,
    radius: number = 1000,
  ): Promise<NodeData[]> {
    try {
      const response = await this.services
        .resolve<any>('ApiClient')
        .getNeighbors(nodeId, radius);
      if (response && response.nodes.length > 0) {
        const neighbors: NodeData[] = response.nodes.map((rawNode: any) => ({
          nodeId: rawNode.id,
          label: rawNode.label || rawNode.title,
          x: rawNode.x,
          y: rawNode.y,
          size: rawNode.size || 1,
          color: rawNode.color || '#000',
          degree: rawNode.degree,
          cluster_id: rawNode.community,
        }));

        for (const neighbor of neighbors) {
          if (!this.graph.hasNode(neighbor.nodeId)) {
            this.addNodeToGraph(neighbor);
          }
        }
        return neighbors;
      }
      return [];
    } catch (error) {
      this.handleError(error as Error, 'loadNodeNeighbors');
      return [];
    }
  }

  /**
   * 🎨 Highlight search results with their connections
   */
  private async highlightSearchResults(nodes: NodeData[]): Promise<void> {
    try {
      console.log(`🎨 Highlighting ${nodes.length} search result nodes`);
      
      if (nodes.length === 0) return;
      
      // Get focus node colors from config
      const focusNodeColor = this.appConfig.visual?.search?.focusNodeColor || '#ff6b6b';
      const neighborNodeColor = this.appConfig.visual?.search?.neighborNodeColor || '#4ecdc4';
      const focusEdgeColor = this.appConfig.visual?.search?.focusEdgeColor || '#ff8e53';
      
      // Store original styles for restoration
      const originalNodeStyles = new Map();
      const originalEdgeStyles = new Map();
      
      // Determine which nodes are focus nodes (first few) vs neighbors
      const maxFocusNodes = 3; // Limit focus nodes to avoid overwhelming visuals
      const focusNodes = nodes.slice(0, maxFocusNodes);
      const neighborNodes = nodes.slice(maxFocusNodes);
      
      // Style all nodes
      nodes.forEach((nodeData, index) => {
        if (this.graph.hasNode(nodeData.nodeId)) {
          // Store original style
          const originalAttrs = this.graph.getNodeAttributes(nodeData.nodeId);
          originalNodeStyles.set(nodeData.nodeId, {
            color: originalAttrs.color,
            size: originalAttrs.size
          });
        
          // Apply highlight style
          const isFocusNode = index < maxFocusNodes;
          this.graph.mergeNodeAttributes(nodeData.nodeId, {
            color: isFocusNode ? focusNodeColor : neighborNodeColor,
            size: (originalAttrs.size || 5) * (isFocusNode ? 2.0 : 1.3)
          });
        }
      });
      
      // Find and highlight edges between the nodes (star pattern from focus nodes)
      const focusNodeIds = new Set(focusNodes.map(n => n.nodeId));
      const allNodeIds = new Set(nodes.map(n => n.nodeId));
      
      this.graph.forEachEdge((edgeId: string, attributes: any, source: string, target: string) => {
        // Highlight edges that connect focus nodes to any of the result nodes
        const shouldHighlight = (focusNodeIds.has(source) && allNodeIds.has(target)) ||
                               (focusNodeIds.has(target) && allNodeIds.has(source));
                               
        if (shouldHighlight) {
          // Store original style
          originalEdgeStyles.set(edgeId, {
            color: attributes.color,
            size: attributes.size
          });
          
          // Apply highlight style
          this.graph.mergeEdgeAttributes(edgeId, {
            color: focusEdgeColor,
            size: (attributes.size || 1) * 2,
            hidden: false // Make sure edge is visible
          });
        }
      });
      
      // Refresh the graph to show changes
      this.sigma.refresh();
      
      // Store restoration data for later cleanup
      this.emit('search:highlighted', { 
        focusNodes: focusNodes.map(n => n.nodeId),
        neighborNodes: neighborNodes.map(n => n.nodeId),
        originalNodeStyles,
        originalEdgeStyles
      });
      
      console.log(`🎨 Highlighted ${focusNodes.length} focus nodes and ${neighborNodes.length} neighbor nodes`);
      
    } catch (error) {
      console.error('🎨 Error highlighting search results:', error);
    }
  }

  /**
   * 🧹 Clear search highlighting
   */
  async clearSearchHighlight(): Promise<void> {
    try {
      console.log('🧹 Clearing search highlighting');
      
      // This would typically restore original node and edge styles
      // For now, we'll trigger a refresh to use default styling
      this.sigma.refresh();
      
      this.emit('search:cleared', {});
      
    } catch (error) {
      console.error('🧹 Error clearing search highlight:', error);
    }
  }

  /**
   * 🔧 Add node to graph with proper styling
   */
  private addNodeToGraph(nodeData: NodeData): void {
    if (!this.graph.hasNode(nodeData.nodeId)) {
      this.graph.addNode(nodeData.nodeId, {
        ...nodeData,
        x: nodeData.x,
        y: nodeData.y,
        label: nodeData.label,
        size: nodeData.size,
        color: this.getNodeColor(nodeData.cluster_id),
        degree: nodeData.degree,
        cluster_id: nodeData.cluster_id,
      });
      this.currentStats.nodeCount = this.graph.order;
    }
  }

  /**
   * 🎨 Get color for node based on cluster
   */
  private getNodeColor(clusterId: number): string {
    // Simple color palette for clusters
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7',
      '#dda0dd', '#98d8c8', '#f7dc6f', '#bb8fce', '#85c1e9'
    ];
    
    return colors[clusterId % colors.length] || '#888888';
  }

  // Private methods

  private createLoadingStrategy(): LoadingStrategy {
    const strategyName = this.config.loadingStrategy;
    
    try {
      return this.services.resolve<LoadingStrategy>(`${strategyName}LoadingStrategy`);
    } catch {
      // Fallback to standard strategy
      console.warn(`Loading strategy '${strategyName}' not found, using standard strategy`);
      return this.services.resolve<LoadingStrategy>('standardLoadingStrategy');
    }
  }

  private createRenderingStrategy(): RenderingStrategy {
    const strategyName = this.config.renderingStrategy;
    
    try {
      return this.services.resolve<RenderingStrategy>(`${strategyName}RenderingStrategy`);
    } catch {
      // Fallback to standard strategy
      console.warn(`Rendering strategy '${strategyName}' not found, using standard strategy`);
      return this.services.resolve<RenderingStrategy>('standardRenderingStrategy');
    }
  }

  private setupEventListeners(): void {
    // Setup graph event listeners
    this.graph.on('nodeAdded', () => {
      this.updateStats({ nodeCount: this.graph.order });
    });
    
    this.graph.on('nodeDropped', () => {
      this.updateStats({ nodeCount: this.graph.order });
    });
    
    this.graph.on('edgeAdded', () => {
      this.updateStats({ edgeCount: this.graph.size });
    });
    
    this.graph.on('edgeDropped', () => {
      this.updateStats({ edgeCount: this.graph.size });
    });
  }

  private setupViewportMonitoring(): void {
    this.viewportService.onViewportChange((bounds) => {
      // Debounce viewport updates
      if (this.updateViewportTimer) {
        clearTimeout(this.updateViewportTimer);
      }
      
      this.updateViewportTimer = setTimeout(() => {
        this.updateViewport();
      }, this.config.viewportUpdateThreshold);
    });
  }

  private applyRenderingSettings(): void {
    const settings = this.renderingStrategy.getRenderingSettings();
    if (settings) {
      this.sigma.setSettings(settings);
    }
  }

  private async loadInitialData(): Promise<void> {
    const initialBounds = this.viewportService.getCurrentBounds();
    await this.loadingStrategy.initialize(initialBounds);
    await this.updateViewport();
  }

  private async processLoadingResult(result: LoadingResult): Promise<void> {
    if (result.nodes.length > 0) {
      this.nodeService.addNodes(result.nodes);
    }
    if (result.edges.length > 0) {
      this.edgeService.addEdges(result.edges);
    }
    this.updateStats({ hasMore: result.hasMore });
  }

  private updateStats(updates: Partial<GraphStats>): void {
    this.currentStats = { ...this.currentStats, ...updates };
    this.emit('stats-updated', { stats: this.currentStats });
  }

  // Tree-specific enrichment methods
  async enrichCurrentViewport(enrichmentType: 'tree' | 'extra-edges' | 'both' = 'both'): Promise<void> {
    if (!this.spatialTreeLoadingStrategy) return;
    const result = await this.spatialTreeLoadingStrategy.enrichViewport(enrichmentType);
    
    this.emit('tree:enrichment-completed', { 
      treeNodeCount: result.treeNodes.length,
      extraEdgeCount: result.extraEdges.length,
      enrichmentType 
    });
  }

  // Tree connectivity utilities
  isViewportComplete(): boolean {
    if (!this.treeNodeService || !this.treeStateManager || !this.viewportService) return true;
    const viewport = this.viewportService.getCurrentBounds();
    const visibleNodes = this.treeNodeService.getNodesInViewport(viewport, this.currentLODConfig);
    
    // Check if all visible nodes have been enriched (have extra edges loaded)
    return visibleNodes.every(node => {
      const brokenEdges = this.treeStateManager!.getBrokenEdgesForNode(node.nodeId);
      return brokenEdges.length === 0 //|| brokenEdges.every(edge => edge.enriched);
    });
  }

  getTreeStats(): TreeGraphStats | null {
    if (!this.treeNodeService || !this.treeEdgeService || !this.treeStateManager) return null;

    const loadedNodes = this.treeNodeService.getAllNodes();
    const treeEdges = this.treeEdgeService.getTreeEdges();
    const extraEdges = this.treeEdgeService.getExtraEdges();
    const disconnectedNodes = this.treeStateManager.findDisconnectedNodes();
    
    return {
      totalNodes: loadedNodes.length,
      treeEdges: treeEdges.length,
      extraEdges: extraEdges.length,
      disconnectedNodes: disconnectedNodes.length,
      connectivityRatio: loadedNodes.length > 0 ? (loadedNodes.length - disconnectedNodes.length) / loadedNodes.length : 1,
      enrichmentProgress: this.calculateEnrichmentProgress()
    };
  }

  // Private helper methods
  private calculateEnrichmentProgress(): number {
    if (!this.treeEdgeService || !this.treeStateManager) return 0;
    // This is a simplified calculation as per the action plan.
    // It will be improved as the enrichment logic becomes more sophisticated.
    const loadedExtraEdges = this.treeEdgeService.getExtraEdges().length;
    let remainingBrokenEdges = 0;
    if (this.treeNodeService) {
      const loadedNodes = this.treeNodeService.getAllNodes();
      for (const node of loadedNodes) {
        remainingBrokenEdges += this.treeStateManager.getBrokenEdgesForNode(node.nodeId).length;
      }
    }
    const totalEdges = loadedExtraEdges + remainingBrokenEdges;
    return totalEdges > 0 ? loadedExtraEdges / totalEdges : 1;
  }

  private async fixDisconnectedNodes(nodeIds: string[]): Promise<void> {
    if (!this.treeSearchCoordinator) return;
    // For each disconnected node, try to find and load path to existing tree
    for (const nodeId of nodeIds) {
      try {
        await this.treeSearchCoordinator.loadSearchResultWithConnectivity({ nodeId });
      } catch (error) {
        console.warn(`Failed to connect node ${nodeId}:`, error);
      }
    }
  }

  private scheduleEnrichmentIfDwelling(): void {
    // Clear existing dwell timer
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
    }

    // Start new dwell timer
    this.dwellTimer = setTimeout(async () => {
      if (!this.isViewportComplete()) {
        await this.enrichCurrentViewport();
      }
    }, (this.appConfig.tree as TreeConfig)?.dwellDelay || 1000);
  }

  // Public API

  public getSigma(): Sigma {
    return this.sigma;
  }

  public getGraph(): Graph {
    return this.graph;
  }

  public getConfig(): UnifiedGraphConfig {
    return this.config;
  }

  public getAppConfig(): AppConfig {
    return this.appConfig;
  }

  public getServices(): ServiceContainer {
    return this.services;
  }
} 