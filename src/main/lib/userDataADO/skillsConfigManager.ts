/**
 * SkillsConfigManager — the runtime owner of the global skill registry: the
 * user's installed/registered global skills (formerly `ProfileV2.skills`).
 *
 * The registry used to live inside `profile.json` as `ProfileV2.skills` and was
 * read/written through `ProfileCacheManager`. It now lives in a sibling
 * `skills.json` (see {@link ./skillsFileStore}) and this manager owns it
 * end-to-end in the main process, structurally mirroring {@link ./mcpConfigManager}:
 *
 * - It holds the per-alias skill registry in memory (the runtime source of truth)
 *   and is the ONLY writer of `skills.json`. `ProfileCacheManager` writes only
 *   `profile.json`, which no longer carries skills at all.
 * - It keeps its own per-alias content fingerprint and `updatedAt`, so `skills.json`
 *   is rewritten (and its timestamp advanced) only when the registry content
 *   actually changes — fully independent of unrelated `profile.json` saves.
 * - It serializes its own writes with a per-alias mutex independent of the
 *   `profile.json` write lock, so the two files never deadlock each other.
 *
 * The wire contract to the renderer is intentionally unchanged: `ProfileCacheManager`
 * still injects `skills` (read from this manager) into the `profile:cacheUpdated`
 * payload, so the renderer keeps receiving the registry the same way it always has.
 *
 * NOTE: "registry" here means the locally installed skills on the profile.
 * This manager owns skill configuration persistence and never performs network
 * discovery or installation.
 *
 * Snapshot invalidation (dropping per-chat skill snapshots that referenced a
 * changed skill) is NOT done here: snapshots are an in-memory cache owned by
 * {@link ./chatSkillSnapshotStore} and are invalidated by the CRUD orchestration
 * wrappers in {@link ./profileEntityCrud}, keeping this manager purely about
 * skills.json persistence.
 */

import { SkillConfig } from './types/profile';
import { getProfileDirectoryPath } from './pathUtils';
import {
  readSkillsFile,
  writeSkillsFile,
  sanitizeSkillEntries,
  fingerprintSkills,
  loadSkillsForProfile,
} from './skillsFileStore';
import { createConsoleLogger } from '../unifiedLogger';

const logger = createConsoleLogger();

/** Shape accepted by {@link SkillsConfigManager.addSkill}. */
export interface AddSkillInput {
  name: string;
  description: string;
  version: string;
  remoteVersion?: string;
  source: 'IN-LIBRARY' | 'ON-DEVICE';
}

/** Shape accepted by {@link SkillsConfigManager.updateSkill}. */
export interface UpdateSkillInput {
  description?: string;
  version?: string;
  remoteVersion?: string;
}

export class SkillsConfigManager {
  private static instance: SkillsConfigManager | null = null;

  /** Per-alias in-memory skill registry — the runtime source of truth for reads. */
  private registry: Map<string, SkillConfig[]> = new Map();

  /**
   * Per-alias fingerprint of what is currently persisted in `skills.json`,
   * deliberately excluding the volatile `updatedAt` so a no-op write is skipped
   * and the timestamp is not bumped for an unchanged registry.
   */
  private lastFingerprint: Map<string, string> = new Map();

  /** Per-alias write serialization, independent of the `profile.json` write lock. */
  private writeLocks: Map<string, Promise<void>> = new Map();

  static getInstance(): SkillsConfigManager {
    if (!SkillsConfigManager.instance) {
      SkillsConfigManager.instance = new SkillsConfigManager();
    }
    return SkillsConfigManager.instance;
  }

  private getProfileDir(alias: string): string {
    return getProfileDirectoryPath(alias);
  }

  /**
   * Per-alias async mutex (mirrors `withProfileWriteLock` but scoped to this
   * manager's `skills.json` writes). Only the public mutators take it; the
   * lock-free internal helpers ({@link resolveFromDisk}, {@link persistSkills})
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

  /** The current global skill registry for `alias` (defensive copy; empty when not loaded). */
  getSkills(alias: string): SkillConfig[] {
    const skills = this.registry.get(alias);
    return skills ? skills.map(skill => ({ ...skill })) : [];
  }

