/**
 * 🎨 Color Manager
 * 
 * Manages distinct colors for different clusters to improve visual distinction.
 * Uses a carefully selected color palette for maximum contrast.
 */

export class ColorManager {
  private static instance: ColorManager;
  private colorPalette: string[] = [];
  
  private constructor() {
    this.initializeColors();
  }
  
  public static getInstance(): ColorManager {
    if (!ColorManager.instance) {
      ColorManager.instance = new ColorManager();
    }
    return ColorManager.instance;
  }
  
  /**
   * Initialize the distinct color palette
   */
  private initializeColors(): void {
    this.colorPalette = [
      '#e6194b', // Red
      '#3cb44b', // Green
      '#ffe119', // Yellow
      '#4363d8', // Blue
      '#f58231', // Orange
      '#911eb4', // Purple
      '#46f0f0', // Cyan
      '#f032e6', // Magenta
      '#bcf60c', // Lime
      '#fabebe', // Pink
      '#008080', // Teal
      '#e6beff', // Lavender
      '#9a6324', // Brown
      '#fffac8', // Beige
      '#800000', // Maroon
      '#aaffc3', // Mint
      '#808000', // Olive
      '#ffd8b1', // Apricot
      '#000075', // Navy
      '#808080', // Grey
      '#ffffff', // White
      '#000000'  // Black
    ];
    
    console.log(`🎨 Initialized ${this.colorPalette.length} distinct colors`);
  }
  
  /**
   * Get color for a cluster
   */
  public getColorForCluster(clusterId: number): string {
    // Cycle through available colors based on cluster ID
    const colorIndex = clusterId % this.colorPalette.length;
    return this.colorPalette[colorIndex];
  }
  
  /**
   * Get all available colors
   */
  public getAllColors(): string[] {
    return [...this.colorPalette];
  }
  
  /**
   * Get cluster color mapping for display
   */
  public getClusterColorMapping(): Array<{clusterId: number, color: string}> {
    const mapping: Array<{clusterId: number, color: string}> = [];
    
    // Assuming we have 16 clusters (0-15)
    for (let i = 0; i < 16; i++) {
      mapping.push({
        clusterId: i,
        color: this.getColorForCluster(i)
      });
    }
    
    return mapping;
  }
} 