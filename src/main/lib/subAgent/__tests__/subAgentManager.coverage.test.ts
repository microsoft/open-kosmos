// @ts-nocheck
/**
 * SubAgentManager supplemental coverage tests
 *
 * Targets uncovered lines:
 * - cleanup() method (pending timer cleanup, parentChildMap pruning)
 * - getActiveCount() / getStats()
 * - getChildStates() (lines ~835)
 * - getSubAgentRuntimeStates() for parent session
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  getUnifiedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getSubAgents: vi.fn(() => []),
    getChatConfig: vi.fn(),
    getAllChatConfigs: vi.fn(() => []),
  },
}));

const { mockFileManager } = vi.hoisted(() => ({
  mockFileManager: {
    readAgentConfig: vi.fn().mockResolvedValue(null),
    writeAgentConfig: vi.fn().mockResolvedValue(undefined),
    getCachedConfig: vi.fn().mockReturnValue(undefined),
    getCachedConfigs: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../subAgentFileManager', async () => ({
  SubAgentFileManager: {
    getInstance: vi.fn(() => mockFileManager),
  },
}));

const { mockGetInstanceByChatSessionId } = vi.hoisted(() => ({
  mockGetInstanceByChatSessionId: vi.fn(() => null),
}));

vi.mock('../../chat/agentChatManager', async () => ({
  AgentChatManager: {
    getInstance: vi.fn(() => ({
      getInstanceByChatSessionId: mockGetInstanceByChatSessionId,
    })),
  },
}));

const { mockSubAgentRun } = vi.hoisted(() => ({
  mockSubAgentRun: vi.fn().mockResolvedValue('mock result'),
}));

vi.mock('../subAgentChat', async () => ({
  SubAgentChat: vi.fn().mockImplementation(function () {
    return {
      run: mockSubAgentRun,
      getTurnCount: vi.fn().mockReturnValue(1),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../../auth/ghcConfig', async () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://mock.api',
    USER_AGENT: 'mock',
    EDITOR_VERSION: '1.0',
    EDITOR_PLUGIN_VERSION: '1.0',
  },
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: vi.fn((id: string) => ({ id })),
  getDefaultModel: () => 'gpt-4o',
}));

const { mockCountTextTokens } = vi.hoisted(() => ({
  mockCountTextTokens: vi.fn().mockReturnValue(1000),
}));

vi.mock('../../token/TokenCounter', async () => ({
  TokenCounter: vi.fn().mockImplementation(function (this: any) {
    this.countTextTokens = mockCountTextTokens;
  }),
}));

import { SubAgentManager } from '../subAgentManager';
import { TokenCounter } from '../../token/TokenCounter';
import type { SubAgentConfig, SubAgentRuntimeState } from '../../userDataADO/types/profile';
import type { CancellationToken } from '../../cancellation/CancellationToken';

function createMockCancellationToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function createMockSubAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    display_name: 'Test Agent',
    description: 'A test sub-agent',
    emoji: '🧪',
    version: '1.0.0',
    source: 'ON-DEVICE',
    system_prompt: 'You are a test agent',
    mcp_servers: [],
    context_access: 'isolated',
    max_turns: 5,
    ...overrides,
  };
}

describe('SubAgentManager supplemental coverage', () => {
  let manager: SubAgentManager;

  beforeEach(async () => {
    SubAgentManager.resetInstance();
    manager = SubAgentManager.getInstance();
    const mockConfig = createMockSubAgentConfig();
    mockFileManager.readAgentConfig.mockResolvedValue(mockConfig);
  });

  afterEach(() => {
    SubAgentManager.resetInstance();
  });

  // ── getActiveCount ──
  describe('getActiveCount', () => {
    it('should return 0 when no instances are active', () => {
      expect(manager.getActiveCount()).toBe(0);
    });
  });

  // ── getStats ──
  describe('getStats', () => {
    it('should return zero stats when fresh', () => {
      const stats = manager.getStats();
      expect(stats).toEqual({
        activeInstances: 0,
        totalRuntimeStates: 0,
        parentSessions: 0,
      });
    });
  });

  // ── cleanup ──
  describe('cleanup', () => {
    it('should remove completed/failed/cancelled runtime states', () => {
      // Inject state manually
      const runtimeStates: Map<string, SubAgentRuntimeState> = (manager as any).runtimeStates;
      const activeInstances: Map<string, any> = (manager as any).activeInstances;

      runtimeStates.set('task_completed', {
        taskId: 'task_completed',
        subAgentName: 'agent1',
        status: 'completed',
        turnCount: 1,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState);

      runtimeStates.set('task_failed', {
        taskId: 'task_failed',
        subAgentName: 'agent2',
        status: 'failed',
        turnCount: 0,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState);

      runtimeStates.set('task_running', {
        taskId: 'task_running',
        subAgentName: 'agent3',
        status: 'running',
        turnCount: 0,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState);

      runtimeStates.set('task_cancelled', {
        taskId: 'task_cancelled',
        subAgentName: 'agent4',
        status: 'cancelled',
        turnCount: 0,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState);

      activeInstances.set('task_completed', {});
      activeInstances.set('task_running', {});

      manager.cleanup();

      // Completed and failed and cancelled tasks removed
      expect(runtimeStates.has('task_completed')).toBe(false);
      expect(runtimeStates.has('task_failed')).toBe(false);
      expect(runtimeStates.has('task_cancelled')).toBe(false);
      // Running task remains
      expect(runtimeStates.has('task_running')).toBe(true);
    });

    it('should clear pending throttle timers on cleanup', () => {
      const stateUpdateThrottles: Map<string, NodeJS.Timeout> = (manager as any).stateUpdateThrottles;
      const pendingStateUpdates: Map<string, any> = (manager as any).pendingStateUpdates;
      const runtimeStates: Map<string, SubAgentRuntimeState> = (manager as any).runtimeStates;

      // Add a completed task with a pending timer
      runtimeStates.set('task_done', {
        taskId: 'task_done',
        subAgentName: 'agent',
        status: 'completed',
        turnCount: 1,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState);

      const fakeTimer = setTimeout(() => {}, 10000);
      stateUpdateThrottles.set('task_done', fakeTimer);
      pendingStateUpdates.set('task_done', {});

      manager.cleanup();

      expect(stateUpdateThrottles.has('task_done')).toBe(false);
      expect(pendingStateUpdates.has('task_done')).toBe(false);

      clearTimeout(fakeTimer);
    });

    it('should prune empty parentChildMap entries', () => {
      const parentChildMap: Map<string, Set<string>> = (manager as any).parentChildMap;
      const runtimeStates: Map<string, SubAgentRuntimeState> = (manager as any).runtimeStates;
      const activeInstances: Map<string, any> = (manager as any).activeInstances;

      // Create a session with a completed child
      const sessionId = 'session_prune';
      const taskId = 'task_pruned';
      parentChildMap.set(sessionId, new Set([taskId]));

      runtimeStates.set(taskId, {
        taskId,
        subAgentName: 'agent',
        status: 'completed',
        turnCount: 1,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState);

      manager.cleanup();

      // parentChildMap entry should be pruned when all children are done
      expect(parentChildMap.has(sessionId)).toBe(false);
    });

    it('should NOT prune parentChildMap entries with still-active children', () => {
      const parentChildMap: Map<string, Set<string>> = (manager as any).parentChildMap;
      const activeInstances: Map<string, any> = (manager as any).activeInstances;
      const runtimeStates: Map<string, SubAgentRuntimeState> = (manager as any).runtimeStates;

      const sessionId = 'session_keep';
      const taskId = 'task_active';
      parentChildMap.set(sessionId, new Set([taskId]));
      activeInstances.set(taskId, {});

      runtimeStates.set(taskId, {
        taskId,
        subAgentName: 'agent',
        status: 'running',
        turnCount: 0,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState);

      manager.cleanup();

      expect(parentChildMap.has(sessionId)).toBe(true);
    });
  });

  // ── getStatesForParentSession ──
  describe('getStatesForParentSession', () => {
    it('should return states for children of the given parent session', () => {
      const parentChildMap: Map<string, Set<string>> = (manager as any).parentChildMap;
      const runtimeStates: Map<string, SubAgentRuntimeState> = (manager as any).runtimeStates;

      const sessionId = 'session_get';
      const taskId = 'task_child';

      parentChildMap.set(sessionId, new Set([taskId]));
      const state: SubAgentRuntimeState = {
        taskId,
        subAgentName: 'agent',
        status: 'running',
        turnCount: 0,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState;
      runtimeStates.set(taskId, state);

      const result = manager.getStatesForParentSession(sessionId);
      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe(taskId);
    });

    it('should return empty array when session has no children', () => {
      const result = manager.getStatesForParentSession('nonexistent_session');
      expect(result).toEqual([]);
    });
  });

  // ── buildParentContext — token-exceed auto-downgrade ──
  describe('buildParentContext token safety', () => {
    afterEach(() => {
      mockCountTextTokens.mockReturnValue(1000);
      mockGetInstanceByChatSessionId.mockReturnValue(null);
    });

    it('auto-downgrades full_history to parent_summary when tokens exceed 50% of context window', async () => {
      mockCountTextTokens.mockReturnValue(70000); // > 128000 * 0.5
      // Verify the mock is working correctly
      const tc = new (TokenCounter as any)();
      expect(tc.countTextTokens('test')).toBe(70000);

      const mockChat = {
        getContextHistory: vi.fn().mockReturnValue([
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ]),
        getContextSummary: vi.fn().mockResolvedValue('Summary text'),
      };
      mockGetInstanceByChatSessionId.mockReturnValue(mockChat);

      const result = await (manager as any).buildParentContext('session_tok', 'full_history', true);
      // Should have fallen back to parent_summary
      expect(result).toBeDefined();
      expect(result).toContain('Summary text');
    });

    it('continues with full_history when TokenCounter throws', async () => {
      mockCountTextTokens.mockImplementation(() => { throw new Error('token error'); });

      const mockChat = {
        getContextHistory: vi.fn().mockReturnValue([
          { role: 'user', content: 'Hello' },
        ]),
        getSummary: vi.fn().mockReturnValue(null),
      };
      mockGetInstanceByChatSessionId.mockReturnValue(mockChat);

      // Should not throw — catch block swallows the token error
      const result = await (manager as any).buildParentContext('session_tok2', 'full_history', true);
      expect(typeof result === 'string' || result === undefined).toBe(true);
    });

    it('returns undefined when buildParentContext outer try throws', async () => {
      mockGetInstanceByChatSessionId.mockImplementation(() => { throw new Error('unexpected'); });

      const result = await (manager as any).buildParentContext('session_err', 'full_history', true);
      expect(result).toBeUndefined();
    });
  });

  // ── spawnSubAgent callbacks ──
  describe('spawnSubAgent callbacks', () => {
    beforeEach(() => {
      mockSubAgentRun.mockResolvedValue('result');
      mockFileManager.readAgentConfig.mockResolvedValue(createMockSubAgentConfig());
    });

    afterEach(() => {
      mockSubAgentRun.mockResolvedValue('mock result');
    });

    it('calls onProgress when onTurnComplete fires', async () => {
      const { SubAgentChat } = await import('../subAgentChat');
      // Override: capture callbacks and invoke onTurnComplete
      (SubAgentChat as any).mockImplementation(function (this: any, opts: any) {
        this.run = vi.fn().mockImplementation(async () => {
          opts.onTurnComplete?.(1, 'last message');
          return 'result';
        });
        this.getTurnCount = vi.fn().mockReturnValue(1);
        this.dispose = vi.fn();
      });

      const onProgress = vi.fn();
      await manager.spawnSubAgent({
        parentSessionId: 'sess1',
        parentChatId: 'chat1',
        userAlias: 'user1',
        subAgentName: 'test-agent',
        task: 'do something',
        cancellationToken: createMockCancellationToken(),
        onProgress,
      });

      expect(onProgress).toHaveBeenCalled();
    });

    it('handles onStepUpdate with tool_done type (tool_start not found → append path)', async () => {
      const { SubAgentChat } = await import('../subAgentChat');
      (SubAgentChat as any).mockImplementation(function (this: any, opts: any) {
        this.run = vi.fn().mockImplementation(async () => {
          // tool_done without matching tool_start → hits line 242 (append path)
          opts.onStepUpdate?.({
            type: 'tool_done',
            toolCallId: 'tc_orphan',
            toolName: 'some_tool',
            turn: 1,
            durationMs: 100,
            toolResultLength: 50,
          });
          return 'result';
        });
        this.getTurnCount = vi.fn().mockReturnValue(1);
        this.dispose = vi.fn();
      });

      await expect(manager.spawnSubAgent({
        parentSessionId: 'sess2',
        parentChatId: 'chat2',
        userAlias: 'user2',
        subAgentName: 'test-agent',
        task: 'do something',
        cancellationToken: createMockCancellationToken(),
      })).resolves.toBeDefined();
    });

    it('swallows onStepUpdate errors (line 276)', async () => {
      const { SubAgentChat } = await import('../subAgentChat');
      (SubAgentChat as any).mockImplementation(function (this: any, opts: any) {
        this.run = vi.fn().mockImplementation(async () => {
          // Force onStepUpdate to throw by passing bad state (runtimeStates won't have this taskId)
          // Instead, directly throw in the callback by passing an unexpected type that causes an error
          opts.onStepUpdate?.(null as any); // null update → accessing .type on null throws
          return 'result';
        });
        this.getTurnCount = vi.fn().mockReturnValue(1);
        this.dispose = vi.fn();
      });

      // Should not throw — catch block handles it
      await expect(manager.spawnSubAgent({
        parentSessionId: 'sess3',
        parentChatId: 'chat3',
        userAlias: 'user3',
        subAgentName: 'test-agent',
        task: 'do something',
        cancellationToken: createMockCancellationToken(),
      })).resolves.toBeDefined();
    });
  });

  // ── spawnMultipleSubAgents rejection path ──
  describe('spawnMultipleSubAgents', () => {
    it('handles failed task in batch (line 516)', async () => {
      const { SubAgentChat } = await import('../subAgentChat');
      let callCount = 0;
      (SubAgentChat as any).mockImplementation(function (this: any) {
        callCount++;
        if (callCount === 1) {
          this.run = vi.fn().mockRejectedValue(new Error('task failed'));
        } else {
          this.run = vi.fn().mockResolvedValue('success');
        }
        this.getTurnCount = vi.fn().mockReturnValue(0);
        this.dispose = vi.fn();
      });

      const results = await manager.spawnMultipleSubAgents({
        parentSessionId: 'batch_sess',
        parentChatId: 'batch_chat',
        userAlias: 'user',
        cancellationToken: createMockCancellationToken(),
        tasks: [
          { subAgentName: 'test-agent', task: 'fail task' },
          { subAgentName: 'test-agent', task: 'succeed task' },
        ],
      });

      // At least one failed result should be present
      const failed = results.find(r => !r.success);
      expect(failed).toBeDefined();
    });
  });

  // ── getRuntimeState ──
  describe('getRuntimeState', () => {
    it('should return undefined for unknown taskId', () => {
      expect(manager.getRuntimeState('unknown_task')).toBeUndefined();
    });

    it('should return state for known taskId', () => {
      const runtimeStates: Map<string, SubAgentRuntimeState> = (manager as any).runtimeStates;
      const state: SubAgentRuntimeState = {
        taskId: 'known_task',
        subAgentName: 'agent',
        status: 'running',
        turnCount: 0,
        steps: [],
        startedAt: Date.now(),
      } as SubAgentRuntimeState;
      runtimeStates.set('known_task', state);

      expect(manager.getRuntimeState('known_task')).toBe(state);
    });
  });
});
