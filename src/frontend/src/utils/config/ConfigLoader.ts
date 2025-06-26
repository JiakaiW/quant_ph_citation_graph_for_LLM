import * as yaml from 'js-yaml';

/**
 * 🎛️ Configuration Loader
 * 
 * Centralized configuration management system that loads settings from config.yaml
 * and provides type-safe access to all visual and behavioral constants.
 */

// ===== THEME INTERFACES =====

export interface ThemeColorPalette {
  // Canvas/background colors
  canvasBackground: string;
  bodyBackground: string;
  
  // Panel backgrounds
  panelBackground: string;
  panelBackgroundSecondary: string;
  headerBackground: string;
  
  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  
  // Border colors
  borderPrimary: string;
  borderSecondary: string;
  borderAccent: string;
  
  // Graph edge colors
  edgeColor: string;
  
  // Status/accent colors
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface ThemeConfig {
  defaultMode: 'light' | 'dark' | 'auto';
  light: ThemeColorPalette;
  dark: ThemeColorPalette;
}

// ===== CONFIGURATION INTERFACES =====

export interface VisualConfig {
  nodes: {
    defaultSize: number;
    defaultColor: string;
    minSize: number;
    maxSize: number;
    minSpacing: number;
    overlapBehavior: 'none' | 'jitter' | 'spread';
  };
  edges: {
    defaultSize: number;
    defaultColor: string;
    minSize: number;
    maxSize: number;
  };
  labels: {
    enabled: boolean;
    renderThreshold: number;
    hideOnMove: boolean;
    density: number;
    gridCellSize: number;
    sizeThreshold: number;
  };
  search: {
    focusNodeColor: string;
    focusNodeSize: number;
    neighborNodeColor: string;
    neighborNodeSize: number;
    focusEdgeColor: string;
    focusEdgeSize: number;
  };
}

export interface LODConfig {
  thresholds: {
    universe: number;
    field: number;
    topic: number;
    paper: number;
  };
  maxNodes: {
    universe: number;
    field: number;
    topic: number;
    paper: number;
  };
  minDegree: {
    universe: number;
    field: number;
    topic: number;
    paper: number;
  };
  loadEdges: {
    universe: boolean;
    field: boolean;
    topic: boolean;
    paper: boolean;
  };
  edgeTypes: {
    universe: string;
    field: string;
    topic: string;
    paper: string;
  };
}

export interface PerformanceConfig {
  cache: {
    ttl: number;
    maxRegions: number;
    overlapThreshold: number;
    spatialHashSize: number;
  };
  loading: {
    batchSize: number;
    maxBatchSize: number;
    minBatchSize: number;
    adaptiveBatching: boolean;
    earlyTermination: boolean;
    maxEmptyBatches: number;
    smartTermination: boolean;
    maxConcurrentBatches: number;
  };
  api: {
    timeout: number;
    maxRetries: number;
    retryDelay: number;
  };
}

export interface ViewportConfig {
  initialRatio: number;
  minCameraRatio: number;
  maxCameraRatio: number;
  paddingFactor: number;
  coordinateScale: number;
  initialBounds?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    note?: string;
  };
}

export interface SpatialOptimizationConfig {
  enabled: boolean;
  rTreeMaxEntries: number;
  rTreeMinEntries: number;
  viewportPadding: number;
  distanceThreshold: number;
  lastSeenThreshold: number;
  maxViewportNodes: number;
  maxDistantNodes: number;
  spatialCleanupInterval: number;
  performanceCleanupInterval: number;
  enableNodeHiding: boolean;
  hideDistanceThreshold: number;
  maxHiddenNodes: number;
  maxSpatialRegions: number;
  regionMergeThreshold: number;
  enablePerformanceMonitoring: boolean;
  targetFrameRate: number;
  frameRateWindow: number;
}

export interface MemoryConfig {
  maxTotalNodes: number;
  maxTotalEdges: number;
  cleanupThreshold: number;
  aggressiveCleanup: boolean;
  viewportNodeRatio: number;
  spatialOptimization: SpatialOptimizationConfig;
}

export interface InteractionConfig {
  dragThreshold: number;
  panSensitivity: number;
  searchCacheSize: number;
  searchTimeout: number;
}

