import { HighlightConfig, DEFAULT_HIGHLIGHT_CONFIG } from './SearchTypes';

/**
 * 🎨 Node Highlighter
 * 
 * Handles visual highlighting of nodes and edges in the graph.
 * Manages highlight states, animations, and visual effects for search results.
 */
export class NodeHighlighter {
  private graph: any;
  private sigma: any;
  private config: HighlightConfig;
  private originalNodeStyles: Map<string, any> = new Map();
  private originalEdgeStyles: Map<string, any> = new Map();
  private highlightedNodes: Set<string> = new Set();
  private highlightedEdges: Set<string> = new Set();
  private isHighlightActive: boolean = false;

  constructor(graph: any, sigma: any, config: HighlightConfig = DEFAULT_HIGHLIGHT_CONFIG) {
    this.graph = graph;
    this.sigma = sigma;
    this.config = config;
  }

  /**
   * 🎯 Highlight a node and its neighbors
   */
  async highlightNode(
    nodeId: string, 
    neighborDepth: number = 1,
    animateTransition: boolean = true
  ): Promise<void> {
    if (!this.graph.hasNode(nodeId)) {
      console.warn(`🎨 Cannot highlight node ${nodeId}: not found in graph`);
      return;
    }

    console.log(`🎨 Highlighting node ${nodeId} with depth ${neighborDepth}`);

    // Clear any existing highlights
    await this.clearHighlight(false);

    // Find nodes to highlight
    const nodesToHighlight = this.findNodesToHighlight(nodeId, neighborDepth);
    const edgesToHighlight = this.findEdgesToHighlight(nodesToHighlight);

    // Store original styles before modification
    this.storeOriginalStyles(nodesToHighlight, edgesToHighlight);

    // Apply highlighting
    this.applyNodeHighlighting(nodeId, nodesToHighlight);
    this.applyEdgeHighlighting(edgesToHighlight);
    
    if (this.config.fadeOtherNodes) {
      this.fadeNonHighlightedNodes(nodesToHighlight);
    }

    // Update state
    this.highlightedNodes = new Set(nodesToHighlight);
    this.highlightedEdges = new Set(edgesToHighlight);
    this.isHighlightActive = true;

    // Animate transition if requested
    if (animateTransition) {
      await this.animateHighlight();
    }

    // Refresh the graph display
    this.sigma.refresh();

    console.log(`🎨 Highlighted ${nodesToHighlight.length} nodes and ${edgesToHighlight.length} edges`);
  }

  /**
   * 🧹 Clear all highlighting
   */
  async clearHighlight(animateTransition: boolean = true): Promise<void> {
    if (!this.isHighlightActive) {
      return;
    }

    console.log('🎨 Clearing highlights');

    // Restore original styles
    this.restoreOriginalStyles();

    // Clear state
    this.highlightedNodes.clear();
    this.highlightedEdges.clear();
    this.isHighlightActive = false;

    // Animate transition if requested
    if (animateTransition) {
      await this.animateHighlight();
    }

    // Refresh the graph display
    this.sigma.refresh();
  }

