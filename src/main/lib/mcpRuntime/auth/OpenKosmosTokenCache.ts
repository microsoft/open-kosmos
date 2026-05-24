/**
 * OpenKosmosTokenCache — MCP OAuth credential persistence.
 *
 * Stores per-server OAuth credentials (access token, refresh token, DCR
 * client information) in an encrypted, profile-scoped cache file.
 * This module handles only the `mcpOAuth` section of the credential cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUnifiedLogger } from '../../unifiedLogger';
import { mainAuthManager } from '../../auth/authManager';
import { getProfileDirectoryPath } from '../../userDataADO/pathUtils';

const logger = getUnifiedLogger();

const CACHE_VERSION = 1 as const;
const CACHE_FILE_NAME = 'browserAuthTokenCache';
const FALLBACK_FILE_NAME = `${CACHE_FILE_NAME}.json`;

type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

/**
 * OAuth credential record for a single MCP server.
 * Stored under `OpenKosmosTokenCacheData.mcpOAuth` keyed by the value returned by
 * `getMcpOAuthServerKey(name, cfg)` so that renaming or reconfiguring a
 * server invalidates the slot automatically.
 *
 * `accessToken` is allowed to be empty when only DCR client information has
 * been written (between SDK's `saveClientInformation` and `saveTokens`
 * calls). Consumers should treat `accessToken === ''` as "no usable token".
 */
export interface PersistedMcpOAuthEntry {
  serverName: string;
  serverUrl: string;
  /** Empty string means "no usable access token yet" (e.g. DCR completed but PKCE not yet finished). */
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch milliseconds. 0 means "no usable access token". */
  expiresAt: number;
  scope?: string;
  /** Pre-configured or DCR-issued client id. */
  clientId?: string;
  /** Optional client secret for confidential clients. */
  clientSecret?: string;
  /** Cached OAuth metadata to skip re-discovery on refresh. URL-only to avoid keychain bloat. */
  discoveryState?: {
    authorizationServerUrl: string;
    resourceMetadataUrl?: string;
  };
  /** Scope cached from a 403 insufficient_scope response, used on the next interactive flow. */
  stepUpScope?: string;
}

interface OpenKosmosTokenCacheData {
  version: typeof CACHE_VERSION;
  mcpOAuth?: Record<string, PersistedMcpOAuthEntry>;
  updatedAt: number;
}

function resolveSafeStorage(): SafeStorageLike | null {
  try {
    return require('electron').safeStorage as SafeStorageLike;
  } catch {
    return null;
  }
}

function cloneCache(data: OpenKosmosTokenCacheData): OpenKosmosTokenCacheData {
  return JSON.parse(JSON.stringify(data)) as OpenKosmosTokenCacheData;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeMcpOAuthEntry(value: unknown): PersistedMcpOAuthEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Partial<PersistedMcpOAuthEntry>;

  if (
    !isNonEmptyString(entry.serverName) ||
    typeof entry.serverUrl !== 'string' ||
    typeof entry.accessToken !== 'string' ||
    typeof entry.expiresAt !== 'number' ||
    !Number.isFinite(entry.expiresAt)
  ) {
    return undefined;
  }

  const normalized: PersistedMcpOAuthEntry = {
    serverName: entry.serverName,
    serverUrl: entry.serverUrl,
    accessToken: entry.accessToken,
    expiresAt: entry.expiresAt,
  };

  if (isNonEmptyString(entry.refreshToken)) normalized.refreshToken = entry.refreshToken;
  if (isNonEmptyString(entry.scope)) normalized.scope = entry.scope;
  if (isNonEmptyString(entry.clientId)) normalized.clientId = entry.clientId;
  if (isNonEmptyString(entry.clientSecret)) normalized.clientSecret = entry.clientSecret;
  if (isNonEmptyString(entry.stepUpScope)) normalized.stepUpScope = entry.stepUpScope;

  if (entry.discoveryState && typeof entry.discoveryState === 'object') {
    const ds = entry.discoveryState as { authorizationServerUrl?: unknown; resourceMetadataUrl?: unknown };
    if (isNonEmptyString(ds.authorizationServerUrl)) {
      normalized.discoveryState = { authorizationServerUrl: ds.authorizationServerUrl };
      if (isNonEmptyString(ds.resourceMetadataUrl)) {
        normalized.discoveryState.resourceMetadataUrl = ds.resourceMetadataUrl;
      }
    }
  }

  return normalized;
}

function normalizeMcpOAuthMap(value: unknown): Record<string, PersistedMcpOAuthEntry> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, PersistedMcpOAuthEntry> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isNonEmptyString(key)) continue;
    const entry = normalizeMcpOAuthEntry(raw);
    if (entry) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeCacheData(value: unknown): OpenKosmosTokenCacheData | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<OpenKosmosTokenCacheData>;
  if (raw.version !== CACHE_VERSION) return null;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;

  const normalized: OpenKosmosTokenCacheData = {
    version: CACHE_VERSION,
    updatedAt: raw.updatedAt,
  };

  const mcpOAuth = normalizeMcpOAuthMap(raw.mcpOAuth);
  if (mcpOAuth) normalized.mcpOAuth = mcpOAuth;

  return normalized;
}

export class OpenKosmosTokenCache {
  private static instance: OpenKosmosTokenCache | null = null;

  private cache: OpenKosmosTokenCacheData | null = null;
  private loadedCachePath: string | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  static getInstance(): OpenKosmosTokenCache {
    if (!OpenKosmosTokenCache.instance) {
      OpenKosmosTokenCache.instance = new OpenKosmosTokenCache();
    }
    return OpenKosmosTokenCache.instance;
  }

