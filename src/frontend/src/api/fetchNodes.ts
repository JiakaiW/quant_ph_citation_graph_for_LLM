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

export interface Node {
  key: string;
  attributes: NodeAttributes;
}

export interface Edge {
  source: string;
  target: string;
  attributes?: any;
}

const API_BASE = '/api';

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
  ratio: number = 1.0,
  limit: number = 5000
): Promise<Node[]> {
  try {
    const response = await axios.get(`${API_BASE}/nodes/box`, {
      params: { minX, maxX, minY, maxY, ratio, limit }
    });
    return response.data;
  } catch (error) {
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