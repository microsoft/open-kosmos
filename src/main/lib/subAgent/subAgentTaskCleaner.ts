/**
 * SubAgentTaskCleaner — Purge old sub-agent task files
 *
 * Deletes month directories older than retention period (default 30 days).
 * Called periodically or at app startup.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

/**
 * Purge sub-agent task files older than retentionDays.
 * Returns the number of files deleted.
 */
export async function purgeOldSubAgentTasks(userAlias: string, retentionDays = 30): Promise<number> {
  const userData = app.getPath('userData');
  const baseDir = path.join(userData, 'profiles', userAlias, 'sub-agent-tasks');

  if (!fs.existsSync(baseDir)) return 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffYearMonth = `${cutoffDate.getFullYear()}${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;

  let deletedCount = 0;

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d{6}$/.test(entry.name)) continue;

      if (entry.name < cutoffYearMonth) {
        const dirPath = path.join(baseDir, entry.name);
        const files = fs.readdirSync(dirPath);
        deletedCount += files.length;
        fs.rmSync(dirPath, { recursive: true, force: true });
        logger.info('[SubAgentTaskCleaner] Purged old month directory', 'purgeOldSubAgentTasks', {
          directory: entry.name,
          fileCount: files.length,
        });
      }
    }
  } catch (err) {
    logger.warn('[SubAgentTaskCleaner] Error during purge', 'purgeOldSubAgentTasks', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return deletedCount;
}
