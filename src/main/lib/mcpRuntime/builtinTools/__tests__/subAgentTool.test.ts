/**
 * SubAgentTool — Unit tests
 *
 * Covers:
 * - getDefinition() schema correctness
 * - execute() — no context available
 * - execute() — recursion guard (isSubAgent)
 * - execute() — named agent path (sync + background)
 * - execute() — ad-hoc agent path (sync + background)
 * - execute() — named agent not found
 * - formatResult() — success, autoPromoted, failure, partialResult, availabilityWarnings
 * - Error handling (manager throws)
 */

import { SubAgentTool, SubAgentToolArgs } from '../subAgentTool';

// ─── Mock dependencies ───

const mockSpawnSubAgent = vi.fn();
const mockSpawnSubAgentAsync = vi.fn();
const mockSpawnAdhocSubAgent = vi.fn();

vi.mock('../../../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: () => ({
      spawnSubAgent: mockSpawnSubAgent,
      spawnSubAgentAsync: mockSpawnSubAgentAsync,
      spawnAdhocSubAgent: mockSpawnAdhocSubAgent,
    }),
  },
}));

vi.mock('../../../unifiedLogger', () => ({
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
      cancellationToken: { isCancelled: false },
      eventSender: { send: vi.fn() },
      getSubAgentConfig: vi.fn(),
    };
  });

  // ─── Schema ───

  describe('getDefinition', () => {
    it('returns correct tool name and schema', () => {
      const def = SubAgentTool.getDefinition();
      expect(def.name).toBe('sub_agent');
      expect(def.inputSchema.type).toBe('object');
      expect(def.inputSchema.required).toEqual(['prompt']);
      expect(def.inputSchema.properties).toHaveProperty('prompt');
      expect(def.inputSchema.properties).toHaveProperty('subagent_type');
      expect(def.inputSchema.properties).toHaveProperty('system_prompt');
      expect(def.inputSchema.properties).toHaveProperty('tools');
      expect(def.inputSchema.properties).toHaveProperty('model');
      expect(def.inputSchema.properties).toHaveProperty('run_in_background');
      expect(def.inputSchema.properties).toHaveProperty('no_auto_promote');
      expect(def.inputSchema.properties).toHaveProperty('description');
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

  // ─── Named agent path ───

  describe('execute — named agent (sync)', () => {
    const baseArgs: SubAgentToolArgs = {
      prompt: 'Research AI trends',
      subagent_type: 'researcher',
    };

    it('returns error when named agent not found', async () => {
      mockContext.getSubAgentConfig.mockReturnValue(null);
      const result = await SubAgentTool.execute(baseArgs);
      expect(result.success).toBe(false);
      expect(result.error).toContain('"researcher" not found');
    });

    it('spawns named agent with isolated context by default', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'researcher' });
      mockSpawnSubAgent.mockResolvedValue({
        success: true,
        result: 'Done',
        turnCount: 3,
        durationMs: 5000,
      });

      const result = await SubAgentTool.execute(baseArgs);
      expect(result.success).toBe(true);
      expect(result.data).toContain('researcher');
      expect(result.data).toContain('Done');
      expect(mockSpawnSubAgent).toHaveBeenCalledWith(expect.objectContaining({
        subAgentName: 'researcher',
        task: 'Research AI trends',
      }));
    });

    it('passes no_auto_promote to manager', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'researcher' });
      mockSpawnSubAgent.mockResolvedValue({ success: true, result: 'ok', turnCount: 1, durationMs: 1000 });

      await SubAgentTool.execute({ ...baseArgs, no_auto_promote: true });
      expect(mockSpawnSubAgent).toHaveBeenCalledWith(expect.objectContaining({
        noAutoPromote: true,
      }));
    });
  });

  // ─── Named agent background path ───

  describe('execute — named agent (background)', () => {
    it('spawns async and returns taskId', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'writer' });
      mockSpawnSubAgentAsync.mockResolvedValue({ taskId: 'task-123' });

      const result = await SubAgentTool.execute({
        prompt: 'Write a report',
        subagent_type: 'writer',
        run_in_background: true,
      });

      expect(result.success).toBe(true);
      expect(result.data).toContain('task-123');
      expect(result.data).toContain('background');
      expect(mockSpawnSubAgent).not.toHaveBeenCalled();
    });
  });

  // ─── Ad-hoc agent path ───

  describe('execute — ad-hoc agent (sync)', () => {
    it('spawns ad-hoc agent without subagent_type', async () => {
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
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'x', context_access: 'isolated' });
      mockSpawnSubAgent.mockResolvedValue({
        autoPromoted: true,
        result: 'Promoted to background (taskId: bg-1)',
      });

      const result = await SubAgentTool.execute({ prompt: 'test', subagent_type: 'x' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Promoted to background (taskId: bg-1)');
    });

    it('handles failure with partialResult', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'x', context_access: 'isolated' });
      mockSpawnSubAgent.mockResolvedValue({
        success: false,
        error: 'Timeout',
        partialResult: 'Got 3 of 5 items',
        turnCount: 10,
        durationMs: 120000,
      });

      const result = await SubAgentTool.execute({ prompt: 'test', subagent_type: 'x' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('partial results');
      expect(result.data).toContain('Got 3 of 5 items');
    });

    it('handles failure without partialResult', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'x', context_access: 'isolated' });
      mockSpawnSubAgent.mockResolvedValue({
        success: false,
        error: 'Agent crashed',
        turnCount: 1,
        durationMs: 500,
      });

      const result = await SubAgentTool.execute({ prompt: 'test', subagent_type: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent crashed');
    });

    it('includes availability warnings when present', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'x', context_access: 'isolated' });
      mockSpawnSubAgent.mockResolvedValue({
        success: true,
        result: 'Done',
        turnCount: 2,
        durationMs: 3000,
        availabilityWarnings: ['MCP server "github" was unavailable'],
      });

      const result = await SubAgentTool.execute({ prompt: 'test', subagent_type: 'x' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('reduced capabilities');
      expect(result.data).toContain('MCP server "github" was unavailable');
    });
  });

  // ─── Error handling ───

  describe('execute — error handling', () => {
    it('catches and wraps thrown errors', async () => {
      mockContext.getSubAgentConfig.mockImplementation(() => {
        throw new Error('Config read failed');
      });

      const result = await SubAgentTool.execute({ prompt: 'test', subagent_type: 'broken' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to spawn sub-agent');
      expect(result.error).toContain('Config read failed');
    });

    it('handles non-Error thrown values', async () => {
      mockContext.getSubAgentConfig.mockImplementation(() => {
        throw 'string error';
      });

      const result = await SubAgentTool.execute({ prompt: 'test', subagent_type: 'broken' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });
  });

  // ─── Background launch failure regression tests ───

  describe('execute — background launch failure handling', () => {
    it('returns error when named agent background launch fails', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'writer' });
      mockSpawnSubAgentAsync.mockResolvedValue({
        status: 'error',
        error: 'Queue full',
      });

      const result = await SubAgentTool.execute({
        prompt: 'Write a report',
        subagent_type: 'writer',
        run_in_background: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue full');
    });

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

    it('returns fallback error message when status=error but no error string', async () => {
      mockContext.getSubAgentConfig.mockReturnValue({ name: 'agent-x' });
      mockSpawnSubAgentAsync.mockResolvedValue({ status: 'error' });

      const result = await SubAgentTool.execute({
        prompt: 'test',
        subagent_type: 'agent-x',
        run_in_background: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to launch');
    });
  });
});
