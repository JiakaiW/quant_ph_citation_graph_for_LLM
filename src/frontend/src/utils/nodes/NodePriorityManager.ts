/**
 * 🎯 Node Priority Manager
 * 
 * Efficient data structure for managing nodes with priority-based removal.
 * Uses a combination of Min-Heap and Hash Map for O(log n) insertion/removal
 * and O(1) lookup by node ID.
 */

export interface NodePriorityInfo {
  nodeId: string;
  degree: number;
  distanceFromCenter: number;
  lastSeen: number;
  lodLevel: number;
  importance: number; // Calculated priority score
  heapIndex?: number; // For efficient heap operations
}

export class NodePriorityManager {
  private heap: NodePriorityInfo[] = []; // Min-heap (lowest priority at root)
  private nodeMap: Map<string, NodePriorityInfo> = new Map(); // Fast lookup
  private maxNodes: number;
  
  constructor(maxNodes: number = 10000) {
    this.maxNodes = maxNodes;
  }

  /**
   * Add or update a node's priority information
   */
  addNode(nodeInfo: Omit<NodePriorityInfo, 'importance' | 'heapIndex'>): void {
    const importance = this.calculateImportance(nodeInfo);
    const fullNodeInfo: NodePriorityInfo = {
      ...nodeInfo,
      importance,
      lastSeen: Date.now()
    };

    // If node already exists, update it
    if (this.nodeMap.has(nodeInfo.nodeId)) {
      this.updateNode(fullNodeInfo);
    } else {
      // Add new node
      this.insertNode(fullNodeInfo);
    }

    // Maintain size limit
    this.enforceMaxSize();
  }

  /**
   * Get nodes to remove (lowest priority first)
   */
  getNodesForRemoval(count: number): string[] {
    const nodesToRemove: string[] = [];
    
    // Get the lowest priority nodes
    for (let i = 0; i < Math.min(count, this.heap.length); i++) {
      const node = this.heap[0]; // Root is always minimum
      if (node) {
        nodesToRemove.push(node.nodeId);
        this.removeNode(node.nodeId);
      }
    }
    
    return nodesToRemove;
  }

  /**
   * Remove a specific node
   */
  removeNode(nodeId: string): boolean {
    const nodeInfo = this.nodeMap.get(nodeId);
    if (!nodeInfo || nodeInfo.heapIndex === undefined) {
      return false;
    }

    // Remove from heap
    this.removeFromHeap(nodeInfo.heapIndex);
    
    // Remove from map
    this.nodeMap.delete(nodeId);
    
    return true;
  }

  /**
   * Get current node count
   */
  getNodeCount(): number {
    return this.heap.length;
  }

  /**
   * Check if node exists
   */
  hasNode(nodeId: string): boolean {
    return this.nodeMap.has(nodeId);
  }

  /**
   * Get node priority info
   */
  getNodeInfo(nodeId: string): NodePriorityInfo | undefined {
    return this.nodeMap.get(nodeId);
  }

  /**
   * Update node's last seen timestamp (for LRU behavior)
   */
  touchNode(nodeId: string): void {
    const nodeInfo = this.nodeMap.get(nodeId);
    if (nodeInfo) {
      nodeInfo.lastSeen = Date.now();
      nodeInfo.importance = this.calculateImportance(nodeInfo);
      this.updateNode(nodeInfo);
    }
  }

  /**
   * Get nodes by LOD level for bulk operations
   */
  getNodesByLOD(lodLevel: number): string[] {
    return Array.from(this.nodeMap.values())
      .filter(node => node.lodLevel === lodLevel)
      .map(node => node.nodeId);
  }

  /**
   * Clear all nodes
   */
  clear(): void {
    this.heap = [];
    this.nodeMap.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalNodes: number;
    byLOD: Record<number, number>;
    avgImportance: number;
    memoryUsage: number;
  } {
    const byLOD: Record<number, number> = {};
    let totalImportance = 0;
    
    this.heap.forEach(node => {
      byLOD[node.lodLevel] = (byLOD[node.lodLevel] || 0) + 1;
      totalImportance += node.importance;
    });
    
    return {
      totalNodes: this.heap.length,
      byLOD,
      avgImportance: this.heap.length > 0 ? totalImportance / this.heap.length : 0,
      memoryUsage: this.heap.length * 100 // Rough estimate in bytes
    };
  }

