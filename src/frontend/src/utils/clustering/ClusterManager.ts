/**
 * 🎨 Cluster Manager
 * 
 * Manages cluster visibility, filtering, and provides cluster metadata
 * for the citation network visualization.
 */

export interface ClusterInfo {
  id: number;
  name: string;
  color: string;
  nodeCount: number;
  visible: boolean;
  description?: string;
}

export interface ClusterStats {
  totalClusters: number;
  visibleClusters: number;
  totalNodes: number;
  visibleNodes: number;
}

export class ClusterManager {
  private static instance: ClusterManager;
  private clusters: Map<number, ClusterInfo> = new Map();
  private visibilityChangeCallbacks: ((clusterId: number, visible: boolean) => void)[] = [];
  private globalChangeCallbacks: (() => void)[] = [];
  private clustersLoaded: boolean = false;

  private constructor() {
    this.initializeClusters();
    this.loadClusterNamesFromAPI();
  }

  /**
   * Singleton instance getter
   */
  public static getInstance(): ClusterManager {
    if (!ClusterManager.instance) {
      ClusterManager.instance = new ClusterManager();
    }
    return ClusterManager.instance;
  }

  /**
   * Load cluster names and information from the API
   */
  private async loadClusterNamesFromAPI(): Promise<void> {
    try {
      console.log('🎨 ClusterManager: Loading cluster names from API...');
      const response = await fetch('/api/clusters/names');
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      const data = await response.json();
      const apiClusters = data.clusters;
      
      // Update clusters with API data
      Object.entries(apiClusters).forEach(([clusterIdStr, clusterData]: [string, any]) => {
        const clusterId = parseInt(clusterIdStr);
        const existingCluster = this.clusters.get(clusterId);
        
        if (existingCluster) {
          // Update existing cluster with API data
          existingCluster.name = clusterData.name || existingCluster.name;
          existingCluster.description = clusterData.description || existingCluster.description;
          // Keep existing color and visibility settings
        } else {
          // Create new cluster from API data
          this.clusters.set(clusterId, {
            id: clusterId,
            name: clusterData.name || `Cluster ${clusterId}`,
            color: this.generateClusterColor(clusterId),
            nodeCount: clusterData.paper_count || 0,
            visible: true,
            description: clusterData.description || `Research cluster ${clusterId}`
          });
        }
      });
      
      this.clustersLoaded = true;
      console.log(`🎨 ClusterManager: Loaded ${Object.keys(apiClusters).length} cluster names from API`);
      this.notifyGlobalChange();
      
    } catch (error) {
      console.warn('🎨 ClusterManager: Failed to load cluster names from API, using defaults:', error);
      // Keep default clusters if API fails
    }
  }

  /**
   * Generate a consistent color for a cluster ID
   */
  private generateClusterColor(clusterId: number): string {
    const defaultColors = [
      "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", 
      "#1abc9c", "#e67e22", "#34495e", "#f1c40f", "#e91e63",
      "#00bcd4", "#4caf50", "#ff9800", "#673ab7", "#795548", "#607d8b"
    ];
    
    return defaultColors[clusterId % defaultColors.length] || `hsl(${(clusterId * 360 / 16)}, 70%, 50%)`;
  }

  /**
   * Initialize clusters with default data
   * This will be populated with real cluster data from the API
   */
  private initializeClusters(): void {
    // Default cluster names based on quantum physics topics
    const defaultClusterNames = [
      "Quantum Computing",
      "Quantum Information",
      "Quantum Optics", 
      "Condensed Matter",
      "Quantum Field Theory",
      "Quantum Mechanics",
      "Superconductivity",
      "Quantum Entanglement",
      "Quantum Cryptography",
      "Quantum Algorithms",
      "Quantum Error Correction",
      "Quantum Simulation",
      "Quantum Metrology",
      "Quantum Materials",
      "Quantum Foundations",
      "Quantum Networks"
    ];

    // Initialize 16 clusters (as per API stats)
    for (let i = 0; i < 16; i++) {
      this.clusters.set(i, {
        id: i,
        name: defaultClusterNames[i] || `Cluster ${i}`,
        color: this.generateClusterColor(i),
        nodeCount: 0, // Will be updated when nodes are loaded
        visible: true, // All clusters visible by default
        description: `Research cluster ${i} in quantum physics`
      });
    }

    console.log('🎨 ClusterManager: Initialized with 16 clusters');
  }

  /**
   * Update cluster information from loaded nodes
   */
  public updateClusterInfo(nodes: Array<{community: number, color?: string}>): void {
    // Reset node counts
    this.clusters.forEach(cluster => cluster.nodeCount = 0);

    // Count nodes per cluster and update colors
    const clusterColors = new Map<number, string>();
    
    nodes.forEach(node => {
      const clusterId = node.community;
      if (this.clusters.has(clusterId)) {
        const cluster = this.clusters.get(clusterId)!;
        cluster.nodeCount++;
        
        // Update cluster color based on node color (most common color wins)
        if (node.color && !clusterColors.has(clusterId)) {
          clusterColors.set(clusterId, node.color);
        }
      }
    });

    // Update cluster colors
    clusterColors.forEach((color, clusterId) => {
      const cluster = this.clusters.get(clusterId);
      if (cluster) {
        cluster.color = color;
      }
    });

    console.log(`🎨 ClusterManager: Updated cluster info for ${nodes.length} nodes`);
    this.notifyGlobalChange();
  }

  /**
   * Get all clusters
   */
  public getClusters(): ClusterInfo[] {
    return Array.from(this.clusters.values()).sort((a, b) => a.id - b.id);
  }

