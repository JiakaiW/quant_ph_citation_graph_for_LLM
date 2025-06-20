// Wait for the DOM to be ready
document.addEventListener("DOMContentLoaded", () => {
    const sigmaContainer = document.getElementById("sigma-container");
    const loader = document.getElementById("loader");
    const statsElement = document.getElementById("graph-stats");
    const nodeInfoPanel = document.getElementById("node-info-panel");

    let renderer;
    let graph;

    async function loadGraphData() {
        console.log("Fetching graph data from API...");
        loader.style.display = "block";
        sigmaContainer.style.opacity = 0.5;

        try {
            const response = await fetch(`/api/graph-data?limit=2000`);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const graphData = await response.json();

            console.log("Data loaded, rendering graph...");
            graph = new graphology.Graph();
            graph.import(graphData);

            if (renderer) {
                renderer.kill();
            }
            
            renderer = new Sigma(graph, sigmaContainer, {
                allowInvalidContainer: true,
                defaultNodeType: "circle",
                defaultEdgeType: "line",
                labelRenderedSizeThreshold: 12,
                edgeReducer: (edge, data) => ({ ...data, hidden: false }),
            });
            
            setupInteractivity();
            updateUIAfterLoad();

        } catch (error) {
            console.error("Error loading graph data:", error);
            sigmaContainer.innerHTML = `<p style="color: red; padding: 20px;">Could not load graph data. Please check the console and ensure the backend server is running.</p>`;
        } finally {
            loader.style.display = "none";
            sigmaContainer.style.opacity = 1;
        }
    }

    function setupInteractivity() {
        let hoveredNode = null;
        let selectedNode = null;

        renderer.on("enterNode", ({ node }) => {
            hoveredNode = node;
            document.body.style.cursor = "pointer";
            renderer.refresh();
        });

        renderer.on("leaveNode", () => {
            hoveredNode = null;
            document.body.style.cursor = "default";
            renderer.refresh();
        });
        
        renderer.on("clickNode", ({ node }) => {
            selectedNode = (selectedNode === node) ? null : node;
            updateNodeInfoPanel(selectedNode);
            renderer.refresh();
        });

        renderer.setSetting("nodeReducer", (node, data) => {
            const isSelected = (node === selectedNode);
            const isHovered = (node === hoveredNode);
            const isNeighbor = selectedNode && graph.hasEdge(selectedNode, node);

            let color = data.color;
            let highlighted = isSelected || isHovered || isNeighbor;
            
            if (selectedNode && !highlighted) {
                color = "#f0f2f5"; // Dim non-selected/non-neighbor nodes
            }
            
            return { ...data, color, zIndex: highlighted ? 1 : 0 };
        });

        renderer.setSetting("edgeReducer", (edge, data) => {
            let hidden = false;
            if (selectedNode && !graph.hasExtremity(edge, selectedNode)) {
                hidden = true;
            }
            return { ...data, hidden };
        });
    }

    function updateNodeInfoPanel(node) {
        if (node) {
            nodeInfoPanel.style.display = "block";
            const attrs = graph.getNodeAttributes(node);
            document.getElementById("node-id").textContent = node;
            document.getElementById("node-title").textContent = attrs.label;
            document.getElementById("node-community").textContent = attrs.community;
            document.getElementById("node-degree").textContent = attrs.degree;
        } else {
            nodeInfoPanel.style.display = "none";
        }
    }

    function updateUIAfterLoad() {
        // Update stats
        statsElement.textContent = `Displaying ${graph.order} papers and ${graph.size} citations.`;

        // Populate community filter
        const communities = new Set();
        graph.forEachNode((_, attrs) => communities.add(attrs.community));
        const sortedCommunities = Array.from(communities).sort((a, b) => a - b);
        
        const filterDropdown = document.getElementById("community-filter");
        filterDropdown.innerHTML = `<option value="all">Show All Communities</option>`; // Reset
        sortedCommunities.forEach(communityId => {
            const option = document.createElement("option");
            option.value = communityId;
            option.textContent = `Community ${communityId}`;
            filterDropdown.appendChild(option);
        });
    }

    // Initial load
    loadGraphData();
}); 