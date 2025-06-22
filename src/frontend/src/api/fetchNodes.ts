import axios from 'axios';

export interface NodeAttributes {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  community: number;
  degree: number;
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

export function cancelAllRequests() {
  if (currentController) {
    console.log('🚫 Cancelling previous API requests');
    currentController.abort();
  }
  currentController = new AbortController();
  return currentController.signal;
}

export async function fetchTop(limit: number = 2000): Promise<Node[]> {
  try {
    const response = await axios.get(`${API_BASE}/nodes/top`, {
      params: { limit }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching top nodes:', error);
    return [];
  }
}

export async function fetchBox(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  ratio: number = 1.0, // DEPRECATED: kept for backward compatibility
  limit: number = 5000,
  signal?: AbortSignal
): Promise<Node[]> {
  try {
    const response = await axios.get(`${API_BASE}/nodes/box`, {
      params: { minX, maxX, minY, maxY, limit },
      timeout: 10000, // 10 second timeout
      signal: signal || currentController?.signal
    });
    return response.data;
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
      timeout: 5000 // 5 second timeout
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
  signal?: AbortSignal
): Promise<LightNode[]> {
  try {
    const response = await axios.get(`${API_BASE}/nodes/box/light`, {
      params: { minX, maxX, minY, maxY, limit },
      timeout: 10000, // 10 second timeout
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
  signal?: AbortSignal
): Promise<Node[]> {
  const allNodes: Node[] = [];
  const totalBatches = Math.ceil(totalLimit / batchSize);
  
  for (let i = 0; i < totalBatches; i++) {
    if (signal?.aborted) {
      console.log('🚫 Batched request cancelled');
      break;
    }
    
    const offset = i * batchSize;
    const currentBatchSize = Math.min(batchSize, totalLimit - offset);
    
    try {
      // Use a smaller timeout for individual batches
      const response = await axios.get(`${API_BASE}/nodes/box`, {
        params: { 
          minX, maxX, minY, maxY, 
          limit: currentBatchSize,
          offset: offset 
        },
        timeout: 5000, // Shorter timeout for batches
        signal: signal || currentController?.signal
      });
      
      const batchNodes = response.data;
      allNodes.push(...batchNodes);
      
      // Call progress callback
      if (onBatch) {
        onBatch(batchNodes, i + 1, totalBatches);
      }
      
      // Short delay to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 10));
      
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log(`🚫 Batch ${i + 1}/${totalBatches} cancelled`);
        break;
      }
      console.error(`Error fetching batch ${i + 1}/${totalBatches}:`, error);
      // Continue with next batch on error
    }
  }
  
  return allNodes;
} 