import { ViewportBounds, InitializationResult, GraphConfig } from '../types/GraphTypes';

/**
 * 🚀 Graph Initializer
 * 
 * Handles initial setup and bounds fetching.
 * Responsible for the startup sequence and initial configuration.
 */
export class GraphInitializer {
  private config: GraphConfig;

  constructor(config: GraphConfig) {
    this.config = config;
  }

  /**
   * Initialize the graph system with proper startup sequence
   */
  async initialize(): Promise<InitializationResult> {
    console.log('🚀 Initializing graph system...');
    
    try {
      // Step 1: Fetch data bounds from backend
      const bounds = await this.fetchDataBounds();
      
      if (!bounds) {
        throw new Error('Failed to fetch data bounds');
      }

      console.log('🚀 Data bounds:', bounds);

      // Step 2: Validate bounds
      if (!this.validateBounds(bounds)) {
        throw new Error('Invalid data bounds received');
      }

      // Step 3: Calculate initial viewport
      const initialViewport = this.calculateInitialViewport(bounds);

      // Step 4: Setup initial configuration
      const initialConfig = this.createInitialConfig(bounds, initialViewport);

      console.log('🚀 Graph system initialized successfully');
      console.log('📊 Data bounds:', bounds);
      console.log('👁️ Initial viewport:', initialViewport);

      return {
        success: true,
        bounds,
        initialViewport,
        config: initialConfig,
        error: null
      };

    } catch (error) {
      console.error('🚀 Graph initialization failed:', error);
      
      return {
        success: false,
        bounds: null,
        initialViewport: null,
        config: null,
        error: error instanceof Error ? error.message : 'Unknown initialization error'
      };
    }
  }

  /**
   * Fetch data bounds from backend
   * This tells us the spatial extent of all nodes in the dataset
   */
  async fetchDataBounds(): Promise<ViewportBounds | null> {
    try {
      console.log('📡 Fetching data bounds from backend...');
      
      const response = await fetch('/api/bounds');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const bounds = await response.json();
      
      console.log('📡 Received bounds:', bounds);
      
      return bounds;

    } catch (error) {
      console.error('📡 Failed to fetch data bounds:', error);
      
      // Fallback bounds for development/testing
      console.warn('📡 Using fallback bounds for development');
      return {
        minX: -100,
        maxX: 100,
        minY: -100,
        maxY: 100,
        width: 200,
        height: 200
      };
    }
  }

  /**
   * Validate bounds data
   */
  private validateBounds(bounds: ViewportBounds): boolean {
    if (!bounds) {
      console.error('🚀 Bounds is null or undefined');
      return false;
    }

    const { minX, maxX, minY, maxY } = bounds;

    // Check if bounds are numbers
    if (typeof minX !== 'number' || typeof maxX !== 'number' || 
        typeof minY !== 'number' || typeof maxY !== 'number') {
      console.error('🚀 Bounds contain non-numeric values:', bounds);
      return false;
    }

    // Check if bounds are valid (min < max)
    if (minX >= maxX || minY >= maxY) {
      console.error('🚀 Invalid bounds: min >= max', bounds);
      return false;
    }

    // Check for reasonable bounds (not infinite or NaN)
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      console.error('🚀 Bounds contain infinite or NaN values:', bounds);
      return false;
    }

    // Check bounds are not too extreme
    const xRange = maxX - minX;
    const yRange = maxY - minY;
    
    if (xRange > 1e6 || yRange > 1e6) {
      console.warn('🚀 Bounds are very large, this might cause performance issues:', bounds);
    }

    if (xRange < 1e-6 || yRange < 1e-6) {
      console.warn('🚀 Bounds are very small, this might cause precision issues:', bounds);
    }

