/**
 * HooksConfigManager — the runtime owner of the global Agent Hook library: the
 * user's installed/created global hooks (formerly `ProfileV2.hooks`).
 *
 * The library used to live inside `profile.json` as `ProfileV2.hooks` and was
 * read/written through `ProfileCacheManager`. It now lives in a sibling
 * `hooks.json` (see {@link ./hooksFileStore}) and this manager owns it
 * end-to-end in the main process, structurally mirroring {@link ./skillsConfigManager}:
 *
 * - It holds the per-alias hook library in memory (the runtime source of truth)
 *   and is the ONLY writer of `hooks.json`. `ProfileCacheManager` writes only
 *   `profile.json`, which no longer carries the hook list at all.
 * - It keeps its own per-alias content fingerprint and `updatedAt`, so `hooks.json`
 *   is rewritten (and its timestamp advanced) only when the library content
 *   actually changes — fully independent of unrelated `profile.json` saves.
 * - It serializes its own writes with a per-alias mutex independent of the
 *   `profile.json` write lock, so the two files never deadlock each other.
 *
 * The wire contract to the renderer is intentionally unchanged: `ProfileCacheManager`
 * still injects `hooks` (read from this manager) into the `profile:cacheUpdated`
 * payload, so the renderer keeps receiving the library the same way it always has.
 *
 * IMPORTANT: only the hook *list* lives here. The Hooks master switch
 * (`ProfileV2.hooksEnabled`) intentionally stays in `profile.json` and continues
 * to be read/written through `ProfileCacheManager` / `profileHookCrud`.
 *
 * Unlike `SkillsConfigManager` (whose registry entries are flat and keyed by
 * name), hooks are keyed by `id` and carry server-managed `createdAt`/`updatedAt`
 * stamps and a structural validity contract, so the CRUD here:
 * - rejects a malformed `HookDefinition` (via `isValidHookDefinition`),
 * - rejects a duplicate `id` on add (it never updates-on-duplicate),
 * - stamps `createdAt`/`updatedAt` on add and refreshes `updatedAt` on update,
 *   keeping `id`/`createdAt` immutable.
 */

import { HookDefinition } from './types/profile';
import { isValidHookDefinition } from '../agentHooks/schemas';
import { getProfileDirectoryPath } from './pathUtils';
import {
  readHooksFile,
  writeHooksFile,
  sanitizeHookEntries,
  fingerprintHooks,
  loadHooksForProfile,
} from './hooksFileStore';
import { createConsoleLogger } from '../unifiedLogger';

const logger = createConsoleLogger();

/** Fields a caller may change via {@link HooksConfigManager.updateHook}. `id`, `createdAt` and `updatedAt` are managed internally. */
export type UpdateHookInput = Partial<Omit<HookDefinition, 'id' | 'createdAt' | 'updatedAt'>>;

export class HooksConfigManager {
  private static instance: HooksConfigManager | null = null;

  /** Per-alias in-memory hook library — the runtime source of truth for reads. */
  private library: Map<string, HookDefinition[]> = new Map();

  /**
   * Per-alias fingerprint of what is currently persisted in `hooks.json`,
   * deliberately excluding the volatile file-level `updatedAt` so a no-op write is
   * skipped and the timestamp is not bumped for an unchanged library.
   */
  private lastFingerprint: Map<string, string> = new Map();

  /** Per-alias write serialization, independent of the `profile.json` write lock. */
  private writeLocks: Map<string, Promise<void>> = new Map();

  static getInstance(): HooksConfigManager {
    if (!HooksConfigManager.instance) {
      HooksConfigManager.instance = new HooksConfigManager();
    }
    return HooksConfigManager.instance;
  }

  private getProfileDir(alias: string): string {
    return getProfileDirectoryPath(alias);
  }

  /**
   * Per-alias async mutex (mirrors `withProfileWriteLock` but scoped to this
   * manager's `hooks.json` writes). Only the public mutators take it; the
   * lock-free internal helpers ({@link resolveFromDisk}, {@link persistHooks})
   * are reused from inside a held lock without reentering.
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

  /** The current global hook library for `alias` (defensive copy; empty when not loaded). */
  getHooks(alias: string): HookDefinition[] {
    const hooks = this.library.get(alias);
    return hooks ? hooks.map(hook => ({ ...hook })) : [];
  }