export interface DebugConfig {
  enableLODLogging: boolean;
  enableEdgeLogging: boolean;
  enableCacheLogging: boolean;
  enablePerformanceLogging: boolean;
  slowQueryThreshold: number;
  memoryCheckInterval: number;
}

export interface BackendConfig {
  defaultNodeLimit: number;
  defaultEdgeLimit: number;
  maxNodeLimit: number;
  maxEdgeLimit: number;
  spatialIndexing: boolean;
  degreeIndexing: boolean;
}

export interface TreeConfig {
  enabled: boolean;
  dwellDelay: number;
  autoEnrichment: boolean;
  maxTreeEdges: number;
  maxExtraEdges: number;
  enrichmentBatchSize: number;
}

export interface AppConfig {
  tree: TreeConfig;
  theme: ThemeConfig;
  visual: VisualConfig;
  lod: LODConfig;
  performance: PerformanceConfig;
  viewport: ViewportConfig;
  memory: MemoryConfig;
  interaction: InteractionConfig;
  debug: DebugConfig;
  backend: BackendConfig;
}

// ===== DEFAULT CONFIGURATION =====
// Fallback configuration in case YAML loading fails
const DEFAULT_CONFIG: AppConfig = {
  theme: {
    defaultMode: 'auto',
    light: {
      canvasBackground: '#ffffff',
      bodyBackground: '#f8f9fa',
      panelBackground: 'rgba(255, 255, 255, 0.95)',
      panelBackgroundSecondary: 'rgba(248, 249, 250, 0.9)',
      headerBackground: '#ffffff',
      textPrimary: '#212529',
      textSecondary: '#6c757d',
      textMuted: '#adb5bd',
      textInverse: '#ffffff',
      borderPrimary: '#dee2e6',
      borderSecondary: '#e9ecef',
      borderAccent: '#007bff',
      edgeColor: '#cccccc',
      success: '#28a745',
      warning: '#ffc107',
      error: '#dc3545',
      info: '#17a2b8',
    },
    dark: {
      canvasBackground: '#1a1a1a',
      bodyBackground: '#0d1117',
      panelBackground: 'rgba(30, 30, 30, 0.95)',
      panelBackgroundSecondary: 'rgba(20, 20, 20, 0.9)',
      headerBackground: '#161b22',
      textPrimary: '#f0f6fc',
      textSecondary: '#8b949e',
      textMuted: '#6e7681',
      textInverse: '#0d1117',
      borderPrimary: '#30363d',
      borderSecondary: '#21262d',
      borderAccent: '#58a6ff',
      edgeColor: '#444444',
      success: '#3fb950',
      warning: '#d29922',
      error: '#f85149',
      info: '#79c0ff',
    },
  },
  visual: {
    nodes: {
      defaultSize: 3,
      defaultColor: "#888888",
      minSize: 1,
      maxSize: 20,
      minSpacing: 1,
      overlapBehavior: 'none',
    },
    edges: {
      defaultSize: 1,
      defaultColor: "#cccccc",
      minSize: 0.1,
      maxSize: 5,
    },
    labels: {
      enabled: true,
      renderThreshold: 0.5,
      hideOnMove: true,
      density: 0.7,
      gridCellSize: 10,
      sizeThreshold: 10,
    },
    search: {
      focusNodeColor: "#ff6b6b",
      focusNodeSize: 15,
      neighborNodeColor: "#4ecdc4",
      neighborNodeSize: 10,
      focusEdgeColor: "#ff8e53",
      focusEdgeSize: 3,
    },
  },
  lod: {
    thresholds: {
      universe: 0.5,
      field: 3.0,
      topic: 5.0,
      paper: 7.0,
    },
    maxNodes: {
      universe: 1000,
      field: 2500,
      topic: 1500,
      paper: 500,
    },
    minDegree: {
      universe: 1,
      field: 2,
      topic: 10,
      paper: 5,
    },
    loadEdges: {
      universe: true,
      field: true,
      topic: false,
      paper: false,
    },
    edgeTypes: {
      universe: 'universe',
      field: 'field',
      topic: 'topic',
      paper: 'paper',
    },
  },
  performance: {
    cache: {
      ttl: 10000,
      maxRegions: 100,
      overlapThreshold: 0.5,
      spatialHashSize: 50,
    },
    loading: {
      batchSize: 100,
      maxBatchSize: 1000,
      minBatchSize: 50,
      adaptiveBatching: true,
      earlyTermination: true,
      maxEmptyBatches: 2,
      smartTermination: true,
      maxConcurrentBatches: 3,
    },
    api: {
      timeout: 10000,
      maxRetries: 3,
      retryDelay: 1000,
    },
  },
  viewport: {
    initialRatio: 1.0,
    minCameraRatio: 0.005,
    maxCameraRatio: 20,
    paddingFactor: 0.1,
    coordinateScale: 1.0,
    initialBounds: {
      xMin: -10,
      xMax: 10,
      yMin: -10,
      yMax: 10,
      note: 'Default fallback bounds'
    },
  },
  memory: {
    maxTotalNodes: 10000,
    maxTotalEdges: 20000,
    cleanupThreshold: 0.8,
    aggressiveCleanup: false,
    viewportNodeRatio: 0.7,
    spatialOptimization: {
      enabled: true,
      rTreeMaxEntries: 16,
      rTreeMinEntries: 4,
      viewportPadding: 1.5,
      distanceThreshold: 3.0,
      lastSeenThreshold: 30000,
      maxViewportNodes: 2000,
      maxDistantNodes: 1000,
      spatialCleanupInterval: 5000,
      performanceCleanupInterval: 10000,
      enableNodeHiding: true,
      hideDistanceThreshold: 5.0,
      maxHiddenNodes: 5000,
      maxSpatialRegions: 200,
      regionMergeThreshold: 0.3,
      enablePerformanceMonitoring: true,
      targetFrameRate: 30,
      frameRateWindow: 60,
    },
  },
  interaction: {
    dragThreshold: 5,
    panSensitivity: 1.0,
    searchCacheSize: 50,
    searchTimeout: 5000,
  },
  debug: {
    enableLODLogging: true,
    enableEdgeLogging: true,
    enableCacheLogging: false,
    enablePerformanceLogging: true,
    slowQueryThreshold: 2000,
    memoryCheckInterval: 30000,
  },
  backend: {
    defaultNodeLimit: 5000,
    defaultEdgeLimit: 3000,
    maxNodeLimit: 10000,
    maxEdgeLimit: 50000,
    spatialIndexing: true,
    degreeIndexing: true,
  },
  tree: {
    enabled: true,
    dwellDelay: 1000,
    autoEnrichment: true,
    maxTreeEdges: 1000,
    maxExtraEdges: 500,
    enrichmentBatchSize: 100,
  },
};

