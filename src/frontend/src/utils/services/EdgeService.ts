/**
 * 🔗 Edge Service Implementation
 * 
 * Concrete implementation of EdgeService that manages edge operations
 * in the Sigma.js graph with caching and viewport optimization.
 */

import { Sigma } from 'sigma';
import Graph from 'graphology';
import { BaseManager, ManagerConfig } from '../core/BaseManager';
import { EdgeService, EdgeData } from '../core/UnifiedGraphManager';

export interface EdgeServiceConfig extends ManagerConfig {
  maxEdges: number;
  cacheEdges: boolean;
  enableTreeEdges: boolean;
}

export class EdgeServiceImpl extends BaseManager<EdgeServiceConfig> implements EdgeService {
  private graph: Graph;
  private sigma: Sigma;
  private edgeIndex: Map<string, EdgeData> = new Map();
  private nodeEdgeIndex: Map<string, Set<string>> = new Map(); // nodeId -> edgeIds
  private edgeCount: number = 0;

  constructor(sigma: Sigma, config: EdgeServiceConfig) {
    super(config);
    this.sigma = sigma;
    this.graph = sigma.getGraph();
  }

  async initialize(): Promise<void> {
    await this.safeInitialize(async () => {
      // Setup graph event listeners for edge tracking
      this.graph.on('edgeAdded', (event: any) => {
        this.edgeCount++;
        this.updateNodeEdgeIndex(event.key, event.source, event.target);
      });

      this.graph.on('edgeDropped', (event: any) => {
        this.edgeCount--;
        this.removeFromNodeEdgeIndex(event.key, event.source, event.target);
        this.edgeIndex.delete(event.key);
      });

      console.log('🔗 EdgeService initialized');
    });
  }

  destroy(): void {
    this.safeDestroy(() => {
      this.edgeIndex.clear();
      this.nodeEdgeIndex.clear();
      this.edgeCount = 0;
    });
  }

  addEdges(edges: EdgeData[]): void {
    if (!this.isInitialized) {
      console.warn('EdgeService not initialized, cannot add edges');
      return;
    }

    const edgesToAdd: Array<{ key: string; source: string; target: string; attributes: any }> = [];

    for (const edge of edges) {
      const edgeKey = this.getEdgeKey(edge.source, edge.target);
      
      // Skip if edge already exists
      if (this.graph.hasEdge(edgeKey)) {
        continue;
      }

      // Verify both nodes exist
      if (!this.graph.hasNode(edge.source) || !this.graph.hasNode(edge.target)) {
        if (this.config.debug) {
          console.warn(`Skipping edge ${edgeKey}: missing node(s)`);
        }
        continue;
      }

      // Store in our index
      this.edgeIndex.set(edgeKey, edge);

      // Prepare for graph addition
      const attributes = {
        ...edge,
        size: this.calculateEdgeSize(edge),
        color: this.getEdgeColor(edge),
        hidden: !this.shouldShowEdge(edge), // Initially hidden based on configuration
      };

      edgesToAdd.push({ 
        key: edgeKey, 
        source: edge.source, 
        target: edge.target, 
        attributes 
      });
    }

    // Batch add to graph
    for (const { key, source, target, attributes } of edgesToAdd) {
      try {
        this.graph.addEdge(source, target, attributes);
      } catch (error) {
        console.warn(`Failed to add edge ${key}:`, error);
      }
    }

    if (this.config.debug && edgesToAdd.length > 0) {
      console.log(`🔗 EdgeService: Added ${edgesToAdd.length} edges`);
    }
  }

  removeEdges(edgeIds: string[]): void {
    if (!this.isInitialized) {
      console.warn('EdgeService not initialized, cannot remove edges');
      return;
    }

    let removedCount = 0;

    for (const edgeId of edgeIds) {
      if (this.graph.hasEdge(edgeId)) {
        try {
          this.graph.dropEdge(edgeId);
          this.edgeIndex.delete(edgeId);
          removedCount++;
        } catch (error) {
          console.warn(`Failed to remove edge ${edgeId}:`, error);
        }
      }
    }

    if (this.config.debug && removedCount > 0) {
      console.log(`🔗 EdgeService: Removed ${removedCount} edges`);
    }
  }

