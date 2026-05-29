export interface SessionEntry {
  chatId: string;
  chatSessionId: string;
  lastActiveAt: number;
}

export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_SESSIONS = 100;
export const MAX_CONCURRENCY = 3;
export const PERSIST_DEBOUNCE = 2000;
