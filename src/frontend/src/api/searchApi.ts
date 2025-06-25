/**
 * 🔍 Search API Client
 * 
 * Frontend API client for search functionality.
 * Handles communication with backend search endpoints.
 */

export interface SearchApiResult {
  nodeId: string;
  title: string;
  authors: string[];
  year?: number;
  citationCount: number;
  relevanceScore: number;
  coordinates: {
    x: number;
    y: number;
  };
  degree: number;
  community: number;
  abstract?: string;
}

export interface SearchFilters {
  minCitations?: number;
  yearFrom?: number;
  yearTo?: number;
  includeAbstract?: boolean;
}

export interface SearchOptions extends SearchFilters {
  limit?: number;
  offset?: number;
}

/**
 * Search papers using the backend search API
 */
export async function searchPapers(
  query: string, 
  options: SearchOptions = {}
): Promise<SearchApiResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const {
    limit = 100,
    offset = 0,
    minCitations = 0,
    yearFrom,
    yearTo,
    includeAbstract = false
  } = options;

  const params = new URLSearchParams({
    q: query.trim(),
    limit: limit.toString(),
    offset: offset.toString(),
    include_abstract: includeAbstract.toString(),
    min_citations: minCitations.toString()
  });

  if (yearFrom !== undefined) {
    params.append('year_from', yearFrom.toString());
  }
  if (yearTo !== undefined) {
    params.append('year_to', yearTo.toString());
  }

  const url = `/api/search?${params.toString()}`;
  
  try {
    console.log(`🔍 Searching: "${query}" with options:`, options);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 400) {
        const error = await response.json();
        throw new Error(error.detail || 'Invalid search query');
      }
      throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }

    const results: SearchApiResult[] = await response.json();
    console.log(`✅ Search completed: ${results.length} results for "${query}"`);
    
    return results;
  } catch (error) {
    console.error('🔍 Search API error:', error);
    throw error;
  }
}

/**
 * Get search suggestions for autocomplete
 */
export async function getSearchSuggestions(
  partialQuery: string,
  limit: number = 10
): Promise<string[]> {
  if (!partialQuery || partialQuery.trim().length < 2) {
    return [];
  }

  const params = new URLSearchParams({
    q: partialQuery.trim(),
    limit: limit.toString()
  });

  const url = `/api/search/suggestions?${params.toString()}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Suggestions request failed: ${response.status}`);
      return [];
    }

    const suggestions: string[] = await response.json();
    return suggestions;
  } catch (error) {
    console.warn('💡 Suggestions API error:', error);
    return [];
  }
}

/**
 * Get detailed information about a specific node/paper
 */
export async function getNodeDetails(nodeId: string): Promise<SearchApiResult> {
  const url = `/api/search/node/${encodeURIComponent(nodeId)}`;
  
  try {
    console.log(`📄 Getting details for node: ${nodeId}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Paper ${nodeId} not found`);
      }
      throw new Error(`Failed to get paper details: ${response.status} ${response.statusText}`);
    }

    const details: SearchApiResult = await response.json();
    console.log(`✅ Retrieved details for: ${details.title}`);
    
    return details;
  } catch (error) {
    console.error('📄 Node details API error:', error);
    throw error;
  }
}

/**
 * Check if a node exists in the current graph
 */
export async function checkNodeInGraph(nodeId: string, graphManager: any): Promise<boolean> {
  try {
    const graph = graphManager.getGraph();
    const hasNode = graph.hasNode(nodeId);
    console.log(`📍 searchApi: Node ${nodeId} in graph: ${hasNode}`);
    return hasNode;
  } catch (error) {
    console.warn('❌ searchApi: Failed to check if node is in graph:', error);
    return false;
  }
}

/**
 * Load a node into the graph using search result data
 */
export async function ensureNodeInGraphFromSearchResult(
  searchResult: any, // Accept both SearchResult and SearchApiResult
  graphManager: any
): Promise<boolean> {
  try {
    const graph = graphManager.getGraph();
    
    // Check if node is already in graph
    if (graph.hasNode(searchResult.nodeId)) {
      console.log(`📍 searchApi: Node ${searchResult.nodeId} already in graph`);
      return true;
    }

    console.log(`📍 searchApi: Loading search result node ${searchResult.nodeId} into graph...`);

    // Add node to graph with proper scaling using search result data
    const coordinateScale = graphManager.config.viewport.coordinateScale || 5.0;
    const scaledX = searchResult.coordinates.x * coordinateScale;
    const scaledY = searchResult.coordinates.y * coordinateScale;
    
    graph.addNode(searchResult.nodeId, {
      x: scaledX,
      y: scaledY,
      size: graphManager.config.visual.nodes.defaultSize || 0.8,
      label: searchResult.title,
      degree: searchResult.degree || searchResult.citationCount || 1,
      color: getNodeColorByCommunity(searchResult.community || 0),
      community: searchResult.community || 0,
    });

    console.log(`✅ searchApi: Added search result node ${searchResult.nodeId} to graph at (${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`);
    return true;
  } catch (error) {
    console.error(`❌ searchApi: Failed to load search result node ${searchResult.nodeId}:`, error);
    return false;
  }
}

