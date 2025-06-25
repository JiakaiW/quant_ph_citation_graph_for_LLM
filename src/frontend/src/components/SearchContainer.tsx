/**
 * 🔍 Search Container Component
 * 
 * Container component that manages the search system and integrates with GraphManager.
 * Handles search initialization, state management, and result selection.
 */

import React, { useEffect, useState, useRef } from 'react';
import { SearchInterface } from './SearchInterface';
import { SearchManager } from '../utils/search/SearchManager';
import { SearchResult } from '../utils/search/SearchTypes';
import { GraphManager } from '../utils/GraphManager';
import { 
  ensureNodeInGraph, 
  ensureNodeInGraphFromSearchResult,
  centerViewportOnNode, 
  checkNodeInGraph,
  convertApiResultToSearchResult
} from '../api/searchApi';
import { useTheme } from '../hooks/useTheme';

interface SearchContainerProps {
  graphManager: GraphManager | null;
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
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize SearchManager when GraphManager is available
  useEffect(() => {
    if (!graphManager) {
      return;
    }

    try {
      console.log('🔍 Initializing SearchManager...');
      
      const sigma = graphManager.getSigma();
      const graph = graphManager.getGraph();
      
      const manager = new SearchManager(
        graphManager,
        sigma,
        graph
      );
      
      setSearchManager(manager);
      setIsInitialized(true);
      setError(null);
      
      console.log('✅ SearchManager initialized successfully');
    } catch (err) {
      console.error('❌ Failed to initialize SearchManager:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize search');
    }
  }, [graphManager]);

  // Handle result selection
  const handleResultSelect = async (result: SearchResult) => {
    if (!searchManager || !graphManager) {
      console.error('❌ SearchContainer: Search system not initialized');
      return;
    }

    try {
      console.log(`🎯 SearchContainer: Selecting search result: ${result.title}`);

      // 1. Close search interface immediately for better UX
      console.log(`🚪 SearchContainer: Closing search interface immediately`);
      onClose();

      // 2. Check if node is already in graph
      const isInGraph = await checkNodeInGraph(result.nodeId, graphManager);
      console.log(`📍 SearchContainer: Node ${result.nodeId} in graph: ${isInGraph}`);
      
      // 3. If not in graph, load it using search result data
      if (!isInGraph && result.coordinates) {
        console.log(`📍 SearchContainer: Loading node ${result.nodeId} into graph...`);
        await ensureNodeInGraphFromSearchResult(result, graphManager);
      }

      // 4. Center viewport on the node
      if (result.coordinates) {
        console.log(`🎯 SearchContainer: Centering viewport on node ${result.nodeId}`);
        await centerViewportOnNode(result.nodeId, result.coordinates, graphManager);
      }

      // 5. Use SearchManager to handle highlighting
      console.log(`✨ SearchContainer: Applying highlighting for node ${result.nodeId}`);
      await searchManager.selectResult(result);

      console.log(`✅ SearchContainer: Successfully selected and highlighted: ${result.nodeId}`);
    } catch (error) {
      console.error('❌ SearchContainer: Failed to select search result:', error);
      setError(error instanceof Error ? error.message : 'Failed to select result');
    }
  };

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isVisible && 
        containerRef.current && 
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isVisible) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isVisible, onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchManager) {
        searchManager.cleanup();
      }
    };
  }, [searchManager]);

  if (!isVisible) {
    console.log('🔍 SearchContainer: Not visible, returning null');
    return null;
  }
  
  console.log('🔍 SearchContainer: Rendering search interface');

  return (
    <div
      className="search-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh'
      }}
    >
      <div
        ref={containerRef}
        className="search-container"
        style={{
          backgroundColor: themePalette.panelBackground,
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          border: `1px solid ${themePalette.borderPrimary}`,
          width: '90%',
          maxWidth: '800px',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: `1px solid ${themePalette.borderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div>
            <h2 style={{ 
              margin: 0, 
              color: themePalette.textPrimary,
              fontSize: '20px',
              fontWeight: '600'
            }}>
              Search Papers
            </h2>
            <p style={{ 
              margin: '4px 0 0', 
              color: themePalette.textSecondary,
              fontSize: '14px'
            }}>
              Search by title, author, or keywords
            </p>
          </div>
          
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: themePalette.textSecondary,
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Close search (Esc)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {error && (
            <div
              style={{
                padding: '16px 24px',
                backgroundColor: themePalette.error + '20',
                color: themePalette.error,
                borderBottom: `1px solid ${themePalette.borderSecondary}`,
                fontSize: '14px'
              }}
            >
              ❌ {error}
            </div>
          )}

          {!isInitialized ? (
            <div
              style={{
                padding: '40px 24px',
                textAlign: 'center',
                color: themePalette.textSecondary
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }}>
                  <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
                </svg>
              </div>
              <div>Initializing search system...</div>
            </div>
          ) : !searchManager ? (
            <div
              style={{
                padding: '40px 24px',
                textAlign: 'center',
                color: themePalette.textSecondary
              }}
            >
              <div>Search system not available</div>
            </div>
          ) : (
            <div style={{ height: '100%', overflow: 'auto' }}>
              <SearchInterface
                searchManager={searchManager}
                onResultSelect={handleResultSelect}
                className="search-interface-container"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: `1px solid ${themePalette.borderSecondary}`,
            backgroundColor: themePalette.panelBackgroundSecondary,
            fontSize: '12px',
            color: themePalette.textMuted,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div>
            Press <kbd style={{ 
              padding: '2px 6px', 
              backgroundColor: themePalette.borderPrimary,
              borderRadius: '3px',
              fontSize: '11px'
            }}>Esc</kbd> to close
          </div>
          <div>
            Click a result to view and highlight in graph
          </div>
        </div>
      </div>
    </div>
  );
}; 