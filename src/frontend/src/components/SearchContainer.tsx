/**
 * 🔍 Search Container Component
 * 
 * Container component that manages the search system and integrates with GraphManager.
 * Handles search initialization, state management, and result selection.
 */

import React, { useEffect, useState } from 'react';
import { SearchInterface } from './SearchInterface';
import { SearchManager } from '../utils/search/SearchManager';
import { SearchResult } from '../utils/search/SearchTypes';
import { UnifiedGraphManager, NodeService, EdgeService } from '../utils/core/UnifiedGraphManager';
import { useTheme } from '../hooks/useTheme';
import './SearchContainer.css';
import { RequestManager } from '../utils/api/RequestManager';
import { GraphSearchCoordinator } from '../utils/search/GraphSearchCoordinator';

interface SearchContainerProps {
  graphManager: UnifiedGraphManager | null;
  isVisible: boolean;
  onClose: () => void;
}

export const SearchContainer: React.FC<SearchContainerProps> = ({
  graphManager,
  isVisible,
  onClose
}) => {
  const [searchManager, setSearchManager] = useState<SearchManager | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { themePalette } = useTheme();

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape' && isVisible) {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  // Initialize search manager when graph manager is available
  useEffect(() => {
    if (!graphManager || isInitialized) return;

    try {
      const sigma = graphManager.getSigma();
      const graph = graphManager.getGraph();

      const manager = new SearchManager(
        graphManager,
        sigma,
        graph,
        {
          debounceMs: 300,
          minQueryLength: 2,
          maxResults: 20,
          enableFuzzySearch: true,
          highlightSnippets: true
        },
        {
          focusNodeColor: themePalette.success,
          focusNodeSize: 5,
          neighborNodeColor: themePalette.info,
          neighborNodeSize: 1.5,
          focusEdgeColor: themePalette.success,
          focusEdgeSize: 2,
          fadeOtherNodes: true,
          fadeIntensity: 0.1,
          animationDuration: 300
        }
      );

      setSearchManager(manager);
      setIsInitialized(true);
      setError(null);
    } catch (err) {
      console.error('Failed to initialize search manager:', err);
      setError('Failed to initialize search. Please try again.');
    }
  }, [graphManager, isInitialized, themePalette]);

  // Handle result selection
  const handleResultSelect = async (result: SearchResult) => {
    if (!graphManager) return;

    try {
      // 0. Cancel any pending viewport loads
      RequestManager.getInstance().cancelAllRequests();

      // 1. Create a search coordinator
      const searchCoordinator = new GraphSearchCoordinator(
        graphManager,
        graphManager.getSigma(),
        graphManager.getGraph()
      );

      // 2. Handle the search result selection
      await searchCoordinator.handleSearchResultSelection(result);

      // 3. Close the search panel
      onClose();

    } catch (err) {
      console.error('Failed to select search result:', err);
      setError('Failed to select result. Please try again.');
    }
  };

  if (!isVisible) return null;

  return (
    <div className="search-container">
      {error && (
        <div className="search-error">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      
      {searchManager && (
        <SearchInterface
          searchManager={searchManager}
          onResultSelect={handleResultSelect}
          className="search-interface"
        />
      )}
      
      <button className="search-close-button" onClick={onClose}>
        Close
      </button>

      {/* Keyboard shortcut hint */}
      <div className="search-keyboard-hint">
        Press <kbd>Esc</kbd> to close
      </div>
    </div>
  );
}; 