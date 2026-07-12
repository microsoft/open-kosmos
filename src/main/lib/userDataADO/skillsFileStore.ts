/**
 * Skills file store — low-level read/write helpers for the standalone
 * `skills.json`, the global skill registry decoupled from `profile.json`.
 *
 * `SkillsConfigManager` owns the registry in memory and is the sole caller of
 * these helpers; consumers read skills from that manager, not from the cached
 * profile (which no longer carries `skills` at all). `ProfileCacheManager`
 * strips the legacy inline `profile.skills` after migration and re-injects the
 * manager's skills into the renderer payload, so the wire contract is unchanged.
 *
 * Migration is self-healing: a legacy profile that still carries inline
 * `profile.skills` is split into `skills.json` on first load. A corrupt
 * `skills.json` is backed up (mirroring the `profile.json` safety net) rather
 * than silently overwritten.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SkillConfig, SkillsFileV2, SKILLS_FILE_VERSION } from './types/profile';
import { writeFileAtomicallyWithRetry, AtomicWriteOptions } from './atomicFileWrite';
import { createConsoleLogger } from '../unifiedLogger';
import { copyJsonFileWithRedaction } from './profileBackupManager';

const logger = createConsoleLogger();

export const SKILLS_FILE_NAME = 'skills.json';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Absolute path to the standalone skills file for a given profile directory.
 */
export function getSkillsFilePath(profileDir: string): string {
  return path.join(profileDir, SKILLS_FILE_NAME);
}

/**
 * Whether a raw skill entry is a retired plugin-injected skill — either tagged
 * with the removed `source: 'PLUGIN'` value or scoped with the
 * `plugin--<pluginId>--<name>` naming convention. The plugin feature has been
 * removed, so such entries are orphans whose backing files no longer exist. Used
 * both to DROP the entry (`sanitizeSkillEntries`) and to trigger a one-time
 * durable rewrite of `skills.json` when such an entry is still present on disk
 * (`loadSkillsForProfile`). Matching the name as well as the source catches
 * entries from a corrupt/partially-migrated sidecar whose source was lost.
 */
export function isRetiredPluginSkillEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const candidate = entry as { name?: unknown; source?: unknown };
  return candidate.source === 'PLUGIN'
    || (typeof candidate.name === 'string' && candidate.name.startsWith('plugin--'));
}

/**
 * Normalize an arbitrary value into a clean `SkillConfig[]`. Drops entries that
 * are not objects or lack a usable name, and fills the same defaults as
 * `sanitizeProfileV2`.
 */
export function sanitizeSkillEntries(raw: unknown): SkillConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: SkillConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const entry = item as Partial<SkillConfig>;
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      continue;
    }
    // The plugin feature was removed. Drop orphaned plugin-injected skills
    // instead of coercing them to ON-DEVICE below, where their now-missing
    // backing files would surface as broken on-device skills. Mirrors the
    // profile-level skills drop in profileSanitizer.ts so both skill stores
    // converge on the same migration.
    if (isRetiredPluginSkillEntry(entry)) {
      continue;
    }
    const source: SkillConfig['source'] =
      entry.source === 'IN-LIBRARY' ? 'IN-LIBRARY' : 'ON-DEVICE';
    result.push({
      name: entry.name,
      description: typeof entry.description === 'string' ? entry.description : '',
      version: typeof entry.version === 'string' && entry.version.length > 0 ? entry.version : '1.0.0',
      remoteVersion: typeof entry.remoteVersion === 'string' ? entry.remoteVersion : '',
      source,
    });
  }
  return result;
}

/**
 * Rename a corrupt skills file aside so the data is recoverable and the next
 * load can re-create a clean file.
 */
async function backupCorruptSkillsFile(filePath: string): Promise<void> {
  try {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    await copyJsonFileWithRedaction(filePath, backupPath);
    await fs.promises.unlink(filePath);
    logger.warn(
      '[SkillsFileStore] Backed up redacted corrupt skills.json',
      'backupCorruptSkillsFile',
      { backup: path.basename(backupPath) },
    );
  } catch (error) {
    logger.error(
      '[SkillsFileStore] Failed to back up corrupt skills.json',
      'backupCorruptSkillsFile',
      { error: errorMessage(error) },
    );
  }
}

/**
 * Read and parse an existing skills file. Returns the sanitized skills together
 * with whether the on-disk file still contained retired plugin entries (so the
 * caller can durably rewrite it), or `null` when the file is unreadable/corrupt
 * (after backing it up).
 */
