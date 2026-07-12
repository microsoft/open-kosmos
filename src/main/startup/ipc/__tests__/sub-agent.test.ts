import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockHandle = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: any[]) => (mockHandle as any)(...args),
  },
}));

const mockGetTasksForSession = vi.fn();
const mockGetTaskFile = vi.fn();
const mockLoadFromDisk = vi.fn();
const mockStoreInstance = {
  getTasksForSession: (...args: any[]) => (mockGetTasksForSession as any)(...args),
  getTaskFile: (...args: any[]) => (mockGetTaskFile as any)(...args),
  loadFromDisk: (...args: any[]) => (mockLoadFromDisk as any)(...args),
};

vi.mock('../../../lib/subAgent/subAgentTaskStore', () => ({
  SubAgentTaskStore: { getInstance: () => mockStoreInstance },
}));

const mockWatch = vi.fn();
const mockUnwatch = vi.fn();

vi.mock('../../../lib/subAgent/subAgentTaskWatcherRegistry', () => ({
  SubAgentTaskWatcherRegistry: {
    getInstance: () => ({
      watch: (...args: any[]) => (mockWatch as any)(...args),
      unwatch: (...args: any[]) => (mockUnwatch as any)(...args),
    }),
  },
}));

const mockResolveTaskIdByCorrelationId = vi.fn();

vi.mock('../../../lib/subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: () => ({
      resolveTaskIdByCorrelationId: (...args: any[]) => (mockResolveTaskIdByCorrelationId as any)(...args),
    }),
  },
}));

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for ${channel}`);
  return call[1];
}

async function registerWithCtx(ctx: any): Promise<void> {
  vi.clearAllMocks();
  vi.resetModules();
  const { default: registerSubAgentIPC } = await import('../sub-agent');
  registerSubAgentIPC(ctx);
}

const mockCtx = { currentUserAlias: 'alice' };

describe('startup/ipc/sub-agent', () => {
  beforeEach(async () => {
    await registerWithCtx(mockCtx);
  });

  describe('subAgentTask:listForSession', () => {
    it('returns tasks scoped to the current user alias', async () => {
      mockGetTasksForSession.mockReturnValue([{ taskId: 't1' }]);
      const handler = getHandler('subAgentTask:listForSession');
      const result = await handler({}, 'sess-1');
      expect(result).toEqual({ success: true, data: [{ taskId: 't1' }] });
      expect(mockGetTasksForSession).toHaveBeenCalledWith('sess-1', 'alice');
    });

    it('passes undefined when no current user alias is set', async () => {
      await registerWithCtx({ currentUserAlias: null });
      mockGetTasksForSession.mockReturnValue([]);
      const handler = getHandler('subAgentTask:listForSession');
      const result = await handler({}, 'sess-2');
      expect(result).toEqual({ success: true, data: [] });
      expect(mockGetTasksForSession).toHaveBeenCalledWith('sess-2', undefined);
    });

    it('returns an Error message on failure', async () => {
      mockGetTasksForSession.mockImplementation(() => {
        throw new Error('store boom');
      });
      const handler = getHandler('subAgentTask:listForSession');
      const result = await handler({}, 'sess-3');
      expect(result).toEqual({ success: false, error: 'store boom' });
    });

    it('stringifies a non-Error failure', async () => {
      mockGetTasksForSession.mockImplementation(() => {
        throw 'plain failure';
      });
      const handler = getHandler('subAgentTask:listForSession');
      const result = await handler({}, 'sess-4');
      expect(result).toEqual({ success: false, error: 'plain failure' });
    });
  });

  describe('subAgentTask:resolveByCorrelationId', () => {
    it('resolves a taskId from a correlationId', async () => {
      mockResolveTaskIdByCorrelationId.mockReturnValue('task-9');
      const handler = getHandler('subAgentTask:resolveByCorrelationId');
      const result = await handler({}, 'corr-1');
      expect(result).toEqual({ success: true, data: 'task-9' });
      expect(mockResolveTaskIdByCorrelationId).toHaveBeenCalledWith('corr-1');
    });
  });

  describe('subAgentTask:open', () => {
    const taskFile = {
      taskId: 't1',
      subAgentName: 'worker',
      status: 'running',
      startTime: 1,
      endTime: 2,
      turnCount: 3,
      model: 'gpt',
      chat_history: [{ role: 'user' }],
    };

    it('returns an error when no current user alias is set', async () => {
      await registerWithCtx({ currentUserAlias: null });
      const handler = getHandler('subAgentTask:open');
      const result = await handler({ sender: {} }, 't1');
      expect(result).toEqual({ success: false, error: 'No current user alias set' });
    });

    it('returns the in-memory task file and registers a watcher', async () => {
      mockGetTaskFile.mockReturnValue(taskFile);
      const sender = { id: 'webContents' };
      const handler = getHandler('subAgentTask:open');
      const result = await handler({ sender }, 't1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        taskId: 't1',
        subAgentName: 'worker',
        status: 'running',
        startTime: 1,
        endTime: 2,
        turnCount: 3,
        model: 'gpt',
        messages: [{ role: 'user' }],
      });
      expect(mockWatch).toHaveBeenCalledWith('t1', sender);
      expect(mockLoadFromDisk).not.toHaveBeenCalled();
    });

    it('falls back to loading the task file from disk', async () => {
      mockGetTaskFile.mockReturnValue(undefined);
      mockLoadFromDisk.mockResolvedValue(taskFile);
      const handler = getHandler('subAgentTask:open');
      const result = await handler({ sender: {} }, 't1');
      expect(result.success).toBe(true);
      expect(mockLoadFromDisk).toHaveBeenCalledWith('alice', 't1');
    });

    it('returns not found when the task file is missing', async () => {
      mockGetTaskFile.mockReturnValue(undefined);
      mockLoadFromDisk.mockResolvedValue(null);
      const handler = getHandler('subAgentTask:open');
      const result = await handler({ sender: {} }, 'missing');
      expect(result).toEqual({ success: false, error: 'Task "missing" not found' });
    });

    it('returns an Error message on failure', async () => {
      mockGetTaskFile.mockImplementation(() => {
        throw new Error('open boom');
      });
      const handler = getHandler('subAgentTask:open');
      const result = await handler({ sender: {} }, 't1');
      expect(result).toEqual({ success: false, error: 'open boom' });
    });

    it('returns "Unknown error" for a non-Error failure', async () => {
      mockGetTaskFile.mockImplementation(() => {
        throw 'weird';
      });
      const handler = getHandler('subAgentTask:open');
      const result = await handler({ sender: {} }, 't1');
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  describe('subAgentTask:close', () => {
    it('unregisters the watcher', async () => {
      const handler = getHandler('subAgentTask:close');
      const result = await handler({}, 't1');
      expect(result).toEqual({ success: true });
      expect(mockUnwatch).toHaveBeenCalledWith('t1');
    });

    it('returns an Error message on failure', async () => {
      mockUnwatch.mockImplementationOnce(() => {
        throw new Error('close boom');
      });
      const handler = getHandler('subAgentTask:close');
      const result = await handler({}, 't1');
      expect(result).toEqual({ success: false, error: 'close boom' });
    });

    it('returns "Unknown error" for a non-Error failure', async () => {
      mockUnwatch.mockImplementationOnce(() => {
        throw 'weird';
      });
      const handler = getHandler('subAgentTask:close');
      const result = await handler({}, 't1');
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });
});
