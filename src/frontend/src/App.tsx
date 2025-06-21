import React, { useState } from 'react';
import GraphContainer from './components/Graph';
import ViewportGraphContainer from './components/GraphViewportSimple';
import DebugPanel from './components/DebugPanel';
import DataDebug from './components/DataDebug';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {
  const [debugVisible, setDebugVisible] = useState(false);
  const [dataDebugVisible, setDataDebugVisible] = useState(false); // Hide by default since we fixed the issues
  const [useViewportMode, setUseViewportMode] = useState(true); // Enable Phase 2 by default

  return (
    <ErrorBoundary>
      <div className="App">
        <header className="App-header">
          <h1>Citation Network Visualization</h1>
          <div style={{ fontSize: '14px', marginTop: '8px' }}>
            <button 
              onClick={() => setUseViewportMode(!useViewportMode)}
              style={{
                background: useViewportMode ? '#4CAF50' : '#757575',
                color: 'white',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500'
              }}
            >
              {useViewportMode ? '⚡ Phase 2: FIXED' : '📊 Phase 1: Original'}
            </button>
            <span style={{ marginLeft: '8px', opacity: 0.8, fontSize: '11px' }}>
              {useViewportMode ? 'True R-tree streaming + zoom sizing' : 'Basic batch loading'}
            </span>
          </div>
        </header>
        <main>
          <ErrorBoundary>
            {useViewportMode ? <ViewportGraphContainer /> : <GraphContainer />}
          </ErrorBoundary>
          <ErrorBoundary>
            <DebugPanel 
              isVisible={debugVisible} 
              onToggle={() => setDebugVisible(!debugVisible)} 
            />
          </ErrorBoundary>
          <DataDebug visible={dataDebugVisible} />
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App; 