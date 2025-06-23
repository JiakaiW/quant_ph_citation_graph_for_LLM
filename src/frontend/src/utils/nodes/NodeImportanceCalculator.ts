import { NodeImportance, ViewportBounds, CategoryResult } from '../types/GraphTypes';

/**
 * 🧠 Node Importance Calculator
 * 
 * Calculates importance scores for nodes based on degree, viewport position,
 * and other factors to determine which nodes should be kept in memory.
 */
export class NodeImportanceCalculator {
  
  /**
   * Calculate node importance for memory management
   */
  calculateNodeImportance(
    nodeId: string, 
    nodeAttributes: any, 
    bounds: ViewportBounds,
    lodLevel: number = 0
  ): NodeImportance {
    const degree = nodeAttributes.degree || 1;
    
    // Check if node is within current viewport
    const isInViewport = this.isNodeInViewportBounds(nodeAttributes, bounds);
    
    // Calculate distance from viewport center
    const distanceFromCenter = this.calculateDistanceFromCenter(nodeAttributes, bounds);
    
    // Importance score calculation
    const degreeScore = Math.log(degree + 1) * 10; // Logarithmic degree importance
    const distanceScore = Math.max(0, 100 - distanceFromCenter); // Closer = higher score
    
    // CRITICAL: Nodes in viewport get massive importance boost to prevent removal
    const viewportBonus = isInViewport ? 1000 : 0;
    
    // LOD-based bonus: higher LOD levels favor high-degree nodes more
    const lodBonus = lodLevel > 2 ? Math.log(degree + 1) * lodLevel : 0;
    
    const importance = degreeScore + distanceScore + viewportBonus + lodBonus;
    
    return {
      nodeId,
      degree,
      distanceFromCenter,
      lastSeen: Date.now(),
      importance,
      lodLevel
    };
  }

  /**
   * Calculate importance for multiple nodes
   */
  calculateBatchImportance(
    nodeIds: string[],
    getNodeAttributes: (nodeId: string) => any,
    bounds: ViewportBounds,
    lodLevel: number = 0
  ): NodeImportance[] {
    return nodeIds.map(nodeId => {
      const attributes = getNodeAttributes(nodeId);
      return this.calculateNodeImportance(nodeId, attributes, bounds, lodLevel);
    });
  }

  /**
   * Sort nodes by importance (ascending - least important first)
   */
  sortByImportance(importanceList: NodeImportance[]): NodeImportance[] {
    return [...importanceList].sort((a, b) => a.importance - b.importance);
  }

  /**
   * Sort nodes by importance (descending - most important first)
   */
  sortByImportanceDesc(importanceList: NodeImportance[]): NodeImportance[] {
    return [...importanceList].sort((a, b) => b.importance - a.importance);
  }

  /**
   * Get nodes to remove based on importance and target count
   */
  selectNodesForRemoval(
    importanceList: NodeImportance[],
    targetRemovalCount: number
  ): NodeImportance[] {
    const sorted = this.sortByImportance(importanceList);
    return sorted.slice(0, Math.min(targetRemovalCount, sorted.length));
  }

  /**
   * Categorize nodes by viewport position
   */
  categorizeNodesByViewport(
    nodeIds: string[],
    getNodeAttributes: (nodeId: string) => any,
    bounds: ViewportBounds
  ): CategoryResult {
    const viewportNodes: string[] = [];
    const nonViewportNodes: string[] = [];
    
    nodeIds.forEach(nodeId => {
      const attrs = getNodeAttributes(nodeId);
      if (this.isNodeInViewportBounds(attrs, bounds)) {
        viewportNodes.push(nodeId);
      } else {
        nonViewportNodes.push(nodeId);
      }
    });

    return { viewportNodes, nonViewportNodes };
  }