/**
 * Load a node into the graph if it's not already present
 */
export async function ensureNodeInGraph(
  nodeId: string, 
  coordinates: { x: number; y: number },
  graphManager: any
): Promise<boolean> {
  try {
    const graph = graphManager.getGraph();
    
    // Check if node is already in graph
    if (graph.hasNode(nodeId)) {
      console.log(`📍 searchApi: Node ${nodeId} already in graph`);
      return true;
    }

    console.log(`📍 searchApi: Loading node ${nodeId} into graph...`);

    // Add node to graph with proper scaling using the coordinates from search result
    const coordinateScale = graphManager.config.viewport.coordinateScale || 5.0;
    const scaledX = coordinates.x * coordinateScale;
    const scaledY = coordinates.y * coordinateScale;
    
    // Try to get node details from API, but use fallback if it fails
    let nodeDetails;
    try {
      nodeDetails = await getNodeDetails(nodeId);
    } catch (error) {
      console.warn(`📍 searchApi: Failed to get node details for ${nodeId}, using fallback data:`, error);
      // Use fallback data - we can create a basic node with the search result info
      nodeDetails = {
        nodeId: nodeId,
        title: `Paper ${nodeId.substring(0, 8)}...`,
        degree: 1,
        community: 0,
        coordinates: coordinates,
        authors: [],
        citationCount: 0,
        relevanceScore: 0
      };
    }
    
    graph.addNode(nodeId, {
      x: scaledX,
      y: scaledY,
      size: graphManager.config.visual.nodes.defaultSize || 0.8,
      label: nodeDetails.title,
      degree: nodeDetails.degree || 1,
      color: getNodeColorByCommunity(nodeDetails.community || 0),
      community: nodeDetails.community || 0,
    });

    console.log(`✅ searchApi: Added node ${nodeId} to graph at (${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`);
    return true;
  } catch (error) {
    console.error(`❌ searchApi: Failed to load node ${nodeId}:`, error);
    return false;
  }
}

/**
 * Center the viewport on a specific node
 */
export async function centerViewportOnNode(
  nodeId: string,
  coordinates: { x: number; y: number },
  graphManager: any
): Promise<void> {
  try {
    const sigma = graphManager.getSigma();
    const coordinateScale = graphManager.config.viewport.coordinateScale || 5.0;
    
    // Calculate scaled coordinates
    const scaledX = coordinates.x * coordinateScale;
    const scaledY = coordinates.y * coordinateScale;
    
    console.log(`🎯 searchApi: Centering viewport on node ${nodeId} at (${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`);
    
    // Center the camera on the node
    sigma.getCamera().animate(
      { x: scaledX, y: scaledY, ratio: 0.5 }, // Zoom in to ratio 0.5
      { duration: 1000 } // 1 second animation
    );

    console.log(`✅ searchApi: Viewport centered on node ${nodeId}`);
  } catch (error) {
    console.error(`❌ searchApi: Failed to center viewport on node ${nodeId}:`, error);
    throw error;
  }
}

/**
 * Get node color based on community (cluster)
 */
function getNodeColorByCommunity(community: number): string {
  // Simple color mapping - you can enhance this based on your color scheme
  const colors = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5'
  ];
  
  return colors[community % colors.length] || '#888888';
}

/**
 * Convert SearchApiResult to SearchResult format for compatibility
 */
export function convertApiResultToSearchResult(apiResult: SearchApiResult): any {
  return {
    nodeId: apiResult.nodeId,
    title: apiResult.title,
    authors: apiResult.authors,
    year: apiResult.year,
    citationCount: apiResult.citationCount,
    relevanceScore: apiResult.relevanceScore,
    abstract: apiResult.abstract,
    coordinates: apiResult.coordinates,
    degree: apiResult.degree,
    community: apiResult.community,
    isInCurrentGraph: false, // Will be updated by the search manager
    venue: undefined // Not available from API
  };
}

/**
 * Batch search with pagination support
 */
export async function batchSearch(
  query: string,
  totalResults: number = 200,
  batchSize: number = 100,
  options: SearchFilters = {}
): Promise<SearchApiResult[]> {
  const allResults: SearchApiResult[] = [];
  let offset = 0;
  
  while (allResults.length < totalResults) {
    const remainingResults = totalResults - allResults.length;
    const currentBatchSize = Math.min(batchSize, remainingResults);
    
    try {
      const batchResults = await searchPapers(query, {
        ...options,
        limit: currentBatchSize,
        offset: offset
      });
      
      if (batchResults.length === 0) {
        // No more results available
        break;
      }
      
      allResults.push(...batchResults);
      offset += batchResults.length;
      
      // If we got fewer results than requested, we've reached the end
      if (batchResults.length < currentBatchSize) {
        break;
      }
    } catch (error) {
      console.error(`❌ Batch search failed at offset ${offset}:`, error);
      break;
    }
  }
  
  console.log(`📊 Batch search completed: ${allResults.length} total results for "${query}"`);
  return allResults;
} 