  // ===== PRIVATE METHODS =====

  /**
   * Calculate node importance score (higher = more important)
   */
  private calculateImportance(node: Omit<NodePriorityInfo, 'importance'>): number {
    const now = Date.now();
    const timeSinceLastSeen = now - node.lastSeen;
    
    // Factors for importance calculation
    const degreeWeight = 0.4;
    const distanceWeight = 0.3;
    const recencyWeight = 0.2;
    const lodWeight = 0.1;
    
    // Normalize degree (0-1, higher degree = higher importance)
    const degreeScore = Math.min(node.degree / 100, 1.0);
    
    // Normalize distance (0-1, closer to center = higher importance)
    const distanceScore = Math.max(0, 1 - (node.distanceFromCenter / 100));
    
    // Recency score (0-1, more recent = higher importance)
    const maxAge = 300000; // 5 minutes
    const recencyScore = Math.max(0, 1 - (timeSinceLastSeen / maxAge));
    
    // LOD score (higher LOD = lower importance for removal)
    const lodScore = (3 - node.lodLevel) / 3; // LOD 0 = 1.0, LOD 3 = 0.0
    
    return (
      degreeScore * degreeWeight +
      distanceScore * distanceWeight +
      recencyScore * recencyWeight +
      lodScore * lodWeight
    );
  }

  /**
   * Insert new node into heap
   */
  private insertNode(node: NodePriorityInfo): void {
    // Add to end of heap
    node.heapIndex = this.heap.length;
    this.heap.push(node);
    this.nodeMap.set(node.nodeId, node);
    
    // Bubble up to maintain heap property
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * Update existing node in heap
   */
  private updateNode(node: NodePriorityInfo): void {
    const existingNode = this.nodeMap.get(node.nodeId);
    if (!existingNode || existingNode.heapIndex === undefined) {
      return;
    }
    
    const oldImportance = existingNode.importance;
    
    // Update the node in place
    Object.assign(existingNode, node);
    this.heap[existingNode.heapIndex] = existingNode;
    
    // Restore heap property
    if (node.importance < oldImportance) {
      this.bubbleUp(existingNode.heapIndex);
    } else if (node.importance > oldImportance) {
      this.bubbleDown(existingNode.heapIndex);
    }
  }

  /**
   * Remove node from heap by index
   */
  private removeFromHeap(index: number): void {
    if (index >= this.heap.length) return;
    
    // Replace with last element
    const lastNode = this.heap[this.heap.length - 1];
    this.heap[index] = lastNode;
    lastNode.heapIndex = index;
    this.heap.pop();
    
    // Restore heap property if not empty
    if (this.heap.length > index) {
      this.bubbleDown(index);
      this.bubbleUp(index);
    }
  }

  /**
   * Bubble node up to maintain min-heap property
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];
      const current = this.heap[index];
      
      if (current.importance >= parent.importance) break;
      
      // Swap
      this.heap[parentIndex] = current;
      this.heap[index] = parent;
      current.heapIndex = parentIndex;
      parent.heapIndex = index;
      
      index = parentIndex;
    }
  }

  /**
   * Bubble node down to maintain min-heap property
   */
  private bubbleDown(index: number): void {
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;
      
      if (leftChild < this.heap.length && 
          this.heap[leftChild].importance < this.heap[smallest].importance) {
        smallest = leftChild;
      }
      
      if (rightChild < this.heap.length && 
          this.heap[rightChild].importance < this.heap[smallest].importance) {
        smallest = rightChild;
      }
      
      if (smallest === index) break;
      
      // Swap
      const temp = this.heap[index];
      this.heap[index] = this.heap[smallest];
      this.heap[smallest] = temp;
      
      // Update heap indices
      this.heap[index].heapIndex = index;
      this.heap[smallest].heapIndex = smallest;
      
      index = smallest;
    }
  }

  /**
   * Enforce maximum node count by removing lowest priority nodes
   */
  private enforceMaxSize(): void {
    const excessCount = this.heap.length - this.maxNodes;
    if (excessCount > 0) {
      const nodesToRemove = this.getNodesForRemoval(excessCount);
      console.log(`🧹 NodePriorityManager: Removed ${nodesToRemove.length} excess nodes (max: ${this.maxNodes})`);
    }
  }
} 