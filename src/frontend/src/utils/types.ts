/**
 * Basic 2D coordinates
 */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Viewport bounds with min/max coordinates and dimensions
 */
export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width?: number;
  height?: number;
  maxNodes?: number;
  minDegree?: number;
}

/**
 * Generic node data structure, compatible with UnifiedGraphManager.
 */
export interface NodeData {
  key: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  degree: number;
  cluster_id: number;
  [key: string]: any;
}

/**
 * Generic edge data structure, compatible with UnifiedGraphManager.
 */
export interface EdgeData {
  source: string;
  target: string;
  label?: string;
  size?: number;
  color?: string;
  isTreeEdge?: boolean;
  [key: string]: any;
}

/**
 * Represents a node within the citation tree.
 * Extends the base NodeData.
 */
export interface TreeNode extends NodeData {
  treeLevel: number;
  publicationYear: number;
  degree: number;
  parentIds: string[];
  childIds: string[];
  isRoot: boolean;
  isLeaf: boolean;
  spatialHash: string;
}

/**
 * Represents a guaranteed parent-child relationship in the citation DAG.
 */
export interface TreeEdge extends EdgeData {
  // Tree-specific attributes can be added here
}

/**
 * Represents an edge that connects a node inside the viewport
 * to a node outside the viewport.
 */
export interface BrokenEdge {
  source_id: string;
  target_id: string;
  edge_type: 'parent' | 'child';
  priority: number;
}

/**
 * Configuration for Level of Detail (LOD) based on tree properties.
 */
export interface TreeLODConfig {
  cameraRatio: number;
  maxTreeLevel: number;
  yearThreshold: number;
  degreeThreshold: number;
  threshold?: number; // General LOD threshold
}

/**
 * Statistics about a loaded tree fragment.
 */
export interface TreeFragmentStats {
  nodeCount: number;
  edgeCount: number;
}

/**
 * Represents the backend response for a tree fragment request.
 */
export interface TreeFragmentResponse {
  nodes: TreeNode[];
  tree_edges: TreeEdge[];
  broken_edges: BrokenEdge[];
  tree_stats: TreeFragmentStats;
  hasMore?: boolean;
}

/**
 * Represents an edge that creates a cycle, providing a shortcut
 * between distant parts of the citation tree.
 */
export interface ExtraEdge extends EdgeData {
  priority: number;
}

/**
 * Result of a tree loading operation, extending the base LoadingResult.
 */
export interface TreeLoadingResult {
  nodes: TreeNode[];
  edges: EdgeData[];
  treeEdges: TreeEdge[];
  brokenEdges: BrokenEdge[];
  hasMore: boolean;
  enrichmentCandidates: BrokenEdge[];
  stats: any;
}

/**
 * Result of an enrichment operation.
 */
export interface EnrichmentResult {
  treeNodes: NodeData[];
  extraEdges: EdgeData[];
}

export interface TreeGraphStats {
  totalNodes: number;
  treeEdges: number;
  extraEdges: number;
  disconnectedNodes: number;
  connectivityRatio: number;
  enrichmentProgress: number;
} 