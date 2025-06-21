import React, { useEffect, useState, useRef, useCallback } from 'react';
import { SigmaContainer, useSigma } from "@react-sigma/core";
import { fetchBox, fetchEdgesBatch, Node, Edge } from '../api/fetchNodes';

// Spatial cache to track loaded regions
interface LoadedRegion {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  timestamp: number;
}

function ViewportGraphInner() {
  const sigma = useSigma();
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  
  // Spatial persistence
  const loadedRegions = useRef<LoadedRegion[]>([]);
  const loadedNodes = useRef<Set<string>>(new Set());
  const isLoadingRef = useRef(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Get viewport bounds from camera state
  const getViewportBounds = useCallback(() => {
    const camera = sigma.getCamera();
    const { x, y, ratio } = camera.getState();
    const container = sigma.getContainer();
    const { width, height } = container.getBoundingClientRect();
    
    const viewportWidth = width * ratio;
    const viewportHeight = height * ratio;
    const padding = Math.max(viewportWidth, viewportHeight) * 0.3;
    
    return {
      minX: x - viewportWidth/2 - padding,
      maxX: x + viewportWidth/2 + padding,
      minY: y - viewportHeight/2 - padding,
      maxY: y + viewportHeight/2 + padding,
      ratio
    };
  }, [sigma]);

  // Check if region already loaded
  const isRegionLoaded = useCallback((bounds: any) => {
    return loadedRegions.current.some(region => 
      region.minX <= bounds.minX && 
      region.maxX >= bounds.maxX &&
      region.minY <= bounds.minY && 
      region.maxY >= bounds.maxY &&
      Date.now() - region.timestamp < 60000
    );
  }, []);

  // Load nodes in viewport
  const loadViewportNodes = useCallback(async (bounds: any) => {
    if (isLoadingRef.current || isRegionLoaded(bounds)) {
      return;
    }

    isLoadingRef.current = true;
    setLoading(true);
    
    try {
      // Level-of-Detail: adjust node limit based on zoom
      let nodeLimit = 200;
      if (bounds.ratio < 0.5) {
        nodeLimit = 100;
        setLoadingStage('Loading overview...');
      } else if (bounds.ratio > 2.0) {
        nodeLimit = 400;
        setLoadingStage('Loading details...');
      } else {
        setLoadingStage('Loading viewport...');
      }

      console.log(`🔍 Viewport load: ratio=${bounds.ratio.toFixed(2)}, limit=${nodeLimit}`);

      const newNodes = await fetchBox(
        bounds.minX, bounds.maxX, 
        bounds.minY, bounds.maxY, 
        bounds.ratio, nodeLimit
      );

      if (newNodes.length === 0) {
        setLoadingStage('No nodes in area');
        setTimeout(() => setLoadingStage(''), 1000);
        return;
      }

      const graph = sigma.getGraph();
      let addedNodes = 0;

      // Stream nodes in batches
      const BATCH_SIZE = 25;
      for (let i = 0; i < newNodes.length; i += BATCH_SIZE) {
        const batch = newNodes.slice(i, i + BATCH_SIZE);
        
        batch.forEach((node: Node) => {
          if (!loadedNodes.current.has(node.key)) {
            graph.addNode(node.key, {
              label: node.attributes.label?.substring(0, 50) || node.key,
              x: node.attributes.x,
              y: node.attributes.y,
              size: Math.max(3, Math.log(node.attributes.degree + 1) * 2.5),
              color: node.attributes.color || '#4CAF50',
              community: node.attributes.community,
              degree: node.attributes.degree,
            });
            loadedNodes.current.add(node.key);
            addedNodes++;
          }
        });

        setNodeCount(graph.order);
        
        // Smooth streaming delay
        if (i + BATCH_SIZE < newNodes.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      console.log(`✅ Added ${addedNodes} nodes`);

      // Load edges for new nodes
      if (addedNodes > 0) {
        setLoadingStage('Loading connections...');
        try {
          const edges = await fetchEdgesBatch(Array.from(loadedNodes.current), 800, "high");
          
          let addedEdges = 0;
          edges.forEach((edge: Edge) => {
            if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
              if (!graph.hasEdge(edge.source, edge.target)) {
                graph.addEdge(edge.source, edge.target, {
                  color: '#cccccc',
                  size: 1,
                });
                addedEdges++;
              }
            }
          });

          setEdgeCount(graph.size);
          console.log(`🔗 Added ${addedEdges} edges`);
        } catch (edgeError) {
          console.warn('Edge loading failed:', edgeError);
        }
      }

      // Mark region as loaded
      loadedRegions.current.push({
        ...bounds,
        timestamp: Date.now()
      });

      // Clean up old regions
      if (loadedRegions.current.length > 10) {
        loadedRegions.current = loadedRegions.current.slice(-8);
      }

      setLoadingStage(`+${addedNodes} nodes`);
      setTimeout(() => setLoadingStage(''), 1500);

    } catch (error) {
      console.error('❌ Viewport loading error:', error);
      setLoadingStage('Loading failed');
      setTimeout(() => setLoadingStage(''), 2000);
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
    }
  }, [sigma, isRegionLoaded]);

  // Handle viewport changes with debouncing
  const handleViewportChange = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    loadTimeoutRef.current = setTimeout(() => {
      const bounds = getViewportBounds();
      loadViewportNodes(bounds);
    }, 400); // 400ms debounce
  }, [getViewportBounds, loadViewportNodes]);

  // Set up viewport tracking
  useEffect(() => {
    // Initial load
    const initialBounds = getViewportBounds();
    loadViewportNodes(initialBounds);

    // Listen for render events (includes camera changes)
    const container = sigma.getContainer();
    
    // Use mouse and wheel events as proxy for camera changes
    const handleInteraction = () => {
      handleViewportChange();
    };

    container.addEventListener('mouseup', handleInteraction);
    container.addEventListener('wheel', handleInteraction, { passive: true });
    
    return () => {
      container.removeEventListener('mouseup', handleInteraction);
      container.removeEventListener('wheel', handleInteraction);
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, [handleViewportChange, getViewportBounds, loadViewportNodes]);

  return (
    <>
      {/* Enhanced loading indicator */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: loading ? 'rgba(33, 150, 243, 0.9)' : 'rgba(0,0,0,0.85)',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 1000,
        minWidth: '300px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        transition: 'background-color 0.3s ease',
      }}>
        {loading ? (
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
              <span>{loadingStage || 'Loading...'}</span>
            </div>
            <div style={{ fontSize: '11px', opacity: 0.8 }}>
              🔄 Streaming as you explore
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '4px' }}>
              📊 <strong>Nodes:</strong> <span style={{color: '#4CAF50'}}>{nodeCount}</span> | 
              🔗 <strong>Edges:</strong> <span style={{color: '#66BB6A'}}>{edgeCount}</span>
            </div>
            <div style={{ fontSize: '11px', opacity: 0.7 }}>
              🎯 Regions loaded: {loadedRegions.current.length} | 
              {loadingStage && <span style={{color: '#FFD54F'}}>{loadingStage}</span>}
            </div>
          </div>
        )}
      </div>

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
        maxWidth: '250px'
      }}>
        <div>🖱️ <strong>Drag:</strong> Explore • Auto-loads content</div>
        <div>🔍 <strong>Scroll:</strong> Zoom • Smart detail levels</div>
        <div>⚡ <strong>Phase 2:</strong> Streaming viewport loading</div>
      </div>
    </>
  );
}

export default function ViewportGraphContainer() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SigmaContainer
        style={{ width: '100%', height: '100%' }}
        settings={{
          allowInvalidContainer: true,
          defaultNodeColor: '#4CAF50',
          defaultEdgeColor: '#cccccc',
          labelDensity: 0.07,
          labelRenderedSizeThreshold: 10,
          labelFont: 'system-ui, -apple-system, sans-serif',
          labelSize: 12,
          labelWeight: '500',
          enableEdgeEvents: true,
          minCameraRatio: 0.05,
          maxCameraRatio: 20,
          renderEdgeLabels: false,
          defaultEdgeType: 'line',
        }}
      >
        <ViewportGraphInner />
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