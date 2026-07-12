/**
 * Hooks file store — low-level read/write helpers for the standalone
 * `hooks.json`, the global Agent Hook library decoupled from `profile.json`.
 *
 * `HooksConfigManager` owns the library in memory and is the sole caller of
 * these helpers; consumers read hooks from that manager, not from the cached
 * profile (which no longer carries `hooks` at all). `ProfileCacheManager` strips
 * the legacy inline `profile.hooks` after migration and re-injects the manager's
 * hooks into the renderer payload, so the wire contract is unchanged.
 *
 * NOTE: only the hook *list* lives here. The Hooks master switch
 * (`ProfileV2.hooksEnabled`) intentionally stays in `profile.json`.
 *
 * Migration is self-healing: a legacy profile that still carries inline
 * `profile.hooks` is split into `hooks.json` on first load. A corrupt
 * `hooks.json` is backed up (mirroring the `profile.json` safety net) rather
 * than silently overwritten.
 *
 * Structurally mirrors {@link ./skillsFileStore}; the only material difference is
 * that hook normalization reuses the canonical {@link sanitizeHooks} (the single
 * source of truth shared with `profile.json` sanitization) instead of a private
 * sanitizer, since hook validation (events / actions / timeouts) is non-trivial.
 */

import * as fs from 'fs';
import * as path from 'path';

import { HookDefinition, HooksFileV2, HOOKS_FILE_VERSION } from './types/profile';
import { writeFileAtomicallyWithRetry, AtomicWriteOptions } from './atomicFileWrite';
import { sanitizeHooks } from './profileSanitizer';
import { createConsoleLogger } from '../unifiedLogger';
import { copyJsonFileWithRedaction } from './profileBackupManager';

const logger = createConsoleLogger();

export const HOOKS_FILE_NAME = 'hooks.json';

/**
 * Normalize an arbitrary value into a clean `HookDefinition[]`. Delegates to the
 * canonical `sanitizeHooks` so `hooks.json` and `profile.json` apply byte-for-byte
 * identical hook normalization (dropping malformed/duplicate entries, filling
 * defaults). Exposed under a store-local name to mirror `sanitizeSkillEntries`.
 */
export const sanitizeHookEntries = sanitizeHooks;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Absolute path to the standalone hooks file for a given profile directory.
 */
export function getHooksFilePath(profileDir: string): string {
  return path.join(profileDir, HOOKS_FILE_NAME);
}

/**
 * Rename a corrupt hooks file aside so the data is recoverable and the next
 * load can re-create a clean file.
 */
async function backupCorruptHooksFile(filePath: string): Promise<void> {
  try {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    await copyJsonFileWithRedaction(filePath, backupPath);
    await fs.promises.unlink(filePath);
    logger.warn(
      '[HooksFileStore] Backed up redacted corrupt hooks.json',
      'backupCorruptHooksFile',
      { backup: path.basename(backupPath) },
    );
  } catch (error) {
    logger.error(
      '[HooksFileStore] Failed to back up corrupt hooks.json',
      'backupCorruptHooksFile',
      { error: errorMessage(error) },
    );
  }
}

/**
 * Read and parse an existing hooks file. Returns the sanitized hooks, or
 * `null` when the file is unreadable/corrupt (after backing it up).
 */
async function tryLoadExisting(filePath: string): Promise<HookDefinition[] | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const hooksRaw = parsed && typeof parsed === 'object'
      ? (parsed as { hooks?: unknown }).hooks
      : undefined;
    if (!Array.isArray(hooksRaw)) {
      throw new Error('hooks.json missing a valid "hooks" array');
    }
    // Mirror readMcpFile's per-element guard: a primitive/null element means the
    // file is structurally broken (truncated or hand-edited), so treat the WHOLE
    // file as corrupt — back it up and re-derive — rather than silently dropping
    // the junk and overwriting a recoverable original. (Malformed objects fall
    // through to sanitizeHookEntries, which drops them, exactly as skills do.)
    if (hooksRaw.some(entry => entry == null || typeof entry !== 'object')) {
      throw new Error('hooks.json contains a non-object hook entry');
    }
    return sanitizeHookEntries(hooksRaw);
  } catch (error) {
    logger.error(
      '[HooksFileStore] hooks.json is unreadable; backing up and re-deriving',
      'tryLoadExisting',
      { error: errorMessage(error) },
    );
    await backupCorruptHooksFile(filePath);
    return null;
  }
}