  private getCurrentAlias(): string | null {
    try {
      const alias = mainAuthManager.getCurrentAuth()?.ghcAuth?.alias;
      return isNonEmptyString(alias) ? alias : null;
    } catch {
      return null;
    }
  }

  private getStorageDirectory(): string | null {
    const alias = this.getCurrentAlias();
    if (!alias) return null;
    return path.join(getProfileDirectoryPath(alias), 'credentials');
  }

  private getEncryptedCachePath(): string | null {
    const directory = this.getStorageDirectory();
    return directory ? path.join(directory, `${CACHE_FILE_NAME}.enc`) : null;
  }

  private getFallbackCachePath(): string | null {
    const directory = this.getStorageDirectory();
    return directory ? path.join(directory, FALLBACK_FILE_NAME) : null;
  }

  private logMissingAlias(operation: 'load' | 'save' | 'clear'): void {
    logger.warn('[OpenKosmosTokenCache] Skipping cache operation: no active profile alias', operation);
  }

  private async readPersistedCache(): Promise<OpenKosmosTokenCacheData | null> {
    const encryptedPath = this.getEncryptedCachePath();
    const fallbackPath = this.getFallbackCachePath();
    const safeStorage = resolveSafeStorage();

    if (!encryptedPath || !fallbackPath) {
      this.logMissingAlias('load');
      this.loadedCachePath = null;
      return null;
    }

    try {
      if (safeStorage?.isEncryptionAvailable() && fs.existsSync(encryptedPath)) {
        const encrypted = await fs.promises.readFile(encryptedPath);
        const decrypted = safeStorage.decryptString(encrypted);
        const parsed = normalizeCacheData(JSON.parse(decrypted));
        if (parsed) this.loadedCachePath = encryptedPath;
        return parsed;
      }

      if (fs.existsSync(fallbackPath)) {
        const raw = await fs.promises.readFile(fallbackPath, 'utf-8');
        const parsed = normalizeCacheData(JSON.parse(raw));
        if (parsed) this.loadedCachePath = fallbackPath;
        return parsed;
      }
    } catch (error) {
      logger.warn('[OpenKosmosTokenCache] Failed to read persisted cache', 'readPersistedCache', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.loadedCachePath = null;
    return null;
  }

  private async persistCache(data: OpenKosmosTokenCacheData): Promise<void> {
    const directory = this.getStorageDirectory();
    const encryptedPath = this.getEncryptedCachePath();
    const fallbackPath = this.getFallbackCachePath();
    const safeStorage = resolveSafeStorage();

    if (!directory || !encryptedPath || !fallbackPath) {
      this.logMissingAlias('save');
      return;
    }

    await fs.promises.mkdir(directory, { recursive: true });
    const serialized = JSON.stringify(data, null, 2);

    if (safeStorage?.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(serialized);
      await fs.promises.writeFile(encryptedPath, encrypted);
      await fs.promises.rm(fallbackPath, { force: true });
      this.loadedCachePath = encryptedPath;
      return;
    }

    await fs.promises.writeFile(fallbackPath, serialized, 'utf-8');
    this.loadedCachePath = fallbackPath;
  }

  private async load(): Promise<OpenKosmosTokenCacheData | null> {
    if (this.cache) return cloneCache(this.cache);
    const persisted = await this.readPersistedCache();
    this.cache = persisted ? cloneCache(persisted) : null;
    return this.cache ? cloneCache(this.cache) : null;
  }

  private runSerialized<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(() => op(), () => op());
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  // ────────────────── MCP OAuth API ──────────────────

  async getMcpOAuth(serverKey: string): Promise<PersistedMcpOAuthEntry | null> {
    const cache = await this.load();
    return cache?.mcpOAuth?.[serverKey] ?? null;
  }

  async setMcpOAuth(serverKey: string, entry: PersistedMcpOAuthEntry): Promise<void> {
    return this.runSerialized(async () => {
      const existing = (await this.load()) ?? { version: CACHE_VERSION, updatedAt: Date.now() };
      const next: OpenKosmosTokenCacheData = {
        ...existing,
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        mcpOAuth: { ...(existing.mcpOAuth ?? {}), [serverKey]: entry },
      };
      const normalized = normalizeCacheData(next);
      if (!normalized) throw new Error('Invalid MCP OAuth cache payload');
      this.cache = cloneCache(normalized);
      await this.persistCache(normalized);
    });
  }

  async deleteMcpOAuth(serverKey: string): Promise<void> {
    return this.runSerialized(async () => {
      const existing = await this.load();
      if (!existing?.mcpOAuth || !existing.mcpOAuth[serverKey]) return;
      const { [serverKey]: _removed, ...rest } = existing.mcpOAuth;
      void _removed;
      const next: OpenKosmosTokenCacheData = {
        ...existing,
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        mcpOAuth: Object.keys(rest).length > 0 ? rest : undefined,
      };
      const normalized = normalizeCacheData(next);
      if (!normalized) return;
      this.cache = cloneCache(normalized);
      await this.persistCache(normalized);
    });
  }

  async clear(): Promise<void> {
    return this.runSerialized(async () => {
      this.cache = null;
      const encryptedPath = this.getEncryptedCachePath();
      const fallbackPath = this.getFallbackCachePath();
      if (!encryptedPath || !fallbackPath) {
        this.logMissingAlias('clear');
        return;
      }
      await Promise.all([
        fs.promises.rm(encryptedPath, { force: true }),
        fs.promises.rm(fallbackPath, { force: true }),
      ]);
      this.loadedCachePath = null;
    });
  }
}