  /**
   * 💫 Highlight multiple nodes (for multiple search results)
   */
  async highlightMultipleNodes(
    nodeIds: string[],
    neighborDepth: number = 1
  ): Promise<void> {
    console.log(`🎨 Highlighting ${nodeIds.length} nodes with depth ${neighborDepth}`);

    // Clear existing highlights
    await this.clearHighlight(false);

    // Find all nodes to highlight
    const allNodesToHighlight = new Set<string>();
    const allEdgesToHighlight = new Set<string>();

    nodeIds.forEach(nodeId => {
      if (this.graph.hasNode(nodeId)) {
        const nodes = this.findNodesToHighlight(nodeId, neighborDepth);
        const edges = this.findEdgesToHighlight(nodes);
        
        nodes.forEach(n => allNodesToHighlight.add(n));
        edges.forEach(e => allEdgesToHighlight.add(e));
      }
    });

    const nodesToHighlight = Array.from(allNodesToHighlight);
    const edgesToHighlight = Array.from(allEdgesToHighlight);

    // Store original styles
    this.storeOriginalStyles(nodesToHighlight, edgesToHighlight);

    // Apply highlighting (treat all focus nodes equally)
    nodesToHighlight.forEach(nodeId => {
      if (nodeIds.includes(nodeId)) {
        // This is a focus node
        this.graph.setNodeAttribute(nodeId, 'color', this.config.focusNodeColor);
        this.graph.setNodeAttribute(nodeId, 'size', this.config.focusNodeSize);
      } else {
        // This is a neighbor node
        this.graph.setNodeAttribute(nodeId, 'color', this.config.neighborNodeColor);
        this.graph.setNodeAttribute(nodeId, 'size', this.config.neighborNodeSize);
      }
    });

    this.applyEdgeHighlighting(edgesToHighlight);
    
    if (this.config.fadeOtherNodes) {
      this.fadeNonHighlightedNodes(nodesToHighlight);
    }

    // Update state
    this.highlightedNodes = new Set(nodesToHighlight);
    this.highlightedEdges = new Set(edgesToHighlight);
    this.isHighlightActive = true;

    // Animate and refresh
    await this.animateHighlight();
    this.sigma.refresh();
  }

  /**
   * 🔍 Find nodes to highlight based on focus node and depth
   */
  private findNodesToHighlight(focusNodeId: string, depth: number): string[] {
    const nodesToHighlight = new Set<string>();
    nodesToHighlight.add(focusNodeId);

    // BFS to find neighbors up to specified depth
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; currentDepth: number }> = [
      { nodeId: focusNodeId, currentDepth: 0 }
    ];

    while (queue.length > 0) {
      const { nodeId, currentDepth } = queue.shift()!;
      
      if (visited.has(nodeId) || currentDepth >= depth) {
        continue;
      }
      
      visited.add(nodeId);

      // Add neighbors to queue
      this.graph.neighbors(nodeId).forEach((neighborId: string) => {
        if (!visited.has(neighborId)) {
          nodesToHighlight.add(neighborId);
          queue.push({ nodeId: neighborId, currentDepth: currentDepth + 1 });
        }
      });
    }

