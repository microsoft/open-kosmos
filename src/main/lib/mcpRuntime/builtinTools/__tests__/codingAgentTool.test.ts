/**
 * CodingAgentTool unit tests (adapter-driven, final-only design).
 *
 * Covers: CLI resolution (arg override / profile / default / error), argument validation,
 * availability detection + install-hint error, spawn orchestration (final extraction, truncation,
 * timeout, abort, heartbeat, stderr capture, errors), and the tool definition schema.
 */

import { EventEmitter } from 'events';

const { mockExecFile, mockSpawn, mockReadFileSync, mockEventSender, mockGetCurrentUserAlias, mockGetCodingAgentSettings } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockEventSender: { send: vi.fn() },
  mockGetCurrentUserAlias: vi.fn(),
  mockGetCodingAgentSettings: vi.fn(),
}));

vi.mock('../../../unifiedLogger', async () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('child_process', async () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('fs', async () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

vi.mock('../../../userDataADO', async () => ({
  profileCacheManager: {
    getCurrentUserAlias: (...args: any[]) => mockGetCurrentUserAlias(...args),
    getCodingAgentSettings: (...args: any[]) => mockGetCodingAgentSettings(...args),
  },
}));

import { CodingAgentTool } from '../codingAgentTool';
import { TOOL_IDLE_TIMEOUT_MS } from '../../toolTimeoutPolicy';
import * as fs from 'fs';

function createMockChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { end: vi.fn() };
  return Object.assign(new EventEmitter(), { stdout, stderr, stdin, pid: 4321, kill: vi.fn() });
}

const validArgs = { task: 'fix the bug', cwd: '/tmp/project' };
const originalPlatform = process.platform;

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function mockPathLookup(stdout: string) {
  mockExecFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, stdout, '');
  });
}

function mockPathLookupError(error: Error = new Error('not found')) {
  mockExecFile.mockImplementation((_command, _args, _options, callback) => {
    callback(error, '', '');
  });
}

function defaultContext(): any {
  return { eventSender: mockEventSender, currentToolCallId: 'tc1', chatId: 'c1', chatSessionId: 's1', userAlias: 'alice' };
}

