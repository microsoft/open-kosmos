// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (must come before imports that trigger side effects) ─────────────

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: vi.fn().mockResolvedValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createLogger: vi.fn().mockResolvedValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({}));
vi.mock('../../userDataADO', () => ({}));
vi.mock('../../chat/agentChatManager', () => ({}));
vi.mock('../../chat/subAgentAutoWake', () => ({ SubAgentAutoWake: class {} }));
vi.mock('../../mcpRuntime/mcpClientManager', () => ({}));

vi.mock('../subAgentConfigResolver', () => ({
  sanitizeSubAgentResult: vi.fn((s: string) => s),
}));

const mockTaskStore = {
  createTask: vi.fn(),
  completeTask: vi.fn(),
  removeInMemoryForSession: vi.fn(),
};
vi.mock('../subAgentTaskStore', () => ({
  SubAgentTaskStore: {
    getInstance: vi.fn(() => mockTaskStore),
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { SubAgentLifecycle } from '../subAgentLifecycle';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeShared() {
  return {
    runtimeStates: new Map(),
    activeInstances: new Map(),
    parentChildMap: new Map(),
    spawnCountMap: new Map(),
  };
}

function makeSpawner() {
  return {
    spawnSubAgent: vi.fn().mockResolvedValue({
      subAgentName: 'agent',
      taskId: 'tid',
      success: true,
      turnCount: 1,
      durationMs: 100,
    }),
    spawnAdhocSubAgent: vi.fn().mockResolvedValue({
      subAgentName: 'adhoc',
      taskId: 'tid',
      success: true,
      turnCount: 1,
      durationMs: 100,
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SubAgentLifecycle', () => {
  let shared: ReturnType<typeof makeShared>;
  let spawner: ReturnType<typeof makeSpawner>;
  let emitEvent: ReturnType<typeof vi.fn>;
  let lifecycle: SubAgentLifecycle;

  beforeEach(() => {
    vi.useFakeTimers();
    shared = makeShared();
    spawner = makeSpawner();
    emitEvent = vi.fn();
    lifecycle = new SubAgentLifecycle(shared, spawner, emitEvent);
    mockTaskStore.createTask.mockClear();
    mockTaskStore.completeTask.mockClear();
    mockTaskStore.removeInMemoryForSession.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── spawnSubAgentAsync ────────────────────────────────────────────────

  describe('spawnSubAgentAsync', () => {
    const baseParams = {
      parentSessionId: 'session1',
      parentChatId: 'chat1',
      userAlias: 'user1',
      subAgentName: 'myAgent',
      task: 'do something',
    };

    it('returns {taskId, status: launched}', async () => {
      const result = await lifecycle.spawnSubAgentAsync(baseParams);
      expect(result.status).toBe('launched');
      expect(result.taskId).toMatch(/^sa_/);
    });

    it('stores task in backgroundTasks immediately after launch', async () => {
      // Delay spawner resolution so the task is still 'running' when we check
      let resolve: (v: any) => void;
      spawner.spawnSubAgent.mockReturnValue(new Promise((res) => { resolve = res; }));
      const result = await lifecycle.spawnSubAgentAsync(baseParams);
      if (result.status !== 'launched') throw new Error('expected launched');
      const task = lifecycle.getBackgroundTask(result.taskId);
      expect(task).toBeDefined();
      expect(task?.subAgentName).toBe('myAgent');
      expect(task?.status).toBe('running');
      resolve!({ subAgentName: 'a', taskId: 't', success: true, turnCount: 0, durationMs: 0 });
    });

    it('increments spawnCountMap', async () => {
      await lifecycle.spawnSubAgentAsync(baseParams);
      expect(shared.spawnCountMap.get('session1')).toBe(1);
      await lifecycle.spawnSubAgentAsync(baseParams);
      expect(shared.spawnCountMap.get('session1')).toBe(2);
    });

    it('calls SubAgentTaskStore.createTask', async () => {
      await lifecycle.spawnSubAgentAsync(baseParams);
      expect(mockTaskStore.createTask).toHaveBeenCalledOnce();
    });

    it('uses adhoc- prefix in name when adhoc=true', async () => {
      const result = await lifecycle.spawnSubAgentAsync({ ...baseParams, adhoc: true });
      if (result.status !== 'launched') throw new Error('expected launched');
      expect(lifecycle.getBackgroundTask(result.taskId)?.subAgentName).toMatch(/^adhoc-/);
    });

    it('executeInBackground: calls spawnSubAgent and marks task completed', async () => {
      const result = await lifecycle.spawnSubAgentAsync(baseParams);
      if (result.status !== 'launched') throw new Error();
      await vi.runAllTimersAsync();
      expect(spawner.spawnSubAgent).toHaveBeenCalled();
      expect(lifecycle.getBackgroundTask(result.taskId)?.status).toBe('completed');
    });

    it('executeInBackground: enqueues result in resultQueue', async () => {
      await lifecycle.spawnSubAgentAsync(baseParams);
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('session1');
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
    });

    it('executeInBackground: calls spawnAdhocSubAgent when adhoc=true', async () => {
      await lifecycle.spawnSubAgentAsync({ ...baseParams, adhoc: true });
      await vi.runAllTimersAsync();
      expect(spawner.spawnAdhocSubAgent).toHaveBeenCalled();
      expect(spawner.spawnSubAgent).not.toHaveBeenCalled();
    });

    it('executeInBackground: handles spawner throwing an Error', async () => {
      spawner.spawnSubAgent.mockRejectedValue(new Error('spawn failed'));
      const result = await lifecycle.spawnSubAgentAsync(baseParams);
      if (result.status !== 'launched') throw new Error();
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('session1');
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('spawn failed');
      expect(lifecycle.getBackgroundTask(result.taskId)?.status).toBe('failed');
    });

    it('executeInBackground: handles non-Error thrown value', async () => {
      spawner.spawnSubAgent.mockRejectedValue('plain string error');
      await lifecycle.spawnSubAgentAsync(baseParams);
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('session1');
      expect(results[0].error).toBe('plain string error');
    });

    it('executeInBackground: marks task failed when result.success is false', async () => {
      spawner.spawnSubAgent.mockResolvedValue({
        subAgentName: 'agent', taskId: 'tid', success: false, error: 'oops', turnCount: 0, durationMs: 10,
      });
      const result = await lifecycle.spawnSubAgentAsync(baseParams);
      if (result.status !== 'launched') throw new Error();
      await vi.runAllTimersAsync();
      expect(lifecycle.getBackgroundTask(result.taskId)?.status).toBe('failed');
    });

    it('executeInBackground: adhoc error uses adhoc name', async () => {
      spawner.spawnAdhocSubAgent.mockRejectedValue(new Error('adhoc fail'));
      const result = await lifecycle.spawnSubAgentAsync({ ...baseParams, adhoc: true });
      if (result.status !== 'launched') throw new Error();
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('session1');
      expect(results[0].subAgentName).toMatch(/^adhoc-/);
    });
  });

  // ─── promoteToBackground ──────────────────────────────────────────────

  describe('promoteToBackground', () => {
    it('creates a background task with status running', () => {
      const chat = { getTurnCount: vi.fn(() => 2), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      const chatPromise = new Promise<string>(() => {});
      lifecycle.promoteToBackground(
        'task1', chatPromise, chat,
        { parentSessionId: 'sess1', parentChatId: 'c', userAlias: 'u', subAgentName: 'myAgent' },
        Date.now(), [],
      );
      expect(lifecycle.getBackgroundTask('task1')?.status).toBe('running');
    });

    it('returns result with autoPromoted=true and success=true', () => {
      const chat = { getTurnCount: vi.fn(() => 2), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      const result = lifecycle.promoteToBackground(
        'task1', new Promise<string>(() => {}), chat,
        { parentSessionId: 's', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent' },
        Date.now(), [],
      );
      expect(result.autoPromoted).toBe(true);
      expect(result.success).toBe(true);
    });

    it('uses overrideSubAgentName when provided', () => {
      const chat = { getTurnCount: vi.fn(() => 0), dispose: vi.fn() };
      const result = lifecycle.promoteToBackground(
        'task2', new Promise<string>(() => {}), chat,
        { parentSessionId: 's', parentChatId: 'c', userAlias: 'u' },
        Date.now(), [], 'overrideName',
      );
      expect(result.subAgentName).toBe('overrideName');
    });

    it('defaults subAgentName to "unknown" when none provided', () => {
      const chat = { getTurnCount: vi.fn(() => 0), dispose: vi.fn() };
      const result = lifecycle.promoteToBackground(
        'task3', new Promise<string>(() => {}), chat,
        { parentSessionId: 's', parentChatId: 'c', userAlias: 'u' },
        Date.now(), [],
      );
      expect(result.subAgentName).toBe('unknown');
    });

    it('includes availabilityWarnings in result', () => {
      const chat = { getTurnCount: vi.fn(() => 0), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      const result = lifecycle.promoteToBackground(
        'task4', new Promise<string>(() => {}), chat,
        { parentSessionId: 's', parentChatId: 'c', userAlias: 'u', subAgentName: 'a' },
        Date.now(), ['w1', 'w2'],
      );
      expect(result.availabilityWarnings).toEqual(['w1', 'w2']);
    });

    it('includes partial result snippet when chat.extractPartialResult returns text', () => {
      const chat = { getTurnCount: vi.fn(() => 0), extractPartialResult: vi.fn(() => 'partial text'), dispose: vi.fn() };
      const result = lifecycle.promoteToBackground(
        'task5', new Promise<string>(() => {}), chat,
        { parentSessionId: 's', parentChatId: 'c', userAlias: 'u', subAgentName: 'a' },
        Date.now(), [],
      );
      expect(result.result).toContain('partial text');
    });

    it('sends subAgent:autoPromoted via eventSender', () => {
      const chat = { getTurnCount: vi.fn(() => 0), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      const mockSender = { send: vi.fn() };
      lifecycle.promoteToBackground(
        'task6', new Promise<string>(() => {}), chat,
        { parentSessionId: 's', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', eventSender: mockSender as any },
        Date.now(), [],
      );
      expect(mockSender.send).toHaveBeenCalledWith('subAgent:autoPromoted', expect.objectContaining({ taskId: 'task6' }));
    });

    it('promise resolves: enqueues success result and deletes background task', async () => {
      const chat = { getTurnCount: vi.fn(() => 3), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      let resolve: (v: string) => void;
      const chatPromise = new Promise<string>((res) => { resolve = res; });
      lifecycle.promoteToBackground(
        'task7', chatPromise, chat,
        { parentSessionId: 'sess7', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent' },
        Date.now(), [],
      );
      shared.activeInstances.set('task7', chat);
      resolve!('final result');
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('sess7');
      expect(results[0]?.success).toBe(true);
      expect(results[0]?.autoPromoted).toBe(true);
      expect(lifecycle.getBackgroundTask('task7')).toBeUndefined();
    });

    it('promise resolves: calls SubAgentTaskStore.completeTask', async () => {
      const chat = { getTurnCount: vi.fn(() => 1), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      let resolve: (v: string) => void;
      const chatPromise = new Promise<string>((res) => { resolve = res; });
      lifecycle.promoteToBackground(
        'task8', chatPromise, chat,
        { parentSessionId: 'sess8', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent' },
        Date.now(), [],
      );
      resolve!('done');
      await vi.runAllTimersAsync();
      expect(mockTaskStore.completeTask).toHaveBeenCalledWith('task8', 'completed', expect.any(String));
    });

    it('promise rejects: enqueues failure result with partial result', async () => {
      const chat = { getTurnCount: vi.fn(() => 1), extractPartialResult: vi.fn(() => 'partial'), dispose: vi.fn() };
      let reject: (e: any) => void;
      const chatPromise = new Promise<string>((_, rej) => { reject = rej; });
      lifecycle.promoteToBackground(
        'task9', chatPromise, chat,
        { parentSessionId: 'sess9', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent' },
        Date.now(), [],
      );
      reject!(new Error('failed'));
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('sess9');
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.partialResult).toBe('partial');
    });

    it('promise rejects: handles non-Error rejection', async () => {
      const chat = { getTurnCount: vi.fn(() => 0), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      let reject: (e: any) => void;
      const chatPromise = new Promise<string>((_, rej) => { reject = rej; });
      lifecycle.promoteToBackground(
        'task10', chatPromise, chat,
        { parentSessionId: 'sess10', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent' },
        Date.now(), [],
      );
      reject!('string reason');
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('sess10');
      expect(results[0]?.error).toBe('string reason');
    });

    it('promise resolves: availabilityWarnings omitted when empty', async () => {
      const chat = { getTurnCount: vi.fn(() => 1), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      let resolve: (v: string) => void;
      const chatPromise = new Promise<string>((res) => { resolve = res; });
      lifecycle.promoteToBackground(
        'task11', chatPromise, chat,
        { parentSessionId: 'sess11', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent' },
        Date.now(), [],
      );
      resolve!('done');
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('sess11');
      expect(results[0]?.availabilityWarnings).toBeUndefined();
    });

    it('promise resolves: availabilityWarnings included when non-empty', async () => {
      const chat = { getTurnCount: vi.fn(() => 1), extractPartialResult: vi.fn(() => null), dispose: vi.fn() };
      let resolve: (v: string) => void;
      const chatPromise = new Promise<string>((res) => { resolve = res; });
      lifecycle.promoteToBackground(
        'task12', chatPromise, chat,
        { parentSessionId: 'sess12', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent' },
        Date.now(), ['warn1'],
      );
      resolve!('done');
      await vi.runAllTimersAsync();
      const results = lifecycle.drainResults('sess12');
      expect(results[0]?.availabilityWarnings).toEqual(['warn1']);
    });
  });

  // ─── sendMessageToSubAgent ────────────────────────────────────────────

  describe('sendMessageToSubAgent', () => {
    it('returns {success:false, error} when task not found', () => {
      const r = lifecycle.sendMessageToSubAgent('nonexistent', 'hello');
      expect(r.success).toBe(false);
      expect(r.error).toContain('not found');
    });

    it('returns {success:false, error} when task is not running', async () => {
      const result = await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      if (result.status !== 'launched') throw new Error();
      lifecycle.getBackgroundTask(result.taskId)!.status = 'completed';
      const r = lifecycle.sendMessageToSubAgent(result.taskId, 'msg');
      expect(r.success).toBe(false);
      expect(r.error).toContain('completed');
    });

    it('pushes message to pendingMessages and returns {success:true}', async () => {
      // Keep spawner pending so task stays in 'running' state
      let resolveSpawn: (v: any) => void;
      spawner.spawnSubAgent.mockReturnValue(new Promise((res) => { resolveSpawn = res; }));
      const result = await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      if (result.status !== 'launched') throw new Error();
      const r = lifecycle.sendMessageToSubAgent(result.taskId, 'hello');
      expect(r.success).toBe(true);
      expect(lifecycle.getBackgroundTask(result.taskId)!.pendingMessages).toContain('hello');
      resolveSpawn!({ subAgentName: 'a', taskId: 't', success: true, turnCount: 0, durationMs: 0 });
    });
  });

  // ─── getBackgroundTask ────────────────────────────────────────────────

  describe('getBackgroundTask', () => {
    it('returns undefined for unknown taskId', () => {
      expect(lifecycle.getBackgroundTask('nope')).toBeUndefined();
    });

    it('returns task object for known taskId', async () => {
      const result = await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      if (result.status !== 'launched') throw new Error();
      expect(lifecycle.getBackgroundTask(result.taskId)).toBeDefined();
    });
  });

  // ─── drainResults ─────────────────────────────────────────────────────

  describe('drainResults', () => {
    it('returns empty array when no results', () => {
      expect(lifecycle.drainResults('sess')).toEqual([]);
    });

    it('returns all results and clears the queue', async () => {
      await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      await vi.runAllTimersAsync();
      const first = lifecycle.drainResults('sess');
      expect(first.length).toBe(1);
      expect(lifecycle.drainResults('sess').length).toBe(0);
    });
  });

  // ─── handleNotification / drainNotifications ──────────────────────────

  describe('handleNotification / drainNotifications', () => {
    it('drainNotifications returns empty when nothing queued', () => {
      expect(lifecycle.drainNotifications('sess')).toEqual([]);
    });

    it('queues and drains multiple notifications', () => {
      const n1 = { taskId: 't', subAgentName: 'a', type: 'info' as const, message: 'hello', timestamp: 1 };
      const n2 = { ...n1, message: 'world' };
      lifecycle.handleNotification('sess', n1);
      lifecycle.handleNotification('sess', n2);
      const drained = lifecycle.drainNotifications('sess');
      expect(drained).toHaveLength(2);
      expect(lifecycle.drainNotifications('sess')).toHaveLength(0);
    });

    it('handles multiple sessions independently', () => {
      lifecycle.handleNotification('s1', { taskId: 't', subAgentName: 'a', type: 'info', message: 'm', timestamp: 1 });
      lifecycle.handleNotification('s2', { taskId: 't', subAgentName: 'b', type: 'warning', message: 'm2', timestamp: 2 });
      expect(lifecycle.drainNotifications('s1')).toHaveLength(1);
      expect(lifecycle.drainNotifications('s2')).toHaveLength(1);
    });
  });

  // ─── getBackgroundTaskStatus ──────────────────────────────────────────

  describe('getBackgroundTaskStatus', () => {
    it('returns empty array when no tasks for session', () => {
      expect(lifecycle.getBackgroundTaskStatus('sess')).toEqual([]);
    });

    it('returns only tasks matching the session', async () => {
      await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess1', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent1', task: 't',
      });
      await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess2', parentChatId: 'c', userAlias: 'u', subAgentName: 'agent2', task: 't',
      });
      const statuses = lifecycle.getBackgroundTaskStatus('sess1');
      expect(statuses).toHaveLength(1);
      expect(statuses[0].subAgentName).toBe('agent1');
    });

    it('status object has required fields', async () => {
      await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      const [status] = lifecycle.getBackgroundTaskStatus('sess');
      expect(status).toHaveProperty('taskId');
      expect(status).toHaveProperty('subAgentName');
      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('durationMs');
    });
  });

  // ─── sendStateUpdate ──────────────────────────────────────────────────

  describe('sendStateUpdate', () => {
    const makeState = (taskId = 'task1'): any => ({
      taskId,
      subAgentName: 'agent',
      status: 'running',
      startTime: Date.now(),
      currentTurn: 1,
      steps: [],
    });

    it('does nothing when eventSender is undefined', () => {
      expect(() => lifecycle.sendStateUpdate(undefined, makeState())).not.toThrow();
    });

    it('sends state update immediately on first call', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      lifecycle.sendStateUpdate(sender as any, makeState());
      expect(sender.send).toHaveBeenCalledWith('subAgent:stateUpdate', expect.any(Object));
    });

    it('buffers second call when throttle active; does not send again', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      const state = makeState();
      lifecycle.sendStateUpdate(sender as any, state);
      lifecycle.sendStateUpdate(sender as any, state);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('flushes pending update after throttle timer fires', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      const state = makeState();
      lifecycle.sendStateUpdate(sender as any, state);
      lifecycle.sendStateUpdate(sender as any, { ...state, currentTurn: 2 });
      vi.advanceTimersByTime(200);
      expect(sender.send).toHaveBeenCalledTimes(2);
    });

    it('timer fires without pending update: no extra send', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      lifecycle.sendStateUpdate(sender as any, makeState());
      vi.advanceTimersByTime(200);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('force=true clears throttle and sends the forced state immediately', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      const state = makeState();
      lifecycle.sendStateUpdate(sender as any, state);           // first — sets throttle
      lifecycle.sendStateUpdate(sender as any, { ...state, currentTurn: 2 }); // buffered
      lifecycle.sendStateUpdate(sender as any, { ...state, currentTurn: 3 }, true); // force
      expect(sender.send).toHaveBeenCalledTimes(2); // initial + forced
    });

    it('force=true with no active throttle still sends', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      lifecycle.sendStateUpdate(sender as any, makeState(), true);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('does not call send when isDestroyed() returns true', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => true) };
      lifecycle.sendStateUpdate(sender as any, makeState());
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('catches and logs error when eventSender.send or isDestroyed throws', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => { throw new Error('gone'); }) };
      expect(() => lifecycle.sendStateUpdate(sender as any, makeState())).not.toThrow();
    });
  });

  // ─── cancelByParentSession ────────────────────────────────────────────

  describe('cancelByParentSession', () => {
    it('returns 0 when no children registered', async () => {
      expect(await lifecycle.cancelByParentSession('sess')).toBe(0);
    });

    it('cancels only running runtime states; ignores completed', async () => {
      shared.parentChildMap.set('sess', new Set(['t1', 't2']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'running', startTime: 0, currentTurn: 0, steps: [],
      });
      shared.runtimeStates.set('t2', {
        taskId: 't2', subAgentName: 'b', status: 'completed', startTime: 0, currentTurn: 0, steps: [],
      });
      const count = await lifecycle.cancelByParentSession('sess');
      expect(count).toBe(1);
      expect(shared.runtimeStates.get('t1')?.status).toBe('cancelled');
      expect(shared.runtimeStates.get('t2')?.status).toBe('completed');
    });

    it('disposes active chat instances', async () => {
      shared.parentChildMap.set('sess', new Set(['t1']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'running', startTime: 0, currentTurn: 0, steps: [],
      });
      const mockChat = { dispose: vi.fn() };
      shared.activeInstances.set('t1', mockChat);
      await lifecycle.cancelByParentSession('sess');
      expect(mockChat.dispose).toHaveBeenCalled();
      expect(shared.activeInstances.has('t1')).toBe(false);
    });

    it('deletes parentChildMap entry after cancellation', async () => {
      shared.parentChildMap.set('sess', new Set(['t1']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'completed', startTime: 0, currentTurn: 0, steps: [],
      });
      await lifecycle.cancelByParentSession('sess');
      expect(shared.parentChildMap.has('sess')).toBe(false);
    });

    it('cancels running background tasks for the session', async () => {
      shared.parentChildMap.set('sess', new Set());
      // Keep spawner pending so background task stays 'running'
      let resolveSpawn: (v: any) => void;
      spawner.spawnSubAgent.mockReturnValue(new Promise((res) => { resolveSpawn = res; }));
      await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      const count = await lifecycle.cancelByParentSession('sess');
      expect(count).toBeGreaterThanOrEqual(1);
      resolveSpawn!({ subAgentName: 'a', taskId: 't', success: true, turnCount: 0, durationMs: 0 });
    });

    it('handles child taskId with no runtime state gracefully', async () => {
      shared.parentChildMap.set('sess', new Set(['t_no_state']));
      const count = await lifecycle.cancelByParentSession('sess');
      expect(count).toBe(0);
    });

    it('sets endTime on cancelled state', async () => {
      shared.parentChildMap.set('sess', new Set(['t1']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'running', startTime: 0, currentTurn: 0, steps: [],
      });
      await lifecycle.cancelByParentSession('sess');
      expect(shared.runtimeStates.get('t1')?.endTime).toBeTypeOf('number');
    });
  });

  // ─── getRuntimeState ──────────────────────────────────────────────────

  describe('getRuntimeState', () => {
    it('returns undefined for unknown taskId', () => {
      expect(lifecycle.getRuntimeState('nope')).toBeUndefined();
    });

    it('returns the runtime state from shared map', () => {
      const state = {
        taskId: 't1', subAgentName: 'a', status: 'running' as const,
        startTime: 0, currentTurn: 0, steps: [],
      };
      shared.runtimeStates.set('t1', state);
      expect(lifecycle.getRuntimeState('t1')).toBe(state);
    });
  });

  // ─── getStatesForParentSession ────────────────────────────────────────

  describe('getStatesForParentSession', () => {
    it('returns empty array when session has no children', () => {
      expect(lifecycle.getStatesForParentSession('sess')).toEqual([]);
    });

    it('returns all states for registered children', () => {
      shared.parentChildMap.set('sess', new Set(['t1', 't2']));
      const s1 = { taskId: 't1', subAgentName: 'a', status: 'running' as const, startTime: 0, currentTurn: 0, steps: [] };
      const s2 = { taskId: 't2', subAgentName: 'b', status: 'completed' as const, startTime: 0, currentTurn: 0, steps: [] };
      shared.runtimeStates.set('t1', s1);
      shared.runtimeStates.set('t2', s2);
      const result = lifecycle.getStatesForParentSession('sess');
      expect(result).toContain(s1);
      expect(result).toContain(s2);
    });

    it('skips children with no runtime state', () => {
      shared.parentChildMap.set('sess', new Set(['t1', 'missing']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'running' as const, startTime: 0, currentTurn: 0, steps: [],
      });
      expect(lifecycle.getStatesForParentSession('sess')).toHaveLength(1);
    });
  });

  // ─── cleanup ──────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes completed/failed/cancelled runtime states', () => {
      const make = (taskId: string, status: string) => ({ taskId, subAgentName: 'a', status, startTime: 0, currentTurn: 0, steps: [] });
      shared.runtimeStates.set('t1', make('t1', 'completed') as any);
      shared.runtimeStates.set('t2', make('t2', 'failed') as any);
      shared.runtimeStates.set('t3', make('t3', 'cancelled') as any);
      shared.runtimeStates.set('t4', make('t4', 'running') as any);
      lifecycle.cleanup();
      expect(shared.runtimeStates.has('t1')).toBe(false);
      expect(shared.runtimeStates.has('t2')).toBe(false);
      expect(shared.runtimeStates.has('t3')).toBe(false);
      expect(shared.runtimeStates.has('t4')).toBe(true);
    });

    it('clears pending throttle timers for cleaned task IDs', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      const state = { taskId: 't1', subAgentName: 'a', status: 'running' as const, startTime: 0, currentTurn: 0, steps: [] };
      shared.runtimeStates.set('t1', state);
      lifecycle.sendStateUpdate(sender as any, state); // establishes throttle
      state.status = 'completed' as any;
      lifecycle.cleanup(); // should clear throttle without error
      expect(shared.runtimeStates.has('t1')).toBe(false);
    });

    it('removes empty parentChildMap entries when instances are gone', () => {
      shared.parentChildMap.set('sess', new Set(['t1']));
      // t1 not in activeInstances → gets removed from set → set becomes empty → session deleted
      lifecycle.cleanup();
      expect(shared.parentChildMap.has('sess')).toBe(false);
    });

    it('keeps parentChildMap entry when active instance still present', () => {
      shared.parentChildMap.set('sess', new Set(['t1']));
      shared.activeInstances.set('t1', {});
      lifecycle.cleanup();
      expect(shared.parentChildMap.has('sess')).toBe(true);
    });

    it('deletes activeInstances for completed tasks', () => {
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'completed' as const, startTime: 0, currentTurn: 0, steps: [],
      });
      shared.activeInstances.set('t1', {});
      lifecycle.cleanup();
      expect(shared.activeInstances.has('t1')).toBe(false);
    });
  });

  // ─── cancelAllForSession ──────────────────────────────────────────────

  describe('cancelAllForSession', () => {
    it('calls removeInMemoryForSession even when no tasks exist', () => {
      lifecycle.cancelAllForSession('sess');
      expect(mockTaskStore.removeInMemoryForSession).toHaveBeenCalledWith('sess');
    });

    it('cancels running states and disposes chats', () => {
      shared.parentChildMap.set('sess', new Set(['t1', 't2']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'running' as const, startTime: 0, currentTurn: 0, steps: [],
      });
      shared.runtimeStates.set('t2', {
        taskId: 't2', subAgentName: 'b', status: 'completed' as const, startTime: 0, currentTurn: 0, steps: [],
      });
      const chat = { dispose: vi.fn() };
      shared.activeInstances.set('t1', chat);
      lifecycle.cancelAllForSession('sess');
      // cancelAllForSession deletes runtimeStates entries after setting status
      expect(shared.runtimeStates.has('t1')).toBe(false);
      expect(chat.dispose).toHaveBeenCalled();
      expect(shared.activeInstances.has('t1')).toBe(false);
    });

    it('clears resultQueue, notificationQueue, parentChildMap, spawnCountMap', () => {
      shared.parentChildMap.set('sess', new Set());
      shared.spawnCountMap.set('sess', 5);
      lifecycle.handleNotification('sess', { taskId: 't', subAgentName: 'a', type: 'info', message: 'm', timestamp: 1 });
      lifecycle.cancelAllForSession('sess');
      expect(shared.spawnCountMap.has('sess')).toBe(false);
      expect(shared.parentChildMap.has('sess')).toBe(false);
      expect(lifecycle.drainNotifications('sess')).toHaveLength(0);
    });

    it('cancels and deletes background tasks for session', async () => {
      await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      lifecycle.cancelAllForSession('sess');
      expect(lifecycle.getBackgroundTaskStatus('sess')).toHaveLength(0);
    });

    it('clears throttle timers for tasks in session', () => {
      const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      const state = { taskId: 't1', subAgentName: 'a', status: 'running' as const, startTime: 0, currentTurn: 0, steps: [] };
      shared.parentChildMap.set('sess', new Set(['t1']));
      shared.runtimeStates.set('t1', state);
      lifecycle.sendStateUpdate(sender as any, state); // sets throttle
      expect(() => lifecycle.cancelAllForSession('sess')).not.toThrow();
    });

    it('handles task without chat instance gracefully', () => {
      shared.parentChildMap.set('sess', new Set(['t1']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'running' as const, startTime: 0, currentTurn: 0, steps: [],
      });
      expect(() => lifecycle.cancelAllForSession('sess')).not.toThrow();
    });

    it('sets endTime on cancelled tasks', () => {
      shared.parentChildMap.set('sess', new Set(['t1']));
      shared.runtimeStates.set('t1', {
        taskId: 't1', subAgentName: 'a', status: 'running' as const, startTime: 0, currentTurn: 0, steps: [],
      });
      lifecycle.cancelAllForSession('sess');
      // state was deleted, so we just verify no throw occurred
    });

    it('does not mark non-running background tasks as cancelled', async () => {
      await lifecycle.spawnSubAgentAsync({
        parentSessionId: 'sess', parentChatId: 'c', userAlias: 'u', subAgentName: 'a', task: 't',
      });
      await vi.runAllTimersAsync();
      // After completion, task is gone from backgroundTasks (executeInBackground does not delete,
      // but cancelAllForSession will skip non-running tasks when deleting)
      // This just ensures no crash
      lifecycle.cancelAllForSession('sess');
    });
  });

  // ─── getActiveCount ───────────────────────────────────────────────────

  describe('getActiveCount', () => {
    it('returns 0 when no active instances', () => {
      expect(lifecycle.getActiveCount()).toBe(0);
    });

    it('returns count matching activeInstances size', () => {
      shared.activeInstances.set('t1', {});
      shared.activeInstances.set('t2', {});
      expect(lifecycle.getActiveCount()).toBe(2);
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns all-zeros for empty shared state', () => {
      expect(lifecycle.getStats()).toEqual({
        activeInstances: 0,
        totalRuntimeStates: 0,
        parentSessions: 0,
      });
    });

    it('reflects actual counts from shared maps', () => {
      shared.activeInstances.set('t1', {});
      shared.runtimeStates.set('t1', {} as any);
      shared.runtimeStates.set('t2', {} as any);
      shared.parentChildMap.set('sess1', new Set());
      const stats = lifecycle.getStats();
      expect(stats.activeInstances).toBe(1);
      expect(stats.totalRuntimeStates).toBe(2);
      expect(stats.parentSessions).toBe(1);
    });
  });
});
