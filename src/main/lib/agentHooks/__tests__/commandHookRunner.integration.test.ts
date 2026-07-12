import { vi, describe, it, expect } from 'vitest';
import * as os from 'os';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import { runCommandHook } from '../commandHookRunner';
import type { CommandHookEnv } from '../commandHookRunner';
import type { AgentHookInput } from '../types';

const env: CommandHookEnv = {
  event: 'UserPromptSubmit',
  userAlias: 'alice',
  chatId: 'chat-1',
  chatSessionId: 'sess-1',
  agentName: 'Kobi',
};

const input: AgentHookInput = {
  hook_event_name: 'UserPromptSubmit',
  session_id: 'sess-1',
  user_alias: 'alice',
  chat_id: 'chat-1',
  chat_session_id: 'sess-1',
  agent_id: 'Kobi',
  agent_name: 'Kobi',
  prompt: 'hi',
};

// These tests spawn real processes; they validate the spawn/stdin/stdout wiring
// that the mocked unit test cannot while staying cross-platform via Node.
describe('runCommandHook (integration)', () => {
  it('captures stdout from a real command', async () => {
    const res = await runCommandHook(
      { type: 'command', command: process.execPath, args: ['-e', 'process.stdout.write("hello-hook\\n")'] },
      input,
      env,
    );
    expect(res.success).toBe(true);
    expect(res.stdout.trim()).toBe('hello-hook');
    expect(res.exitCode).toBe(0);
  });

  it('pipes the hook input JSON to stdin', async () => {
    const res = await runCommandHook(
      { type: 'command', command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'] },
      input,
      env,
    );
    expect(res.success).toBe(true);
    expect(JSON.parse(res.stdout)).toMatchObject({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  });

  it('reports a non-zero exit code', async () => {
    const res = await runCommandHook(
      { type: 'command', command: process.execPath, args: ['-e', 'process.exit(7)'] },
      input,
      env,
    );
    expect(res.success).toBe(false);
    expect(res.exitCode).toBe(7);
  });

  it('exposes the workspace path as OPENKOSMOS_WORKSPACE_PATH', async () => {
    const ws = process.cwd();
    const res = await runCommandHook(
      { type: 'command', command: process.execPath, args: ['-e', 'process.stdout.write(process.env.OPENKOSMOS_WORKSPACE_PATH || "")'] },
      input,
      { ...env, workspacePath: ws },
    );
    expect(res.success).toBe(true);
    expect(res.stdout).toBe(ws);
  });

  it('exposes the hooks artifacts path as OPENKOSMOS_HOOKS_ARTIFACTS_PATH and substitutes the placeholder', async () => {
    const ws = process.cwd();
    const artifacts = os.tmpdir();
    const res = await runCommandHook(
      {
        type: 'command',
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write(process.env.OPENKOSMOS_HOOKS_ARTIFACTS_PATH + "|" + process.argv[1])',
          '${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}/probe.txt',
        ],
      },
      input,
      { ...env, workspacePath: ws, hooksArtifactsPath: artifacts },
    );
    expect(res.success).toBe(true);
    expect(res.stdout).toBe(`${artifacts}|${artifacts}/probe.txt`);
  });
});
