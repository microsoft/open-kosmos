/**
 * CodingAgentTool unit tests
 *
 * Covers: argument validation, CLI discovery, stream-json parsing,
 * spawn orchestration (timeout, truncation, exit codes), partial result
 * streaming, and tool definition schema.
 */

import { EventEmitter } from 'events';

// ─── Mocks ───────────────────────────────────────────────────────────

const { mockExecSync, mockSpawn, mockEventSender } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockSpawn: vi.fn(),
  mockEventSender: { send: vi.fn() },
}));

vi.mock('../../../unifiedLogger', async () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('child_process', async () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('fs', async () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getExecutionContext: vi.fn().mockReturnValue({
      eventSender: mockEventSender,
      currentToolCallId: 'tc_test_123',
      chatId: 'chat_1',
      chatSessionId: 'session_1',
    }),
  },
}));

import { CodingAgentTool } from '../codingAgentTool';
import * as fs from 'fs';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Create a mock child process with controllable stdout/stderr/stdin */
function createMockChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { end: vi.fn() };
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    pid: 12345,
    kill: vi.fn(),
  });
  return child;
}

/** Build a stream-json line for a text_delta event */
function textDeltaLine(text: string): string {
  return JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    },
  });
}

/** Build a stream-json line for a result event */
function resultLine(resultText: string): string {
  return JSON.stringify({ type: 'result', result: resultText });
}

const validArgs = { task: 'fix the bug', cwd: '/tmp/project' };

// ─── Tests ───────────────────────────────────────────────────────────

