import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../unifiedLogger';
import { getUserDataPath } from '../../userDataADO/pathUtils';
import type { SessionEntry } from './types';
import { SESSION_TTL, MAX_SESSIONS, PERSIST_DEBOUNCE } from './types';

const logger = createLogger();

export function getSessionMapPath(alias: string): string {
  return path.join(getUserDataPath(), 'profiles', alias, 'remoteSessionMap.json');
}

export async function loadSessionMap(alias: string): Promise<Map<string, SessionEntry>> {
  const map = new Map<string, SessionEntry>();
  try {
    const filePath = getSessionMapPath(alias);
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const entries: Record<string, SessionEntry> = JSON.parse(data);
    const now = Date.now();
    for (const [key, entry] of Object.entries(entries)) {
      if (now - entry.lastActiveAt < SESSION_TTL) {
        map.set(key, entry);
      }
    }
  } catch {
    // File does not exist or parsing failed, use empty map
  }
  return map;
}

export async function persistSessionMap(alias: string, sessionMap: Map<string, SessionEntry>): Promise<void> {
  try {
    const filePath = getSessionMapPath(alias);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const obj: Record<string, SessionEntry> = {};
    for (const [key, entry] of sessionMap) {
      obj[key] = entry;
    }
    await fs.promises.writeFile(filePath, JSON.stringify(obj, null, 2));
  } catch (err) {
    logger.warn(`[AgentBridge] Failed to persist session map: ${String(err)}`);
  }
}

export function pruneSessionMap(sessionMap: Map<string, SessionEntry>): void {
  if (sessionMap.size <= MAX_SESSIONS) return;
  const entries = Array.from(sessionMap.entries())
    .sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt);
  const toRemove = entries.slice(0, entries.length - MAX_SESSIONS);
  for (const [key] of toRemove) {
    sessionMap.delete(key);
  }
}

/**
 * Creates a debounced persist scheduler.
 * Returns { schedule, cancel } — call schedule() to queue a persist, cancel() to clear the timer.
 */
export function createPersistScheduler(
  alias: string,
  sessionMap: Map<string, SessionEntry>,
): { schedule: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(): void {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      await persistSessionMap(alias, sessionMap);
    }, PERSIST_DEBOUNCE);
  }

  function cancel(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { schedule, cancel };
}
