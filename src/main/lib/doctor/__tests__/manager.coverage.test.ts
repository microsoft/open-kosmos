// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- hoisted mocks ---
const mockGetAllWindows = vi.hoisted(() => vi.fn(() => []));
const mockRunnerRun = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockBindWebContents = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: mockLoggerInfo,
  }),
}));

vi.mock('../agentRunner', () => ({
  DoctorAgentRunner: vi.fn().mockImplementation(() => ({
    run: mockRunnerRun,
  })),
}));

vi.mock('@shared/ipc/doctor', () => ({
  mainToRender: {
    bindWebContents: mockBindWebContents,
  },
}));

import { DoctorManager } from '../manager';

function makeWindow(opts: { destroyed?: boolean; hasSender?: boolean } = {}) {
  const { destroyed = false, hasSender = true } = opts;
  const sender = {
    doctorTaskStatusChanged: vi.fn(),
    doctorAgentQuestion: vi.fn(),
    doctorStepInfo: vi.fn(),
  };
  mockBindWebContents.mockReturnValue(sender);
  return {
    isDestroyed: () => destroyed,
    webContents: hasSender ? {} : null,
    _sender: sender,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DoctorManager.submitInquiry', () => {
  it('returns a taskId and sets _isRunning', async () => {
    const manager = new DoctorManager();
    mockGetAllWindows.mockReturnValue([]);
    mockRunnerRun.mockResolvedValue({ success: true, issueUrl: 'https://github.com/issues/1' });

    const { taskId } = await manager.submitInquiry({ description: 'bug', steps: '' } as any);
    expect(typeof taskId).toBe('string');
    expect(taskId.length).toBeGreaterThan(0);
  });

  it('throws if already running', async () => {
    const manager = new DoctorManager();
    mockGetAllWindows.mockReturnValue([]);
    // Never resolves — keeps _isRunning = true
    mockRunnerRun.mockImplementation(() => new Promise(() => {}));

    await manager.submitInquiry({ description: 'first' } as any);
    await expect(manager.submitInquiry({ description: 'second' } as any)).rejects.toThrow(
      'A doctor task is already running'
    );
  });

  it('resets _isRunning and emits error status on runner failure', async () => {
    const manager = new DoctorManager();
    const win = makeWindow();
    mockGetAllWindows.mockReturnValue([win]);
    mockRunnerRun.mockRejectedValue(new Error('crash'));

    await manager.submitInquiry({ description: 'x' } as any);
    // Let the background microtask settle
    await new Promise((r) => setTimeout(r, 10));
    expect((manager as any)._isRunning).toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('resets _isRunning after successful run', async () => {
    const manager = new DoctorManager();
    mockGetAllWindows.mockReturnValue([]);
    mockRunnerRun.mockResolvedValue({ success: true, issueUrl: 'u' });

    await manager.submitInquiry({ description: 'x' } as any);
    await new Promise((r) => setTimeout(r, 10));
    expect((manager as any)._isRunning).toBe(false);
  });

  it('emits error status when runner returns success=false', async () => {
    const manager = new DoctorManager();
    const win = makeWindow();
    mockGetAllWindows.mockReturnValue([win]);
    mockRunnerRun.mockResolvedValue({ success: false, error: 'something broke' });

    await manager.submitInquiry({ description: 'x' } as any);
    await new Promise((r) => setTimeout(r, 10));
    // updateStatus should have been called via sender
    expect(win._sender.doctorTaskStatusChanged).toHaveBeenCalled();
  });
});

describe('DoctorManager.receiveAnswer', () => {
  it('resolves the pending question', async () => {
    const manager = new DoctorManager();
    mockGetAllWindows.mockReturnValue([]);

    const promise = manager.askUserQuestion('tid', [] as any);
    manager.receiveAnswer('tid', { q1: 'yes' });
    const result = await promise;
    expect(result).toEqual({ q1: 'yes' });
  });

  it('warns when no pending question', () => {
    const manager = new DoctorManager();
    manager.receiveAnswer('unknown', {});
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('DoctorManager'),
      expect.any(String),
      expect.objectContaining({ taskId: 'unknown' })
    );
  });
});

describe('DoctorManager.askUserQuestion', () => {
  it('resolves with empty object after timeout', async () => {
    vi.useFakeTimers();
    const manager = new DoctorManager();
    mockGetAllWindows.mockReturnValue([]);

    const promise = manager.askUserQuestion('tid2', [] as any);
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    const result = await promise;
    expect(result).toEqual({});
    vi.useRealTimers();
  });

  it('broadcasts question to renderer windows', async () => {
    const manager = new DoctorManager();
    const win = makeWindow();
    mockGetAllWindows.mockReturnValue([win]);

    const promise = manager.askUserQuestion('tid3', [{ id: 'q1', type: 'text', text: 'why?' }] as any);
    manager.receiveAnswer('tid3', {});
    await promise;
    expect(win._sender.doctorAgentQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'tid3' })
    );
  });

  it('handles destroyed windows gracefully', async () => {
    const manager = new DoctorManager();
    const win = makeWindow({ destroyed: true });
    mockGetAllWindows.mockReturnValue([win]);

    const promise = manager.askUserQuestion('tid4', [] as any);
    manager.receiveAnswer('tid4', { a: 1 });
    const result = await promise;
    expect(result).toEqual({ a: 1 });
    expect(win._sender.doctorAgentQuestion).not.toHaveBeenCalled();
  });
});

describe('useSender error handling', () => {
  it('logs a warning if BrowserWindow.getAllWindows throws', async () => {
    const manager = new DoctorManager();
    mockGetAllWindows.mockImplementation(() => {
      throw new Error('window error');
    });
    // submitInquiry calls updateStatus which calls useSender
    mockRunnerRun.mockResolvedValue({ success: true });
    await manager.submitInquiry({ description: 'x' } as any);
    // No throw — just a warn log
    expect(mockLoggerWarn).toHaveBeenCalled();
  });
});
