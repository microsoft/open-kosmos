/**
 * VSCode MCP Client - Service Registry
 * Centralized service discovery and management system
 */

import { EventEmitter } from 'events';
import {
  McpServerDefinition,
  McpTool,
  McpResource,
  McpPrompt,
  ConnectionState,
  ServerCapabilities,
} from '../types/mcpTypes';

// ==================== Registry Types ====================

export interface ServiceRegistryConfig {
  enableDiscovery: boolean;
  discoveryIntervalMs: number;
  healthCheckIntervalMs: number;
  maxServiceAge: number;
  enablePersistence: boolean;
  persistencePath?: string;
}

const DEFAULT_REGISTRY_CONFIG: ServiceRegistryConfig = {
  enableDiscovery: true,
  discoveryIntervalMs: 30000, // 30 seconds
  healthCheckIntervalMs: 60000, // 1 minute
  maxServiceAge: 24 * 60 * 60 * 1000, // 24 hours
  enablePersistence: false,
};

// ==================== Service Information ====================

export interface RegisteredService {
  definition: McpServerDefinition;
  state: ConnectionState;
  capabilities: ServerCapabilities;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  metadata: ServiceMetadata;
  health: ServiceHealth;
}

export interface ServiceMetadata {
  registeredAt: number;
  lastUpdated: number;
  lastSeen: number;
  version?: string;
  tags: string[];
  description?: string;
  author?: string;
  homepage?: string;
}

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastHealthCheck: number;
  responseTime?: number;
  errorCount: number;
  lastError?: Error;
  uptime?: number;
}

// ==================== Discovery Types ====================

export interface ServiceDiscoveryProvider {
  name: string;
  discover(): Promise<McpServerDefinition[]>;
  isAvailable(): boolean;
}

export interface ServiceQuery {
  name?: string;
  tags?: string[];
  capabilities?: string[];
  transport?: string;
  state?: ConnectionState;
  healthy?: boolean;
}

// ==================== Events ====================

export interface ServiceRegistryEvents {
  serviceRegistered: { service: RegisteredService };
  serviceUnregistered: { serviceId: string; service: RegisteredService };
  serviceUpdated: { serviceId: string; service: RegisteredService; changes: string[] };
  serviceHealthChanged: { serviceId: string; oldHealth: ServiceHealth; newHealth: ServiceHealth };
  discoveryCompleted: { found: number; updated: number; errors: string[] };
  registryCleared: {};
}

// ==================== Service Registry Implementation ====================

