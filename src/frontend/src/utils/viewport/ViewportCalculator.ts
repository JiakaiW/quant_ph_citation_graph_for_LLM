import { ViewportBounds } from '../types/GraphTypes';

/**
 * 🗺️ Viewport Calculator
 * 
 * Handles coordinate transformations and viewport bounds calculations
 * for the Sigma.js graph visualization.
 */
export class ViewportCalculator {
  private sigma: any; // Using any to avoid Sigma import issues for now

  constructor(sigma: any) {
    this.sigma = sigma;
  }

  /**
   * Calculate current viewport bounds in database coordinates
   */
  getViewportBounds(debug: boolean = false): ViewportBounds {
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

    // Debug logging if requested
    if (debug) {
      console.log(`🎥 Camera state: x=${camera.x.toFixed(3)}, y=${camera.y.toFixed(3)}, ratio=${camera.ratio.toFixed(6)}`);
      console.log(`🔄 Screen corners: TL(0,0) → (${topLeft.x.toFixed(3)}, ${topLeft.y.toFixed(3)})`);
      console.log(`🔄 Screen corners: TR(${screenWidth},0) → (${topRight.x.toFixed(3)}, ${topRight.y.toFixed(3)})`);
      console.log(`🔄 Screen corners: BL(0,${screenHeight}) → (${bottomLeft.x.toFixed(3)}, ${bottomLeft.y.toFixed(3)})`);
      console.log(`🔄 Screen corners: BR(${screenWidth},${screenHeight}) → (${bottomRight.x.toFixed(3)}, ${bottomRight.y.toFixed(3)})`);
      console.log(`📐 Actual Viewport: screen(${screenWidth}x${screenHeight}) → graph[${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}, ${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}]`);
      console.log(`📏 Viewport size: ${bounds.width.toFixed(3)} x ${bounds.height.toFixed(3)}`);
      console.log(`🎯 VIEWPORT BOUNDS: minX=${bounds.minX.toFixed(3)}, maxX=${bounds.maxX.toFixed(3)}, minY=${bounds.minY.toFixed(3)}, maxY=${bounds.maxY.toFixed(3)}`);
    }
    
    return bounds;
  }

  /**
   * Count existing nodes within viewport bounds
   */
  countNodesInViewport(bounds: ViewportBounds): number {
    const graph = this.sigma.getGraph();
    const existingNodes = graph.nodes();
    let nodesInViewport = 0;
    
    existingNodes.forEach((nodeId: string) => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (this.isNodeInViewportBounds(attrs, bounds)) {
        nodesInViewport++;
      }
    });
    
    return nodesInViewport;
  }

  /**
   * Get nodes within viewport bounds
   */
  getNodesInViewport(bounds: ViewportBounds): string[] {
    const graph = this.sigma.getGraph();
    const viewportNodes: string[] = [];
    
    graph.nodes().forEach((nodeId: string) => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (this.isNodeInViewportBounds(attrs, bounds)) {
        viewportNodes.push(nodeId);
      }
    });
    
    return viewportNodes;
  }

  /**
   * Get nodes outside viewport bounds
   */
  getNodesOutsideViewport(bounds: ViewportBounds): string[] {
    const graph = this.sigma.getGraph();
    const outsideNodes: string[] = [];
    
    graph.nodes().forEach((nodeId: string) => {
      const attrs = graph.getNodeAttributes(nodeId);
      if (!this.isNodeInViewportBounds(attrs, bounds)) {
        outsideNodes.push(nodeId);
      }
    });
    
    return outsideNodes;
  }

  /**
   * Check if a node is within viewport bounds
   */
  isNodeInViewport(nodeId: string, bounds: ViewportBounds): boolean {
    const graph = this.sigma.getGraph();
    if (!graph.hasNode(nodeId)) return false;
    
    const attrs = graph.getNodeAttributes(nodeId);
    return this.isNodeInViewportBounds(attrs, bounds);
  }

  /**
   * Check if node attributes indicate it's within viewport bounds
   */
  private isNodeInViewportBounds(nodeAttrs: any, bounds: ViewportBounds): boolean {
    return nodeAttrs.x >= bounds.minX && nodeAttrs.x <= bounds.maxX && 
           nodeAttrs.y >= bounds.minY && nodeAttrs.y <= bounds.maxY;
  }

  /**
   * Calculate distance from viewport center
   */
  getDistanceFromViewportCenter(nodeId: string, bounds: ViewportBounds): number {
    const graph = this.sigma.getGraph();
    if (!graph.hasNode(nodeId)) return Infinity;
    
    const attrs = graph.getNodeAttributes(nodeId);
    return this.calculateDistanceFromCenter(attrs, bounds);
  }

  /**
   * Calculate distance from viewport center using node attributes
   */
  calculateDistanceFromCenter(nodeAttrs: any, bounds: ViewportBounds): number {
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const dx = nodeAttrs.x - centerX;
    const dy = nodeAttrs.y - centerY;
    
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Get viewport statistics for debugging
   */
  getViewportStats(bounds: ViewportBounds): {
    totalNodes: number;
    viewportNodes: number;
    outsideNodes: number;
    viewportRatio: number;
  } {
    const graph = this.sigma.getGraph();
    const totalNodes = graph.order;
    const viewportNodes = this.countNodesInViewport(bounds);
    const outsideNodes = totalNodes - viewportNodes;
    const viewportRatio = totalNodes > 0 ? viewportNodes / totalNodes : 0;

    return {
      totalNodes,
      viewportNodes,
      outsideNodes,
      viewportRatio
    };
  }

  /**
   * Get current camera state
   */
  getCameraState(): { x: number; y: number; ratio: number } {
    const camera = this.sigma.getCamera();
    return {
      x: camera.x,
      y: camera.y,
      ratio: camera.ratio
    };
  }
} 