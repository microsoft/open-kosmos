/**
 * ResourceManager — unit tests
 */

import { ResourceManager } from '../resources/ResourceManager';
import type { McpResource } from '../types/mcpTypes';

function makeResource(overrides: Partial<McpResource> = {}): McpResource {
  return {
    uri: 'file:///test/resource.txt',
    name: 'resource.txt',
    mimeType: 'text/plain',
    ...overrides,
  };
}

describe('ResourceManager', () => {
  let rm: ResourceManager;

  beforeEach(() => {
    // Disable sync timer and pass minimal config to avoid setInterval side-effects
    rm = new ResourceManager({
      enableSynchronization: false,
      enableCaching: true,
      enableAccessControl: true,
    });
  });

  afterEach(() => {
    rm.dispose();
  });

  // ==================== Test 1: registerResource — happy path ====================

  it('registerResource returns a resourceId and emits resourceRegistered', () => {
    const events: any[] = [];
    rm.on(ResourceManager.EVENTS.RESOURCE_REGISTERED, e => events.push(e));

    const id = rm.registerResource(makeResource(), 'server1');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0].resource.uri).toBe('file:///test/resource.txt');
  });

  // ==================== Test 2: registerResource — duplicate throws ====================

  it('registerResource throws when resource already registered', () => {
    rm.registerResource(makeResource(), 'server1');
    expect(() => rm.registerResource(makeResource(), 'server1')).toThrow('already registered');
  });

  // ==================== Test 3: unregisterResource — returns true and emits event ====================

  it('unregisterResource returns true and emits resourceUnregistered', () => {
    const events: any[] = [];
    rm.on(ResourceManager.EVENTS.RESOURCE_UNREGISTERED, e => events.push(e));

    const id = rm.registerResource(makeResource(), 'server1');
    const result = rm.unregisterResource(id);

    expect(result).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].resourceId).toBe(id);
  });

  // ==================== Test 4: unregisterResource — unknown id returns false ====================

  it('unregisterResource returns false for unknown id', () => {
    expect(rm.unregisterResource('nonexistent')).toBe(false);
  });

  // ==================== Test 5: readResource — not found throws ====================

  it('readResource throws when resource not found', async () => {
    await expect(rm.readResource('unknown-id')).rejects.toThrow('not found');
  });

  // ==================== Test 6: readResource — success returns content ====================

  it('readResource returns content and updates access stats', async () => {
    const id = rm.registerResource(makeResource(), 'server1');
    const content = await rm.readResource(id);

    expect(content.uri).toBe('file:///test/resource.txt');
    expect(typeof content.text).toBe('string');

    const stats = rm.getStats();
    expect(stats.totalAccesses).toBe(1);
  });

  // ==================== Test 7: readResource — permission denied ====================

  it('readResource throws on permission denied and emits permissionDenied', async () => {
    const events: any[] = [];
    rm.on(ResourceManager.EVENTS.PERMISSION_DENIED, e => events.push(e));

    const id = rm.registerResource(makeResource(), 'server1', {
      permissions: { read: false },
    });

    await expect(rm.readResource(id)).rejects.toThrow('Permission denied');
    expect(events).toHaveLength(1);
    expect(events[0].resourceId).toBe(id);
  });

  // ==================== Test 8: readResource — allowedUsers restriction ====================

  it('readResource denies access when userId not in allowedUsers', async () => {
    const id = rm.registerResource(makeResource(), 'server1', {
      permissions: { read: true, allowedUsers: ['alice'] },
    });

    await expect(rm.readResource(id, { userId: 'bob' })).rejects.toThrow('Permission denied');
  });

  // ==================== Test 9: readResource — cache hit on second read ====================

  it('readResource serves from cache on second call (cacheHits incremented)', async () => {
    const id = rm.registerResource(makeResource(), 'server1');

    await rm.readResource(id); // miss + cache
    await rm.readResource(id); // hit

    const stats = rm.getStats();
    expect(stats.cacheHits).toBeGreaterThanOrEqual(1);
  });

  // ==================== Test 10: readResource — forceFresh bypasses cache ====================

  it('readResource with forceFresh does not increment cacheHits', async () => {
    const id = rm.registerResource(makeResource(), 'server1');
    await rm.readResource(id); // primes cache

    const statsBefore = rm.getStats();
    const hitsBefore = statsBefore.cacheHits;

    await rm.readResource(id, { forceFresh: true });

    const statsAfter = rm.getStats();
    expect(statsAfter.cacheHits).toBe(hitsBefore); // no new hits
  });

  // ==================== Test 11: clearCache — resets cache stats ====================

  it('clearCache clears entries and emits cacheCleared', async () => {
    const events: any[] = [];
    rm.on(ResourceManager.EVENTS.CACHE_CLEARED, e => events.push(e));

    const id = rm.registerResource(makeResource(), 'server1');
    await rm.readResource(id); // prime cache

    rm.clearCache('test');

    const stats = rm.getStats();
    expect(stats.cacheInfo.entries).toBe(0);
    expect(events[0].reason).toBe('test');
  });

  // ==================== Test 12: listResources — filtering by serverId ====================

  it('listResources filters by serverId', () => {
    rm.registerResource(makeResource({ uri: 'file:///a', name: 'a' }), 'serverA');
    rm.registerResource(makeResource({ uri: 'file:///b', name: 'b' }), 'serverB');

    const list = rm.listResources({ serverId: 'serverA' });
    expect(list).toHaveLength(1);
    expect(list[0].serverId).toBe('serverA');
  });

  // ==================== Test 13: listResources — filtering by tag ====================

  it('listResources filters by tags', () => {
    rm.registerResource(makeResource({ uri: 'file:///c', name: 'c' }), 'server1', { tags: ['docs', 'important'] });
    rm.registerResource(makeResource({ uri: 'file:///d', name: 'd' }), 'server1', { tags: ['docs'] });

    const withImportant = rm.listResources({ tags: ['important'] });
    expect(withImportant).toHaveLength(1);
    expect(withImportant[0].uri).toBe('file:///c');
  });

  // ==================== Test 14: searchResources — matches name ====================

  it('searchResources matches by name substring', () => {
    rm.registerResource(makeResource({ uri: 'file:///report.docx', name: 'Quarterly Report' }), 's1');
    rm.registerResource(makeResource({ uri: 'file:///readme.txt', name: 'README' }), 's1');

    const results = rm.searchResources('quarterly');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Quarterly Report');
  });

  // ==================== Test 15: searchResources — matches URI ====================

  it('searchResources matches by uri substring', () => {
    rm.registerResource(makeResource({ uri: 'file:///docs/important.md', name: 'important' }), 's1');
    rm.registerResource(makeResource({ uri: 'file:///other.txt', name: 'other' }), 's1');

    const results = rm.searchResources('docs');
    expect(results).toHaveLength(1);
    expect(results[0].uri).toContain('docs');
  });

  // ==================== Test 16: readMultipleResources — all succeed ====================

  it('readMultipleResources returns all contents', async () => {
    const id1 = rm.registerResource(makeResource({ uri: 'file:///1', name: 'one' }), 's1');
    const id2 = rm.registerResource(makeResource({ uri: 'file:///2', name: 'two' }), 's1');

    const results = await rm.readMultipleResources([id1, id2]);
    expect(results.size).toBe(2);
    expect(results.has(id1)).toBe(true);
    expect(results.has(id2)).toBe(true);
  });

  // ==================== Test 17: readMultipleResources — partial failure ====================

  it('readMultipleResources handles missing resources gracefully', async () => {
    const id1 = rm.registerResource(makeResource({ uri: 'file:///x', name: 'x' }), 's1');

    const results = await rm.readMultipleResources([id1, 'bad-id']);
    expect(results.has(id1)).toBe(true);
    expect(results.has('bad-id')).toBe(false);
  });

  // ==================== Test 18: getStats — hitRate calculation ====================

  it('getStats computes correct hitRate after cache hits and misses', async () => {
    const id = rm.registerResource(makeResource(), 's1');
    await rm.readResource(id); // miss (first read — primes cache)
    await rm.readResource(id); // hit
    await rm.readResource(id); // hit

    const stats = rm.getStats();
    // 2 hits, 1 miss → hitRate = 2/3
    expect(stats.cacheInfo.hitRate).toBeCloseTo(2 / 3, 2);
  });

  // ==================== Test 19: syncResources — increments syncOperations ====================

  it('syncResources increments syncOperations counter', async () => {
    rm.registerResource(makeResource(), 's1');
    await rm.syncResources();

    const stats = rm.getStats();
    expect(stats.syncOperations).toBe(1);
  });

  // ==================== Test 20: dispose — clears timers and resources ====================

  it('dispose clears resources and emits cacheCleared', () => {
    const events: any[] = [];
    rm.on(ResourceManager.EVENTS.CACHE_CLEARED, e => events.push(e));

    rm.registerResource(makeResource(), 's1');
    rm.dispose();

    // After dispose, resources should be cleared
    const list = rm.listResources();
    expect(list).toHaveLength(0);
    expect(events.some(e => e.reason === 'disposal')).toBe(true);
  });
});
