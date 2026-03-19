/**
 * VSCode MCP Client - Service Manager
 * Integrates cache and registry for comprehensive service management
 */

import { EventEmitter } from 'events';
import { CacheManager, CacheConfig, CacheKey } from '../cache/CacheManager';
import { ServiceRegistry, ServiceRegistryConfig, RegisteredService, ServiceQuery } from '../registry/ServiceRegistry';
import {
  McpServerDefinition,
  McpTool,
  McpResource,
  McpPrompt,
  ConnectionState,
  ServerCapabilities,
} from '../types/mcpTypes';

// ==================== Service Manager Configuration ====================

export interface ServiceManagerConfig {
  cache: Partial<CacheConfig>;
  registry: Partial<ServiceRegistryConfig>;
  enableSmartCaching: boolean;
  cacheInvalidationStrategy: 'aggressive' | 'conservative' | 'smart';
  enableCrossServiceOptimization: boolean;
}

const DEFAULT_SERVICE_MANAGER_CONFIG: ServiceManagerConfig = {
  cache: {
    maxSize: 500,
    defaultTtl: 5 * 60 * 1000, // 5 minutes
    maxMemoryMB: 25,
  },
  registry: {
    enableDiscovery: true,
    healthCheckIntervalMs: 60000,
  },
  enableSmartCaching: true,
  cacheInvalidationStrategy: 'smart',
  enableCrossServiceOptimization: true,
};

// ==================== Service Events ====================

export interface ServiceManagerEvents {
  serviceRegistered: { serviceId: string; service: RegisteredService };
  serviceUnregistered: { serviceId: string };
  serviceUpdated: { serviceId: string; changes: string[] };
  cacheOptimized: { serverId: string; optimization: string };
  performanceReport: { report: ServicePerformanceReport };
}

// ==================== Performance Tracking ====================

export interface ServicePerformanceReport {
  timestamp: number;
  services: {
    total: number;
    active: number;
    healthy: number;
  };
  cache: {
    hitRate: number;
    memoryUsageMB: number;
    entries: number;
  };
  recommendations: string[];
}

// ==================== Service Manager Implementation ====================

export class ServiceManager extends EventEmitter {
  private config: ServiceManagerConfig;
  private cacheManager: CacheManager;
  private serviceRegistry: ServiceRegistry;
  private performanceTimer: NodeJS.Timeout | null = null;

  // Performance tracking
  private performanceHistory: ServicePerformanceReport[] = [];
  private readonly MAX_PERFORMANCE_HISTORY = 100;

  public static readonly EVENTS = {
    SERVICE_REGISTERED: 'serviceRegistered',
    SERVICE_UNREGISTERED: 'serviceUnregistered',
    SERVICE_UPDATED: 'serviceUpdated',
    CACHE_OPTIMIZED: 'cacheOptimized',
    PERFORMANCE_REPORT: 'performanceReport',
  } as const;

  constructor(config: Partial<ServiceManagerConfig> = {}) {
    super();
    
    this.config = { ...DEFAULT_SERVICE_MANAGER_CONFIG, ...config };
    
    // Initialize components
    this.cacheManager = new CacheManager(this.config.cache);
    this.serviceRegistry = new ServiceRegistry(this.config.registry);
    
    this.setupEventHandlers();
    this.startPerformanceMonitoring();
  }

  // ==================== Service Management API ====================

  /**
   * Register a new service
   */
  async registerService(definition: McpServerDefinition): Promise<string> {
    const serviceId = this.serviceRegistry.register(definition, {
      tags: ['managed'],
      registeredAt: Date.now(),
    });

    // Clear any existing cache for this service
    this.cacheManager.invalidateServer(serviceId);

    this.emit(ServiceManager.EVENTS.SERVICE_REGISTERED, {
      serviceId,
      service: this.serviceRegistry.getService(serviceId)!,
    });

    return serviceId;
  }

