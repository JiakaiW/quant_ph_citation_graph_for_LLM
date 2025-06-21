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
  const [maxNodes, setMaxNodes] = useState(500); // Dynamic node limit control
  
  // Spatial persistence
  const loadedRegions = useRef<LoadedRegion[]>([]);
  const loadedNodes = useRef<Set<string>>(new Set());
  const isLoadingRef = useRef(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  
  // CAMERA STABILITY: Store camera state to prevent auto-adjustment
  const cameraStateRef = useRef<{x: number, y: number, ratio: number} | null>(null);
  
  // COORDINATE NORMALIZATION: Dynamic embedding dimensions from loaded data
  const NORMALIZED_RANGE = 100; // Target coordinate range: [-50, 50] = 100 units
  
  // State to track actual coordinate bounds of loaded data
  const [coordinateBounds, setCoordinateBounds] = useState({
    minX: -9.56, maxX: 10.92, width: 20.48,   // Default: full embedding
    minY: -10.75, maxY: 9.69, height: 20.44,  // Default: full embedding  
    centerX: 0.68, centerY: -0.53             // Default: embedding center
  });
  
  const normalizeCoordinates = useCallback((dbX: number, dbY: number) => {
    // USER'S FORMULA: x_norm = x / embedding_width * 50, y_norm = y / embedding_height * 50
    const normalizedX = (dbX / coordinateBounds.width) * 50;
    const normalizedY = (dbY / coordinateBounds.height) * 50;
    return { x: normalizedX, y: normalizedY };
  }, [coordinateBounds]);
  
  const denormalizeCoordinates = useCallback((normX: number, normY: number) => {
    // Reverse the normalization: x = x_norm * embedding_width / 50
    const dbX = (normX * coordinateBounds.width) / 50;
    const dbY = (normY * coordinateBounds.height) / 50;
    return { x: dbX, y: dbY };
  }, [coordinateBounds]);

  // Calculate embedding dimensions from actual loaded data
  const updateEmbeddingDimensions = useCallback((nodes: Node[]) => {
    if (nodes.length === 0) return;
    
    const xCoords = nodes.map(n => n.attributes.x);
    const yCoords = nodes.map(n => n.attributes.y);
    
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    const width = Math.max(0.1, maxX - minX);  // Prevent division by zero
    const height = Math.max(0.1, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    const newBounds = { minX, maxX, minY, maxY, width, height, centerX, centerY };
    setCoordinateBounds(newBounds);
    
    console.log(`📏 Updated embedding dimensions: ${width.toFixed(1)}×${height.toFixed(1)} centered at (${centerX.toFixed(1)}, ${centerY.toFixed(1)})`);
    console.log(`📊 Coordinate ranges: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y[${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);
    
    return newBounds;
  }, []);
  
  // SCREEN-RELATIVE SIZING: Calculate size based on screen dimensions
  const getScreenRelativeSizing = useCallback(() => {
    const container = sigma.getContainer();
    const { width, height } = container.getBoundingClientRect();
    const minScreenDimension = Math.min(width, height);
    
    // Size constraints based on screen size
    const maxRadius = minScreenDimension / 20; // 1/20th of min screen dimension
    const minRadius = minScreenDimension / 60; // 1/60th of min screen dimension
    
    return {
      minRadius,
      maxRadius,
      screenWidth: width,
      screenHeight: height,
      minScreenDimension
    };
  }, [sigma]);

  // SIGMA-ADJUSTED NODE SIZING: Convert screen pixels to coordinate space units
  const calculateSigmaNodeSize = useCallback((degree: number, zoomRatio: number, allDegrees: number[] = []) => {
    const { minRadius, maxRadius } = getScreenRelativeSizing();
    
    // Base formula: radius = 2 + log(degree)
    const baseRadius = 2 + Math.log(degree + 1);
    
    // Degree normalization to screen pixel size
    let screenPixelRadius;
    if (allDegrees.length > 0) {
      const minDegree = Math.min(...allDegrees);
      const maxDegree = Math.max(...allDegrees);
      const minBaseRadius = 2 + Math.log(minDegree + 1);
      const maxBaseRadius = 2 + Math.log(maxDegree + 1);
      
      screenPixelRadius = minRadius + 
        ((baseRadius - minBaseRadius) / (maxBaseRadius - minBaseRadius)) * 
        (maxRadius - minRadius);
    } else {
      // Fallback: assume degree range of 1-2000
      const minBaseRadius = 2 + Math.log(2);
      const maxBaseRadius = 2 + Math.log(2001);
      
      screenPixelRadius = minRadius + 
        ((baseRadius - minBaseRadius) / (maxBaseRadius - minBaseRadius)) * 
        (maxRadius - minRadius);
    }
    
    // CRITICAL: Convert screen pixels to coordinate space units
    // In Sigma.js, node.size is in coordinate units, not screen pixels
    // To maintain constant screen size, we need: coordinateSize = screenPixels / zoomRatio
    let coordinateSpaceSize = screenPixelRadius / Math.max(0.1, zoomRatio);
    
    // ADDITIONAL REDUCTION for dense clustering: make nodes much smaller
    coordinateSpaceSize = coordinateSpaceSize * 0.3; // 70% size reduction for dense clusters
    
    console.log(`🎯 Node sizing: degree=${degree} → screen=${screenPixelRadius.toFixed(1)}px → coord=${coordinateSpaceSize.toFixed(3)} (zoom=${zoomRatio.toFixed(2)}) [dense-adjusted]`);
    
    return Math.max(0.1, coordinateSpaceSize); // Much smaller minimum size
  }, [getScreenRelativeSizing]);

  // NORMALIZED EDGE WIDTH: Calculate edge width based on screen dimensions
  const calculateNormalizedEdgeWidth = useCallback(() => {
    const { minScreenDimension } = getScreenRelativeSizing();
    
    // Edge width should be much smaller than nodes
    // Max edge width: 1/200th of screen, Min edge width: 1/800th of screen
    const maxEdgeWidth = minScreenDimension / 200;
    const minEdgeWidth = minScreenDimension / 800;
    
    // For now, use a fixed medium width - could be made dynamic based on edge properties
    const edgeWidth = (maxEdgeWidth + minEdgeWidth) / 2;
    
    return Math.max(0.5, edgeWidth); // Ensure minimum visibility
  }, [getScreenRelativeSizing]);

  // MATHEMATICAL VIEWPORT CALCULATION - Fixed coordinate system mapping
  const getViewportBounds = useCallback(() => {
    const camera = sigma.getCamera();
    const { x, y, ratio } = camera.getState();
    
    // CAMERA STABILITY: Store current state to prevent auto-adjustment
    cameraStateRef.current = { x, y, ratio };
    
    // MATHEMATICAL COORDINATE MAPPING:
    // Database: X=[-269,273] (range=542), Y=[-299,272] (range=572), center=(2,-13.5)  
    // Sigma camera: x,y are in Sigma's coordinate space
    // Problem: Sigma's (x,y) ≠ Database (x,y)
    
    // SOLUTION: Map Sigma camera to database coordinates using actual embedding dimensions
    // When zoomed out (small ratio), viewport should cover more embedding space
    // When zoomed in (large ratio), viewport should cover less
    
          // Using actual embedding dimensions from loaded data
    
    // CORRECTED NORMALIZED COORDINATE SYSTEM:
    // Now using actual data dimensions (±25 range instead of ±50)
    // Calculate viewport size in normalized coordinates
    const baseViewportSize = 15; // Base viewport size in normalized units (smaller for ±25 range)
    const viewportWidthNorm = baseViewportSize / Math.max(0.1, ratio); // Smaller when zoomed in
    const viewportHeightNorm = baseViewportSize / Math.max(0.1, ratio);
    
    // Sigma coordinates are directly normalized coordinates
    const normX = x;  // Sigma X is already in normalized space
    const normY = y;  // Sigma Y is already in normalized space
    
    // Convert to database coordinates for R-tree queries
    const dbCenter = denormalizeCoordinates(normX, normY);
    const dbMin = denormalizeCoordinates(normX - viewportWidthNorm/2, normY - viewportHeightNorm/2);
    const dbMax = denormalizeCoordinates(normX + viewportWidthNorm/2, normY + viewportHeightNorm/2);
    
    const bounds = {
      // Database coordinates for queries
      minX: dbMin.x,
      maxX: dbMax.x,
      minY: dbMin.y,
      maxY: dbMax.y,
      // Normalized coordinates for display
      normCenterX: normX,
      normCenterY: normY,
      normViewportWidth: viewportWidthNorm,
      normViewportHeight: viewportHeightNorm,
      ratio,
      viewportWidth: viewportWidthNorm,
      viewportHeight: viewportHeightNorm,
      sigmaX: x,
      sigmaY: y
    };
    
    console.log(`📐 NORMALIZED: Camera(${normX.toFixed(1)},${normY.toFixed(1)}) ratio=${ratio.toFixed(3)} → DB[${bounds.minX.toFixed(1)},${bounds.minY.toFixed(1)} to ${bounds.maxX.toFixed(1)},${bounds.maxY.toFixed(1)}] normSize=${bounds.normViewportWidth.toFixed(1)}x${bounds.normViewportHeight.toFixed(1)}`);
    return bounds;
  }, [sigma]);

  // Check if region already loaded - IMPROVED overlap detection
  const isRegionLoaded = useCallback((bounds: any) => {
    const overlapThreshold = 15; // Threshold for coordinate space
    const cacheTime = 5000; // 5 second cache
    
    const isLoaded = loadedRegions.current.some(region => {
      const xOverlap = Math.abs(region.minX - bounds.minX) < overlapThreshold && 
                      Math.abs(region.maxX - bounds.maxX) < overlapThreshold;
      const yOverlap = Math.abs(region.minY - bounds.minY) < overlapThreshold && 
                      Math.abs(region.maxY - bounds.maxY) < overlapThreshold;
      const timeValid = Date.now() - region.timestamp < cacheTime;
      
      if (xOverlap && yOverlap && timeValid) {
        console.log(`♻️ Using cached region: DB[${region.minX.toFixed(1)}, ${region.minY.toFixed(1)} to ${region.maxX.toFixed(1)}, ${region.maxY.toFixed(1)}]`);
        return true;
      }
      return false;
    });
    
    if (!isLoaded) {
      console.log(`🆕 New region needed: DB[${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)} to ${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)}]`);
    }
    
    return isLoaded;
  }, []);

  // NEW: Node removal functionality for performance
  const removeExcessNodes = useCallback((bounds: any, maxNodes: number = 500) => {
    const graph = sigma.getGraph();
    const currentNodes = graph.nodes();
    
    if (currentNodes.length <= maxNodes) return 0;

    // Calculate distance from viewport center for each node
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    
    const nodeDistances = currentNodes.map(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      const dx = attrs.x - centerX;
      const dy = attrs.y - centerY;
      const distance = Math.sqrt(dx*dx + dy*dy);
      const importance = Math.log(attrs.degree + 1); // Keep high-degree nodes
      return { nodeId, score: distance - importance * 10 }; // Lower score = keep
    });

    // Sort by score and remove worst nodes
    nodeDistances.sort((a, b) => a.score - b.score);
    const nodesToRemove = nodeDistances.slice(maxNodes);
    
    let removedCount = 0;
    // CRITICAL: Save camera state before removing nodes
    const camera = sigma.getCamera();
    const currentCameraState = camera.getState();

    nodesToRemove.forEach(({ nodeId }) => {
      graph.dropNode(nodeId);
      loadedNodes.current.delete(nodeId);
      removedCount++;
    });

    if (removedCount > 0) {
      console.log(`🗑️ Removed ${removedCount} distant nodes (keeping ${graph.order})`);
      setNodeCount(graph.order);
      setEdgeCount(graph.size);
      
      // CRITICAL: Restore camera state after removing nodes
      camera.setState(currentCameraState);
    }
    
    return removedCount;
  }, [sigma]);

  // Load nodes in viewport - ENHANCED with node removal and zoom-based sizing
  const loadViewportNodes = useCallback(async (bounds: any) => {
    if (isLoadingRef.current || isRegionLoaded(bounds)) {
      return;
    }

    isLoadingRef.current = true;
    setLoading(true);
    
    try {
      // Dynamic node limit based on zoom level
      const baseNodeLimit = 300;
      const zoomMultiplier = Math.max(0.5, Math.min(3, 1/bounds.ratio)); // More nodes when zoomed in
      const nodeLimit = Math.floor(baseNodeLimit * zoomMultiplier);
      
      setLoadingStage(`R-tree spatial query: ${nodeLimit} nodes...`);
      console.log(`🔍 Spatial query: viewport=${bounds.viewportWidth.toFixed(0)}x${bounds.viewportHeight.toFixed(0)}, zoom=${bounds.ratio.toFixed(2)}, limit=${nodeLimit}`);

      const newNodes = await fetchBox(
        bounds.minX, bounds.maxX, 
        bounds.minY, bounds.maxY, 
        bounds.ratio, nodeLimit
      );

      console.log(`📊 R-tree returned ${newNodes.length} nodes in viewport bounds`);

      if (newNodes.length === 0) {
        setLoadingStage('No nodes in this area');
        setTimeout(() => setLoadingStage(''), 1500);
        return;
      }

      // CRITICAL: Update embedding dimensions based on actual loaded data
      const updatedBounds = updateEmbeddingDimensions(newNodes);
      console.log(`🎯 Using embedding dimensions: ${updatedBounds?.width.toFixed(1)}×${updatedBounds?.height.toFixed(1)} for coordinate scaling`);

      const graph = sigma.getGraph();
      let addedNodes = 0;
      let batchCount = 0;

      // TRUE streaming: smaller batches with visible progress
      const BATCH_SIZE = 15; // Smaller batches for smoother streaming
      const totalBatches = Math.ceil(newNodes.length / BATCH_SIZE);
      
      // COLLECT ALL DEGREES for proper normalization
      const allDegrees = newNodes.map(node => node.attributes.degree);
      console.log(`📊 Degree range in batch: ${Math.min(...allDegrees)} to ${Math.max(...allDegrees)}`);
      
      // DEBUG: Log coordinate distribution BEFORE and AFTER normalization
      const dbXCoords = newNodes.map(n => n.attributes.x);
      const dbYCoords = newNodes.map(n => n.attributes.y);
      const dbXRange = Math.max(...dbXCoords) - Math.min(...dbXCoords);
      const dbYRange = Math.max(...dbYCoords) - Math.min(...dbYCoords);
      
      console.log(`📍 DB coordinates: X[${Math.min(...dbXCoords).toFixed(1)}, ${Math.max(...dbXCoords).toFixed(1)}] span=${dbXRange.toFixed(1)}, Y[${Math.min(...dbYCoords).toFixed(1)}, ${Math.max(...dbYCoords).toFixed(1)}] span=${dbYRange.toFixed(1)}`);
      
      // Sample normalized coordinates
      const sampleNormalized = newNodes.slice(0, 3).map(node => {
        const norm = normalizeCoordinates(node.attributes.x, node.attributes.y);
        return `DB(${node.attributes.x.toFixed(1)},${node.attributes.y.toFixed(1)})→Norm(${norm.x.toFixed(1)},${norm.y.toFixed(1)})`;
      });
      console.log(`🔄 Sample normalization: ${sampleNormalized.join(', ')}`);
      
      for (let i = 0; i < newNodes.length; i += BATCH_SIZE) {
        const batch = newNodes.slice(i, i + BATCH_SIZE);
        batchCount++;
        
        setLoadingStage(`Streaming batch ${batchCount}/${totalBatches} (${batch.length} nodes)...`);
        
        batch.forEach((node: Node) => {
          if (!loadedNodes.current.has(node.key)) {
            // SIGMA-ADJUSTED NODE SIZING: 2 + log(degree), converted to coordinate space
            const sigmaSize = calculateSigmaNodeSize(node.attributes.degree, bounds.ratio, allDegrees);
            
                        // NORMALIZE COORDINATES: Convert database coordinates to normalized space
            const normalizedCoords = normalizeCoordinates(node.attributes.x, node.attributes.y);
            
            // DEBUGGING: Log coordinate transformation
            if (addedNodes < 3) {
              console.log(`🔄 Node ${addedNodes + 1}: DB(${node.attributes.x.toFixed(2)}, ${node.attributes.y.toFixed(2)}) → Norm(${normalizedCoords.x.toFixed(1)}, ${normalizedCoords.y.toFixed(1)})`);
            }
            
            graph.addNode(node.key, {
              label: node.attributes.label?.substring(0, 50) || node.key,
              x: normalizedCoords.x, // NORMALIZED coordinates for proper zoom range
              y: normalizedCoords.y, // NORMALIZED coordinates for proper zoom range
              size: sigmaSize,
              color: node.attributes.color || '#4CAF50',
              community: node.attributes.community,
              degree: node.attributes.degree,
            });
            loadedNodes.current.add(node.key);
            addedNodes++;
          }
        });

        setNodeCount(graph.order);
        
        // CRITICAL: Restore camera state after adding nodes to prevent auto-adjustment
        if (cameraStateRef.current) {
          const { x: savedX, y: savedY, ratio: savedRatio } = cameraStateRef.current;
          const camera = sigma.getCamera();
          camera.setState({ x: savedX, y: savedY, ratio: savedRatio });
        }
        
        // TRUE streaming delay - visible incremental loading
        if (i + BATCH_SIZE < newNodes.length) {
          await new Promise(resolve => setTimeout(resolve, 120)); // Visible streaming
        }
      }

      // Remove excess nodes to maintain performance
      const removedCount = removeExcessNodes(bounds, maxNodes);
      console.log(`✅ Streaming complete: +${addedNodes} new nodes, -${removedCount} removed`);
      
      // DEBUG: Log current camera state after all operations
      if (cameraStateRef.current) {
        const currentState = sigma.getCamera().getState();
        console.log(`📷 Camera after streaming: (${currentState.x.toFixed(1)}, ${currentState.y.toFixed(1)}) ratio=${currentState.ratio.toFixed(3)}`);
      }

              // Load edges with zoom-based width
        if (addedNodes > 0) {
          setLoadingStage('Loading citation connections...');
          try {
            const visibleNodeIds = Array.from(loadedNodes.current);
            const edges = await fetchEdgesBatch(visibleNodeIds, 5000, "all");
            console.log(`🔍 Edge query: ${visibleNodeIds.length} nodes → ${edges.length} edge candidates`);
            
            let addedEdges = 0;
            const graph = sigma.getGraph();
            
            // SCREEN-RELATIVE EDGE WIDTH - calculated based on screen dimensions
            const normalizedEdgeWidth = calculateNormalizedEdgeWidth();
            
            edges.forEach((edge: Edge) => {
              if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
                if (!graph.hasEdge(edge.source, edge.target)) {
                  graph.addEdge(edge.source, edge.target, {
                    color: '#dddddd',
                    size: normalizedEdgeWidth,
                  });
                  addedEdges++;
                }
              }
            });

            setEdgeCount(graph.size);
            console.log(`🔗 Added ${addedEdges} edges (width=${normalizedEdgeWidth.toFixed(1)}) from ${edges.length} candidates`);
            
            // CRITICAL: Restore camera state after adding edges  
            if (cameraStateRef.current) {
              const { x: savedX, y: savedY, ratio: savedRatio } = cameraStateRef.current;
              const camera = sigma.getCamera();
              camera.setState({ x: savedX, y: savedY, ratio: savedRatio });
              console.log(`📷 Camera restored after edges: (${savedX.toFixed(1)}, ${savedY.toFixed(1)}) ratio=${savedRatio.toFixed(3)}`);
            }
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

      setLoadingStage(`✅ +${addedNodes} nodes loaded from R-tree spatial query`);
      setTimeout(() => setLoadingStage(''), 2000);

    } catch (error) {
      console.error('❌ Viewport loading error:', error);
      setLoadingStage('Loading failed');
      setTimeout(() => setLoadingStage(''), 2000);
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
    }
  }, [sigma, isRegionLoaded, removeExcessNodes, calculateSigmaNodeSize, calculateNormalizedEdgeWidth, normalizeCoordinates]);

  // Handle viewport changes with debouncing
  const handleViewportChange = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    loadTimeoutRef.current = setTimeout(() => {
      const bounds = getViewportBounds();
      loadViewportNodes(bounds);
    }, 400); // Longer debounce to prevent jiggling
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

  // Trigger node removal when max nodes slider changes
  useEffect(() => {
    const bounds = getViewportBounds();
    removeExcessNodes(bounds, maxNodes);
  }, [maxNodes, getViewportBounds, removeExcessNodes]);

  // RESET BUTTON: Center and fit entire embedding space
  // FIXED: Force camera to (0,0) and load diverse nodes immediately  
  const resetViewport = useCallback(() => {
    const camera = sigma.getCamera();
    const graph = sigma.getGraph();
    
    // STEP 1: Clear everything
    console.log(`🧹 Clearing graph and cache...`);
    loadedRegions.current = [];
    loadedNodes.current.clear();
    graph.clear();
    setNodeCount(0);
    setEdgeCount(0);
    
    // STEP 2: Force camera to (0,0) with wide view
    const fitRatio = 0.3;
    camera.setState({ x: 0, y: 0, ratio: fitRatio });
    console.log(`📷 FORCED camera to (0, 0) ratio=${fitRatio}`);
    
    // STEP 3: Load diverse nodes across full coordinate space (not just viewport)
    setTimeout(async () => {
      console.log(`🌍 Loading diverse nodes across FULL coordinate space...`);
      
      try {
        // Load nodes from broader area: -15 to +15 (covers most data)
        const diverseNodes = await fetchBox(-15, 15, -15, 15, fitRatio, 200);
        console.log(`📊 Loaded ${diverseNodes.length} diverse nodes from full coordinate space`);
        
        if (diverseNodes.length > 0) {
          // Update embedding dimensions
          const updatedBounds = updateEmbeddingDimensions(diverseNodes);
          console.log(`📏 Embedding: ${updatedBounds?.width.toFixed(1)}×${updatedBounds?.height.toFixed(1)}`);
          
          // Add nodes immediately (no batching for reset)
          diverseNodes.forEach((node: Node) => {
            const normalizedCoords = normalizeCoordinates(node.attributes.x, node.attributes.y);
            const size = calculateSigmaNodeSize(node.attributes.degree, fitRatio);
            
            graph.addNode(node.key, {
              label: node.attributes.label?.substring(0, 50) || node.key,
              x: normalizedCoords.x,
              y: normalizedCoords.y, 
              size: size,
              color: node.attributes.color || '#4CAF50',
              degree: node.attributes.degree
            });
            
            loadedNodes.current.add(node.key);
          });
          
          setNodeCount(graph.order);
          console.log(`✅ Added ${graph.order} nodes to graph with coordinates spread across full space`);
          
          // Sample coordinates for debugging
          const firstFewNodes = graph.nodes().slice(0, 3);
          firstFewNodes.forEach(nodeId => {
            const attrs = graph.getNodeAttributes(nodeId);
            console.log(`🔍 Node sample: (${attrs.x.toFixed(1)}, ${attrs.y.toFixed(1)})`);
          });
        }
      } catch (error) {
        console.error('Error loading diverse nodes:', error);
      }
    }, 100);
    
  }, [sigma, updateEmbeddingDimensions, normalizeCoordinates, calculateSigmaNodeSize]);

  // DYNAMIC NODE SIZE UPDATES: Update all node sizes when camera changes
  const updateNodeSizesForZoom = useCallback((newRatio: number) => {
    const graph = sigma.getGraph();
    const nodes = graph.nodes();
    
    let updateCount = 0;
    nodes.forEach(nodeId => {
      const nodeAttrs = graph.getNodeAttributes(nodeId);
      const degree = nodeAttrs.degree || 1;
      
      // Recalculate size for current zoom level
      const newSize = calculateSigmaNodeSize(degree, newRatio);
      
      if (Math.abs(nodeAttrs.size - newSize) > 0.1) { // Only update if significant change
        graph.setNodeAttribute(nodeId, 'size', newSize);
        updateCount++;
      }
    });
    
    if (updateCount > 0) {
      console.log(`🔄 Updated ${updateCount} node sizes for zoom ratio ${newRatio.toFixed(3)}`);
    }
  }, [sigma, calculateSigmaNodeSize]);

  // Listen for camera changes to update node sizes
  useEffect(() => {
    const camera = sigma.getCamera();
    
    const handleCameraUpdate = () => {
      const { ratio } = camera.getState();
      updateNodeSizesForZoom(ratio);
    };
    
    // Listen to camera events
    camera.on('updated', handleCameraUpdate);
    
    return () => {
      camera.off('updated', handleCameraUpdate);
    };
  }, [sigma, updateNodeSizesForZoom]);

  // INITIAL SETUP: Set camera to (0,0) when component first loads
  useEffect(() => {
    if (sigma) {
      console.log(`🚀 Component loaded - setting initial camera position...`);
      const camera = sigma.getCamera();
      camera.setState({ x: 0, y: 0, ratio: 0.3 });
      console.log(`📷 Initial camera set to (0, 0) ratio=0.3`);
      
      // Load initial diverse data
      setTimeout(() => {
        resetViewport();
      }, 200);
    }
  }, [sigma, resetViewport]);

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

        {/* DEBUG: Camera state and sizing display */}
        <div style={{
          position: 'absolute',
          top: 120,
          left: 10,
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'monospace',
          zIndex: 1000,
        }}>
          {cameraStateRef.current && (
            <>
              📷 Camera: ({cameraStateRef.current.x.toFixed(1)}, {cameraStateRef.current.y.toFixed(1)}) 
              <br />
              🔍 Zoom: {cameraStateRef.current.ratio.toFixed(3)}
              <br />
              📏 Node: {(() => {
                const sizing = getScreenRelativeSizing();
                return `${sizing.minRadius.toFixed(1)}-${sizing.maxRadius.toFixed(1)}px`;
              })()}
              <br />
              📐 Screen: {(() => {
                const sizing = getScreenRelativeSizing();
                return `${sizing.screenWidth.toFixed(0)}x${sizing.screenHeight.toFixed(0)}`;
              })()}
            </>
          )}
        </div>

                {/* Control panel */}
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
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>
              Max Nodes: <strong>{maxNodes}</strong>
            </label>
            <input
              type="range"
              min="100"
              max="1500"
              step="50"
              value={maxNodes}
              onChange={(e) => setMaxNodes(parseInt(e.target.value))}
              style={{ width: '120px' }}
            />
          </div>
          
          <button
            onClick={resetViewport}
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
            🎯 Reset & Fit All
          </button>
          
          <div style={{ fontSize: '10px', opacity: 0.7 }}>
            Normalized coordinates [-50, 50]
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
        <div>🖱️ <strong>Drag:</strong> Explore different areas</div>
        <div>🔍 <strong>Zoom:</strong> Dynamic sizing & node limits</div>
        <div>⚡ <strong>Streaming:</strong> Gradual loading + auto-removal</div>
        <div>🎛️ <strong>Widget:</strong> Adjust max nodes for performance</div>
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
          minCameraRatio: 0.1,   // Prevent excessive zoom out in normalized space
          maxCameraRatio: 50,    // Allow much more zoom in with normalized coordinates  
          renderEdgeLabels: false,
          defaultEdgeType: 'line',
          // CRITICAL: Prevent auto-adjustment of camera when nodes are added/removed
          autoRescale: false,
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