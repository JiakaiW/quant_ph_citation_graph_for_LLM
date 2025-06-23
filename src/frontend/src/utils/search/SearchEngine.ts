import { 
  SearchResult, 
  SearchQuery, 
  SearchConfig, 
  SearchApiResponse,
  SearchMetrics,
  DEFAULT_SEARCH_CONFIG,
  SearchSortBy,
  SearchSortOrder
} from './SearchTypes';

/**
 * 🔍 Search Engine
 * 
 * Core search functionality that handles:
 * - API communication with backend search service
 * - Query processing and validation
 * - Result ranking and filtering
 * - Search analytics and metrics
 */
export class SearchEngine {
  private config: SearchConfig;
  private metrics: SearchMetrics;
  private searchCache: Map<string, { results: SearchResult[]; timestamp: number }>;
  private abortController: AbortController | null = null;

  constructor(config: SearchConfig = DEFAULT_SEARCH_CONFIG) {
    this.config = config;
    this.metrics = {
      totalSearches: 0,
      averageQueryTime: 0,
      popularQueries: new Map(),
      clickThroughRate: 0,
      averageResultsPerQuery: 0
    };
    this.searchCache = new Map();
  }

  /**
   * 🔍 Main search method with debouncing and caching
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    // Validate query
    if (!this.isValidQuery(query)) {
      throw new Error(`Query too short: minimum ${this.config.minQueryLength} characters`);
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(query);
    const cached = this.getCachedResults(cacheKey);
    if (cached) {
      console.log(`🔍 Cache hit for query: "${query.query}"`);
      return cached;
    }

    // Cancel previous search if still running
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const startTime = performance.now();
    
    try {
      console.log(`🔍 Searching for: "${query.query}"`);
      
      // Execute search
      const results = await this.executeSearch(query, this.abortController.signal);
      
      // Update metrics
      const duration = performance.now() - startTime;
      this.updateMetrics(query.query, results.length, duration);
      
      // Cache results
      this.cacheResults(cacheKey, results);
      
      console.log(`🔍 Search completed: ${results.length} results in ${duration.toFixed(0)}ms`);
      return results;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`🔍 Search cancelled: "${query.query}"`);
        return [];
      }
      
      console.error(`🔍 Search failed for "${query.query}":`, error);
      throw error;
    }
  }

  /**
   * 🌐 Execute search API call
   */
  private async executeSearch(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const searchParams = {
      q: query.query,
      limit: query.limit || this.config.maxResults,
      include_abstract: query.includeAbstract || false,
      fuzzy: this.config.enableFuzzySearch,
      ...query.filters
    };

    const response = await fetch('/api/search/papers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchParams),
      signal
    });

    if (!response.ok) {
      throw new Error(`Search API error: ${response.status} ${response.statusText}`);
    }

    const apiResponse: SearchApiResponse = await response.json();
    
