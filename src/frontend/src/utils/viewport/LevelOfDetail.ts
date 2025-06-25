import { LODConfiguration, DEFAULT_LOD_CONFIG } from '../types/GraphTypes';

/**
 * 🎯 Level of Detail (LOD) Manager
 * 
 * Handles zoom-based filtering and node density control
 * for optimal performance at different zoom levels.
 */
export class LevelOfDetail {
  private config: LODConfiguration;

  constructor(config: LODConfiguration = DEFAULT_LOD_CONFIG) {
    this.config = config;
  }

  /**
   * Calculate Level of Detail based on camera ratio
   */
  calculateLOD(cameraRatio: number): number {
    // Sigma ratio: higher = more zoomed out
    // Simplified to 3 levels: detailed, normal, overview
    if (cameraRatio < 0.5) return 0;      // Detailed view
    if (cameraRatio < 3.0) return 1;      // Normal view  
    return 2;                             // Overview
  }

  /**
   * Get maximum nodes allowed for given LOD level
   */
  getMaxNodes(lodLevel: number): number {
    return this.config.MAX_NODES_BY_LOD[lodLevel] || 1000;
  }

  /**
   * Get minimum degree filter for given LOD level
   */
  getMinDegree(lodLevel: number): number {
    return this.config.MIN_DEGREE_BY_LOD[lodLevel] || 1;
  }

  /**
   * Get viewport overlap threshold for caching
   */
  getOverlapThreshold(): number {
    return this.config.VIEWPORT_OVERLAP_THRESHOLD;
  }

  /**
   * Get cache time-to-live in milliseconds
   */
  getCacheTTL(): number {
    return this.config.CACHE_TTL;
  }



  /**
   * Check if edges should be loaded for this LOD level
   */
  shouldLoadEdges(lodLevel: number): boolean {
    return lodLevel <= 1; // Only load edges for detailed and normal views
  }

  /**
   * Get LOD level description for debugging
   */
  getLODDescription(lodLevel: number): string {
    const descriptions = {
      0: 'Detailed view - high quality',
      1: 'Normal view - balanced',
      2: 'Overview - sparse sampling'
    };
    return descriptions[lodLevel as keyof typeof descriptions] || 'Unknown LOD level';
  }

  /**
   * Get configuration for debugging
   */
  getConfig(): LODConfiguration {
    return { ...this.config };
  }

  /**
   * Update configuration (useful for runtime tuning)
   */
  updateConfig(newConfig: Partial<LODConfiguration>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('🎯 LOD configuration updated:', newConfig);
  }
} 