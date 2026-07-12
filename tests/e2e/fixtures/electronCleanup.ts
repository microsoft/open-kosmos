import type { ElectronApplication } from '@playwright/test';
import { spawnSync } from 'child_process';

type ElectronProcess = ReturnType<ElectronApplication['process']>;
type WaitResult = 'completed' | 'timeout';

const GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;
const FORCED_CLOSE_TIMEOUT_MS = 5_000;

function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<WaitResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WaitResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    timer.unref?.();
    promise.then(
      () => finish('completed'),
      () => finish('completed'),
    );
  });
}

function waitForProcessClose(proc: ElectronProcess, timeoutMs: number): Promise<WaitResult> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve('completed');
  }

  return settleWithin(
    new Promise<void>((resolve) => proc.once('close', () => resolve())),
    timeoutMs,
  );
}

function forceKillAppProcess(proc: ElectronProcess): void {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }

  try {
    if (process.platform === 'win32' && proc.pid !== undefined) {
      const result = spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: FORCED_CLOSE_TIMEOUT_MS,
        windowsHide: true,
      });
      if (!result.error && result.status === 0) {
        return;
      }
    }

    if (proc.pid !== undefined) {
      try {
        process.kill(-proc.pid, 'SIGKILL');
        return;
      } catch {
        // Fall back to killing the direct process.
      }
    }

    proc.kill('SIGKILL');
  } catch {
    // The process exited between the state check and kill.
  }
}

/**
 * Close Playwright's Electron context before forcing the process down.
 *
 * Calling electron.app.exit() first can leave Electron waiting for its attached
 * Node debugger to disconnect. If the fixture then returns as soon as the OS
 * process closes, Playwright retains that debugger/CDP connection until worker
 * teardown and eventually hits its 60-second teardown timeout.
 */
export async function safeCloseElectronApp(
  app: ElectronApplication,
  logPrefix: string,
): Promise<void> {
  const proc = app.process();
  const playwrightClose = app.close();
  const gracefulResult = await settleWithin(playwrightClose, GRACEFUL_CLOSE_TIMEOUT_MS);
  if (gracefulResult === 'completed') {
    const processResult = await waitForProcessClose(proc, FORCED_CLOSE_TIMEOUT_MS);
    if (processResult === 'completed') {
      return;
    }
  }

  forceKillAppProcess(proc);
  const [processResult, playwrightResult] = await Promise.all([
    waitForProcessClose(proc, FORCED_CLOSE_TIMEOUT_MS),
    settleWithin(playwrightClose, FORCED_CLOSE_TIMEOUT_MS),
  ]);

  if (processResult === 'timeout' || playwrightResult === 'timeout') {
    console.warn(
      `${logPrefix} Timed out closing Electron after Playwright shutdown and process-tree termination`,
      { processResult, playwrightResult },
    );
  }
}
