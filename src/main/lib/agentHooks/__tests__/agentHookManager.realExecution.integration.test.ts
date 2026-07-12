/**
 * Agent Hooks — real end-to-end execution integration test.
 *
 * Unlike the unit tests (which inject a fake CommandRunner), this suite wires
 * the REAL stack the Agent Loop uses at runtime:
 *   AgentHookManager.runHooks
 *     → resolveEffectiveHooks (real binding resolution by agent)
 *     → executeHooksForEvent (real aggregator)
 *     → runCommandHook (real child_process spawn through a shell)
 *
 * It generates real hooks bound to an Agent across distinct lifecycle events,
 * then drives the same lifecycle events the Agent Chat loop fires (UserPromptSubmit,
 * PreToolUse, PostToolUse). Each hook command writes a marker file to a temp
 * directory; the test asserts the files exist on disk, proving the hooks were
 * actually triggered and executed end-to-end — not merely resolved.
 *
 * The Agent Chat loop (`src/main/lib/chat/agentChat.ts`) invokes exactly this
 * facade via `AgentHookManager.getInstance().runHooks(...)`, so exercising the
 * real manager with a production-shaped run context is the faithful, LLM-free
 * equivalent of "trigger a hook from a chat turn".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import { AgentHookManager } from '../agentHookManager';
import type { AgentHookManagerDeps } from '../agentHookManager';
import type {
  AgentHookRunContext,
  HookDefinition,
} from '../types';

let workDir: string;
let markerAgent: string;
let markerMcp: string;
let markerSkill: string;
let markerDisabled: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ah-real-exec-'));
  markerAgent = join(workDir, 'agent-hook.marker');
  markerMcp = join(workDir, 'mcp-hook.marker');
  markerSkill = join(workDir, 'skill-hook.marker');
  markerDisabled = join(workDir, 'disabled-hook.marker');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** A command hook that writes a fixed token to `markerPath` when it fires. */
function commandHook(
  id: string,
  name: string,
  event: 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse',
  markerPath: string,
  token: string,
): HookDefinition {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id,
    name,
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event,
    matcher: '*',
    action: {
      type: 'command',
      // Single-quote the path so spaces in the temp dir are safe.
      command: `printf %s '${token}' > '${markerPath}'`,
      timeout: 10,
    },
    createdAt: now,
    updatedAt: now,
  };
}

const baseContext: AgentHookRunContext = {
  userAlias: 'alice',
  chatId: 'chat-1',
  chatSessionId: 'sess-1',
  agentName: 'Researcher',
  workspacePath: undefined,
  hookIds: [],
};

describe('AgentHookManager real execution (integration)', () => {
  it('triggers and executes agent-bound hooks across lifecycle events', async () => {
    const hooks: HookDefinition[] = [
      commandHook(
        'hook-agent',
        'UserPromptSubmit hook',
        'UserPromptSubmit',
        markerAgent,
        'agent-fired',
      ),
      commandHook(
        'hook-mcp',
        'PreToolUse hook',
        'PreToolUse',
        markerMcp,
        'mcp-fired',
      ),
      commandHook(
        'hook-skill',
        'PostToolUse hook',
        'PostToolUse',
        markerSkill,
        'skill-fired',
      ),
    ];

    // Real manager: no runner override → real child_process spawn.
    const deps: AgentHookManagerDeps = {
      getHooks: () => hooks,
      isEnabled: () => true,
    };
    const manager = new AgentHookManager(deps);

    const context: AgentHookRunContext = {
      ...baseContext,
      hookIds: ['hook-agent', 'hook-mcp', 'hook-skill'],
    };

    // Drive the same lifecycle events the Agent Chat loop fires.
    await manager.runHooks(
      'UserPromptSubmit',
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess-1',
        user_alias: 'alice',
        chat_id: 'chat-1',
        chat_session_id: 'sess-1',
        agent_id: 'Researcher',
        agent_name: 'Researcher',
        prompt: 'hello',
      },
      context,
    );
    await manager.runHooks(
      'PreToolUse',
      {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        user_alias: 'alice',
        chat_id: 'chat-1',
        chat_session_id: 'sess-1',
        agent_id: 'Researcher',
        agent_name: 'Researcher',
        tool_name: 'read_file',
        tool_use_id: 'tu-1',
        tool_call_id: 'tc-1',
        tool_input: {},
      },
      context,
    );
    await manager.runHooks(
      'PostToolUse',
      {
        hook_event_name: 'PostToolUse',
        session_id: 'sess-1',
        user_alias: 'alice',
        chat_id: 'chat-1',
        chat_session_id: 'sess-1',
        agent_id: 'Researcher',
        agent_name: 'Researcher',
        tool_name: 'read_file',
        tool_use_id: 'tu-1',
        tool_call_id: 'tc-1',
        tool_input: {},
        tool_response: { ok: true },
        tool_output: { ok: true },
      },
      context,
    );

    expect(existsSync(markerAgent)).toBe(true);
    expect(readFileSync(markerAgent, 'utf-8')).toBe('agent-fired');
    expect(existsSync(markerMcp)).toBe(true);
    expect(readFileSync(markerMcp, 'utf-8')).toBe('mcp-fired');
    expect(existsSync(markerSkill)).toBe(true);
    expect(readFileSync(markerSkill, 'utf-8')).toBe('skill-fired');
  });

  it('does not execute a real hook command when the master switch is off', async () => {
    const hooks: HookDefinition[] = [
      commandHook(
        'hook-disabled',
        'Should not fire',
        'UserPromptSubmit',
        markerDisabled,
        'should-not-exist',
      ),
    ];
    const deps: AgentHookManagerDeps = {
      getHooks: () => hooks,
      isEnabled: () => false,
    };
    const manager = new AgentHookManager(deps);

    const result = await manager.runHooks(
      'UserPromptSubmit',
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess-1',
        user_alias: 'alice',
        chat_id: 'chat-1',
        chat_session_id: 'sess-1',
        agent_id: 'Researcher',
        agent_name: 'Researcher',
        prompt: 'hello',
      },
      { ...baseContext, hookIds: ['hook-disabled'] },
    );

    expect(result).toEqual({});
    expect(existsSync(markerDisabled)).toBe(false);
  });

  it('does not fire a hook the active agent has not selected', async () => {
    const otherMarker = join(workDir, 'unbound-hook.marker');
    const hooks: HookDefinition[] = [
      commandHook(
        'hook-unbound',
        'Unrelated binding',
        'UserPromptSubmit',
        otherMarker,
        'unbound',
      ),
    ];
    const manager = new AgentHookManager({ getHooks: () => hooks, isEnabled: () => true });

    await manager.runHooks(
      'UserPromptSubmit',
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess-1',
        user_alias: 'alice',
        chat_id: 'chat-1',
        chat_session_id: 'sess-1',
        agent_id: 'Researcher',
        agent_name: 'Researcher',
        prompt: 'hello',
      },
      { ...baseContext, hookIds: [] },
    );

    expect(existsSync(otherMarker)).toBe(false);
  });
});
