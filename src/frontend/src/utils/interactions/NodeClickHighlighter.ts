/**
 * 🖱️ Node Click Highlighter
 * 
 * Handles click interactions on nodes to highlight them and their connected neighbors.
 * Integrates with the existing NodeHighlighter system for consistent visual effects.
 */

import { NodeHighlighter } from '../search/NodeHighlighter';
import { HighlightConfig, DEFAULT_HIGHLIGHT_CONFIG } from '../search/SearchTypes';

export interface ClickHighlightConfig extends HighlightConfig {
  // Click-specific settings
  clickToSelect: boolean;
  doubleClickToClear: boolean;
  showClickedNodeInfo: boolean;
  neighborDepth: number;
}

export const DEFAULT_CLICK_HIGHLIGHT_CONFIG: ClickHighlightConfig = {
  ...DEFAULT_HIGHLIGHT_CONFIG,
  clickToSelect: true,
  doubleClickToClear: true,
  showClickedNodeInfo: true,
  neighborDepth: 1,
  // Override some defaults for click interactions
  focusNodeColor: '#ff4444',      // Bright red for clicked node
  neighborNodeColor: '#ffaa44',   // Orange for neighbors  
  focusNodeSize: 8,               // Larger for clicked node
  neighborNodeSize: 6,            // Medium for neighbors
  fadeOtherNodes: true,           // Fade non-connected nodes
  fadeOpacity: 0.15,              // More transparent for better contrast
};

export class NodeClickHighlighter {
  private sigma: any;
  private graph: any;
  private nodeHighlighter: NodeHighlighter;
  private config: ClickHighlightConfig;
  private currentlySelectedNode: string | null = null;
  private isActive: boolean = false;
  private clickListeners: Map<string, Function> = new Map();

  constructor(
    sigma: any, 
    graph: any, 
    config: ClickHighlightConfig = DEFAULT_CLICK_HIGHLIGHT_CONFIG
  ) {
    this.sigma = sigma;
    this.graph = graph;
    this.config = config;
    this.nodeHighlighter = new NodeHighlighter(graph, sigma, config);
    
    this.setupEventListeners();
    console.log('🖱️ NodeClickHighlighter initialized');
  }

  /**
   * Set up click event listeners
   */
  private setupEventListeners(): void {
    // Node click handler
    const handleNodeClick = async (event: any) => {
      const nodeId = event.node;
      console.log(`🖱️ Node clicked: ${nodeId}`);
      
      if (this.currentlySelectedNode === nodeId) {
        // Clicking the same node again clears the highlight
        await this.clearHighlight();
      } else {
        // Highlight the clicked node and its neighbors
        await this.highlightNodeAndNeighbors(nodeId);
      }
    };

    // Double-click to clear (if enabled)
    const handleNodeDoubleClick = async (event: any) => {
      if (this.config.doubleClickToClear) {
        console.log(`🖱️ Node double-clicked: clearing highlights`);
        await this.clearHighlight();
      }
    };

    // Click on empty space to clear highlights
    const handleStageClick = async (event: any) => {
      // Only clear if clicking on empty space (not on a node)
      if (!event.node && !event.edge) {
        console.log(`🖱️ Clicked on empty space: clearing highlights`);
        await this.clearHighlight();
      }
    };

    // Register event listeners
    this.sigma.on('clickNode', handleNodeClick);
    this.sigma.on('doubleClickNode', handleNodeDoubleClick);
    this.sigma.on('clickStage', handleStageClick);

    // Store references for cleanup
    this.clickListeners.set('clickNode', handleNodeClick);
    this.clickListeners.set('doubleClickNode', handleNodeDoubleClick);
    this.clickListeners.set('clickStage', handleStageClick);
  }

