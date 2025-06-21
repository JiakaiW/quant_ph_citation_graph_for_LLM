import React, { useEffect, useState } from 'react';
import { SigmaContainer, useSigma } from "@react-sigma/core";
import { fetchTop, fetchEdges, fetchEdgesBatch, Node, Edge } from '../api/fetchNodes';

// Enhanced GraphInner component with edge loading and smart loading states
function GraphInner() {
  const sigma = useSigma();
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [loadedNodes, setLoadedNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadGraphDataIncrementally() {
      console.log('🚀 Starting incremental graph loading...');
      setLoading(true);
      
      try {
        const graph = sigma.getGraph();
        graph.clear();
        
        // Stage 1: Load nodes in small batches for responsive UI
        setLoadingStage('Loading top nodes in batches...');
        
        const BATCH_SIZE = 30; // Small batches to prevent UI blocking
        const MAX_NODES = 150; // Reduced total to avoid HTTP 431
        const allNodes: Node[] = [];
        
        // Load all nodes first (to know total count)
        const totalNodes = await fetchTop(MAX_NODES);
        console.log(`📊 Will load ${totalNodes.length} nodes in batches of ${BATCH_SIZE}`);
        
        // Process nodes in batches
        for (let i = 0; i < totalNodes.length; i += BATCH_SIZE) {
          const batch = totalNodes.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(totalNodes.length / BATCH_SIZE);
          
          setLoadingStage(`Adding nodes (batch ${batchNum}/${totalBatches})...`);
          
          // Add batch to graph
          batch.forEach((node: Node) => {
            graph.addNode(node.key, {
              label: node.attributes.label?.substring(0, 50) || node.key,
              x: node.attributes.x,
              y: node.attributes.y,
              size: Math.max(3, Math.log(node.attributes.degree + 1) * 2.5),
              color: node.attributes.color || '#4CAF50',
              community: node.attributes.community,
              degree: node.attributes.degree,
            });
          });
          
          allNodes.push(...batch);
          setNodeCount(graph.order);
          
          // Small delay to allow UI to update (non-blocking)
          await new Promise(resolve => setTimeout(resolve, 50));
          
          console.log(`✅ Batch ${batchNum}/${totalBatches}: Added ${batch.length} nodes (total: ${graph.order})`);
        }
        
        const nodeKeys = allNodes.map(n => n.key);
        setLoadedNodes(new Set(nodeKeys));
        console.log(`✅ Node loading complete: ${graph.order} nodes`);
        
        // Stage 2: Load edges progressively
        setLoadingStage('Loading citation connections...');
        console.log(`🔗 Requesting edges for ${nodeKeys.length} nodes...`);
        
        try {
          // Use new batch API (fixes HTTP 431)
          const edges = await fetchEdgesBatch(nodeKeys, 3000, "all");
          console.log(`🔗 Received ${edges.length} edges from API`);
          
          if (edges.length > 0) {
            setLoadingStage('Drawing citation connections...');
            
            // Add edges in batches for smooth rendering
            const EDGE_BATCH_SIZE = 50;
            let addedEdges = 0;
            let skippedEdges = 0;
            
            for (let i = 0; i < edges.length; i += EDGE_BATCH_SIZE) {
              const edgeBatch = edges.slice(i, i + EDGE_BATCH_SIZE);
              const edgeBatchNum = Math.floor(i / EDGE_BATCH_SIZE) + 1;
              const totalEdgeBatches = Math.ceil(edges.length / EDGE_BATCH_SIZE);
              
              edgeBatch.forEach((edge: Edge) => {
                if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
                  try {
                    graph.addEdge(edge.source, edge.target, {
                      ...edge.attributes,
                      color: '#cccccc',
                      size: 1,
                    });
                    addedEdges++;
                  } catch (e) {
                    skippedEdges++;
                  }
                } else {
                  skippedEdges++;
                }
              });
              
              setEdgeCount(graph.size);
              
              // Update progress for large edge sets
              if (totalEdgeBatches > 3) {
                setLoadingStage(`Drawing edges (${edgeBatchNum}/${totalEdgeBatches})...`);
              }
              
              // Small delay for smooth rendering
              if (i % (EDGE_BATCH_SIZE * 3) === 0) {
                await new Promise(resolve => setTimeout(resolve, 20));
              }
            }
            
            console.log(`✅ Edge loading complete: ${graph.size} edges displayed`);
            console.log(`📊 Edge stats: ${addedEdges} added, ${skippedEdges} skipped`);
          }
          
        } catch (edgeError) {
          console.error('❌ Error loading edges:', edgeError);
          setLoadingStage('Edges failed to load - continuing with nodes only');
          setTimeout(() => setLoadingStage(''), 2000);
        }
        
        setLoadingStage('Graph loading complete!');
        console.log(`🎉 Graph complete: ${graph.order} nodes, ${graph.size} edges`);
        
      } catch (error) {
        console.error('❌ Error loading graph data:', error);
        setLoadingStage('Error loading data - please refresh');
      } finally {
        setLoading(false);
        setTimeout(() => setLoadingStage(''), 1000);
      }
    }

    loadGraphDataIncrementally();
  }, [sigma]);

  return (
    <>
      {/* Enhanced Loading Indicator */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(0,0,0,0.85)',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 1000,
        minWidth: '280px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}>
        {loading ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid #333',
                borderTop: '2px solid #4CAF50',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginRight: '8px'
              }} />
              <span>{loadingStage || 'Loading...'}</span>
            </div>
            <div style={{ 
              width: '100%', 
              height: '3px', 
              background: 'rgba(255,255,255,0.2)', 
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: '70%',
                height: '100%',
                background: 'linear-gradient(90deg, #4CAF50, #66BB6A)',
                borderRadius: '2px',
                animation: 'loading-progress 2s ease-in-out infinite'
              }} />
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '4px' }}>
              📊 <strong>Nodes:</strong> <span style={{color: '#4CAF50'}}>{nodeCount}</span> | 
              🔗 <strong>Edges:</strong> <span style={{color: '#66BB6A'}}>{edgeCount}</span>
            </div>
            <small style={{ opacity: 0.7, fontSize: '11px' }}>
              🎯 Top {loadedNodes.size} most cited papers • Mouse wheel to zoom
            </small>
          </div>
        )}
      </div>

      {/* Instructions overlay when not loading */}
      {!loading && nodeCount > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          zIndex: 1000,
          maxWidth: '200px'
        }}>
          <div>🖱️ <strong>Drag:</strong> Pan around</div>
          <div>🔍 <strong>Scroll:</strong> Zoom in/out</div>
          <div>📊 <strong>Colors:</strong> Research clusters</div>
        </div>
      )}
    </>
  );
}

// Main Graph Container with performance optimizations
export default function GraphContainer() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SigmaContainer
        style={{ width: '100%', height: '100%' }}
        settings={{
          allowInvalidContainer: true,
          defaultNodeColor: '#4CAF50',
          defaultEdgeColor: '#cccccc',
          labelDensity: 0.05,
          labelRenderedSizeThreshold: 12,
          labelFont: 'system-ui, -apple-system, sans-serif',
          labelSize: 12,
          labelWeight: '500',
          // Performance optimizations WITHOUT hiding elements (no more flickering!)
          enableEdgeEvents: true,
          // Visual improvements for smooth interaction
          minCameraRatio: 0.1,
          maxCameraRatio: 10,
        }}
      >
        <GraphInner />
      </SigmaContainer>
      
      {/* CSS Animations */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes loading-progress {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(0%); }
            100% { transform: translateX(100%); }
          }
        `
      }} />
    </div>
  );
} 