/**
 * log — write Doctor Agent run traces to doctor.log.md.
 * For local debugging only; the file is cleared before every agent run.
 */

import * as fs from 'fs';
import * as path from 'path';

const isDev = process.env.NODE_ENV === 'development';

let logFilePath: string | null = null;

function getLogPath(): string {
  if (!logFilePath) {
    // In dev mode, app.getAppPath() points to dist-vite/main/ not project root.
    // Use INIT_CWD (set by npm) or process.cwd() which is the project root.
    const projectRoot = process.env.INIT_CWD || process.cwd();
    logFilePath = path.join(projectRoot, 'tmp', 'doctor.log.md');
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  }
  return logFilePath;
}

export function clearDebugLog(): void {
  if (!isDev) return;
  try {
    fs.writeFileSync(getLogPath(), `# Doctor Agent Log\n\n_Started: ${new Date().toISOString()}_\n\n`);
  } catch (err) {
    console.warn('[doctor/log] clearDebugLog failed:', err);
  }
}

export function appendDebugLog(section: string, content: string): void {
  if (!isDev) return;
  try {
    const timestamp = new Date().toISOString().slice(11, 23);
    const entry = `## [${timestamp}] ${section}\n\n${content}\n\n---\n\n`;
    fs.appendFileSync(getLogPath(), entry);
  } catch (err) {
    console.warn('[doctor/log] appendDebugLog failed:', err);
  }
}
