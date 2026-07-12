/**
 * SubAgentTool — Unit tests
 *
 * Covers:
 * - getDefinition() schema correctness
 * - execute() — no context available
 * - execute() — recursion guard (isSubAgent)
 * - execute() — ad-hoc agent path (sync + background)
 * - formatResult() — success, autoPromoted, failure, partialResult, availabilityWarnings
 * - Error handling (manager throws)
 */

import { SubAgentTool, SubAgentToolArgs } from '../subAgentTool';

// ─── Mock dependencies ───

const mockSpawnSubAgentAsync = vi.fn();
const mockSpawnAdhocSubAgent = vi.fn();

vi.mock('../../../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: () => ({
      spawnSubAgentAsync: mockSpawnSubAgentAsync,
      spawnAdhocSubAgent: mockSpawnAdhocSubAgent,
    }),
  },
}));

vi.mock('../../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
  createConsoleLogger: vi.fn().mockResolvedValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ─── Mock execution context ───

let mockContext: any = null;

vi.mock('../builtinToolsManager', () => ({
  BuiltinToolsManager: {
    getExecutionContext: () => mockContext,
  },
}));

// ─── Tests ───

describe('SubAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      chatSessionId: 'session-1',
      chatId: 'chat-1',
      userAlias: 'testuser',
      isSubAgent: false,
      currentToolCallId: 'tc-1',
      cancellationToken: {
        isCancelled: false,
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
      },
      eventSender: { send: vi.fn() },
      reportActivity: vi.fn(),
    };
  });

  // ─── Schema ───

  describe('getDefinition', () => {
    it('returns ad-hoc sub-agent schema', () => {
      const def = SubAgentTool.getDefinition();
      expect(def.name).toBe('sub_agent');
      expect(def.inputSchema.type).toBe('object');
      expect(def.inputSchema.required).toEqual(['prompt']);
      expect(def.inputSchema.properties).toHaveProperty('prompt');
      expect(def.inputSchema.properties).toHaveProperty('system_prompt');
      expect(def.inputSchema.properties).toHaveProperty('tools');
      expect(def.inputSchema.properties).toHaveProperty('model');
      expect(def.inputSchema.properties).toHaveProperty('run_in_background');
      expect(def.inputSchema.properties).toHaveProperty('no_auto_promote');
      expect(def.inputSchema.properties).toHaveProperty('description');
      expect((def.inputSchema.properties.tools as any).description).toContain('inherit the parent MCP tools');
    });
  });

  // ─── No context ───

  describe('execute — no context', () => {
    it('returns error when no execution context is available', async () => {
      mockContext = null;
      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No execution context');
    });
  });

  // ─── Recursion guard ───

  describe('execute — recursion guard', () => {
    it('returns error when called from a sub-agent', async () => {
      mockContext.isSubAgent = true;
      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('recursion not allowed');
    });
  });

  // ─── Ad-hoc agent path ───

  describe('execute — ad-hoc agent (sync)', () => {
    it('spawns ad-hoc agent', async () => {
      mockSpawnAdhocSubAgent.mockResolvedValue({
        success: true,
        result: 'Research complete',
        turnCount: 5,
        durationMs: 8000,
        subAgentName: 'adhoc-12345',
      });

      const result = await SubAgentTool.execute({
        prompt: 'Research competitors',
        system_prompt: 'You are a research analyst',
        tools: ['web_search'],
        model: 'gpt-4o',
      });

      expect(result.success).toBe(true);
      expect(result.data).toContain('Research complete');
      expect(mockSpawnAdhocSubAgent).toHaveBeenCalledWith(expect.objectContaining({
        task: 'Research competitors',
        systemPrompt: 'You are a research analyst',
        tools: ['web_search'],
        model: 'gpt-4o',
      }));
    });

    it('passes reportActivity through onProgress for foreground ad-hoc sub-agents', async () => {
      mockSpawnAdhocSubAgent.mockImplementation(async (params) => {
        params.onProgress?.({ taskId: 'sa-adhoc', status: 'running' });
        return { success: true, result: 'ok', turnCount: 1, durationMs: 1000 };
      });

      await SubAgentTool.execute({ prompt: 'Analyze docs' });

      expect(mockContext.reportActivity).toHaveBeenCalledOnce();
    });

    it('reports activity when foreground ad-hoc sub-agent state updates are sent', async () => {
      mockSpawnAdhocSubAgent.mockImplementation(async (params) => {
        params.eventSender.send('subAgentTask:stateUpdate', { taskId: 'sa-adhoc' });
        return { success: true, result: 'ok', turnCount: 1, durationMs: 1000 };
      });

      await SubAgentTool.execute({ prompt: 'Analyze docs' });

      expect(mockContext.reportActivity).toHaveBeenCalledOnce();
      expect(mockContext.eventSender.send).toHaveBeenCalledWith('subAgentTask:stateUpdate', { taskId: 'sa-adhoc' });
    });

    it('links AbortSignal cancellation into foreground ad-hoc sub-agent token', async () => {
      const controller = new AbortController();
      mockSpawnAdhocSubAgent.mockImplementation(async (params) => {
        controller.abort();
        expect(params.cancellationToken.isCancellationRequested).toBe(true);
        return { success: false, error: 'cancelled', turnCount: 0, durationMs: 1000 };
      });

      await SubAgentTool.execute({ prompt: 'Analyze docs' }, { signal: controller.signal });
      expect(mockSpawnAdhocSubAgent).toHaveBeenCalledOnce();
    });
  });

  // ─── Ad-hoc agent background path ───

  describe('execute — ad-hoc agent (background)', () => {
    it('spawns async ad-hoc and returns taskId', async () => {
      mockSpawnSubAgentAsync.mockResolvedValue({ taskId: 'task-456' });

      const result = await SubAgentTool.execute({
        prompt: 'Long research task',
        run_in_background: true,
      });

      expect(result.success).toBe(true);
      expect(result.data).toContain('task-456');
      expect(result.data).toContain('Ad-hoc');
      expect(mockSpawnAdhocSubAgent).not.toHaveBeenCalled();
    });
  });

  // ─── Result formatting ───

  describe('formatResult — various outcomes', () => {
    it('handles autoPromoted result', async () => {
      mockSpawnAdhocSubAgent.mockResolvedValue({
        autoPromoted: true,
        result: 'Promoted to background (taskId: bg-1)',
      });

      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Promoted to background (taskId: bg-1)');
    });

    it('handles failure with partialResult', async () => {
      mockSpawnAdhocSubAgent.mockResolvedValue({
        success: false,
        error: 'Timeout',
        partialResult: 'Got 3 of 5 items',
        turnCount: 10,
        durationMs: 120000,
      });

      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('partial results');
      expect(result.data).toContain('Got 3 of 5 items');
    });

    it('handles failure without partialResult', async () => {
      mockSpawnAdhocSubAgent.mockResolvedValue({
        success: false,
        error: 'Agent crashed',
        turnCount: 1,
        durationMs: 500,
      });

      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent crashed');
    });

    it('includes availability warnings when present', async () => {
      mockSpawnAdhocSubAgent.mockResolvedValue({
        success: true,
        result: 'Done',
        turnCount: 2,
        durationMs: 3000,
        availabilityWarnings: ['MCP server "github" was unavailable'],
      });

      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('reduced capabilities');
      expect(result.data).toContain('MCP server "github" was unavailable');
    });
  });

  // ─── Error handling ───

  describe('execute — error handling', () => {
    it('catches and wraps thrown errors', async () => {
      mockSpawnAdhocSubAgent.mockRejectedValueOnce(new Error('Spawn failed'));

      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to spawn sub-agent');
      expect(result.error).toContain('Spawn failed');
    });

    it('handles non-Error thrown values', async () => {
      mockSpawnAdhocSubAgent.mockRejectedValueOnce('string error');

      const result = await SubAgentTool.execute({ prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });
  });

  // ─── Background launch failure regression tests ───

  describe('execute — background launch failure handling', () => {
    it('returns error when ad-hoc background launch fails', async () => {
      mockSpawnSubAgentAsync.mockResolvedValue({
        status: 'error',
        error: 'Model unavailable',
      });

      const result = await SubAgentTool.execute({
        prompt: 'Research task',
        run_in_background: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Model unavailable');
    });

    it('returns fallback error message when ad-hoc background status=error has no error string', async () => {
      mockSpawnSubAgentAsync.mockResolvedValue({ status: 'error' });

      const result = await SubAgentTool.execute({
        prompt: 'test',
        run_in_background: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to launch');
    });
  });

  // ─── Helper coverage: execution context, cancellation linking, activity proxy ───

  describe('execute — helpers', () => {
    it('uses an explicitly provided execution context over the ambient one', async () => {
      mockContext = null; // ambient context unavailable
      mockSpawnAdhocSubAgent.mockResolvedValue({ success: true, result: 'ok', turnCount: 1, durationMs: 1000 });

      const explicitContext = {
        chatSessionId: 'session-explicit',
        chatId: 'chat-explicit',
        userAlias: 'explicit',
        isSubAgent: false,
        currentToolCallId: 'tc-explicit',
        cancellationToken: {
          isCancellationRequested: false,
          onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
        },
        eventSender: { send: vi.fn() },
        reportActivity: vi.fn(),
      };

      const result = await SubAgentTool.execute({ prompt: 'task' }, { executionContext: explicitContext as any });

      expect(result.success).toBe(true);
      expect(mockSpawnAdhocSubAgent).toHaveBeenCalledWith(expect.objectContaining({
        parentSessionId: 'session-explicit',
        userAlias: 'explicit',
      }));
    });

    it('immediately cancels the linked token when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      let observedCancelled: boolean | undefined;
      mockSpawnAdhocSubAgent.mockImplementation(async (params) => {
        observedCancelled = params.cancellationToken.isCancellationRequested;
        return { success: true, result: 'ok', turnCount: 1, durationMs: 1000 };
      });

      const result = await SubAgentTool.execute({ prompt: 'task' }, { signal: controller.signal });

      expect(result.success).toBe(true);
      expect(observedCancelled).toBe(true);
    });

    it('passes an undefined event sender when the context has none', async () => {
      mockContext.eventSender = undefined;
      let observedSender: unknown = 'unset';
      mockSpawnAdhocSubAgent.mockImplementation(async (params) => {
        observedSender = params.eventSender;
        return { success: true, result: 'ok', turnCount: 1, durationMs: 1000 };
      });

      await SubAgentTool.execute({ prompt: 'task' });

      expect(observedSender).toBeUndefined();
    });

    it('proxies non-send properties of the event sender, binding functions', async () => {
      const extra = vi.fn(() => 'bound-result');
      mockContext.eventSender = { send: vi.fn(), label: 'sender-label', extra };
      let labelValue: unknown;
      let extraResult: unknown;
      mockSpawnAdhocSubAgent.mockImplementation(async (params) => {
        labelValue = params.eventSender.label;
        extraResult = params.eventSender.extra();
        return { success: true, result: 'ok', turnCount: 1, durationMs: 1000 };
      });

      await SubAgentTool.execute({ prompt: 'task' });

      expect(labelValue).toBe('sender-label');
      expect(extraResult).toBe('bound-result');
      expect(extra).toHaveBeenCalledOnce();
    });
  });
});
