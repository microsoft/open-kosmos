/**
 * McpConfigManager — the runtime owner of installed global MCP server configs.
 *
 * Installed global MCP server configs used to live inside `profile.json` as `ProfileV2.mcp_servers` and
 * was read/written through `ProfileCacheManager`. It now lives in a sibling
 * `mcp.json` (see {@link ./mcpFileStore}) and this manager owns it end-to-end in
 * the main process:
 *
 * - It holds the per-alias installed server configs in memory (the runtime source of truth) and is
 *   the ONLY writer of `mcp.json`. `ProfileCacheManager` writes only `profile.json`.
 * - It keeps its own per-alias content fingerprint and `updatedAt`, so `mcp.json`
 *   is rewritten (and its timestamp advanced) only when installed server content
 *   actually changes — fully independent of unrelated `profile.json` saves.
 * - It serializes its own writes with a per-alias mutex that is independent of the
 *   `profile.json` write lock, so the two files never deadlock each other.
 *
 * The wire contract to the renderer is intentionally unchanged: `ProfileCacheManager`
 * still injects `mcp_servers` (read from this manager) into the `profile:cacheUpdated`
 * payload, so `mcpClientCacheManager` on the renderer keeps receiving installed servers the
 * same way it always has.
 *
 * Load handoff: during a profile load `ProfileCacheManager` calls
 * {@link resolveFromDisk} (seeding the cache from `mcp.json`, or from the legacy
 * `profile.json` slice when `mcp.json` is absent), lets the migration/sanitize
 * pipeline run against a transiently-attached `mcp_servers`, then calls
 * {@link commitResolvedServers} to hand the post-migration installed servers back. After that
 * the field is stripped from the cached profile and this manager is authoritative.
 */

import * as fs from 'fs';
import * as path from 'path';

import { createConsoleLogger } from '../unifiedLogger';
import { getProfileDirectoryPath } from './pathUtils';
import { McpServerConfig } from './types/profile';
import { sanitizeMcpServerList } from './profileSanitizer';
import { readMcpFile, writeMcpFile, fingerprintMcpServers } from './mcpFileStore';
import { copyJsonFileWithRedaction } from './profileBackupManager';

const logger = createConsoleLogger();

class McpConfigManager {
  private static instance: McpConfigManager | null = null;

  /** Per-alias in-memory installed server cache — the runtime source of truth. */
  private cache: Map<string, McpServerConfig[]> = new Map();

  /**
   * Per-alias fingerprint of what is currently persisted in `mcp.json`,
   * deliberately excluding the volatile `updatedAt` so a no-op write is skipped
   * and the timestamp is not bumped for unchanged installed servers.
   */
  private lastFingerprint: Map<string, string> = new Map();

  /** Per-alias write serialization, independent of the `profile.json` write lock. */
  private writeLocks: Map<string, Promise<void>> = new Map();

  static getInstance(): McpConfigManager {
    if (!McpConfigManager.instance) {
      McpConfigManager.instance = new McpConfigManager();
    }
    return McpConfigManager.instance;
  }

  private getMcpFilePath(alias: string): string {
    return path.join(getProfileDirectoryPath(alias), 'mcp.json');
  }

