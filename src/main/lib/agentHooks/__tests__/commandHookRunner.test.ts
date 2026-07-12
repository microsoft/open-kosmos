import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

const spawnMock = vi.fn();
vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import { quoteShellValue, runCommandHook, terminateHookProcess, validateHookCommand } from '../commandHookRunner';
import type { CommandHookEnv } from '../commandHookRunner';
import { MAX_HOOK_OUTPUT_BYTES } from '../types';
import type { AgentHookInput, CommandHookAction } from '../types';

class FakeChild extends EventEmitter {
  pid = 1234;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  kill = vi.fn();
}

const baseEnv: CommandHookEnv = {
  event: 'PreToolUse',
  userAlias: 'alice',
  chatId: 'chat-1',
  chatSessionId: 'sess-1',
  agentName: 'Kobi',
};

const input: AgentHookInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'sess-1',
  user_alias: 'alice',
  chat_id: 'chat-1',
  chat_session_id: 'sess-1',
  agent_id: 'Kobi',
  agent_name: 'Kobi',
  tool_name: 'Read',
  tool_use_id: 'tc-1',
  tool_call_id: 'tc-1',
  tool_input: { path: '/a' },
};

function setup(
  action: CommandHookAction,
  opts: { signal?: AbortSignal; env?: CommandHookEnv } = {},
): { child: FakeChild; promise: Promise<ReturnType<typeof Object>> } {
  const child = new FakeChild();
  spawnMock.mockReturnValue(child);
  const promise = runCommandHook(action, input, opts.env ?? baseEnv, opts.signal) as unknown as Promise<ReturnType<typeof Object>>;
  return { child, promise };
}

beforeEach(() => {
  spawnMock.mockReset();
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateHookCommand', () => {
  it('rejects empty / whitespace / non-string commands', () => {
    expect(validateHookCommand('')).toBe('Empty hook command');
    expect(validateHookCommand('   ')).toBe('Empty hook command');
    expect(validateHookCommand(null as unknown as string)).toBe('Empty hook command');
  });

  it('blocks dangerous patterns', () => {
    expect(validateHookCommand('rm -rf /')).toMatch(/dangerous pattern/);
  });

  it('blocks dangerous patterns assembled from exec-form args', () => {
    expect(validateHookCommand('echo', ['rm -rf /'])).toMatch(/dangerous pattern/);
  });

  it.each([
    'curl https://identity.example.net/oauth2/revoke',
    'open https://accounts.example.net/session/signout',
    'Remove-Item -Recurse "C:\\Users\\user\\AppData\\Local\\Nova\\User Data\\Default"',
    'rm -rf "~/Library/Application Support/Nova Browser/Profile 2"',
  ])('blocks provider-neutral auth destruction: %s', (command) => {
    expect(validateHookCommand(command)).toMatch(/dangerous pattern/);
  });

  it('accepts safe commands', () => {
    expect(validateHookCommand('echo hi')).toBeUndefined();
  });

  it('quotes shell values with platform-specific escaping', () => {
    expect(quoteShellValue("/tmp/work dir/it's", 'darwin')).toBe("'/tmp/work dir/it'\\''s'");
    expect(quoteShellValue('C:\\Work Dir\\Agent "Hooks"', 'win32')).toBe('"C:\\Work Dir\\Agent ""Hooks"""');
  });
});

