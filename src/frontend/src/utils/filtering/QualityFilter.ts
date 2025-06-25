/**
 * 🎯 Quality Filter Manager
 * 
 * Manages quality-based filtering of nodes by minimum degree (citation count).
 * Integrates with the existing cluster filtering system.
 */

export interface QualityFilterSettings {
  enabled: boolean;
  minDegree: number;
}

export interface QualityFilterStats {
  totalNodes: number;
  filteredNodes: number;
  averageDegree: number;
  minDegreeThreshold: number;
}

export class QualityFilter {
  private static instance: QualityFilter;
  private settings: QualityFilterSettings = {
    enabled: false,
    minDegree: 5
  };
  private changeCallbacks: (() => void)[] = [];

  private constructor() {
    // Load settings from localStorage if available
    this.loadSettings();
  }

  public static getInstance(): QualityFilter {
    if (!QualityFilter.instance) {
      QualityFilter.instance = new QualityFilter();
    }
    return QualityFilter.instance;
  }

  /**
   * Get current filter settings
   */
  public getSettings(): QualityFilterSettings {
    return { ...this.settings };
  }

  /**
   * Check if quality filtering is enabled
   */
  public isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Get minimum degree threshold
   */
  public getMinDegree(): number {
    return this.settings.minDegree;
  }

  /**
   * Enable/disable quality filtering
   */
  public setEnabled(enabled: boolean): void {
    if (this.settings.enabled !== enabled) {
      this.settings.enabled = enabled;
      console.log(`🎯 QualityFilter: ${enabled ? 'Enabled' : 'Disabled'} (min degree: ${this.settings.minDegree})`);
      this.saveSettings();
      this.notifyChange();
    }
  }

  /**
   * Set minimum degree threshold
   */
  public setMinDegree(minDegree: number): void {
    if (this.settings.minDegree !== minDegree) {
      this.settings.minDegree = Math.max(0, minDegree);
      console.log(`🎯 QualityFilter: Set min degree to ${this.settings.minDegree}`);
      this.saveSettings();
      this.notifyChange();
    }
  }

  /**
   * Toggle quality filtering on/off
   */
  public toggle(): void {
    this.setEnabled(!this.settings.enabled);
  }

  /**
   * Check if a node passes the quality filter
   */
  public passesFilter(degree: number): boolean {
    if (!this.settings.enabled) {
      return true;
    }
    return degree >= this.settings.minDegree;
  }

  /**
   * Filter nodes based on quality criteria
   */
  public filterNodes<T extends { degree: number }>(nodes: T[]): T[] {
    if (!this.settings.enabled) {
      return nodes;
    }
    return nodes.filter(node => this.passesFilter(node.degree));
  }

  /**
   * Get effective minimum degree for API calls
   * Returns the minimum degree if filtering is enabled, otherwise 0
   */
  public getEffectiveMinDegree(): number {
    return this.settings.enabled ? this.settings.minDegree : 0;
  }

  /**
   * Calculate quality filter statistics
   */
  public calculateStats<T extends { degree: number }>(allNodes: T[]): QualityFilterStats {
    const totalNodes = allNodes.length;
    const filteredNodes = this.settings.enabled 
      ? allNodes.filter(node => this.passesFilter(node.degree)).length 
      : totalNodes;
    
    const averageDegree = totalNodes > 0 
      ? allNodes.reduce((sum, node) => sum + node.degree, 0) / totalNodes 
      : 0;

    return {
      totalNodes,
      filteredNodes,
      averageDegree,
      minDegreeThreshold: this.settings.minDegree
    };
  }

  /**
   * Register callback for filter changes
   */
  public onChange(callback: () => void): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Remove change callback
   */
  public removeChangeCallback(callback: () => void): void {
    const index = this.changeCallbacks.indexOf(callback);
    if (index > -1) {
      this.changeCallbacks.splice(index, 1);
    }
  }

  /**
   * Notify listeners of filter changes
   */
  private notifyChange(): void {
    this.changeCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in quality filter change callback:', error);
      }
    });
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    try {
      localStorage.setItem('qualityFilterSettings', JSON.stringify(this.settings));
    } catch (error) {
      console.warn('Failed to save quality filter settings:', error);
    }
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): void {
    try {
      const saved = localStorage.getItem('qualityFilterSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = {
          enabled: parsed.enabled || false,
          minDegree: Math.max(0, parsed.minDegree || 5)
        };
        console.log(`🎯 QualityFilter: Loaded settings - enabled: ${this.settings.enabled}, minDegree: ${this.settings.minDegree}`);
      }
    } catch (error) {
      console.warn('Failed to load quality filter settings, using defaults:', error);
    }
  }

  /**
   * Reset to default settings
   */
  public reset(): void {
    this.settings = {
      enabled: false,
      minDegree: 5
    };
    this.saveSettings();
    this.notifyChange();
    console.log('🎯 QualityFilter: Reset to defaults');
  }

  /**
   * Export settings (for backup/sync)
   */
  public exportSettings(): QualityFilterSettings {
    return { ...this.settings };
  }

  /**
   * Import settings (for backup/sync)
   */
  public importSettings(settings: QualityFilterSettings): void {
    this.settings = {
      enabled: settings.enabled,
      minDegree: Math.max(0, settings.minDegree)
    };
    this.saveSettings();
    this.notifyChange();
    console.log(`🎯 QualityFilter: Imported settings - enabled: ${this.settings.enabled}, minDegree: ${this.settings.minDegree}`);
  }
} 