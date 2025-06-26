/**
 * 🏭 Service Factory
 * 
 * Factory class that configures and registers all services and strategies
 * in the dependency injection container for the UnifiedGraphManager.
 */

import { Sigma } from 'sigma';
import { ServiceContainer } from '../core/ServiceContainer';
import { AppConfig } from '../config/ConfigLoader';

// Service implementations
import { NodeServiceImpl, NodeServiceConfig } from '../services/NodeService';
import { EdgeServiceImpl, EdgeServiceConfig } from '../services/EdgeService';
import { ViewportServiceImpl, ViewportServiceConfig } from '../services/ViewportService';
import { CoordinateManager } from '../coordinates/CoordinateManager';

// Strategy implementations
import { StandardLoadingStrategy, StandardLoadingConfig } from '../strategies/StandardLoadingStrategy';
import { StandardRenderingStrategy, StandardRenderingConfig } from '../strategies/StandardRenderingStrategy';
import { EnhancedLoadingStrategy } from '../strategies/EnhancedLoadingStrategy';

export class ServiceFactory {
  private container: ServiceContainer;

  constructor() {
    this.container = new ServiceContainer();
  }

  /**
   * Register all services and strategies for the given Sigma instance and configuration
   */
  registerServices(sigma: Sigma, appConfig: AppConfig): ServiceContainer {
    // Create service configurations from app config
    const nodeServiceConfig: NodeServiceConfig = {
      maxNodes: appConfig.memory.maxTotalNodes,
      spatialIndexing: appConfig.memory.spatialOptimization.enabled,
      memoryManagement: true,
      debug: appConfig.debug.enablePerformanceLogging,
      name: 'NodeService'
    };

    const edgeServiceConfig: EdgeServiceConfig = {
      maxEdges: appConfig.memory.maxTotalEdges,
      cacheEdges: true,
      enableTreeEdges: true,
      debug: appConfig.debug.enableEdgeLogging,
      name: 'EdgeService'
    };

    const viewportServiceConfig: ViewportServiceConfig = {
      debounceMs: 300,
      changeThreshold: 0.1,
      paddingFactor: appConfig.viewport.paddingFactor,
      debug: appConfig.debug.enableLODLogging,
      name: 'ViewportService'
    };

    // Register core services
    this.container.registerClass(
      'NodeService',
      NodeServiceImpl,
      'singleton',
      []
    );

    this.container.registerClass(
      'EdgeService', 
      EdgeServiceImpl,
      'singleton',
      []
    );

    this.container.registerClass(
      'ViewportService',
      ViewportServiceImpl,
      'singleton',
      []
    );

    // Register service instances with proper configuration
    this.container.register(
      'NodeService',
      () => new NodeServiceImpl(sigma, nodeServiceConfig),
      'singleton'
    );

    this.container.register(
      'EdgeService',
      () => new EdgeServiceImpl(sigma, edgeServiceConfig),
      'singleton'
    );

    this.container.register(
      'ViewportService',
      () => new ViewportServiceImpl(sigma, viewportServiceConfig),
      'singleton'
    );

    // Register CoordinateManager with default scale
    this.container.register(
      'CoordinateManager',
      (container) => new CoordinateManager(
        container.resolve<Sigma>('Sigma'),
        container.resolve<AppConfig>('AppConfig').viewport.coordinateScale || 1.0
      ),
      'singleton',
      ['Sigma', 'AppConfig']
    );

    // Create strategy configurations
    const standardLoadingConfig: StandardLoadingConfig = {
      batchSize: appConfig.performance.loading.batchSize,
      maxNodes: appConfig.lod.maxNodes.universe,
      maxEdges: appConfig.backend.maxEdgeLimit,
      minDegree: appConfig.lod.minDegree.universe,
      timeout: appConfig.performance.api.timeout,
      debug: appConfig.debug.enablePerformanceLogging
    };

    const enhancedLoadingConfig = {
      batchSize: appConfig.performance.loading.batchSize,
      maxNodes: appConfig.lod.maxNodes.universe,
      maxEdges: appConfig.backend.maxEdgeLimit,
      minDegree: appConfig.lod.minDegree.universe,
      timeout: appConfig.performance.api.timeout,
      debug: appConfig.debug.enablePerformanceLogging,
      lod: appConfig.lod,
      performance: appConfig.performance,
      viewport: appConfig.viewport
    };

    const standardRenderingConfig: StandardRenderingConfig = {
      nodes: {
        defaultSize: appConfig.visual.nodes.defaultSize,
        minSize: appConfig.visual.nodes.minSize,
        maxSize: appConfig.visual.nodes.maxSize,
        defaultColor: appConfig.visual.nodes.defaultColor,
        sizeScale: 2.0
      },
      edges: {
        defaultSize: appConfig.visual.edges.defaultSize,
        minSize: appConfig.visual.edges.minSize,
        maxSize: appConfig.visual.edges.maxSize,
        defaultColor: appConfig.visual.edges.defaultColor,
        treeEdgeColor: 'rgba(68, 68, 68, 0.8)'
      },
      lod: {
        hideLabelsThreshold: 5,
        hideEdgesThreshold: 10,
        nodeDetailThreshold: 20
      },
      clusters: {
        colors: [
          '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
          '#1abc9c', '#e67e22', '#34495e', '#f1c40f', '#e91e63',
          '#00bcd4', '#4caf50', '#ff9800', '#673ab7', '#795548', '#607d8b'
        ],
        defaultColor: '#888888'
      },
      debug: appConfig.debug.enableLODLogging
    };

    // Register loading strategies
    this.container.register(
      'standardLoadingStrategy',
      () => new StandardLoadingStrategy(standardLoadingConfig),
      'singleton'
    );

    this.container.register(
      'enhancedLoadingStrategy',
      (container) => {
        const viewportService = container.resolve<ViewportServiceImpl>('ViewportService');
        return new EnhancedLoadingStrategy(enhancedLoadingConfig, sigma, viewportService);
      },
      'singleton',
      ['ViewportService']
    );

    // Register rendering strategies
    this.container.register(
      'standardRenderingStrategy',
      () => new StandardRenderingStrategy(standardRenderingConfig),
      'singleton'
    );

    // Register app config and sigma instances for easy access
    this.container.registerInstance('AppConfig', appConfig);
    this.container.registerInstance('Sigma', sigma);
    this.container.registerInstance('Graph', sigma.getGraph());

    console.log('🏭 ServiceFactory: Registered all services and strategies');
    
    return this.container;
  }

