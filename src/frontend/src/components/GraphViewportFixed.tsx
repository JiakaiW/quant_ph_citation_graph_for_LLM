import React, { useEffect, useState, useRef, useCallback } from 'react';
import { SigmaContainer, useSigma } from "@react-sigma/core";
import { fetchBox, fetchEdgesBatch, Node, Edge } from '../api/fetchNodes';

// Configuration for dynamic behavior
interface ViewportConfig {
  maxNodes: number;
  streamBatchSize: number;
  nodeBaseSize: number;
  edgeBaseWidth: number;
}

// Spatial region tracking
interface LoadedRegion {
  minX: number;
  maxX: number;  
  minY: number;
  maxY: number;
  timestamp: number;
  zoomLevel: number;
}

function DynamicGraphInner() {
  const sigma = useSigma();
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [config, setConfig] = useState<ViewportConfig>({
    maxNodes: 500,
    streamBatchSize: 20,
    nodeBaseSize: 3,
    edgeBaseWidth: 1
  });

  // State management
  const loadedRegions = useRef<LoadedRegion[]>([]);
  const allLoadedNodes = useRef<Set<string>>(new Set());
  const isLoadingRef = useRef(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Get CORRECTED viewport bounds (fix coordinate mismatch)
  const getViewportBounds = useCallback(() => {
    const camera = sigma.getCamera();
    const { x, y, ratio } = camera.getState();
    const container = sigma.getContainer();
    const { width, height } = container.getBoundingClientRect();
    
    // FIX: Use correct coordinate scaling for your database (-269 to 273 range)
    const viewportWidth = (width * ratio) / 4; // Scale down from Sigma's coordinate space
    const viewportHeight = (height * ratio) / 4; // Scale down from Sigma's coordinate space
    
    // Add smaller padding for more precise queries
    const padding = Math.min(viewportWidth, viewportHeight) * 0.2;
    
    const bounds = {
      minX: x - viewportWidth/2 - padding,
      maxX: x + viewportWidth/2 + padding,
      minY: y - viewportHeight/2 - padding,
      maxY: y + viewportHeight/2 + padding,
      ratio,
      width: viewportWidth,
      height: viewportHeight
    };

    console.log(`📐 Corrected viewport: [${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)}] to [${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)}] @ zoom=${ratio.toFixed(2)}`);
    return bounds;
  }, [sigma]);

  // Dynamic node removal based on viewport and node limit
  const removeDistantNodes = useCallback((currentBounds: any) => {
    const graph = sigma.getGraph();
    const nodes = graph.nodes();
    
    if (nodes.length <= config.maxNodes) return;

    // Calculate distance from viewport center for each node
    const centerX = (currentBounds.minX + currentBounds.maxX) / 2;
    const centerY = (currentBounds.minY + currentBounds.maxY) / 2;
    
    const nodeDistances = nodes.map(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      const dx = attrs.x - centerX;
      const dy = attrs.y - centerY;
      const distance = Math.sqrt(dx*dx + dy*dy);
      return { nodeId, distance, degree: attrs.degree };
    });

    // Sort by distance (keep closer nodes) and degree (keep important nodes)
    nodeDistances.sort((a, b) => 
      (a.distance * 0.7) + (1000 / (a.degree + 1)) * 0.3 - 
      (b.distance * 0.7) - (1000 / (b.degree + 1)) * 0.3
    );

    // Remove excess nodes (keep the closest + most important ones)
    const nodesToRemove = nodeDistances.slice(config.maxNodes);
    let removedCount = 0;

    nodesToRemove.forEach(({ nodeId }) => {
      if (graph.hasNode(nodeId)) {
        graph.dropNode(nodeId); // This also removes connected edges
        allLoadedNodes.current.delete(nodeId);
        removedCount++;
      }
    });

    if (removedCount > 0) {
      console.log(`🗑️ Removed ${removedCount} distant nodes (keeping ${graph.order} nodes)`);
      setNodeCount(graph.order);
      setEdgeCount(graph.size);
    }
  }, [sigma, config.maxNodes]);

  // Real streaming node loading (gradual batches)
  const streamNodesIntoViewport = useCallback(async (newNodes: Node[], bounds: any) => {
    const graph = sigma.getGraph();
    let addedNodes = 0;
    let skippedNodes = 0;
    
    setLoadingStage('Streaming nodes into viewport...');

    // Real streaming: process in small batches with delays
    for (let i = 0; i < newNodes.length; i += config.streamBatchSize) {
      const batch = newNodes.slice(i, i + config.streamBatchSize);
      const batchNum = Math.floor(i / config.streamBatchSize) + 1;
      const totalBatches = Math.ceil(newNodes.length / config.streamBatchSize);
      
      setLoadingStage(`Streaming batch ${batchNum}/${totalBatches} (${batch.length} nodes)...`);

      batch.forEach((node: Node) => {
        if (!allLoadedNodes.current.has(node.key)) {
          // Zoom-based node sizing
          const baseSize = config.nodeBaseSize;
          const sizeMultiplier = Math.max(0.5, Math.min(3, 1 / bounds.ratio)); // Smaller when zoomed out
          const nodeSize = Math.max(2, Math.log(node.attributes.degree + 1) * baseSize * sizeMultiplier);

          graph.addNode(node.key, {
            label: node.attributes.label?.substring(0, 60) || node.key,
            x: node.attributes.x,
            y: node.attributes.y,
            size: nodeSize,
            color: node.attributes.color || '#4CAF50',
            community: node.attributes.community,
            degree: node.attributes.degree,
          });
          
          allLoadedNodes.current.add(node.key);
          addedNodes++;
        } else {
          skippedNodes++;
        }
      });

      setNodeCount(graph.order);
      
      // Real streaming delay - visible incremental loading
      if (i + config.streamBatchSize < newNodes.length) {
        await new Promise(resolve => setTimeout(resolve, 150)); // Visible streaming
      }
    }

    console.log(`📊 Streaming complete: +${addedNodes} new, ${skippedNodes} already loaded`);
    return addedNodes;
  }, [sigma, config]);

  // Enhanced viewport loading with proper R-tree queries
  const loadViewportContent = useCallback(async (bounds: any) => {
    if (isLoadingRef.current) return;

    isLoadingRef.current = true;
    setLoading(true);

    try {
      // Step 1: Query R-tree with CORRECTED coordinates
      setLoadingStage('Querying R-tree spatial index...');
      console.log(`🔍 R-tree query: bounds=[${bounds.minX.toFixed(1)},${bounds.minY.toFixed(1)} to ${bounds.maxX.toFixed(1)},${bounds.maxY.toFixed(1)}]`);
      
      const queryLimit = Math.min(1000, config.maxNodes * 2); // Get more than we need for selection
      const newNodes = await fetchBox(
        bounds.minX, bounds.maxX,
        bounds.minY, bounds.maxY,
        bounds.ratio, queryLimit
      );

      console.log(`📊 R-tree returned ${newNodes.length} nodes in viewport`);

      if (newNodes.length === 0) {
        setLoadingStage('No nodes in this viewport area');
        setTimeout(() => setLoadingStage(''), 1500);
        return;
      }

      // Step 2: Stream nodes into graph (real streaming behavior)
      const addedCount = await streamNodesIntoViewport(newNodes, bounds);

      // Step 3: Remove distant nodes if we exceed limit
      removeDistantNodes(bounds);

      // Step 4: Load edges for visible nodes
      if (addedCount > 0) {
        setLoadingStage('Loading citation edges...');
        const visibleNodes = Array.from(allLoadedNodes.current);
        
        try {
          const edges = await fetchEdgesBatch(visibleNodes, 3000, "all");
          console.log(`🔗 Fetched ${edges.length} potential edges`);

          const graph = sigma.getGraph();
          let addedEdges = 0;
          
          // Zoom-based edge width
          const edgeWidth = config.edgeBaseWidth * Math.max(0.3, Math.min(2, 1 / bounds.ratio));

          edges.forEach((edge: Edge) => {
            if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
              if (!graph.hasEdge(edge.source, edge.target)) {
                graph.addEdge(edge.source, edge.target, {
                  color: '#ddd',
                  size: edgeWidth,
                });
                addedEdges++;
              }
            }
          });

          setEdgeCount(graph.size);
          console.log(`🔗 Added ${addedEdges} new edges (${graph.size} total)`);
        } catch (edgeError) {
          console.warn('Edge loading failed:', edgeError);
        }
      }

      // Mark region as loaded
      loadedRegions.current.push({
        ...bounds,
        timestamp: Date.now(),
        zoomLevel: bounds.ratio
      });

      setLoadingStage(`✅ Loaded ${addedCount} nodes in viewport`);
      setTimeout(() => setLoadingStage(''), 2000);

    } catch (error) {
      console.error('❌ Viewport loading failed:', error);
      setLoadingStage('Loading failed - retrying...');
      setTimeout(() => setLoadingStage(''), 2000);
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
    }
  }, [sigma, config, streamNodesIntoViewport, removeDistantNodes]);

  // Debounced viewport change handler
  const handleViewportChange = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    loadTimeoutRef.current = setTimeout(() => {
      const bounds = getViewportBounds();
      loadViewportContent(bounds);
    }, 300);
  }, [getViewportBounds, loadViewportContent]);

  // Setup viewport tracking
  useEffect(() => {
    // Initial load
    const initialBounds = getViewportBounds();
    loadViewportContent(initialBounds);

    // Listen for viewport changes
    const container = sigma.getContainer();
    
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
  }, [handleViewportChange, getViewportBounds, loadViewportContent]);

  return (
    <>
      {/* Dynamic loading indicator */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: loading ? 'rgba(33, 150, 243, 0.95)' : 'rgba(0,0,0,0.85)',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 1000,
        minWidth: '320px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        transition: 'all 0.3s ease',
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
              🔄 R-tree spatial streaming in progress...
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '4px' }}>
              📊 <strong>Nodes:</strong> <span style={{color: '#4CAF50'}}>{nodeCount}</span> | 
              🔗 <strong>Edges:</strong> <span style={{color: '#66BB6A'}}>{edgeCount}</span>
            </div>
            <div style={{ fontSize: '11px', opacity: 0.7 }}>
              🎯 Max nodes: {config.maxNodes} | Regions: {loadedRegions.current.length}
              {loadingStage && <span style={{color: '#FFD54F'}}> | {loadingStage}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Configuration controls */}
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
        <div style={{ marginBottom: '6px' }}>
          <label style={{ display: 'block', marginBottom: '2px' }}>Max Nodes: {config.maxNodes}</label>
          <input
            type="range"
            min="100"
            max="2000"
            step="50"
            value={config.maxNodes}
            onChange={(e) => setConfig(prev => ({ ...prev, maxNodes: parseInt(e.target.value) }))}
            style={{ width: '120px' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '2px' }}>Stream Batch: {config.streamBatchSize}</label>
          <input
            type="range"
            min="5"
            max="50"
            step="5"
            value={config.streamBatchSize}
            onChange={(e) => setConfig(prev => ({ ...prev, streamBatchSize: parseInt(e.target.value) }))}
            style={{ width: '120px' }}
          />
        </div>
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
        maxWidth: '280px'
      }}>
        <div>🖱️ <strong>Drag:</strong> R-tree spatial queries</div>
        <div>🔍 <strong>Zoom:</strong> Dynamic node sizing & filtering</div>
        <div>⚡ <strong>Streaming:</strong> Gradual node loading + auto removal</div>
        <div>🎛️ <strong>Controls:</strong> Adjust max nodes & batch size</div>
      </div>
    </>
  );
}

export default function DynamicGraphContainer() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SigmaContainer
        style={{ width: '100%', height: '100%' }}
        settings={{
          allowInvalidContainer: true,
          defaultNodeColor: '#4CAF50',
          defaultEdgeColor: '#ddd',
          labelDensity: 0.1,
          labelRenderedSizeThreshold: 8,
          labelFont: 'system-ui, -apple-system, sans-serif',
          labelSize: 11,
          labelWeight: '500',
          enableEdgeEvents: true,
          minCameraRatio: 0.1,
          maxCameraRatio: 10,
          renderEdgeLabels: false,
          defaultEdgeType: 'line',
        }}
      >
        <DynamicGraphInner />
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