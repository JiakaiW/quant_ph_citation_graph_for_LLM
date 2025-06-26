import { useEffect, useState, useRef, useMemo } from 'react';
import { SigmaContainer, useSigma, ControlsContainer, ZoomControl, FullScreenControl } from "@react-sigma/core";
import "@react-sigma/core/lib/react-sigma.min.css";
import { TreeFirstGraphManager } from '../utils/TreeFirstGraphManager';
import ClusterPanel from './ClusterPanel';
import { SearchContainer } from './SearchContainer';
import { ConsolidatedPanel } from './ConsolidatedPanel';
import { ClusterManager } from '../utils/clustering/ClusterManager';
import { useTheme } from '../hooks/useTheme';
import { ConfigLoader, AppConfig } from '../utils/config/ConfigLoader';
import { Sigma } from 'sigma';

// Self-contained debounce function
function debounce(func: (...args: any[]) => void, delay: number) {
  let timeout: ReturnType<typeof setTimeout>;
  const debounced = function (this: any, ...args: any[]) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
  debounced.cancel = function() { clearTimeout(timeout); };
  return debounced;
}

// Simplified GraphInner component for the new Tree-First architecture
function GraphInner({ onGraphManagerReady }: { onGraphManagerReady: (manager: TreeFirstGraphManager) => void }) {
  const [hasError, setHasError] = useState(false);
  const sigma = useSigma();
  const camera = sigma.getCamera();
  const clusterManager = useMemo(() => ClusterManager.getInstance(), []);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    // Load config first
    const configLoader = ConfigLoader.getInstance();
    configLoader.reloadConfig().then(() => {
      const loadedConfig = configLoader.getConfig();
      setConfig(loadedConfig);

      // Debug: Log initial camera state
      console.log('📸 Initial camera state:', {
        x: camera.x,
        y: camera.y,
        ratio: camera.ratio,
        angle: camera.angle
      });

      // Debug: Log canvas dimensions
      const container = sigma.getContainer();
      console.log('🖼️ Canvas dimensions:', {
        width: container.offsetWidth,
        height: container.offsetHeight,
        pixelRatio: window.devicePixelRatio
      });

      // Handle WebGL context loss
      const handleContextLost = () => {
        console.warn("WebGL context was lost, attempting recovery...");
        setHasError(true);
        
        // Attempt recovery after a short delay
        setTimeout(() => {
          try {
            // Force a renderer recreation
            sigma.refresh();
            setHasError(false);
            console.log("WebGL context restored successfully");
          } catch (e) {
            console.error("Failed to restore WebGL context:", e);
          }
        }, 1000);
      };

      // Add context loss handler to the WebGL canvas
      const canvases = sigma.getCanvases();
      const webGLCanvas = canvases.webgl;
      if (webGLCanvas) {
        webGLCanvas.addEventListener('webglcontextlost', handleContextLost);
        
        // Debug: Log WebGL context info
        const gl = webGLCanvas.getContext('webgl') || webGLCanvas.getContext('experimental-webgl');
        if (gl) {
          const glContext = gl as WebGLRenderingContext;
          console.log('🎮 WebGL Info:', {
            vendor: glContext.getParameter(glContext.VENDOR),
            renderer: glContext.getParameter(glContext.RENDERER),
            version: glContext.getParameter(glContext.VERSION),
            shadingLanguageVersion: glContext.getParameter(glContext.SHADING_LANGUAGE_VERSION)
          });
        }
      }

      // Register node reducer for cluster colors
      sigma.setSetting("nodeReducer", (node, data) => {
        if (!config) return data;
        
        const camera = sigma.getCamera();
        const overlappingNodes = findOverlappingNodes(node, sigma);
        
        // If nodes overlap and jitter is enabled, apply a small offset
        let x = data.x;
        let y = data.y;
        if (config.visual.nodes.overlapBehavior === 'jitter' && overlappingNodes.length > 0) {
          const jitterAmount = (config.visual.nodes.minSpacing / 4) * Math.sin(Date.now() / 500);
          x += jitterAmount * Math.cos(Date.now() / 700);
          y += jitterAmount * Math.sin(Date.now() / 700);
        }

        return {
          ...data,
          x,
          y,
          color: data.color || '#999999', // Use node's color attribute or fallback
          size: config.visual.nodes.defaultSize,
          hidden: data.hidden || false
        };
      });

      // Helper function to find overlapping nodes
      function findOverlappingNodes(node: string, sigma: Sigma): string[] {
        if (!config) return [];
        
        const graph = sigma.getGraph();
        const camera = sigma.getCamera();
        const nodePosition = graph.getNodeAttributes(node);
        const minSpacing = config.visual.nodes.minSpacing / camera.ratio; // Adjust for zoom level
        
        return graph.filterNodes((otherId: string) => {
          if (otherId === node) return false;
          const otherPosition = graph.getNodeAttributes(otherId);
          const dx = nodePosition.x - otherPosition.x;
          const dy = nodePosition.y - otherPosition.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance < minSpacing;
        });
      }

      // Register edge reducer for visual styling
      sigma.setSetting("edgeReducer", (edge, data) => {
        // By default, all edges are hidden
        // They will be shown selectively when a node is clicked
        return {
          ...data,
          hidden: true,
          size: data.isTreeEdge ? 0.67 : 0.33,
          color: data.isTreeEdge ? 'rgba(68, 68, 68, 0.7)' : 'rgba(102, 102, 102, 0.7)'
        };
      });

      // The manager now handles its own event listeners and initial load
      const manager = new TreeFirstGraphManager(sigma, loadedConfig, clusterManager);
      onGraphManagerReady(manager);
      manager.initialize().catch(error => {
        console.error('Failed to initialize graph manager:', error);
        setHasError(true);
      });

      return () => {
        manager.destroy();
        if (webGLCanvas) {
          webGLCanvas.removeEventListener('webglcontextlost', handleContextLost);
        }
      };
    }).catch(error => {
      console.error('Failed to load configuration:', error);
      setHasError(true);
    });
  }, [sigma, onGraphManagerReady, clusterManager, camera]);

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
        zIndex: 1000
      }}>
        <p>Graph visualization encountered an error. Attempting to recover...</p>
      </div>
    );
  }

  return null;
}