  /**
   * Per-alias async mutex (mirrors `withProfileWriteLock` but scoped to this
   * manager's `mcp.json` writes). Only the public mutators and the load handoff
   * take it; the lock-free internal helpers ({@link resolveFromDisk},
   * {@link persistServers}) are reused from inside a held lock without reentering.
   */
  private async withWriteLock<T>(alias: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeLocks.get(alias);
    // Definite-assignment: the Promise executor below runs synchronously and
    // assigns `release` before it is ever called, so no noop placeholder is needed.
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    this.writeLocks.set(alias, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.writeLocks.get(alias) === current) {
        this.writeLocks.delete(alias);
      }
    }
  }

  // ──────────────────────────── synchronous reads ────────────────────────────

  /** The current installed server configs for `alias` (empty array when not loaded). */
  getServers(alias: string): McpServerConfig[] {
    return this.cache.get(alias) ?? [];
  }

  /** A single server config by name, or `null` when absent/not loaded. */
  getServerInfo(alias: string, serverName: string): McpServerConfig | null {
    return this.cache.get(alias)?.find(server => server.name === serverName) ?? null;
  }

  /** Whether installed server configs for `alias` have been loaded into the cache. */
  hasServersLoaded(alias: string): boolean {
    return this.cache.has(alias);
  }

  /** Whether `mcp.json` is known to durably contain the cached installed server configs. */
  hasPersistedServers(alias: string): boolean {
    return this.lastFingerprint.has(alias);
  }

  // ───────────────────────────── load / handoff ──────────────────────────────

  /**
   * Resolve installed server configs from `mcp.json` into the cache WITHOUT writing.
   *
   * - present & valid → cache the file's servers and prime the fingerprint from disk.
   * - absent → cache `legacySlice` (the slice read from `profile.json` for a legacy
   *   profile, or `[]`) and clear the fingerprint so the next commit/CRUD seeds the file.
   * - corrupt → back up the bad file, cache empty, and clear the fingerprint to force
   *   a clean rewrite (never a silent data loss).
   */
  async resolveFromDisk(alias: string, legacySlice?: McpServerConfig[]): Promise<void> {
    const mcpPath = this.getMcpFilePath(alias);
    const { file, corrupt } = await readMcpFile(mcpPath);

    if (corrupt) {
      await this.backupCorruptFile(alias, mcpPath);
      this.cache.set(alias, []);
      this.lastFingerprint.delete(alias);
      return;
    }

    if (file) {
      // readMcpFile only returns a file when mcp_servers is a valid array.
      // Sanitize on load so the in-memory cache (which getServers() exposes and the
      // renderer profile payload re-injects) can never surface retired plugin--*
      // servers, even when a later persist write fails before it would rewrite the
      // file. The fingerprint is primed from the RAW slice so the first persist
      // still detects the diff and durably rewrites the sanitized form to disk.
      this.cache.set(alias, sanitizeMcpServerList(file.mcp_servers));
      this.lastFingerprint.set(alias, fingerprintMcpServers(file.mcp_servers));
      return;
    }

    // mcp.json absent → legacy/fresh profile: seed the cache from the slice (also
    // sanitized so orphaned plugin servers never reach the cache) for seeding on the
    // next write, and force that write by leaving the fingerprint unset.
    this.cache.set(alias, sanitizeMcpServerList(Array.isArray(legacySlice) ? legacySlice : []));
    this.lastFingerprint.delete(alias);
  }

  /**
   * Post-migration handoff: cache the (sanitized) installed server configs and write `mcp.json`
   * only when its content actually differs from disk — seeds a legacy/fresh
   * profile, rewrites when a migration changed installed servers, and is a no-op for
   * unchanged installed servers.
   */
  async commitResolvedServers(alias: string, servers: McpServerConfig[]): Promise<void> {
    await this.withWriteLock(alias, () => this.persistServers(alias, servers));
  }

  // ──────────────────────────────── CRUD ─────────────────────────────────────

  /** Add a server. Returns `false` if a server with the same name already exists. */
  async addServer(alias: string, config: McpServerConfig): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      const current = await this.ensureLoaded(alias);
      if (current.some(server => server.name === config.name)) {
        return false;
      }
      await this.persistServers(alias, [...current, config]);
      return true;
    });
  }

  /** Merge `updates` into a server by name. Returns `false` when not found. */
  async updateServer(
    alias: string,
    serverName: string,
    updates: Partial<McpServerConfig>,
  ): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      const current = await this.ensureLoaded(alias);
      const index = current.findIndex(server => server.name === serverName);
      if (index < 0) {
        return false;
      }
      const next = current.map((server, i) => (i === index ? { ...server, ...updates } : server));
      await this.persistServers(alias, next);
      return true;
    });
  }

  /** Remove a server by name. Returns `false` when not found. */
  async deleteServer(alias: string, serverName: string): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      const current = await this.ensureLoaded(alias);
      const index = current.findIndex(server => server.name === serverName);
      if (index < 0) {
        return false;
      }
      await this.persistServers(alias, current.filter((_, i) => i !== index));
      return true;
    });
  }

  /** Set a server's `in_use` flag by name. Returns `false` when not found. */
  async setServerInUse(alias: string, serverName: string, inUse: boolean): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      const current = await this.ensureLoaded(alias);
      const index = current.findIndex(server => server.name === serverName);
      if (index < 0) {
        return false;
      }
      const next = current.map((server, i) => (i === index ? { ...server, in_use: inUse } : server));
      await this.persistServers(alias, next);
      return true;
    });
  }

  /** Drop cached state for one alias (sign-out) or, with no argument, all aliases. */
  clearCache(alias?: string): void {
    if (alias === undefined) {
      this.cache.clear();
      this.lastFingerprint.clear();
      return;
    }
    this.cache.delete(alias);
    this.lastFingerprint.delete(alias);
  }

  // ────────────────────────────── internals ──────────────────────────────────

  private async ensureLoaded(alias: string): Promise<McpServerConfig[]> {
    if (!this.cache.has(alias)) {
      await this.resolveFromDisk(alias);
    }
    // resolveFromDisk always populates the cache for `alias` (every branch calls
    // cache.set), so the `?? []` fallback is unreachable; it only satisfies the
    // `T | undefined` return type of Map.get.
    /* v8 ignore next */
    return this.cache.get(alias) ?? [];
  }

  /**
   * Sanitize → dirty-check → atomic write → cache. The single choke point that
   * persists `mcp.json`, so every stored installed server config is normalized and the file's own
   * `updatedAt` advances only when the content actually changed.
   */
  private async persistServers(alias: string, servers: McpServerConfig[]): Promise<void> {
    const clean = sanitizeMcpServerList(servers);
    const fingerprint = fingerprintMcpServers(clean);
    if (this.lastFingerprint.get(alias) === fingerprint) {
      this.cache.set(alias, clean);
      return;
    }

    await writeMcpFile(this.getMcpFilePath(alias), clean, new Date().toISOString(), {
      onRetry: ({ attempt, error, delayMs }) => {
        logger.warn(
          '[McpConfigManager] Transient mcp.json rename failure; retrying',
          'persistServers',
          { alias, attempt, delayMs, code: error.code },
        );
      },
    });
    this.cache.set(alias, clean);
    this.lastFingerprint.set(alias, fingerprint);
  }

  private async backupCorruptFile(alias: string, mcpPath: string): Promise<void> {
    const backupPath = `${mcpPath}.corrupt-${Date.now()}`;
    try {
      await copyJsonFileWithRedaction(mcpPath, backupPath);
      logger.error(
        '[McpConfigManager] Existing mcp.json could not be read; backed up redacted content before treating installed MCP servers as empty',
        'resolveFromDisk',
        { alias, backupPath },
      );
    } catch (error) {
      logger.error(
        '[McpConfigManager] Failed to back up unreadable mcp.json',
        'resolveFromDisk',
        { alias, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}

export const mcpConfigManager = McpConfigManager.getInstance();
export { McpConfigManager };
