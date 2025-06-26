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
import { AppConfig } from '../config/ConfigLoader';

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

export interface NodeData {
  key: string;
  x: number;
  y: number;
  degree: number;
  cluster_id: number;
  label?: string;
  [key: string]: any;
}

export interface EdgeData {
  source: string;
  target: string;
  isTreeEdge?: boolean;
  [key: string]: any;
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
}

// Services
export interface NodeService {
  addNodes(nodes: NodeData[]): void;
  removeNodes(nodeIds: string[]): void;
  getNodesByViewport(bounds: ViewportBounds): NodeData[];
  getNodeCount(): number;
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
    
    // Initialize strategies
    this.loadingStrategy = this.createLoadingStrategy();
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
    if (this.isUpdatingViewport) {
      return;
    }

    try {
      this.isUpdatingViewport = true;
      const bounds = this.viewportService.getCurrentBounds();
      const result = await this.loadingStrategy.loadViewport(bounds);
      await this.processLoadingResult(result);
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
    try {
      console.log(`🔍 Searching and highlighting: "${query}"`);
      
      // Use the existing search API to find matching nodes
      const searchResponse = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`);
      if (!searchResponse.ok) {
        throw new Error(`Search API error: ${searchResponse.status}`);
      }
      
      const searchResults = await searchResponse.json();
      console.log(`🔍 Found ${searchResults.length} search results`);
      
      if (!searchResults || searchResults.length === 0) {
        return [];
      }
      
      // Load the found nodes and their neighbors
      const loadedNodes: NodeData[] = [];
      
      for (const result of searchResults) {
        const nodeId = result.nodeId || result.id || result.key;
        if (!nodeId) continue;
        
        try {
          // Load the specific node
          const targetNode = await this.loadSpecificNode(nodeId);
          if (targetNode) {
            loadedNodes.push(targetNode);
            
            // Add node to graph if not already present
            if (!this.graph.hasNode(nodeId)) {
              this.addNodeToGraph(targetNode);
            }
            
            // Load neighbors for better context
            const neighbors = await this.loadNodeNeighbors(nodeId, targetNode);
            for (const neighbor of neighbors) {
              if (!this.graph.hasNode(neighbor.key)) {
                this.addNodeToGraph(neighbor);
                loadedNodes.push(neighbor);
              }
            }
          }
        } catch (error) {
          console.error(`🔍 Error loading node ${nodeId}:`, error);
        }
      }
      
      // Highlight the loaded nodes
      if (loadedNodes.length > 0) {
        await this.highlightSearchResults(loadedNodes);
        
        // Center on the first result
        const firstNode = loadedNodes[0];
        this.centerOn(firstNode.x, firstNode.y, 0.5); // Zoom in to see the node clearly
      }
      
      console.log(`🔍 Successfully loaded and highlighted ${loadedNodes.length} nodes`);
      return loadedNodes;
      
    } catch (error) {
      console.error('🔍 Error in searchAndHighlight:', error);
      this.handleError(error as Error, 'searchAndHighlight');
      return [];
    }
  }

  /**
   * 🔍 Load specific node by ID (for search functionality)
   */
  private async loadSpecificNode(nodeId: string): Promise<NodeData | null> {
    try {
      console.log(`🔍 Loading specific node: ${nodeId}`);
      
      // Use the existing nodes API to search for the specific node
      const response = await fetch(`/api/nodes?nodeIds=${encodeURIComponent(nodeId)}&limit=1`);
      if (!response.ok) {
        throw new Error(`Node API error: ${response.status}`);
      }
      
      const nodes = await response.json();
      if (nodes && nodes.length > 0) {
        const node = nodes[0];
        const coordinateScale = this.appConfig.viewport?.coordinateScale || 1000;
        
        const nodeData: NodeData = {
          key: node.key || nodeId,
          x: (node.x || node.attributes?.x || 0) * coordinateScale,
          y: (node.y || node.attributes?.y || 0) * coordinateScale,
          degree: node.degree || node.attributes?.degree || 0,
          cluster_id: Number(node.cluster_id || node.attributes?.cluster_id || node.attributes?.community || 0),
          label: node.label || node.attributes?.label || nodeId
        };
        
        console.log(`🔍 Successfully loaded node ${nodeId}`);
        return nodeData;
      }
      
      return null;
    } catch (error) {
      console.error(`🔍 Error loading node ${nodeId}:`, error);
      return null;
    }
  }

  /**
   * 🔍 Load neighbors of a specific node
   */
  private async loadNodeNeighbors(nodeId: string, centerNode: NodeData, radius: number = 1000): Promise<NodeData[]> {
    try {
      console.log(`🔍 Loading neighbors of ${nodeId} within radius ${radius}`);
      
      // Load nodes in area around the target node
      const padding = radius;
      const response = await fetch('/api/nodes/box', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minX: centerNode.x - padding,
          maxX: centerNode.x + padding,
          minY: centerNode.y - padding,
          maxY: centerNode.y + padding,
          limit: 50,
          minDegree: 1
        })
      });
      
      if (!response.ok) {
        throw new Error(`Neighbors API error: ${response.status}`);
      }
      
      const nodes = await response.json();
      if (!nodes || !Array.isArray(nodes)) {
        return [];
      }
      
      const coordinateScale = this.appConfig.viewport?.coordinateScale || 1000;
      const neighbors: NodeData[] = nodes
        .filter(node => (node.key || node.id) !== nodeId) // Exclude the center node
        .map(node => ({
          key: node.key || node.id,
          x: (node.x || node.attributes?.x || 0) * coordinateScale,
          y: (node.y || node.attributes?.y || 0) * coordinateScale,
          degree: node.degree || node.attributes?.degree || 0,
          cluster_id: Number(node.cluster_id || node.attributes?.cluster_id || node.attributes?.community || 0),
          label: node.label || node.attributes?.label || node.key || node.id
        }));
      
      console.log(`🔍 Loaded ${neighbors.length} neighbors for ${nodeId}`);
      return neighbors;
      
    } catch (error) {
      console.error(`🔍 Error loading neighbors for ${nodeId}:`, error);
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
        if (this.graph.hasNode(nodeData.key)) {
          // Store original style
          const originalAttrs = this.graph.getNodeAttributes(nodeData.key);
          originalNodeStyles.set(nodeData.key, {
            color: originalAttrs.color,
            size: originalAttrs.size
          });
        
          // Apply highlight style
          const isFocusNode = index < maxFocusNodes;
          this.graph.mergeNodeAttributes(nodeData.key, {
            color: isFocusNode ? focusNodeColor : neighborNodeColor,
            size: (originalAttrs.size || 5) * (isFocusNode ? 2.0 : 1.3)
          });
        }
      });
      
      // Find and highlight edges between the nodes (star pattern from focus nodes)
      const focusNodeIds = new Set(focusNodes.map(n => n.key));
      const allNodeIds = new Set(nodes.map(n => n.key));
      
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
        focusNodes: focusNodes.map(n => n.key),
        neighborNodes: neighborNodes.map(n => n.key),
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
    try {
      if (this.graph.hasNode(nodeData.key)) {
        return; // Node already exists
      }
      
      // Get visual config
      const defaultSize = this.appConfig.visual?.nodes?.defaultSize || 3;
      const coordinateScale = this.appConfig.viewport?.coordinateScale || 1000;
      
      // Add node with attributes
      this.graph.addNode(nodeData.key, {
        x: nodeData.x,
        y: nodeData.y,
        size: defaultSize,
        color: this.getNodeColor(nodeData.cluster_id),
        label: nodeData.label,
        degree: nodeData.degree,
        cluster_id: nodeData.cluster_id
      });
      
      console.log(`🔧 Added node ${nodeData.key} to graph`);
      
    } catch (error) {
      console.error(`🔧 Error adding node ${nodeData.key} to graph:`, error);
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
    // Apply node reducer
    this.sigma.setSetting("nodeReducer", (node, data) => {
      // Transform sigma node data to our NodeData interface
      const nodeData: NodeData = {
        key: node,
        x: data.x || 0,
        y: data.y || 0,
        degree: data.degree || 0,
        cluster_id: data.cluster_id || 0,
        label: data.label,
        ...data
      };
      return this.renderingStrategy.applyNodeStyle(node, nodeData);
    });
    
    // Apply edge reducer
    this.sigma.setSetting("edgeReducer", (edge, data) => {
      // Transform sigma edge data to our EdgeData interface
      const edgeData: EdgeData = {
        source: data.source || '',
        target: data.target || '',
        isTreeEdge: data.isTreeEdge,
        ...data
      };
      return this.renderingStrategy.applyEdgeStyle(edge, edgeData);
    });
  }

  private async loadInitialData(): Promise<void> {
    const initialBounds = this.viewportService.getCurrentBounds();
    const result = await this.loadingStrategy.loadViewport(initialBounds);
    await this.processLoadingResult(result);
  }

  private async processLoadingResult(result: LoadingResult): Promise<void> {
    // Add nodes
    if (result.nodes.length > 0) {
      this.nodeService.addNodes(result.nodes);
      this.emit('nodes-added', { count: result.nodes.length });
    }
    
    // Add edges
    if (result.edges.length > 0) {
      this.edgeService.addEdges(result.edges);
      this.emit('edges-added', { count: result.edges.length });
    }
    
    // Update stats
    this.updateStats({
      hasMore: result.hasMore,
      ...result.stats
    });
  }

  private updateStats(updates: Partial<GraphStats>): void {
    this.currentStats = { ...this.currentStats, ...updates };
    this.emit('stats-updated', { stats: this.currentStats });
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