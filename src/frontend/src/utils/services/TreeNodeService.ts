import {
  NodeData,
  TreeNode,
  TreeEdge,
  ViewportBounds,
  TreeLODConfig,
  TreeFragmentResponse,
} from '../types';
import {
  SpatialTreeIndexImpl,
} from '../core/SpatialTreeIndex';
import { TreeStateManagerImpl } from '../core/TreeStateManager';
import { NodeService } from '../core/UnifiedGraphManager';

// This is a placeholder for the calculateTreeLOD function.
// In a real implementation, this would be imported from where it's defined.
function calculateTreeLOD(node: TreeNode, config: TreeLODConfig): number {
  const spatialLOD = Math.log10(config.cameraRatio + 1) * 2;
  const treeLOD = node.treeLevel / config.maxTreeLevel;
  const temporalLOD = (2024 - node.publicationYear) / 30; // 30-year window
  const importanceLOD = Math.log10(node.degree + 1) / 5;
  return (
    spatialLOD * 0.4 + treeLOD * 0.3 + temporalLOD * 0.15 + importanceLOD * 0.15
  );
}

export class TreeNodeService implements NodeService {
  private spatialTreeIndex: SpatialTreeIndexImpl;
  private treeStateManager: TreeStateManagerImpl;
  private loadedNodes: Map<string, TreeNode>;

  constructor(
    spatialTreeIndex: SpatialTreeIndexImpl,
    treeStateManager: TreeStateManagerImpl,
  ) {
    this.spatialTreeIndex = spatialTreeIndex;
    this.treeStateManager = treeStateManager;
    this.loadedNodes = new Map<string, TreeNode>();
  }

  // Core tree-spatial integration
  async addTreeFragment(fragment: TreeFragmentResponse): Promise<void> {
    // 1. Validate connectivity - every node must have path to root
    this.validateConnectivity(fragment.nodes, fragment.tree_edges);

    // 2. Update spatial index with tree metadata
    for (const node of fragment.nodes) {
      // The design doc mentions this.spatialTreeIndex.addNode(node);
      // I am assuming this method will be implemented in the future.
      // For now I will leave it commented out.
      // this.spatialTreeIndex.addNode(node);
      this.loadedNodes.set(node.key, node);
    }

    // 3. Track fragment state for enrichment
    this.treeStateManager.addTreeFragment(fragment);

    // 4. Detect broken connections for future enrichment
    // The design doc mentions this.trackBrokenEdges(fragment.broken_edges);
    // I am assuming this method will be implemented in the future.
  }

  // Tree-aware spatial queries
  getNodesInViewport(
    bounds: ViewportBounds,
    lodConfig: TreeLODConfig,
  ): TreeNode[] {
    // Use spatial index but filter by tree-LOD criteria
    const spatialCandidates = this.spatialTreeIndex.getNodesInBounds(bounds);

    return spatialCandidates.filter((node: TreeNode) => {
      const lodScore = calculateTreeLOD(node, lodConfig);
      // The design doc mentions lodConfig.threshold, which I added to the type.
      return lodScore >= (lodConfig.threshold ?? 0);
    });
  }

  // Critical: Connectivity validation
  private validateConnectivity(nodes: TreeNode[], edges: TreeEdge[]): void {
    const nodeMap = new Map(nodes.map(n => [n.key, n]));
    const edgeMap = new Map(edges.map(e => [`${e.source}-${e.target}`, e]));

    for (const node of nodes) {
      if (!node.isRoot) {
        // Every non-root node must have at least one parent in the loaded set
        const hasConnectedParent = node.parentIds.some(parentId =>
          nodeMap.has(parentId),
        );
        if (!hasConnectedParent) {
          throw new Error(
            `Node ${node.key} has no connected parent - connectivity broken`,
          );
        }
      }
    }
  }

  // Implementation of NodeService interface
  addNodes(nodes: NodeData[]): void {
    // This will be properly implemented later.
    // For now, we'll just add them to our internal map if they are TreeNodes.
    for (const node of nodes) {
      if ('treeLevel' in node) {
        this.loadedNodes.set(node.key, node as TreeNode);
      }
    }
  }
  removeNodes(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      this.loadedNodes.delete(nodeId);
    }
  }
  getNodesByViewport(bounds: ViewportBounds): NodeData[] {
    const nodes: NodeData[] = [];
    for (const node of this.loadedNodes.values()) {
      if (node.x >= bounds.minX && node.x <= bounds.maxX && node.y >= bounds.minY && node.y <= bounds.maxY) {
        nodes.push(node);
      }
    }
    return nodes;
  }
  getNodeCount(): number {
    return this.loadedNodes.size;
  }

  hasNode(nodeId: string): boolean {
    return this.loadedNodes.has(nodeId);
  }

  getLoadedNodeIds(): string[] {
    return Array.from(this.loadedNodes.keys());
  }

  getNode(nodeId: string): TreeNode | undefined {
    return this.loadedNodes.get(nodeId);
  }

  getAllNodes(): TreeNode[] {
    return Array.from(this.loadedNodes.values());
  }
} 