    return Array.from(nodesToHighlight);
  }

  /**
   * 🔗 Find edges to highlight based on highlighted nodes
   */
  private findEdgesToHighlight(highlightedNodes: string[]): string[] {
    const nodeSet = new Set(highlightedNodes);
    const edgesToHighlight: string[] = [];

    this.graph.edges().forEach((edgeId: string) => {
      const [source, target] = this.graph.extremities(edgeId);
      
      // Highlight edge if both endpoints are highlighted
      if (nodeSet.has(source) && nodeSet.has(target)) {
        edgesToHighlight.push(edgeId);
      }
    });

    return edgesToHighlight;
  }

  /**
   * 💾 Store original styles before modification
   */
  private storeOriginalStyles(nodeIds: string[], edgeIds: string[]): void {
    // Store original node styles
    nodeIds.forEach(nodeId => {
      if (!this.originalNodeStyles.has(nodeId)) {
        const attrs = this.graph.getNodeAttributes(nodeId);
        this.originalNodeStyles.set(nodeId, {
          color: attrs.color,
          size: attrs.size,
          opacity: attrs.opacity || 1
        });
      }
    });

    // Store original edge styles
    edgeIds.forEach(edgeId => {
      if (!this.originalEdgeStyles.has(edgeId)) {
        const attrs = this.graph.getEdgeAttributes(edgeId);
        this.originalEdgeStyles.set(edgeId, {
          color: attrs.color,
          size: attrs.size,
          opacity: attrs.opacity || 1
        });
      }
    });
  }

  /**
   * 🎨 Apply node highlighting styles
   */
  private applyNodeHighlighting(focusNodeId: string, allNodes: string[]): void {
    allNodes.forEach(nodeId => {
      if (nodeId === focusNodeId) {
        // Focus node gets special styling
        this.graph.setNodeAttribute(nodeId, 'color', this.config.focusNodeColor);
        this.graph.setNodeAttribute(nodeId, 'size', this.config.focusNodeSize);
      } else {
        // Neighbor nodes get different styling
        this.graph.setNodeAttribute(nodeId, 'color', this.config.neighborNodeColor);
        this.graph.setNodeAttribute(nodeId, 'size', this.config.neighborNodeSize);
      }
      
      // Ensure highlighted nodes are fully opaque
      this.graph.setNodeAttribute(nodeId, 'opacity', 1);
    });
  }

  /**
   * 🔗 Apply edge highlighting styles
   */
  private applyEdgeHighlighting(edgeIds: string[]): void {
    edgeIds.forEach(edgeId => {
      this.graph.setEdgeAttribute(edgeId, 'color', this.config.focusEdgeColor);
      this.graph.setEdgeAttribute(edgeId, 'size', this.config.focusEdgeSize);
      this.graph.setEdgeAttribute(edgeId, 'opacity', 1);
    });
  }

  /**
   * 🌫️ Fade non-highlighted nodes and edges
   */
  private fadeNonHighlightedNodes(highlightedNodes: string[]): void {
    const highlightedSet = new Set(highlightedNodes);
    const highlightedEdgeSet = new Set(this.highlightedEdges);

    // Fade non-highlighted nodes
    this.graph.nodes().forEach((nodeId: string) => {
      if (!highlightedSet.has(nodeId)) {
        this.graph.setNodeAttribute(nodeId, 'opacity', this.config.fadeOpacity);
      }
    });

    // Fade non-highlighted edges
    this.graph.edges().forEach((edgeId: string) => {
      if (!highlightedEdgeSet.has(edgeId)) {
        this.graph.setEdgeAttribute(edgeId, 'opacity', this.config.fadeOpacity);
      }
    });
  }

  /**
   * 🔄 Restore original styles
   */
  private restoreOriginalStyles(): void {
    // Restore node styles
    this.originalNodeStyles.forEach((originalStyle, nodeId) => {
      if (this.graph.hasNode(nodeId)) {
        this.graph.setNodeAttribute(nodeId, 'color', originalStyle.color);
        this.graph.setNodeAttribute(nodeId, 'size', originalStyle.size);
        this.graph.setNodeAttribute(nodeId, 'opacity', originalStyle.opacity);
      }
    });

    // Restore edge styles
    this.originalEdgeStyles.forEach((originalStyle, edgeId) => {
      if (this.graph.hasEdge(edgeId)) {
        this.graph.setEdgeAttribute(edgeId, 'color', originalStyle.color);
        this.graph.setEdgeAttribute(edgeId, 'size', originalStyle.size);
        this.graph.setEdgeAttribute(edgeId, 'opacity', originalStyle.opacity);
      }
    });

    // Clear stored styles
    this.originalNodeStyles.clear();
    this.originalEdgeStyles.clear();
  }

  /**
   * ✨ Animate highlight transition
   */
  private async animateHighlight(): Promise<void> {
    if (this.config.animationDuration <= 0) {
      return;
    }

    return new Promise(resolve => {
      setTimeout(() => {
        this.sigma.refresh();
        resolve();
      }, this.config.animationDuration);
    });
  }

  /**
   * 📊 Get current highlight state
   */
  getHighlightState(): {
    isActive: boolean;
    highlightedNodes: string[];
    highlightedEdges: string[];
  } {
    return {
      isActive: this.isHighlightActive,
      highlightedNodes: Array.from(this.highlightedNodes),
      highlightedEdges: Array.from(this.highlightedEdges)
    };
  }

  /**
   * ⚙️ Update highlight configuration
   */
  updateConfig(newConfig: Partial<HighlightConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('🎨 Highlight config updated:', newConfig);
  }

  /**
   * 🎯 Check if a node is currently highlighted
   */
  isNodeHighlighted(nodeId: string): boolean {
    return this.highlightedNodes.has(nodeId);
  }

  /**
   * 🔗 Check if an edge is currently highlighted
   */
  isEdgeHighlighted(edgeId: string): boolean {
    return this.highlightedEdges.has(edgeId);
  }

  /**
   * 🧹 Cleanup resources
   */
  cleanup(): void {
    this.clearHighlight(false);
    this.originalNodeStyles.clear();
    this.originalEdgeStyles.clear();
  }
} 