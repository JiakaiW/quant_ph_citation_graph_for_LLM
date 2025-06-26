import { Coordinates, ViewportBounds } from '../types';
import { Sigma } from 'sigma';

/**
 * Manages coordinate transformations between different coordinate spaces:
 * 1. Database coordinates: Raw coordinates from the backend
 * 2. Graph coordinates: Scaled coordinates used in the graph (multiplied by coordinateScale)
 * 3. Screen coordinates: Pixel coordinates on the screen
 */
export class CoordinateManager {
  private sigma: Sigma;
  private coordinateScale: number;
  private datasetBounds: ViewportBounds | null = null;

  constructor(sigma: Sigma, coordinateScale: number = 1.0) {
    this.sigma = sigma;
    this.coordinateScale = coordinateScale;
  }

  /**
   * Convert database coordinates to graph coordinates
   */
  public toGraphCoords(dbX: number, dbY: number): Coordinates {
    return {
      x: dbX * this.coordinateScale,
      y: dbY * this.coordinateScale
    };
  }

  /**
   * Convert graph coordinates back to database coordinates
   */
  public toDbCoords(graphX: number, graphY: number): Coordinates {
    return {
      x: graphX / this.coordinateScale,
      y: graphY / this.coordinateScale
    };
  }

  /**
   * Convert screen coordinates to graph coordinates
   */
  public screenToGraph(screenX: number, screenY: number): Coordinates {
    return this.sigma.viewportToGraph({ x: screenX, y: screenY });
  }

  /**
   * Convert graph coordinates to screen coordinates
   */
  public graphToScreen(graphX: number, graphY: number): Coordinates {
    return this.sigma.graphToViewport({ x: graphX, y: graphY });
  }

  /**
   * Get current viewport bounds in database coordinates
   */
  public getViewportBoundsInDb(): ViewportBounds {
    const { width, height } = this.sigma.getDimensions();
    
    // Get viewport corners in graph coordinates
    const topLeft = this.screenToGraph(0, 0);
    const bottomRight = this.screenToGraph(width, height);
    
    // Convert to database coordinates
    const dbTopLeft = this.toDbCoords(topLeft.x, topLeft.y);
    const dbBottomRight = this.toDbCoords(bottomRight.x, bottomRight.y);
    
    return {
      minX: Math.min(dbTopLeft.x, dbBottomRight.x),
      maxX: Math.max(dbTopLeft.x, dbBottomRight.x),
      minY: Math.min(dbTopLeft.y, dbBottomRight.y),
      maxY: Math.max(dbTopLeft.y, dbBottomRight.y),
      width: Math.abs(dbBottomRight.x - dbTopLeft.x),
      height: Math.abs(dbBottomRight.y - dbTopLeft.y)
    };
  }

  /**
   * Get current viewport bounds in graph coordinates
   */
  public getViewportBoundsInGraph(): ViewportBounds {
    const { width, height } = this.sigma.getDimensions();
    
    // Get viewport corners in graph coordinates
    const topLeft = this.screenToGraph(0, 0);
    const bottomRight = this.screenToGraph(width, height);
    
    return {
      minX: Math.min(topLeft.x, bottomRight.x),
      maxX: Math.max(topLeft.x, bottomRight.x),
      minY: Math.min(topLeft.y, bottomRight.y),
      maxY: Math.max(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y)
    };
  }

  /**
   * Set the dataset bounds (total extent of all data)
   */
  public setDatasetBounds(bounds: ViewportBounds): void {
    this.datasetBounds = bounds;
  }

  /**
   * Get the dataset bounds in database coordinates
   */
  public getDatasetBounds(): ViewportBounds | null {
    return this.datasetBounds;
  }

  /**
   * Check if a point in graph coordinates is within the current viewport
   */
  public isPointInViewport(graphX: number, graphY: number): boolean {
    const bounds = this.getViewportBoundsInGraph();
    return (
      graphX >= bounds.minX && graphX <= bounds.maxX &&
      graphY >= bounds.minY && graphY <= bounds.maxY
    );
  }

  /**
   * Update the coordinate scale
   */
  public setCoordinateScale(scale: number): void {
    this.coordinateScale = scale;
  }

  /**
   * Get the current coordinate scale
   */
  public getCoordinateScale(): number {
    return this.coordinateScale;
  }
} 