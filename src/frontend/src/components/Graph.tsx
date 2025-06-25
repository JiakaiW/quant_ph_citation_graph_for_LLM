import { useEffect, useState, useRef, useMemo } from 'react';
import { SigmaContainer, useSigma, ControlsContainer, ZoomControl, FullScreenControl } from "@react-sigma/core";
import "@react-sigma/core/lib/react-sigma.min.css";
import { GraphManager } from '../utils/GraphManager';
import { ClusterPanel } from './ClusterPanel';
import { SearchContainer } from './SearchContainer';
import { ClusterManager } from '../utils/clustering/ClusterManager';
import { useTheme } from '../hooks/useTheme';

// Self-contained debounce function to avoid external dependencies
function debounce(func: (...args: any[]) => void, delay: number) {
  let timeout: ReturnType<typeof setTimeout>;
  
  const debounced = function (this: any, ...args: any[]) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
  
  debounced.cancel = function() {
    clearTimeout(timeout);
  };

  return debounced;
}

function GraphInner() {
  const sigma = useSigma();
  const [stats, setStats] = useState({
    nodeCount: 0,
    edgeCount: 0,
    cacheRegions: 0,
    isLoading: false,
    batchProgress: null as {current: number, total: number} | null
  });
  const [lodInfo, setLodInfo] = useState<{level: number, cameraRatio: number, maxNodes: number, minDegree: number} | null>(null);
  const [loadingStage, setLoadingStage] = useState('');

  const [hoveredNode, setHoveredNode] = useState<{id: string, label: string, x: number, y: number, degree: number, community: number, color: string} | null>(null);
  const [selectedNode, setSelectedNode] = useState<{id: string, label: string, neighborCount: number} | null>(null);
  const [viewportBounds, setViewportBounds] = useState<{minX: number, maxX: number, minY: number, maxY: number} | null>(null);
  const [isClusterPanelVisible, setIsClusterPanelVisible] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  
  const graphManagerRef = useRef<GraphManager | null>(null);
  const clusterManager = useMemo(() => ClusterManager.getInstance(), []);

  useEffect(() => {
    if (!sigma) return;

    const manager = new GraphManager(sigma);
    graphManagerRef.current = manager;

    const debouncedUpdate = debounce(() => manager.updateViewport(), 300); // Reduced frequency to prevent overload

    const camera = sigma.getCamera();
    camera.on('updated', debouncedUpdate);
    
    // Set up drag state management to prevent viewport updates during dragging
    let isDragging = false;
    let dragStartTime = 0;
    
    // Listen for mouse events to track dragging state
    const container = sigma.getContainer();
    
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left mouse button
        isDragging = true;
        dragStartTime = Date.now();
        manager.isDragging = true;
        console.log('🖱️ Drag started');
      }
    };
    
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0 && isDragging) { // Left mouse button
        isDragging = false;
        manager.isDragging = false;
        const dragDuration = Date.now() - dragStartTime;
        console.log(`🖱️ Drag ended (${dragDuration}ms)`);
        
        // Trigger viewport update after drag ends (with small delay)
        setTimeout(() => {
          if (!manager.isDragging) { // Double check we're not dragging again
            manager.updateViewport();
          }
        }, 100);
      }
    };
    
    const handleMouseLeave = () => {
      if (isDragging) {
        isDragging = false;
        manager.isDragging = false;
        console.log('🖱️ Drag ended (mouse left container)');
        
        // Trigger viewport update after drag ends
        setTimeout(() => {
          if (!manager.isDragging) {
            manager.updateViewport();
          }
        }, 100);
      }
    };
    
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseLeave);
        
        // Set up hover events for nodes
    sigma.on('enterNode', (event) => {
      const nodeId = event.node;
      const nodeAttrs = sigma.getGraph().getNodeAttributes(nodeId);
      setHoveredNode({
        id: nodeId,
        label: nodeAttrs.label || nodeId,
        x: nodeAttrs.x,
        y: nodeAttrs.y,
        degree: nodeAttrs.degree || 0,
        community: nodeAttrs.community || 0,
        color: nodeAttrs.color || '#888888'
      });
    });
          
    sigma.on('leaveNode', () => {
      setHoveredNode(null);
    });

    // Set up click highlighting event listeners
    const handleNodeSelected = (event: any) => {
      const { nodeId, neighbors } = event.detail;
      const nodeAttrs = sigma.getGraph().getNodeAttributes(nodeId);
      setSelectedNode({
        id: nodeId,
        label: nodeAttrs.label || nodeId,
        neighborCount: neighbors.length
      });
    };

    const handleHighlightCleared = () => {
      setSelectedNode(null);
    };

    document.addEventListener('nodeClickHighlight:nodeSelected', handleNodeSelected);
    document.addEventListener('nodeClickHighlight:highlightCleared', handleHighlightCleared);
          
    // Set up periodic stats and viewport updates
    const updateStats = () => {
      const currentStats = manager.getStats();
      setStats(currentStats);
      
      // Get current viewport bounds and LOD info
      if (manager) {
        const bounds = manager.getViewportBounds();
        setViewportBounds({
          minX: bounds.minX,
          maxX: bounds.maxX,
          minY: bounds.minY,
          maxY: bounds.maxY
        });
        
        // Calculate LOD info for display (simplified 3-level system)
        const camera = sigma.getCamera();
        const lodLevel = camera.ratio < 0.5 ? 0 : camera.ratio < 3.0 ? 1 : 2;
        const maxNodesByLOD = { 0: 1000, 1: 2500, 2: 1500 };
        const minDegreeByLOD = { 0: 1, 1: 2, 2: 10 };
        
        setLodInfo({
          level: lodLevel,
          cameraRatio: camera.ratio,
          maxNodes: maxNodesByLOD[lodLevel as keyof typeof maxNodesByLOD],
          minDegree: minDegreeByLOD[lodLevel as keyof typeof minDegreeByLOD]
        });
      }
      
      if (currentStats.isLoading) {
        setLoadingStage('Loading nodes from spatial query...');
      } else {
        setLoadingStage('');
              }
    };

    updateStats();
    const statsInterval = setInterval(updateStats, 1000);

    manager.initialize().then(() => {
      setLoadingStage('✅ Graph initialized');
          setTimeout(() => setLoadingStage(''), 2000);
    }).catch(error => {
      console.error('Graph initialization failed:', error);
      setLoadingStage('❌ Initialization failed - trying fallback...');
      
      // Try fallback initialization after a delay
      setTimeout(() => {
        console.log('🔄 Attempting fallback initialization...');
        try {
          manager.initializeWithFallback();
          setLoadingStage('🔧 Using fallback initialization');
          setTimeout(() => setLoadingStage(''), 3000);
        } catch (fallbackError) {
          console.error('❌ Fallback initialization also failed:', fallbackError);
          setLoadingStage('❌ Complete initialization failure');
        }
      }, 2000);
    });

    return () => {
      camera.off('updated', debouncedUpdate);
      debouncedUpdate.cancel();
      clearInterval(statsInterval);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('nodeClickHighlight:nodeSelected', handleNodeSelected);
      document.removeEventListener('nodeClickHighlight:highlightCleared', handleHighlightCleared);
      if (graphManagerRef.current) {
        graphManagerRef.current.destroy();
      }
    };
  }, [sigma]);

  const handleRefresh = () => {
    if (graphManagerRef.current) {
      graphManagerRef.current.refresh();
      setLoadingStage('🔄 Refreshing viewport...');
    }
  };

  const handleResetLoading = () => {
    if (graphManagerRef.current) {
      graphManagerRef.current.resetLoadingState();
      setLoadingStage('');
    }
  };

  const handleFullRestart = () => {
    setLoadingStage('🔄 Restarting system...');
    // Force a complete re-render by unmounting and remounting the component
    window.location.reload();
  };

  const handleCameraReset = () => {
    if (graphManagerRef.current && sigma) {
      const camera = sigma.getCamera();
      console.log('🎥 MANUAL CAMERA RESET: Resetting to default position');
      camera.setState({ x: 0, y: 0, ratio: 1.0 });
      setLoadingStage('🎥 Camera reset to center');
      
      // Force a viewport update to reload nodes at the new position
      setTimeout(() => {
        if (graphManagerRef.current) {
          graphManagerRef.current.updateViewport();
        }
      }, 100);
    }
  };

  return (
    <>
      {/* Status Panel */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: stats.isLoading ? 'rgba(33, 150, 243, 0.9)' : 'rgba(0,0,0,0.85)',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 1000,
        minWidth: '280px',
      }}>
        {stats.isLoading ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid rgba(255,255,255,0.3)',
                borderTop: '2px solid white',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginRight: '8px'
              }} />
              <span>{loadingStage}</span>
            </div>
            {stats.batchProgress && (
              <div style={{ marginTop: '4px', fontSize: '11px' }}>
                <div style={{ marginBottom: '2px' }}>
                  📦 Batch {stats.batchProgress.current}/{stats.batchProgress.total}
            </div>
            <div style={{ 
              width: '100%', 
                  height: '4px',
                  backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                    width: `${(stats.batchProgress.current / stats.batchProgress.total) * 100}%`,
                height: '100%',
                    backgroundColor: '#4CAF50',
                    transition: 'width 0.3s ease'
              }} />
            </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '4px' }}>
              📊 <strong>Nodes:</strong> <span style={{color: '#4CAF50'}}>{stats.nodeCount}</span> | 
              🔗 <strong>Edges:</strong> <span style={{color: '#66BB6A'}}>{stats.edgeCount}</span>
            </div>
            <div style={{ fontSize: '11px', opacity: 0.7 }}>
              🎯 Cache regions: {stats.cacheRegions} | 
              🧠 Object-oriented graph management
              {loadingStage && <span style={{color: '#FFD54F'}}> | {loadingStage}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Control Panel */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 1000,
      }}>
        <button
          onClick={handleRefresh}
          style={{
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '500',
            width: '100%',
            marginBottom: '4px'
          }}
        >
          🔄 Refresh Viewport
        </button>
        
        {stats.isLoading && (
          <button
            onClick={handleResetLoading}
            style={{
              background: '#FF5722',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: '500',
              width: '100%',
              marginBottom: '4px'
            }}
          >
            🔧 Reset Loading
          </button>
        )}
        
        {(loadingStage.includes('failed') || loadingStage.includes('WebGL')) && (
          <button
            onClick={handleFullRestart}
            style={{
              background: '#9C27B0',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: '500',
              width: '100%',
              marginBottom: '4px'
            }}
          >
            🔄 Full Restart
          </button>
        )}
        
        {/* Camera Reset Button - always visible for stuck viewport recovery */}
        <button
          onClick={handleCameraReset}
          style={{
            background: '#FF9800',
            color: 'white',
            border: 'none',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: '500',
            width: '100%',
            marginBottom: '4px'
          }}
        >
          🎥 Reset Camera
        </button>
        
        <button
          onClick={() => setIsClusterPanelVisible(!isClusterPanelVisible)}
          style={{
            background: isClusterPanelVisible ? '#4CAF50' : '#666',
            color: 'white',
            border: 'none',
            padding: '6px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '500',
            width: '100%',
            marginBottom: '4px',
            transition: 'all 0.2s ease'
          }}
        >
          🎨 {isClusterPanelVisible ? 'Hide' : 'Show'} Clusters
        </button>

        <button
          onClick={() => {
            console.log(`🔍 Graph: Search button clicked, isSearchVisible: ${isSearchVisible} -> ${!isSearchVisible}`);
            setIsSearchVisible(!isSearchVisible);
          }}
          style={{
            background: isSearchVisible ? '#2196F3' : '#666',
            color: 'white',
            border: 'none',
            padding: '6px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '500',
            width: '100%',
            marginBottom: '6px',
            transition: 'all 0.2s ease'
          }}
        >
          🔍 {isSearchVisible ? 'Hide' : 'Search'} Papers
        </button>

        <div style={{ fontSize: '10px', opacity: 0.7 }}>
          Intelligent memory management
        </div>
      </div>

      {/* LOD System Debug Panel */}
      {lodInfo && (
        <div style={{
          position: 'absolute',
          top: 120,
          left: 10,
          background: 'rgba(0,0,0,0.9)',
          color: 'white',
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '11px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          zIndex: 1000,
          minWidth: '280px',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          <div style={{ marginBottom: '6px', fontWeight: 'bold', color: '#4CAF50' }}>🎯 LOD System Status:</div>
          <div style={{ marginBottom: '2px' }}>
            <span style={{ color: '#FFD700' }}>Level:</span> {lodInfo.level} 
            <span style={{ marginLeft: '10px', fontSize: '10px', opacity: 0.8 }}>
              ({lodInfo.level === 0 ? 'Max Detail' : 
                lodInfo.level === 1 ? 'High Detail' : 
                lodInfo.level === 2 ? 'Normal' : 
                lodInfo.level === 3 ? 'Overview' : 
                lodInfo.level === 4 ? 'Far View' : 'Ultra Far'})
            </span>
          </div>
          <div style={{ marginBottom: '2px' }}>
            <span style={{ color: '#FFD700' }}>Camera Ratio:</span> {lodInfo.cameraRatio.toFixed(3)}
          </div>
          <div style={{ marginBottom: '2px' }}>
            <span style={{ color: '#FFD700' }}>Max Nodes:</span> {lodInfo.maxNodes}
          </div>
          <div style={{ marginBottom: '2px' }}>
            <span style={{ color: '#FFD700' }}>Min Degree:</span> {lodInfo.minDegree}
          </div>
          <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px' }}>
            🚀 Smart density control prevents lag when zooming out
          </div>
        </div>
      )}

      {/* Viewport Debug Panel */}
      {viewportBounds && (
        <div style={{
          position: 'absolute',
          top: 280,
          left: 10,
          background: 'rgba(0,0,0,0.85)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          zIndex: 1000,
          minWidth: '250px'
        }}>
          <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>📍 Viewport Bounds:</div>
          <div>X: [{viewportBounds.minX.toFixed(3)}, {viewportBounds.maxX.toFixed(3)}]</div>
          <div>Y: [{viewportBounds.minY.toFixed(3)}, {viewportBounds.maxY.toFixed(3)}]</div>
          <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '4px' }}>
            Size: {(viewportBounds.maxX - viewportBounds.minX).toFixed(3)} × {(viewportBounds.maxY - viewportBounds.minY).toFixed(3)}
          </div>
        </div>
      )}

      {/* Node Hover Info */}
      {/* Selected Node Panel */}
      {selectedNode && (
        <div style={{
          position: 'absolute',
          top: 220,
          left: 10,
          background: 'rgba(255, 68, 68, 0.95)', // Red background for selected node
          color: 'white',
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '12px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          zIndex: 1001,
          minWidth: '280px',
          maxWidth: '400px',
          border: '2px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ marginBottom: '6px', fontWeight: 'bold', fontSize: '13px' }}>🖱️ Selected Node & Neighbors:</div>
          <div style={{ marginBottom: '4px', fontSize: '11px' }}>
            <strong>Paper:</strong> {selectedNode.label.length > 60 ? selectedNode.label.substring(0, 60) + '...' : selectedNode.label}
          </div>
          <div style={{ marginBottom: '4px', fontSize: '11px' }}>
            <strong>Connected Papers:</strong> {selectedNode.neighborCount}
          </div>
          <div style={{ fontSize: '10px', opacity: 0.8, fontStyle: 'italic', marginTop: '6px' }}>
            💡 Click another node to highlight it, or click empty space to clear
          </div>
        </div>
      )}

      {hoveredNode && !selectedNode && (
        <div style={{
          position: 'absolute',
          top: 220,
          left: 10,
          background: 'rgba(33, 150, 243, 0.95)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          zIndex: 1000,
          minWidth: '250px',
          maxWidth: '350px'
        }}>
          <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>🎯 Hovered Node:</div>
          <div style={{ marginBottom: '2px' }}><strong>Position:</strong> ({hoveredNode.x.toFixed(3)}, {hoveredNode.y.toFixed(3)})</div>
          <div style={{ marginBottom: '2px' }}><strong>Degree:</strong> {hoveredNode.degree}</div>
          <div style={{ marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <strong>Cluster:</strong> 
            <span style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              <div 
                style={{ 
                  width: '10px', 
                  height: '10px', 
                  borderRadius: '50%', 
                  backgroundColor: hoveredNode.color,
                  border: '1px solid rgba(255, 255, 255, 0.3)'
                }} 
              />
              {hoveredNode.community} ({clusterManager.getCluster(hoveredNode.community)?.name || 'Unknown'})
            </span>
          </div>
          <div style={{ fontSize: '10px', opacity: 0.9, wordBreak: 'break-word' }}>
            <strong>Title:</strong> {hoveredNode.label}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        left: 20,
        background: 'rgba(0,0,0,0.75)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '11px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 1000,
        maxWidth: '320px'
      }}>
        <div>🔍 <strong>Mouse Wheel:</strong> Zoom in/out anywhere</div>
        <div>🖱️ <strong>Click & Drag:</strong> Pan around the graph</div>
        <div>🎯 <strong>Click Node:</strong> Highlight node and connections</div>
        <div>🎯 <strong>Click Empty Space:</strong> Clear highlights</div>
        <div>🎯 <strong>Zoom Buttons:</strong> Bottom-right corner</div>
        <div>🧠 <strong>Smart Loading:</strong> Content loads as you explore</div>
        <div style={{fontSize: '10px', opacity: 0.6, marginTop: '4px'}}>Natural camera controls - no node dragging</div>
      </div>

      {/* Search Container */}
      <SearchContainer 
        graphManager={graphManagerRef.current}
        isVisible={isSearchVisible} 
        onClose={() => setIsSearchVisible(false)} 
      />

      {/* Cluster Panel */}
      <ClusterPanel 
        isVisible={isClusterPanelVisible} 
        onClose={() => setIsClusterPanelVisible(false)} 
      />

      {/* Sigma.js Controls for Zoom/Pan */}
      <ControlsContainer position={"bottom-right"}>
        <ZoomControl />
        <FullScreenControl />
      </ControlsContainer>
    </>
  );
}

export default function GraphContainer() {
  const { themePalette } = useTheme();
  
  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      position: 'relative',
      backgroundColor: themePalette.canvasBackground 
    }}>
      <SigmaContainer
        style={{ 
          width: '100%', 
          height: '100%',
          backgroundColor: themePalette.canvasBackground
        }}
        settings={{
          // Core settings
          allowInvalidContainer: true,
          
          // Visual settings
          defaultNodeColor: '#4CAF50',
          defaultEdgeColor: themePalette.edgeColor,
          labelDensity: 0.07,
          labelRenderedSizeThreshold: 12,
          labelFont: 'system-ui, -apple-system, sans-serif',
          labelSize: 12,
          labelWeight: '500',
          
          // Mouse interaction settings - CRITICAL for enabling mouse controls
          enableEdgeEvents: true,
          
          // Camera/zoom settings - these are the correct settings for Sigma.js v3
          minCameraRatio: 0.005,  // Allow closer zooming in
          maxCameraRatio: 20,     // Allow more zooming out
        }}
      >
        <GraphInner />
      </SigmaContainer>
      
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `
      }} />
    </div>
  );
} 