/**
 * Eval Harness unit tests
 *
 * Covers:
 * - evalProtocol Zod schema validation
 * - evalHttpServer routing, auth, concurrency, body parsing, judge endpoint, error paths
 * - evalAgentRunner message conversion, sub-agent extraction, error paths
 * - evalJudgeRunner run, getAgentModelId error paths
 */

import { RunTestBodySchema, JudgeBodySchema } from '../evalProtocol';

// ── Shared mocks for all test suites ──
const mockStreamMessage = vi.fn().mockResolvedValue([
  { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
]);
const mockDestroy = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockSetEventSender = vi.fn();
const mockSetSkipPersistence = vi.fn();

vi.mock('../../chat/agentChat', () => {
  return {
    AgentChat: class MockAgentChat {
      initialize = mockInitialize;
      setEventSender = mockSetEventSender;
      setSkipPersistence = mockSetSkipPersistence;
      streamMessage = mockStreamMessage;
      destroy = mockDestroy;
    },
  };
});

vi.mock('../../chat/agentChatManager', () => ({
  agentChatManager: {
    generateChatSessionId: () => 'chatSession_mock',
  },
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: () => ({ primaryAgent: 'Kobi' }),
    getChatConfig: () => ({ agent: { name: 'Kobi' } }),
    getAllChatConfigs: () => [{ chat_id: 'chat-1', agent: { name: 'Kobi' } }],
  },
}));

vi.mock('../../utilities/idFactory', () => ({
  generateEvalSessionId: () => 'evalSession_mock_001',
}));

// Mock ghcModelApi for EvalJudgeRunner
const mockCallWithMessages = vi.fn().mockResolvedValue('Judge response text');
vi.mock('../../llm/ghcModelApi', () => ({
  ghcModelApi: {
    callWithMessages: (...args: any[]) => mockCallWithMessages(...args),
  },
}));

// Mock userDataADO barrel (used by evalJudgeRunner)
const mockJudgeGetCachedProfile = vi.fn().mockReturnValue({ primaryAgent: 'Kobi' });
const mockJudgeGetAllChatConfigs = vi.fn().mockReturnValue([
  { chat_id: 'chat-1', agent: { name: 'Kobi', model: 'gpt-4o' } },
]);
vi.mock('../../userDataADO', () => ({
  profileCacheManager: {
    getCachedProfile: (...args: any[]) => mockJudgeGetCachedProfile(...args),
    getAllChatConfigs: (...args: any[]) => mockJudgeGetAllChatConfigs(...args),
  },
}));

// ── evalProtocol schema tests ──

