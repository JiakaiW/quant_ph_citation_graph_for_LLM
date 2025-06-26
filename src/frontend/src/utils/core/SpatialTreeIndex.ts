import {
  NodeData,
  EdgeData,
  TreeNode,
  TreeEdge,
  BrokenEdge,
  ViewportBounds,
  TreeLODConfig,
} from '../types';

interface EnrichmentResult {
  treeNodes: NodeData[]; // New tree nodes loaded (tree expansion)
  extraEdges: EdgeData[]; // New extra edges loaded (cycle shortcuts)
}

// The TreeNode interface is already defined in types.ts, but the one in the
// design doc has `spatialHash`, which I've added to the one in types.ts.
// The one in the design doc for phase 1.1 is also slightly different from the
// one I added to types.ts. I will use the one from the design doc as a reference
// to create the class, but stick to the `TreeNode` in `types.ts` for consistency.

interface SpatialTreeIndex {
  // Spatial queries (fast viewport intersection)
  getNodesInBounds(bounds: ViewportBounds): TreeNode[];

  // Tree queries (connectivity preservation)
  getTreePath(fromNodeId: string, toNodeId: string): TreeNode[];
  getTreeNeighbors(nodeId: string, radius: number): TreeNode[];

  // Hybrid queries (the core innovation)
  getConnectedSubgraphInBounds(
    bounds: ViewportBounds,
    lodConfig: TreeLODConfig,
  ): {
    nodes: TreeNode[];
    treeEdges: TreeEdge[];
    brokenEdges: BrokenEdge[]; // Edges that exit the viewport
  };
}

/**
 * Calculates a Level of Detail (LOD) score for a tree node based on camera zoom,
 * tree depth, publication year, and citation count. This score helps determine
 * which nodes are most important to display at different zoom levels.
 *
 * @param node The tree node to calculate the score for.
 * @param config The LOD configuration containing thresholds and camera ratio.
 * @returns A numerical LOD score. Higher scores are more important.
 */
function calculateTreeLOD(node: TreeNode, config: TreeLODConfig): number {
  const spatialLOD = Math.log10(config.cameraRatio + 1) * 2;
  const treeLOD = node.treeLevel / config.maxTreeLevel;
  const temporalLOD = (2024 - node.publicationYear) / 30; // 30-year window
  const importanceLOD = Math.log10(node.degree + 1) / 5;

  // Weighted combination - these weights can be tuned based on user studies
  return (
    spatialLOD * 0.4 +
    treeLOD * 0.3 +
    temporalLOD * 0.15 +
    importanceLOD * 0.15
  );
}

// The design doc only provides an interface. I will create a class implementing it.
export class SpatialTreeIndexImpl implements SpatialTreeIndex {
  getNodesInBounds(bounds: ViewportBounds): TreeNode[] {
    throw new Error('Method not implemented.');
  }
  getTreePath(fromNodeId: string, toNodeId: string): TreeNode[] {
    throw new Error('Method not implemented.');
  }
  getTreeNeighbors(nodeId: string, radius: number): TreeNode[] {
    throw new Error('Method not implemented.');
  }
  getConnectedSubgraphInBounds(
    bounds: ViewportBounds,
    lodConfig: TreeLODConfig,
  ): { nodes: TreeNode[]; treeEdges: TreeEdge[]; brokenEdges: BrokenEdge[] } {
    throw new Error('Method not implemented.');
  }
} 