    // Convert API response to SearchResult format
    return apiResponse.results.map(result => ({
      nodeId: result.node_id,
      title: result.title,
      authors: result.authors,
      year: result.year,
      venue: result.venue,
      abstract: result.abstract,
      citationCount: result.citation_count,
      relevanceScore: result.relevance_score,
      isInCurrentGraph: false, // Will be updated by GraphSearchCoordinator
      coordinates: result.coordinates
    }));
  }

  /**
   * 🔄 Sort search results by specified criteria
   */
  sortResults(results: SearchResult[], sortBy: SearchSortBy, order: SearchSortOrder = SearchSortOrder.DESC): SearchResult[] {
    const sorted = [...results].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case SearchSortBy.RELEVANCE:
          comparison = a.relevanceScore - b.relevanceScore;
          break;
        case SearchSortBy.YEAR:
          comparison = (a.year || 0) - (b.year || 0);
          break;
        case SearchSortBy.CITATIONS:
          comparison = (a.citationCount || 0) - (b.citationCount || 0);
          break;
        case SearchSortBy.TITLE:
          comparison = a.title.localeCompare(b.title);
          break;
        case SearchSortBy.AUTHORS:
          const aAuthors = a.authors?.join(', ') || '';
          const bAuthors = b.authors?.join(', ') || '';
          comparison = aAuthors.localeCompare(bAuthors);
          break;
      }
      
      return order === SearchSortOrder.ASC ? comparison : -comparison;
    });

    return sorted;
  }

  /**
   * 🎯 Filter results based on criteria
   */
  filterResults(results: SearchResult[], filters: {
    minYear?: number;
    maxYear?: number;
    minCitations?: number;
    venues?: string[];
    authors?: string[];
    inCurrentGraphOnly?: boolean;
  }): SearchResult[] {
    return results.filter(result => {
      // Year filter
      if (filters.minYear && (result.year || 0) < filters.minYear) return false;
      if (filters.maxYear && (result.year || 0) > filters.maxYear) return false;
      
      // Citation filter
      if (filters.minCitations && (result.citationCount || 0) < filters.minCitations) return false;
      
      // Venue filter
      if (filters.venues && filters.venues.length > 0) {
        if (!result.venue || !filters.venues.includes(result.venue)) return false;
      }
      
      // Author filter
      if (filters.authors && filters.authors.length > 0) {
        if (!result.authors || !result.authors.some(author => 
          filters.authors!.some(filterAuthor => 
            author.toLowerCase().includes(filterAuthor.toLowerCase())
          )
        )) return false;
      }
      
      // Current graph filter
      if (filters.inCurrentGraphOnly && !result.isInCurrentGraph) return false;
      
      return true;
    });
  }

  /**
   * 🔍 Get search suggestions based on query
   */
  async getSuggestions(partialQuery: string): Promise<string[]> {
    if (partialQuery.length < 2) return [];

    try {
      const response = await fetch('/api/search/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: partialQuery, limit: 10 })
      });

      if (response.ok) {
        const data = await response.json();
        return data.suggestions || [];
      }
    } catch (error) {
      console.warn('🔍 Failed to fetch suggestions:', error);
    }

    return [];
  }

  /**
   * 📊 Get popular search terms
   */
  getPopularQueries(limit: number = 10): Array<{ query: string; count: number }> {
    return Array.from(this.metrics.popularQueries.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  }

  /**
   * 🧹 Clear search cache
   */
  clearCache(): void {
    this.searchCache.clear();
    console.log('🔍 Search cache cleared');
  }

  /**
   * 📈 Get search metrics
   */
  getMetrics(): SearchMetrics {
    return { ...this.metrics };
  }

  /**
   * ⚙️ Update search configuration
   */
  updateConfig(newConfig: Partial<SearchConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('🔍 Search config updated:', newConfig);
  }

  // Private helper methods

  private isValidQuery(query: SearchQuery): boolean {
    return query.query.trim().length >= this.config.minQueryLength;
  }

  private generateCacheKey(query: SearchQuery): string {
    return JSON.stringify({
      q: query.query.toLowerCase().trim(),
      filters: query.filters,
      limit: query.limit,
      includeAbstract: query.includeAbstract
    });
  }

  private getCachedResults(cacheKey: string): SearchResult[] | null {
    const cached = this.searchCache.get(cacheKey);
    if (!cached) return null;

    // Check if cache is expired (5 minutes)
    const isExpired = Date.now() - cached.timestamp > 5 * 60 * 1000;
    if (isExpired) {
      this.searchCache.delete(cacheKey);
      return null;
    }

    return cached.results;
  }

  private cacheResults(cacheKey: string, results: SearchResult[]): void {
    // Limit cache size to prevent memory issues
    if (this.searchCache.size >= 50) {
      const oldestKey = this.searchCache.keys().next().value;
      this.searchCache.delete(oldestKey);
    }

    this.searchCache.set(cacheKey, {
      results,
      timestamp: Date.now()
    });
  }

  private updateMetrics(query: string, resultCount: number, duration: number): void {
    this.metrics.totalSearches++;
    
    // Update average query time
    const totalTime = this.metrics.averageQueryTime * (this.metrics.totalSearches - 1) + duration;
    this.metrics.averageQueryTime = totalTime / this.metrics.totalSearches;
    
    // Track popular queries
    const count = this.metrics.popularQueries.get(query) || 0;
    this.metrics.popularQueries.set(query, count + 1);
    
    // Update average results per query
    const totalResults = this.metrics.averageResultsPerQuery * (this.metrics.totalSearches - 1) + resultCount;
    this.metrics.averageResultsPerQuery = totalResults / this.metrics.totalSearches;
  }

  /**
   * 📊 Record when user clicks on a search result (for CTR calculation)
   */
  recordResultClick(query: string): void {
    // This would be called by the UI when user selects a result
    // Implementation depends on how you want to track CTR
    console.log(`🔍 Result clicked for query: "${query}"`);
  }

  /**
   * 🔄 Cancel current search
   */
  cancelSearch(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
} 