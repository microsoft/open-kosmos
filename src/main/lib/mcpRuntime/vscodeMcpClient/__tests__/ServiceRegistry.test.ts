/**
 * Unit tests for ServiceRegistry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../registry/ServiceRegistry';
import type { ServiceDiscoveryProvider } from '../registry/ServiceRegistry';
import type { McpServerDefinition } from '../types/mcpTypes';

function makeDefinition(name = 'my-server', transport: 'stdio' | 'http' = 'stdio'): McpServerDefinition {
  return {
    name,
    transport,
    command: transport === 'stdio' ? 'node' : undefined,
    url: transport === 'http' ? 'http://localhost:3000' : undefined,
  };
}

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    // Disable auto-discovery and make health-check interval very large to avoid noise
    registry = new ServiceRegistry({
      enableDiscovery: false,
      healthCheckIntervalMs: 1_000_000,
    });
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  // ── Registration ────────────────────────────────────────────────────────────

  describe('register', () => {
    it('registers a service and returns a stable id', () => {
      const id1 = registry.register(makeDefinition());
      const id2 = registry.register(makeDefinition()); // same definition → same id (update)
      expect(id1).toBe(id2);
    });

    it('stored service is retrievable via getService', () => {
      const id = registry.register(makeDefinition());
      const svc = registry.getService(id);
      expect(svc).not.toBeNull();
      expect(svc!.definition.name).toBe('my-server');
      expect(svc!.state).toBe('stopped');
    });

    it('accepts optional metadata (tags, description)', () => {
      const id = registry.register(makeDefinition(), { tags: ['alpha'], description: 'test svc' });
      const svc = registry.getService(id)!;
      expect(svc.metadata.tags).toContain('alpha');
      expect(svc.metadata.description).toBe('test svc');
    });

    it('emits serviceRegistered event', () => {
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.SERVICE_REGISTERED, listener);
      registry.register(makeDefinition());
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].service.definition.name).toBe('my-server');
    });

    it('preserves registeredAt when re-registering the same service', () => {
      const id = registry.register(makeDefinition());
      const firstSeen = registry.getService(id)!.metadata.registeredAt;
      // Advance fake timer so timestamps would differ if not preserved
      vi.advanceTimersByTime(100);
      registry.register(makeDefinition());
      const afterRe = registry.getService(id)!.metadata.registeredAt;
      expect(afterRe).toBe(firstSeen);
    });
  });

  // ── Unregistration ──────────────────────────────────────────────────────────

  describe('unregister', () => {
    it('returns false for unknown id', () => {
      expect(registry.unregister('nope')).toBe(false);
    });

    it('removes the service and returns true', () => {
      const id = registry.register(makeDefinition());
      expect(registry.unregister(id)).toBe(true);
      expect(registry.getService(id)).toBeNull();
    });

    it('emits serviceUnregistered event', () => {
      const id = registry.register(makeDefinition());
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.SERVICE_UNREGISTERED, listener);
      registry.unregister(id);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].serviceId).toBe(id);
    });
  });

  // ── updateService ───────────────────────────────────────────────────────────

  describe('updateService', () => {
    it('returns false for unknown id', () => {
      expect(registry.updateService('nope', { state: 'running' })).toBe(false);
    });

    it('updates state and emits serviceUpdated', () => {
      const id = registry.register(makeDefinition());
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.SERVICE_UPDATED, listener);
      const changed = registry.updateService(id, { state: 'running' });
      expect(changed).toBe(true);
      expect(registry.getService(id)!.state).toBe('running');
      expect(listener.mock.calls[0][0].changes).toContain('state');
    });

    it('updates tools, resources, and prompts', () => {
      const id = registry.register(makeDefinition());
      registry.updateService(id, {
        tools: [{ name: 'search', inputSchema: {} }],
        resources: [{ uri: 'file://readme', name: 'Readme' }],
        prompts: [{ name: 'greet' }],
      });
      const svc = registry.getService(id)!;
      expect(svc.tools).toHaveLength(1);
      expect(svc.resources).toHaveLength(1);
      expect(svc.prompts).toHaveLength(1);
    });

    it('returns false and emits nothing when there are no changes', () => {
      const id = registry.register(makeDefinition());
      // State is already 'stopped'; setting same value → no change
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.SERVICE_UPDATED, listener);
      const changed = registry.updateService(id, { state: 'stopped' });
      expect(changed).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── updateHealth ────────────────────────────────────────────────────────────

  describe('updateHealth', () => {
    it('returns false for unknown id', () => {
      expect(registry.updateHealth('nope', { status: 'healthy' })).toBe(false);
    });

    it('updates health status', () => {
      const id = registry.register(makeDefinition());
      registry.updateHealth(id, { status: 'healthy', responseTime: 50 });
      expect(registry.getService(id)!.health.status).toBe('healthy');
    });

    it('emits serviceHealthChanged when status changes', () => {
      const id = registry.register(makeDefinition());
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.SERVICE_HEALTH_CHANGED, listener);
      registry.updateHealth(id, { status: 'healthy' });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].newHealth.status).toBe('healthy');
    });

    it('does NOT emit serviceHealthChanged when status is unchanged', () => {
      const id = registry.register(makeDefinition());
      registry.updateHealth(id, { status: 'unknown', errorCount: 1 });
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.SERVICE_HEALTH_CHANGED, listener);
      // status is still 'unknown'
      registry.updateHealth(id, { errorCount: 2 });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── listServices / queryServices ────────────────────────────────────────────

  describe('listServices', () => {
    it('returns all registered services', () => {
      registry.register(makeDefinition('a'));
      registry.register(makeDefinition('b'));
      expect(registry.listServices()).toHaveLength(2);
    });

    it('returns empty when no services registered', () => {
      expect(registry.listServices()).toHaveLength(0);
    });
  });

  describe('queryServices', () => {
    beforeEach(() => {
      const id1 = registry.register(makeDefinition('svc-a', 'stdio'), { tags: ['prod'] });
      registry.updateService(id1, { state: 'running' });
      registry.updateHealth(id1, { status: 'healthy' });

      registry.register(makeDefinition('svc-b', 'http'), { tags: ['staging'] });
    });

    it('filters by name', () => {
      expect(registry.queryServices({ name: 'svc-a' })).toHaveLength(1);
    });

    it('filters by transport', () => {
      expect(registry.queryServices({ transport: 'http' })).toHaveLength(1);
    });

    it('filters by state', () => {
      expect(registry.queryServices({ state: 'running' })).toHaveLength(1);
    });

    it('filters by healthy=true', () => {
      expect(registry.queryServices({ healthy: true })).toHaveLength(1);
    });

    it('filters by healthy=false', () => {
      expect(registry.queryServices({ healthy: false })).toHaveLength(1);
    });

    it('filters by tags', () => {
      expect(registry.queryServices({ tags: ['prod'] })).toHaveLength(1);
    });

    it('filters by capabilities', () => {
      const id = registry.register(makeDefinition('capable'));
      registry.updateService(id, { capabilities: { tools: { listChanged: true } } });
      const results = registry.queryServices({ capabilities: ['tools'] });
      expect(results.some(s => s.definition.name === 'capable')).toBe(true);
    });
  });

  describe('findByCapability / findByTag / findHealthyServices', () => {
    it('findByCapability returns matching services', () => {
      const id = registry.register(makeDefinition());
      registry.updateService(id, { capabilities: { logging: {} } });
      expect(registry.findByCapability('logging')).toHaveLength(1);
    });

    it('findByTag returns matching services', () => {
      registry.register(makeDefinition(), { tags: ['featured'] });
      expect(registry.findByTag('featured')).toHaveLength(1);
    });

    it('findHealthyServices returns only healthy services', () => {
      const id = registry.register(makeDefinition());
      registry.updateHealth(id, { status: 'healthy' });
      expect(registry.findHealthyServices()).toHaveLength(1);
    });
  });

  // ── Discovery ───────────────────────────────────────────────────────────────

  describe('runDiscovery', () => {
    it('registers newly discovered services', async () => {
      const provider: ServiceDiscoveryProvider = {
        name: 'test-provider',
        isAvailable: () => true,
        discover: vi.fn().mockResolvedValue([makeDefinition('discovered')]),
      };
      registry.addDiscoveryProvider(provider);
      const result = await registry.runDiscovery();
      expect(result.found).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('increments updated for already-known services', async () => {
      registry.register(makeDefinition('existing'));
      const provider: ServiceDiscoveryProvider = {
        name: 'test-provider',
        isAvailable: () => true,
        discover: vi.fn().mockResolvedValue([makeDefinition('existing')]),
      };
      registry.addDiscoveryProvider(provider);
      const result = await registry.runDiscovery();
      expect(result.updated).toBe(1);
      expect(result.found).toBe(0);
    });

    it('skips unavailable providers', async () => {
      const provider: ServiceDiscoveryProvider = {
        name: 'test-provider',
        isAvailable: () => false,
        discover: vi.fn().mockResolvedValue([]),
      };
      registry.addDiscoveryProvider(provider);
      await registry.runDiscovery();
      expect(provider.discover).not.toHaveBeenCalled();
    });

    it('records errors when provider throws', async () => {
      const provider: ServiceDiscoveryProvider = {
        name: 'bad-provider',
        isAvailable: () => true,
        discover: vi.fn().mockRejectedValue(new Error('network fail')),
      };
      registry.addDiscoveryProvider(provider);
      const result = await registry.runDiscovery();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('bad-provider');
    });

    it('emits discoveryCompleted event', async () => {
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.DISCOVERY_COMPLETED, listener);
      await registry.runDiscovery();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('removeDiscoveryProvider removes the provider', async () => {
      const provider: ServiceDiscoveryProvider = {
        name: 'test-provider',
        isAvailable: () => true,
        discover: vi.fn().mockResolvedValue([makeDefinition()]),
      };
      registry.addDiscoveryProvider(provider);
      registry.removeDiscoveryProvider('test-provider');
      await registry.runDiscovery();
      expect(provider.discover).not.toHaveBeenCalled();
    });
  });

  // ── clear / cleanup ─────────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all services and emits registryCleared', () => {
      registry.register(makeDefinition('a'));
      registry.register(makeDefinition('b'));
      const listener = vi.fn();
      registry.on(ServiceRegistry.EVENTS.REGISTRY_CLEARED, listener);
      registry.clear();
      expect(registry.listServices()).toHaveLength(0);
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('cleanup', () => {
    it('removes services that exceeded maxServiceAge', () => {
      const r = new ServiceRegistry({
        enableDiscovery: false,
        healthCheckIntervalMs: 1_000_000,
        maxServiceAge: 1000,
      });
      r.register(makeDefinition('old'));
      // Advance time past maxServiceAge
      vi.advanceTimersByTime(2000);
      const removed = r.cleanup();
      expect(removed).toBe(1);
      expect(r.listServices()).toHaveLength(0);
      r.dispose();
    });

    it('keeps services within maxServiceAge', () => {
      registry.register(makeDefinition());
      const removed = registry.cleanup();
      expect(removed).toBe(0);
    });
  });

  // ── getInfo / getStats ──────────────────────────────────────────────────────

  describe('getInfo / getStats', () => {
    it('getStats returns initial zeroes', () => {
      const stats = registry.getStats();
      expect(stats.totalRegistered).toBe(0);
      expect(stats.activeServices).toBe(0);
    });

    it('getInfo reflects the current state', () => {
      registry.register(makeDefinition());
      const info = registry.getInfo();
      expect(info.serviceCount).toBe(1);
      expect(info.providerCount).toBe(0);
    });
  });

  // ── Health-check timer ──────────────────────────────────────────────────────

  describe('health check timer', () => {
    it('marks running services as healthy when recently seen', () => {
      const r = new ServiceRegistry({
        enableDiscovery: false,
        healthCheckIntervalMs: 1000,
      });
      const id = r.register(makeDefinition());
      r.updateService(id, { state: 'running' });

      vi.advanceTimersByTime(1001);
      // Within 2× healthCheckIntervalMs → healthy
      expect(r.getService(id)!.health.status).toBe('healthy');
      r.dispose();
    });

    it('marks error services as unhealthy', () => {
      const r = new ServiceRegistry({
        enableDiscovery: false,
        healthCheckIntervalMs: 1000,
      });
      const id = r.register(makeDefinition());
      r.updateService(id, { state: 'error' });

      vi.advanceTimersByTime(1001);
      expect(r.getService(id)!.health.status).toBe('unhealthy');
      r.dispose();
    });
  });
});