// ===== CONFIGURATION LOADER CLASS =====

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: AppConfig;
  private configPath: string;

  private constructor() {
    this.configPath = '/src/frontend/config.yaml';
    this.config = DEFAULT_CONFIG;
    this.loadConfig();
  }

  /**
   * Singleton instance getter
   */
  public static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  /**
   * Load configuration from YAML file
   */
  private async loadConfig(): Promise<void> {
    try {
      // In browser environment, fetch the config file from the project root
      const response = await fetch(this.configPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.statusText}`);
      }
      
      const yamlText = await response.text();
      const loadedConfig = yaml.load(yamlText) as any;
      
      // Merge with defaults to ensure all properties exist
      this.config = this.mergeConfigs(DEFAULT_CONFIG, loadedConfig);
      
      console.log('🎛️ Configuration loaded successfully from', this.configPath);
      console.log('🎛️ Config preview:', {
        nodeSize: this.config.visual.nodes.defaultSize,
        edgeColor: this.config.visual.edges.defaultColor,
        maxNodes: this.config.lod.maxNodes,
        cacheEnabled: this.config.performance.cache.ttl > 0
      });
      
    } catch (error) {
      console.warn('⚠️ Failed to load config.yaml, using defaults:', error);
      console.log('🎛️ Using default configuration');
    }
  }

  /**
   * Deep merge two configuration objects
   */
  private mergeConfigs(defaultConfig: any, loadedConfig: any): any {
    const result = { ...defaultConfig };
    
    for (const key in loadedConfig) {
      if (loadedConfig[key] && typeof loadedConfig[key] === 'object' && !Array.isArray(loadedConfig[key])) {
        result[key] = this.mergeConfigs(result[key] || {}, loadedConfig[key]);
      } else {
        result[key] = loadedConfig[key];
      }
    }
    
    return result;
  }

  /**
   * Get the full configuration object
   */
  public getConfig(): AppConfig {
    return this.config;
  }

  /**
   * Get visual configuration
   */
  public getVisual(): VisualConfig {
    return this.config.visual;
  }

  /**
   * Get LOD configuration
   */
  public getLOD(): LODConfig {
    return this.config.lod;
  }

  /**
   * Get performance configuration
   */
  public getPerformance(): PerformanceConfig {
    return this.config.performance;
  }

  /**
   * Get viewport configuration
   */
  public getViewport(): ViewportConfig {
    return this.config.viewport;
  }

  /**
   * Get memory configuration
   */
  public getMemory(): MemoryConfig {
    return this.config.memory;
  }

  /**
   * Get interaction configuration
   */
  public getInteraction(): InteractionConfig {
    return this.config.interaction;
  }

  /**
   * Get debug configuration
   */
  public getDebug(): DebugConfig {
    return this.config.debug;
  }

  /**
   * Get backend configuration
   */
  public getBackend(): BackendConfig {
    return this.config.backend;
  }

  /**
   * Get theme configuration
   */
  public getTheme(): ThemeConfig {
    return this.config.theme;
  }

  /**
   * Get current theme palette based on mode
   */
  public getCurrentThemePalette(): ThemeColorPalette {
    const themeConfig = this.config.theme;
    let mode: 'light' | 'dark' = 'light';

    if (themeConfig.defaultMode === 'auto') {
      // Check system preference
      mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      mode = themeConfig.defaultMode as 'light' | 'dark';
    }

    return themeConfig[mode];
  }

  /**
   * Get specific theme palette
   */
  public getThemePalette(mode: 'light' | 'dark'): ThemeColorPalette {
    return this.config.theme[mode];
  }

  /**
   * Hot reload configuration (useful for development)
   */
  public async reloadConfig(): Promise<void> {
    console.log('🔄 Reloading configuration...');
    await this.loadConfig();
  }

  /**
   * Update configuration at runtime (useful for debugging/tuning)
   */
  public updateConfig(partialConfig: Partial<AppConfig>): void {
    this.config = this.mergeConfigs(this.config, partialConfig);
    console.log('🎛️ Configuration updated:', partialConfig);
  }
}

// ===== CONVENIENCE FUNCTIONS =====

/**
 * Get the global configuration instance
 */
export function getConfig(): AppConfig {
  return ConfigLoader.getInstance().getConfig();
}

/**
 * Get visual configuration
 */
export function getVisualConfig(): VisualConfig {
  return ConfigLoader.getInstance().getVisual();
}

/**
 * Get LOD configuration  
 */
export function getLODConfig(): LODConfig {
  return ConfigLoader.getInstance().getLOD();
}

/**
 * Get performance configuration
 */
export function getPerformanceConfig(): PerformanceConfig {
  return ConfigLoader.getInstance().getPerformance();
}

/**
 * Get viewport configuration
 */
export function getViewportConfig(): ViewportConfig {
  return ConfigLoader.getInstance().getViewport();
}

/**
 * Get memory configuration
 */
export function getMemoryConfig(): MemoryConfig {
  return ConfigLoader.getInstance().getMemory();
}

/**
 * Get debug configuration
 */
export function getDebugConfig(): DebugConfig {
  return ConfigLoader.getInstance().getDebug();
}

/**
 * Get backend configuration
 */
export function getBackendConfig(): BackendConfig {
  return ConfigLoader.getInstance().getBackend();
}

/**
 * Get theme configuration
 */
export function getThemeConfig(): ThemeConfig {
  return ConfigLoader.getInstance().getTheme();
}

/**
 * Get current theme palette based on system preference or config
 */
export function getCurrentThemePalette(): ThemeColorPalette {
  return ConfigLoader.getInstance().getCurrentThemePalette();
}

/**
 * Get specific theme palette
 */
export function getThemePalette(mode: 'light' | 'dark'): ThemeColorPalette {
  return ConfigLoader.getInstance().getThemePalette(mode);
} 