export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface LoadedRegion {
  bounds: ViewportBounds;
  timestamp: number;
  nodeCount: number;
  lodLevel: number; // 0=max detail, 5=overview
  spatialHash: string; // For fast spatial lookups
}

export interface NodeImportance {
  nodeId: string;
  degree: number;
  distanceFromCenter: number;
  lastSeen: number;
  importance: number;
  lodLevel: number; // Track which LOD level this node belongs to
}

export interface QuadTreeNode {
  bounds: ViewportBounds;
  nodeIds: Set<string>;
  children: QuadTreeNode[] | null;
  level: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  cacheRegions: number;
  isLoading: boolean;
  batchProgress: {current: number, total: number} | null;
}

export interface LODConfiguration {
  MAX_NODES_BY_LOD: Record<number, number>;
  MIN_DEGREE_BY_LOD: Record<number, number>;
  VIEWPORT_OVERLAP_THRESHOLD: number;
  CACHE_TTL: number;
}

export const DEFAULT_LOD_CONFIG: LODConfiguration = {
  MAX_NODES_BY_LOD: {
    0: 1000,  // Detailed: high quality, fewer nodes
    1: 2500,  // Normal: balanced view
    2: 1500   // Overview: sparse sampling for performance
  },
  MIN_DEGREE_BY_LOD: {
    0: 1,     // Show all nodes in detailed view
    1: 2,     // Light filtering in normal view
    2: 10     // Only well-connected nodes in overview
  },
  VIEWPORT_OVERLAP_THRESHOLD: 0.5, // 50% overlap = cache hit
  CACHE_TTL: 10000 // 10 seconds for better caching
};

// Loading and API related types
export interface BatchProgress {
  current: number;
  total: number;
}

export interface LoadResult {
  nodes: any[];
  addedCount: number;
  filteredCount: number;
  skippedCount: number;
}

export interface EdgeLoadResult {
  edges: any[];
  addedCount: number;
  skippedCount: number;
}

export interface RemovalStats {
  removedCount: number;
  removedViewport: number;
  removedNonViewport: number;
}

export interface MemoryStats {
  totalNodes: number;
  viewportNodes: number;
  nonViewportNodes: number;
  avgImportance: number;
  memoryPressure: number;
}

export interface CacheStats {
  totalRegions: number;
  avgAge: number;
  oldestAge: number;
  hitRate: number;
  missRate: number;
}

export interface CategoryResult {
  viewportNodes: string[];
  nonViewportNodes: string[];
}

// Additional types for GraphInitializer and configuration
export interface InitializationResult {
  success: boolean;
  bounds: ViewportBounds | null;
  initialViewport: ViewportBounds | null;
  config: GraphConfig | null;
  error: string | null;
}

export interface GraphConfig {
  lodConfig: LODConfiguration;
  memoryConfig: MemoryConfiguration;
  viewportConfig: ViewportConfiguration;
  cacheConfig: CacheConfiguration;
}

export interface MemoryConfiguration {
  maxNodes: number;
  maxEdges: number;
  cleanupThreshold: number;
  aggressiveCleanup: boolean;
}

export interface ViewportConfiguration {
  initialBounds?: ViewportBounds;
  dataBounds?: ViewportBounds;
  paddingFactor: number;
  minZoomLevel: number;
  maxZoomLevel: number;
}

export interface CacheConfiguration {
  spatialHashSize: number;
  maxCacheAge: number;
  maxCacheRegions: number;
  enableSpatialHashing: boolean;
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  lodConfig: DEFAULT_LOD_CONFIG,
  memoryConfig: {
    maxNodes: 10000,
    maxEdges: 20000,
    cleanupThreshold: 0.8,
    aggressiveCleanup: false,
  },
  viewportConfig: {
    paddingFactor: 0.1,
    minZoomLevel: 0.01,
    maxZoomLevel: 10.0,
  },
  cacheConfig: {
    spatialHashSize: 50,
    maxCacheAge: 30000,
    maxCacheRegions: 100,
    enableSpatialHashing: true,
  }
}; 