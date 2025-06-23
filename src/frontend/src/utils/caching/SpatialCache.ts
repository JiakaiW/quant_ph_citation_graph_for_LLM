import { ViewportBounds, LoadedRegion, CacheStats } from '../types/GraphTypes';
import { LevelOfDetail } from '../viewport/LevelOfDetail';

/**
 * 💾 Spatial Cache Manager
 * 
 * Handles spatial hashing and cache management for loaded regions
 * to avoid redundant API calls when revisiting areas.
 */
export class SpatialCache {
  private loadedRegions: LoadedRegion[] = [];
  private lodManager: LevelOfDetail;
  private hitCount: number = 0;
  private missCount: number = 0;

  constructor(lodManager: LevelOfDetail) {
    this.lodManager = lodManager;
  }

  /**
   * Generate spatial hash for fast region comparison
   */
  generateSpatialHash(bounds: ViewportBounds, lodLevel: number): string {
    // Quantize coordinates to grid for efficient caching
    const gridSize = Math.pow(2, lodLevel); // Larger grid for higher LOD
    const gridX = Math.floor(bounds.minX / gridSize);
    const gridY = Math.floor(bounds.minY / gridSize);
    const gridW = Math.ceil(bounds.width / gridSize);
    const gridH = Math.ceil(bounds.height / gridSize);
    return `${lodLevel}:${gridX},${gridY},${gridW},${gridH}`;
  }

  /**
   * Fast spatial cache lookup using hash
   */
  isSpatialCached(bounds: ViewportBounds, lodLevel: number): boolean {
    const targetHash = this.generateSpatialHash(bounds, lodLevel);
    const now = Date.now();
    const cacheTTL = this.lodManager.getCacheTTL();
    
    const isCached = this.loadedRegions.some(region => {
      if (now - region.timestamp > cacheTTL) return false;
      if (region.lodLevel !== lodLevel) return false;
      return region.spatialHash === targetHash;
    });

    // Track cache hit/miss statistics
    if (isCached) {
      this.hitCount++;
      console.log(`♻️ Spatial cache HIT for LOD ${lodLevel}, hash: ${targetHash}`);
    } else {
      this.missCount++;
      console.log(`❌ Spatial cache MISS for LOD ${lodLevel}, hash: ${targetHash}`);
    }

    return isCached;
  }

  /**
   * Check if viewport is covered by cached regions (legacy method)
   */
  isViewportCached(bounds: ViewportBounds, requiredMinDegree: number, debug: boolean = false): boolean {
    const now = Date.now();
    const cacheTTL = this.lodManager.getCacheTTL();
    const overlapThreshold = this.lodManager.getOverlapThreshold();
    
    if (debug) {
      console.log(`🔍 Cache check: ${this.loadedRegions.length} regions, TTL=${cacheTTL}ms`);
    }
    
    const isCached = this.loadedRegions.some((region, index) => {
      const age = now - region.timestamp;
      if (age > cacheTTL) {
        if (debug) console.log(`⏰ Region ${index} expired (age: ${age}ms > TTL: ${cacheTTL}ms)`);
        return false;
      }

      // Use lodLevel for new system compatibility
      const regionMinDegree = this.lodManager.getMinDegree(region.lodLevel);
      if (regionMinDegree > requiredMinDegree) {
        if (debug) console.log(`📊 Region ${index} degree mismatch (cache: ${regionMinDegree} > required: ${requiredMinDegree})`);
        return false;
      }
      
      const overlapMinX = Math.max(bounds.minX, region.bounds.minX);
      const overlapMaxX = Math.min(bounds.maxX, region.bounds.maxX);
      const overlapMinY = Math.max(bounds.minY, region.bounds.minY);
      const overlapMaxY = Math.min(bounds.maxY, region.bounds.maxY);
      
      if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) {
        if (debug) console.log(`📐 Region ${index} no overlap`);
        return false;
      }
      
      const overlapArea = (overlapMaxX - overlapMinX) * (overlapMaxY - overlapMinY);
      const viewportArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
      const overlapRatio = overlapArea / viewportArea;
      
      if (debug) console.log(`🎯 Region ${index} overlap: ${(overlapRatio * 100).toFixed(1)}% (threshold: ${(overlapThreshold * 100).toFixed(1)}%)`);
      
      if (overlapRatio >= overlapThreshold) {
        console.log(`♻️ Cache hit: Region ${index} overlap sufficient`);
        return true;
      }
      
      return false;
    });

    // Track statistics
    if (isCached) {
      this.hitCount++;
    } else {
      this.missCount++;
    }

    return isCached;
  }

  /**
   * Add a region to the cache
   */
  addRegion(bounds: ViewportBounds, nodeCount: number, lodLevel: number): void {
    const region: LoadedRegion = {
      bounds,
      timestamp: Date.now(),
      nodeCount,
      lodLevel,
      spatialHash: this.generateSpatialHash(bounds, lodLevel),
    };
    
    this.loadedRegions.push(region);
    console.log(`💾 Added cache region: LOD ${lodLevel}, ${nodeCount} nodes, hash: ${region.spatialHash}`);
    
    // Auto-cleanup if we have too many regions
    if (this.loadedRegions.length > 50) {
      this.cleanupExpiredCache();
    }
  }

  /**
   * Clear all cached regions
   */
  clearCache(): void {
    const regionCount = this.loadedRegions.length;
    this.loadedRegions = [];
    this.hitCount = 0;
    this.missCount = 0;
    console.log(`🗑️ Cache cleared (removed ${regionCount} regions)`);
  }

  /**
   * Clean up expired cache entries
   */
  cleanupExpiredCache(): number {
    const now = Date.now();
    const cacheTTL = this.lodManager.getCacheTTL();
    const initialCount = this.loadedRegions.length;
    
    this.loadedRegions = this.loadedRegions.filter(region => {
      return (now - region.timestamp) <= cacheTTL;
    });
    
    const removedCount = initialCount - this.loadedRegions.length;
    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} expired cache entries`);
    }
    
    return removedCount;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const now = Date.now();
    const totalRegions = this.loadedRegions.length;
    
    if (totalRegions === 0) {
      return { 
        totalRegions: 0, 
        avgAge: 0, 
        oldestAge: 0,
        hitRate: 0,
        missRate: 0
      };
    }
    
    const ages = this.loadedRegions.map(region => now - region.timestamp);
    const avgAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;
    const oldestAge = Math.max(...ages);
    
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;
    const missRate = totalRequests > 0 ? this.missCount / totalRequests : 0;
    
    return { 
      totalRegions, 
      avgAge, 
      oldestAge,
      hitRate,
      missRate
    };
  }

  /**
   * Get all cached regions (for debugging)
   */
  getAllRegions(): LoadedRegion[] {
    return [...this.loadedRegions];
  }

  /**
   * Get regions by LOD level
   */
  getRegionsByLOD(lodLevel: number): LoadedRegion[] {
    return this.loadedRegions.filter(region => region.lodLevel === lodLevel);
  }

  /**
   * Force cleanup of regions older than specified age
   */
  cleanupOlderThan(maxAge: number): number {
    const now = Date.now();
    const initialCount = this.loadedRegions.length;
    
    this.loadedRegions = this.loadedRegions.filter(region => {
      return (now - region.timestamp) <= maxAge;
    });
    
    const removedCount = initialCount - this.loadedRegions.length;
    if (removedCount > 0) {
      console.log(`🧹 Force cleaned ${removedCount} regions older than ${maxAge}ms`);
    }
    
    return removedCount;
  }
} 