  /** A single skill by name (defensive copy), or `undefined` when absent/not loaded. */
  getSkill(alias: string, skillName: string): SkillConfig | undefined {
    const found = this.registry.get(alias)?.find(skill => skill.name === skillName);
    return found ? { ...found } : undefined;
  }

  /** Whether the alias's registry contains a skill with the given name. */
  hasSkill(alias: string, skillName: string): boolean {
    return this.registry.get(alias)?.some(skill => skill.name === skillName) ?? false;
  }

  /** Whether the registry for `alias` has been loaded into memory. */
  hasSkillsLoaded(alias: string): boolean {
    return this.registry.has(alias);
  }

  /** Whether `skills.json` is known to durably contain the cached registry. */
  hasPersistedSkills(alias: string): boolean {
    return this.lastFingerprint.has(alias);
  }

  // ───────────────────────────── load / handoff ──────────────────────────────

  /**
   * Resolve and cache the global skill registry for a profile being loaded.
   *
   * Delegates legacy-inline migration to `loadSkillsForProfile` (so a profile
   * that still carries inline `rawProfile.skills` is split into `skills.json` on
   * first load) and returns the caller's `needsProfileRewrite` flag so
   * `ProfileCacheManager` can strip the legacy field from `profile.json`. The
   * resolved registry is cached and its fingerprint primed so a subsequent CRUD
   * write skips a no-op rewrite.
   */
  async loadForAlias(
    alias: string,
    rawProfile: { skills?: unknown },
  ): Promise<{ skills: SkillConfig[]; needsProfileRewrite: boolean }> {
    const profileDir = this.getProfileDir(alias);
    const result = await loadSkillsForProfile(profileDir, rawProfile);
    this.registry.set(alias, result.skills);
    this.lastFingerprint.set(alias, fingerprintSkills(sanitizeSkillEntries(result.skills)));
    return result;
  }

  /**
   * Resolve the registry from `skills.json` into the cache WITHOUT writing or
   * migrating. Used by CRUD on a cold cache.
   *
   * - present & valid → cache the file's skills and prime the fingerprint from disk.
   * - absent/corrupt → cache `legacySlice` (or `[]`) and clear the fingerprint so
   *   the next write seeds the file. (`readSkillsFile` already backs up a corrupt
   *   file before returning `null`.)
   */
  async resolveFromDisk(alias: string, legacySlice?: SkillConfig[]): Promise<void> {
    const skills = await readSkillsFile(this.getProfileDir(alias));
    if (skills !== null) {
      // readSkillsFile already drops retired plugin skills via sanitizeSkillEntries.
      this.registry.set(alias, skills);
      this.lastFingerprint.set(alias, fingerprintSkills(skills));
      return;
    }
    // skills.json absent → seed the registry from the legacy inline slice, sanitized
    // so orphaned plugin skills never reach the cache that getSkills() exposes and the
    // renderer profile payload re-injects (a later skills.json write failure must not
    // leave plugin entries cached). The fingerprint stays unset to force the seed write.
    this.registry.set(alias, sanitizeSkillEntries(Array.isArray(legacySlice) ? legacySlice : []));
    this.lastFingerprint.delete(alias);
  }

  /**
   * Durably persist a resolved registry to `skills.json` under the write lock,
   * priming the fingerprint. Mirrors {@link McpConfigManager.commitResolvedServers}:
   * used by the profile→sidecar handoff to seed `skills.json` before a profile
   * write strips the legacy inline slice.
   */
  async commitResolvedSkills(alias: string, skills: SkillConfig[]): Promise<void> {
    await this.withWriteLock(alias, () => this.persistSkills(alias, skills));
  }

  // ──────────────────────────────── CRUD ─────────────────────────────────────

