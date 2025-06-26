/**
 * 🏗️ Base Manager Class
 * 
 * Abstract base class that provides common patterns for all manager classes:
 * - Consistent initialization and cleanup
 * - Event handling
 * - Configuration management
 * - Error handling
 */

export interface ManagerConfig {
  debug?: boolean;
  name?: string;
}

export interface ManagerEvents {
  'initialized': {};
  'destroyed': {};
  'error': { error: Error; context: string };
}

export abstract class BaseManager<TConfig extends ManagerConfig = ManagerConfig> {
  protected config: TConfig;
  protected isInitialized: boolean = false;
  protected isDestroyed: boolean = false;
  protected eventListeners: Map<keyof ManagerEvents, Function[]> = new Map();
  protected readonly name: string;

  constructor(config: TConfig) {
    this.config = { ...config };
    this.name = config.name || this.constructor.name;
  }

  /**
   * Initialize the manager - must be implemented by subclasses
   */
  abstract initialize(): Promise<void>;

  /**
   * Cleanup resources - must be implemented by subclasses
   */
  abstract destroy(): void;

  /**
   * Get manager status
   */
  public getStatus(): { 
    initialized: boolean; 
    destroyed: boolean; 
    name: string; 
  } {
    return {
      initialized: this.isInitialized,
      destroyed: this.isDestroyed,
      name: this.name
    };
  }

  /**
   * Event handling
   */
  protected emit<K extends keyof ManagerEvents>(
    event: K, 
    data: ManagerEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${this.name} event listener for ${String(event)}:`, error);
      }
    });
  }

  public on<K extends keyof ManagerEvents>(
    event: K, 
    callback: (data: ManagerEvents[K]) => void
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  public off<K extends keyof ManagerEvents>(
    event: K, 
    callback: (data: ManagerEvents[K]) => void
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Protected helper for error handling
   */
  protected handleError(error: Error, context: string): void {
    const errorMessage = `${this.name} error in ${context}: ${error.message}`;
    console.error(errorMessage, error);
    this.emit('error', { error, context });
  }

  /**
   * Protected helper for safe initialization
   */
  protected async safeInitialize(initFn: () => Promise<void>): Promise<void> {
    if (this.isInitialized) {
      console.warn(`${this.name} already initialized`);
      return;
    }

    if (this.isDestroyed) {
      throw new Error(`Cannot initialize destroyed ${this.name}`);
    }

    try {
      await initFn();
      this.isInitialized = true;
      this.emit('initialized', {});
      
      if (this.config.debug) {
        console.log(`✅ ${this.name} initialized successfully`);
      }
    } catch (error) {
      this.handleError(error as Error, 'initialization');
      throw error;
    }
  }

  /**
   * Protected helper for safe cleanup
   */
  protected safeDestroy(destroyFn: () => void): void {
    if (this.isDestroyed) {
      console.warn(`${this.name} already destroyed`);
      return;
    }

    try {
      destroyFn();
      this.isDestroyed = true;
      this.isInitialized = false;
      this.emit('destroyed', {});
      
      // Clear all event listeners
      this.eventListeners.clear();
      
      if (this.config.debug) {
        console.log(`🗑️ ${this.name} destroyed successfully`);
      }
    } catch (error) {
      this.handleError(error as Error, 'destruction');
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<TConfig>): void {
    this.config = { ...this.config, ...updates };
    
    if (this.config.debug) {
      console.log(`⚙️ ${this.name} configuration updated`, updates);
    }
  }
} 