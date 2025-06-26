/**
 * 🌐 Simple Graph Component
 * 
 * Simplified graph component that uses the new UnifiedGraphManager
 * with proper error handling and service initialization.
 */

import { useEffect, useState, useMemo } from 'react';
import { SigmaContainer, useSigma, ControlsContainer, ZoomControl, FullScreenControl } from "@react-sigma/core";
import "@react-sigma/core/lib/react-sigma.min.css";
import { UnifiedGraphManager } from '../utils/core/UnifiedGraphManager';
import { ServiceFactory } from '../utils/factories/ServiceFactory';
import { ConfigLoader, AppConfig } from '../utils/config/ConfigLoader';
import { useTheme } from '../hooks/useTheme';

interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  isLoading: boolean;
  hasMore: boolean;
}

interface GraphInnerProps {
  onGraphManagerInit: (manager: UnifiedGraphManager) => void;
}

// Graph Inner Component
function GraphInner({ onGraphManagerInit }: GraphInnerProps) {
  const [hasError, setHasError] = useState(false);
  const [stats, setStats] = useState<GraphStats>({ 
    nodeCount: 0, 
    edgeCount: 0, 
    isLoading: true, 
    hasMore: true 
  });
  const sigma = useSigma();
  const [graphManager, setGraphManager] = useState<UnifiedGraphManager | null>(null);

  useEffect(() => {
    let manager: UnifiedGraphManager | null = null;

    const initializeGraph = async () => {
      try {
        // Load configuration
        const configLoader = ConfigLoader.getInstance();
        await configLoader.reloadConfig();
        const config = configLoader.getConfig();

        // Setup service factory and container
        const serviceFactory = new ServiceFactory();
        const serviceContainer = serviceFactory.registerServices(sigma, config);
        await serviceFactory.initializeServices();

        // Create unified graph manager
        manager = new UnifiedGraphManager(sigma, config, serviceContainer, {
          loadingStrategy: 'enhanced',
          renderingStrategy: 'standard',
          maxNodes: config.memory.maxTotalNodes,
          maxEdges: config.memory.maxTotalEdges,
          viewportUpdateThreshold: 0.1,
          debugMode: config.debug.enablePerformanceLogging,
          debug: config.debug.enablePerformanceLogging,
          name: 'MainGraphManager'
        });

        // Set up event listeners
        manager.on('loading-started', () => {
          setStats(prev => ({ ...prev, isLoading: true }));
        });

        manager.on('loading-completed', (data) => {
          setStats({
            nodeCount: data.result.stats?.loadedNodes || 0,
            edgeCount: data.result.stats?.loadedEdges || 0,
            isLoading: false,
            hasMore: data.result.hasMore
          });
        });

        manager.on('loading-failed', (error) => {
          console.error('Graph loading failed:', error);
          setHasError(true);
          setStats(prev => ({ ...prev, isLoading: false }));
        });

        manager.on('error', (error) => {
          console.error('Graph manager error:', error);
          setHasError(true);
        });

        // Initialize the manager
        await manager.initialize();
        setGraphManager(manager);
        onGraphManagerInit(manager);
        
        console.log('🌐 GraphSimple: Successfully initialized UnifiedGraphManager');

      } catch (error) {
        console.error('Failed to initialize graph:', error);
        setHasError(true);
        setStats(prev => ({ ...prev, isLoading: false }));
      }
    };

    initializeGraph();

    // Cleanup function
    return () => {
      if (manager) {
        try {
          manager.destroy();
        } catch (error) {
          console.error('Error destroying graph manager:', error);
        }
      }
    };
  }, [sigma, onGraphManagerInit]);

  if (hasError) {
    return (
      <div style={{ 
        position: 'absolute', 
        top: '50%', 
        left: '50%', 
        transform: 'translate(-50%, -50%)',
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        zIndex: 1000,
        textAlign: 'center'
      }}>
        <h3>Graph Error</h3>
        <p>Failed to initialize the graph visualization.</p>
        <button onClick={() => window.location.reload()}>
          Reload Page
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Stats overlay */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '12px',
        zIndex: 1000
      }}>
        <div>Nodes: {stats.nodeCount}</div>
        <div>Edges: {stats.edgeCount}</div>
        <div>Status: {stats.isLoading ? 'Loading...' : 'Ready'}</div>
        {stats.hasMore && <div>Has More: Yes</div>}
      </div>

      {/* Loading indicator */}
      {stats.isLoading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(255, 255, 255, 0.9)',
          padding: '16px',
          borderRadius: '8px',
          zIndex: 1000
        }}>
          Loading graph data...
        </div>
      )}
    </>
  );
}

interface GraphSimpleProps {
  onSearchOpen: () => void;
  onGraphManagerInit: (manager: UnifiedGraphManager) => void;
}

// Main Graph Container Component
export default function GraphSimple({ onSearchOpen, onGraphManagerInit }: GraphSimpleProps) {
  const { isDark } = useTheme();

  const settings = useMemo(() => ({
    renderLabels: true,
    renderEdgeLabels: false,
    hideEdgesOnMove: true,
    hideLabelsOnMove: false,
    enableEdgeClickEvents: true,
    enableEdgeWheelEvents: false,
    enableEdgeHoverEvents: false,
    allowInvalidContainer: true,
    minCameraRatio: 0.1,
    maxCameraRatio: 10,
    stagePadding: 50,
    labelFont: "Arial",
    labelSize: 12,
    labelSizeRatio: 2,
    labelColor: { color: isDark ? '#ffffff' : '#000000' },
    zoomToSizeRatioFunction: (x: number) => x,
    itemSizesReference: "screen" as const,
    labelGridCellSize: 60,
    labelRenderedSizeThreshold: 9,
    animationsTime: 600,
  }), [isDark]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SigmaContainer settings={settings}>
        <GraphInner onGraphManagerInit={onGraphManagerInit} />
        <ControlsContainer position="bottom-right" style={{ marginBottom: '1rem' }}>
          <ZoomControl />
          <FullScreenControl />
          <button
            onClick={onSearchOpen}
            style={{
              background: 'white',
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '8px'
            }}
            title="Search papers (Ctrl+K)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
          </button>
        </ControlsContainer>
      </SigmaContainer>
    </div>
  );
} 