import { TreeFragmentResponse } from "../types";

// This is a placeholder implementation of the TreeApiClient.
// It will be expanded in later phases to make actual API calls.

export class TreeApiClient {
    async findTreePath(request: {
        startNodeId: string;
        targetNodeIds: string[];
        maxPathLength: number;
    }): Promise<{ path: string[] }> {
        console.log("findTreePath called with", request);
        return { path: [] };
    }

    async getTreeFragmentAroundNode(request: {
        centerNodeId: string;
        radius: number;
        maxNodes: number;
    }): Promise<TreeFragmentResponse> {
        console.log("getTreeFragmentAroundNode called with", request);
        return {
            nodes: [],
            tree_edges: [],
            broken_edges: [],
            tree_stats: { nodeCount: 0, edgeCount: 0 },
            hasMore: false,
        };
    }
} 