  /**
   * Add a skill to the global registry, or update its config in place when a
   * skill with the same name already exists. Returns `true` in both cases (the
   * registry now reflects the requested config); returns `false` only on write
   * failure. Writes ONLY `skills.json` — no `profile.json` write, no snapshot
   * logic (the caller invalidates affected snapshots).
   */
  async addSkill(alias: string, skillConfig: AddSkillInput): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      try {
        const current = await this.ensureLoaded(alias);
        const existingIndex = current.findIndex(skill => skill.name === skillConfig.name);
        let next: SkillConfig[];
        if (existingIndex >= 0) {
          logger.info(`[SkillsConfigManager] addSkill: skill "${skillConfig.name}" already exists, updating config`);
          next = current.map((skill, index) => (index === existingIndex ? { ...skill, ...skillConfig } : skill));
        } else {
          next = [...current, skillConfig];
        }
        await this.persistSkills(alias, next);
        return true;
      } catch (error) {
        logger.error(`[SkillsConfigManager] addSkill error for "${alias}":`, error instanceof Error ? error.message : String(error));
        return false;
      }
    });
  }

  /**
   * Update an existing skill's config in the global registry. No-op (returns
   * `false`) when the skill does not exist.
   */
  async updateSkill(alias: string, skillName: string, updates: UpdateSkillInput): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      try {
        const current = await this.ensureLoaded(alias);
        const index = current.findIndex(skill => skill.name === skillName);
        if (index < 0) {
          return false;
        }
        const next = current.map((skill, i) => (i === index ? { ...skill, ...updates } : skill));
        await this.persistSkills(alias, next);
        return true;
      } catch (error) {
        logger.error(`[SkillsConfigManager] updateSkill error for "${alias}":`, error instanceof Error ? error.message : String(error));
        return false;
      }
    });
  }

  /**
   * Remove a skill from the global registry. No-op (returns `false`) when the
   * skill does not exist.
   */
  async deleteSkill(alias: string, skillName: string): Promise<boolean> {
    return this.withWriteLock(alias, async () => {
      try {
        const current = await this.ensureLoaded(alias);
        const index = current.findIndex(skill => skill.name === skillName);
        if (index < 0) {
          return false;
        }
        await this.persistSkills(alias, current.filter((_, i) => i !== index));
        return true;
      } catch (error) {
        logger.error(`[SkillsConfigManager] deleteSkill error for "${alias}":`, error instanceof Error ? error.message : String(error));
        return false;
      }
    });
  }

  /** Drop the cached registry for an alias (sign-out / cache clear). */
  clearForAlias(alias: string): void {
    this.registry.delete(alias);
    this.lastFingerprint.delete(alias);
  }

  /** Drop all cached registries (full cache clear). */
  clearAll(): void {
    this.registry.clear();
    this.lastFingerprint.clear();
  }

  // ────────────────────────────── internals ──────────────────────────────────

  private async ensureLoaded(alias: string): Promise<SkillConfig[]> {
    if (!this.registry.has(alias)) {
      await this.resolveFromDisk(alias);
    }
    // resolveFromDisk always populates the registry for `alias` (every branch
    // calls registry.set), so the `?? []` fallback is unreachable; it only
    // satisfies the `T | undefined` return type of Map.get.
    /* v8 ignore next */
    return this.registry.get(alias) ?? [];
  }

  /**
   * Sanitize → dirty-check → atomic write → cache. The single choke point that
   * persists `skills.json`, so every stored skill is normalized and the file's
   * own `updatedAt` advances only when the content actually changed.
   */
  private async persistSkills(alias: string, skills: SkillConfig[]): Promise<void> {
    const clean = sanitizeSkillEntries(skills);
    const fingerprint = fingerprintSkills(clean);
    if (this.lastFingerprint.get(alias) === fingerprint) {
      this.registry.set(alias, clean);
      return;
    }

    await writeSkillsFile(this.getProfileDir(alias), clean, {
      onRetry: ({ attempt, error, delayMs }) => {
        logger.warn(
          '[SkillsConfigManager] Transient skills.json rename failure; retrying',
          'persistSkills',
          { alias, attempt, delayMs, code: error.code },
        );
      },
    });
    this.registry.set(alias, clean);
    this.lastFingerprint.set(alias, fingerprint);
  }
}

export const skillsConfigManager = SkillsConfigManager.getInstance();
