/**
 * Atomic file write with retry on transient rename failures.
 *
 * The standard "write to a temp file, then rename onto the target" pattern is
 * atomic on POSIX, but on Windows `rename` onto an existing target throws
 * `EPERM`/`EACCES`/`EBUSY` whenever any process is momentarily holding a handle
 * to that target — most commonly antivirus / Windows Defender real-time scanning
 * or a concurrent reader in the same process. The failure is transient: a retry
 * a few milliseconds later usually succeeds.
 *
 * Without a retry, a single contended rename permanently fails the whole write.
 * For high-frequency index files (e.g. the scheduler chat-session month index
 * that every scheduled run rewrites) this surfaced as runs failing with
 * "Failed to flush chat session ...", leaving orphan "New Chat" entries.
 *
 * This helper retries only the `rename` step (the temp file is written once and
 * stays valid between attempts) with a short, bounded exponential backoff, and
 * cleans up the temp file if every attempt fails.
 */

import * as fs from 'fs';

/**
 * Error codes that indicate a transient, retryable rename failure. These are
 * almost always caused by another handle briefly locking the destination on
 * Windows rather than by a genuine permission problem.
 */
const TRANSIENT_RENAME_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ETXTBSY']);

export interface AtomicWriteRetryInfo {
  attempt: number;
  error: NodeJS.ErrnoException;
  delayMs: number;
}

export interface AtomicWriteOptions {
  /** Total number of rename attempts including the first one. Default 5. */
  maxAttempts?: number;
  /** Base backoff delay in ms (doubled each retry). Default 20. */
  baseDelayMs?: number;
  /** Upper bound for any single backoff delay in ms. Default 200. */
  maxDelayMs?: number;
  /** Injectable delay implementation (tests pass a no-op to avoid real timers). */
  delayFn?: (ms: number) => Promise<void>;
  /** Invoked before each retry so callers can log the transient failure. */
  onRetry?: (info: AtomicWriteRetryInfo) => void;
}

function isTransientRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' && TRANSIENT_RENAME_ERROR_CODES.has(code);
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write `content` to `filePath` atomically, retrying the final rename on
 * transient Windows lock errors. Throws the last error if all attempts fail.
 */
export async function writeFileAtomicallyWithRetry(
  filePath: string,
  content: string,
  options?: AtomicWriteOptions
): Promise<void> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 5);
  const baseDelayMs = options?.baseDelayMs ?? 20;
  const maxDelayMs = options?.maxDelayMs ?? 200;
  const delayFn = options?.delayFn ?? defaultDelay;

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.promises.writeFile(tempPath, content, 'utf-8');

    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        await fs.promises.rename(tempPath, filePath);
        return;
      } catch (error) {
        if (attempt >= maxAttempts || !isTransientRenameError(error)) {
          throw error;
        }

        const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        options?.onRetry?.({ attempt, error: error as NodeJS.ErrnoException, delayMs });
        await delayFn(delayMs);
      }
    }
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
    } catch {
      // ignore temp file cleanup failure
    }
    throw error;
  }
}
