import { 
  SearchResult, 
  SearchQuery, 
  SearchState, 
  SearchConfig, 
  HighlightConfig,
  SearchEvents,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_HIGHLIGHT_CONFIG
} from './SearchTypes';
import { SearchEngine } from './SearchEngine';
import { NodeHighlighter } from './NodeHighlighter';
import { GraphSearchCoordinator } from './GraphSearchCoordinator';

/**
 * 🎯 Search Manager
 * 
 * Main orchestrator for the search system. Provides a unified interface
 * for all search functionality and coordinates between different modules.
 * 
 * Responsibilities:
 * - Coordinate search engine, highlighter, and graph integration
 * - Manage search state and events
 * - Provide debounced search with caching
 * - Handle search result selection and highlighting
 * - Manage search UI state
 */
export class SearchManager {
  private searchEngine: SearchEngine;
  private nodeHighlighter: NodeHighlighter;
  private graphCoordinator: GraphSearchCoordinator;
  
  private state: SearchState;
  private eventListeners: Map<keyof SearchEvents, Function[]> = new Map();
  private debounceTimer: number | null = null;
  private config: SearchConfig;

  constructor(
    graphManager: any,
    sigma: any,
    graph: any,
    searchConfig: SearchConfig = DEFAULT_SEARCH_CONFIG,
    highlightConfig: HighlightConfig = DEFAULT_HIGHLIGHT_CONFIG
  ) {
    // Initialize modules
    this.searchEngine = new SearchEngine(searchConfig);
    this.nodeHighlighter = new NodeHighlighter(graph, sigma, highlightConfig);
    this.graphCoordinator = new GraphSearchCoordinator(graphManager, sigma, graph);
    
    this.config = searchConfig;
    
    // Initialize state
    this.state = {
      isSearching: false,
      query: '',
      results: [],
      selectedResult: null,
      highlightedNodes: new Set(),
      highlightedEdges: new Set(),
      error: null
    };

    console.log('🎯 SearchManager initialized');
  }

