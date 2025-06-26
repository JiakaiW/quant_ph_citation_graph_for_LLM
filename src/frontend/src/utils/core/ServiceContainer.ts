/**
 * 🏗️ Service Container - Dependency Injection
 * 
 * Provides dependency injection and service management for the application.
 * Eliminates tight coupling between classes and makes testing easier.
 * 
 * Features:
 * - Service registration and resolution
 * - Singleton and transient service lifetimes
 * - Scoped containers for isolated contexts
 * - Automatic dependency resolution
 * - Service factory support
 */

export type ServiceLifetime = 'singleton' | 'transient' | 'scoped';

export interface ServiceDescriptor<T = any> {
  name: string;
  factory: (container: ServiceContainer) => T;
  lifetime: ServiceLifetime;
  instance?: T;
  dependencies?: string[];
}

export interface ServiceRegistration {
  name: string;
  lifetime: ServiceLifetime;
  dependencies?: string[];
}

export class ServiceContainer {
  private services: Map<string, ServiceDescriptor> = new Map();
  private singletonInstances: Map<string, any> = new Map();
  private parentContainer?: ServiceContainer;
  private isDisposed: boolean = false;

  constructor(parentContainer?: ServiceContainer) {
    this.parentContainer = parentContainer;
  }

  /**
   * Register a service with factory function
   */
  register<T>(
    name: string,
    factory: (container: ServiceContainer) => T,
    lifetime: ServiceLifetime = 'singleton',
    dependencies: string[] = []
  ): ServiceContainer {
    if (this.isDisposed) {
      throw new Error('Cannot register services in disposed container');
    }

    this.services.set(name, {
      name,
      factory,
      lifetime,
      dependencies
    });

    console.log(`📦 Registered service: ${name} (${lifetime})`);
    return this;
  }

  /**
   * Register a service instance directly
   */
  registerInstance<T>(name: string, instance: T): ServiceContainer {
    if (this.isDisposed) {
      throw new Error('Cannot register services in disposed container');
    }

    this.services.set(name, {
      name,
      factory: () => instance,
      lifetime: 'singleton',
      instance
    });

    this.singletonInstances.set(name, instance);
    console.log(`📦 Registered instance: ${name}`);
    return this;
  }

  /**
   * Register a service class with automatic dependency injection
   */
  registerClass<T>(
    name: string,
    ServiceClass: new (...args: any[]) => T,
    lifetime: ServiceLifetime = 'singleton',
    dependencies: string[] = []
  ): ServiceContainer {
    return this.register(
      name,
      (container) => {
        const deps = dependencies.map(dep => container.resolve(dep));
        return new ServiceClass(...deps);
      },
      lifetime,
      dependencies
    );
  }

  /**
   * Resolve a service by name
   */
  resolve<T>(name: string): T {
    if (this.isDisposed) {
      throw new Error('Cannot resolve services from disposed container');
    }

    // Try current container first
    const descriptor = this.services.get(name);
    if (descriptor) {
      return this.createInstance<T>(descriptor);
    }

    // Try parent container
    if (this.parentContainer) {
      return this.parentContainer.resolve<T>(name);
    }

    throw new Error(`Service '${name}' not found`);
  }

  /**
   * Try to resolve a service, return null if not found
   */
  tryResolve<T>(name: string): T | null {
    try {
      return this.resolve<T>(name);
    } catch {
      return null;
    }
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name) || 
           (this.parentContainer?.has(name) ?? false);
  }

  /**
   * Get all registered service names
   */
  getServiceNames(): string[] {
    const names = Array.from(this.services.keys());
    if (this.parentContainer) {
      names.push(...this.parentContainer.getServiceNames());
    }
    return [...new Set(names)];
  }

  /**
   * Create a scoped container
   */
  createScope(): ServiceContainer {
    return new ServiceContainer(this);
  }

  /**
   * Dispose the container and cleanup resources
   */
  dispose(): void {
    if (this.isDisposed) return;

    // Dispose singleton instances that implement dispose
    for (const [name, instance] of this.singletonInstances) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          instance.dispose();
          console.log(`🗑️ Disposed service: ${name}`);
        } catch (error) {
          console.error(`Error disposing service ${name}:`, error);
        }
      }
    }

    this.services.clear();
    this.singletonInstances.clear();
    this.isDisposed = true;

    console.log('🗑️ Service container disposed');
  }

  /**
   * Create service instance based on lifetime
   */
  private createInstance<T>(descriptor: ServiceDescriptor): T {
    switch (descriptor.lifetime) {
      case 'singleton':
        return this.getSingletonInstance<T>(descriptor);
      
      case 'transient':
        return descriptor.factory(this);
      
      case 'scoped':
        // For scoped, we use the current container's singleton map
        // This ensures scoped instances are singletons within their scope
        return this.getSingletonInstance<T>(descriptor);
      
      default:
        throw new Error(`Unknown service lifetime: ${descriptor.lifetime}`);
    }
  }

  /**
   * Get or create singleton instance
   */
  private getSingletonInstance<T>(descriptor: ServiceDescriptor): T {
    if (descriptor.instance) {
      return descriptor.instance;
    }

    let instance = this.singletonInstances.get(descriptor.name);
    if (!instance) {
      instance = descriptor.factory(this);
      this.singletonInstances.set(descriptor.name, instance);
      
      // Store in descriptor for quick access
      descriptor.instance = instance;
    }

    return instance;
  }

  /**
   * Validate service dependencies (detect circular dependencies)
   */
  validateDependencies(): string[] {
    const errors: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (serviceName: string, path: string[] = []) => {
      if (visiting.has(serviceName)) {
        errors.push(`Circular dependency detected: ${path.join(' -> ')} -> ${serviceName}`);
        return;
      }

      if (visited.has(serviceName)) {
        return;
      }

      const descriptor = this.services.get(serviceName);
      if (!descriptor) {
        if (!this.parentContainer?.has(serviceName)) {
          errors.push(`Missing dependency: ${serviceName}`);
        }
        return;
      }

      visiting.add(serviceName);
      const newPath = [...path, serviceName];

      if (descriptor.dependencies) {
        for (const dep of descriptor.dependencies) {
          visit(dep, newPath);
        }
      }

      visiting.delete(serviceName);
      visited.add(serviceName);
    };

    for (const serviceName of this.services.keys()) {
      visit(serviceName);
    }

    return errors;
  }

  /**
   * Get container statistics
   */
  getStats(): {
    totalServices: number;
    singletonInstances: number;
    parentContainer: boolean;
    serviceNames: string[];
  } {
    return {
      totalServices: this.services.size,
      singletonInstances: this.singletonInstances.size,
      parentContainer: !!this.parentContainer,
      serviceNames: this.getServiceNames()
    };
  }
} 