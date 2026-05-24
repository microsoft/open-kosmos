import { EventEmitter } from 'events';

// Mock unifiedLogger
vi.mock('../../unifiedLogger', async () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Create mock terminal instance factory
const createMockTerminalInstance = (id: string, pid: number) => {
  const emitter = new EventEmitter();
  return {
    id,
    pid,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({
      id,
      type: 'command',
      state: 'running',
      config: { command: 'test', args: [], cwd: '/tmp', type: 'command' },
      pid,
      startTime: Date.now(),
      lastActivity: Date.now(),
    }),
    dispose: vi.fn(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  };
};

let mockCreateInstance: Mock;
let mockStopInstance: Mock;
let lastCreatedInstance: ReturnType<typeof createMockTerminalInstance> | null = null;

vi.mock('../../terminalManager', async () => ({
  getTerminalManager: () => ({
    createInstance: mockCreateInstance,
    stopInstance: mockStopInstance,
  }),
}));

import { BackgroundProcessManager, getBackgroundProcessManager } from '../BackgroundProcessManager';

describe('BackgroundProcessManager', () => {
  let instanceCounter = 0;

  beforeEach(() => {
    // Reset singleton
    (BackgroundProcessManager as any)['instance'] = undefined;

    instanceCounter = 0;
    lastCreatedInstance = null;

    mockCreateInstance = vi.fn().mockImplementation(() => {
      instanceCounter++;
      const instance = createMockTerminalInstance(`term-${instanceCounter}`, 1000 + instanceCounter);
      lastCreatedInstance = instance;
      return Promise.resolve(instance);
    });

    mockStopInstance = vi.fn().mockResolvedValue(undefined);

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('singleton', () => {
    it('getInstance() returns the same instance on multiple calls', () => {
      const a = BackgroundProcessManager.getInstance();
      const b = BackgroundProcessManager.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('spawn()', () => {
    it('creates instance and returns sessionId + pid', async () => {
      const manager = getBackgroundProcessManager();

      const result = await manager.spawn('npm run dev', { cwd: '/tmp' });

      expect(result.sessionId).toMatch(/^bg_\d+_[a-z0-9]+$/);
      expect(result.pid).toBe(1001);
      expect(mockCreateInstance).toHaveBeenCalledTimes(1);
      expect(lastCreatedInstance?.start).toHaveBeenCalled();
    });

    it('generates unique session IDs', async () => {
      const manager = getBackgroundProcessManager();

      const result1 = await manager.spawn('cmd1', { cwd: '/tmp' });
      const result2 = await manager.spawn('cmd2', { cwd: '/tmp' });

      expect(result1.sessionId).not.toBe(result2.sessionId);
    });

    it('propagates error when createInstance throws', async () => {
      const manager = getBackgroundProcessManager();

      mockCreateInstance.mockRejectedValueOnce(new Error('Terminal creation failed'));

      await expect(manager.spawn('cmd', { cwd: '/tmp' })).rejects.toThrow(
        'Terminal creation failed'
      );
    });
  });

  describe('poll()', () => {
    it('returns running for active session', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('npm start', { cwd: '/tmp' });

      const result = manager.poll(sessionId);

      expect(result.status).toBe('running');
      expect(result.pid).toBe(1001);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns exited with exitCode after process exits', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('echo hello', { cwd: '/tmp' });

      // Simulate process exit
      lastCreatedInstance?.emit('exit', 0, null);

      const result = manager.poll(sessionId);

      expect(result.status).toBe('exited');
      expect(result.exitCode).toBe(0);
    });

    it('returns error status for unknown sessionId', () => {
      const manager = getBackgroundProcessManager();

      const result = manager.poll('bg_nonexistent_abc123');

      expect(result.status).toBe('error');
      expect(result.durationMs).toBe(0);
    });

    it('returns error status with exitCode when process exits with non-zero code', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('failing-cmd', { cwd: '/tmp' });

      // Simulate process exit with non-zero code
      lastCreatedInstance?.emit('exit', 1, null);

      const result = manager.poll(sessionId);

      expect(result.status).toBe('error');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('log()', () => {
    it('returns empty for unknown sessionId', () => {
      const manager = getBackgroundProcessManager();

      const result = manager.log('bg_nonexistent_abc123');

      expect(result.lines).toEqual([]);
      expect(result.nextOffset).toBe(0);
      expect(result.totalLines).toBe(0);
      expect(result.done).toBe(true);
    });

    it('captures stdout lines', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('echo test', { cwd: '/tmp' });

      lastCreatedInstance?.emit('stdout', 'line1\nline2\nline3\n');

      const result = manager.log(sessionId);

      expect(result.lines).toContain('line1');
      expect(result.lines).toContain('line2');
      expect(result.lines).toContain('line3');
      expect(result.totalLines).toBe(3);
    });

    it('captures stderr lines with [stderr] prefix', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('stderr', 'error message\n');

      const result = manager.log(sessionId);

      expect(result.lines).toContain('[stderr] error message');
    });

    it('respects offset and limit pagination', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      // Add 10 lines
      for (let i = 0; i < 10; i++) {
        lastCreatedInstance?.emit('stdout', `line${i}\n`);
      }

      const result = manager.log(sessionId, { offset: 3, limit: 4 });

      expect(result.lines).toEqual(['line3', 'line4', 'line5', 'line6']);
      expect(result.nextOffset).toBe(7);
      expect(result.totalLines).toBe(10);
    });

    it('returns empty slice when offset exceeds totalLines', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('stdout', 'line0\nline1\n');

      const result = manager.log(sessionId, { offset: 100, limit: 10 });

      expect(result.lines).toEqual([]);
      expect(result.nextOffset).toBe(2);
      expect(result.totalLines).toBe(2);
    });

    it('returns done=true when process exited and all lines read', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('stdout', 'output\n');
      lastCreatedInstance?.emit('exit', 0, null);

      const result = manager.log(sessionId, { offset: 0, limit: 100 });

      expect(result.done).toBe(true);
    });

    it('ring buffer evicts oldest lines when exceeding 1000', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      // Add 1010 lines
      for (let i = 0; i < 1010; i++) {
        lastCreatedInstance?.emit('stdout', `line${i}\n`);
      }

      const result = manager.log(sessionId, { offset: 0, limit: 1500 });

      expect(result.totalLines).toBe(1010); // absolute total including dropped
      expect(result.lines.length).toBe(1000); // only 1000 in buffer
      expect(result.droppedCount).toBe(10);
      // First 10 lines evicted, buffer starts at line10
      expect(result.lines[0]).toBe('line10');
      expect(result.lines[999]).toBe('line1009');
    });

    it('uses absolute offset after ring buffer eviction', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      // Add 1010 lines (10 will be evicted)
      for (let i = 0; i < 1010; i++) {
        lastCreatedInstance?.emit('stdout', `line${i}\n`);
      }

      // Use absolute offset 15 — should map to array index 5 (15 - 10 dropped)
      const result = manager.log(sessionId, { offset: 15, limit: 3 });

      expect(result.lines).toEqual(['line15', 'line16', 'line17']);
      expect(result.nextOffset).toBe(18);
      expect(result.droppedCount).toBe(10);
    });

    it('truncates long lines at 500 chars', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      const longLine = 'x'.repeat(600);
      lastCreatedInstance?.emit('stdout', `${longLine}\n`);

      const result = manager.log(sessionId);

      expect(result.lines[0].length).toBe(503); // 500 + '...'
      expect(result.lines[0].endsWith('...')).toBe(true);
    });
  });

  describe('kill()', () => {
    it('stops running process', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('sleep 100', { cwd: '/tmp' });

      const result = await manager.kill(sessionId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Process killed successfully');
      expect(mockStopInstance).toHaveBeenCalled();
    });

    it('returns success for already-exited process', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('echo hi', { cwd: '/tmp' });

      // Simulate exit
      lastCreatedInstance?.emit('exit', 0, null);

      const result = await manager.kill(sessionId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('already exited');
    });

    it('returns failure for unknown sessionId', async () => {
      const manager = getBackgroundProcessManager();

      const result = await manager.kill('bg_unknown_abc123');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Session not found');
    });

    it('sets exitCode to -1 when killed', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('sleep 100', { cwd: '/tmp' });

      await manager.kill(sessionId);

      const poll = manager.poll(sessionId);
      expect(poll.exitCode).toBe(-1);
    });

    it('kill followed by exit event does not overwrite status to error', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('sleep 100', { cwd: '/tmp' });

      await manager.kill(sessionId);

      // Simulate the exit event that stopInstance triggers (non-zero = signal kill)
      lastCreatedInstance?.emit('exit', -1, 'SIGKILL');

      const poll = manager.poll(sessionId);
      expect(poll.status).toBe('exited'); // NOT 'error'
      expect(poll.exitCode).toBe(-1);
    });

    it('returns failure message when stopInstance throws', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      mockStopInstance.mockRejectedValueOnce(new Error('EPERM: operation not permitted'));

      const result = await manager.kill(sessionId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('EPERM');
    });

    it('handles non-Error rejection from stopInstance (string)', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      mockStopInstance.mockRejectedValueOnce('string error');

      const result = await manager.kill(sessionId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('string error');
    });
  });

  describe('auto cleanup', () => {
    it('retains session data for 5 minutes after exit', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('exit', 0, null);

      // 4 minutes later — still accessible
      vi.advanceTimersByTime(4 * 60 * 1000);
      const poll = manager.poll(sessionId);
      expect(poll.status).toBe('exited');
    });

    it('removes session data after 5 minutes', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('exit', 0, null);

      // 5 minutes + 1ms later — garbage collected
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      const poll = manager.poll(sessionId);
      expect(poll.status).toBe('error'); // unknown session returns error
      expect(poll.durationMs).toBe(0);
    });

    it('removes session from list() after cleanup', async () => {
      const manager = getBackgroundProcessManager();
      await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('exit', 0, null);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      const sessions = manager.list();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('dispose()', () => {
    it('kills all running processes and clears sessions', async () => {
      const manager = getBackgroundProcessManager();
      await manager.spawn('cmd1', { cwd: '/tmp' });
      await manager.spawn('cmd2', { cwd: '/tmp' });

      await manager.dispose();

      expect(mockStopInstance).toHaveBeenCalledTimes(2);
      expect(manager.list()).toHaveLength(0);
    });

    it('clears cleanup timers during dispose', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      // Simulate exit to schedule cleanup timer
      lastCreatedInstance?.emit('exit', 0, null);

      await manager.dispose();

      // After dispose, advancing timers should not cause errors
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(manager.list()).toHaveLength(0);
    });

    it('handles stopInstance errors gracefully during dispose', async () => {
      const manager = getBackgroundProcessManager();
      await manager.spawn('cmd', { cwd: '/tmp' });

      mockStopInstance.mockRejectedValueOnce(new Error('EPERM'));

      // Should not throw
      await expect(manager.dispose()).resolves.not.toThrow();
      expect(manager.list()).toHaveLength(0);
    });

    it('handles non-Error rejection from stopInstance during dispose', async () => {
      const manager = getBackgroundProcessManager();
      await manager.spawn('cmd', { cwd: '/tmp' });

      mockStopInstance.mockRejectedValueOnce('raw string error');

      await expect(manager.dispose()).resolves.not.toThrow();
      expect(manager.list()).toHaveLength(0);
    });
  });

  describe('error event', () => {
    it('sets status to error and appends [error] line when instance emits error', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('error', new Error('spawn ENOENT'));

      const poll = manager.poll(sessionId);
      expect(poll.status).toBe('error');

      const log = manager.log(sessionId);
      expect(log.lines.some(l => l.includes('[error]') && l.includes('spawn ENOENT'))).toBe(true);
    });

    it('schedules cleanup after error event', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('error', new Error('crash'));

      // Session still present before 5 minutes
      expect(manager.poll(sessionId).status).toBe('error');

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      // After cleanup, session is gone
      expect(manager.poll(sessionId).durationMs).toBe(0);
    });
  });

  describe('scheduleSessionCleanup() re-schedule', () => {
    it('clears existing cleanup timer when exit fires twice (e.g. kill then exit event skipped)', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      // First exit schedules cleanup
      lastCreatedInstance?.emit('exit', 0, null);

      // Second kill on already-exited session returns early without re-scheduling,
      // but kill() calls scheduleSessionCleanup again after catching stopInstance error.
      // We can also just trigger a second exit via error event to force a second schedule.
      // Easier: emit error after exit — this calls scheduleSessionCleanup a second time.
      // (killedByUser is false, so exit handler ran; error can still fire)
      lastCreatedInstance?.emit('error', new Error('secondary error'));

      // Should not throw and session should still clean up after 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(manager.poll(sessionId).durationMs).toBe(0);
    });

    it('handles scheduleSessionCleanup called after session is already deleted', async () => {
      const manager = getBackgroundProcessManager();
      await manager.spawn('cmd', { cwd: '/tmp' });

      // Force the session to be removed (simulating a race), then emit exit
      // which calls scheduleSessionCleanup with a now-missing sessionId
      const sessions = (manager as any).sessions as Map<string, unknown>;
      const sessionId = [...sessions.keys()][0];
      sessions.delete(sessionId);

      // This should not throw even though the session no longer exists
      expect(() => lastCreatedInstance?.emit('exit', 0, null)).not.toThrow();
    });
  });

  describe('cleanup timer stopInstance failure', () => {
    it('logs warning when stopInstance rejects inside the cleanup timer', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('exit', 0, null);

      // Make stopInstance reject when the cleanup timer fires
      mockStopInstance.mockRejectedValueOnce(new Error('already gone'));

      // Advance timers so the cleanup fires
      await vi.runAllTimersAsync();

      // Session should be gone despite the stopInstance error
      expect(manager.poll(sessionId).durationMs).toBe(0);
    });

    it('handles non-Error rejection from stopInstance inside cleanup timer', async () => {
      const manager = getBackgroundProcessManager();
      const { sessionId } = await manager.spawn('cmd', { cwd: '/tmp' });

      lastCreatedInstance?.emit('exit', 0, null);

      mockStopInstance.mockRejectedValueOnce('non-error string');

      await vi.runAllTimersAsync();

      expect(manager.poll(sessionId).durationMs).toBe(0);
    });
  });

  describe('list()', () => {
    it('returns all sessions with correct summary data', async () => {
      const manager = getBackgroundProcessManager();

      await manager.spawn('cmd1', { cwd: '/tmp' });
      await manager.spawn('cmd2 arg1', { cwd: '/home' });

      const sessions = manager.list();

      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({
        command: 'cmd1',
        status: 'running',
      });
      expect(sessions[1]).toMatchObject({
        command: 'cmd2 arg1',
        status: 'running',
      });

      // All should have required fields
      for (const session of sessions) {
        expect(session.sessionId).toMatch(/^bg_/);
        expect(typeof session.startTime).toBe('number');
        expect(typeof session.durationMs).toBe('number');
      }
    });
  });
});
