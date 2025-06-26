import axios from 'axios';

export interface NodeAttributes {
  x: number;
  y: number;
  size?: number;
  color?: string;
  label: string;
  degree: number;
  cluster_id?: string;
  community?: number;
}

// Lightweight version for distant nodes
export interface LightNodeAttributes {
  x: number;
  y: number;
  size: number;
  degree: number;
  color?: string; // Optional for basic rendering
}

export interface Node {
  key: string;
  attributes: NodeAttributes;
}

export interface LightNode {
  key: string;
  attributes: LightNodeAttributes;
}

export interface Edge {
  source: string;
  target: string;
  attributes?: any;
}

export interface DataBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  paddedMinX: number;
  paddedMaxX: number;
  paddedMinY: number;
  paddedMaxY: number;
  total_papers: number;
}

const API_BASE = '/api';

// Global request cancellation management
let currentController: AbortController | null = null;

// Global concurrency control for batch requests
let activeBatchRequests = 0;

export function cancelAllRequests() {
  if (currentController) {
    console.log('🚫 Cancelling previous API requests');
    currentController.abort();
  }
  currentController = new AbortController();
  return currentController.signal;
}

export async function fetchTop(limit: number = 2000, visibleClusters?: number[], minDegree?: number): Promise<Node[]> {
  try {
    const params: any = { limit };
    if (visibleClusters && visibleClusters.length > 0) {
      params.visible_clusters = visibleClusters.join(',');
    }
    if (minDegree !== undefined && minDegree > 0) {
      params.min_degree = minDegree;
    }
    
    const response = await axios.get(`${API_BASE}/nodes/top`, {
      params
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching top nodes:', error);
    return [];
  }
}

interface TreeInBoxParams {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxNodes: number;
  minDegree: number;
  offset: number;
  edgeType: string;
  visible_clusters?: string;
}

interface TreeInBoxResponse {
  nodes: Node[];
  treeEdges: Edge[];
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  hasMore: boolean;
  stats: {
    nodeCount: number;
    edgeCount: number;
    loadTime: number;
    connectivity: string;
  };
}

export async function fetchBox(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  ratio: number = 1.0, // DEPRECATED: kept for backward compatibility
  limit: number = 5000,
  signal?: AbortSignal,
  visibleClusters?: number[],
  minDegree?: number
): Promise<Node[]> {
  try {
    const params: TreeInBoxParams = {
      minX,
      maxX,
      minY,
      maxY,
      maxNodes: limit,
      minDegree: minDegree || 0,
      offset: 0,
      edgeType: "all"
    };
    if (visibleClusters && visibleClusters.length > 0) {
      params.visible_clusters = visibleClusters.join(',');
    }
    
    const response = await axios.post<TreeInBoxResponse>(`${API_BASE}/nodes/tree-in-box`, params, {
      timeout: 5000, // 5 second timeout (reduced from 8s)
      signal: signal || currentController?.signal
    });
    return response.data.nodes; // The new endpoint returns {nodes, treeEdges, bounds, hasMore, stats}
  } catch (error) {
    if (axios.isCancel(error)) {
      console.log('🚫 Request cancelled:', error.message);
      return [];
    }
    console.error('Error fetching nodes in box:', error);
    return [];
  }
}

export async function fetchEdgesBatch(nodeIds: string[], limit: number = 10000, priority: string = "all"): Promise<Edge[]> {
  if (nodeIds.length === 0) return [];
  
  try {
    const response = await axios.post(`${API_BASE}/edges/batch`, {
      node_ids: nodeIds,
      limit: limit,
      priority: priority
    }, {
      timeout: 10000 // 10 second timeout for edge queries
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching edges batch:', error);
    return [];
  }
}

export async function fetchEdges(nodeIds: string[], limit: number = 10000): Promise<Edge[]> {
  // Use new batch API to avoid HTTP 431 errors
  return fetchEdgesBatch(nodeIds, limit, "all");
}

export async function fetchStats() {
  try {
    const response = await axios.get(`${API_BASE}/stats`);
    return response.data;
  } catch (error) {
    console.error('Error fetching stats:', error);
    return null;
  }
}

export async function fetchBounds(): Promise<DataBounds | null> {
  try {
    const response = await axios.get(`${API_BASE}/bounds`, {
      timeout: 5000 // 5 second timeout for bounds query
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching data bounds:', error);
    
    // Return hardcoded fallback bounds for quantum physics papers
    console.warn('🔧 Using fallback bounds for quantum physics dataset');
    return {
      minX: -7.5,
      maxX: 7.5,
      minY: -7.5,
      maxY: 7.5,
      paddedMinX: -8.0,
      paddedMaxX: 8.0,
      paddedMinY: -8.0,
      paddedMaxY: 8.0,
      total_papers: 72493
    };
  }
}

export async function fetchBoxLight(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  limit: number = 5000,
  signal?: AbortSignal,
  visibleClusters?: number[],
  minDegree?: number
): Promise<LightNode[]> {
  try {
    const params: any = { minX, maxX, minY, maxY, limit };
    if (visibleClusters && visibleClusters.length > 0) {
      params.visible_clusters = visibleClusters.join(',');
    }
    if (minDegree !== undefined && minDegree > 0) {
      params.min_degree = minDegree;
    }
    
    const response = await axios.get(`${API_BASE}/nodes/box/light`, {
      params,
      timeout: 6000, // 6 second timeout for light nodes
      signal: signal || currentController?.signal
    });
    return response.data;
  } catch (error) {
    if (axios.isCancel(error)) {
      console.log('🚫 Light request cancelled:', error.message);
      return [];
    }
    console.error('Error fetching light nodes in box:', error);
    return [];
  }
}

/**
 * Fetch nodes in batches to prevent UI blocking
 */
export async function fetchBoxBatched(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  totalLimit: number = 5000,
  batchSize: number = 100,
  onBatch?: (nodes: Node[], batchIndex: number, totalBatches: number) => void,
  signal?: AbortSignal,
  visibleClusters?: number[],
  minDegree?: number
): Promise<Node[]> {
  const allNodes: Node[] = [];
  let totalBatches = Math.ceil(totalLimit / batchSize);
  let consecutiveEmptyBatches = 0;
  let consecutiveTimeouts = 0;
  let hasSuccessfulBatch = false;
  
  // Import config here (we can't import ConfigLoader at the top level due to circular dependencies)
  const { getConfig } = await import('../utils/config/ConfigLoader');
  const config = getConfig();
  const maxEmptyBatches = config.performance.loading.maxEmptyBatches;
  const maxConcurrentBatches = config.performance.loading.maxConcurrentBatches;
  
  console.log(`[BATCH] 🚀 Starting batched loading: ${totalBatches} batches, concurrent limit: ${maxConcurrentBatches}`);
  
  for (let i = 0; i < totalBatches; i++) {
    if (signal?.aborted) {
      console.log('🚫 Batched request cancelled');
      break;
    }
    
    // Check if we should stop due to consecutive empty batches
    if (consecutiveEmptyBatches >= maxEmptyBatches) {
      console.log(`[BATCH] ⚠️ Stopping after ${consecutiveEmptyBatches} empty batches`);
      break;
    }

    // Check if we should stop due to consecutive timeouts
    if (consecutiveTimeouts >= 3) {
      console.log(`[BATCH] ⚠️ Stopping after ${consecutiveTimeouts} consecutive timeouts`);
      break;
    }

    // Wait if we've hit the concurrent request limit
    while (activeBatchRequests >= maxConcurrentBatches) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    activeBatchRequests++;
    
    try {
      const params: TreeInBoxParams = {
        minX,
        maxX,
        minY,
        maxY,
        maxNodes: batchSize,
        minDegree: minDegree || 0,
        offset: i * batchSize,
        edgeType: "all"
      };
      if (visibleClusters && visibleClusters.length > 0) {
        params.visible_clusters = visibleClusters.join(',');
      }
      
      const response = await axios.post<TreeInBoxResponse>(`${API_BASE}/nodes/tree-in-box`, params, {
        timeout: 5000,
        signal: signal || currentController?.signal
      });

      const batchNodes = response.data.nodes;
      
      if (batchNodes.length === 0) {
        consecutiveEmptyBatches++;
      } else {
        consecutiveEmptyBatches = 0;
        hasSuccessfulBatch = true;
      }

      allNodes.push(...batchNodes);
      
      if (onBatch) {
        onBatch(batchNodes, i, totalBatches);
      }

      // If this batch is smaller than the batch size, we've reached the end
      if (batchNodes.length < batchSize || !response.data.hasMore) {
        console.log(`[BATCH] ✅ Finished early at batch ${i + 1}/${totalBatches}`);
        break;
      }

      consecutiveTimeouts = 0;
    } catch (error: unknown) {
      if (axios.isCancel(error)) {
        console.log('🚫 Batch request cancelled:', error.message);
        break;
      }
      
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        consecutiveTimeouts++;
        console.warn(`[BATCH] ⚠️ Timeout on batch ${i + 1}, consecutive timeouts: ${consecutiveTimeouts}`);
        i--; // Retry this batch
        continue;
      }

      console.error(`[BATCH] ❌ Error on batch ${i + 1}:`, error);
      if (!hasSuccessfulBatch) {
        throw error; // Only throw if we haven't had any successful batches
      }
    } finally {
      activeBatchRequests--;
    }
  }

  return allNodes;
} 