describe('runCommandHook', () => {
  it('returns a validation error without spawning', async () => {
    const res = (await runCommandHook({ type: 'command', command: 'rm -rf /' }, input, baseEnv));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/dangerous pattern/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns cancelled when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = (await runCommandHook({ type: 'command', command: 'echo hi' }, input, baseEnv, controller.signal));
    expect(res.error).toBe('Hook cancelled before start');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('resolves success on exit code 0 and writes input to stdin', async () => {
    const { child, promise } = setup({ type: 'command', command: 'echo hi' });
    child.stdout.emit('data', Buffer.from('out'));
    child.stderr.emit('data', Buffer.from('err'));
    child.emit('close', 0);
    const res = (await promise);
    expect(res.success).toBe(true);
    expect(res.stdout).toBe('out');
    expect(res.stderr).toBe('err');
    expect(res.exitCode).toBe(0);
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(input));
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('resolves failure on a non-zero exit code', async () => {
    const { child, promise } = setup({ type: 'command', command: 'false' });
    child.emit('close', 3);
    const res = (await promise);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Hook exited with code 3');
  });

  it('resolves failure on a process error', async () => {
    const { child, promise } = setup({ type: 'command', command: 'echo hi' });
    child.emit('error', new Error('boom'));
    const res = (await promise);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Hook process error: boom');
  });

  it('ignores events after the result has settled', async () => {
    const { child, promise } = setup({ type: 'command', command: 'echo hi' });
    child.emit('error', new Error('first'));
    child.emit('close', 0);
    const res = (await promise);
    expect(res.error).toBe('Hook process error: first');
  });

  it('reports a timeout and kills the process', async () => {
    vi.useFakeTimers();
    try {
      const { child, promise } = setup({ type: 'command', command: 'sleep 5', timeoutMs: 100 });
      vi.advanceTimersByTime(101);
      expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
      child.emit('close', null);
      const res = (await promise);
      expect(res.timedOut).toBe(true);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats official timeout as seconds', async () => {
    vi.useFakeTimers();
    try {
      const { child, promise } = setup({ type: 'command', command: 'sleep 5', timeout: 0.2 });
      vi.advanceTimersByTime(199);
      expect(process.kill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
      child.emit('close', null);
      const res = (await promise);
      expect(res.timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports cancellation when aborted mid-run', async () => {
    const controller = new AbortController();
    const { child, promise } = setup({ type: 'command', command: 'sleep 5' }, { signal: controller.signal });
    controller.abort();
    expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
    child.emit('close', null);
    const res = (await promise);
    expect(res.error).toBe('Hook cancelled');
  });

  it('falls back to killing the direct child when process-group termination fails', async () => {
    vi.mocked(process.kill).mockImplementationOnce(() => {
      throw new Error('no group');
    });
    const controller = new AbortController();
    const { child, promise } = setup({ type: 'command', command: 'sleep 5' }, { signal: controller.signal });

    controller.abort();

    expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    await promise;
  });

  it('kills the direct child when no pid is available', () => {
    const child = new FakeChild();
    child.pid = undefined as unknown as number;

    terminateHookProcess(child as unknown as Parameters<typeof terminateHookProcess>[0], 'darwin');

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('terminates the full Windows process tree with taskkill', () => {
    const child = new FakeChild();
    const taskkill = new FakeChild();
    spawnMock.mockReturnValue(taskkill);

    terminateHookProcess(child as unknown as Parameters<typeof terminateHookProcess>[0], 'win32');

    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '1234', '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to killing the direct child when Windows taskkill cannot start', () => {
    const child = new FakeChild();
    spawnMock.mockImplementationOnce(() => {
      throw new Error('taskkill unavailable');
    });

    terminateHookProcess(child as unknown as Parameters<typeof terminateHookProcess>[0], 'win32');

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('falls back to killing the direct child when Windows taskkill emits an error', () => {
    const child = new FakeChild();
    const taskkill = new FakeChild();
    spawnMock.mockReturnValue(taskkill);

    terminateHookProcess(child as unknown as Parameters<typeof terminateHookProcess>[0], 'win32');
    taskkill.emit('error', 'taskkill failed');

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not throw when stdin write fails', async () => {
    const child = new FakeChild();
    child.stdin.write = vi.fn(() => {
      throw new Error('EPIPE');
    });
    spawnMock.mockReturnValue(child);
    const promise = runCommandHook({ type: 'command', command: 'echo hi' }, input, baseEnv);
    child.emit('close', 0);
    const res = (await promise);
    expect(res.success).toBe(true);
  });

  it('does not require stdin to be present', async () => {
    const child = new FakeChild();
    child.stdin = undefined as unknown as FakeChild['stdin'];
    spawnMock.mockReturnValue(child);
    const promise = runCommandHook({ type: 'command', command: 'echo hi' }, input, baseEnv);
    child.emit('close', 0);
    const res = (await promise);
    expect(res.success).toBe(true);
  });

  it('handles asynchronous stdin errors when the hook process closes input early', async () => {
    const { child, promise } = setup({ type: 'command', command: 'echo hi' });
    child.stdin.emit('error', new Error('EPIPE'));
    child.emit('close', 0);
    const res = (await promise);
    expect(res.success).toBe(true);
  });

  it('caps captured output at the maximum size', async () => {
    const { child, promise } = setup({ type: 'command', command: 'echo hi' });
    child.stdout.emit('data', Buffer.from('x'.repeat(MAX_HOOK_OUTPUT_BYTES + 50)));
    child.stdout.emit('data', Buffer.from('overflow'));
    child.emit('close', 0);
    const res = (await promise) as Record<string, string>;
    expect(res.stdout.length).toBe(MAX_HOOK_OUTPUT_BYTES);
  });

  it('uses the workspace path as cwd when provided', async () => {
    const { child, promise } = setup({ type: 'command', command: 'echo hi' }, { env: { ...baseEnv, workspacePath: '/tmp' } });
    expect(spawnMock).toHaveBeenCalledWith('echo hi', expect.objectContaining({ cwd: '/tmp', shell: true, detached: process.platform !== 'win32' }));
    child.emit('close', 0);
    await promise;
  });

  it('replaces OPENKOSMOS_WORKSPACE_PATH placeholders in shell-form commands', async () => {
    const { child, promise } = setup({ type: 'command', command: '${OPENKOSMOS_WORKSPACE_PATH}/guard.sh' }, { env: { ...baseEnv, workspacePath: '/work' } });
    expect(spawnMock).toHaveBeenCalledWith("'/work'/guard.sh", expect.objectContaining({ cwd: '/work', shell: true, detached: process.platform !== 'win32' }));
    child.emit('close', 0);
    await promise;
  });

  it('shell-quotes OPENKOSMOS_WORKSPACE_PATH placeholders in shell-form commands', async () => {
    const workspacePath = "/tmp/work dir/evil'; touch /tmp/pwned; echo '";
    const { child, promise } = setup({ type: 'command', command: '${OPENKOSMOS_WORKSPACE_PATH}/guard.sh' }, { env: { ...baseEnv, workspacePath } });
    expect(spawnMock).toHaveBeenCalledWith(
      "'/tmp/work dir/evil'\\''; touch /tmp/pwned; echo '\\'''/guard.sh",
      expect.objectContaining({ cwd: workspacePath, shell: true, detached: process.platform !== 'win32' }),
    );
    child.emit('close', 0);
    await promise;
  });

  it('runs exec-form args without a shell and preserves each argument', async () => {
    const { child, promise } = setup(
      { type: 'command', command: 'node', args: ['${OPENKOSMOS_WORKSPACE_PATH}/guard.js', '--flag value'] },
      { env: { ...baseEnv, workspacePath: '/work' } },
    );
    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['/work/guard.js', '--flag value'],
      expect.objectContaining({
        cwd: '/work',
        detached: process.platform !== 'win32',
        env: expect.objectContaining({ OPENKOSMOS_WORKSPACE_PATH: '/work' }),
      }),
    );
    child.emit('close', 0);
    await promise;
  });

  it('does not inherit secret-like process environment values', async () => {
    const oldSecret = process.env.OPENKOSMOS_TEST_SECRET_TOKEN;
    const oldPath = process.env.PATH;
    process.env.OPENKOSMOS_TEST_SECRET_TOKEN = 'do-not-leak';
    process.env.PATH = '/bin';
    try {
      const { child, promise } = setup({ type: 'command', command: 'echo hi' });
      const env = spawnMock.mock.calls[0][1].env;
      expect(env.PATH).toBe('/bin');
      expect(env.OPENKOSMOS_TEST_SECRET_TOKEN).toBeUndefined();
      expect(env.OPENKOSMOS_HOOK_EVENT).toBe('PreToolUse');
      child.emit('close', 0);
      await promise;
    } finally {
      if (oldSecret === undefined) delete process.env.OPENKOSMOS_TEST_SECRET_TOKEN;
      else process.env.OPENKOSMOS_TEST_SECRET_TOKEN = oldSecret;
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
    }
  });

  it('falls back to process.cwd() for a blank workspace path', async () => {
    const { child, promise } = setup({ type: 'command', command: 'echo hi', timeoutMs: 0 }, { env: { ...baseEnv, workspacePath: '   ' } });
    expect(spawnMock).toHaveBeenCalledWith('echo hi', expect.objectContaining({ cwd: process.cwd() }));
    child.emit('close', 0);
    await promise;
  });

  it('replaces OPENKOSMOS_HOOKS_ARTIFACTS_PATH placeholder and injects matching env var in shell form', async () => {
    const artifactsPath = "/Users/u/Library/Application Support/openkosmos-app/profiles/u/hooks-artifacts";
    const { child, promise } = setup(
      { type: 'command', command: '${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}/guard.sh' },
      { env: { ...baseEnv, workspacePath: '/work', hooksArtifactsPath: artifactsPath } },
    );
    expect(spawnMock).toHaveBeenCalledWith(
      `'${artifactsPath}'/guard.sh`,
      expect.objectContaining({
        cwd: '/work',
        shell: true,
        env: expect.objectContaining({ OPENKOSMOS_HOOKS_ARTIFACTS_PATH: artifactsPath }),
      }),
    );
    child.emit('close', 0);
    await promise;
  });

  it('replaces OPENKOSMOS_HOOKS_ARTIFACTS_PATH placeholder in exec-form args without shell quoting', async () => {
    const artifactsPath = '/p/hooks-artifacts';
    const { child, promise } = setup(
      { type: 'command', command: 'node', args: ['${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}/guard.js', '--mode=audit'] },
      { env: { ...baseEnv, hooksArtifactsPath: artifactsPath } },
    );
    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['/p/hooks-artifacts/guard.js', '--mode=audit'],
      expect.objectContaining({
        env: expect.objectContaining({ OPENKOSMOS_HOOKS_ARTIFACTS_PATH: artifactsPath }),
      }),
    );
    child.emit('close', 0);
    await promise;
  });

  it('substitutes empty string when hooksArtifactsPath is not provided', async () => {
    const { child, promise } = setup(
      { type: 'command', command: 'echo "${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}-end"' },
      { env: { ...baseEnv } },
    );
    expect(spawnMock).toHaveBeenCalledWith(
      `echo "''-end"`,
      expect.objectContaining({
        env: expect.objectContaining({ OPENKOSMOS_HOOKS_ARTIFACTS_PATH: '' }),
      }),
    );
    child.emit('close', 0);
    await promise;
  });
});