describe('CodingAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (fs.existsSync as Mock).mockReturnValue(true);
    mockExecSync.mockReturnValue('/usr/local/bin/claude\n');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── extractStreamText (private, tested via execute output) ──

  describe('extractStreamText', () => {
    // Access private static method for direct unit testing
    const extract = (json: string) => (CodingAgentTool as any).extractStreamText(json);

    it('extracts text from content_block_delta', () => {
      const result = extract(textDeltaLine('hello'));
      expect(result).toEqual({ text: 'hello', isResult: false, resultText: null });
    });

    it('extracts result text from result event', () => {
      const result = extract(resultLine('final output'));
      expect(result).toEqual({ text: null, isResult: true, resultText: 'final output' });
    });

    it('returns nulls for unrecognized event types', () => {
      const result = extract(JSON.stringify({ type: 'system', data: 'init' }));
      expect(result).toEqual({ text: null, isResult: false, resultText: null });
    });

    it('returns nulls for invalid JSON', () => {
      const result = extract('not json {{{');
      expect(result).toEqual({ text: null, isResult: false, resultText: null });
    });

    it('returns nulls for content_block_delta with non-text_delta type', () => {
      const json = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{}' },
        },
      });
      expect(extract(json)).toEqual({ text: null, isResult: false, resultText: null });
    });

    it('returns nulls for result event with non-string result', () => {
      const json = JSON.stringify({ type: 'result', result: 42 });
      expect(extract(json)).toEqual({ text: null, isResult: false, resultText: null });
    });
  });

  // ── buildClaudeArgs ──

  describe('buildClaudeArgs', () => {
    const buildArgs = (task: string) => (CodingAgentTool as any).buildClaudeArgs(task);

    it('includes required CLI flags', () => {
      const args = buildArgs('implement feature');
      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--verbose');
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('implement feature');
    });

    it('puts the task as the last argument', () => {
      const args = buildArgs('my task');
      expect(args[args.length - 1]).toBe('my task');
    });
  });

  // ── findCliPath ──

  describe('findCliPath', () => {
    const findCliPath = () => (CodingAgentTool as any).findCliPath();

    it('returns trimmed path when CLI is found', () => {
      mockExecSync.mockReturnValue('  /usr/local/bin/claude  \n');
      expect(findCliPath()).toBe('/usr/local/bin/claude');
    });

    it('returns first line when multiple paths returned', () => {
      mockExecSync.mockReturnValue('/usr/local/bin/claude\n/usr/bin/claude\n');
      expect(findCliPath()).toBe('/usr/local/bin/claude');
    });

    it('returns null when CLI is not found', () => {
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      expect(findCliPath()).toBeNull();
    });

    it('uses "where" on win32 and "which" otherwise', () => {
      const originalPlatform = process.platform;

      // Test the command string used — platform is read-only so we check the execSync call
      mockExecSync.mockReturnValue('/usr/local/bin/claude\n');
      findCliPath();

      const cmd = mockExecSync.mock.calls[0][0] as string;
      if (process.platform === 'win32') {
        expect(cmd).toBe('where claude');
      } else {
        expect(cmd).toBe('which claude');
      }
    });
  });

  // ── execute — validation ──

  describe('execute - validation', () => {
    it('returns error when task is empty', async () => {
      const result = await CodingAgentTool.execute({ task: '', cwd: '/tmp' });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('task must be a non-empty string');
    });

    it('returns error when task is whitespace-only', async () => {
      const result = await CodingAgentTool.execute({ task: '   ', cwd: '/tmp' });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('task must be a non-empty string');
    });

    it('returns error when cwd is empty', async () => {
      const result = await CodingAgentTool.execute({ task: 'do something', cwd: '' });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('cwd must be provided');
    });

    it('returns error when cwd does not exist', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      const result = await CodingAgentTool.execute({ task: 'do something', cwd: '/nonexistent' });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('cwd directory does not exist');
    });

    it('returns error when CLI is not found', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      const result = await CodingAgentTool.execute(validArgs);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Claude Code CLI not found');
    });
  });

  // ── execute — spawn and streaming ──

  describe('execute - spawn and streaming', () => {
    let mockChild: ReturnType<typeof createMockChild>;

    beforeEach(() => {
      mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
    });

    it('spawns claude with correct arguments and cwd', async () => {
      const promise = CodingAgentTool.execute(validArgs);

      // Let spawn happen
      await vi.advanceTimersByTimeAsync(0);

      // Emit output and close
      mockChild.stdout.emit('data', Buffer.from(textDeltaLine('hello') + '\n'));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.arrayContaining(['-p', '--output-format', 'stream-json', 'fix the bug']),
        expect.objectContaining({ cwd: expect.any(String), stdio: ['pipe', 'pipe', 'pipe'] })
      );
      expect(result.exitCode).toBe(0);
    });

    it('accumulates text_delta events into output', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.stdout.emit('data', Buffer.from(
        textDeltaLine('hello ') + '\n' + textDeltaLine('world') + '\n'
      ));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.output).toBe('hello world');
    });

    it('prefers result event text over accumulated deltas', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.stdout.emit('data', Buffer.from(
        textDeltaLine('partial') + '\n' + resultLine('complete final output') + '\n'
      ));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.output).toBe('complete final output');
    });

    it('handles split lines across multiple data chunks', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      const fullLine = textDeltaLine('split text');
      const half1 = fullLine.slice(0, 20);
      const half2 = fullLine.slice(20) + '\n';

      mockChild.stdout.emit('data', Buffer.from(half1));
      mockChild.stdout.emit('data', Buffer.from(half2));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.output).toBe('split text');
    });

    it('emits partial results via eventSender for streaming UI', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.stdout.emit('data', Buffer.from(textDeltaLine('streaming') + '\n'));
      mockChild.emit('close', 0);

      await promise;
      expect(mockEventSender.send).toHaveBeenCalledWith(
        'agentChat:streamingChunk',
        expect.objectContaining({
          type: 'tool_result',
          toolResult: expect.objectContaining({
            tool_name: 'coding_agent',
            isPartial: true,
          }),
        })
      );
    });

    it('closes stdin immediately after spawn', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      mockChild.emit('close', 0);
      await promise;

      expect(mockChild.stdin.end).toHaveBeenCalled();
    });

    it('returns non-zero exit code from child process', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.stdout.emit('data', Buffer.from(textDeltaLine('error output') + '\n'));
      mockChild.emit('close', 1);

      const result = await promise;
      expect(result.exitCode).toBe(1);
      expect(result.output).toBe('error output');
    });

    it('handles spawn error gracefully', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.emit('error', new Error('spawn ENOENT'));

      const result = await promise;
      expect(result.exitCode).toBe(1);
    });

    it('processes remaining lineBuf data on close', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      // Send data without trailing newline — sits in lineBuf until close
      mockChild.stdout.emit('data', Buffer.from(textDeltaLine('buffered')));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.output).toBe('buffered');
    });
  });

  // ── execute — timeout ──

  describe('execute - timeout', () => {
    let mockChild: ReturnType<typeof createMockChild>;

    beforeEach(() => {
      mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
    });

    it('kills process and returns timedOut on timeout', async () => {
      const promise = CodingAgentTool.execute({ ...validArgs, timeoutSeconds: 10 });
      await vi.advanceTimersByTimeAsync(0);

      // Advance past the 10s timeout
      vi.advanceTimersByTime(10_001);

      // The kill triggers close
      mockChild.emit('close', null);

      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('uses default timeout when not specified', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      // Default is 300s — should NOT time out at 299s
      vi.advanceTimersByTime(299_000);
      expect(mockChild.kill).not.toHaveBeenCalled();

      // Close normally
      mockChild.emit('close', 0);
      const result = await promise;
      expect(result.timedOut).toBe(false);
    });

    it('caps timeout at MAX_TIMEOUT_S (600s)', async () => {
      const promise = CodingAgentTool.execute({ ...validArgs, timeoutSeconds: 9999 });
      await vi.advanceTimersByTimeAsync(0);

      // Should not time out before 600s
      vi.advanceTimersByTime(599_000);
      expect(mockChild.kill).not.toHaveBeenCalled();

      // Should time out at 600s
      vi.advanceTimersByTime(2_000);
      mockChild.emit('close', null);

      const result = await promise;
      expect(result.timedOut).toBe(true);
    });

    it('normalizes invalid timeout to default', async () => {
      const promise = CodingAgentTool.execute({ ...validArgs, timeoutSeconds: -5 });
      await vi.advanceTimersByTimeAsync(0);

      // Should use default 300s — not time out immediately
      vi.advanceTimersByTime(100_000);
      expect(mockChild.kill).not.toHaveBeenCalled();

      mockChild.emit('close', 0);
      await promise;
    });
  });

  // ── execute — truncation ──

  describe('execute - output truncation', () => {
    let mockChild: ReturnType<typeof createMockChild>;

    beforeEach(() => {
      mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
    });

    it('truncates output exceeding MAX_OUTPUT_CHARS and sets truncated flag', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      // Send output that exceeds 50000 chars
      const bigText = 'x'.repeat(60000);
      mockChild.stdout.emit('data', Buffer.from(textDeltaLine(bigText) + '\n'));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.output.length).toBeLessThanOrEqual(50000);
      expect(result.truncated).toBe(true);
    });

    it('does not set truncated when output is within limit', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.stdout.emit('data', Buffer.from(textDeltaLine('short output') + '\n'));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.truncated).toBeUndefined();
    });
  });

  // ── execute — result shape ──

  describe('execute - result shape', () => {
    let mockChild: ReturnType<typeof createMockChild>;

    beforeEach(() => {
      mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
    });

    it('returns all expected fields in result', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.stdout.emit('data', Buffer.from(textDeltaLine('output') + '\n'));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result).toEqual(expect.objectContaining({
        task: 'fix the bug',
        output: 'output',
        exitCode: 0,
        timedOut: false,
        cwd: expect.any(String),
        durationMs: expect.any(Number),
      }));
    });

    it('trims output whitespace', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      mockChild.stdout.emit('data', Buffer.from(textDeltaLine('  padded  ') + '\n'));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.output).toBe('padded');
    });
  });

  // ── getDefinition ──

  describe('getDefinition', () => {
    const def = CodingAgentTool.getDefinition();

    it('has the correct tool name', () => {
      expect(def.name).toBe('coding_agent');
    });

    it('has a description mentioning Claude Code', () => {
      expect(def.description).toContain('Claude Code');
    });

    it('description does NOT mention Codex', () => {
      expect(def.description).not.toMatch(/codex/i);
    });

    it('has required properties: task and cwd', () => {
      expect(def.inputSchema.required).toEqual(['task', 'cwd']);
    });

    it('schema has exactly task, cwd, and timeoutSeconds properties', () => {
      const props = Object.keys(def.inputSchema.properties);
      expect(props).toEqual(expect.arrayContaining(['task', 'cwd', 'timeoutSeconds']));
      expect(props).toHaveLength(3);
    });

    it('does NOT have an agent property in schema', () => {
      expect(def.inputSchema.properties).not.toHaveProperty('agent');
    });
  });
});
