import { EdgeService } from '../core/UnifiedGraphManager';
import { TreeEdge, ExtraEdge, BrokenEdge, EdgeData } from '../types';
import { TreeNodeService } from './TreeNodeService';

// This is a placeholder for a graph library.
// In a real implementation, this would be `sigma` or `graphology`.
interface Graph {
  addEdge(id: string, source: string, target: string, attributes: any): void;
}

export class TreeEdgeService implements EdgeService {
  private treeEdges: Map<string, TreeEdge>;
  private extraEdges: Map<string, ExtraEdge>;
  private brokenEdges: Map<string, BrokenEdge>;
  private nodeService: TreeNodeService; // Assuming we get a TreeNodeService instance
  private graph: Graph; // Placeholder for graph instance

  constructor(graph: Graph, nodeService: TreeNodeService) {
    this.graph = graph;
    this.nodeService = nodeService;
    this.treeEdges = new Map();
    this.extraEdges = new Map();
    this.brokenEdges = new Map();
  }

  // Tree edge management (connectivity critical)
  addTreeEdges(edges: TreeEdge[]): void {
    for (const edge of edges) {
      const edgeId = `${edge.source}-${edge.target}`;
      this.treeEdges.set(edgeId, edge);

      // Tree edges are always visible and cannot be removed without breaking connectivity
      this.graph.addEdge(edgeId, edge.source, edge.target, {
        ...(edge as any).attributes,
        isTreeEdge: true,
        priority: 'high',
        removable: false, // Cannot remove without breaking tree
      });
    }
  }

  // Extra edge management (enrichment)
  addExtraEdges(edges: ExtraEdge[]): void {
    for (const edge of edges) {
      const edgeId = `${edge.source}-${edge.target}`;

      // Only add if both nodes are loaded (prevent broken connections)
      if (
        this.nodeService.hasNode(edge.source) &&
        this.nodeService.hasNode(edge.target)
      ) {
        this.extraEdges.set(edgeId, edge);

        this.graph.addEdge(edgeId, edge.source, edge.target, {
          ...(edge as any).attributes,
          isTreeEdge: false,
          priority: 'normal',
          removable: true, // Can be removed for memory management
        });
      }
    }
  }

  // Critical: Tree neighbor finding (for search results)
  getTreeNeighbors(nodeId: string, depth = 1): string[] {
    const neighbors = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; currentDepth: number }> = [
      { nodeId, currentDepth: 0 },
    ];

    while (queue.length > 0) {
      const { nodeId: currentNode, currentDepth } = queue.shift()!;

      if (visited.has(currentNode) || currentDepth >= depth) continue;
      visited.add(currentNode);

      // Find tree connections (parent-child relationships)
      for (const [edgeId, edge] of this.treeEdges) {
        if (edge.source === currentNode && !visited.has(edge.target)) {
          neighbors.add(edge.target);
          queue.push({ nodeId: edge.target, currentDepth: currentDepth + 1 });
        }
        if (edge.target === currentNode && !visited.has(edge.source)) {
          neighbors.add(edge.source);
          queue.push({ nodeId: edge.source, currentDepth: currentDepth + 1 });
        }
      }
    }

    return Array.from(neighbors);
  }

  // Implementation of EdgeService interface
  addEdges(edges: EdgeData[]): void {
    // This can delegate to the specific adders based on isTreeEdge property
    const treeEdges: TreeEdge[] = [];
    const extraEdges: ExtraEdge[] = [];
    for (const edge of edges) {
        if (edge.isTreeEdge) {
            treeEdges.push(edge as TreeEdge);
        } else {
            extraEdges.push(edge as ExtraEdge)
        }
    }
    this.addTreeEdges(treeEdges);
    this.addExtraEdges(extraEdges);
  }

  removeEdges(edgeIds: string[]): void {
    for (const edgeId of edgeIds) {
      this.treeEdges.delete(edgeId);
      this.extraEdges.delete(edgeId);
    }
  }

  getEdgesForNodes(nodeIds: string[]): EdgeData[] {
    const edges: EdgeData[] = [];
    const allEdges = [...this.treeEdges.values(), ...this.extraEdges.values()];
    for (const edge of allEdges) {
        if (nodeIds.includes(edge.source) || nodeIds.includes(edge.target)) {
            edges.push(edge);
        }
    }
    return edges;
  }

  getEdgeCount(): number {
    return this.treeEdges.size + this.extraEdges.size;
  }

  getTreeEdges(): TreeEdge[] {
    return Array.from(this.treeEdges.values());
  }

  getExtraEdges(): ExtraEdge[] {
    return Array.from(this.extraEdges.values());
  }
} 