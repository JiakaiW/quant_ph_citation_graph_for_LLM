import { useEffect, useRef, useState } from "react";
import { SigmaContainer, useLoadGraph, useSigma } from "@react-sigma/core";
import { useViewport } from "../hooks/useViewport";
import { fetchBox, fetchTop, fetchEdges, Node, Edge } from "../api/fetchNodes";
import Graph from "graphology";

export default function GraphContainer() {
  return (
    <div style={{ height: "100%", width: "100%" }}>
      <SigmaContainer 
        graph={Graph}
        className="sigma-container"
        style={{ height: "100%", width: "100%" }}
        settings={{
          nodeProgramClasses: {},
          edgeProgramClasses: {},
          defaultNodeColor: "#999",
          defaultEdgeColor: "#ccc",
          labelDensity: 0.07,
          labelGridCellSize: 60,
          labelRenderedSizeThreshold: 15,
          enableEdgeClickEvents: true,
          enableEdgeWheelEvents: false,
          enableEdgeHoverEvents: false,
          allowInvalidContainer: true, // Prevent container height errors during development
        }}
      >
        <GraphInner />
      </SigmaContainer>
    </div>
  );
}

function GraphInner() {
  const loadGraph = useLoadGraph();
  const sigma = useSigma();
  const viewport = useViewport(sigma);
  const [loadedNodes, setLoadedNodes] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<{ x: number; y: number; ratio: number } | null>(null);

  // Debounce viewport changes
  const viewportTimeoutRef = useRef<NodeJS.Timeout>();

  // Initial top-N load
  useEffect(() => {
    let isMounted = true;
    
    async function loadInitialNodes() {
      console.log('🚀 Starting initial node load...');
      setIsLoading(true);
      try {
        const nodes = await fetchTop(2000);
        console.log(`📊 Fetched ${nodes.length} nodes from API`);
        if (isMounted && nodes.length > 0) {
          // Clear existing graph
          loadGraph.graph.clear();
          
          // Add nodes to graph
          nodes.forEach((node: Node) => {
            loadGraph.graph.addNode(node.key, node.attributes);
          });
          
          // Track loaded nodes
          const nodeKeys = new Set(nodes.map(n => n.key));
          setLoadedNodes(nodeKeys);
          
          // Fetch and add edges for these nodes
          const edges = await fetchEdges(Array.from(nodeKeys), 5000);
          edges.forEach((edge: Edge) => {
            if (loadGraph.graph.hasNode(edge.source) && loadGraph.graph.hasNode(edge.target)) {
              try {
                loadGraph.graph.addEdge(edge.source, edge.target, edge.attributes || {});
              } catch (e) {
                // Edge might already exist, ignore
              }
            }
          });
        }
              } catch (error) {
        console.error('❌ Error loading initial nodes:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadInitialNodes();
    
    return () => {
      isMounted = false;
    };
  }, [loadGraph]);

  // Dynamic fetch on zoom/pan with debouncing
  useEffect(() => {
    if (!viewport || isLoading) return;

    const { x, y, ratio } = viewport;
    
    // Clear existing timeout
    if (viewportTimeoutRef.current) {
      clearTimeout(viewportTimeoutRef.current);
    }

    // Debounce viewport changes
    viewportTimeoutRef.current = setTimeout(async () => {
      // Check if we need to fetch (significant movement or zoom change)
      const lastFetch = lastFetchRef.current;
      if (lastFetch) {
        const distance = Math.sqrt((x - lastFetch.x) ** 2 + (y - lastFetch.y) ** 2);
        const ratioChange = Math.abs(ratio - lastFetch.ratio) / lastFetch.ratio;
        
        // Only fetch if significant movement (> 100 units) or zoom change (> 20%)
        if (distance < 100 && ratioChange < 0.2) {
          return;
        }
      }

      setIsLoading(true);
      lastFetchRef.current = { x, y, ratio };

      try {
        // Convert viewport to world bbox
        const halfW = 800 / ratio;
        const halfH = 600 / ratio;
        
        const newNodes = await fetchBox(
          x - halfW, 
          x + halfW, 
          y - halfH, 
          y + halfH,
          ratio,
          3000
        );

        if (newNodes.length > 0) {
          // Add new nodes that aren't already loaded
          const newNodeKeys: string[] = [];
          newNodes.forEach((node: Node) => {
            if (!loadedNodes.has(node.key)) {
              try {
                loadGraph.graph.addNode(node.key, node.attributes);
                newNodeKeys.push(node.key);
              } catch (e) {
                // Node might already exist
              }
            }
          });

          if (newNodeKeys.length > 0) {
            // Update loaded nodes set
            setLoadedNodes(prev => new Set([...prev, ...newNodeKeys]));
            
            // Fetch edges for new nodes
            const newEdges = await fetchEdges(newNodeKeys, 2000);
            newEdges.forEach((edge: Edge) => {
              if (loadGraph.graph.hasNode(edge.source) && loadGraph.graph.hasNode(edge.target)) {
                try {
                  loadGraph.graph.addEdge(edge.source, edge.target, edge.attributes || {});
                } catch (e) {
                  // Edge might already exist, ignore
                }
              }
            });
          }
        }
      } catch (error) {
        console.error('Error fetching viewport nodes:', error);
      } finally {
        setIsLoading(false);
      }
    }, 300); // 300ms debounce

    return () => {
      if (viewportTimeoutRef.current) {
        clearTimeout(viewportTimeoutRef.current);
      }
    };
  }, [viewport, loadGraph, loadedNodes, isLoading]);

  return (
    <>
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '5px 10px',
          borderRadius: '3px',
          fontSize: '12px',
          zIndex: 1000
        }}>
          Loading...
        </div>
      )}
      
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '5px 10px',
        borderRadius: '3px',
        fontSize: '12px',
        zIndex: 1000
      }}>
        Nodes: {loadedNodes.size} | Edges: {loadGraph.graph?.size || 0}
        {viewport && (
          <>
            <br />
            Zoom: {viewport.ratio.toFixed(2)} | 
            Pos: ({viewport.x.toFixed(0)}, {viewport.y.toFixed(0)})
          </>
        )}
      </div>
    </>
  );
} 