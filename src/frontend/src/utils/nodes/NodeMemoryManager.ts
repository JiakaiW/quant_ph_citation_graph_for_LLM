import { ViewportBounds, RemovalStats, MemoryStats, NodeImportance } from '../types/GraphTypes';
import { NodeImportanceCalculator } from './NodeImportanceCalculator';
import { ViewportCalculator } from '../viewport/ViewportCalculator';
import { LevelOfDetail } from '../viewport/LevelOfDetail';

/**
 * 🗑️ Node Memory Manager
 * 
 * Handles memory management and node cleanup based on importance scores.
 * Implements smart removal strategies that prioritize viewport nodes.
 */
export class NodeMemoryManager {
  private importanceCalculator: NodeImportanceCalculator;
  private viewportCalculator: ViewportCalculator;
  private lodManager: LevelOfDetail;
  private nodeImportanceMap: Map<string, NodeImportance> = new Map();

  constructor(
    importanceCalculator: NodeImportanceCalculator,
    viewportCalculator: ViewportCalculator,
    lodManager: LevelOfDetail
  ) {
    this.importanceCalculator = importanceCalculator;
    this.viewportCalculator = viewportCalculator;
    this.lodManager = lodManager;
  }

  /**
   * Remove excess nodes based on LOD-aware strategy
   */
  removeExcessNodes(
    graph: any,
    bounds: ViewportBounds,
    maxNodes: number,
    lodLevel: number = 0
  ): RemovalStats {
    const currentNodes = graph.nodes();
    
    if (currentNodes.length <= maxNodes) {
      return { removedCount: 0, removedViewport: 0, removedNonViewport: 0 };
    }

    console.log(`🗑️ Memory management: ${currentNodes.length} nodes > ${maxNodes} limit, removing excess`);

    // Categorize nodes by viewport position
    const { viewportNodes, nonViewportNodes } = this.importanceCalculator.categorizeNodesByViewport(
      currentNodes,
      (nodeId: string) => graph.getNodeAttributes(nodeId),
      bounds
    );

    console.log(`📊 Node distribution for LOD ${lodLevel}: ${viewportNodes.length} viewport, ${nonViewportNodes.length} distant`);

    // Calculate importance for all nodes
    const nodeImportances = this.importanceCalculator.calculateBatchImportance(
      currentNodes,
      (nodeId: string) => graph.getNodeAttributes(nodeId),
      bounds,
      lodLevel
    );

    // Update our internal importance map
    nodeImportances.forEach(importance => {
      this.nodeImportanceMap.set(importance.nodeId, importance);
    });

    // Select nodes for removal based on importance
    const targetRemoval = currentNodes.length - maxNodes;
    const nodesToRemove = this.importanceCalculator.selectNodesForRemoval(nodeImportances, targetRemoval);

    // Execute removal
    const removalStats = this.executeRemoval(graph, nodesToRemove, bounds);

    console.log(`🗑️ Removed ${removalStats.removedCount} nodes: ${removalStats.removedViewport} viewport, ${removalStats.removedNonViewport} distant`);
    console.log(`🎯 Final graph size: ${graph.order} nodes`);

    return removalStats;
  }

  /**
   * Execute node removal and return statistics
   */
  executeRemoval(graph: any, nodesToRemove: NodeImportance[], bounds: ViewportBounds): RemovalStats {
    let removedCount = 0;
    let removedViewport = 0;
    let removedNonViewport = 0;
    
    nodesToRemove.forEach(({ nodeId }) => {
      if (graph.hasNode(nodeId)) {
        const attrs = graph.getNodeAttributes(nodeId);
        const isInViewport = this.viewportCalculator.isNodeInViewport(nodeId, bounds);
        
        // Remove node (this also removes connected edges automatically)
        graph.dropNode(nodeId);
        this.nodeImportanceMap.delete(nodeId);
        removedCount++;
        
        if (isInViewport) {
          removedViewport++;
        } else {
          removedNonViewport++;
        }
      }
    });

    return { removedCount, removedViewport, removedNonViewport };
  }

  /**
   * Legacy removal method for backward compatibility
   */
  removeExcessNodesLegacy(
    graph: any,
    bounds: ViewportBounds,
    maxNodes: number
  ): RemovalStats {
    const currentNodes = graph.nodes();
    
    if (currentNodes.length <= maxNodes) {
      return { removedCount: 0, removedViewport: 0, removedNonViewport: 0 };
    }

    // Use legacy strategy (LOD level 0)
    return this.removeExcessNodes(graph, bounds, maxNodes, 0);
  }