  /**
   * 🔍 Main search method with debouncing
   */
  async search(query: string, filters?: any): Promise<SearchResult[]> {
    // Clear previous debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Return early if query is too short
    if (query.trim().length < this.config.minQueryLength) {
      this.updateState({ query, results: [], error: null });
      return [];
    }

    // Debounce the search
    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          await this.executeSearch(query, filters);
          resolve(this.state.results);
        } catch (error) {
          console.error('🎯 Search failed:', error);
          resolve([]);
        }
      }, this.config.debounceMs);
    });
  }

  /**
   * 🔍 Execute search without debouncing (for immediate searches)
   */
  async searchImmediate(query: string, filters?: any): Promise<SearchResult[]> {
    return this.executeSearch(query, filters);
  }

  /**
   * 🎯 Select a search result
   */
  async selectResult(result: SearchResult): Promise<void> {
    console.log(`🎯 Selecting search result: ${result.title}`);

    try {
      this.updateState({ selectedResult: result });
      this.emit('search:selected', { result });

      // 1. Handle graph integration (load node, center viewport)
      await this.graphCoordinator.handleSearchResultSelection(result);

      // 2. Highlight the node and its neighbors
      await this.nodeHighlighter.highlightNode(result.nodeId, 1, true);

      // 3. Update state with highlight information
      const highlightState = this.nodeHighlighter.getHighlightState();
      this.updateState({
        highlightedNodes: new Set(highlightState.highlightedNodes),
        highlightedEdges: new Set(highlightState.highlightedEdges)
      });

      this.emit('highlight:applied', { 
        nodeIds: highlightState.highlightedNodes, 
        edgeIds: highlightState.highlightedEdges 
      });

      // 4. Record analytics
      this.searchEngine.recordResultClick(this.state.query || '');

      console.log(`🎯 Successfully selected result: ${result.nodeId}`);

    } catch (error) {
      console.error('🎯 Error selecting search result:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState({ error: `Failed to select result: ${errorMessage}` });
      throw error;
    }
  }

  /**
   * 🧹 Clear search and highlighting
   */
  async clearSearch(): Promise<void> {
    console.log('🎯 Clearing search');

    // Clear highlighting
    await this.nodeHighlighter.clearHighlight(true);

    // Reset state
    this.updateState({
      query: '',
      results: [],
      selectedResult: null,
      highlightedNodes: new Set(),
      highlightedEdges: new Set(),
      error: null,
      isSearching: false
    });

    this.emit('search:cleared', {});
    this.emit('highlight:cleared', {});
  }

  /**
   * 🔍 Get search suggestions
   */
  async getSuggestions(partialQuery: string): Promise<string[]> {
    return this.searchEngine.getSuggestions(partialQuery);
  }

  /**
   * 📊 Get search statistics
   */
  getSearchStats(): any {
    const engineMetrics = this.searchEngine.getMetrics();
    const graphStats = this.graphCoordinator.getPerformanceMetrics();
    const highlightState = this.nodeHighlighter.getHighlightState();

    return {
      search: engineMetrics,
      graph: graphStats,
      highlight: highlightState,
      currentState: this.state
    };
  }

  /**
   * 🎨 Update highlight configuration
   */
  updateHighlightConfig(config: Partial<HighlightConfig>): void {
    this.nodeHighlighter.updateConfig(config);
  }

  /**
   * ⚙️ Update search configuration
   */
  updateSearchConfig(config: Partial<SearchConfig>): void {
    this.config = { ...this.config, ...config };
    this.searchEngine.updateConfig(config);
  }

  /**
   * 🔄 Refresh search results (after graph changes)
   */
  async refreshResults(): Promise<void> {
    if (this.state.results.length === 0) return;

    console.log('🎯 Refreshing search results');
    
    const updatedResults = await this.graphCoordinator.refreshSearchResults(this.state.results);
    this.updateState({ results: updatedResults });
  }

  /**
   * 🎯 Batch load search results
   */
  async preloadResults(maxToLoad: number = 5): Promise<void> {
    if (this.state.results.length === 0) return;

    console.log(`🎯 Preloading ${maxToLoad} search results`);
    
    const loadedNodes = await this.graphCoordinator.batchLoadSearchResults(
      this.state.results, 
      maxToLoad
    );

    // Refresh results to update their graph state
    await this.refreshResults();

    console.log(`🎯 Preloaded ${loadedNodes.length} nodes`);
  }

  /**
   * 📡 Event system methods
   */
  on<K extends keyof SearchEvents>(event: K, callback: (data: SearchEvents[K]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off<K extends keyof SearchEvents>(event: K, callback: (data: SearchEvents[K]) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 📊 Get current search state
   */
  getState(): SearchState {
    return { ...this.state };
  }

  /**
   * 🧹 Cleanup resources
   */
  cleanup(): void {
    console.log('🎯 Cleaning up SearchManager');
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.nodeHighlighter.cleanup();
    this.graphCoordinator.cleanup();
    this.eventListeners.clear();
  }

  // Private methods

  /**
   * 🔍 Execute the actual search
   */
  private async executeSearch(query: string, filters?: any): Promise<SearchResult[]> {
    console.log(`🎯 Executing search: "${query}"`);

    this.updateState({ isSearching: true, query, error: null });
    this.emit('search:started', { query });

    const startTime = performance.now();

    try {
      // Build search query
      const searchQuery: SearchQuery = {
        query: query.trim(),
        filters,
        limit: this.config.maxResults
      };

      // Execute search
      const results = await this.searchEngine.search(searchQuery);

      // Update results with current graph state
      const updatedResults = this.graphCoordinator.updateSearchResultsWithGraphState(results);

      // Update state
      this.updateState({ 
        results: updatedResults, 
        isSearching: false,
        error: null 
      });

      const duration = performance.now() - startTime;
      this.emit('search:completed', { query, results: updatedResults, duration });

      console.log(`🎯 Search completed: ${updatedResults.length} results in ${duration.toFixed(0)}ms`);
      return updatedResults;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`🎯 Search failed: ${errorMessage}`);
      
      this.updateState({ 
        isSearching: false, 
        error: errorMessage,
        results: []
      });

      this.emit('search:error', { query, error: errorMessage });
      throw error;
    }
  }

  /**
   * 🔄 Update internal state
   */
  private updateState(updates: Partial<SearchState>): void {
    this.state = { ...this.state, ...updates };
  }

  /**
   * 📡 Emit events to listeners
   */
  private emit<K extends keyof SearchEvents>(event: K, data: SearchEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`🎯 Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 🎯 Advanced search with multiple criteria
   */
  async advancedSearch(options: {
    query: string;
    authors?: string[];
    venues?: string[];
    yearRange?: { min: number; max: number };
    citationRange?: { min: number; max: number };
    inCurrentViewOnly?: boolean;
  }): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query: options.query,
      filters: {
        authors: options.authors,
        venues: options.venues,
        minYear: options.yearRange?.min,
        maxYear: options.yearRange?.max,
        minCitations: options.citationRange?.min
      }
    };

    const results = await this.executeSearch(options.query, searchQuery.filters);

    // Apply additional filtering
    let filteredResults = results;
    
    if (options.inCurrentViewOnly) {
      filteredResults = this.searchEngine.filterResults(results, { 
        inCurrentGraphOnly: true 
      });
    }

    return filteredResults;
  }
} 