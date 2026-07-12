import { EventEmitter } from 'events';
import type { ElectronApplication } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeCloseElectronApp } from './electronCleanup';

type ElectronProcess = ReturnType<ElectronApplication['process']>;

function createProcess(): ElectronProcess {
  const proc = new EventEmitter() as ElectronProcess;
  Object.assign(proc, {
    exitCode: null,
    signalCode: null,
    pid: undefined,
    kill: vi.fn(),
  });
  return proc;
}

function createApp(
  proc: ElectronProcess,
  close: () => Promise<void>,
): ElectronApplication {
  return {
    process: () => proc,
    close,
  } as ElectronApplication;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('safeCloseElectronApp', () => {
  it('closes through Playwright when the application exits normally', async () => {
    const proc = createProcess();
    const close = vi.fn(async () => {
      proc.exitCode = 0;
    });

    await safeCloseElectronApp(createApp(proc, close), '[test]');

    expect(close).toHaveBeenCalledOnce();
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('handles a process that exited before close observation', async () => {
    const proc = createProcess();
    proc.exitCode = 0;
    const close = vi.fn().mockRejectedValue(new Error('Target closed'));

    await safeCloseElectronApp(createApp(proc, close), '[test]');

    expect(close).toHaveBeenCalledOnce();
    expect(proc.listenerCount('close')).toBe(0);
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('force-kills the process tree when Playwright close stalls', async () => {
    vi.useFakeTimers();
    const proc = createProcess();
    const callOrder: string[] = [];
    let finishClose: (() => void) | undefined;
    const close = vi.fn(() => {
      callOrder.push('close');
      return new Promise<void>((resolve) => {
        finishClose = resolve;
      });
    });
    vi.mocked(proc.kill).mockImplementation(() => {
      callOrder.push('kill');
      proc.signalCode = 'SIGKILL';
      proc.emit('close', null, 'SIGKILL');
      finishClose?.();
      return true;
    });

    const cleanup = safeCloseElectronApp(createApp(proc, close), '[test]');
    await vi.advanceTimersByTimeAsync(5_000);
    await cleanup;

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(callOrder).toEqual(['close', 'kill']);
  });

  it('returns within the bounded cleanup window if Playwright remains stuck', async () => {
    vi.useFakeTimers();
    const proc = createProcess();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(proc.kill).mockImplementation(() => {
      proc.signalCode = 'SIGKILL';
      proc.emit('close', null, 'SIGKILL');
      return true;
    });

    const cleanup = safeCloseElectronApp(createApp(proc, close), '[test]');
    let settled = false;
    void cleanup.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await cleanup;

    expect(settled).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Timed out closing Electron'),
      { processResult: 'completed', playwrightResult: 'timeout' },
    );
  });
});