  /**
   * Track node usage for future importance calculations
   */
  trackNodeUsage(nodeId: string): void {
    const existing = this.nodeImportanceMap.get(nodeId);
    if (existing) {
      existing.lastSeen = Date.now();
      this.nodeImportanceMap.set(nodeId, existing);
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(graph: any, bounds: ViewportBounds): MemoryStats {
    const currentNodes = graph.nodes();
    const totalNodes = currentNodes.length;
    
    if (totalNodes === 0) {
      return {
        totalNodes: 0,
        viewportNodes: 0,
        nonViewportNodes: 0,
        avgImportance: 0,
        memoryPressure: 0
      };
    }

    const viewportNodes = this.viewportCalculator.countNodesInViewport(bounds);
    const nonViewportNodes = totalNodes - viewportNodes;

    // Calculate average importance
    const importanceValues = Array.from(this.nodeImportanceMap.values());
    const avgImportance = importanceValues.length > 0 
      ? importanceValues.reduce((sum, item) => sum + item.importance, 0) / importanceValues.length
      : 0;

    // Calculate memory pressure (0-1 scale)
    const maxNodesForCurrentLOD = this.lodManager.getMaxNodes(0); // Use default LOD for pressure calculation
    const memoryPressure = Math.min(1.0, totalNodes / maxNodesForCurrentLOD);

    return {
      totalNodes,
      viewportNodes,
      nonViewportNodes,
      avgImportance,
      memoryPressure
    };
  }

  /**
   * Force cleanup of nodes not seen recently
   */
  cleanupStaleNodes(graph: any, maxAge: number = 30000): number {
    const now = Date.now();
    let removedCount = 0;
    
    const staleNodes: string[] = [];
    this.nodeImportanceMap.forEach((importance, nodeId) => {
      if (now - importance.lastSeen > maxAge) {
        staleNodes.push(nodeId);
      }
    });

    staleNodes.forEach(nodeId => {
      if (graph.hasNode(nodeId)) {
        graph.dropNode(nodeId);
        this.nodeImportanceMap.delete(nodeId);
        removedCount++;
      }
    });

    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} stale nodes (not seen for >${maxAge}ms)`);
    }

    return removedCount;
  }

  /**
   * Get nodes that should be removed based on current memory pressure
   */
  getRemovalCandidates(
    graph: any,
    bounds: ViewportBounds,
    targetReduction: number,
    lodLevel: number = 0
  ): NodeImportance[] {
    const currentNodes = graph.nodes();
    
    const nodeImportances = this.importanceCalculator.calculateBatchImportance(
      currentNodes,
      (nodeId: string) => graph.getNodeAttributes(nodeId),
      bounds,
      lodLevel
    );

    return this.importanceCalculator.selectNodesForRemoval(nodeImportances, targetReduction);
  }

  /**
   * Optimize memory by removing least important nodes
   */
  optimizeMemory(
    graph: any,
    bounds: ViewportBounds,
    targetMemoryPressure: number = 0.8,
    lodLevel: number = 0
  ): RemovalStats {
    const maxNodes = this.lodManager.getMaxNodes(lodLevel);
    const targetNodeCount = Math.floor(maxNodes * targetMemoryPressure);
    const currentNodeCount = graph.order;

    if (currentNodeCount <= targetNodeCount) {
      return { removedCount: 0, removedViewport: 0, removedNonViewport: 0 };
    }

    console.log(`🎯 Memory optimization: reducing from ${currentNodeCount} to ${targetNodeCount} nodes`);
    
    return this.removeExcessNodes(graph, bounds, targetNodeCount, lodLevel);
  }

  /**
   * Get importance map for debugging
   */
  getImportanceMap(): Map<string, NodeImportance> {
    return new Map(this.nodeImportanceMap);
  }

  /**
   * Clear importance tracking
   */
  clearImportanceTracking(): void {
    this.nodeImportanceMap.clear();
    console.log('🧹 Cleared importance tracking');
  }

  /**
   * Get detailed removal preview without actually removing nodes
   */
  previewRemoval(
    graph: any,
    bounds: ViewportBounds,
    maxNodes: number,
    lodLevel: number = 0
  ): {
    wouldRemove: number;
    wouldRemoveViewport: number;
    wouldRemoveNonViewport: number;
    candidates: NodeImportance[];
  } {
    const currentNodes = graph.nodes();
    
    if (currentNodes.length <= maxNodes) {
      return {
        wouldRemove: 0,
        wouldRemoveViewport: 0,
        wouldRemoveNonViewport: 0,
        candidates: []
      };
    }

    const nodeImportances = this.importanceCalculator.calculateBatchImportance(
      currentNodes,
      (nodeId: string) => graph.getNodeAttributes(nodeId),
      bounds,
      lodLevel
    );

    const targetRemoval = currentNodes.length - maxNodes;
    const candidates = this.importanceCalculator.selectNodesForRemoval(nodeImportances, targetRemoval);
    
    const stats = this.importanceCalculator.calculateRemovalStats(
      candidates,
      (nodeId: string) => graph.getNodeAttributes(nodeId),
      bounds
    );

    return {
      wouldRemove: candidates.length,
      wouldRemoveViewport: stats.removedViewport,
      wouldRemoveNonViewport: stats.removedNonViewport,
      candidates
    };
  }
} 