// Main GraphContainer component
export default function GraphContainer() {
  const { isDark } = useTheme();
  const theme = isDark ? 'dark' : 'light';
  const [graphManager, setGraphManager] = useState<TreeFirstGraphManager | null>(null);
  const [stats, setStats] = useState<any>({ nodeCount: 0, edgeCount: 0, isLoading: true, connectivity: 'N/A', hasMore: true });
  const [isClusterPanelVisible, setIsClusterPanelVisible] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const clusterManager = useMemo(() => ClusterManager.getInstance(), []);
  const [config, setConfig] = useState<AppConfig | null>(null);

  // Update stats less frequently
  useEffect(() => {
    if (!graphManager) return;
    const interval = setInterval(() => {
      setStats(graphManager.getStats());
    }, 2000); // Reduce update frequency to 2 seconds
    return () => clearInterval(interval);
  }, [graphManager]);

  useEffect(() => {
    // Load config when component mounts
    const configLoader = ConfigLoader.getInstance();
    configLoader.reloadConfig().then(() => {
      setConfig(configLoader.getConfig());
    });
  }, []);

  const sigmaSettings = useMemo(() => {
    if (!config) return null;
    
    return {
      labelFont: "Arial",
      labelSize: 12,
      labelWeight: "normal",
      labelColor: { color: theme === 'dark' ? '#fff' : '#333' },
      defaultNodeType: 'circle',
      defaultEdgeType: 'line',  // Use simple lines instead of arrows
      edgeReduceSize: true,
      hideLabelsOnMove: config.visual.labels.hideOnMove,   // Use config value
      renderLabels: config.visual.labels.enabled,      // Use config value
      labelDensity: config.visual.labels.density,       // Use config value
      labelGridCellSize: config.visual.labels.gridCellSize,  // Use config value
      labelRenderedSizeThreshold: config.visual.labels.sizeThreshold,  // Use config value
      labelRenderThreshold: config.visual.labels.renderThreshold,  // Camera ratio threshold for rendering labels
      minCameraRatio: config.viewport.minCameraRatio,     // Use config value
      maxCameraRatio: config.viewport.maxCameraRatio,     // Use config value
      defaultNodeColor: '#999999',
      nodeReducer: null,
      edgeReducer: null,
      allowInvalidContainer: true,
      enableEdgeClickEvents: false,  // Disable edge click events
      enableEdgeWheelEvents: false,  // Disable edge wheel events
      enableEdgeHoverEvents: false,  // Disable edge hover events
      webglOpts: {
        preserveDrawingBuffer: false,  // Better performance
        antialias: false,             // Disable antialiasing for better performance
        powerPreference: "high-performance",
        desynchronized: true,         // Reduce latency
      }
    };
  }, [theme, config]);

  // Don't render until config is loaded
  if (!config || !sigmaSettings) {
    return <div>Loading configuration...</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SigmaContainer
        settings={sigmaSettings}
        style={{ width: '100%', height: '100%' }}
      >
        <GraphInner onGraphManagerReady={setGraphManager} />
        <ControlsContainer position="bottom-right">
          <ZoomControl />
          <FullScreenControl />
        </ControlsContainer>
      </SigmaContainer>

      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
        <button onClick={() => setIsClusterPanelVisible(!isClusterPanelVisible)}>
          {isClusterPanelVisible ? 'Hide Clusters' : 'Show Clusters'}
        </button>
        <button onClick={() => setIsSearchVisible(!isSearchVisible)}>
          {isSearchVisible ? 'Hide Search' : 'Show Search'}
        </button>
      </div>

      {isClusterPanelVisible && (
        <ClusterPanel
          isVisible={isClusterPanelVisible}
          onClose={() => setIsClusterPanelVisible(false)}
        />
      )}

      {isSearchVisible && (
        <SearchContainer
          isVisible={isSearchVisible}
          onClose={() => setIsSearchVisible(false)}
          graphManager={graphManager}
        />
      )}

      <ConsolidatedPanel
        stats={stats}
        onRefresh={() => {
          if (graphManager) {
            graphManager.refresh();
          }
        }}
        onCameraReset={() => {
          if (graphManager) {
            graphManager.resetCamera();
          }
        }}
        onToggleClusters={() => setIsClusterPanelVisible(!isClusterPanelVisible)}
        onToggleSearch={() => setIsSearchVisible(!isSearchVisible)}
      />
    </div>
  );
} 