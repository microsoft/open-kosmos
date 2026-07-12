/**
 * atomicFileWrite.test.ts
 *
 * Tests for writeFileAtomicallyWithRetry, which retries the final rename step on
 * transient Windows lock errors (EPERM/EACCES/EBUSY/...). Covers:
 *  - success on first rename (no retry, no cleanup)
 *  - transient failure then success (onRetry + backoff invoked)
 *  - exhausting all attempts on persistent transient error (throws + cleanup)
 *  - non-transient error throws immediately (no retry)
 *  - writeFile failure cleanup path (temp absent -> no unlink)
 *  - unlink failure during cleanup is swallowed
 *  - backoff delay is capped at maxDelayMs
 *  - maxAttempts <= 0 is coerced to a single attempt
 *  - default options path uses the real setTimeout-based delay
 */

vi.mock('fs');

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { writeFileAtomicallyWithRetry } from '../atomicFileWrite';

const TARGET = '/some/dir/index.json';

function eperm(): NodeJS.ErrnoException {
  return Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
}

beforeEach(() => {
  vi.clearAllMocks();
  (fs.promises.writeFile as any).mockResolvedValue(undefined);
  (fs.promises.rename as any).mockResolvedValue(undefined);
  (fs.promises.unlink as any).mockResolvedValue(undefined);
  (fs.existsSync as any).mockReturnValue(true);
});

describe('writeFileAtomicallyWithRetry', () => {
  it('writes to a temp file then renames onto the target on first success', async () => {
    const noDelay = vi.fn().mockResolvedValue(undefined);

    await writeFileAtomicallyWithRetry(TARGET, '{"a":1}', { delayFn: noDelay });

    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    const [tempPath, content, encoding] = (fs.promises.writeFile as any).mock.calls[0];
    expect(tempPath).toMatch(/^\/some\/dir\/index\.json\.\d+\.\d+\.tmp$/);
    expect(content).toBe('{"a":1}');
    expect(encoding).toBe('utf-8');

    expect(fs.promises.rename).toHaveBeenCalledTimes(1);
    expect((fs.promises.rename as any).mock.calls[0][1]).toBe(TARGET);
    expect(fs.promises.unlink).not.toHaveBeenCalled();
    expect(noDelay).not.toHaveBeenCalled();
  });

  it('retries a transient rename failure and succeeds, invoking onRetry with backoff', async () => {
    (fs.promises.rename as any)
      .mockRejectedValueOnce(eperm())
      .mockResolvedValueOnce(undefined);
    const onRetry = vi.fn();
    const noDelay = vi.fn().mockResolvedValue(undefined);

    await writeFileAtomicallyWithRetry(TARGET, '{}', { delayFn: noDelay, onRetry, baseDelayMs: 20 });

    expect(fs.promises.rename).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, delayMs: 20 });
    expect(onRetry.mock.calls[0][0].error.code).toBe('EPERM');
    expect(noDelay).toHaveBeenCalledWith(20);
    // Temp file was renamed successfully, so no cleanup.
    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  it('throws and cleans up the temp file after exhausting all attempts', async () => {
    (fs.promises.rename as any).mockRejectedValue(eperm());
    const onRetry = vi.fn();
    const noDelay = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeFileAtomicallyWithRetry(TARGET, '{}', { maxAttempts: 3, delayFn: noDelay, onRetry })
    ).rejects.toMatchObject({ code: 'EPERM' });

    expect(fs.promises.rename).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.promises.unlink).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on a non-transient rename error without retrying', async () => {
    (fs.promises.rename as any).mockRejectedValue(new Error('rename failed'));
    const onRetry = vi.fn();
    const noDelay = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeFileAtomicallyWithRetry(TARGET, '{}', { maxAttempts: 5, delayFn: noDelay, onRetry })
    ).rejects.toThrow('rename failed');

    expect(fs.promises.rename).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(noDelay).not.toHaveBeenCalled();
    expect(fs.promises.unlink).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to unlink when the temp file was never created', async () => {
    (fs.promises.writeFile as any).mockRejectedValue(
      Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
    );
    (fs.existsSync as any).mockReturnValue(false);

    await expect(writeFileAtomicallyWithRetry(TARGET, '{}')).rejects.toThrow('ENOSPC');

    expect(fs.promises.rename).not.toHaveBeenCalled();
    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  it('swallows an unlink error during cleanup and rethrows the original error', async () => {
    (fs.promises.rename as any).mockRejectedValue(new Error('rename failed'));
    (fs.existsSync as any).mockReturnValue(true);
    (fs.promises.unlink as any).mockRejectedValue(new Error('unlink failed'));

    await expect(writeFileAtomicallyWithRetry(TARGET, '{}')).rejects.toThrow('rename failed');
  });

  it('caps the backoff delay at maxDelayMs', async () => {
    (fs.promises.rename as any)
      .mockRejectedValueOnce(eperm())
      .mockResolvedValueOnce(undefined);
    const noDelay = vi.fn().mockResolvedValue(undefined);

    await writeFileAtomicallyWithRetry(TARGET, '{}', {
      delayFn: noDelay,
      baseDelayMs: 1000,
      maxDelayMs: 50,
    });

    expect(noDelay).toHaveBeenCalledWith(50);
  });

  it('coerces maxAttempts below 1 to a single attempt', async () => {
    (fs.promises.rename as any).mockRejectedValue(eperm());
    const onRetry = vi.fn();
    const noDelay = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeFileAtomicallyWithRetry(TARGET, '{}', { maxAttempts: 0, delayFn: noDelay, onRetry })
    ).rejects.toMatchObject({ code: 'EPERM' });

    expect(fs.promises.rename).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  describe('default delay implementation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses the real timer-based delay when no delayFn is provided', async () => {
      (fs.promises.rename as any)
        .mockRejectedValueOnce(eperm())
        .mockResolvedValueOnce(undefined);

      const promise = writeFileAtomicallyWithRetry(TARGET, '{}', { baseDelayMs: 20 });
      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBeUndefined();

      expect(fs.promises.rename).toHaveBeenCalledTimes(2);
    });
  });
});
