/**
 * Basic 2D coordinates
 */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Viewport bounds with min/max coordinates and dimensions
 */
export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width?: number;
  height?: number;
  maxNodes?: number;
  minDegree?: number;
} 