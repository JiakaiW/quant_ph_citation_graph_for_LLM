import React, { useState } from 'react';
import GraphContainer from './components/Graph';
import DebugPanel from './components/DebugPanel';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {
  const [debugVisible, setDebugVisible] = useState(false);

  return (
    <ErrorBoundary>
      <div className="App">
        <header className="App-header">
          <h1>Citation Network Visualization</h1>
          <div style={{ fontSize: '14px', marginTop: '8px', opacity: 0.8 }}>
            Interactive exploration of 72,493 quantum physics papers
          </div>
        </header>
        <main>
          <ErrorBoundary>
            <GraphContainer />
          </ErrorBoundary>
          <ErrorBoundary>
            <DebugPanel 
              isVisible={debugVisible} 
              onToggle={() => setDebugVisible(!debugVisible)} 
            />
          </ErrorBoundary>
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App; 