import { useState, useEffect } from 'react';
import GraphSimple from './components/GraphSimple';
import DebugPanel from './components/DebugPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { SearchContainer } from './components/SearchContainer';
import { UnifiedGraphManager } from './utils/core/UnifiedGraphManager';
import { useTheme } from './hooks/useTheme';
import './App.css';

function App() {
  const [debugVisible, setDebugVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [graphManager, setGraphManager] = useState<UnifiedGraphManager | null>(null);
  const { themePalette } = useTheme();

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ctrl/Cmd + K to open search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      setSearchVisible(true);
    }
  };

  // Add keyboard shortcut listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <ErrorBoundary>
      <div className="App">
        <main style={{ backgroundColor: themePalette.canvasBackground, height: '100vh' }}>
          <ErrorBoundary>
            <GraphSimple 
              onSearchOpen={() => setSearchVisible(true)}
              onGraphManagerInit={setGraphManager}
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <DebugPanel 
              isVisible={debugVisible} 
              onToggle={() => setDebugVisible(!debugVisible)} 
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <SearchContainer
              graphManager={graphManager}
              isVisible={searchVisible}
              onClose={() => setSearchVisible(false)}
            />
          </ErrorBoundary>
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App; 