  /**
   * 🎯 Highlight a clicked node and its neighbors
   */
  async highlightNodeAndNeighbors(nodeId: string): Promise<void> {
    if (!this.graph.hasNode(nodeId)) {
      console.warn(`🖱️ Cannot highlight node ${nodeId}: not found in graph`);
      return;
    }

    console.log(`🖱️ Highlighting clicked node ${nodeId} and its neighbors`);

    try {
      // Use the existing NodeHighlighter with our configuration
      await this.nodeHighlighter.highlightNode(
        nodeId, 
        this.config.neighborDepth, 
        true // animate transition
      );

      this.currentlySelectedNode = nodeId;
      this.isActive = true;

      // Emit event for other components to listen to
      this.emitHighlightEvent('nodeSelected', {
        nodeId,
        neighbors: this.getNodeNeighbors(nodeId)
      });

      console.log(`🖱️ Successfully highlighted node ${nodeId}`);
    } catch (error) {
      console.error(`🖱️ Error highlighting node ${nodeId}:`, error);
    }
  }

  /**
   * 🧹 Clear all highlighting
   */
  async clearHighlight(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    console.log('🖱️ Clearing click highlights');

    try {
      await this.nodeHighlighter.clearHighlight(true); // animate transition
      
      this.currentlySelectedNode = null;
      this.isActive = false;

      // Emit event
      this.emitHighlightEvent('highlightCleared', {});

      console.log('🖱️ Click highlights cleared');
    } catch (error) {
      console.error('🖱️ Error clearing highlights:', error);
    }
  }

  /**
   * 🔍 Get neighbors of a node
   */
  private getNodeNeighbors(nodeId: string): string[] {
    if (!this.graph.hasNode(nodeId)) {
      return [];
    }
    return this.graph.neighbors(nodeId);
  }

  /**
   * 📡 Emit highlight events for other components
   */
  private emitHighlightEvent(eventType: string, data: any): void {
    // For now, just log - can be extended to use an event system
    console.log(`🖱️ Event: ${eventType}`, data);
    
    // Could dispatch custom DOM events or use a pub/sub system
    const event = new CustomEvent(`nodeClickHighlight:${eventType}`, {
      detail: data
    });
    document.dispatchEvent(event);
  }

  /**
   * 📊 Get current highlight state
   */
  getHighlightState(): {
    isActive: boolean;
    selectedNode: string | null;
    highlightedNodes: string[];
    highlightedEdges: string[];
  } {
    const highlightState = this.nodeHighlighter.getHighlightState();
    
    return {
      isActive: this.isActive,
      selectedNode: this.currentlySelectedNode,
      highlightedNodes: highlightState.highlightedNodes,
      highlightedEdges: highlightState.highlightedEdges
    };
  }

  /**
   * ⚙️ Update configuration
   */
  updateConfig(newConfig: Partial<ClickHighlightConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.nodeHighlighter.updateConfig(newConfig);
    console.log('🖱️ Click highlighter config updated', newConfig);
  }

  /**
   * 🎯 Check if a node is currently selected
   */
  isNodeSelected(nodeId: string): boolean {
    return this.currentlySelectedNode === nodeId;
  }

  /**
   * 🎯 Get currently selected node
   */
  getCurrentlySelectedNode(): string | null {
    return this.currentlySelectedNode;
  }

  /**
   * 🎯 Programmatically select a node (for external API)
   */
  async selectNode(nodeId: string): Promise<void> {
    await this.highlightNodeAndNeighbors(nodeId);
  }

  /**
   * 🧹 Cleanup event listeners and resources
   */
  cleanup(): void {
    console.log('🖱️ Cleaning up NodeClickHighlighter');

    // Remove event listeners
    this.clickListeners.forEach((handler, eventName) => {
      this.sigma.off(eventName, handler);
    });
    this.clickListeners.clear();

    // Cleanup highlighter
    this.nodeHighlighter.cleanup();

    // Clear state
    this.currentlySelectedNode = null;
    this.isActive = false;
  }

  /**
   * 🔄 Enable/disable click interactions
   */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.setupEventListeners();
      console.log('🖱️ Click interactions enabled');
    } else {
      this.cleanup();
      console.log('🖱️ Click interactions disabled');
    }
  }
} 