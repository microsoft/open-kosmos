import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createConsoleLogger } from '../unifiedLogger';

const logger = createConsoleLogger();

export const PROFILE_BACKUP_DIR_NAME = '.profile_backups';
export const PROFILE_BACKUP_RETENTION_MS = 24 * 60 * 60 * 1000;
const PROFILE_BACKUP_TMP_RETENTION_MS = 60 * 60 * 1000;

const HEAVY_DIRECTORY_NAMES = new Set([
  PROFILE_BACKUP_DIR_NAME,
  'knowledge',
  'chat_sessions',
  'chat-sessions',
  'chat_workspaces',
  'chat-workspaces',
  'skills',
  'memory',
  'memex_memory',
  'memex-memory',
  'profile_memory',
  'profile-memory',
]);
const SENSITIVE_DIRECTORY_NAMES = new Set([
  'credentials',
]);
const SENSITIVE_FILE_NAMES = new Set([
  'auth.json',
  'browserauthtokencache.enc',
  'browserauthtokencache.json',
  'browser-session-state.json',
  'cdp-session-state.json',
  'openkosmos-token-cache.json',
]);
const SENSITIVE_JSON_CONTAINER_KEYS = new Set([
  'env',
  'headers',
]);
const SENSITIVE_JSON_KEY_FRAGMENTS = [
  'apikey',
  'authorization',
  'cookie',
  'password',
  'privatekey',
  'secret',
  'token',
];
const REDACTED_BACKUP_VALUE = '[redacted]';

const completedStartupBackups = new Set<string>();

export interface ProfileBackupManifest {
  version: 1;
  alias: string;
  createdAt: string;
  sourceProfileDir: string;
  appVersion: string;
  reason: 'startup-before-profile-mutation';
  excludedDirectoryNames: string[];
  excludedFileNames: string[];
  copiedFiles: number;
  skippedDirectories: number;
  skippedFiles: number;
  redactedJsonFiles: number;
}

export interface ProfileBackupResult {
  success: boolean;
  backupDir?: string;
  skipped?: boolean;
  error?: string;
}

interface CopyStats {
  copiedFiles: number;
  skippedDirectories: number;
  skippedFiles: number;
  redactedJsonFiles: number;
}

function backupKey(profileDir: string, alias: string): string {
  return `${alias}:${path.resolve(profileDir)}`;
}

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function getElectronAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return 'unknown';
  }
}

function isExpired(stats: fs.Stats, now: number, retentionMs: number): boolean {
  return now - stats.mtimeMs > retentionMs;
}

function shouldSkipDirectory(name: string): boolean {
  const normalized = name.toLowerCase();
  return HEAVY_DIRECTORY_NAMES.has(normalized) || SENSITIVE_DIRECTORY_NAMES.has(normalized);
}

function shouldSkipFile(name: string): boolean {
  return SENSITIVE_FILE_NAMES.has(name.toLowerCase());
}

function normalizeJsonKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveJsonKey(key: string): boolean {
  const normalized = normalizeJsonKey(key);
  return SENSITIVE_JSON_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment));
}

function redactContainerValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactContainerValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, redactContainerValue(child)]),
    );
  }
  return REDACTED_BACKUP_VALUE;
}

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => {
        const normalized = normalizeJsonKey(key);
        if (SENSITIVE_JSON_CONTAINER_KEYS.has(normalized)) {
          return [key, redactContainerValue(child)];
        }
        if (isSensitiveJsonKey(key)) {
          return [key, REDACTED_BACKUP_VALUE];
        }
        return [key, redactJsonValue(child)];
      }),
    );
  }
  return value;
}

export async function copyJsonFileWithRedaction(sourcePath: string, targetPath: string): Promise<void> {
  const content = await fs.promises.readFile(sourcePath, 'utf-8');
  let backupValue: unknown;
  try {
    const parsed = JSON.parse(content) as unknown;
    backupValue = redactJsonValue(parsed);
  } catch (error) {
    if (path.basename(sourcePath).toLowerCase() === 'profile.json') {
      await fs.promises.writeFile(targetPath, content, 'utf-8');
      return;
    }
    backupValue = {
      backupRedaction: {
        reason: 'invalid-json-omitted',
        originalFileName: path.basename(sourcePath),
        originalBytes: Buffer.byteLength(content, 'utf-8'),
        parseError: error instanceof Error ? error.message : String(error),
      },
    };
  }
  await fs.promises.writeFile(targetPath, `${JSON.stringify(backupValue, null, 2)}\n`, 'utf-8');
}

