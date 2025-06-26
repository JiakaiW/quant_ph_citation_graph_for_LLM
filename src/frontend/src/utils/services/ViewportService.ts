/**
 * 📹 Viewport Service Implementation
 * 
 * Concrete implementation of ViewportService that manages viewport operations,
 * camera state, and viewport change detection with debouncing.
 */

import { Sigma } from 'sigma';
import { BaseManager, ManagerConfig } from '../core/BaseManager';
import { ViewportService, ViewportBounds } from '../core/UnifiedGraphManager';

export interface ViewportServiceConfig extends ManagerConfig {
  debounceMs: number;
  changeThreshold: number;
  paddingFactor: number;
}

export class ViewportServiceImpl extends BaseManager<ViewportServiceConfig> implements ViewportService {
  private sigma: Sigma;
  private camera: any;
  private lastBounds: ViewportBounds | null = null;
  private changeCallbacks: Array<(bounds: ViewportBounds) => void> = [];
  private debounceTimer: number | null = null;
  private isMonitoring: boolean = false;

  constructor(sigma: Sigma, config: ViewportServiceConfig) {
    super(config);
    this.sigma = sigma;
    this.camera = sigma.getCamera();
  }

  async initialize(): Promise<void> {
    await this.safeInitialize(async () => {
      // Setup camera event listeners
      this.setupCameraListeners();
      
      // Get initial bounds
      this.lastBounds = this.calculateBounds();
      
      console.log('📹 ViewportService initialized');
    });
  }

