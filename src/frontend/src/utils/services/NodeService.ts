/**
 * 🎯 Node Service Implementation
 * 
 * Concrete implementation of NodeService that manages node operations
 * in the Sigma.js graph with proper state tracking and viewport optimization.
 */

import { Sigma } from 'sigma';
import Graph from 'graphology';
import { BaseManager, ManagerConfig } from '../core/BaseManager';
import { NodeService, NodeData, ViewportBounds } from '../core/UnifiedGraphManager';

export interface NodeServiceConfig extends ManagerConfig {
  maxNodes: number;
  spatialIndexing: boolean;
  memoryManagement: boolean;
}

export class NodeServiceImpl extends BaseManager<NodeServiceConfig> implements NodeService {
  private graph: Graph;
  private sigma: Sigma;
  private nodeIndex: Map<string, NodeData> = new Map();
  private spatialIndex: Map<string, Set<string>> = new Map(); // Simple spatial hash
  private nodeCount: number = 0;

  constructor(sigma: Sigma, config: NodeServiceConfig) {
    super(config);
    this.sigma = sigma;
    this.graph = sigma.getGraph();
  }

  async initialize(): Promise<void> {
    await this.safeInitialize(async () => {
      // Setup graph event listeners for node tracking
      this.graph.on('nodeAdded', (event: any) => {
        this.nodeCount++;
        this.updateSpatialIndex(event.key, event.attributes);
      });

      this.graph.on('nodeDropped', (event: any) => {
        this.nodeCount--;
        this.removeFromSpatialIndex(event.key, event.attributes);
        this.nodeIndex.delete(event.key);
      });

      console.log('🎯 NodeService initialized');
    });
  }

  destroy(): void {
    this.safeDestroy(() => {
      this.nodeIndex.clear();
      this.spatialIndex.clear();
      this.nodeCount = 0;
    });
  }

  addNodes(nodes: NodeData[]): void {
    if (!this.isInitialized) {
      console.warn('NodeService not initialized, cannot add nodes');
      return;
    }

    const nodesToAdd: Array<{ key: string; attributes: any }> = [];

    for (const node of nodes) {
      // Skip if node already exists
      if (this.graph.hasNode(node.key)) {
        continue;
      }

      // Store in our index
      this.nodeIndex.set(node.key, node);

      // Prepare for graph addition
      const attributes = {
        ...node, // Start with all node properties
        label: node.label || node.key,
        size: this.calculateNodeSize(node.degree),
        color: this.getNodeColor(node.cluster_id),
        community: node.cluster_id, // For backward compatibility
      };

      nodesToAdd.push({ key: node.key, attributes });
    }

    // Batch add to graph
    for (const { key, attributes } of nodesToAdd) {
      try {
        this.graph.addNode(key, attributes);
      } catch (error) {
        console.warn(`Failed to add node ${key}:`, error);
      }
    }

    if (this.config.debug && nodesToAdd.length > 0) {
      console.log(`🎯 NodeService: Added ${nodesToAdd.length} nodes`);
    }
  }

  removeNodes(nodeIds: string[]): void {
    if (!this.isInitialized) {
      console.warn('NodeService not initialized, cannot remove nodes');
      return;
    }

    let removedCount = 0;

    for (const nodeId of nodeIds) {
      if (this.graph.hasNode(nodeId)) {
        try {
          this.graph.dropNode(nodeId);
          this.nodeIndex.delete(nodeId);
          removedCount++;
        } catch (error) {
          console.warn(`Failed to remove node ${nodeId}:`, error);
        }
      }
    }

    if (this.config.debug && removedCount > 0) {
      console.log(`🎯 NodeService: Removed ${removedCount} nodes`);
    }
  }

