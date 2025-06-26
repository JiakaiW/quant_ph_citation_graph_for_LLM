import Graph from 'graphology';

interface EdgeData {
  source: string;
  target: string;
  isTreeEdge: boolean;
}

interface EdgeAttributes {
  isTreeEdge?: boolean;
  [key: string]: any;
}

export class EdgeCacheManager {
  private edgeCache: Map<string, EdgeData[]> = new Map();
  private graph: Graph | null = null;

  constructor() {
    // No longer initialize in constructor
  }

  public setGraph(graph: Graph): void {
    this.graph = graph;
    this.initializeCache();
  }

  private initializeCache(): void {
    if (!this.graph) return;
    
    // Clear existing cache
    this.edgeCache.clear();
    
    // Build initial cache from graph
    this.graph.forEachNode((nodeId: string) => {
      const edges: EdgeData[] = [];
      this.graph?.forEachEdge(
        nodeId,
        (edge: string, attrs: EdgeAttributes, source: string, target: string) => {
          edges.push({
            source,
            target,
            isTreeEdge: attrs.isTreeEdge || false
          });
        }
      );
      if (edges.length > 0) {
        this.edgeCache.set(nodeId, edges);
      }
    });
  }

  public getEdgesForNode(nodeId: string): EdgeData[] {
    return this.edgeCache.get(nodeId) || [];
  }

  public addEdge(source: string, target: string, isTreeEdge: boolean): void {
    // Add to source node's cache
    const sourceEdges = this.edgeCache.get(source) || [];
    sourceEdges.push({ source, target, isTreeEdge });
    this.edgeCache.set(source, sourceEdges);

    // Add to target node's cache
    const targetEdges = this.edgeCache.get(target) || [];
    targetEdges.push({ source, target, isTreeEdge });
    this.edgeCache.set(target, targetEdges);
  }

  public removeEdge(source: string, target: string): void {
    // Remove from source node's cache
    const sourceEdges = this.edgeCache.get(source) || [];
    this.edgeCache.set(source, sourceEdges.filter(e => 
      !(e.source === source && e.target === target)
    ));

    // Remove from target node's cache
    const targetEdges = this.edgeCache.get(target) || [];
    this.edgeCache.set(target, targetEdges.filter(e => 
      !(e.source === source && e.target === target)
    ));
  }

  public clear(): void {
    this.edgeCache.clear();
  }

  public getCacheSize(): number {
    return this.edgeCache.size;
  }

  public getEdgeCount(): number {
    let count = 0;
    this.edgeCache.forEach(edges => {
      count += edges.length;
    });
    return count / 2; // Divide by 2 because each edge is counted twice (once for source, once for target)
  }
} 