  /** A single hook by id (defensive copy), or `undefined` when absent/not loaded. */
  getHook(alias: string, hookId: string): HookDefinition | undefined {
    const found = this.library.get(alias)?.find(hook => hook.id === hookId);
    return found ? { ...found } : undefined;
  }

  /** Whether the alias's library contains a hook with the given id. */
  hasHook(alias: string, hookId: string): boolean {
    return this.library.get(alias)?.some(hook => hook.id === hookId) ?? false;
  }

  /** Whether the library for `alias` has been loaded into memory. */
  hasHooksLoaded(alias: string): boolean {
    return this.library.has(alias);
  }

  /** Whether `hooks.json` is known to durably contain the cached library. */
  hasPersistedHooks(alias: string): boolean {
    return this.lastFingerprint.has(alias);
  }

  // ───────────────────────────── load / handoff ──────────────────────────────

  /**
   * Resolve and cache the global hook library for a profile being loaded.
   *
   * Delegates legacy-inline migration to `loadHooksForProfile` (so a profile
   * that still carries inline `rawProfile.hooks` is split into `hooks.json` on
   * first load) and returns the caller's `needsProfileRewrite` flag so
   * `ProfileCacheManager` can strip the legacy field from `profile.json`. The
   * resolved library is cached and its fingerprint primed so a subsequent CRUD
   * write skips a no-op rewrite.
   */
  async loadForAlias(
    alias: string,
    rawProfile: { hooks?: unknown },
  ): Promise<{ hooks: HookDefinition[]; needsProfileRewrite: boolean }> {
    const profileDir = this.getProfileDir(alias);
    const result = await loadHooksForProfile(profileDir, rawProfile);
    this.library.set(alias, result.hooks);
    this.lastFingerprint.set(alias, fingerprintHooks(sanitizeHookEntries(result.hooks)));
    return result;
  }

  /**
   * Resolve the library from `hooks.json` into the cache WITHOUT writing or
   * migrating. Used by CRUD on a cold cache.
   *
   * - present & valid → cache the file's hooks and prime the fingerprint from disk.
   * - absent/corrupt → cache `legacySlice` (or `[]`) and clear the fingerprint so
   *   the next write seeds the file. (`readHooksFile` already backs up a corrupt
   *   file before returning `null`.)
   */
  async resolveFromDisk(alias: string, legacySlice?: HookDefinition[]): Promise<void> {
    const hooks = await readHooksFile(this.getProfileDir(alias));
    if (hooks !== null) {
      this.library.set(alias, hooks);
      this.lastFingerprint.set(alias, fingerprintHooks(hooks));
      return;
    }
    this.library.set(alias, Array.isArray(legacySlice) ? legacySlice : []);
    this.lastFingerprint.delete(alias);
  }

  /**
   * Durably persist a resolved library to `hooks.json` under the write lock,
   * priming the fingerprint. Used by the profile→sidecar handoff to seed
   * `hooks.json` before a profile write strips the legacy inline slice.
   */
  async commitResolvedHooks(alias: string, hooks: HookDefinition[]): Promise<void> {
    await this.withWriteLock(alias, () => this.persistHooks(alias, hooks));
  }

  // ──────────────────────────────── CRUD ─────────────────────────────────────