  getNodesByViewport(bounds: ViewportBounds): NodeData[] {
    if (!this.isInitialized) {
      return [];
    }

    const result: NodeData[] = [];

    // Use spatial index if enabled
    if (this.config.spatialIndexing) {
      const spatialKeys = this.getSpatialKeys(bounds);
      const candidateNodes = new Set<string>();

      for (const key of spatialKeys) {
        const nodes = this.spatialIndex.get(key);
        if (nodes) {
          for (const nodeId of nodes) {
            candidateNodes.add(nodeId);
          }
        }
      }

      for (const nodeId of candidateNodes) {
        const nodeData = this.nodeIndex.get(nodeId);
        if (nodeData && this.isNodeInBounds(nodeData, bounds)) {
          result.push(nodeData);
        }
      }
    } else {
      // Brute force check all nodes
      for (const [nodeId, nodeData] of this.nodeIndex) {
        if (this.isNodeInBounds(nodeData, bounds)) {
          result.push(nodeData);
        }
      }
    }

    return result;
  }

  getNodeCount(): number {
    return this.nodeCount;
  }

  // Additional utility methods

  hasNode(nodeId: string): boolean {
    return this.nodeIndex.has(nodeId);
  }

  getNode(nodeId: string): NodeData | undefined {
    return this.nodeIndex.get(nodeId);
  }

  getAllNodes(): NodeData[] {
    return Array.from(this.nodeIndex.values());
  }

  getNodesByCluster(clusterId: number): NodeData[] {
    const result: NodeData[] = [];
    for (const nodeData of this.nodeIndex.values()) {
      if (nodeData.cluster_id === clusterId) {
        result.push(nodeData);
      }
    }
    return result;
  }

  // Private helper methods

  private calculateNodeSize(degree: number): number {
    // Simple size calculation based on degree
    const baseSize = 3;
    const maxSize = 15;
    const sizeMultiplier = Math.log10(degree + 1) * 2;
    return Math.min(baseSize + sizeMultiplier, maxSize);
  }

  private getNodeColor(clusterId: number): string {
    // Default colors for clusters
    const colors = [
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
      '#1abc9c', '#e67e22', '#34495e', '#f1c40f', '#e91e63'
    ];
    return colors[clusterId % colors.length] || '#888888';
  }

  private updateSpatialIndex(nodeId: string, attributes: any): void {
    if (!this.config.spatialIndexing) return;

    const spatialKey = this.getSpatialKey(attributes.x, attributes.y);
    if (!this.spatialIndex.has(spatialKey)) {
      this.spatialIndex.set(spatialKey, new Set());
    }
    this.spatialIndex.get(spatialKey)!.add(nodeId);
  }

  private removeFromSpatialIndex(nodeId: string, attributes: any): void {
    if (!this.config.spatialIndexing) return;

    const spatialKey = this.getSpatialKey(attributes.x, attributes.y);
    const nodes = this.spatialIndex.get(spatialKey);
    if (nodes) {
      nodes.delete(nodeId);
      if (nodes.size === 0) {
        this.spatialIndex.delete(spatialKey);
      }
    }
  }

  private getSpatialKey(x: number, y: number): string {
    // Simple spatial hashing - divide space into grid cells
    const cellSize = 5; // Adjust based on coordinate scale
    const gridX = Math.floor(x / cellSize);
    const gridY = Math.floor(y / cellSize);
    return `${gridX},${gridY}`;
  }

  private getSpatialKeys(bounds: ViewportBounds): string[] {
    const cellSize = 5;
    const keys: string[] = [];
    
    const minGridX = Math.floor(bounds.minX / cellSize);
    const maxGridX = Math.floor(bounds.maxX / cellSize);
    const minGridY = Math.floor(bounds.minY / cellSize);
    const maxGridY = Math.floor(bounds.maxY / cellSize);

    for (let x = minGridX; x <= maxGridX; x++) {
      for (let y = minGridY; y <= maxGridY; y++) {
        keys.push(`${x},${y}`);
      }
    }

    return keys;
  }

  private isNodeInBounds(node: NodeData, bounds: ViewportBounds): boolean {
    return node.x >= bounds.minX && 
           node.x <= bounds.maxX && 
           node.y >= bounds.minY && 
           node.y <= bounds.maxY;
  }
} 