  getEdgesForNodes(nodeIds: string[]): EdgeData[] {
    if (!this.isInitialized) {
      return [];
    }

    const result: EdgeData[] = [];
    const edgeSet = new Set<string>();

    // Collect all edges for the specified nodes
    for (const nodeId of nodeIds) {
      const nodeEdges = this.nodeEdgeIndex.get(nodeId);
      if (nodeEdges) {
        for (const edgeId of nodeEdges) {
          edgeSet.add(edgeId);
        }
      }
    }

    // Convert to EdgeData array
    for (const edgeId of edgeSet) {
      const edgeData = this.edgeIndex.get(edgeId);
      if (edgeData) {
        result.push(edgeData);
      }
    }

    return result;
  }

  getEdgeCount(): number {
    return this.edgeCount;
  }

  // Additional utility methods

  hasEdge(source: string, target: string): boolean {
    const edgeKey = this.getEdgeKey(source, target);
    return this.edgeIndex.has(edgeKey);
  }

  getEdge(source: string, target: string): EdgeData | undefined {
    const edgeKey = this.getEdgeKey(source, target);
    return this.edgeIndex.get(edgeKey);
  }

  getAllEdges(): EdgeData[] {
    return Array.from(this.edgeIndex.values());
  }

  getTreeEdges(): EdgeData[] {
    const result: EdgeData[] = [];
    for (const edgeData of this.edgeIndex.values()) {
      if (edgeData.isTreeEdge) {
        result.push(edgeData);
      }
    }
    return result;
  }

  showEdgesForNodes(nodeIds: string[]): void {
    // Show edges connected to the specified nodes
    const edgesToShow = this.getEdgesForNodes(nodeIds);
    
    for (const edge of edgesToShow) {
      const edgeKey = this.getEdgeKey(edge.source, edge.target);
      if (this.graph.hasEdge(edgeKey)) {
        this.graph.setEdgeAttribute(edgeKey, 'hidden', false);
      }
    }

    if (this.config.debug) {
      console.log(`🔗 EdgeService: Showed ${edgesToShow.length} edges for ${nodeIds.length} nodes`);
    }
  }

  hideAllEdges(): void {
    // Hide all edges
    this.graph.forEachEdge((edgeId: string) => {
      this.graph.setEdgeAttribute(edgeId, 'hidden', true);
    });

    if (this.config.debug) {
      console.log('🔗 EdgeService: Hidden all edges');
    }
  }

  // Private helper methods

  private getEdgeKey(source: string, target: string): string {
    // Create consistent edge key regardless of direction
    return `${source}->${target}`;
  }

  private calculateEdgeSize(edge: EdgeData): number {
    // Different sizes for tree edges vs regular edges
    if (edge.isTreeEdge) {
      return 1.5; // Tree edges are thicker
    }
    return 0.8; // Regular edges are thinner
  }

  private getEdgeColor(edge: EdgeData): string {
    // Different colors for tree edges vs regular edges
    if (edge.isTreeEdge) {
      return 'rgba(68, 68, 68, 0.8)'; // Dark gray for tree edges
    }
    return 'rgba(102, 102, 102, 0.6)'; // Light gray for regular edges
  }

  private shouldShowEdge(edge: EdgeData): boolean {
    // Only show tree edges by default if tree edges are enabled
    if (this.config.enableTreeEdges && edge.isTreeEdge) {
      return true;
    }
    
    // Hide regular edges by default (they'll be shown on demand)
    return false;
  }

  private updateNodeEdgeIndex(edgeId: string, source: string, target: string): void {
    // Add edge to both source and target node indexes
    if (!this.nodeEdgeIndex.has(source)) {
      this.nodeEdgeIndex.set(source, new Set());
    }
    if (!this.nodeEdgeIndex.has(target)) {
      this.nodeEdgeIndex.set(target, new Set());
    }

    this.nodeEdgeIndex.get(source)!.add(edgeId);
    this.nodeEdgeIndex.get(target)!.add(edgeId);
  }

  private removeFromNodeEdgeIndex(edgeId: string, source: string, target: string): void {
    // Remove edge from both source and target node indexes
    const sourceEdges = this.nodeEdgeIndex.get(source);
    if (sourceEdges) {
      sourceEdges.delete(edgeId);
      if (sourceEdges.size === 0) {
        this.nodeEdgeIndex.delete(source);
      }
    }

    const targetEdges = this.nodeEdgeIndex.get(target);
    if (targetEdges) {
      targetEdges.delete(edgeId);
      if (targetEdges.size === 0) {
        this.nodeEdgeIndex.delete(target);
      }
    }
  }
} 