/**
 * Read the standalone hooks file. Returns `null` when it does not exist or is
 * corrupt (corrupt files are backed up before returning).
 */
export async function readHooksFile(profileDir: string): Promise<HookDefinition[] | null> {
  const filePath = getHooksFilePath(profileDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return tryLoadExisting(filePath);
}

/**
 * Atomically write the global Agent Hook library to `hooks.json`.
 */
export async function writeHooksFile(
  profileDir: string,
  hooks: HookDefinition[],
  options?: AtomicWriteOptions,
): Promise<void> {
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  const payload: HooksFileV2 = {
    version: HOOKS_FILE_VERSION,
    updatedAt: new Date().toISOString(),
    hooks: sanitizeHookEntries(hooks),
  };
  await writeFileAtomicallyWithRetry(getHooksFilePath(profileDir), JSON.stringify(payload, null, 2), options);
}

/**
 * Content fingerprint of the global Agent Hook library for dirty-checking,
 * deliberately EXCLUDING the volatile file-level `updatedAt` timestamp. Two
 * libraries with identical hooks (and format version) hash to the same string
 * regardless of when they were last written, so `HooksConfigManager` can skip
 * both rewriting `hooks.json` and bumping its `updatedAt` for a no-op change.
 * Never written to disk — comparison key only. Callers sanitize first via
 * `sanitizeHookEntries`. Mirrors `fingerprintSkills` / `fingerprintMcpServers`.
 *
 * Per-hook `createdAt`/`updatedAt` ARE part of the fingerprint (they are hook
 * content, not the file timestamp), so a real edit — which refreshes a hook's
 * `updatedAt` — correctly triggers a rewrite.
 */
export function fingerprintHooks(hooks: HookDefinition[]): string {
  return JSON.stringify({
    version: HOOKS_FILE_VERSION,
    hooks: Array.isArray(hooks) ? hooks : [],
  });
}

/**
 * Resolve the global Agent Hook library for a profile being loaded.
 *
 * - If `hooks.json` exists and is valid, it is authoritative. `needsProfileRewrite`
 *   is still set when the incoming profile STILL carries an inline `hooks` slice,
 *   so the caller rewrites `profile.json` to strip the leftover legacy field.
 *   Otherwise a prior migration whose profile rewrite failed would leave the inline
 *   slice on disk indefinitely, where it could be re-derived as STALE data if
 *   `hooks.json` is later lost or corrupted.
 * - Otherwise (missing on first upgrade, or corrupt) the hooks are derived from
 *   the legacy inline `rawProfile.hooks`, written to `hooks.json`, and the
 *   caller is told to rewrite `profile.json` so the legacy field is stripped.
 *
 * @returns the resolved hooks and whether `profile.json` should be rewritten.
 */
export async function loadHooksForProfile(
  profileDir: string,
  rawProfile: { hooks?: unknown },
): Promise<{ hooks: HookDefinition[]; needsProfileRewrite: boolean }> {
  const filePath = getHooksFilePath(profileDir);
  const hasLegacyInlineHooks = rawProfile.hooks !== undefined;

  if (fs.existsSync(filePath)) {
    const existing = await tryLoadExisting(filePath);
    if (existing !== null) {
      return { hooks: existing, needsProfileRewrite: hasLegacyInlineHooks };
    }
  }

  const migrated = sanitizeHookEntries(rawProfile.hooks);
  await writeHooksFile(profileDir, migrated);
  return { hooks: migrated, needsProfileRewrite: true };
}