  /**
   * Unregister a service
   */
  async unregisterService(serviceId: string): Promise<boolean> {
    const success = this.serviceRegistry.unregister(serviceId);
    
    if (success) {
      // Clear all cache entries for this service
      this.cacheManager.invalidateServer(serviceId);
      
      this.emit(ServiceManager.EVENTS.SERVICE_UNREGISTERED, { serviceId });
    }

    return success;
  }

  /**
   * Update service state
   */
  updateServiceState(serviceId: string, state: ConnectionState): boolean {
    const success = this.serviceRegistry.updateService(serviceId, { state });
    
    if (success && this.config.enableSmartCaching) {
      this.optimizeCacheForService(serviceId, state);
    }

    return success;
  }

  /**
   * Update service capabilities
   */
  updateServiceCapabilities(serviceId: string, capabilities: ServerCapabilities): boolean {
    return this.serviceRegistry.updateService(serviceId, { capabilities });
  }

  // ==================== Cached Service Operations ====================

  /**
   * Get tools with caching
   */
  async getTools(serviceId: string, options: { useCache?: boolean; forceFresh?: boolean } = {}): Promise<McpTool[]> {
    const cacheKey: CacheKey = {
      type: 'tools',
      serverId: serviceId,
      identifier: 'list',
    };

    // Check cache first (unless force fresh)
    if (!options.forceFresh && (options.useCache !== false)) {
      const cached = this.cacheManager.get<McpTool[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Get from service (mock implementation - would call actual service)
    const service = this.serviceRegistry.getService(serviceId);
    if (!service || service.state !== 'running') {
      throw new Error(`Service ${serviceId} is not available`);
    }

    const tools = service.tools; // In real implementation, this would be fetched from the service

    // Cache the result
    if (this.config.enableSmartCaching) {
      const ttl = this.calculateOptimalTtl('tools', serviceId);
      this.cacheManager.set(cacheKey, tools, ttl);
    }

    return tools;
  }

  /**
   * Get resources with caching
   */
  async getResources(serviceId: string, options: { useCache?: boolean; forceFresh?: boolean } = {}): Promise<McpResource[]> {
    const cacheKey: CacheKey = {
      type: 'resources',
      serverId: serviceId,
      identifier: 'list',
    };

    if (!options.forceFresh && (options.useCache !== false)) {
      const cached = this.cacheManager.get<McpResource[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const service = this.serviceRegistry.getService(serviceId);
    if (!service || service.state !== 'running') {
      throw new Error(`Service ${serviceId} is not available`);
    }

    const resources = service.resources;

    if (this.config.enableSmartCaching) {
      const ttl = this.calculateOptimalTtl('resources', serviceId);
      this.cacheManager.set(cacheKey, resources, ttl);
    }

    return resources;
  }

  /**
   * Get prompts with caching
   */
  async getPrompts(serviceId: string, options: { useCache?: boolean; forceFresh?: boolean } = {}): Promise<McpPrompt[]> {
    const cacheKey: CacheKey = {
      type: 'prompts',
      serverId: serviceId,
      identifier: 'list',
    };

    if (!options.forceFresh && (options.useCache !== false)) {
      const cached = this.cacheManager.get<McpPrompt[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const service = this.serviceRegistry.getService(serviceId);
    if (!service || service.state !== 'running') {
      throw new Error(`Service ${serviceId} is not available`);
    }

    const prompts = service.prompts;

    if (this.config.enableSmartCaching) {
      const ttl = this.calculateOptimalTtl('prompts', serviceId);
      this.cacheManager.set(cacheKey, prompts, ttl);
    }

    return prompts;
  }

  // ==================== Service Discovery and Querying ====================

  /**
   * Find services by query
   */
  findServices(query: ServiceQuery): RegisteredService[] {
    return this.serviceRegistry.queryServices(query);
  }

  /**
   * Find services with specific capability
   */
  findServicesByCapability(capability: string): RegisteredService[] {
    return this.serviceRegistry.findByCapability(capability);
  }

  /**
   * Get all healthy services
   */
  getHealthyServices(): RegisteredService[] {
    return this.serviceRegistry.findHealthyServices();
  }

  /**
   * Get service by ID
   */
  getService(serviceId: string): RegisteredService | null {
    return this.serviceRegistry.getService(serviceId);
  }

  // ==================== Cache Management ====================

  /**
   * Clear cache for specific service
   */
  clearServiceCache(serviceId: string): number {
    return this.cacheManager.invalidateServer(serviceId);
  }

  /**
   * Clear cache by type
   */
  clearCacheByType(type: string, serviceId?: string): number {
    return this.cacheManager.invalidateByType(type as any, serviceId);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.cacheManager.clear();
  }

  // ==================== Smart Optimization ====================

  /**
   * Optimize cache for a specific service based on its state
   */
  private optimizeCacheForService(serviceId: string, state: ConnectionState): void {
    let optimization = '';

    switch (state) {
      case 'error':
      case 'disconnecting':
        // Clear cache when service goes offline
        this.cacheManager.invalidateServer(serviceId);
        optimization = 'cleared-cache-offline';
        break;

      case 'running':
        // Extend TTL for stable services
        if (this.isServiceStable(serviceId)) {
          optimization = 'extended-ttl-stable';
        }
        break;

      case 'starting':
        // Pre-warm cache if needed
        optimization = 'prepare-for-connection';
        break;
    }

    if (optimization) {
      this.emit(ServiceManager.EVENTS.CACHE_OPTIMIZED, {
        serverId: serviceId,
        optimization,
      });
    }
  }

  /**
   * Calculate optimal TTL based on service behavior
   */
  private calculateOptimalTtl(type: string, serviceId: string): number {
    const service = this.serviceRegistry.getService(serviceId);
    if (!service) {
      return this.config.cache.defaultTtl || 300000; // 5 minutes default
    }

    const baseConfig = this.config.cache;
    let ttl = baseConfig.defaultTtl || 300000;

    // Adjust based on service health and stability
    if (service.health.status === 'healthy' && this.isServiceStable(serviceId)) {
      ttl *= 2; // Double TTL for stable services
    } else if (service.health.status === 'degraded') {
      ttl *= 0.5; // Halve TTL for degraded services
    }

    // Adjust based on content type
    switch (type) {
      case 'tools':
        // Tools change less frequently
        ttl *= 1.5;
        break;
      case 'resources':
        // Resources might change more often
        ttl *= 0.8;
        break;
      case 'prompts':
        // Prompts are usually stable
        ttl *= 1.2;
        break;
    }

    return Math.max(30000, Math.min(ttl, 30 * 60 * 1000)); // Between 30s and 30min
  }

  /**
   * Check if service is considered stable
   */
  private isServiceStable(serviceId: string): boolean {
    const service = this.serviceRegistry.getService(serviceId);
    if (!service) return false;

    const now = Date.now();
    const uptime = now - (service.metadata.registeredAt || now);
    const isLongRunning = uptime > 10 * 60 * 1000; // 10 minutes
    const isHealthy = service.health.status === 'healthy';
    const hasLowErrorRate = service.health.errorCount < 5;

    return isLongRunning && isHealthy && hasLowErrorRate;
  }

  // ==================== Performance Monitoring ====================

  private startPerformanceMonitoring(): void {
    this.performanceTimer = setInterval(() => {
      this.generatePerformanceReport();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private generatePerformanceReport(): void {
    const registryStats = this.serviceRegistry.getStats();
    const cacheStats = this.cacheManager.getStats();

    const report: ServicePerformanceReport = {
      timestamp: Date.now(),
      services: {
        total: registryStats.activeServices,
        active: registryStats.activeServices,
        healthy: registryStats.healthyServices,
      },
      cache: {
        hitRate: cacheStats.hits / (cacheStats.hits + cacheStats.misses) || 0,
        memoryUsageMB: cacheStats.memoryUsage / (1024 * 1024),
        entries: cacheStats.entries,
      },
      recommendations: this.generateRecommendations(registryStats, cacheStats),
    };

    this.performanceHistory.push(report);
    if (this.performanceHistory.length > this.MAX_PERFORMANCE_HISTORY) {
      this.performanceHistory.shift();
    }

    this.emit(ServiceManager.EVENTS.PERFORMANCE_REPORT, { report });
  }

  private generateRecommendations(registryStats: any, cacheStats: any): string[] {
    const recommendations: string[] = [];

    // Cache hit rate recommendations
    const hitRate = cacheStats.hits / (cacheStats.hits + cacheStats.misses) || 0;
    if (hitRate < 0.5) {
      recommendations.push('Consider increasing cache TTL - low hit rate detected');
    } else if (hitRate > 0.9) {
      recommendations.push('Cache performing well - consider reducing TTL to save memory');
    }

    // Memory usage recommendations
    const memoryUsageMB = cacheStats.memoryUsage / (1024 * 1024);
    if (memoryUsageMB > (this.config.cache.maxMemoryMB || 50) * 0.8) {
      recommendations.push('High memory usage - consider reducing cache size or TTL');
    }

    // Service health recommendations
    const healthyRatio = registryStats.healthyServices / registryStats.activeServices || 0;
    if (healthyRatio < 0.8) {
      recommendations.push('Multiple unhealthy services detected - check service configurations');
    }

    return recommendations;
  }

  // ==================== Event Handling ====================

  private setupEventHandlers(): void {
    // Registry events
    this.serviceRegistry.on(ServiceRegistry.EVENTS.SERVICE_UPDATED, (event) => {
      this.emit(ServiceManager.EVENTS.SERVICE_UPDATED, {
        serviceId: event.serviceId,
        changes: event.changes,
      });

      // Smart cache invalidation based on what changed
      if (this.config.cacheInvalidationStrategy === 'smart') {
        this.smartInvalidateCache(event.serviceId, event.changes);
      } else if (this.config.cacheInvalidationStrategy === 'aggressive') {
        this.cacheManager.invalidateServer(event.serviceId);
      }
    });

    // Cache events for optimization
    this.cacheManager.on(CacheManager.EVENTS.MEMORY_WARNING, () => {
      // Implement memory pressure response
      this.handleMemoryPressure();
    });
  }

  private smartInvalidateCache(serviceId: string, changes: string[]): void {
    for (const change of changes) {
      switch (change) {
        case 'tools':
          this.cacheManager.invalidateByType('tools', serviceId);
          break;
        case 'resources':
          this.cacheManager.invalidateByType('resources', serviceId);
          break;
        case 'prompts':
          this.cacheManager.invalidateByType('prompts', serviceId);
          break;
        case 'state':
          // State changes might affect all cached data
          this.cacheManager.invalidateServer(serviceId);
          break;
      }
    }
  }

  private handleMemoryPressure(): void {
    // Implement memory pressure relief strategies
    const cacheInfo = this.cacheManager.getInfo();
    
    if (cacheInfo.memoryUsageMB > (this.config.cache.maxMemoryMB || 50) * 0.9) {
      // Reduce TTL for new cache entries temporarily
      // This would be implemented by adjusting the cache configuration
    }
  }

  // ==================== Statistics and Info ====================

  getStats(): {
    services: ReturnType<ServiceRegistry['getStats']>;
    cache: ReturnType<CacheManager['getStats']>;
    performance: ServicePerformanceReport[];
  } {
    return {
      services: this.serviceRegistry.getStats(),
      cache: this.cacheManager.getStats(),
      performance: [...this.performanceHistory],
    };
  }

  getInfo(): {
    config: ServiceManagerConfig;
    stats: ReturnType<ServiceManager['getStats']>;
    recommendations: string[];
  } {
    const stats = this.getStats();
    const latestReport = this.performanceHistory[this.performanceHistory.length - 1];
    
    return {
      config: { ...this.config },
      stats,
      recommendations: latestReport?.recommendations || [],
    };
  }

  // ==================== Disposal ====================

  async dispose(): Promise<void> {
    if (this.performanceTimer) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = null;
    }

    this.cacheManager.dispose();
    this.serviceRegistry.dispose();
    this.removeAllListeners();
  }
}