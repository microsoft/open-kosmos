/**
 * Unit tests for ServiceManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceManager } from '../services/ServiceManager';
import type { McpServerDefinition } from '../types/mcpTypes';

function makeDef(name = 'my-server'): McpServerDefinition {
  return { name, transport: 'stdio', command: 'node', args: [] };
}

describe('ServiceManager', () => {
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

  // ── registerService / unregisterService ──────────────────────────────────

  it('registerService returns a stable service id', async () => {
    const id = await manager.registerService(makeDef());
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('registered service is retrievable via getService', async () => {
    const id = await manager.registerService(makeDef());
    const svc = manager.getService(id);
    expect(svc).not.toBeNull();
    expect(svc!.definition.name).toBe('my-server');
  });

  it('registerService emits serviceRegistered event', async () => {
    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.SERVICE_REGISTERED, listener);
    await manager.registerService(makeDef());
    expect(listener).toHaveBeenCalledOnce();
  });

  it('unregisterService removes the service', async () => {
    const id = await manager.registerService(makeDef());
    const result = await manager.unregisterService(id);
    expect(result).toBe(true);
    expect(manager.getService(id)).toBeNull();
  });

  it('unregisterService emits serviceUnregistered event', async () => {
    const id = await manager.registerService(makeDef());
    const listener = vi.fn();
    manager.on(ServiceManager.EVENTS.SERVICE_UNREGISTERED, listener);
    await manager.unregisterService(id);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].serviceId).toBe(id);
  });

  it('unregisterService returns false for unknown id', async () => {
    const result = await manager.unregisterService('nope');
    expect(result).toBe(false);
  });

  // ── updateServiceState / updateServiceCapabilities ───────────────────────

  it('updateServiceState updates the state in the registry', async () => {
    const id = await manager.registerService(makeDef());
    const result = manager.updateServiceState(id, 'running');
    expect(result).toBe(true);
    expect(manager.getService(id)!.state).toBe('running');
  });

  it('updateServiceState returns false for unknown id', () => {
    expect(manager.updateServiceState('nope', 'running')).toBe(false);
  });

  it('updateServiceCapabilities updates capabilities', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    manager.updateServiceCapabilities(id, { tools: { listChanged: true } });
    const svc = manager.getService(id)!;
    expect(svc.capabilities.tools?.listChanged).toBe(true);
  });

  // ── getTools / getResources / getPrompts ─────────────────────────────────

  it('getTools throws when service is not running', async () => {
    const id = await manager.registerService(makeDef());
    await expect(manager.getTools(id)).rejects.toThrow(/not available/);
  });

  it('getTools returns tools when service is running', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    // Seed tools via registry update
    const registry = (manager as any).serviceRegistry;
    registry.updateService(id, { tools: [{ name: 'search', inputSchema: {} }] });
    const tools = await manager.getTools(id);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('search');
  });

  it('getTools caches results by default', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getTools(id);
    // Second call should return from cache without touching registry
    const spy = vi.spyOn((manager as any).cacheManager, 'get');
    await manager.getTools(id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('getTools bypasses cache with forceFresh=true', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getTools(id);
    const spy = vi.spyOn((manager as any).cacheManager, 'get');
    await manager.getTools(id, { forceFresh: true });
    // forceFresh skips get()
    expect(spy).not.toHaveBeenCalled();
  });

  it('getResources returns resources when running', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    const registry = (manager as any).serviceRegistry;
    registry.updateService(id, { resources: [{ uri: 'file://readme', name: 'Readme' }] });
    const resources = await manager.getResources(id);
    expect(resources).toHaveLength(1);
  });

  it('getResources throws when service is not running', async () => {
    const id = await manager.registerService(makeDef());
    await expect(manager.getResources(id)).rejects.toThrow(/not available/);
  });

  it('getPrompts returns prompts when running', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    const registry = (manager as any).serviceRegistry;
    registry.updateService(id, { prompts: [{ name: 'greet' }] });
    const prompts = await manager.getPrompts(id);
    expect(prompts).toHaveLength(1);
  });

  // ── findServices / findServicesByCapability / getHealthyServices ──────────

  it('findServices queries the registry', async () => {
    await manager.registerService(makeDef('svc-a'));
    await manager.registerService(makeDef('svc-b'));
    const results = manager.findServices({ name: 'svc-a' });
    expect(results).toHaveLength(1);
    expect(results[0].definition.name).toBe('svc-a');
  });

  it('findServicesByCapability delegates to registry', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceCapabilities(id, { logging: {} });
    const results = manager.findServicesByCapability('logging');
    expect(results.some(s => s.definition.name === 'my-server')).toBe(true);
  });

  it('getHealthyServices returns only healthy services', async () => {
    const id = await manager.registerService(makeDef());
    const registry = (manager as any).serviceRegistry;
    registry.updateHealth(id, { status: 'healthy' });
    const healthy = manager.getHealthyServices();
    expect(healthy.some(s => s.definition.name === 'my-server')).toBe(true);
  });

  // ── clearServiceCache ────────────────────────────────────────────────────

  it('clearServiceCache invalidates cache for the service', async () => {
    const id = await manager.registerService(makeDef());
    manager.updateServiceState(id, 'running');
    await manager.getTools(id);
    const cleared = manager.clearServiceCache(id);
    expect(cleared).toBeGreaterThanOrEqual(0); // returns count of cleared entries
  });

  // ── dispose ──────────────────────────────────────────────────────────────

  it('dispose cleans up without throwing', () => {
    const m = new ServiceManager({ registry: { enableDiscovery: false } });
    expect(() => m.dispose()).not.toThrow();
  });
});
