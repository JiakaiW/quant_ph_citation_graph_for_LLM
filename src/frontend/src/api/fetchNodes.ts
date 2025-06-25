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
    const params: any = { minX, maxX, minY, maxY, limit };
    if (visibleClusters && visibleClusters.length > 0) {
      params.visible_clusters = visibleClusters.join(',');
    }
    if (minDegree !== undefined && minDegree > 0) {
      params.min_degree = minDegree;
    }
    
    const response = await axios.get(`${API_BASE}/nodes/box`, {
      params,
      timeout: 5000, // 5 second timeout (reduced from 8s)
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
    
    // Wait for available concurrency slot
    while (activeBatchRequests >= maxConcurrentBatches) {
      console.log(`[BATCH] ⏳ Waiting for concurrency slot (${activeBatchRequests}/${maxConcurrentBatches} active)`);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check for cancellation while waiting
      if (signal?.aborted) {
        console.log('🚫 Batched request cancelled while waiting for slot');
        return allNodes;
      }
    }
    
    const offset = i * batchSize;
    const currentBatchSize = Math.min(batchSize, totalLimit - offset);
    let retryCount = 0;
    // More intelligent retry logic: retry more for early batches, less for later ones
    const maxRetries = hasSuccessfulBatch ? 
      (i < 7 ? 1 : 0) :  // If we've had success, be less aggressive with retries
      (i < 5 ? 2 : 1);   // If no success yet, be more aggressive
    
    while (retryCount <= maxRetries) {
      activeBatchRequests++; // Claim concurrency slot
      
      try {
        if (retryCount > 0) {
          console.log(`[BATCH] 🔄 Attempting batch ${i + 1}/${totalBatches} (retry ${retryCount}/${maxRetries})`);
        }
        // Use a smaller timeout for individual batches
        const params: any = { 
          minX, maxX, minY, maxY, 
          limit: currentBatchSize,
          offset: offset 
        };
        if (visibleClusters && visibleClusters.length > 0) {
          params.visible_clusters = visibleClusters.join(',');
        }
        if (minDegree !== undefined && minDegree > 0) {
          params.min_degree = minDegree;
        }
        
        const response = await axios.get(`${API_BASE}/nodes/box`, {
          params,
          timeout: retryCount > 0 ? 8000 : 5000, // Longer timeout for retries
          signal: signal || currentController?.signal
        });
        
        const batchNodes = response.data;
        allNodes.push(...batchNodes);
        
        // Reset timeout counters on successful batch
        consecutiveTimeouts = 0;
        hasSuccessfulBatch = true;
        
        // Early termination logic
        if (batchNodes.length === 0) {
          consecutiveEmptyBatches++;
          console.log(`[BATCH] Empty batch ${i + 1}/${totalBatches} (${consecutiveEmptyBatches}/${maxEmptyBatches} consecutive)`);
          
          if (config.performance.loading.earlyTermination && consecutiveEmptyBatches >= maxEmptyBatches) {
            console.log(`[BATCH] 🏁 Early termination: ${maxEmptyBatches} consecutive empty batches`);
            // Recalculate total batches for accurate progress reporting
            totalBatches = i + 1;
            activeBatchRequests--; // Release concurrency slot
            break;
          }
        } else {
          consecutiveEmptyBatches = 0; // Reset counter on successful batch
          
          // Smart termination: if this batch returned fewer nodes than requested,
          // it's likely the last meaningful batch
          if (config.performance.loading.smartTermination && batchNodes.length < currentBatchSize && i > 0) {
            console.log(`[BATCH] 🏁 Smart termination: batch ${i + 1} returned ${batchNodes.length}/${currentBatchSize} nodes`);
            totalBatches = i + 1;
            
            // Call progress callback with final batch
            if (onBatch) {
              onBatch(batchNodes, i + 1, totalBatches);
            }
            activeBatchRequests--; // Release concurrency slot
            break;
          }
        }
        
        // Call progress callback
        if (onBatch) {
          onBatch(batchNodes, i + 1, totalBatches);
        }
        
        // Success - break out of retry loop
        activeBatchRequests--; // Release concurrency slot
        break;
        
      } catch (error) {
        activeBatchRequests--; // Release concurrency slot on error
        
        if (axios.isCancel(error)) {
          console.log(`🚫 Batch ${i + 1}/${totalBatches} cancelled`);
          return allNodes; // Return what we have so far
        }
        
        const isTimeout = error instanceof Error && error.message?.includes('timeout');
        
        if (isTimeout && retryCount < maxRetries) {
          retryCount++;
          console.log(`[BATCH] ⏰ Timeout on batch ${i + 1}/${totalBatches}, retrying (${retryCount}/${maxRetries})`);
          // Short delay before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          continue; // Retry this batch
        }
        
        // Final error handling after retries exhausted
        console.error(`Error fetching batch ${i + 1}/${totalBatches}:`, error);
        
        if (isTimeout) {
          consecutiveTimeouts++;
          console.log(`[BATCH] Timeout after retries (${consecutiveTimeouts} consecutive)`);
          
          // Different timeout handling based on context
          if (config.performance.loading.earlyTermination) {
            // If we haven't had any successful batches and we're getting early timeouts,
            // it's likely a backend issue - be more aggressive about terminating
            if (!hasSuccessfulBatch && consecutiveTimeouts >= 2) {
              console.log(`[BATCH] 🏁 Early termination: backend appears down (${consecutiveTimeouts} consecutive timeouts, no successful batches)`);
              totalBatches = i + 1;
              break;
            }
            
            // If we've had successful batches but now getting timeouts,
            // treat as potential end of data but be less aggressive
            if (hasSuccessfulBatch && consecutiveTimeouts >= maxEmptyBatches + 1) {
              console.log(`[BATCH] 🏁 Early termination: ${consecutiveTimeouts} consecutive timeouts after successful batches`);
              totalBatches = i + 1;
              break;
            }
          }
        } else {
          // Non-timeout errors - continue but don't count as empty batches
          console.log(`[BATCH] Non-timeout error, continuing to next batch`);
        }
        
        // Break out of retry loop for this batch
        break;
      }
    }
    
    // Short delay to prevent UI blocking and reduce backend load
    if (i < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 50)); // Increased delay
    }
  }
  
  console.log(`[BATCH] ✅ Completed: ${allNodes.length} total nodes in ${totalBatches} batches (${hasSuccessfulBatch ? 'with' : 'without'} successful batches)`);
  return allNodes;
} 