export class ServiceRegistry extends EventEmitter {
  private config: ServiceRegistryConfig;
  private services = new Map<string, RegisteredService>();
  private discoveryProviders = new Map<string, ServiceDiscoveryProvider>();
  private discoveryTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalRegistered: 0,
    activeServices: 0,
    healthyServices: 0,
    totalDiscoveries: 0,
    lastDiscovery: 0,
  };

  public static readonly EVENTS = {
    SERVICE_REGISTERED: 'serviceRegistered',
    SERVICE_UNREGISTERED: 'serviceUnregistered',
    SERVICE_UPDATED: 'serviceUpdated',
    SERVICE_HEALTH_CHANGED: 'serviceHealthChanged',
    DISCOVERY_COMPLETED: 'discoveryCompleted',
    REGISTRY_CLEARED: 'registryCleared',
  } as const;

  constructor(config: Partial<ServiceRegistryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    
    if (this.config.enableDiscovery) {
      this.startDiscovery();
    }
    
    this.startHealthChecks();
  }

  // ==================== Service Registration ====================

  /**
   * Register a new service
   */
  register(definition: McpServerDefinition, metadata?: Partial<ServiceMetadata>): string {
    const serviceId = this.generateServiceId(definition);
    const now = Date.now();

    const existingService = this.services.get(serviceId);
    const serviceMetadata: ServiceMetadata = {
      registeredAt: existingService?.metadata.registeredAt || now,
      lastUpdated: now,
      lastSeen: now,
      tags: [],
      ...metadata,
    };

    const service: RegisteredService = {
      definition,
      state: 'stopped',
      capabilities: {},
      tools: [],
      resources: [],
      prompts: [],
      metadata: serviceMetadata,
      health: {
        status: 'unknown',
        lastHealthCheck: 0,
        errorCount: 0,
      },
    };

    this.services.set(serviceId, service);
    this.stats.totalRegistered++;
    this.updateActiveCount();

    this.emit(ServiceRegistry.EVENTS.SERVICE_REGISTERED, { service });
    return serviceId;
  }

  /**
   * Unregister a service
   */
  unregister(serviceId: string): boolean {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    this.services.delete(serviceId);
    this.updateActiveCount();

    this.emit(ServiceRegistry.EVENTS.SERVICE_UNREGISTERED, { serviceId, service });
    return true;
  }

  /**
   * Update service information
   */
  updateService(
    serviceId: string,
    updates: Partial<Pick<RegisteredService, 'state' | 'capabilities' | 'tools' | 'resources' | 'prompts'>>
  ): boolean {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    const changes: string[] = [];
    const oldService = { ...service };

    if (updates.state !== undefined && updates.state !== service.state) {
      service.state = updates.state;
      changes.push('state');
    }

    if (updates.capabilities !== undefined) {
      service.capabilities = { ...updates.capabilities };
      changes.push('capabilities');
    }

    if (updates.tools !== undefined) {
      service.tools = [...updates.tools];
      changes.push('tools');
    }

    if (updates.resources !== undefined) {
      service.resources = [...updates.resources];
      changes.push('resources');
    }

    if (updates.prompts !== undefined) {
      service.prompts = [...updates.prompts];
      changes.push('prompts');
    }

    if (changes.length > 0) {
      service.metadata.lastUpdated = Date.now();
      service.metadata.lastSeen = Date.now();
      this.updateActiveCount();

      this.emit(ServiceRegistry.EVENTS.SERVICE_UPDATED, { serviceId, service, changes });
    }

    return changes.length > 0;
  }

  /**
   * Update service health
   */
  updateHealth(serviceId: string, health: Partial<ServiceHealth>): boolean {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    const oldHealth = { ...service.health };
    service.health = { ...service.health, ...health };
    service.metadata.lastSeen = Date.now();

    if (oldHealth.status !== service.health.status) {
      this.updateHealthyCount();
      this.emit(ServiceRegistry.EVENTS.SERVICE_HEALTH_CHANGED, {
        serviceId,
        oldHealth,
        newHealth: service.health,
      });
    }

    return true;
  }

  // ==================== Service Discovery ====================

  /**
   * Add a discovery provider
   */
  addDiscoveryProvider(provider: ServiceDiscoveryProvider): void {
    this.discoveryProviders.set(provider.name, provider);
  }

  /**
   * Remove a discovery provider
   */
  removeDiscoveryProvider(name: string): boolean {
    return this.discoveryProviders.delete(name);
  }

  /**
   * Run service discovery
   */
  async runDiscovery(): Promise<{ found: number; updated: number; errors: string[] }> {
    const results = { found: 0, updated: 0, errors: [] as string[] };

    for (const [name, provider] of Array.from(this.discoveryProviders.entries())) {
      try {
        if (!provider.isAvailable()) {
          continue;
        }

        const discovered = await provider.discover();
        for (const definition of discovered) {
          const serviceId = this.generateServiceId(definition);
          const existing = this.services.get(serviceId);

          if (existing) {
            // Update existing service
            existing.metadata.lastSeen = Date.now();
            results.updated++;
          } else {
            // Register new service
            this.register(definition, {
              tags: ['discovered', `provider:${name}`],
              description: `Discovered by ${name}`,
            });
            results.found++;
          }
        }
      } catch (error) {
        results.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.stats.totalDiscoveries++;
    this.stats.lastDiscovery = Date.now();

    this.emit(ServiceRegistry.EVENTS.DISCOVERY_COMPLETED, results);
    return results;
  }

  // ==================== Service Querying ====================

  /**
   * Get service by ID
   */
  getService(serviceId: string): RegisteredService | null {
    return this.services.get(serviceId) || null;
  }

  /**
   * List all services
   */
  listServices(): RegisteredService[] {
    return Array.from(this.services.values());
  }

  /**
   * Query services by criteria
   */
  queryServices(query: ServiceQuery): RegisteredService[] {
    const results: RegisteredService[] = [];

    for (const service of Array.from(this.services.values())) {
      if (this.matchesQuery(service, query)) {
        results.push(service);
      }
    }

    return results;
  }

  /**
   * Find services by capability
   */
  findByCapability(capability: string): RegisteredService[] {
    return this.queryServices({
      capabilities: [capability],
    });
  }

  /**
   * Find services by tag
   */
  findByTag(tag: string): RegisteredService[] {
    return this.queryServices({
      tags: [tag],
    });
  }

  /**
   * Find healthy services
   */
  findHealthyServices(): RegisteredService[] {
    return this.queryServices({
      healthy: true,
    });
  }

  // ==================== Service Management ====================

  /**
   * Clear all services
   */
  clear(): void {
    this.services.clear();
    this.updateStats();
    this.emit(ServiceRegistry.EVENTS.REGISTRY_CLEARED, {});
  }

  /**
   * Clean up old services
   */
  cleanup(): number {
    const now = Date.now();
    const maxAge = this.config.maxServiceAge;
    const servicesToRemove: string[] = [];

    for (const [serviceId, service] of Array.from(this.services.entries())) {
      if (now - service.metadata.lastSeen > maxAge) {
        servicesToRemove.push(serviceId);
      }
    }

    for (const serviceId of servicesToRemove) {
      this.unregister(serviceId);
    }

    return servicesToRemove.length;
  }

  // ==================== Private Methods ====================

  private generateServiceId(definition: McpServerDefinition): string {
    // Create a stable ID based on server definition
    const key = `${definition.name}|${definition.transport}|${definition.command || definition.url || ''}`;
    return Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  }

  private matchesQuery(service: RegisteredService, query: ServiceQuery): boolean {
    if (query.name && service.definition.name !== query.name) {
      return false;
    }

    if (query.transport && service.definition.transport !== query.transport) {
      return false;
    }

    if (query.state && service.state !== query.state) {
      return false;
    }

    if (query.healthy !== undefined) {
      const isHealthy = service.health.status === 'healthy';
      if (query.healthy !== isHealthy) {
        return false;
      }
    }

    if (query.tags && query.tags.length > 0) {
      const hasAllTags = query.tags.every(tag => service.metadata.tags.includes(tag));
      if (!hasAllTags) {
        return false;
      }
    }

    if (query.capabilities && query.capabilities.length > 0) {
      const hasAllCapabilities = query.capabilities.every(cap => {
        return Object.prototype.hasOwnProperty.call(service.capabilities, cap);
      });
      if (!hasAllCapabilities) {
        return false;
      }
    }

    return true;
  }

  private startDiscovery(): void {
    this.discoveryTimer = setInterval(async () => {
      await this.runDiscovery();
    }, this.config.discoveryIntervalMs);
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks();
    }, this.config.healthCheckIntervalMs);
  }

  private runHealthChecks(): void {
    const now = Date.now();
    
    for (const [serviceId, service] of Array.from(this.services.entries())) {
      // Simple health check based on last seen time
      const timeSinceLastSeen = now - service.metadata.lastSeen;
      const isStale = timeSinceLastSeen > this.config.healthCheckIntervalMs * 2;

      let newStatus: ServiceHealth['status'];
      if (service.state === 'running') {
        if (isStale) {
          newStatus = 'degraded';
        } else {
          newStatus = 'healthy';
        }
      } else if (service.state === 'error') {
        newStatus = 'unhealthy';
      } else {
        newStatus = 'unknown';
      }

      this.updateHealth(serviceId, {
        status: newStatus,
        lastHealthCheck: now,
      });
    }
  }

  private updateActiveCount(): void {
    this.stats.activeServices = Array.from(this.services.values())
      .filter(s => s.state === 'running' || s.state === 'starting').length;
  }

  private updateHealthyCount(): void {
    this.stats.healthyServices = Array.from(this.services.values())
      .filter(s => s.health.status === 'healthy').length;
  }

  private updateStats(): void {
    this.updateActiveCount();
    this.updateHealthyCount();
  }

  // ==================== Statistics and Info ====================

  getStats() {
    return { ...this.stats };
  }

  getInfo(): {
    config: ServiceRegistryConfig;
    stats: ReturnType<ServiceRegistry['getStats']>;
    serviceCount: number;
    providerCount: number;
  } {
    return {
      config: { ...this.config },
      stats: this.getStats(),
      serviceCount: this.services.size,
      providerCount: this.discoveryProviders.size,
    };
  }

  // ==================== Disposal ====================

  dispose(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.clear();
    this.discoveryProviders.clear();
    this.removeAllListeners();
  }
}