  /**
   * Add a hook to the global library. Rejects a malformed definition and a
   * duplicate `id` (returns `false` in both cases) — it never updates-on-duplicate.
   * Stamps `createdAt`/`updatedAt` server-side. Writes ONLY `hooks.json` — no
   * `profile.json` write.
   */
  async addHook(alias: string, hook: HookDefinition): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      try {
        if (!isValidHookDefinition(hook)) {
          logger.warn(`[HooksConfigManager] addHook failed: invalid hook definition for "${alias}"`);
          return false;
        }
        const current = await this.ensureLoaded(alias);
        if (current.some(existing => existing.id === hook.id)) {
          logger.warn(`[HooksConfigManager] addHook failed: hook id "${hook.id}" already exists for "${alias}"`);
          return false;
        }
        const now = new Date().toISOString();
        const next = [...current, { ...hook, createdAt: now, updatedAt: now }];
        await this.persistHooks(alias, next);
        return true;
      } catch (error) {
        logger.error(`[HooksConfigManager] addHook error for "${alias}":`, error instanceof Error ? error.message : String(error));
        return false;
      }
    });
  }

  /**
   * Update an existing hook's config in the global library. `id` and `createdAt`
   * are immutable; `updatedAt` is always refreshed. No-op (returns `false`) when
   * the hook does not exist or the merged result would be structurally invalid.
   */
  async updateHook(alias: string, hookId: string, updates: UpdateHookInput): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      try {
        const current = await this.ensureLoaded(alias);
        const index = current.findIndex(hook => hook.id === hookId);
        if (index < 0) {
          return false;
        }
        const existing = current[index];
        const merged: HookDefinition = {
          ...existing,
          ...updates,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        };
        if (!isValidHookDefinition(merged)) {
          logger.warn(`[HooksConfigManager] updateHook failed: invalid result for hook "${hookId}" ("${alias}")`);
          return false;
        }
        const next = current.map((hook, i) => (i === index ? merged : hook));
        await this.persistHooks(alias, next);
        return true;
      } catch (error) {
        logger.error(`[HooksConfigManager] updateHook error for "${alias}":`, error instanceof Error ? error.message : String(error));
        return false;
      }
    });
  }

  /**
   * Remove a hook from the global library by id. No-op (returns `false`) when the
   * hook does not exist.
   */
  async deleteHook(alias: string, hookId: string): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      try {
        const current = await this.ensureLoaded(alias);
        const index = current.findIndex(hook => hook.id === hookId);
        if (index < 0) {
          return false;
        }
        await this.persistHooks(alias, current.filter((_, i) => i !== index));
        return true;
      } catch (error) {
        logger.error(`[HooksConfigManager] deleteHook error for "${alias}":`, error instanceof Error ? error.message : String(error));
        return false;
      }
    });
  }

  /** Drop the cached library for an alias (sign-out / cache clear). */
  clearForAlias(alias: string): void {
    this.library.delete(alias);
    this.lastFingerprint.delete(alias);
  }

  /** Drop all cached libraries (full cache clear). */
  clearAll(): void {
    this.library.clear();
    this.lastFingerprint.clear();
  }

  // ────────────────────────────── internals ──────────────────────────────────

  private async ensureLoaded(alias: string): Promise<HookDefinition[]> {
    if (!this.library.has(alias)) {
      await this.resolveFromDisk(alias);
    }
    // resolveFromDisk always populates the library for `alias` (every branch
    // calls library.set), so the `?? []` fallback is unreachable; it only
    // satisfies the `T | undefined` return type of Map.get.
    /* v8 ignore next */
    return this.library.get(alias) ?? [];
  }

  /**
   * Sanitize → dirty-check → atomic write → cache. The single choke point that
   * persists `hooks.json`, so every stored hook is normalized and the file's
   * own `updatedAt` advances only when the content actually changed.
   */
  private async persistHooks(alias: string, hooks: HookDefinition[]): Promise<void> {
    const clean = sanitizeHookEntries(hooks);
    const fingerprint = fingerprintHooks(clean);
    if (this.lastFingerprint.get(alias) === fingerprint) {
      this.library.set(alias, clean);
      return;
    }

    await writeHooksFile(this.getProfileDir(alias), clean, {
      onRetry: ({ attempt, error, delayMs }) => {
        logger.warn(
          '[HooksConfigManager] Transient hooks.json rename failure; retrying',
          'persistHooks',
          { alias, attempt, delayMs, code: error.code },
        );
      },
    });
    this.library.set(alias, clean);
    this.lastFingerprint.set(alias, fingerprint);
  }
}

export const hooksConfigManager = HooksConfigManager.getInstance();
