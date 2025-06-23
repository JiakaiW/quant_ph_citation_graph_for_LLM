/**
 * 🔍 Search System Type Definitions
 * 
 * Defines interfaces and types for the modular search functionality
 * that integrates with GraphManager and handles academic paper search.
 */

// Core search result interface
export interface SearchResult {
  nodeId: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  citationCount?: number;
  relevanceScore: number; // 0-1, how well it matches search query
  isInCurrentGraph: boolean; // Whether node is currently loaded in graph
  coordinates?: { x: number; y: number }; // If loaded, its position
}

// Search query configuration
export interface SearchQuery {
  query: string;
  filters?: {
    minYear?: number;
    maxYear?: number;
    minCitations?: number;
    venues?: string[];
    authors?: string[];
  };
  limit?: number;
  includeAbstract?: boolean; // Search in abstract text too
}

// Search engine configuration
export interface SearchConfig {
  debounceMs: number; // Delay before triggering search
  minQueryLength: number; // Minimum characters to search
  maxResults: number; // Maximum results to return
  enableFuzzySearch: boolean; // Allow typos/approximate matches
  highlightSnippets: boolean; // Return highlighted text snippets
}

// Highlighting configuration
export interface HighlightConfig {
  focusNodeColor: string;
  focusNodeSize: number;
  neighborNodeColor: string;
  neighborNodeSize: number;
  focusEdgeColor: string;
  focusEdgeSize: number;
  fadeOtherNodes: boolean;
  fadeOpacity: number;
  animationDuration: number; // ms
}

// Search state management
export interface SearchState {
  isSearching: boolean;
  query: string;
  results: SearchResult[];
  selectedResult: SearchResult | null;
  highlightedNodes: Set<string>;
  highlightedEdges: Set<string>;
  error: string | null;
}

// Events emitted by search system
export interface SearchEvents {
  'search:started': { query: string };
  'search:completed': { query: string; results: SearchResult[]; duration: number };
  'search:error': { query: string; error: string };
  'search:selected': { result: SearchResult };
  'search:cleared': {};
  'highlight:applied': { nodeIds: string[]; edgeIds: string[] };
  'highlight:cleared': {};
}

// Integration with GraphManager
export interface GraphSearchIntegration {
  ensureNodeLoaded(nodeId: string): Promise<boolean>;
  ensureNeighborsLoaded(nodeId: string, depth?: number): Promise<string[]>;
  getNodeNeighbors(nodeId: string): string[];
  isNodeInGraph(nodeId: string): boolean;
  getNodePosition(nodeId: string): { x: number; y: number } | null;
  centerViewportOnNode(nodeId: string): Promise<void>;
}

// Search result actions
export interface SearchResultActions {
  onSelect: (result: SearchResult) => Promise<void>;
  onHover: (result: SearchResult) => void;
  onUnhover: () => void;
  onLoadMore: () => Promise<void>;
}

// Search API response format
export interface SearchApiResponse {
  results: Array<{
    node_id: string;
    title: string;
    authors: string[];
    year: number;
    venue: string;
    abstract: string;
    citation_count: number;
    relevance_score: number;
    coordinates?: { x: number; y: number };
  }>;
  total_count: number;
  query_time_ms: number;
  suggestions?: string[]; // Alternative search terms
}

// Search analytics/metrics
export interface SearchMetrics {
  totalSearches: number;
  averageQueryTime: number;
  popularQueries: Map<string, number>;
  clickThroughRate: number; // % of searches that result in selection
  averageResultsPerQuery: number;
}

// Default configurations
export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  debounceMs: 300,
  minQueryLength: 2,
  maxResults: 20,
  enableFuzzySearch: true,
  highlightSnippets: true
};

export const DEFAULT_HIGHLIGHT_CONFIG: HighlightConfig = {
  focusNodeColor: '#ff6b6b', // Bright red for selected paper
  focusNodeSize: 15,
  neighborNodeColor: '#4ecdc4', // Teal for neighbors
  neighborNodeSize: 10,
  focusEdgeColor: '#ff8e53', // Orange for connecting edges
  focusEdgeSize: 3,
  fadeOtherNodes: true,
  fadeOpacity: 0.2,
  animationDuration: 500
};

// Search result sorting options
export enum SearchSortBy {
  RELEVANCE = 'relevance',
  YEAR = 'year',
  CITATIONS = 'citations',
  TITLE = 'title',
  AUTHORS = 'authors'
}

export enum SearchSortOrder {
  ASC = 'asc',
  DESC = 'desc'
}

// Search filter types
export interface SearchFilters {
  years: { min?: number; max?: number };
  citations: { min?: number; max?: number };
  venues: string[];
  authors: string[];
  inCurrentView: boolean; // Only show papers currently visible
}

// Advanced search options
export interface AdvancedSearchOptions {
  searchFields: ('title' | 'abstract' | 'authors' | 'venue')[];
  fuzzyThreshold: number; // 0-1, how fuzzy to allow matches
  boostFactors: {
    titleMatch: number;
    authorMatch: number;
    venueMatch: number;
    citationCount: number;
    recency: number;
  };
} 