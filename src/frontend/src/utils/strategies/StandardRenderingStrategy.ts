/**
 * 🎨 Standard Rendering Strategy
 * 
 * Standard implementation of RenderingStrategy that handles basic visual
 * styling for nodes and edges with LOD-based adjustments.
 */

import { RenderingStrategy, NodeData, EdgeData } from '../core/UnifiedGraphManager';

export interface StandardRenderingConfig {
  nodes: {
    defaultSize: number;
    minSize: number;
    maxSize: number;
    defaultColor: string;
    sizeScale: number;
  };
  edges: {
    defaultSize: number;
    minSize: number;
    maxSize: number;
    defaultColor: string;
    treeEdgeColor: string;
  };
  lod: {
    hideLabelsThreshold: number;
    hideEdgesThreshold: number;
    nodeDetailThreshold: number;
  };
  clusters: {
    colors: string[];
    defaultColor: string;
  };
  debug: boolean;
}

export class StandardRenderingStrategy implements RenderingStrategy {
  private config: StandardRenderingConfig;
  private currentLODLevel: string = 'medium';

  constructor(config: StandardRenderingConfig) {
    this.config = config;
  }

  applyNodeStyle(nodeId: string, nodeData: NodeData): any {
    const size = this.calculateNodeSize(nodeData);
    const color = this.getNodeColor(nodeData);
    const label = this.shouldShowLabel(nodeData) ? nodeData.label : '';

    return {
      x: nodeData.x,
      y: nodeData.y,
      size,
      color,
      label,
      hidden: false,
      // Additional properties for highlighting and interaction
      highlighted: false,
      selected: false,
      type: 'circle', // Default node shape
      zIndex: this.getNodeZIndex(nodeData)
    };
  }

  applyEdgeStyle(edgeId: string, edgeData: EdgeData): any {
    const size = this.calculateEdgeSize(edgeData);
    const color = this.getEdgeColor(edgeData);
    const hidden = this.shouldHideEdge(edgeData);

    return {
      size,
      color,
      hidden,
      // Additional properties for highlighting and interaction
      highlighted: false,
      selected: false,
      type: 'line', // Default edge shape
      zIndex: this.getEdgeZIndex(edgeData)
    };
  }

  updateLODSettings(lodLevel: string): void {
    this.currentLODLevel = lodLevel;
    
    if (this.config.debug) {
      console.log('🎨 StandardRenderingStrategy: Updated LOD level to', lodLevel);
    }
  }

  // Private methods for node styling

  private calculateNodeSize(nodeData: NodeData): number {
    const { defaultSize, minSize, maxSize, sizeScale } = this.config.nodes;
    
    // Size based on degree with logarithmic scaling
    const logDegree = Math.log10(Math.max(1, nodeData.degree));
    const scaledSize = defaultSize + (logDegree * sizeScale);
    
    // Apply LOD adjustments
    let lodMultiplier = 1;
    switch (this.currentLODLevel) {
      case 'zoomed-out':
        lodMultiplier = 0.8; // Smaller nodes when zoomed out
        break;
      case 'detail':
        lodMultiplier = 1.2; // Larger nodes when zoomed in
        break;
    }
    
    const finalSize = scaledSize * lodMultiplier;
    return Math.max(minSize, Math.min(maxSize, finalSize));
  }

  private getNodeColor(nodeData: NodeData): string {
    const { colors, defaultColor } = this.config.clusters;
    
    // Use cluster-based coloring
    if (nodeData.cluster_id >= 0 && nodeData.cluster_id < colors.length) {
      return colors[nodeData.cluster_id];
    }
    
    // Fallback for unknown clusters
    if (nodeData.cluster_id >= 0) {
      const colorIndex = nodeData.cluster_id % colors.length;
      return colors[colorIndex];
    }
    
    return defaultColor;
  }

  private shouldShowLabel(nodeData: NodeData): boolean {
    // Show labels based on LOD level and node importance
    switch (this.currentLODLevel) {
      case 'zoomed-out':
        return nodeData.degree > 20; // Only high-degree nodes
      case 'medium':
        return nodeData.degree > 10; // Medium-degree nodes
      case 'zoomed-in':
        return nodeData.degree > 5; // Most nodes
      case 'detail':
        return true; // All nodes
      default:
        return nodeData.degree > this.config.lod.hideLabelsThreshold;
    }
  }

  private getNodeZIndex(nodeData: NodeData): number {
    // Higher degree nodes should appear on top
    return Math.min(100, Math.floor(Math.log10(nodeData.degree + 1) * 10));
  }

  // Private methods for edge styling

  private calculateEdgeSize(edgeData: EdgeData): number {
    const { defaultSize, minSize, maxSize } = this.config.edges;
    
    // Tree edges are slightly thicker
    const baseSize = edgeData.isTreeEdge ? defaultSize * 1.2 : defaultSize;
    
    // Apply LOD adjustments
    let lodMultiplier = 1;
    switch (this.currentLODLevel) {
      case 'zoomed-out':
        lodMultiplier = 0.7; // Thinner edges when zoomed out
        break;
      case 'detail':
        lodMultiplier = 1.3; // Thicker edges when zoomed in
        break;
    }
    
    const finalSize = baseSize * lodMultiplier;
    return Math.max(minSize, Math.min(maxSize, finalSize));
  }

  private getEdgeColor(edgeData: EdgeData): string {
    const { defaultColor, treeEdgeColor } = this.config.edges;
    
    if (edgeData.isTreeEdge) {
      return treeEdgeColor;
    }
    
    return defaultColor;
  }

  private shouldHideEdge(edgeData: EdgeData): boolean {
    // Hide edges based on LOD level
    switch (this.currentLODLevel) {
      case 'zoomed-out':
        return !edgeData.isTreeEdge; // Only show tree edges
      case 'medium':
        return false; // Show all edges
      case 'zoomed-in':
        return false; // Show all edges
      case 'detail':
        return false; // Show all edges
      default:
        return false;
    }
  }

  private getEdgeZIndex(edgeData: EdgeData): number {
    // Tree edges should appear on top of regular edges
    return edgeData.isTreeEdge ? 10 : 1;
  }

  // Public utility methods

  public setHighlighted(nodeId: string, highlighted: boolean): void {
    // This would typically update the node's highlighted state
    // Implementation depends on how the graph manages state
    if (this.config.debug) {
      console.log(`🎨 StandardRenderingStrategy: Node ${nodeId} highlighted: ${highlighted}`);
    }
  }

  public setSelected(nodeId: string, selected: boolean): void {
    // This would typically update the node's selected state
    if (this.config.debug) {
      console.log(`🎨 StandardRenderingStrategy: Node ${nodeId} selected: ${selected}`);
    }
  }

  public updateConfig(updates: Partial<StandardRenderingConfig>): void {
    this.config = { ...this.config, ...updates };
    
    if (this.config.debug) {
      console.log('🎨 StandardRenderingStrategy: Configuration updated', updates);
    }
  }

  public getConfig(): StandardRenderingConfig {
    return this.config;
  }

  public getCurrentLODLevel(): string {
    return this.currentLODLevel;
  }
} 