    return true;
  }

  /**
   * Calculate initial viewport to show entire dataset
   */
  private calculateInitialViewport(bounds: ViewportBounds): ViewportBounds {
    const { minX, maxX, minY, maxY } = bounds;
    
    // Add padding around the data (10% on each side)
    const xRange = maxX - minX;
    const yRange = maxY - minY;
    const xPadding = xRange * 0.1;
    const yPadding = yRange * 0.1;

    const initialViewport = {
      minX: minX - xPadding,
      maxX: maxX + xPadding,
      minY: minY - yPadding,
      maxY: maxY + yPadding,
      width: xRange + 2 * xPadding,
      height: yRange + 2 * yPadding
    };

    console.log('👁️ Calculated initial viewport with 10% padding:', initialViewport);
    
    return initialViewport;
  }

  /**
   * Create initial configuration based on bounds
   */
  private createInitialConfig(bounds: ViewportBounds, initialViewport: ViewportBounds): GraphConfig {
    const xRange = bounds.maxX - bounds.minX;
    const yRange = bounds.maxY - bounds.minY;
    const dataSize = Math.max(xRange, yRange);

    // Adaptive configuration based on data size
    const adaptiveConfig: GraphConfig = {
      ...this.config,
      
      // LOD thresholds based on data size (use existing LOD config structure)
      lodConfig: {
        ...this.config.lodConfig,
        // Note: LODConfiguration doesn't have overviewThreshold/detailThreshold
        // We'll use the existing MAX_NODES_BY_LOD structure
      },

      // Memory management based on data size
      memoryConfig: {
        ...this.config.memoryConfig,
        maxNodes: this.estimateMaxNodes(dataSize),
        maxEdges: this.estimateMaxEdges(dataSize),
      },

      // Viewport configuration
      viewportConfig: {
        ...this.config.viewportConfig,
        initialBounds: initialViewport,
        dataBounds: bounds,
      }
    };

    console.log('⚙️ Created adaptive configuration:', adaptiveConfig);
    
    return adaptiveConfig;
  }

  /**
   * Estimate reasonable max nodes based on data size
   */
  private estimateMaxNodes(dataSize: number): number {
    // Conservative estimate: larger datasets need more aggressive memory management
    if (dataSize > 1000) {
      return 5000;  // Large dataset
    } else if (dataSize > 100) {
      return 10000; // Medium dataset
    } else {
      return 20000; // Small dataset
    }
  }

  /**
   * Estimate reasonable max edges based on data size
   */
  private estimateMaxEdges(dataSize: number): number {
    // Edges grow quadratically, so be more conservative
    if (dataSize > 1000) {
      return 10000;  // Large dataset
    } else if (dataSize > 100) {
      return 20000;  // Medium dataset
    } else {
      return 50000;  // Small dataset
    }
  }

  /**
   * Setup initial camera position for Sigma.js
   */
  setupInitialCamera(initialViewport: ViewportBounds): {
    x: number;
    y: number;
    ratio: number;
  } {
    const centerX = (initialViewport.minX + initialViewport.maxX) / 2;
    const centerY = (initialViewport.minY + initialViewport.maxY) / 2;
    
    // Calculate ratio to fit entire viewport
    const xRange = initialViewport.maxX - initialViewport.minX;
    const yRange = initialViewport.maxY - initialViewport.minY;
    
    // Assume canvas size of 800x600 (will be adjusted by Sigma.js)
    const canvasWidth = 800;
    const canvasHeight = 600;
    
    const xRatio = xRange / canvasWidth;
    const yRatio = yRange / canvasHeight;
    const ratio = Math.max(xRatio, yRatio) * 1.1; // Add 10% margin

    const camera = {
      x: centerX,
      y: centerY,
      ratio: Math.max(ratio, 0.1) // Minimum ratio to prevent issues
    };

    console.log('📷 Initial camera position:', camera);
    
    return camera;
  }

  /**
   * Validate system requirements
   */
  validateSystemRequirements(): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check WebGL support
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) {
      issues.push('WebGL is not supported in this browser');
    }

    // Check performance API
    if (!window.performance) {
      warnings.push('Performance API not available, timing measurements disabled');
    }

    // Check fetch API
    if (!window.fetch) {
      issues.push('Fetch API not supported, cannot load data');
    }

    // Check memory (if available)
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      if (memInfo.usedJSHeapSize > memInfo.jsHeapSizeLimit * 0.8) {
        warnings.push('High memory usage detected, performance may be affected');
      }
    }

    // Check viewport size
    if (window.innerWidth < 800 || window.innerHeight < 600) {
      warnings.push('Small viewport detected, consider responsive design adjustments');
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  /**
   * Get initialization progress for loading screens
   */
  async initializeWithProgress(
    onProgress?: (step: string, progress: number) => void
  ): Promise<InitializationResult> {
    const updateProgress = (step: string, progress: number) => {
      console.log(`🚀 ${step}: ${Math.round(progress * 100)}%`);
      onProgress?.(step, progress);
    };

    try {
      updateProgress('Validating system requirements', 0.1);
      const systemCheck = this.validateSystemRequirements();
      
      if (!systemCheck.isValid) {
        throw new Error(`System requirements not met: ${systemCheck.issues.join(', ')}`);
      }

      if (systemCheck.warnings.length > 0) {
        console.warn('🚀 System warnings:', systemCheck.warnings);
      }

      updateProgress('Fetching data bounds', 0.3);
      const bounds = await this.fetchDataBounds();
      
      if (!bounds) {
        throw new Error('Failed to fetch data bounds');
      }

      updateProgress('Validating bounds', 0.5);
      if (!this.validateBounds(bounds)) {
        throw new Error('Invalid data bounds received');
      }

      updateProgress('Calculating initial viewport', 0.7);
      const initialViewport = this.calculateInitialViewport(bounds);

      updateProgress('Creating configuration', 0.9);
      const initialConfig = this.createInitialConfig(bounds, initialViewport);

      updateProgress('Initialization complete', 1.0);

      return {
        success: true,
        bounds,
        initialViewport,
        config: initialConfig,
        error: null
      };

    } catch (error) {
      console.error('🚀 Graph initialization failed:', error);
      
      return {
        success: false,
        bounds: null,
        initialViewport: null,
        config: null,
        error: error instanceof Error ? error.message : 'Unknown initialization error'
      };
    }
  }

  /**
   * Reset initialization state (for development/testing)
   */
  reset(): void {
    console.log('🚀 Resetting graph initializer');
    // Any cleanup logic would go here
  }
} 