describe('CodingAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Pin a non-win32 default so generic spawn tests are deterministic regardless of the host OS;
    // win32-specific tests opt in via setPlatform('win32'). afterEach restores the real platform.
    setPlatform('linux');
    (fs.existsSync as Mock).mockReturnValue(true);
    mockReadFileSync.mockReturnValue('@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    mockPathLookup('/usr/local/bin/claude\n');
    mockGetCurrentUserAlias.mockReturnValue('alice');
    mockGetCodingAgentSettings.mockReturnValue({ cli: 'claude' });
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.useRealTimers();
  });

  // ── resolveCliId ──────────────────────────────────────────────────────────

  describe('resolveCliId', () => {
    const resolve = (executionContext?: any) => (CodingAgentTool as any).resolveCliId(executionContext);

    it('reads the profile setting from the active alias', () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      expect(resolve()).toBe('codex');
    });

    it('reads the profile setting via getCurrentUserAlias when no execution context', () => {
      mockGetCurrentUserAlias.mockReturnValue('alice');
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'copilot' });
      expect(resolve()).toBe('copilot');
    });

    it('uses the captured execution context alias instead of the mutable active profile alias', () => {
      mockGetCurrentUserAlias.mockReturnValue('bob');
      mockGetCodingAgentSettings.mockImplementation((alias: string) => ({ cli: alias === 'alice' ? 'gemini' : 'codex' }));
      expect(resolve(defaultContext())).toBe('gemini');
      expect(mockGetCodingAgentSettings).toHaveBeenCalledWith('alice');
    });

    it('does not allow a model-supplied cli field to override the profile setting', async () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      const result = await CodingAgentTool.execute({ ...validArgs, cli: 'gemini' } as any);
      expect(result.cli).toBe('codex');
    });

    it('returns the default when no alias can be resolved', () => {
      mockGetCurrentUserAlias.mockReturnValue(null);
      expect(resolve()).toBe('claude');
    });

    it('returns the default when the profile setting is invalid', () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'nope' });
      expect(resolve()).toBe('claude');
    });

    it('returns the default when reading the profile throws', () => {
      mockGetCodingAgentSettings.mockImplementation(() => { throw new Error('boom'); });
      expect(resolve()).toBe('claude');
    });
  });

  // ── execute — validation ────────────────────────────────────────────────────

  describe('execute - validation', () => {
    it('returns error when task is empty', async () => {
      const result = await CodingAgentTool.execute({ task: '', cwd: '/tmp' });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('task must be a non-empty string');
      expect(result.cli).toBe('claude');
    });

    it('returns error when task is whitespace-only', async () => {
      const result = await CodingAgentTool.execute({ task: '   ', cwd: '/tmp' });
      expect(result.output).toContain('task must be a non-empty string');
    });

    it('returns error when cwd is empty', async () => {
      const result = await CodingAgentTool.execute({ task: 'do something', cwd: '' });
      expect(result.output).toContain('cwd must be provided');
    });

    it('returns error when cwd does not exist', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      const result = await CodingAgentTool.execute({ task: 'do something', cwd: '/nope' });
      expect(result.output).toContain('cwd directory does not exist');
    });

    it('returns an install-hint error when the CLI is not found', async () => {
      mockPathLookupError();
      const result = await CodingAgentTool.execute(validArgs);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Claude Code not found');
      expect(result.output).toContain('npm install -g @anthropic-ai/claude-code');
    });

    it('surfaces the selected CLI install hint (codex)', async () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      mockPathLookupError();
      const result = await CodingAgentTool.execute(validArgs);
      expect(result.output).toContain('Codex CLI not found');
      expect(result.output).toContain('npm install -g @openai/codex');
      expect(result.cli).toBe('codex');
    });
  });

  // ── execute — spawn / final extraction ──────────────────────────────────────

  describe('execute - spawn and final extraction', () => {
    let child: ReturnType<typeof createMockChild>;
    beforeEach(() => {
      child = createMockChild();
      mockSpawn.mockReturnValue(child);
    });

    it('spawns the resolved CLI with adapter args and returns the parsed final (claude JSON)', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result: 'all done' })));
      child.emit('close', 0);

      const result = await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.arrayContaining(['-p', '--output-format', 'json', '--dangerously-skip-permissions', 'fix the bug']),
        expect.objectContaining({
          cwd: expect.any(String),
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        }),
      );
      expect(result.output).toBe('all done');
      expect(result.exitCode).toBe(0);
      expect(result.cli).toBe('claude');
    });

    it('unwraps Windows npm .cmd shims and spawns node without a shell', async () => {
      setPlatform('win32');
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      mockPathLookup('C:\\bin\\codex.cmd\r\n');
      (fs.existsSync as Mock).mockImplementation((target: string) => !String(target).toLowerCase().endsWith('\\node.exe'));
      mockReadFileSync.mockReturnValue('@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%~dp0node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      child.stdout.emit('data', Buffer.from('done'));
      child.emit('close', 0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining(['C:\\bin\\node_modules\\@openai\\codex\\bin\\codex.js', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', 'fix the bug']),
        expect.objectContaining({ shell: false }),
      );
    });

    it('passes Windows shell metacharacters as data when using npm .cmd shims', async () => {
      setPlatform('win32');
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      mockPathLookup('C:\\bin\\codex.cmd\r\n');
      (fs.existsSync as Mock).mockImplementation((target: string) => !String(target).toLowerCase().endsWith('\\node.exe'));
      mockReadFileSync.mockReturnValue('@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%~dp0node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
      const task = 'fix&whoami|more<in>out %PATH%';
      const promise = CodingAgentTool.execute({ ...validArgs, task });
      await vi.advanceTimersByTimeAsync(0);

      child.emit('close', 0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([task]),
        expect.objectContaining({ shell: false }),
      );
    });

    it('unwraps Windows npm .cmd shims that target executable bins', async () => {
      setPlatform('win32');
      mockPathLookup('C:\\bin\\claude.cmd\r\n');
      mockReadFileSync.mockReturnValue('@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      child.stdout.emit('data', Buffer.from(JSON.stringify({ result: 'done' })));
      child.emit('close', 0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\bin\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
        expect.arrayContaining(['-p', '--output-format', 'json', '--dangerously-skip-permissions', 'fix the bug']),
        expect.objectContaining({ shell: false }),
      );
    });

    it.each([
      {
        cli: 'gemini',
        shim: '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js" %*\r\n',
        expectedCommand: 'node',
        expectedArgs: ['C:\\bin\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js', '-p', 'fix the bug', '--output-format', 'json', '--yolo'],
      },
      {
        cli: 'copilot',
        shim: '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*\r\n',
        expectedCommand: 'node',
        expectedArgs: ['C:\\bin\\node_modules\\@github\\copilot\\npm-loader.js', '-p', 'fix the bug', '-s', '--allow-all', '--no-ask-user'],
      },
    ])('unwraps the real Windows npm .cmd shim shape for $cli', async ({ cli, shim, expectedCommand, expectedArgs }) => {
      setPlatform('win32');
      mockGetCodingAgentSettings.mockReturnValue({ cli });
      mockPathLookup(`C:\\bin\\${cli}.cmd\r\n`);
      (fs.existsSync as Mock).mockImplementation((target: string) => !String(target).toLowerCase().endsWith('\\node.exe'));
      mockReadFileSync.mockReturnValue(shim);
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      child.stdout.emit('data', Buffer.from('done'));
      child.emit('close', 0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        expectedCommand,
        expect.arrayContaining(expectedArgs),
        expect.objectContaining({ shell: false }),
      );
    });

    it('rejects unsupported Windows command shims instead of falling back to cmd.exe', async () => {
      setPlatform('win32');
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      mockPathLookup('C:\\bin\\codex.cmd\r\n');
      mockReadFileSync.mockReturnValue('@ECHO off\r\necho custom shim %*\r\n');

      const result = await CodingAgentTool.execute(validArgs);

      expect(result.output).toContain('Unsupported Windows CLI shim');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('does not use a shell for Windows executable paths', async () => {
      setPlatform('win32');
      mockPathLookup('C:\\bin\\claude.exe\r\n');
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      child.emit('close', 0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\bin\\claude.exe',
        expect.any(Array),
        expect.objectContaining({ shell: false }),
      );
    });

    it('returns trimmed stdout for text-mode CLIs (codex)', async () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);

      child.stdout.emit('data', Buffer.from('  plain final message  '));
      child.emit('close', 0);

      const result = await promise;
      expect(result.output).toBe('plain final message');
      expect(result.cli).toBe('codex');
    });

    it('closes stdin immediately after spawn', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      child.emit('close', 0);
      await promise;
      expect(child.stdin.end).toHaveBeenCalled();
    });

    it('returns a non-zero exit code from the child', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      child.stdout.emit('data', Buffer.from(JSON.stringify({ result: 'partial' })));
      child.emit('close', 1);
      const result = await promise;
      expect(result.exitCode).toBe(1);
    });

    it('handles a spawn error and captures the message as stderr', async () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      child.emit('error', new Error('spawn ENOENT'));
      const result = await promise;
      expect(result.exitCode).toBe(1);
      expect(result.output).toBe('spawn ENOENT');
    });

    it('keeps existing stderr when a spawn error occurs after stderr output', async () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      child.stderr.emit('data', Buffer.from('already captured'));
      child.emit('error', new Error('later error'));
      const result = await promise;
      expect(result.output).toBe('already captured');
    });

    it('emits an elapsed-time heartbeat partial while running', async () => {
      const promise = CodingAgentTool.execute(validArgs, { executionContext: defaultContext() });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockEventSender.send).toHaveBeenCalledWith(
        'agentChat:streamingChunk',
        expect.objectContaining({
          type: 'tool_result',
          toolResult: expect.objectContaining({ tool_name: 'coding_agent', isPartial: true }),
        }),
      );

      child.emit('close', 0);
      await promise;
    });

    it('emits an initial partial carrying the resolved CLI before the first heartbeat', async () => {
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'copilot' });
      const promise = CodingAgentTool.execute(validArgs, { executionContext: defaultContext() });
      await vi.advanceTimersByTimeAsync(0);

      // The initial frame fires immediately; the heartbeat interval (5000ms) has not elapsed yet,
      // so the view can show the real CLI name from the first frame instead of the default.
      expect(mockEventSender.send).toHaveBeenCalledTimes(1);
      expect(mockEventSender.send).toHaveBeenCalledWith(
        'agentChat:streamingChunk',
        expect.objectContaining({
          type: 'tool_result',
          toolResult: expect.objectContaining({
            isPartial: true,
            content: expect.stringContaining('"cli": "copilot"'),
          }),
        }),
      );

      child.emit('close', 0);
      await promise;
    });

    it('emits partial chunks to the captured execution context', async () => {
      const capturedEventSender = { send: vi.fn() };
      const capturedContext = {
        ...defaultContext(),
        eventSender: capturedEventSender,
        currentToolCallId: 'captured-call',
        chatId: 'captured-chat',
        chatSessionId: 'captured-session',
      };
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'copilot' });
      const promise = CodingAgentTool.execute(validArgs, { executionContext: capturedContext });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockEventSender.send).not.toHaveBeenCalled();
      expect(capturedEventSender.send).toHaveBeenCalledWith(
        'agentChat:streamingChunk',
        expect.objectContaining({
          messageId: 'captured-call',
          chatId: 'captured-chat',
          chatSessionId: 'captured-session',
        }),
      );

      child.emit('close', 0);
      await promise;
    });

    it('does not emit a heartbeat when there is no execution context', async () => {
      mockGetCurrentUserAlias.mockReturnValue('alice');
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockEventSender.send).not.toHaveBeenCalled();
      child.emit('close', 0);
      await promise;
    });
  });

  // ── execute — truncation ────────────────────────────────────────────────────

  describe('execute - truncation', () => {
    let child: ReturnType<typeof createMockChild>;
    beforeEach(() => {
      child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockGetCodingAgentSettings.mockReturnValue({ cli: 'codex' });
    });

    it('truncates a final output larger than MAX_OUTPUT_CHARS', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      child.stdout.emit('data', Buffer.from('y'.repeat(60000)));
      child.emit('close', 0);
      const result = await promise;
      expect(result.output.length).toBe(50000);
      expect(result.truncated).toBe(true);
    });

    it('flags truncation when stdout exceeds the capture cap', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      // Exceed MAX_STDOUT_CAPTURE (2,000,000) to hit the capture-truncation branch.
      child.stdout.emit('data', Buffer.from('z'.repeat(2_000_050)));
      child.emit('close', 0);
      const result = await promise;
      expect(result.truncated).toBe(true);
    });

    it('does not flag truncation for small output', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      child.stdout.emit('data', Buffer.from('short'));
      child.emit('close', 0);
      const result = await promise;
      expect(result.truncated).toBeUndefined();
    });

    it('caps stderr capture to the tail when it grows large', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      child.stderr.emit('data', Buffer.from('e'.repeat(20_050)));
      child.stdout.emit('data', Buffer.from('ok'));
      child.emit('close', 0);
      const result = await promise;
      expect(result.output).toBe('ok');
    });
  });

  // ── execute — no-response (idle) timeout ─────────────────────────────────────

  describe('execute - no-response (idle) timeout', () => {
    let child: ReturnType<typeof createMockChild>;
    beforeEach(() => {
      child = createMockChild();
      mockSpawn.mockReturnValue(child);
    });

    it('kills the process and flags timedOut after the no-response budget with no output', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 1);
      child.emit('close', null);
      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('re-arms the budget when the CLI streams stdout, allowing total runtime to exceed it', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 10_000);
      // Activity re-arms the no-response budget; without touch() it would have fired one budget from start.
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result: 'done' })));
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 10_000); // ~2x budget elapsed, < one budget since last output -> alive
      expect(child.kill).not.toHaveBeenCalled();
      child.emit('close', 0);
      const result = await promise;
      expect(result.timedOut).toBe(false);
      expect(result.output).toContain('done');
    });

    it('re-arms the budget on stderr activity', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 10_000);
      child.stderr.emit('data', Buffer.from('warning: still working'));
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 10_000); // < one budget since the stderr chunk -> still alive
      expect(child.kill).not.toHaveBeenCalled();
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result: 'ok' })));
      child.emit('close', 0);
      const result = await promise;
      expect(result.timedOut).toBe(false);
    });

    it('terminates when no output arrives for the full budget after the last chunk', async () => {
      const promise = CodingAgentTool.execute(validArgs);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(200_000);
      child.stderr.emit('data', Buffer.from('thinking')); // re-arm
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 1); // full budget of silence after the chunk
      child.emit('close', null);
      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  // ── execute — cancellation ──────────────────────────────────────────────────

  describe('execute - cancellation', () => {
    let child: ReturnType<typeof createMockChild>;
    beforeEach(() => {
      child = createMockChild();
      mockSpawn.mockReturnValue(child);
    });

    it('aborts immediately when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const promise = CodingAgentTool.execute(validArgs, { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;
      expect(result.output).toBe('Coding agent execution was cancelled.');
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('aborts mid-run when the signal fires', async () => {
      const controller = new AbortController();
      const promise = CodingAgentTool.execute(validArgs, { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      const result = await promise;
      expect(result.output).toBe('Coding agent execution was cancelled.');
      expect(child.kill).toHaveBeenCalled();
    });

    it('swallows kill errors during abort', async () => {
      child.kill = vi.fn(() => { throw new Error('already dead'); });
      const controller = new AbortController();
      const promise = CodingAgentTool.execute(validArgs, { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      const result = await promise;
      expect(result.output).toBe('Coding agent execution was cancelled.');
    });
  });

  // ── getDefinition ───────────────────────────────────────────────────────────

  describe('getDefinition', () => {
    const def = CodingAgentTool.getDefinition();

    it('has the correct tool name', () => {
      expect(def.name).toBe('coding_agent');
    });

    it('mentions all supported CLIs in the description', () => {
      expect(def.description).toContain('Claude Code');
      expect(def.description).toMatch(/codex/i);
      expect(def.description).toMatch(/gemini/i);
      expect(def.description).toMatch(/copilot/i);
    });

    it('requires task and cwd', () => {
      expect(def.inputSchema.required).toEqual(['task', 'cwd']);
    });

    it('exposes only task and cwd (cli and timeout stay internal)', () => {
      const props = Object.keys(def.inputSchema.properties);
      expect(props).toEqual(expect.arrayContaining(['task', 'cwd']));
      expect(props).toHaveLength(2);
      expect(def.inputSchema.properties).not.toHaveProperty('cli');
      expect(def.inputSchema.properties).not.toHaveProperty('timeoutSeconds');
    });
  });
});