  /**
   * Get cluster by ID
   */
  public getCluster(clusterId: number): ClusterInfo | undefined {
    return this.clusters.get(clusterId);
  }

  /**
   * Check if cluster is visible
   */
  public isClusterVisible(clusterId: number): boolean {
    const cluster = this.clusters.get(clusterId);
    return cluster ? cluster.visible : true;
  }

  /**
   * Set cluster visibility
   */
  public setClusterVisibility(clusterId: number, visible: boolean): void {
    const cluster = this.clusters.get(clusterId);
    if (cluster && cluster.visible !== visible) {
      cluster.visible = visible;
      console.log(`🎨 ClusterManager: Cluster ${clusterId} (${cluster.name}) ${visible ? 'shown' : 'hidden'}`);
      this.notifyVisibilityChange(clusterId, visible);
      this.notifyGlobalChange();
    }
  }

  /**
   * Toggle cluster visibility
   */
  public toggleCluster(clusterId: number): void {
    const cluster = this.clusters.get(clusterId);
    if (cluster) {
      this.setClusterVisibility(clusterId, !cluster.visible);
    }
  }

  /**
   * Show all clusters
   */
  public showAllClusters(): void {
    let changed = false;
    this.clusters.forEach((cluster) => {
      if (!cluster.visible) {
        cluster.visible = true;
        changed = true;
      }
    });
    
    if (changed) {
      console.log('🎨 ClusterManager: All clusters shown');
      this.notifyGlobalChange();
    }
  }

  /**
   * Hide all clusters
   */
  public hideAllClusters(): void {
    let changed = false;
    this.clusters.forEach((cluster) => {
      if (cluster.visible) {
        cluster.visible = false;
        changed = true;
      }
    });
    
    if (changed) {
      console.log('🎨 ClusterManager: All clusters hidden');
      this.notifyGlobalChange();
    }
  }

  /**
   * Get cluster statistics
   */
  public getStats(): ClusterStats {
    const visibleClusters = Array.from(this.clusters.values()).filter(c => c.visible);
    const totalNodes = Array.from(this.clusters.values()).reduce((sum, c) => sum + c.nodeCount, 0);
    const visibleNodes = visibleClusters.reduce((sum, c) => sum + c.nodeCount, 0);

    return {
      totalClusters: this.clusters.size,
      visibleClusters: visibleClusters.length,
      totalNodes,
      visibleNodes
    };
  }

  /**
   * Get visible cluster IDs
   */
  public getVisibleClusterIds(): Set<number> {
    const visibleIds = new Set<number>();
    this.clusters.forEach((cluster, clusterId) => {
      if (cluster.visible) {
        visibleIds.add(clusterId);
      }
    });
    return visibleIds;
  }

  /**
   * Filter nodes based on cluster visibility
   */
  public filterNodesByCluster<T extends {community: number}>(nodes: T[]): T[] {
    const visibleClusters = this.getVisibleClusterIds();
    return nodes.filter(node => visibleClusters.has(node.community));
  }

  /**
   * Register callback for cluster visibility changes
   */
  public onVisibilityChange(callback: (clusterId: number, visible: boolean) => void): void {
    this.visibilityChangeCallbacks.push(callback);
  }

  /**
   * Register callback for global cluster changes
   */
  public onGlobalChange(callback: () => void): void {
    this.globalChangeCallbacks.push(callback);
  }

  /**
   * Remove callback
   */
  public removeVisibilityChangeCallback(callback: (clusterId: number, visible: boolean) => void): void {
    const index = this.visibilityChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.visibilityChangeCallbacks.splice(index, 1);
    }
  }

  /**
   * Remove global change callback
   */
  public removeGlobalChangeCallback(callback: () => void): void {
    const index = this.globalChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.globalChangeCallbacks.splice(index, 1);
    }
  }

  /**
   * Notify listeners of visibility change
   */
  private notifyVisibilityChange(clusterId: number, visible: boolean): void {
    this.visibilityChangeCallbacks.forEach(callback => {
      try {
        callback(clusterId, visible);
      } catch (error) {
        console.error('Error in visibility change callback:', error);
      }
    });
  }

  /**
   * Notify listeners of global change
   */
  private notifyGlobalChange(): void {
    this.globalChangeCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in global change callback:', error);
      }
    });
  }

  /**
   * Export cluster settings (for saving user preferences)
   */
  public exportSettings(): Record<number, boolean> {
    const settings: Record<number, boolean> = {};
    this.clusters.forEach((cluster, clusterId) => {
      settings[clusterId] = cluster.visible;
    });
    return settings;
  }

  /**
   * Import cluster settings (for loading user preferences)
   */
  public importSettings(settings: Record<number, boolean>): void {
    let changed = false;
    Object.entries(settings).forEach(([clusterIdStr, visible]) => {
      const clusterId = parseInt(clusterIdStr);
      const cluster = this.clusters.get(clusterId);
      if (cluster && cluster.visible !== visible) {
        cluster.visible = visible;
        changed = true;
      }
    });

    if (changed) {
      console.log('🎨 ClusterManager: Imported cluster settings');
      this.notifyGlobalChange();
    }
  }

  /**
   * Refresh cluster names from API
   */
  public async refreshClusterNames(): Promise<void> {
    console.log('🎨 ClusterManager: Refreshing cluster names...');
    await this.loadClusterNamesFromAPI();
  }

  /**
   * Check if cluster names have been loaded from API
   */
  public areClusterNamesLoaded(): boolean {
    return this.clustersLoaded;
  }
} 