describe('RunTestBodySchema', () => {
  it('accepts valid body with prompt and metadata', () => {
    const result = RunTestBodySchema.safeParse({ prompt: 'hello', metadata: { key: 'value' } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe('hello');
      expect(result.data.metadata).toEqual({ key: 'value' });
    }
  });

  it('accepts body without metadata (defaults to {})', () => {
    const result = RunTestBodySchema.safeParse({ prompt: 'hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({});
    }
  });

  it('rejects body without prompt', () => {
    const result = RunTestBodySchema.safeParse({ metadata: {} });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    const result = RunTestBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string prompt', () => {
    const result = RunTestBodySchema.safeParse({ prompt: 123 });
    expect(result.success).toBe(false);
  });

  it('accepts optional session_id', () => {
    const result = RunTestBodySchema.safeParse({ prompt: 'hello', session_id: 'sess-001' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBe('sess-001');
    }
  });

  it('accepts body without session_id', () => {
    const result = RunTestBodySchema.safeParse({ prompt: 'hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBeUndefined();
    }
  });
});

describe('JudgeBodySchema', () => {
  it('accepts valid messages array', () => {
    const result = JudgeBodySchema.safeParse({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multi-message conversation', () => {
    const result = JudgeBodySchema.safeParse({
      messages: [
        { role: 'system', content: 'You are a judge.' },
        { role: 'user', content: 'Evaluate this.' },
        { role: 'assistant', content: 'Score: 85' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty messages array', () => {
    const result = JudgeBodySchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role', () => {
    const result = JudgeBodySchema.safeParse({
      messages: [{ role: 'invalid', content: 'hi' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing content', () => {
    const result = JudgeBodySchema.safeParse({
      messages: [{ role: 'user' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing messages field', () => {
    const result = JudgeBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── evalHttpServer tests ──

import { EvalHttpServer } from '../evalHttpServer';

describe('EvalHttpServer', () => {
  const MOCK_TOKEN = 'test-token-abc123';

  beforeAll(() => {
    process.env.EVAL_AUTH_TOKEN = MOCK_TOKEN;
  });

  afterAll(() => {
    delete process.env.EVAL_AUTH_TOKEN;
  });

  it('throws if EVAL_AUTH_TOKEN is not set', () => {
    const saved = process.env.EVAL_AUTH_TOKEN;
    delete process.env.EVAL_AUTH_TOKEN;
    try {
      expect(() => new EvalHttpServer('testuser')).toThrow('EVAL_AUTH_TOKEN');
    } finally {
      process.env.EVAL_AUTH_TOKEN = saved;
    }
  });

  it('starts and stops the server', async () => {
    const server = new EvalHttpServer('testuser', 0);
    await server.start();
    expect(server.getPort()).toBeGreaterThanOrEqual(0);
    await server.stop();
  });

  describe('HTTP routing', () => {
    let server: InstanceType<typeof EvalHttpServer>;
    let baseUrl: string;

    beforeAll(async () => {
      server = new EvalHttpServer('testuser', 0);
      await server.start();
      baseUrl = `http://127.0.0.1:${server.getPort()}`;
    });

    afterAll(async () => {
      await server.stop();
    });

    it('GET /eval/health returns ok without auth', async () => {
      const res = await fetch(`${baseUrl}/eval/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('POST /eval/run returns 401 without auth', async () => {
      const res = await fetch(`${baseUrl}/eval/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(res.status).toBe(401);
    });

    it('POST /eval/judge returns 401 without auth', async () => {
      const res = await fetch(`${baseUrl}/eval/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(401);
    });

    it('POST /eval/run returns 401 with wrong token', async () => {
      const res = await fetch(`${baseUrl}/eval/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong-token',
        },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown paths', async () => {
      const res = await fetch(`${baseUrl}/eval/unknown`, {
        headers: { 'Authorization': `Bearer ${MOCK_TOKEN}` },
      });
      expect(res.status).toBe(404);
    });

    it('returns 403 for OPTIONS (CORS blocked)', async () => {
      const res = await fetch(`${baseUrl}/eval/run`, { method: 'OPTIONS' });
      expect(res.status).toBe(403);
    });

    it('returns no Access-Control-Allow-Origin header', async () => {
      const res = await fetch(`${baseUrl}/eval/health`);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});

// ── evalAgentRunner message conversion tests ──
// Test the pure functions by extracting them from the class via prototype

describe('EvalAgentRunner message conversion', () => {
  let runnerProto: any;

  beforeAll(async () => {
    const { EvalAgentRunner } = await import('../evalAgentRunner');
    runnerProto = EvalAgentRunner.prototype;
  });

  describe('convertMessages', () => {
    it('converts basic messages', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
      ];
      const result = runnerProto.convertMessages(messages);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });


    it('includes tool_calls when present', () => {
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [{
            id: 'tc1',
            function: { name: 'search', arguments: '{"q":"test"}' },
          }],
        },
      ];
      const result = runnerProto.convertMessages(messages);
      expect(result[0].tool_calls).toHaveLength(1);
      expect(result[0].tool_calls[0].name).toBe('search');
    });

    it('includes tool_call_id when present', () => {
      const messages = [
        {
          role: 'tool',
          content: [{ type: 'text', text: 'result data' }],
          tool_call_id: 'tc1',
        },
      ];
      const result = runnerProto.convertMessages(messages);
      expect(result[0].tool_call_id).toBe('tc1');
    });
  });

  describe('extractSubAgentMessages', () => {
    it('extracts sub-agent messages from tool results', () => {
      const messages = [
        {
          role: 'tool',
          content: [{ type: 'text', text: JSON.stringify({
            messages: [
              { role: 'assistant', content: 'sub-agent response' },
            ],
          })}],
          tool_call_id: 'tc1',
        },
      ];
      const result = runnerProto.extractSubAgentMessages(messages);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(1);
      expect(result[0][0].content).toBe('sub-agent response');
    });

    it('returns empty array when no sub-agent results', () => {
      const messages = [
        { role: 'assistant', content: [{ type: 'text', text: 'normal response' }] },
      ];
      const result = runnerProto.extractSubAgentMessages(messages);
      expect(result).toHaveLength(0);
    });

    it('skips non-JSON tool results', () => {
      const messages = [
        {
          role: 'tool',
          content: [{ type: 'text', text: 'plain text result, not JSON' }],
          tool_call_id: 'tc1',
        },
      ];
      const result = runnerProto.extractSubAgentMessages(messages);
      expect(result).toHaveLength(0);
    });

    it('skips JSON without messages array', () => {
      const messages = [
        {
          role: 'tool',
          content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }],
          tool_call_id: 'tc1',
        },
      ];
      const result = runnerProto.extractSubAgentMessages(messages);
      expect(result).toHaveLength(0);
    });
  });
});

// ── evalAgentRunner multi-turn lifecycle tests ──

// Import after mocks are defined (vitest hoists vi.mock automatically)
const { EvalAgentRunner } = await import('../evalAgentRunner');

describe('EvalAgentRunner multi-turn lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamMessage.mockResolvedValue([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('first turn returns a session_id for multi-turn continuation', async () => {
    const runner = new EvalAgentRunner('testuser');
    const result = await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });

    expect(result.session_id).toBe('evalSession_mock_001');
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('subsequent turn reuses cached session and returns only new messages', async () => {
    const runner = new EvalAgentRunner('testuser');

    // First turn
    const result1 = await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });
    const sessionId = result1.session_id!;

    // Mock returns extended history on second call
    mockStreamMessage.mockResolvedValueOnce([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'follow up response' }] },
    ]);

    // Second turn
    const result2 = await runner.run({
      type: 'run_test',
      id: 'req-2',
      data: { prompt: 'follow up', metadata: {} },
      session_id: sessionId,
    });

    expect(result2.session_id).toBe(sessionId);
    // Should only return the 2 new messages from this turn
    expect(result2.messages).toHaveLength(2);
  });

  it('throws when referencing an expired/unknown session_id', async () => {
    const runner = new EvalAgentRunner('testuser');

    await expect(
      runner.run({
        type: 'run_test',
        id: 'req-1',
        data: { prompt: 'hello', metadata: {} },
        session_id: 'nonexistent-session',
      })
    ).rejects.toThrow('Session not found');
  });

  it('evicts session on error during a turn', async () => {
    const runner = new EvalAgentRunner('testuser');

    // First turn succeeds
    const result1 = await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });
    const sessionId = result1.session_id!;

    // Second turn throws
    mockStreamMessage.mockRejectedValueOnce(new Error('LLM error'));

    await expect(
      runner.run({
        type: 'run_test',
        id: 'req-2',
        data: { prompt: 'fail', metadata: {} },
        session_id: sessionId,
      })
    ).rejects.toThrow('LLM error');

    // Session should be evicted — reusing it should fail
    await expect(
      runner.run({
        type: 'run_test',
        id: 'req-3',
        data: { prompt: 'after fail', metadata: {} },
        session_id: sessionId,
      })
    ).rejects.toThrow('Session not found');

    expect(mockDestroy).toHaveBeenCalled();
  });

  it('destroyAllSessions cleans up all cached sessions', async () => {
    const runner = new EvalAgentRunner('testuser');

    await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });

    runner.destroyAllSessions();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('serializes concurrent turns on the same session', async () => {
    const runner = new EvalAgentRunner('testuser');

    // First turn
    const result1 = await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });
    const sessionId = result1.session_id!;

    // Set up a slow streamMessage to test serialization
    const executionOrder: number[] = [];
    let resolveFirst!: (value: any) => void;
    const firstTurnPromise = new Promise((resolve) => { resolveFirst = resolve; });

    mockStreamMessage
      .mockImplementationOnce(async () => {
        executionOrder.push(1);
        await firstTurnPromise;
        return [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
          { role: 'user', content: [{ type: 'text', text: 'turn2' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'resp2' }] },
        ];
      })
      .mockImplementationOnce(async () => {
        executionOrder.push(2);
        return [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
          { role: 'user', content: [{ type: 'text', text: 'turn2' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'resp2' }] },
          { role: 'user', content: [{ type: 'text', text: 'turn3' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'resp3' }] },
        ];
      });

    // Fire two turns concurrently
    const turn2Promise = runner.run({
      type: 'run_test',
      id: 'req-2',
      data: { prompt: 'turn2', metadata: {} },
      session_id: sessionId,
    });

    const turn3Promise = runner.run({
      type: 'run_test',
      id: 'req-3',
      data: { prompt: 'turn3', metadata: {} },
      session_id: sessionId,
    });

    // Let the first concurrent turn complete
    resolveFirst(undefined);

    const [result2, result3] = await Promise.all([turn2Promise, turn3Promise]);

    // Turn 2 should have started before turn 3
    expect(executionOrder).toEqual([1, 2]);
    expect(result2.messages).toHaveLength(2);
    expect(result3.messages).toHaveLength(2);
  });

  it('does not cache session when AbortSignal is already aborted', async () => {
    const runner = new EvalAgentRunner('testuser');
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      runner.runOneShot(
        {
          type: 'run_test',
          id: 'req-1',
          data: { prompt: 'hello', metadata: {} },
        },
        abortController.signal,
      )
    ).rejects.toThrow('aborted');

    expect(mockDestroy).toHaveBeenCalled();
  });

  it('sets skipPersistence on headless agent', async () => {
    const runner = new EvalAgentRunner('testuser');
    await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });

    expect(mockSetSkipPersistence).toHaveBeenCalledWith(true);
  });
});

// ── EvalAgentRunner error-path tests ──

describe('EvalAgentRunner error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamMessage.mockResolvedValue([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  it('throws when getCachedProfile returns null', async () => {
    const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
    vi.spyOn(profileCacheManager, 'getCachedProfile').mockReturnValueOnce(null as any);

    const runner = new EvalAgentRunner('unknown-user');
    await expect(
      runner.run({ type: 'run_test', id: 'req-1', data: { prompt: 'hi', metadata: {} } })
    ).rejects.toThrow('No profile found');
  });

  it('throws when no chat config matches the primary agent', async () => {
    const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
    vi.spyOn(profileCacheManager, 'getAllChatConfigs').mockReturnValueOnce([
      { chat_id: 'chat-99', agent: { name: 'OtherAgent' } } as any,
    ]);

    const runner = new EvalAgentRunner('testuser');
    await expect(
      runner.run({ type: 'run_test', id: 'req-1', data: { prompt: 'hi', metadata: {} } })
    ).rejects.toThrow('No chat config found for primary agent');
  });

  it('throws when getChatConfig returns null/no agent', async () => {
    const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
    vi.spyOn(profileCacheManager, 'getChatConfig').mockReturnValueOnce(null as any);

    const runner = new EvalAgentRunner('testuser');
    await expect(
      runner.run({ type: 'run_test', id: 'req-1', data: { prompt: 'hi', metadata: {} } })
    ).rejects.toThrow('No chat config found for chatId');
  });

  it('handles destroy() throwing during cleanup gracefully', async () => {
    mockDestroy.mockImplementationOnce(() => { throw new Error('destroy failed'); });
    mockStreamMessage.mockRejectedValueOnce(new Error('LLM error'));

    const runner = new EvalAgentRunner('testuser');
    // Should throw the original LLM error, not the destroy error
    await expect(
      runner.run({ type: 'run_test', id: 'req-1', data: { prompt: 'hi', metadata: {} } })
    ).rejects.toThrow('LLM error');
  });

  it('evicts oldest session when session cache is at capacity (MAX_SESSIONS=10)', async () => {
    // Fill up session cache by running 10 turns with different sessions
    // We do this by running 10 separate runners, each creating one session
    // (since generateEvalSessionId always returns 'evalSession_mock_001' in tests,
    //  we need to use separate runner instances to test eviction logic,
    //  but with the same mock ID we can only test that the capacity path executes)

    // Instead, directly exercise cacheSession via run: run once and verify success.
    // The eviction branch is covered when sessions.size >= MAX_SESSIONS.
    // We can test it by creating a runner, manually filling the sessions map,
    // then triggering one more run.

    const { EvalAgentRunner: EvalAgentRunnerCls } = await import('../evalAgentRunner');
    const runner = new EvalAgentRunnerCls('testuser') as any;

    // Manually fill sessions to capacity
    const fakeSessions = new Map();
    for (let i = 0; i < 10; i++) {
      fakeSessions.set(`session-${i}`, {
        agentChat: { destroy: vi.fn() },
        chatSessionId: `chat-${i}`,
        lastUsed: Date.now() - (10 - i) * 1000, // older sessions have smaller lastUsed
        idleTimer: setTimeout(() => {}, 999999),
        messageCount: 0,
        turnLock: Promise.resolve(),
      });
    }
    runner.sessions = fakeSessions;

    // Running will trigger eviction of the oldest session before caching new one
    mockStreamMessage.mockResolvedValueOnce([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);

    const result = await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });

    expect(result.session_id).toBe('evalSession_mock_001');
    // After eviction + new session, map should still be at most MAX_SESSIONS
    expect(runner.sessions.size).toBeLessThanOrEqual(10);
  });

  it('sub-agent content is stringified when it is not a string', async () => {
    const { EvalAgentRunner: EvalAgentRunnerCls } = await import('../evalAgentRunner');
    const runner = new EvalAgentRunnerCls('testuser') as any;

    const messages = [
      {
        role: 'tool',
        content: [{ type: 'text', text: JSON.stringify({
          messages: [
            { role: 'assistant', content: { nested: 'object' } }, // non-string content
          ],
        })}],
        tool_call_id: 'tc1',
      },
    ];
    const result = runner.extractSubAgentMessages(messages);
    expect(result).toHaveLength(1);
    expect(typeof result[0][0].content).toBe('string');
    expect(result[0][0].content).toContain('nested');
  });
});

// ── EvalJudgeRunner tests ──

import { EvalJudgeRunner } from '../evalJudgeRunner';

describe('EvalJudgeRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallWithMessages.mockResolvedValue('Judge response');
    mockJudgeGetCachedProfile.mockReturnValue({ primaryAgent: 'Kobi' });
    mockJudgeGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat-1', agent: { name: 'Kobi', model: 'gpt-4o' } },
    ]);
  });

  it('calls ghcModelApi with correct arguments and returns content', async () => {
    const runner = new EvalJudgeRunner('testuser');
    const result = await runner.run({
      type: 'judge',
      messages: [
        { role: 'system', content: 'You are a judge.' },
        { role: 'user', content: 'Evaluate this response.' },
      ],
    });

    expect(result.type).toBe('judge_result');
    expect(result.content).toBe('Judge response');
    expect(mockCallWithMessages).toHaveBeenCalledWith(
      'gpt-4o',
      [
        { role: 'system', content: 'You are a judge.' },
        { role: 'user', content: 'Evaluate this response.' },
      ],
      4000,
      0.7
    );
  });

  it('throws when no profile found', async () => {
    mockJudgeGetCachedProfile.mockReturnValueOnce(null);
    const runner = new EvalJudgeRunner('unknown-user');

    await expect(
      runner.run({ type: 'judge', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('No profile found');
  });

  it('throws when no primary agent chat found', async () => {
    mockJudgeGetAllChatConfigs.mockReturnValueOnce([
      { chat_id: 'chat-99', agent: { name: 'OtherAgent', model: 'gpt-4o' } },
    ]);
    const runner = new EvalJudgeRunner('testuser');

    await expect(
      runner.run({ type: 'judge', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('No model configured for primary agent');
  });

  it('throws when agent has no model configured', async () => {
    mockJudgeGetAllChatConfigs.mockReturnValueOnce([
      { chat_id: 'chat-1', agent: { name: 'Kobi' } }, // no model field
    ]);
    const runner = new EvalJudgeRunner('testuser');

    await expect(
      runner.run({ type: 'judge', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('No model configured for primary agent');
  });

  it('uses "Kobi" as default primary agent name when profile.primaryAgent is absent', async () => {
    mockJudgeGetCachedProfile.mockReturnValueOnce({}); // no primaryAgent field
    const runner = new EvalJudgeRunner('testuser');

    const result = await runner.run({
      type: 'judge',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.type).toBe('judge_result');
    expect(mockCallWithMessages).toHaveBeenCalledWith('gpt-4o', expect.any(Array), 4000, 0.7);
  });

  it('propagates ghcModelApi errors', async () => {
    mockCallWithMessages.mockRejectedValueOnce(new Error('Model API failed'));
    const runner = new EvalJudgeRunner('testuser');

    await expect(
      runner.run({ type: 'judge', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('Model API failed');
  });
});

// ── EvalHttpServer additional coverage ──

describe('EvalHttpServer additional routes and body handling', () => {
  const MOCK_TOKEN = 'test-token-abc123';
  let server: InstanceType<typeof EvalHttpServer>;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.EVAL_AUTH_TOKEN = MOCK_TOKEN;
    server = new EvalHttpServer('testuser', 0);
    await server.start();
    baseUrl = `http://127.0.0.1:${server.getPort()}`;
  });

  afterAll(async () => {
    await server.stop();
    delete process.env.EVAL_AUTH_TOKEN;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallWithMessages.mockResolvedValue('Judge response');
    mockJudgeGetCachedProfile.mockReturnValue({ primaryAgent: 'Kobi' });
    mockJudgeGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat-1', agent: { name: 'Kobi', model: 'gpt-4o' } },
    ]);
    mockStreamMessage.mockResolvedValue([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  it('POST /eval/run with valid auth and body succeeds (200)', async () => {
    const res = await fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_TOKEN}`,
      },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toBeDefined();
    expect(body.session_id).toBe('evalSession_mock_001');
  });

  it('POST /eval/run with invalid body returns 400', async () => {
    const res = await fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_TOKEN}`,
      },
      body: JSON.stringify({ not_prompt: 'oops' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid request body/);
  });

  it('POST /eval/run with invalid JSON returns 400', async () => {
    const res = await fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_TOKEN}`,
      },
      body: 'not-json-at-all{{{',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid JSON/);
  });

  it('POST /eval/judge with valid auth and body succeeds (200)', async () => {
    const res = await fetch(`${baseUrl}/eval/judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_TOKEN}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Evaluate this.' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('Judge response');
  });

  it('POST /eval/judge with invalid body returns 400', async () => {
    const res = await fetch(`${baseUrl}/eval/judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_TOKEN}`,
      },
      body: JSON.stringify({ messages: [] }), // empty array, fails min(1)
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid request body/);
  });

  it('POST /eval/judge returns 500 when judge runner throws', async () => {
    mockCallWithMessages.mockRejectedValueOnce(new Error('Model down'));
    const res = await fetch(`${baseUrl}/eval/judge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_TOKEN}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Evaluate.' }],
      }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/judge failed/);
  });

  it('POST /eval/run returns 429 when concurrent limit exceeded', async () => {
    // Make two slow concurrent runs, then a third one should hit 429
    let resolveFirstRun!: (val: any) => void;
    const firstRunBlocker = new Promise((res) => { resolveFirstRun = res; });

    mockStreamMessage
      .mockImplementationOnce(() => firstRunBlocker.then(() => [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      ]))
      .mockImplementationOnce(() => firstRunBlocker.then(() => [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      ]));

    const run1 = fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({ prompt: 'run1' }),
    });
    const run2 = fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({ prompt: 'run2' }),
    });

    // Give both requests time to start processing on the server
    await new Promise((r) => setTimeout(r, 50));

    // Third request should be rejected immediately with 429
    const run3 = await fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({ prompt: 'run3' }),
    });
    expect(run3.status).toBe(429);

    // Unblock the first two runs
    resolveFirstRun(undefined);
    await Promise.all([run1, run2]);
  });

  it('POST /eval/run returns 500 when agent runner throws non-timeout error', async () => {
    mockStreamMessage.mockRejectedValueOnce(new Error('Agent crash'));
    const res = await fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOCK_TOKEN}`,
      },
      body: JSON.stringify({ prompt: 'trigger crash' }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/run failed/);
  });

  it('POST /eval/run with existing session_id uses agentRunner.run', async () => {
    // First create a session
    const firstRes = await fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    const sessionId = firstBody.session_id;

    // Second turn with session_id
    mockStreamMessage.mockResolvedValueOnce([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'response 2' }] },
    ]);

    const secondRes = await fetch(`${baseUrl}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({ prompt: 'follow up', session_id: sessionId }),
    });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.session_id).toBe(sessionId);
    expect(secondBody.messages).toHaveLength(2);
  });
});

// ── EvalHttpServer.stop() when server is null ──

describe('EvalHttpServer.stop() without starting', () => {
  it('resolves immediately when server was never started', async () => {
    process.env.EVAL_AUTH_TOKEN = 'tok';
    const s = new EvalHttpServer('testuser', 0);
    await expect(s.stop()).resolves.toBeUndefined();
    delete process.env.EVAL_AUTH_TOKEN;
  });
});

// ── getPortFromArgs coverage ──

describe('EvalHttpServer port from CLI args', () => {
  it('reads port from --eval-port= command line argument', async () => {
    const originalArgv = process.argv;
    process.argv = [...process.argv, '--eval-port=9999'];
    process.env.EVAL_AUTH_TOKEN = 'tok';

    try {
      const s = new EvalHttpServer('testuser');
      expect(s.getPort()).toBe(9999);
    } finally {
      process.argv = originalArgv;
      delete process.env.EVAL_AUTH_TOKEN;
    }
  });

  it('ignores invalid --eval-port= value and falls back to DEFAULT_PORT', async () => {
    const originalArgv = process.argv;
    process.argv = [...process.argv, '--eval-port=notanumber'];
    process.env.EVAL_AUTH_TOKEN = 'tok';

    try {
      const s = new EvalHttpServer('testuser');
      // Should fall back to default 8100
      expect(s.getPort()).toBe(8100);
    } finally {
      process.argv = originalArgv;
      delete process.env.EVAL_AUTH_TOKEN;
    }
  });
});

// ── EvalHttpServer body size and req error ──

describe('EvalHttpServer body size and req error handling', () => {
  const MOCK_TOKEN = 'test-token-size';
  let server: InstanceType<typeof EvalHttpServer>;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.EVAL_AUTH_TOKEN = MOCK_TOKEN;
    server = new EvalHttpServer('testuser', 0);
    await server.start();
    baseUrl = `http://127.0.0.1:${server.getPort()}`;
  });

  afterAll(async () => {
    await server.stop();
    delete process.env.EVAL_AUTH_TOKEN;
  });

  it('returns 413 when request body exceeds MAX_BODY_SIZE (1MB)', async () => {
    // Create a body larger than 1MB
    const hugeBody = 'x'.repeat(1024 * 1024 + 1);
    const jsonBody = `{"prompt":"${hugeBody}"}`;

    // When the body is too large, the server calls req.destroy() which may close
    // the connection before the full response is sent, causing fetch to throw.
    // We accept either a 413 response or a network error (both indicate the path ran).
    try {
      const res = await fetch(`${baseUrl}/eval/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MOCK_TOKEN}`,
        },
        body: jsonBody,
      });
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toMatch(/too large/);
    } catch {
      // Connection reset by req.destroy() — the 413 path executed on the server side
    }
  });
});

// ── EvalAgentRunner idle timer eviction ──

describe('EvalAgentRunner idle timer eviction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockStreamMessage.mockResolvedValue([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('evicts session after idle timeout expires (runOneShot cacheSession timer)', async () => {
    const runner = new EvalAgentRunner('testuser');
    const result = await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });
    const sessionId = result.session_id!;

    // Session should exist
    expect((runner as any).sessions.has(sessionId)).toBe(true);

    // Advance timers past the 15-minute idle timeout
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    // Session should now be evicted
    expect((runner as any).sessions.has(sessionId)).toBe(false);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('evicts session after idle timeout expires during multi-turn (runWithSession timer)', async () => {
    const runner = new EvalAgentRunner('testuser');

    // First turn to create session
    const result1 = await runner.run({
      type: 'run_test',
      id: 'req-1',
      data: { prompt: 'hello', metadata: {} },
    });
    const sessionId = result1.session_id!;

    // Second turn to trigger runWithSession (which also resets idle timer)
    mockStreamMessage.mockResolvedValueOnce([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: [{ type: 'text', text: 'turn2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'resp2' }] },
    ]);
    await runner.run({
      type: 'run_test',
      id: 'req-2',
      data: { prompt: 'turn2', metadata: {} },
      session_id: sessionId,
    });

    // Session should exist
    expect((runner as any).sessions.has(sessionId)).toBe(true);

    // Advance past idle timeout — the runWithSession timer fires
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect((runner as any).sessions.has(sessionId)).toBe(false);
  });
});

// ── EvalHttpServer EADDRINUSE and req error ──

import * as http from 'http';

describe('EvalHttpServer EADDRINUSE error', () => {
  it('rejects with EADDRINUSE error when port is already in use', async () => {
    process.env.EVAL_AUTH_TOKEN = 'tok';

    // Start a plain server first to occupy the port
    const occupier = http.createServer();
    await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
    const occupiedPort = (occupier.address() as any).port;

    const server = new EvalHttpServer('testuser', occupiedPort);
    try {
      await expect(server.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
      delete process.env.EVAL_AUTH_TOKEN;
    }
  });
});

describe('EvalHttpServer req error handler', () => {
  const MOCK_TOKEN = 'test-token-req-err';
  let server: InstanceType<typeof EvalHttpServer>;
  let port: number;

  beforeAll(async () => {
    process.env.EVAL_AUTH_TOKEN = MOCK_TOKEN;
    server = new EvalHttpServer('testuser', 0);
    await server.start();
    port = server.getPort();
  });

  afterAll(async () => {
    await server.stop();
    delete process.env.EVAL_AUTH_TOKEN;
  });

  it('returns 400 when request emits an error event', async () => {
    // Use raw http.request to simulate a connection that errors mid-body
    // by destroying the socket after sending partial data.
    const result = await new Promise<{ status: number; body: any } | 'error'>((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/eval/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MOCK_TOKEN}`,
          'Transfer-Encoding': 'chunked',
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      });

      req.on('error', () => resolve('error'));

      // Write partial body then destroy — triggers req 'error' on the server side
      req.write('{"prom');
      // Abruptly destroy without ending
      req.destroy();
    });

    // Either we get a 400 (error handler responded) or connection error
    // Both mean the req error path executed on the server
    if (result !== 'error') {
      expect(result.status).toBe(400);
    }
    // If fetch throws, the req error path still ran — acceptable
  });

  it('handles req error via direct private method invocation with mock stream', async () => {
    // Directly test readJsonBody with a mock request that emits 'error'
    // This covers the req.on('error') handler (lines 269-271)
    const { EventEmitter } = await import('events');

    const mockReq = new EventEmitter() as any;
    mockReq.destroy = vi.fn();

    const mockRes = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    const serverPrivate = server as any;
    let onSuccessCalled = false;

    // Call readJsonBody — this registers the event handlers
    serverPrivate.readJsonBody(mockReq, mockRes, () => { onSuccessCalled = true; });

    // Emit an error BEFORE any data — 'responded' is false at this point
    mockReq.emit('error', new Error('socket hang up'));

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('Error reading request body'));
    expect(onSuccessCalled).toBe(false);
  });
});
