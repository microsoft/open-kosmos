// @ts-nocheck
/**
 * Tests for cache/CacheManager.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheManager } from '../cache/CacheManager';
import type { CacheKey } from '../cache/CacheManager';

// Helper to create a cache key
function key(type: CacheKey['type'], serverId: string, identifier: string): CacheKey {
  return { type, serverId, identifier };
}

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({
      maxSize: 10,
      defaultTtl: 5000,
      maxMemoryMB: 10,
      cleanupIntervalMs: 999999, // Disable auto-cleanup during tests
      enableCompression: false,
      persistToDisk: false
    });
  });

  afterEach(() => {
    cache.destroy?.();
  });

  // -------------------------------------------------------------------------
  // set / get basics
  // -------------------------------------------------------------------------

  describe('set and get', () => {
    it('stores and retrieves a value', () => {
      const k = key('tools', 'server1', 'list');
      cache.set(k, [{ name: 'tool1' }]);
      expect(cache.get(k)).toEqual([{ name: 'tool1' }]);
    });

    it('returns null for a non-existent key', () => {
      expect(cache.get(key('tools', 'server1', 'missing'))).toBeNull();
    });

    it('returns null for an expired entry', async () => {
      const k = key('tools', 'server1', 'list');
      cache.set(k, 'value', 10); // 10ms TTL
      await new Promise(r => setTimeout(r, 20));
      expect(cache.get(k)).toBeNull();
    });

    it('updates an existing entry on re-set', () => {
      const k = key('tools', 'server1', 'list');
      cache.set(k, 'v1');
      cache.set(k, 'v2');
      expect(cache.get(k)).toBe('v2');
    });

    it('uses custom TTL when provided', async () => {
      const k = key('tools', 'server1', 'ttl-test');
      cache.set(k, 'data', 5000); // Long TTL
      await new Promise(r => setTimeout(r, 10));
      expect(cache.get(k)).toBe('data');
    });
  });

  // -------------------------------------------------------------------------
  // has
  // -------------------------------------------------------------------------

  describe('has', () => {
    it('returns true for existing, non-expired entry', () => {
      const k = key('resources', 'srv', 'r1');
      cache.set(k, 'v');
      expect(cache.has(k)).toBe(true);
    });

    it('returns false for missing key', () => {
      expect(cache.has(key('resources', 'srv', 'nope'))).toBe(false);
    });

    it('returns false for expired entry', async () => {
      const k = key('resources', 'srv', 'exp');
      cache.set(k, 'v', 10);
      await new Promise(r => setTimeout(r, 25));
      expect(cache.has(k)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('removes an existing entry and returns true', () => {
      const k = key('tools', 'srv', 'x');
      cache.set(k, 'val');
      expect(cache.delete(k)).toBe(true);
      expect(cache.get(k)).toBeNull();
    });

    it('returns false when key does not exist', () => {
      expect(cache.delete(key('tools', 'srv', 'ghost'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set(key('tools', 's1', 'a'), 'v1');
      cache.set(key('tools', 's1', 'b'), 'v2');
      cache.clear();
      expect(cache.get(key('tools', 's1', 'a'))).toBeNull();
      expect(cache.get(key('tools', 's1', 'b'))).toBeNull();
    });

    it('emits CACHE_CLEARED event', () => {
      const listener = vi.fn();
      cache.on(CacheManager.EVENTS.CACHE_CLEARED, listener);
      cache.clear();
      expect(listener).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // stats: hits / misses
  // -------------------------------------------------------------------------

  describe('stats', () => {
    it('tracks hits', () => {
      const k = key('tools', 'srv', 'k');
      cache.set(k, 'v');
      cache.get(k);
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
    });

    it('tracks misses', () => {
      cache.get(key('tools', 'srv', 'missing'));
      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // invalidateServer
  // -------------------------------------------------------------------------

  describe('invalidateServer', () => {
    it('removes all entries for a given server', () => {
      cache.set(key('tools', 's1', 'a'), 'v1');
      cache.set(key('resources', 's1', 'b'), 'v2');
      cache.set(key('tools', 's2', 'c'), 'v3');
      const count = cache.invalidateServer('s1');
      expect(count).toBe(2);
      expect(cache.get(key('tools', 's1', 'a'))).toBeNull();
      expect(cache.get(key('tools', 's2', 'c'))).toBe('v3');
    });

    it('returns 0 when no entries for server', () => {
      expect(cache.invalidateServer('unknown-srv')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // invalidateByType
  // -------------------------------------------------------------------------

  describe('invalidateByType', () => {
    it('removes all tools entries', () => {
      cache.set(key('tools', 's1', 'a'), 'v1');
      cache.set(key('resources', 's1', 'b'), 'v2');
      const count = cache.invalidateByType('tools');
      expect(count).toBe(1);
      expect(cache.get(key('resources', 's1', 'b'))).toBe('v2');
    });

    it('removes entries by type scoped to serverId', () => {
      cache.set(key('tools', 's1', 'a'), 'v1');
      cache.set(key('tools', 's2', 'b'), 'v2');
      const count = cache.invalidateByType('tools', 's1');
      expect(count).toBe(1);
      expect(cache.get(key('tools', 's2', 'b'))).toBe('v2');
    });
  });

  // -------------------------------------------------------------------------
  // invalidateByPattern
  // -------------------------------------------------------------------------

  describe('invalidateByPattern', () => {
    it('removes entries matching a pattern', () => {
      cache.set(key('tools', 'srvA', 'k1'), 'v1');
      cache.set(key('tools', 'srvB', 'k2'), 'v2');
      const count = cache.invalidateByPattern({ serverId: 'srvA' });
      expect(count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // LRU eviction
  // -------------------------------------------------------------------------

  describe('LRU eviction', () => {
    it('evicts entries when maxSize is reached', () => {
      const smallCache = new CacheManager({
        maxSize: 3,
        defaultTtl: 60000,
        maxMemoryMB: 10,
        cleanupIntervalMs: 999999,
        enableCompression: false,
        persistToDisk: false
      });

      smallCache.set(key('tools', 'srv', 'k1'), 'v1');
      smallCache.set(key('tools', 'srv', 'k2'), 'v2');
      smallCache.set(key('tools', 'srv', 'k3'), 'v3');

      // Verify all 3 are present
      expect(smallCache.get(key('tools', 'srv', 'k1'))).toBe('v1');
      expect(smallCache.get(key('tools', 'srv', 'k2'))).toBe('v2');
      expect(smallCache.get(key('tools', 'srv', 'k3'))).toBe('v3');

      // Adding k4 should evict exactly one entry
      smallCache.set(key('tools', 'srv', 'k4'), 'v4');
      expect(smallCache.get(key('tools', 'srv', 'k4'))).toBe('v4');

      // Total in cache should not exceed maxSize
      const stats = smallCache.getStats();
      expect(stats.entries).toBeLessThanOrEqual(3);

      smallCache.destroy?.();
    });
  });

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  describe('events', () => {
    it('emits CACHE_HIT on successful get', () => {
      const listener = vi.fn();
      cache.on(CacheManager.EVENTS.CACHE_HIT, listener);
      const k = key('tools', 'srv', 'h');
      cache.set(k, 'v');
      cache.get(k);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('emits CACHE_MISS on missing key', () => {
      const listener = vi.fn();
      cache.on(CacheManager.EVENTS.CACHE_MISS, listener);
      cache.get(key('tools', 'srv', 'miss'));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