function removeDirectoryBestEffort(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('[ProfileBackupManager] Failed to remove expired backup directory', 'ProfileBackupManager', {
      dir,
      error: String(error),
    });
  }
}

export function cleanupExpiredProfileBackups(profileDir: string, now = Date.now()): void {
  const backupsRoot = path.join(profileDir, PROFILE_BACKUP_DIR_NAME);
  if (!fs.existsSync(backupsRoot)) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(backupsRoot, { withFileTypes: true });
  } catch (error) {
    logger.warn('[ProfileBackupManager] Failed to read backup directory for cleanup', 'ProfileBackupManager', {
      profileDir,
      error: String(error),
    });
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = path.join(backupsRoot, entry.name);
    try {
      const stats = fs.statSync(entryPath);
      const retention = entry.name.startsWith('.tmp-') ? PROFILE_BACKUP_TMP_RETENTION_MS : PROFILE_BACKUP_RETENTION_MS;
      if (isExpired(stats, now, retention)) {
        removeDirectoryBestEffort(entryPath);
      }
    } catch (error) {
      logger.warn('[ProfileBackupManager] Failed to inspect backup directory for cleanup', 'ProfileBackupManager', {
        entryPath,
        error: String(error),
      });
    }
  }
}

async function copyProfileMetadataTree(sourceDir: string, targetDir: string, stats: CopyStats): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        stats.skippedDirectories += 1;
        continue;
      }
      await copyProfileMetadataTree(sourcePath, targetPath, stats);
      continue;
    }

    if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) {
        stats.skippedFiles += 1;
        continue;
      }
      if (entry.name.toLowerCase().endsWith('.json')) {
        await copyJsonFileWithRedaction(sourcePath, targetPath);
        stats.copiedFiles += 1;
        stats.redactedJsonFiles += 1;
        continue;
      }
      await fs.promises.copyFile(sourcePath, targetPath);
      stats.copiedFiles += 1;
    }
  }
}

export async function backupProfileDirectoryBeforeMutation(
  profileDir: string,
  alias: string,
): Promise<ProfileBackupResult> {
  const key = backupKey(profileDir, alias);
  if (completedStartupBackups.has(key)) {
    return { success: true, skipped: true };
  }

  cleanupExpiredProfileBackups(profileDir);

  const backupsRoot = path.join(profileDir, PROFILE_BACKUP_DIR_NAME);
  const createdAt = new Date().toISOString();
  const tmpDir = path.join(backupsRoot, `.tmp-${timestampForPath(new Date(createdAt))}-${process.pid}`);
  const backupDir = path.join(backupsRoot, timestampForPath(new Date(createdAt)));
  const stats: CopyStats = { copiedFiles: 0, skippedDirectories: 0, skippedFiles: 0, redactedJsonFiles: 0 };
  const startedAt = Date.now();

  try {
    await fs.promises.mkdir(backupsRoot, { recursive: true });
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    await copyProfileMetadataTree(profileDir, tmpDir, stats);

    const manifest: ProfileBackupManifest = {
      version: 1,
      alias,
      createdAt,
      sourceProfileDir: profileDir,
      appVersion: getElectronAppVersion(),
      reason: 'startup-before-profile-mutation',
      excludedDirectoryNames: [...HEAVY_DIRECTORY_NAMES, ...SENSITIVE_DIRECTORY_NAMES].sort(),
      excludedFileNames: [...SENSITIVE_FILE_NAMES].sort(),
      copiedFiles: stats.copiedFiles,
      skippedDirectories: stats.skippedDirectories,
      skippedFiles: stats.skippedFiles,
      redactedJsonFiles: stats.redactedJsonFiles,
    };
    await fs.promises.writeFile(path.join(tmpDir, 'backup.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    await fs.promises.rename(tmpDir, backupDir);
    completedStartupBackups.add(key);
    logger.info('[ProfileBackupManager] Profile backup completed', 'ProfileBackupManager', {
      alias,
      backupDir,
      copiedFiles: stats.copiedFiles,
      skippedDirectories: stats.skippedDirectories,
      skippedFiles: stats.skippedFiles,
      redactedJsonFiles: stats.redactedJsonFiles,
      durationMs: Date.now() - startedAt,
    });
    return { success: true, backupDir };
  } catch (error) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[ProfileBackupManager] Profile backup failed', 'ProfileBackupManager', {
      alias,
      profileDir,
      error: message,
    });
    return { success: false, error: message };
  }
}

export function resetProfileBackupStateForTests(): void {
  completedStartupBackups.clear();
}