  /**
   * Validate all service dependencies
   */
  validateServices(): string[] {
    const errors = this.container.validateDependencies();
    
    if (errors.length > 0) {
      console.error('🏭 ServiceFactory: Dependency validation errors:', errors);
    } else {
      console.log('🏭 ServiceFactory: All dependencies validated successfully');
    }
    
    return errors;
  }

  /**
   * Initialize all registered services
   */
  async initializeServices(): Promise<void> {
    try {
      // Initialize services in the correct order
      const nodeService = this.container.resolve<NodeServiceImpl>('NodeService');
      const edgeService = this.container.resolve<EdgeServiceImpl>('EdgeService');
      const viewportService = this.container.resolve<ViewportServiceImpl>('ViewportService');

      await nodeService.initialize();
      await edgeService.initialize();
      await viewportService.initialize();

      console.log('🏭 ServiceFactory: All services initialized successfully');
    } catch (error) {
      console.error('🏭 ServiceFactory: Error initializing services:', error);
      throw error;
    }
  }

  /**
   * Get the configured service container
   */
  getContainer(): ServiceContainer {
    return this.container;
  }

  /**
   * Create a scoped container for isolated contexts
   */
  createScope(): ServiceContainer {
    return this.container.createScope();
  }

  /**
   * Cleanup all services
   */
  cleanup(): void {
    this.container.dispose();
    console.log('🏭 ServiceFactory: Cleanup completed');
  }

  /**
   * Get service statistics
   */
  getStats(): any {
    return {
      container: this.container.getStats(),
      services: {
        registered: this.container.getServiceNames(),
        count: this.container.getServiceNames().length
      }
    };
  }

  /**
   * 🚀 Create Enhanced Loading Strategy with full config support
   */
  public createEnhancedLoadingStrategy(sigma: Sigma, config: any): any {
    try {
      // Import the enhanced strategy dynamically to avoid circular dependencies
      const { EnhancedLoadingStrategy } = require('../strategies/EnhancedLoadingStrategy');
      
      // Create configuration for enhanced strategy
      const enhancedConfig = {
        batchSize: config.performance?.loading?.batchSize || 100,
        maxNodes: config.lod?.maxNodes?.paper || 10000,
        maxEdges: config.memory?.maxTotalEdges || 20000,
        minDegree: config.lod?.minDegree?.paper || 1,
        timeout: config.performance?.api?.timeout || 10000,
        debug: config.debug?.enableLODLogging || false,
        lod: config.lod,
        performance: config.performance,
        viewport: config.viewport
      };
      
      const strategy = new EnhancedLoadingStrategy(enhancedConfig, sigma);
      
      console.log('🏭 ServiceFactory: Created EnhancedLoadingStrategy with LOD support');
      return strategy;
      
    } catch (error) {
      console.error('🏭 ServiceFactory: Error creating EnhancedLoadingStrategy:', error);
      
      // Fallback to standard strategy
      console.log('🏭 ServiceFactory: Falling back to StandardLoadingStrategy');
      return this.createStandardLoadingStrategy(sigma, config);
    }
  }
} 