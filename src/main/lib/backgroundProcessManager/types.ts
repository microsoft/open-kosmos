/**
 * Background Process Manager Types
 * Type definitions for async background process execution and management
 */

/**
 * Session status values
 */
export type BackgroundSessionStatus = 'running' | 'exited' | 'error';

/**
 * Options for spawning a background process
 */
export interface BackgroundSpawnOptions {
  cwd: string;
  shell?: 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';
  env?: Record<string, string | null | undefined>;
}

/**
 * Result of spawning a background process
 */
export interface BackgroundSpawnResult {
  sessionId: string;
  pid: number | undefined;
}

/**
 * Result of polling a background session
 */
export interface BackgroundPollResult {
  status: BackgroundSessionStatus;
  exitCode?: number | null;
  pid?: number;
  durationMs: number;
}

/**
 * Options for reading logs from a background session
 */
export interface BackgroundLogOptions {
  offset?: number;
  limit?: number;
}

/**
 * Result of reading logs from a background session
 */
export interface BackgroundLogResult {
  lines: string[];
  nextOffset: number;
  totalLines: number;
  /** Cumulative count of lines evicted from ring buffer — non-zero means earlier lines were lost */
  droppedCount: number;
  done: boolean;
}

/**
 * Result of killing a background session
 */
export interface BackgroundKillResult {
  success: boolean;
  message: string;
}

/**
 * Summary information about a background session
 */
export interface BackgroundSessionSummary {
  sessionId: string;
  command: string;
  status: BackgroundSessionStatus;
  pid?: number;
  startTime: number;
  durationMs: number;
  exitCode?: number | null;
}

/**
 * Internal session data structure
 */
export interface BackgroundSessionData {
  sessionId: string;
  command: string;
  terminalInstanceId: string;
  startTime: number;
  endTime?: number;
  status: BackgroundSessionStatus;
  exitCode?: number | null;
  pid?: number;
  outputLines: string[];
  /** Cumulative count of lines evicted from ring buffer */
  droppedCount: number;
  cleanupTimerId?: ReturnType<typeof setTimeout>;
  /** Set by kill() to prevent exit listener from overwriting status */
  killedByUser?: boolean;
}
