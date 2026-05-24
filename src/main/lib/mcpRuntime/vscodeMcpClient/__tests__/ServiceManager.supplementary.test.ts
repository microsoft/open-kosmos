/**
 * Supplementary unit tests for ServiceManager — coverage gaps
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceManager } from '../services/ServiceManager';
import type { McpServerDefinition } from '../types/mcpTypes';

function makeDef(name = 'svc'): McpServerDefinition {
  return { name, transport: 'stdio', command: 'node', args: [] };
}

describe('ServiceManager — supplementary coverage', () => {
  let manager: ServiceManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ServiceManager({
      registry: { enableDiscovery: false, healthCheckIntervalMs: 1_000_000 },
    });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  // ── getResources / getPrompts caching ───────────────────────────────────────

  it('getResources caches results', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getResources(id);
    const spy = vi.spyOn((manager as any).cacheManager, 'get');
    await manager.getResources(id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('getResources bypasses cache with forceFresh', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getResources(id);
    const spy = vi.spyOn((manager as any).cacheManager, 'get');
    await manager.getResources(id, { forceFresh: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('getResources bypasses cache with useCache=false', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getResources(id);
    const spy = vi.spyOn((manager as any).cacheManager, 'get');
    await manager.getResources(id, { useCache: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('getPrompts caches results', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getPrompts(id);
    const spy = vi.spyOn((manager as any).cacheManager, 'get');
    await manager.getPrompts(id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('getPrompts bypasses cache with forceFresh', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getPrompts(id);
    const spy = vi.spyOn((manager as any).cacheManager, 'get');
    await manager.getPrompts(id, { forceFresh: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('getPrompts throws when service is not running', async () => {
    const id = await manager.registerService(makeDef());
    await expect(manager.getPrompts(id)).rejects.toThrow(/not available/);
  });

  // ── clearCacheByType ────────────────────────────────────────────────────────

  it('clearCacheByType returns a count', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getTools(id);
    const count = manager.clearCacheByType('tools', id);
    expect(typeof count).toBe('number');
  });

  it('clearAllCaches does not throw', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getTools(id);
    expect(() => manager.clearAllCaches()).not.toThrow();
  });

  // ── updateServiceState smart caching ───────────────────────────────────────

  it('updateServiceState with error state clears cache and emits cacheOptimized', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    const registry = (manager as any).serviceRegistry;
    registry.updateService(id, { tools: [{ name: 't', inputSchema: {} }] });
    await manager.getTools(id);

    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.CACHE_OPTIMIZED, listener);

    manager.updateServiceState(id, 'error');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ optimization: 'cleared-cache-offline' }));
  });

  it('updateServiceState with disconnecting state clears cache', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');

    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.CACHE_OPTIMIZED, listener);

    manager.updateServiceState(id, 'disconnecting');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ optimization: 'cleared-cache-offline' }));
  });

  it('updateServiceState with starting state emits cacheOptimized prepare-for-connection', async () => {
    const id = await manager.registerService(makeDef());

    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.CACHE_OPTIMIZED, listener);

    manager.updateServiceState(id, 'starting');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ optimization: 'prepare-for-connection' }));
  });

  it('updateServiceState with running state emits cacheOptimized extended-ttl-stable for stable service', async () => {
    const id = await manager.registerService(makeDef());
    // Make service stable: healthy + low errors + old registration
    const registry = (manager as any).serviceRegistry;
    // Register with old timestamp
    const svc = manager.getService(id)!;
    registry.updateHealth(id, { status: 'healthy', errorCount: 0, lastCheck: Date.now() });
    svc.metadata.registeredAt = Date.now() - 15 * 60 * 1000; // 15 minutes ago

    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.CACHE_OPTIMIZED, listener);

    manager.updateServiceState(id, 'running');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ optimization: 'extended-ttl-stable' }));
  });

  // ── Performance monitoring ──────────────────────────────────────────────────

  it('fires performanceReport event after 5 minutes', async () => {
    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.PERFORMANCE_REPORT, listener);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(listener).toHaveBeenCalledOnce();
    const { report } = listener.mock.calls[0][0];
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('services');
    expect(report).toHaveProperty('cache');
    expect(report).toHaveProperty('recommendations');
  });

  it('performance report appends to history', () => {
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const stats = manager.getStats();
    expect(stats.performance).toHaveLength(1);
  });

  // ── getInfo ─────────────────────────────────────────────────────────────────

  it('getInfo returns config + stats + recommendations', async () => {
    const info = manager.getInfo();
    expect(info).toHaveProperty('config');
    expect(info).toHaveProperty('stats');
    expect(info).toHaveProperty('recommendations');
    expect(Array.isArray(info.recommendations)).toBe(true);
  });

  it('getInfo recommendations come from latest performance report', () => {
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const info = manager.getInfo();
    // Recommendations might be empty but should be an array
    expect(Array.isArray(info.recommendations)).toBe(true);
  });

  // ── Registry-driven SERVICE_UPDATED propagation ─────────────────────────────

  it('emits serviceUpdated when registry updates a service', async () => {
    const id = await manager.registerService(makeDef());
    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.SERVICE_UPDATED, listener);

    const registry = (manager as any).serviceRegistry;
    registry.updateService(id, { tools: [] });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ serviceId: id }));
  });

  it('aggressive cache invalidation strategy invalidates server on update', async () => {
    const aggressiveManager = new ServiceManager({
      cacheInvalidationStrategy: 'aggressive',
      registry: { enableDiscovery: false, healthCheckIntervalMs: 1_000_000 },
    });

    try {
      const id = await aggressiveManager.registerService(makeDef());
      aggressiveManager.updateServiceState(id, 'running');
      await aggressiveManager.getTools(id);

      const spy = vi.spyOn((aggressiveManager as any).cacheManager, 'invalidateServer');
      const registry = (aggressiveManager as any).serviceRegistry;
      registry.updateService(id, { tools: [] });

      // Should have been called for the aggressive invalidation
      expect(spy).toHaveBeenCalled();
    } finally {
      aggressiveManager.dispose();
    }
  });

  it('smart cache invalidation strategy targets specific type', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getTools(id);

    const spy = vi.spyOn((manager as any).cacheManager, 'invalidateByType');
    const registry = (manager as any).serviceRegistry;
    // Trigger smart invalidation via registry update with tools change
    registry.updateService(id, { tools: [] });

    expect(spy).toHaveBeenCalledWith('tools', id);
  });

  it('smart cache invalidation for state change calls invalidateServer', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');

    const spy = vi.spyOn((manager as any).cacheManager, 'invalidateServer');
    // Manually trigger the smart invalidation with 'state' change
    (manager as any).smartInvalidateCache(id, ['state']);

    expect(spy).toHaveBeenCalledWith(id);
  });

  it('smart cache invalidation for resources calls invalidateByType resources', async () => {
    const id = await manager.registerService(makeDef());
    const spy = vi.spyOn((manager as any).cacheManager, 'invalidateByType');
    (manager as any).smartInvalidateCache(id, ['resources', 'prompts']);

    expect(spy).toHaveBeenCalledWith('resources', id);
    expect(spy).toHaveBeenCalledWith('prompts', id);
  });

  // ── calculateOptimalTtl edge cases ──────────────────────────────────────────

  it('calculateOptimalTtl returns default when service not found', () => {
    const ttl = (manager as any).calculateOptimalTtl('tools', 'nonexistent');
    expect(ttl).toBeGreaterThan(0);
  });

  it('calculateOptimalTtl uses degraded multiplier for degraded services', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    const registry = (manager as any).serviceRegistry;
    registry.updateHealth(id, { status: 'degraded' });

    const ttl = (manager as any).calculateOptimalTtl('tools', id);
    expect(ttl).toBeGreaterThan(0);
  });

  // ── Performance recommendations ──────────────────────────────────────────────

  it('generateRecommendations gives low hit rate recommendation', () => {
    const recs = (manager as any).generateRecommendations(
      { activeServices: 1, healthyServices: 1 },
      { hits: 1, misses: 10, memoryUsage: 0, entries: 0 },
    );
    expect(recs.some((r: string) => r.includes('low hit rate'))).toBe(true);
  });

  it('generateRecommendations gives high hit rate recommendation', () => {
    const recs = (manager as any).generateRecommendations(
      { activeServices: 1, healthyServices: 1 },
      { hits: 95, misses: 5, memoryUsage: 0, entries: 0 },
    );
    expect(recs.some((r: string) => r.includes('Cache performing well'))).toBe(true);
  });

  it('generateRecommendations gives memory warning when usage is high', () => {
    const highMemBytes = 25 * 1024 * 1024 * 0.9;
    const recs = (manager as any).generateRecommendations(
      { activeServices: 1, healthyServices: 1 },
      { hits: 5, misses: 5, memoryUsage: highMemBytes, entries: 0 },
    );
    expect(recs.some((r: string) => r.includes('memory'))).toBe(true);
  });

  it('generateRecommendations gives unhealthy services recommendation', () => {
    const recs = (manager as any).generateRecommendations(
      { activeServices: 10, healthyServices: 3 },
      { hits: 5, misses: 5, memoryUsage: 0, entries: 0 },
    );
    expect(recs.some((r: string) => r.includes('unhealthy services'))).toBe(true);
  });
});