  /**
   * Calculate removal strategy statistics
   */
  calculateRemovalStats(
    nodesToRemove: NodeImportance[],
    getNodeAttributes: (nodeId: string) => any,
    bounds: ViewportBounds
  ): { removedViewport: number, removedNonViewport: number } {
    let removedViewport = 0;
    let removedNonViewport = 0;
    
    nodesToRemove.forEach(({ nodeId }) => {
      const attrs = getNodeAttributes(nodeId);
      const isInViewport = this.isNodeInViewportBounds(attrs, bounds);
      
      if (isInViewport) {
        removedViewport++;
      } else {
        removedNonViewport++;
      }
    });

    return { removedViewport, removedNonViewport };
  }

  /**
   * Get importance statistics for debugging
   */
  getImportanceStats(importanceList: NodeImportance[]): {
    count: number;
    avgImportance: number;
    minImportance: number;
    maxImportance: number;
    viewportCount: number;
    nonViewportCount: number;
  } {
    if (importanceList.length === 0) {
      return {
        count: 0,
        avgImportance: 0,
        minImportance: 0,
        maxImportance: 0,
        viewportCount: 0,
        nonViewportCount: 0
      };
    }

    const importanceScores = importanceList.map(item => item.importance);
    const avgImportance = importanceScores.reduce((sum, score) => sum + score, 0) / importanceScores.length;
    const minImportance = Math.min(...importanceScores);
    const maxImportance = Math.max(...importanceScores);

    // Count viewport vs non-viewport nodes (viewport nodes have importance > 1000)
    const viewportCount = importanceList.filter(item => item.importance > 1000).length;
    const nonViewportCount = importanceList.length - viewportCount;

    return {
      count: importanceList.length,
      avgImportance,
      minImportance,
      maxImportance,
      viewportCount,
      nonViewportCount
    };
  }

  /**
   * Filter nodes by minimum importance threshold
   */
  filterByMinImportance(
    importanceList: NodeImportance[],
    minImportance: number
  ): NodeImportance[] {
    return importanceList.filter(item => item.importance >= minImportance);
  }

  /**
   * Get top N most important nodes
   */
  getTopImportantNodes(
    importanceList: NodeImportance[],
    count: number
  ): NodeImportance[] {
    const sorted = this.sortByImportanceDesc(importanceList);
    return sorted.slice(0, Math.min(count, sorted.length));
  }

  /**
   * Check if node attributes indicate it's within viewport bounds
   */
  private isNodeInViewportBounds(nodeAttrs: any, bounds: ViewportBounds): boolean {
    return nodeAttrs.x >= bounds.minX && nodeAttrs.x <= bounds.maxX && 
           nodeAttrs.y >= bounds.minY && nodeAttrs.y <= bounds.maxY;
  }

  /**
   * Calculate distance from viewport center using node attributes
   */
  private calculateDistanceFromCenter(nodeAttrs: any, bounds: ViewportBounds): number {
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const dx = nodeAttrs.x - centerX;
    const dy = nodeAttrs.y - centerY;
    
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Create importance map for quick lookups
   */
  createImportanceMap(importanceList: NodeImportance[]): Map<string, NodeImportance> {
    const map = new Map<string, NodeImportance>();
    importanceList.forEach(item => {
      map.set(item.nodeId, item);
    });
    return map;
  }

  /**
   * Update importance scores for existing nodes (useful for incremental updates)
   */
  updateImportanceScores(
    existingMap: Map<string, NodeImportance>,
    nodeIds: string[],
    getNodeAttributes: (nodeId: string) => any,
    bounds: ViewportBounds,
    lodLevel: number = 0
  ): Map<string, NodeImportance> {
    const updatedMap = new Map(existingMap);
    
    nodeIds.forEach(nodeId => {
      const attributes = getNodeAttributes(nodeId);
      const importance = this.calculateNodeImportance(nodeId, attributes, bounds, lodLevel);
      updatedMap.set(nodeId, importance);
    });
    
    return updatedMap;
  }
} 