  destroy(): void {
    this.safeDestroy(() => {
      // Clear debounce timer
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }

      // Stop monitoring
      this.isMonitoring = false;
      
      // Clear callbacks
      this.changeCallbacks.length = 0;
      
      // Remove camera listeners
      this.camera.removeAllListeners();
    });
  }

  getCurrentBounds(): ViewportBounds {
    return this.calculateBounds();
  }

  isViewportChanged(threshold: number = this.config.changeThreshold): boolean {
    if (!this.lastBounds) {
      return true;
    }

    const currentBounds = this.calculateBounds();
    
    // Calculate the change magnitude
    const widthChange = Math.abs(currentBounds.width - this.lastBounds.width) / this.lastBounds.width;
    const heightChange = Math.abs(currentBounds.height - this.lastBounds.height) / this.lastBounds.height;
    const xChange = Math.abs(currentBounds.minX - this.lastBounds.minX) / this.lastBounds.width;
    const yChange = Math.abs(currentBounds.minY - this.lastBounds.minY) / this.lastBounds.height;

    const maxChange = Math.max(widthChange, heightChange, xChange, yChange);
    
    return maxChange > threshold;
  }

  onViewportChange(callback: (bounds: ViewportBounds) => void): void {
    this.changeCallbacks.push(callback);
    
    // Start monitoring if this is the first callback
    if (this.changeCallbacks.length === 1) {
      this.startMonitoring();
    }
  }

  centerOn(x: number, y: number, ratio?: number): void {
    if (ratio !== undefined) {
      this.camera.setState({ x, y, ratio });
    } else {
      this.camera.setState({ x, y });
    }

    // Force update bounds
    this.updateBounds();
  }

  // Additional utility methods

  removeViewportChangeCallback(callback: (bounds: ViewportBounds) => void): void {
    const index = this.changeCallbacks.indexOf(callback);
    if (index > -1) {
      this.changeCallbacks.splice(index, 1);
    }

    // Stop monitoring if no callbacks remain
    if (this.changeCallbacks.length === 0) {
      this.stopMonitoring();
    }
  }

  getCameraState(): { x: number; y: number; ratio: number; angle: number } {
    return {
      x: this.camera.x,
      y: this.camera.y,
      ratio: this.camera.ratio,
      angle: this.camera.angle
    };
  }

  setCameraState(state: { x?: number; y?: number; ratio?: number; angle?: number }): void {
    this.camera.setState(state);
    this.updateBounds();
  }

  fitToContent(padding: number = this.config.paddingFactor): void {
    // Get graph bounds and fit camera to show all nodes
    const graph = this.sigma.getGraph();
    
    if (graph.order === 0) {
      return; // No nodes to fit to
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    graph.forEachNode((nodeId: string, attributes: any) => {
      const x = attributes.x || 0;
      const y = attributes.y || 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    // Get container dimensions
    const container = this.sigma.getContainer();
    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;

    // Calculate ratio to fit content with padding
    const ratioX = containerWidth / (contentWidth * (1 + padding));
    const ratioY = containerHeight / (contentHeight * (1 + padding));
    const ratio = Math.min(ratioX, ratioY);

    // Set camera to show all content
    this.camera.setState({
      x: contentCenterX,
      y: contentCenterY,
      ratio: ratio
    });

    this.updateBounds();

    if (this.config.debug) {
      console.log('📹 ViewportService: Fitted camera to content', {
        bounds: { minX, maxX, minY, maxY },
        center: { x: contentCenterX, y: contentCenterY },
        ratio
      });
    }
  }

  getZoomLevel(): 'zoomed-out' | 'medium' | 'zoomed-in' | 'detail' {
    const ratio = this.camera.ratio;
    
    if (ratio < 0.3) return 'zoomed-out';
    if (ratio < 1.0) return 'medium';
    if (ratio < 3.0) return 'zoomed-in';
    return 'detail';
  }

  // Private methods

  private setupCameraListeners(): void {
    // Listen for camera state changes
    this.camera.on('updated', () => {
      this.handleCameraUpdate();
    });

    // Also listen for manual camera manipulations
    this.sigma.on('downStage', () => {
      this.handleCameraUpdate();
    });

    this.sigma.on('wheelStage', () => {
      this.handleCameraUpdate();
    });
  }

  private handleCameraUpdate(): void {
    if (!this.isMonitoring) {
      return;
    }

    // Debounce the update
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.updateBounds();
    }, this.config.debounceMs);
  }

  private updateBounds(): void {
    const newBounds = this.calculateBounds();
    
    // Check if bounds have changed significantly
    if (!this.lastBounds || this.boundsChanged(this.lastBounds, newBounds)) {
      this.lastBounds = newBounds;
      
      // Notify all callbacks
      this.notifyCallbacks(newBounds);
      
      if (this.config.debug) {
        console.log('📹 ViewportService: Bounds updated', newBounds);
      }
    }
  }

  private calculateBounds(): ViewportBounds {
    const container = this.sigma.getContainer();
    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;

    // Convert screen coordinates to graph coordinates
    const { x, y, ratio } = this.camera.getState();
    
    const halfWidth = (containerWidth / 2) / ratio;
    const halfHeight = (containerHeight / 2) / ratio;

    return {
      minX: x - halfWidth,
      maxX: x + halfWidth,
      minY: y - halfHeight,
      maxY: y + halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2
    };
  }

  private boundsChanged(oldBounds: ViewportBounds, newBounds: ViewportBounds): boolean {
    const threshold = this.config.changeThreshold;
    
    const widthChange = Math.abs(newBounds.width - oldBounds.width) / oldBounds.width;
    const heightChange = Math.abs(newBounds.height - oldBounds.height) / oldBounds.height;
    const xChange = Math.abs(newBounds.minX - oldBounds.minX) / oldBounds.width;
    const yChange = Math.abs(newBounds.minY - oldBounds.minY) / oldBounds.height;

    const maxChange = Math.max(widthChange, heightChange, xChange, yChange);
    
    return maxChange > threshold;
  }

  private notifyCallbacks(bounds: ViewportBounds): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(bounds);
      } catch (error) {
        console.error('📹 ViewportService: Error in viewport change callback', error);
      }
    }
  }

  private startMonitoring(): void {
    if (!this.isMonitoring) {
      this.isMonitoring = true;
      
      if (this.config.debug) {
        console.log('📹 ViewportService: Started monitoring viewport changes');
      }
    }
  }

  private stopMonitoring(): void {
    if (this.isMonitoring) {
      this.isMonitoring = false;
      
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      
      if (this.config.debug) {
        console.log('📹 ViewportService: Stopped monitoring viewport changes');
      }
    }
  }
} 