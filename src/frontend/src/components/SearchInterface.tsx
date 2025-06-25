import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SearchResult, SearchState } from '../utils/search/SearchTypes';
import { SearchManager } from '../utils/search/SearchManager';
import './SearchInterface.css';

interface SearchInterfaceProps {
  searchManager: SearchManager;
  onResultSelect?: (result: SearchResult) => void;
  className?: string;
}

/**
 * 🔍 Search Interface Component
 * 
 * Main search UI component that provides:
 * - Search input with real-time suggestions
 * - Search results display with metadata
 * - Result selection and highlighting
 * - Loading states and error handling
 */
export const SearchInterface: React.FC<SearchInterfaceProps> = ({
  searchManager,
  onResultSelect,
  className = ''
}) => {
  const [searchState, setSearchState] = useState<SearchState>(searchManager.getState());
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Subscribe to search manager events
  useEffect(() => {
    const handleSearchStarted = () => {
      setSearchState(searchManager.getState());
    };

    const handleSearchCompleted = () => {
      setSearchState(searchManager.getState());
    };

    const handleSearchError = () => {
      setSearchState(searchManager.getState());
    };

    const handleSearchCleared = () => {
      setSearchState(searchManager.getState());
      setSuggestions([]);
      setShowSuggestions(false);
    };

    searchManager.on('search:started', handleSearchStarted);
    searchManager.on('search:completed', handleSearchCompleted);
    searchManager.on('search:error', handleSearchError);
    searchManager.on('search:cleared', handleSearchCleared);

    return () => {
      searchManager.off('search:started', handleSearchStarted);
      searchManager.off('search:completed', handleSearchCompleted);
      searchManager.off('search:error', handleSearchError);
      searchManager.off('search:cleared', handleSearchCleared);
    };
  }, [searchManager]);

  // Handle search input changes
  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    
    // Update search
    await searchManager.search(query);
    
    // Get suggestions
    if (query.length >= 2) {
      const newSuggestions = await searchManager.getSuggestions(query);
      setSuggestions(newSuggestions);
      setShowSuggestions(newSuggestions.length > 0);
      setSelectedSuggestionIndex(-1);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchManager]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedSuggestionIndex >= 0) {
          const selectedSuggestion = suggestions[selectedSuggestionIndex];
          if (inputRef.current) {
            inputRef.current.value = selectedSuggestion;
          }
          searchManager.search(selectedSuggestion);
          setShowSuggestions(false);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  }, [showSuggestions, suggestions, selectedSuggestionIndex, searchManager]);

  // Handle result selection
  const handleResultClick = useCallback(async (result: SearchResult) => {
    try {
      console.log('🎯 SearchInterface: Handling result click for:', result.title);
      await searchManager.selectResult(result);
      console.log('✅ SearchInterface: SearchManager.selectResult completed');
      onResultSelect?.(result);
      console.log('✅ SearchInterface: onResultSelect callback called');
    } catch (error) {
      console.error('❌ SearchInterface: Failed to select result:', error);
    }
  }, [searchManager, onResultSelect]);

  // Handle clear search
  const handleClearSearch = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    searchManager.clearSearch();
    setSuggestions([]);
    setShowSuggestions(false);
  }, [searchManager]);

  // Handle suggestion click
  const handleSuggestionClick = useCallback((suggestion: string) => {
    if (inputRef.current) {
      inputRef.current.value = suggestion;
    }
    searchManager.search(suggestion);
    setShowSuggestions(false);
  }, [searchManager]);

  // Format result metadata
  const formatResultMetadata = (result: SearchResult): string => {
    const parts = [];
    if (result.authors && result.authors.length > 0) {
      parts.push(result.authors.slice(0, 2).join(', '));
      if (result.authors.length > 2) parts[parts.length - 1] += ' et al.';
    }
    if (result.year) parts.push(result.year.toString());
    if (result.venue) parts.push(result.venue);
    if (result.citationCount) parts.push(`${result.citationCount} citations`);
    return parts.join(' • ');
  };

  return (
    <div className={`search-interface ${className}`}>
      {/* Search Input */}
      <div className="search-input-container">
        <div className="search-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search academic papers..."
            className="search-input"
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          />
          
          {/* Search Icon */}
          <div className="search-icon">
            {searchState.isSearching ? (
              <div className="search-spinner" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            )}
          </div>

          {/* Clear Button */}
          {searchState.query && (
            <button
              className="search-clear-button"
              onClick={handleClearSearch}
              title="Clear search"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div ref={suggestionsRef} className="search-suggestions">
            {suggestions.map((suggestion, index) => (
              <div
                key={index}
                className={`search-suggestion ${index === selectedSuggestionIndex ? 'selected' : ''}`}
                onClick={() => handleSuggestionClick(suggestion)}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error Display */}
      {searchState.error && (
        <div className="search-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          {searchState.error}
        </div>
      )}

      {/* Results Display */}
      {searchState.results.length > 0 && (
        <div className="search-results">
          <div className="search-results-header">
            <span className="search-results-count">
              {searchState.results.length} results
            </span>
            {searchState.query && (
              <span className="search-results-query">
                for "{searchState.query}"
              </span>
            )}
          </div>

          <div className="search-results-list">
            {searchState.results.map((result, index) => (
              <div
                key={result.nodeId}
                className={`search-result-item ${
                  result.nodeId === searchState.selectedResult?.nodeId ? 'selected' : ''
                } ${result.isInCurrentGraph ? 'in-graph' : 'not-in-graph'}`}
                onClick={() => handleResultClick(result)}
              >
                <div className="search-result-header">
                  <div className="search-result-title">
                    {result.title}
                  </div>
                  <div className="search-result-relevance">
                    {Math.round(result.relevanceScore * 100)}%
                  </div>
                </div>

                <div className="search-result-metadata">
                  {formatResultMetadata(result)}
                </div>

                {result.abstract && (
                  <div className="search-result-abstract">
                    {result.abstract.length > 200 
                      ? result.abstract.substring(0, 200) + '...' 
                      : result.abstract
                    }
                  </div>
                )}

                <div className="search-result-footer">
                  <div className="search-result-status">
                    {result.isInCurrentGraph ? (
                      <span className="status-in-graph">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                        In graph
                      </span>
                    ) : (
                      <span className="status-not-in-graph">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                        Will load
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Results */}
      {searchState.query && searchState.results.length === 0 && !searchState.isSearching && !searchState.error && (
        <div className="search-no-results">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <h3>No results found</h3>
          <p>Try different keywords or check your spelling</p>
        </div>
      )}
    </div>
  );
}; 