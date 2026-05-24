/**
 * Unit tests for ToolManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolManager } from '../tools/ToolManager';
import type { ToolManagerConfig } from '../tools/ToolManager';

const makeTool = (name = 'my-tool') => ({
  name,
  description: `${name} description`,
  inputSchema: { type: 'object', properties: {} },
});

describe('ToolManager', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  // ── Registration ────────────────────────────────────────────────────────────

  describe('registerTool', () => {
    it('registers a tool and returns its id', () => {
      const id = manager.registerTool(makeTool(), 'server1');
      expect(id).toBe('server1:my-tool');
    });

    it('stores tool metadata accessible via getTool', () => {
      const id = manager.registerTool(makeTool(), 'server1');
      const meta = manager.getTool(id);
      expect(meta).not.toBeNull();
      expect(meta!.name).toBe('my-tool');
      expect(meta!.serverId).toBe('server1');
      expect(meta!.version).toBe('1.0.0');
      expect(meta!.category).toBe('general');
      expect(meta!.usageCount).toBe(0);
      expect(meta!.deprecated).toBe(false);
    });

    it('accepts optional metadata (category, tags, version, permissions)', () => {
      const id = manager.registerTool(makeTool(), 's', {
        category: 'search',
        tags: ['alpha', 'beta'],
        version: '2.0.0',
        permissions: { riskLevel: 'high', requiresApproval: true, requiredPermissions: [] },
      });
      const meta = manager.getTool(id)!;
      expect(meta.category).toBe('search');
      expect(meta.tags).toContain('alpha');
      expect(meta.version).toBe('2.0.0');
      expect(meta.permissions.riskLevel).toBe('high');
    });

    it('throws when registering the same tool twice', () => {
      manager.registerTool(makeTool(), 'server1');
      expect(() => manager.registerTool(makeTool(), 'server1')).toThrow(/already registered/);
    });

    it('emits toolRegistered event', () => {
      const listener = vi.fn();
      manager.on(ToolManager.EVENTS.TOOL_REGISTERED, listener);
      manager.registerTool(makeTool(), 'server1');
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].tool.name).toBe('my-tool');
    });

    it('emits auditLog event when audit is enabled', () => {
      const listener = vi.fn();
      manager.on(ToolManager.EVENTS.AUDIT_LOG, listener);
      manager.registerTool(makeTool(), 'server1');
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].entry.action).toBe('register');
    });

    it('does not emit auditLog when audit is disabled', () => {
      const m = new ToolManager({ enableAuditLog: false });
      const listener = vi.fn();
      m.on(ToolManager.EVENTS.AUDIT_LOG, listener);
      m.registerTool(makeTool(), 's');
      expect(listener).not.toHaveBeenCalled();
      m.dispose();
    });
  });

  // ── Unregistration ──────────────────────────────────────────────────────────

  describe('unregisterTool', () => {
    it('returns false for unknown tool', () => {
      expect(manager.unregisterTool('nope')).toBe(false);
    });

    it('removes a registered tool and returns true', () => {
      const id = manager.registerTool(makeTool(), 'server1');
      expect(manager.unregisterTool(id)).toBe(true);
      expect(manager.getTool(id)).toBeNull();
    });

    it('emits toolUnregistered event', () => {
      const id = manager.registerTool(makeTool(), 'server1');
      const listener = vi.fn();
      manager.on(ToolManager.EVENTS.TOOL_UNREGISTERED, listener);
      manager.unregisterTool(id);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].toolId).toBe(id);
    });
  });

  // ── Querying ────────────────────────────────────────────────────────────────

  describe('listTools', () => {
    beforeEach(() => {
      manager.registerTool(makeTool('tool-a'), 'server1', { category: 'alpha', tags: ['x'] });
      manager.registerTool(makeTool('tool-b'), 'server2', { category: 'beta', tags: ['y'] });
      manager.registerTool(makeTool('tool-c'), 'server1', { category: 'alpha', tags: ['x', 'y'] });
    });

    it('returns all tools with no filter', () => {
      expect(manager.listTools()).toHaveLength(3);
    });

    it('filters by serverId', () => {
      const result = manager.listTools({ serverId: 'server1' });
      expect(result).toHaveLength(2);
      result.forEach(t => expect(t.serverId).toBe('server1'));
    });

    it('filters by category', () => {
      const result = manager.listTools({ category: 'alpha' });
      expect(result).toHaveLength(2);
    });

    it('filters by tags (all must match)', () => {
      const result = manager.listTools({ tags: ['x', 'y'] });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('tool-c');
    });

    it('filters by deprecated flag', () => {
      expect(manager.listTools({ deprecated: false })).toHaveLength(3);
      expect(manager.listTools({ deprecated: true })).toHaveLength(0);
    });

    it('filters by required permissions', () => {
      manager.registerTool(makeTool('secured'), 'server1', {
        permissions: { requiredPermissions: ['admin'], restricted: false, riskLevel: 'low', requiresApproval: false },
      });
      const result = manager.listTools({ permissions: ['admin'] });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('secured');
    });
  });

  describe('searchTools', () => {
    beforeEach(() => {
      manager.registerTool({ name: 'weather', description: 'get current weather', inputSchema: {} }, 's');
      manager.registerTool({ name: 'search-web', description: 'search the internet', inputSchema: {} }, 's');
    });

    it('matches by name', () => {
      expect(manager.searchTools('weather')).toHaveLength(1);
    });

    it('matches by description', () => {
      expect(manager.searchTools('internet')).toHaveLength(1);
    });

    it('matches by tags', () => {
      manager.registerTool(makeTool('calc'), 's', { tags: ['math', 'utility'] });
      expect(manager.searchTools('math')).toHaveLength(1);
    });

    it('returns empty array when no match', () => {
      expect(manager.searchTools('zzznomatch')).toHaveLength(0);
    });
  });

  describe('getToolsByCategory', () => {
    it('returns tools for an existing category', () => {
      manager.registerTool(makeTool('a'), 's', { category: 'cat1' });
      manager.registerTool(makeTool('b'), 's', { category: 'cat1' });
      manager.registerTool(makeTool('c'), 's', { category: 'cat2' });
      expect(manager.getToolsByCategory('cat1')).toHaveLength(2);
    });

    it('returns empty array for unknown category', () => {
      expect(manager.getToolsByCategory('unknown')).toHaveLength(0);
    });
  });

  // ── Permission Management ───────────────────────────────────────────────────

  describe('updateToolPermissions', () => {
    it('returns false for unknown tool', () => {
      expect(manager.updateToolPermissions('nope', {})).toBe(false);
    });

    it('updates permissions and returns true', () => {
      const id = manager.registerTool(makeTool(), 's');
      expect(manager.updateToolPermissions(id, { riskLevel: 'critical' })).toBe(true);
      expect(manager.getTool(id)!.permissions.riskLevel).toBe('critical');
    });

    it('emits audit log on permission change', () => {
      const id = manager.registerTool(makeTool(), 's');
      const listener = vi.fn();
      manager.on(ToolManager.EVENTS.AUDIT_LOG, listener);
      manager.updateToolPermissions(id, { restricted: true });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].entry.action).toBe('permission_change');
    });
  });

  // ── Execution ───────────────────────────────────────────────────────────────

  describe('executeTool', () => {
    it('throws for unknown tool', async () => {
      await expect(manager.executeTool('nope', {})).rejects.toThrow(/not found/);
    });

    it('executes and returns a result', async () => {
      const id = manager.registerTool(makeTool(), 's');
      const result = await manager.executeTool(id, { param: 1 });
      expect(result.success).toBe(true);
      expect(result.executionId).toMatch(/^exec_/);
    });

    it('updates tool usage stats after execution', async () => {
      const id = manager.registerTool(makeTool(), 's');
      await manager.executeTool(id, {});
      const meta = manager.getTool(id)!;
      expect(meta.usageCount).toBe(1);
      expect(meta.lastUsed).toBeGreaterThan(0);
    });

    it('emits toolExecuted event', async () => {
      const id = manager.registerTool(makeTool(), 's');
      const listener = vi.fn();
      manager.on(ToolManager.EVENTS.TOOL_EXECUTED, listener);
      await manager.executeTool(id, {});
      expect(listener).toHaveBeenCalledOnce();
    });

    it('emits permissionDenied and throws when tool is restricted', async () => {
      const id = manager.registerTool(makeTool(), 's', {
        permissions: { restricted: true, riskLevel: 'high', requiresApproval: false, requiredPermissions: [] },
      });
      const denied = vi.fn();
      manager.on(ToolManager.EVENTS.PERMISSION_DENIED, denied);
      await expect(manager.executeTool(id, {})).rejects.toThrow(/Permission denied/);
      expect(denied).toHaveBeenCalledOnce();
    });

    it('throws when userId is not in allowedUsers list', async () => {
      const id = manager.registerTool(makeTool(), 's', {
        permissions: { allowedUsers: ['alice'], restricted: false, riskLevel: 'low', requiresApproval: false, requiredPermissions: [] },
      });
      await expect(manager.executeTool(id, {}, { userId: 'bob', requestId: 'r1', timestamp: 0, serverId: 's', toolName: 'my-tool', arguments: {}, environment: 'development' })).rejects.toThrow(/Permission denied/);
    });

    it('respects maxConcurrentTools limit', async () => {
      const m = new ToolManager({ maxConcurrentTools: 0 });
      const id = m.registerTool(makeTool(), 's');
      const blocked = vi.fn();
      m.on(ToolManager.EVENTS.TOOL_EXECUTION_BLOCKED, blocked);
      await expect(m.executeTool(id, {})).rejects.toThrow(/Maximum concurrent/);
      expect(blocked).toHaveBeenCalledOnce();
      m.dispose();
    });

    it('skips permission check when permissions disabled', async () => {
      const m = new ToolManager({ enablePermissions: false });
      const id = m.registerTool(makeTool(), 's', {
        permissions: { restricted: true, riskLevel: 'high', requiresApproval: false, requiredPermissions: [] },
      });
      const result = await m.executeTool(id, {});
      expect(result.success).toBe(true);
      m.dispose();
    });
  });

  // ── Rate Limiting ───────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('enforces maxExecutionsPerHour', async () => {
      const id = manager.registerTool(makeTool(), 's', {
        permissions: { maxExecutionsPerHour: 2, restricted: false, riskLevel: 'low', requiresApproval: false, requiredPermissions: [] },
      });
      await manager.executeTool(id, {}, { userId: 'alice' } as any);
      await manager.executeTool(id, {}, { userId: 'alice' } as any);
      const exceeded = vi.fn();
      manager.on(ToolManager.EVENTS.RATE_LIMIT_EXCEEDED, exceeded);
      await expect(manager.executeTool(id, {}, { userId: 'alice' } as any)).rejects.toThrow();
      expect(exceeded).toHaveBeenCalledOnce();
    });

    it('does not rate-limit when no limits are set', async () => {
      const id = manager.registerTool(makeTool(), 's');
      for (let i = 0; i < 5; i++) {
        await manager.executeTool(id, {}, { userId: 'alice' } as any);
      }
      expect(manager.getTool(id)!.usageCount).toBe(5);
    });
  });

  // ── Statistics ──────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zero counts for fresh manager', () => {
      const stats = manager.getStats();
      expect(stats.totalTools).toBe(0);
      expect(stats.totalExecutions).toBe(0);
      expect(stats.registry.totalTools).toBe(0);
      expect(stats.audit.totalEntries).toBe(0);
    });

    it('reflects registered and executed tools', async () => {
      const id = manager.registerTool(makeTool(), 's');
      await manager.executeTool(id, {});
      const stats = manager.getStats();
      expect(stats.totalTools).toBe(1);
      expect(stats.totalExecutions).toBe(1);
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.audit.totalEntries).toBeGreaterThan(0);
    });
  });

  // ── Audit Log ───────────────────────────────────────────────────────────────

  describe('getAuditLog', () => {
    it('returns all entries with no filter', () => {
      manager.registerTool(makeTool('a'), 's');
      manager.registerTool(makeTool('b'), 's');
      expect(manager.getAuditLog().length).toBeGreaterThanOrEqual(2);
    });

    it('filters by toolId', () => {
      const id1 = manager.registerTool(makeTool('a'), 's');
      manager.registerTool(makeTool('b'), 's');
      const entries = manager.getAuditLog({ toolId: id1 });
      expect(entries.every(e => e.toolId === id1)).toBe(true);
    });

    it('filters by action', () => {
      const id = manager.registerTool(makeTool(), 's');
      manager.unregisterTool(id);
      const entries = manager.getAuditLog({ action: 'unregister' });
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(e => e.action === 'unregister')).toBe(true);
    });

    it('filters by time range', () => {
      const before = Date.now() - 1;
      manager.registerTool(makeTool(), 's');
      const after = Date.now() + 1;
      const entries = manager.getAuditLog({ timeRange: { start: before, end: after } });
      expect(entries.length).toBeGreaterThan(0);
      const none = manager.getAuditLog({ timeRange: { start: 0, end: 1 } });
      expect(none.length).toBe(0);
    });
  });

  // ── Dispose ─────────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears all registry data', () => {
      manager.registerTool(makeTool('a'), 's');
      manager.registerTool(makeTool('b'), 's');
      manager.dispose();
      expect(manager.listTools()).toHaveLength(0);
    });
  });

  // ── Versioning ──────────────────────────────────────────────────────────────

  describe('versioning disabled', () => {
    it('does not build version index when versioning is off', () => {
      const m = new ToolManager({ enableVersioning: false });
      m.registerTool(makeTool(), 's');
      // Should not throw; unregister should also work without version index
      m.unregisterTool('s:my-tool');
      m.dispose();
    });
  });
});