async function tryLoadExisting(
  filePath: string,
): Promise<{ skills: SkillConfig[]; hadRetiredPlugins: boolean } | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const skillsRaw = parsed && typeof parsed === 'object'
      ? (parsed as { skills?: unknown }).skills
      : undefined;
    if (!Array.isArray(skillsRaw)) {
      throw new Error('skills.json missing a valid "skills" array');
    }
    // Mirror readMcpFile's per-element guard: a primitive/null element means the
    // file is structurally broken (truncated or hand-edited), so treat the WHOLE
    // file as corrupt — back it up and re-derive — rather than silently dropping
    // the junk and overwriting a recoverable original. (Nameless objects fall
    // through to sanitizeSkillEntries, which drops them, exactly as MCP does.)
    if (skillsRaw.some(entry => entry == null || typeof entry !== 'object')) {
      throw new Error('skills.json contains a non-object skill entry');
    }
    return {
      skills: sanitizeSkillEntries(skillsRaw),
      hadRetiredPlugins: skillsRaw.some(isRetiredPluginSkillEntry),
    };
  } catch (error) {
    logger.error(
      '[SkillsFileStore] skills.json is unreadable; backing up and re-deriving',
      'tryLoadExisting',
      { error: errorMessage(error) },
    );
    await backupCorruptSkillsFile(filePath);
    return null;
  }
}

/**
 * Read the standalone skills file. Returns `null` when it does not exist or is
 * corrupt (corrupt files are backed up before returning).
 */
export async function readSkillsFile(profileDir: string): Promise<SkillConfig[] | null> {
  const filePath = getSkillsFilePath(profileDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const loaded = await tryLoadExisting(filePath);
  return loaded === null ? null : loaded.skills;
}

/**
 * Atomically write the global skill registry to `skills.json`.
 */
export async function writeSkillsFile(
  profileDir: string,
  skills: SkillConfig[],
  options?: AtomicWriteOptions,
): Promise<void> {
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  const payload: SkillsFileV2 = {
    version: SKILLS_FILE_VERSION,
    updatedAt: new Date().toISOString(),
    skills: sanitizeSkillEntries(skills),
  };
  await writeFileAtomicallyWithRetry(getSkillsFilePath(profileDir), JSON.stringify(payload, null, 2), options);
}

/**
 * Content fingerprint of the global skill registry for dirty-checking,
 * deliberately EXCLUDING the volatile `updatedAt` timestamp. Two registries with
 * identical skills (and format version) hash to the same string regardless of
 * when they were last written, so `SkillsConfigManager` can skip both rewriting
 * `skills.json` and bumping its `updatedAt` for a no-op change. Never written to
 * disk — comparison key only. Callers sanitize first via `sanitizeSkillEntries`.
 *
 * Mirrors `fingerprintMcpServers` so the two config managers behave identically.
 */
export function fingerprintSkills(skills: SkillConfig[]): string {
  return JSON.stringify({
    version: SKILLS_FILE_VERSION,
    skills: Array.isArray(skills) ? skills : [],
  });
}

/**
 * Resolve the global skill registry for a profile being loaded.
 *
 * - If `skills.json` exists and is valid, it is authoritative. `needsProfileRewrite`
 *   is still set when the incoming profile STILL carries an inline `skills` slice,
 *   so the caller rewrites `profile.json` to strip the leftover legacy field.
 *   Otherwise a prior migration whose profile rewrite failed would leave the inline
 *   slice on disk indefinitely, where it could be re-derived as STALE data if
 *   `skills.json` is later lost or corrupted. If the existing file still contains
 *   retired plugin skills, the cleaned registry is written back so the orphans are
 *   durably removed from disk rather than only filtered on each read.
 * - Otherwise (missing on first upgrade, or corrupt) the skills are derived from
 *   the legacy inline `rawProfile.skills`, written to `skills.json`, and the
 *   caller is told to rewrite `profile.json` so the legacy field is stripped.
 *
 * @returns the resolved skills and whether `profile.json` should be rewritten.
 */
export async function loadSkillsForProfile(
  profileDir: string,
  rawProfile: { skills?: unknown },
): Promise<{ skills: SkillConfig[]; needsProfileRewrite: boolean }> {
  const filePath = getSkillsFilePath(profileDir);
  const hasLegacyInlineSkills = rawProfile.skills !== undefined;

  if (fs.existsSync(filePath)) {
    const existing = await tryLoadExisting(filePath);
    if (existing !== null) {
      // Durably heal the sidecar: if it still held retired plugin skills, rewrite
      // the cleaned registry so the orphans cannot resurface. They are already
      // filtered out of `existing.skills`; without this the stale entries would
      // linger on disk because `SkillsConfigManager` primes its dirty-check
      // fingerprint from the sanitized (clean) registry, so a later no-op CRUD
      // skips the rewrite and the file is never cleaned.
      if (existing.hadRetiredPlugins) {
        await writeSkillsFile(profileDir, existing.skills);
      }
      return { skills: existing.skills, needsProfileRewrite: hasLegacyInlineSkills };
    }
  }

  const migrated = sanitizeSkillEntries(rawProfile.skills);
  await writeSkillsFile(profileDir, migrated);
  return { skills: migrated, needsProfileRewrite: true };
}
