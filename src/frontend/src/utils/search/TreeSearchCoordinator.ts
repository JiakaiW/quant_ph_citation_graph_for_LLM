import { TreeNodeService } from '../services/TreeNodeService';
import { TreeEdgeService } from '../services/TreeEdgeService';
import { TreeApiClient } from '../api/TreeApiClient';
import { TreeStateManagerImpl } from '../core/TreeStateManager';

// Assuming SearchResult is defined elsewhere, or we can define a placeholder
interface SearchResult {
  nodeId: string;
}

export class TreeSearchCoordinator {
  constructor(
    private treeNodeService: TreeNodeService,
    private treeEdgeService: TreeEdgeService,
    private apiClient: TreeApiClient,
    private treeStateManager: TreeStateManagerImpl,
  ) {}

  async loadSearchResultWithConnectivity(
    searchResult: SearchResult,
  ): Promise<void> {
    const nodeId = searchResult.nodeId;

    // Step 1: Check if node is already loaded and connected
    if (this.isNodeLoadedAndConnected(nodeId)) {
      return; // Already have connected version
    }

    // Step 2: Find tree path from search result to any loaded root
    const pathToLoadedTree = await this.findPathToLoadedTree(nodeId);

    if (pathToLoadedTree.length > 0) {
      // Step 3a: Load the connecting path
      await this.loadTreePath(pathToLoadedTree);
    } else {
      // Step 3b: Load tree fragment around search result
      await this.loadTreeFragmentAroundNode(nodeId);
    }

    // Step 4: Load immediate tree neighbors for context
    const treeNeighbors = await this.loadTreeNeighbors(nodeId, 1);

    // Step 5: Optionally load extra edges for enrichment
    await this.loadExtraEdgesForNeighbors(treeNeighbors);
  }

  private async findPathToLoadedTree(nodeId: string): Promise<string[]> {
    // Backend query: Find shortest tree path from nodeId to any currently loaded node
    const response = await this.apiClient.findTreePath({
      startNodeId: nodeId,
      targetNodeIds: this.treeNodeService.getLoadedNodeIds(),
      maxPathLength: 10, // Reasonable limit
    });

    return response.path || [];
  }

  private async loadTreeFragmentAroundNode(nodeId: string): Promise<void> {
    // Load a small tree fragment centered on the search result
    const response = await this.apiClient.getTreeFragmentAroundNode({
      centerNodeId: nodeId,
      radius: 2, // 2 levels up and down in the tree
      maxNodes: 50,
    });

    await this.treeNodeService.addTreeFragment(response);
  }

  private isNodeLoadedAndConnected(nodeId: string): boolean {
    if (!this.treeNodeService.hasNode(nodeId)) return false;

    // Check if node has path to root through loaded tree edges
    const pathToRoot = this.treeStateManager.getTreePathToRoot(nodeId);
    return pathToRoot.length > 0;
  }

  // Placeholder for methods that will be implemented later
  private async loadTreePath(path: string[]): Promise<void> {
    console.log('loadTreePath not implemented', path);
  }
  private async loadTreeNeighbors(
    nodeId: string,
    depth: number,
  ): Promise<string[]> {
    console.log('loadTreeNeighbors not implemented', nodeId, depth);
    return [];
  }
  private async loadExtraEdgesForNeighbors(nodeIds: string[]): Promise<void> {
    console.log('loadExtraEdgesForNeighbors not implemented', nodeIds);
  }
} 