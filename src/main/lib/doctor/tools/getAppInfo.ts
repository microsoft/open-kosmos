/**
 * getAppInfoTool — return runtime environment info for the application.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  getCurrentLogFileName,
  isDevelopmentLogEnvironment,
} from '../../unifiedLogger/FileOperations';

export const getAppInfoToolDef = {
  type: 'function' as const,
  function: {
    name: 'get_app_info',
    description: `Get current application environment information: version, platform, architecture, memory usage, uptime, and the active log file (so read_app_logs scope="current" results can be interpreted in context).`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export async function executeGetAppInfo(): Promise<string> {
  const memUsage = process.memoryUsage();
  const logsDir = path.join(app.getPath('userData'), 'logs');
  const currentLogName = getCurrentLogFileName();
  const currentLogPath = path.join(logsDir, currentLogName);
  const isDev = isDevelopmentLogEnvironment();

  let currentLogStartedAt: string | null = null;
  let currentLogSizeBytes: number | null = null;
  try {
    const stat = fs.statSync(currentLogPath);
    // birthtime can be unreliable on some filesystems; fall back to mtime then.
    const start = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
    currentLogStartedAt = start.toISOString();
    currentLogSizeBytes = stat.size;
  } catch {
    // file not yet created — leave nulls so the LLM knows the current run hasn't flushed
  }

  const info = {
    app: {
      name: app.getName(),
      version: app.getVersion(),
    },
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
    },
    uptime: `${Math.round(process.uptime())} seconds`,
    userData: app.getPath('userData'),
    logs: {
      dir: logsDir,
      // In dev each launch writes its own file; in prod logs are aggregated by day.
      // Pass mode through so the LLM doesn't have to infer it from the filename.
      mode: isDev ? 'dev-per-launch' : 'prod-daily',
      currentFile: currentLogName,
      currentFileStartedAt: currentLogStartedAt,
      currentFileSizeBytes: currentLogSizeBytes,
    },
  };

  return JSON.stringify(info, null, 2);
}
