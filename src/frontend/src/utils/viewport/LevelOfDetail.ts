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
    if (cameraRatio < 0.1) return 0;      // Very zoomed in
    if (cameraRatio < 0.5) return 1;      // Zoomed in
    if (cameraRatio < 2.0) return 2;      // Normal
    if (cameraRatio < 5.0) return 3;      // Zoomed out
    if (cameraRatio < 15.0) return 4;     // Far out
    return 5;                             // Ultra far (overview)
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
    return lodLevel <= 2; // Only load edges for detailed views
  }

  /**
   * Get LOD level description for debugging
   */
  getLODDescription(lodLevel: number): string {
    const descriptions = {
      0: 'Very zoomed in - high detail',
      1: 'Zoomed in - balanced detail',
      2: 'Normal - moderate detail',
      3: 'Zoomed out - overview mode',
      4: 'Far out - sparse sampling',
      5: 'Ultra far - major hubs only'
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