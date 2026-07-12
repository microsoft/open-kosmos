/**
 * SubAgentTaskStore unit tests
 *
 * Covers:
 * - Orphan recovery in getTasksForSession(): running on disk → cancelled
 * - Orphan recovery in loadFromDisk(): running on disk → cancelled
 * - Normal getTasksForSession(): completed/failed tasks returned unchanged
 * - createTask(): creates in-memory entry, schedules flush
 * - completeTask(): sets status + endTime, forces flush
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: {
    generateTitle: vi.fn().mockResolvedValue({ success: false }),
  },
}));

// ─── fs mock ───

const {
  mockExistsSync,
  mockReaddirSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockRenameSync,
  mockRmSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false),
  mockReaddirSync: vi.fn(() => [] as string[]),
  mockReadFileSync: vi.fn(() => '{}'),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockRmSync: vi.fn(),
}));

vi.mock('fs', async () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  renameSync: mockRenameSync,
  rmSync: mockRmSync,
}));

// ─── Imports (after mocks) ───

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentTaskStore } from '../subAgentTaskStore';
import type { SubAgentTaskMetadata } from '../subAgentTaskTypes';
import { ChatSessionTitleLlmSummarizer } from '../../llm/chatSessionTitleLlmSummarizer';

// ─── Helpers ───

function makeMetadata(overrides: Partial<SubAgentTaskMetadata> = {}): SubAgentTaskMetadata {
  return {
    taskId: 'task-001',
    subAgentName: 'test-agent',
    parentSessionId: 'session-abc',
    parentChatId: 'chat-xyz',
    startTime: Date.now(),
    model: 'gpt-4o',
    isAdhoc: false,
    taskDescription: 'Do something useful',
    ...overrides,
  };
}

function makeTaskFileJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    taskId: 'task-disk-01',
    subAgentName: 'disk-agent',
    parentSessionId: 'session-abc',
    parentChatId: 'chat-xyz',
    startTime: 1700000000000,
    status: 'running',
    model: 'gpt-4o',
    isAdhoc: false,
    turnCount: 3,
    title: 'Some disk task',
    chat_history: [],
    context_history: [],
    ...overrides,
  });
}

// ─── Reset singleton between tests ───

function getStore(): SubAgentTaskStore {
  // Reset the private singleton so each test starts clean
  (SubAgentTaskStore as unknown as { instance: SubAgentTaskStore | undefined }).instance = undefined;
  return SubAgentTaskStore.getInstance();
}

// ─── Tests ───

describe('SubAgentTaskStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: disk directory doesn't exist
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockImplementation(() => undefined);
    mockMkdirSync.mockImplementation(() => undefined);
    mockRenameSync.mockImplementation(() => undefined);
    mockRmSync.mockImplementation(() => undefined);
    vi.mocked(ChatSessionTitleLlmSummarizer.generateTitle).mockResolvedValue({ success: false });
  });

  // ─── getTasksForSession — orphan recovery ───

  describe('getTasksForSession() — orphan recovery', () => {
    it('returns cancelled (not running) for a task found on disk with status=running', () => {
      const store = getStore();

      // Simulate disk layout: baseDir exists, one month dir, one file
      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['task-disk-01.json'];
      });
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'running' }));

      const results = store.getTasksForSession('session-abc', 'alice');

      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe('task-disk-01');
      expect(results[0].status).toBe('cancelled');
    });

    it('rewrites the file to disk when recovering an orphaned running task', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['task-disk-01.json'];
      });
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'running' }));

      store.getTasksForSession('session-abc', 'alice');

      // writeFileSync should have been called to persist the recovered status
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.status).toBe('cancelled');
    });

    it('does NOT rewrite disk file when task was already completed', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['task-disk-01.json'];
      });
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'completed' }));

      const results = store.getTasksForSession('session-abc', 'alice');

      expect(results[0].status).toBe('completed');
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('does NOT rewrite disk file when task was already failed', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['task-disk-01.json'];
      });
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'failed' }));

      const results = store.getTasksForSession('session-abc', 'alice');

      expect(results[0].status).toBe('failed');
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('skips tasks belonging to a different parentSessionId', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['task-disk-01.json'];
      });
      mockReadFileSync.mockReturnValue(
        makeTaskFileJson({ parentSessionId: 'session-OTHER' }),
      );

      const results = store.getTasksForSession('session-abc', 'alice');

      expect(results).toHaveLength(0);
    });

    it('skips a disk task that is already present in memory', () => {
      const store = getStore();

      const meta = makeMetadata({ taskId: 'task-disk-01' });
      store.createTask('alice', meta);

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['task-disk-01.json'];
      });
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'running' }));

      // Clear write calls made by createTask's flush
      mockWriteFileSync.mockClear();

      const results = store.getTasksForSession('session-abc', 'alice');

      // Only one result (the in-memory one), not a duplicate from disk
      expect(results).toHaveLength(1);
      // The in-memory entry keeps status=running (it's still live)
      expect(results[0].status).toBe('running');
      // No orphan-recovery write should have happened
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('returns empty array when no userAlias is provided', () => {
      const store = getStore();

      // Even if disk had content, without userAlias disk scan is skipped
      mockExistsSync.mockReturnValue(true);

      const results = store.getTasksForSession('session-abc');

      expect(results).toHaveLength(0);
    });
  });

  // ─── loadFromDisk — orphan recovery ───

  describe('loadFromDisk() — orphan recovery', () => {
    it('returns a task with status=cancelled when disk file has status=running', async () => {
      const store = getStore();

      (mockExistsSync as any).mockImplementation((p: any) => {
        // baseDir exists; file path exists
        return true;
      });
      mockReaddirSync.mockReturnValue(['202501']);
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'running', taskId: 'task-disk-01' }));

      const result = await store.loadFromDisk('alice', 'task-disk-01');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('cancelled');
    });

    it('rewrites the file to disk when recovering in loadFromDisk', async () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['202501']);
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'running', taskId: 'task-disk-01' }));

      await store.loadFromDisk('alice', 'task-disk-01');

      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.status).toBe('cancelled');
    });

    it('returns a completed task unchanged from loadFromDisk', async () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['202501']);
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ status: 'completed', taskId: 'task-disk-01' }));

      const result = await store.loadFromDisk('alice', 'task-disk-01');

      expect(result!.status).toBe('completed');
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('returns the in-memory task directly without touching disk', async () => {
      const store = getStore();

      const meta = makeMetadata({ taskId: 'task-001' });
      store.createTask('alice', meta);

      const result = await store.loadFromDisk('alice', 'task-001');

      expect(result).not.toBeNull();
      expect(result!.taskId).toBe('task-001');
      // Disk should not have been consulted for an in-memory task
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });

    it('returns null when baseDir does not exist', async () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(false);

      const result = await store.loadFromDisk('alice', 'task-nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when the task file is not found in any month dir', async () => {
      const store = getStore();

      (mockExistsSync as any).mockImplementation((p: any) => {
        // baseDir exists but individual file path does not
        if ((p as string).endsWith('.json')) return false;
        return true;
      });
      mockReaddirSync.mockReturnValue(['202501']);

      const result = await store.loadFromDisk('alice', 'task-missing');

      expect(result).toBeNull();
    });
  });

  // ─── deleteTasksForChat ───

  describe('deleteTasksForChat()', () => {
    it('removes matching in-memory tasks and disk files for the chat', () => {
      const store = getStore();
      store.createTask('alice', makeMetadata({ taskId: 'task-memory-01', parentChatId: 'chat-xyz' }));
      store.createTask('alice', makeMetadata({ taskId: 'task-memory-other', parentChatId: 'chat-other' }));
      mockWriteFileSync.mockClear();
      mockRenameSync.mockClear();

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['task-disk-01.json', 'task-disk-other.json'];
      });
      (mockReadFileSync as any).mockImplementation((filePath: string) => (
        filePath.endsWith('task-disk-01.json')
          ? makeTaskFileJson({ taskId: 'task-disk-01', parentChatId: 'chat-xyz' })
          : makeTaskFileJson({ taskId: 'task-disk-other', parentChatId: 'chat-other' })
      ));

      const deletedCount = store.deleteTasksForChat('alice', 'chat-xyz');

      expect(deletedCount).toBe(2);
      expect(store.getTaskFile('task-memory-01')).toBeUndefined();
      expect(store.getTaskFile('task-memory-other')).toBeDefined();
      expect(mockRmSync).toHaveBeenCalledTimes(1);
      expect(mockRmSync.mock.calls[0][0]).toContain('task-disk-01.json');
    });

    it('returns zero when the base directory is missing', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(false);

      expect(store.deleteTasksForChat('alice', 'chat-xyz')).toBe(0);
      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('continues when an individual task file cannot be parsed', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['broken.json', 'task-disk-01.json'];
      });
      (mockReadFileSync as any).mockImplementation((filePath: string) => (
        filePath.endsWith('broken.json')
          ? '{'
          : makeTaskFileJson({ taskId: 'task-disk-01', parentChatId: 'chat-xyz' })
      ));

      expect(store.deleteTasksForChat('alice', 'chat-xyz')).toBe(1);
      expect(mockRmSync).toHaveBeenCalledTimes(1);
    });

    it('uses the filename as the deleted id when the task file has no taskId', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      (mockReaddirSync as any).mockImplementation((dirPath: unknown) => {
        if ((dirPath as string).endsWith('sub-agent-tasks')) return ['202501'];
        return ['missing-id.json'];
      });
      mockReadFileSync.mockReturnValue(makeTaskFileJson({ taskId: undefined, parentChatId: 'chat-xyz' }));

      expect(store.deleteTasksForChat('alice', 'chat-xyz')).toBe(1);
      expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('missing-id.json'), { force: true });
    });

    it('returns already-deleted in-memory count when disk scanning throws', () => {
      const store = getStore();
      store.createTask('alice', makeMetadata({ taskId: 'task-memory-01', parentChatId: 'chat-xyz' }));
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw 'scan failed'; });

      expect(store.deleteTasksForChat('alice', 'chat-xyz')).toBe(1);
      expect(store.getTaskFile('task-memory-01')).toBeUndefined();
    });
  });

  // ─── createTask ───

  describe('createTask()', () => {
    it('stores the task in memory with status=running', () => {
      const store = getStore();

      const meta = makeMetadata();
      store.createTask('alice', meta);

      const file = store.getTaskFile('task-001');
      expect(file).toBeDefined();
      expect(file!.status).toBe('running');
      expect(file!.taskId).toBe('task-001');
      expect(file!.parentSessionId).toBe('session-abc');
    });

    it('truncates a long taskDescription to 50 chars + ellipsis for title', () => {
      const store = getStore();

      const longDesc = 'A'.repeat(60);
      const meta = makeMetadata({ taskDescription: longDesc });
      store.createTask('alice', meta);

      const file = store.getTaskFile('task-001');
      expect(file!.title).toBe('A'.repeat(50) + '...');
    });

    it('uses subAgentName as title when taskDescription is absent', () => {
      const store = getStore();

      const meta = makeMetadata({ taskDescription: undefined });
      store.createTask('alice', meta);

      const file = store.getTaskFile('task-001');
      expect(file!.title).toBe('test-agent');
    });

    it('initialises turnCount to 0 and histories to empty arrays', () => {
      const store = getStore();

      store.createTask('alice', makeMetadata());

      const file = store.getTaskFile('task-001')!;
      expect(file.turnCount).toBe(0);
      expect(file.chat_history).toEqual([]);
      expect(file.context_history).toEqual([]);
    });

    it('schedules a debounced flush (does not immediately write to disk)', () => {
      const store = getStore();

      // Use fake timers so the setTimeout doesn't fire
      vi.useFakeTimers();
      store.createTask('alice', makeMetadata());

      // No synchronous write should have happened yet
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('notifies a live window and applies an async generated title', async () => {
      const store = getStore();
      const webContents = { send: vi.fn() };
      store.setMainWindow({ isDestroyed: () => false, webContents } as any);
      vi.mocked(ChatSessionTitleLlmSummarizer.generateTitle).mockResolvedValueOnce({
        success: true,
        title: 'Generated title',
      } as any);

      store.createTask('alice', makeMetadata({ taskDescription: 'Generate a better title' }));
      await Promise.resolve();
      await Promise.resolve();

      expect(webContents.send).toHaveBeenCalledWith(
        'subAgentTaskStore:taskCreated',
        expect.objectContaining({ taskId: 'task-001', title: 'Generate a better title' }),
      );
      expect(store.getTaskFile('task-001')?.title).toBe('Generated title');
      expect(webContents.send).toHaveBeenCalledWith(
        'subAgentTaskStore:taskUpdated',
        expect.objectContaining({ taskId: 'task-001', title: 'Generated title' }),
      );
    });
  });

  describe('history mutation helpers', () => {
    const message = { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }] } as any;

    it('updates chat/context histories and turn count, with missing-task no-ops', () => {
      const store = getStore();
      store.createTask('alice', makeMetadata());

      store.appendMessage('task-001', message);
      store.appendMessage('task-001', { ...message, id: 'm2' }, 'context_only');
      store.appendMessages('task-001', [{ ...message, id: 'm3' }]);
      store.appendMessages('task-001', [{ ...message, id: 'm4' }], 'context_only');
      store.replaceContextHistory('task-001', [{ ...message, id: 'ctx-only' }]);
      store.incrementTurnCount('task-001');

      store.appendMessage('missing', message);
      store.appendMessages('missing', [message]);
      store.replaceContextHistory('missing', [message]);
      store.incrementTurnCount('missing');

      const file = store.getTaskFile('task-001')!;
      expect(file.chat_history.map(msg => msg.id)).toEqual(['m1', 'm3']);
      expect(file.context_history.map(msg => msg.id)).toEqual(['ctx-only']);
      expect(file.turnCount).toBe(1);
    });

    it('removeInMemoryForSession flushes dirty tasks before removal', () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      store.createTask('alice', makeMetadata({ taskId: 'task-001', parentSessionId: 'session-abc' }));
      store.createTask('alice', makeMetadata({ taskId: 'task-other', parentSessionId: 'session-other' }));
      mockWriteFileSync.mockClear();
      mockRenameSync.mockClear();

      store.removeInMemoryForSession('session-abc');

      expect(store.getTaskFile('task-001')).toBeUndefined();
      expect(store.getTaskFile('task-other')).toBeDefined();
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockRenameSync).toHaveBeenCalled();
    });
  });

  // ─── completeTask ───

  describe('completeTask()', () => {
    it('sets status, endTime, and flushes synchronously', () => {
      const store = getStore();

      // Ensure the dir-existence check inside flushNow passes
      mockExistsSync.mockReturnValue(true);

      store.createTask('alice', makeMetadata());
      // Clear write calls from createTask's debounced flush setup
      mockWriteFileSync.mockClear();
      mockRenameSync.mockClear();

      store.completeTask('task-001', 'completed', 'all done');

      const file = store.getTaskFile('task-001')!;
      expect(file.status).toBe('completed');
      expect(file.endTime).toBeDefined();
      expect(file.result).toBe('all done');

      // Force flush writes atomically (temp file + rename)
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockRenameSync).toHaveBeenCalled();
    });

    it('sets status=failed and records the error string', () => {
      const store = getStore();

      mockExistsSync.mockReturnValue(true);
      store.createTask('alice', makeMetadata());

      store.completeTask('task-001', 'failed', undefined, 'LLM timed out');

      const file = store.getTaskFile('task-001')!;
      expect(file.status).toBe('failed');
      expect(file.error).toBe('LLM timed out');
    });

    it('is a no-op when the taskId is not in memory', () => {
      const store = getStore();

      // Should not throw
      expect(() => store.completeTask('nonexistent', 'cancelled')).not.toThrow();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('swallows flush errors when completing a task', () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => { throw 'write failed'; });
      store.createTask('alice', makeMetadata());

      expect(() => store.completeTask('task-001', 'completed')).not.toThrow();
      expect(store.getTaskFile('task-001')?.status).toBe('completed');
    });
  });

  describe('disk error handling', () => {
    it('returns in-memory session tasks when disk scanning fails', () => {
      const store = getStore();
      store.createTask('alice', makeMetadata({ taskId: 'task-memory-01' }));
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw 'scan failed'; });

      const results = store.getTasksForSession('session-abc', 'alice');

      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe('task-memory-01');
    });

    it('returns null when loadFromDisk scanning fails', async () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw 'scan failed'; });

      await expect(store.loadFromDisk('alice', 'task-001')).resolves.toBeNull();
    });
  });

  describe('coverage edge cases', () => {
    it('returns the same singleton instance without resetting', () => {
      const store = getStore();

      expect(SubAgentTaskStore.getInstance()).toBe(store);
    });

    it('covers in-memory and missing-base branches when listing session tasks', () => {
      const store = getStore();
      store.createTask('alice', makeMetadata({ parentSessionId: 'session-other' }));

      const results = store.getTasksForSession('session-abc', 'alice');

      expect(results).toEqual([]);
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });

    it('logs Error objects from session task disk scans', () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw new Error('scan failed'); });

      expect(store.getTasksForSession('session-abc', 'alice')).toEqual([]);
    });

    it('logs Error objects from loadFromDisk scans', async () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw new Error('scan failed'); });

      await expect(store.loadFromDisk('alice', 'task-001')).resolves.toBeNull();
    });

    it('removes a clean in-memory task without flushing', () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      store.createTask('alice', makeMetadata({ taskDescription: undefined }));
      store.completeTask('task-001', 'completed');
      mockWriteFileSync.mockClear();

      store.removeInMemoryForSession('session-abc');

      expect(store.getTaskFile('task-001')).toBeUndefined();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('skips in-memory tasks owned by a different alias during chat deletion', () => {
      const store = getStore();
      store.createTask('alice', makeMetadata({ taskId: 'task-alice', taskDescription: undefined }));
      store.createTask('bob', makeMetadata({ taskId: 'task-bob', taskDescription: undefined }));

      expect(store.deleteTasksForChat('alice', 'chat-xyz')).toBe(1);
      expect(store.getTaskFile('task-alice')).toBeUndefined();
      expect(store.getTaskFile('task-bob')).toBeDefined();
    });

    it('logs Error objects when chat task deletion disk scans fail', () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw new Error('scan failed'); });

      expect(store.deleteTasksForChat('alice', 'chat-xyz')).toBe(0);
    });

    it('ignores a generated title when the task was already removed', async () => {
      const store = getStore();
      let resolveTitle: (value: { success: boolean; title: string }) => void = () => {};
      vi.mocked(ChatSessionTitleLlmSummarizer.generateTitle).mockReturnValueOnce(
        new Promise(resolve => { resolveTitle = resolve; }) as any,
      );
      store.createTask('alice', makeMetadata());
      store.deleteTasksForChat('alice', 'chat-xyz');

      resolveTitle({ success: true, title: 'Late title' });
      await Promise.resolve();
      await Promise.resolve();

      expect(store.getTaskFile('task-001')).toBeUndefined();
    });

    it('swallows non-Error async title generation failures', async () => {
      const store = getStore();
      vi.mocked(ChatSessionTitleLlmSummarizer.generateTitle).mockRejectedValueOnce('title failed');

      store.createTask('alice', makeMetadata());
      await Promise.resolve();
      await Promise.resolve();

      expect(store.getTaskFile('task-001')?.title).toBe('Do something useful');
    });

    it('allows private scheduling and flushing no-ops for missing or clean entries', () => {
      const store = getStore() as any;
      store.scheduleFlush('missing');
      store.flushNow('missing');
      store.createTask('alice', makeMetadata({ taskDescription: undefined }));
      store.tasksById.get('task-001').dirty = false;

      store.flushNow('task-001');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('flushes a dirty entry without a pending timer and creates the directory', () => {
      const store = getStore() as any;
      store.createTask('alice', makeMetadata({ taskDescription: undefined }));
      const entry = store.tasksById.get('task-001');
      clearTimeout(entry.flushTimer);
      entry.flushTimer = undefined;
      mockExistsSync.mockReturnValue(false);

      store.flushNow('task-001');

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('logs Error objects from flush failures', () => {
      const store = getStore();
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => { throw new Error('write failed'); });
      store.createTask('alice', makeMetadata({ taskDescription: undefined }));

      expect(() => store.completeTask('task-001', 'completed')).not.toThrow();
    });
  });
});
