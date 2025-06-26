import { debounce } from 'lodash';

type Bounds = { 
  minX: number; 
  maxX: number; 
  minY: number; 
  maxY: number;
  maxNodes?: number;
  minDegree?: number;
};

export type LoaderData = {
  nodes: any[];
  treeEdges: any[];
  hasMore: boolean;
};

interface ViewportLoaderCallbacks {
  onBatchReceived: (data: LoaderData) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

/**
 * Manages fetching graph data for the current viewport in cancellable batches.
 * This class is decoupled from Sigma and communicates via callbacks.
 */
export class ViewportLoader {
  private currentRequestID = 0;
  private defaultBatchSize = 500;
  private totalNodesLoaded = 0;

  constructor() {}

  public async loadDataForViewport(bounds: Bounds, callbacks: ViewportLoaderCallbacks): Promise<void> {
    // Reset node counter for new viewport
    this.totalNodesLoaded = 0;
    
    // Incrementing the ID effectively cancels any previous, ongoing loading loops.
    this.currentRequestID++;
    const requestID = this.currentRequestID;

    let offset = 0;
    let hasMore = true;
    const maxNodes = bounds.maxNodes || Infinity;

    // Calculate appropriate batch size
    const batchSize = Math.min(this.defaultBatchSize, maxNodes);

    while (hasMore && requestID === this.currentRequestID && this.totalNodesLoaded < maxNodes) {
      try {
        // Calculate remaining nodes we can load
        const remainingNodes = maxNodes - this.totalNodesLoaded;
        const currentBatchSize = Math.min(batchSize, remainingNodes);

        const response = await fetch('/api/nodes/tree-in-box', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            ...bounds, 
            maxNodes: currentBatchSize, 
            offset 
          }),
        });

        if (!response.ok) throw new Error(`Batch fetch failed: ${response.statusText}`);
        
        const data = await response.json();
        
        // If a new request has started, discard this old data.
        if (requestID !== this.currentRequestID) return;

        // Update total nodes loaded
        this.totalNodesLoaded += data.nodes.length;

        // Check if we've hit the maxNodes limit
        const hitNodeLimit = this.totalNodesLoaded >= maxNodes;

        callbacks.onBatchReceived({
          nodes: data.nodes,
          treeEdges: data.treeEdges,
          hasMore: data.hasMore && !hitNodeLimit,
        });

        hasMore = data.hasMore && !hitNodeLimit;
        offset += data.nodes.length;
        
        if (hasMore) await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        hasMore = false;
        callbacks.onError(error as Error);
      }
    }

    if (requestID === this.currentRequestID) {
      callbacks.onComplete();
    }
  }

  public cancel(): void {
    this.currentRequestID++;
    this.totalNodesLoaded = 0;

  }
} 