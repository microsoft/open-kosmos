// @ts-nocheck
/**
 * Tests for the Agent Hooks library sanitization added to profileSanitizer.ts:
 * sanitizeHooks (+ helpers) and the hooks field wiring in sanitizeProfileV2.
 * Hooks use the flat one event / one matcher / one action shape.
 */
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
vi.mock('electron', async () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }));
vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));
vi.mock('../../../../shared/constants/branding', async () => ({ BRAND_NAME: 'openkosmos' }));
vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: '1.0.0',
}));

import { sanitizeHooks, sanitizeProfileV2 } from '../profileSanitizer';
import {
  MAX_HOOK_HTTP_BODY_LENGTH,
  MAX_HOOK_HTTP_HEADER_CHARS,
  MAX_HOOK_HTTP_HEADERS,
  MAX_HOOK_IF_LENGTH,
} from '../../agentHooks/types';
import type { ProfileV2 } from '../types/profile';

const cmd = (over: Record<string, unknown> = {}) => ({ type: 'command', command: 'echo', ...over });

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    alias: 'alice',
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    chats: [],
    'starred-chat-sessions': [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ProfileV2;
}

describe('sanitizeHooks', () => {
  it('returns an empty array for non-array input', () => {
    expect(sanitizeHooks(undefined)).toEqual([]);
    expect(sanitizeHooks('nope')).toEqual([]);
  });

  it('drops non-object entries and entries without a stable id', () => {
    const result = sanitizeHooks([null, 'x', { name: 'no id' }, { id: '   ' }]);
    expect(result).toEqual([]);
  });

  it('deduplicates by id keeping the first occurrence', () => {
    const result = sanitizeHooks([
      { id: 'h1', name: 'first', event: 'Stop', action: cmd() },
      { id: 'h1', name: 'second', event: 'Stop', action: cmd() },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('first');
  });

  it('falls back name to id and enabled to false and generates timestamps', () => {
    const result = sanitizeHooks([{ id: 'h1', event: 'Stop', action: cmd() }]);
    expect(result[0].name).toBe('h1');
    expect(result[0].enabled).toBe(false);
    expect(result[0].event).toBe('Stop');
    expect(result[0].action).toEqual({ type: 'command', command: 'echo' });
    expect(typeof result[0].createdAt).toBe('string');
    expect(typeof result[0].updatedAt).toBe('string');
  });

  it('preserves description, timestamps, and explicit enabled', () => {
    const result = sanitizeHooks([
      { id: 'h1', name: 'H', description: 'd', enabled: true, event: 'Stop', action: cmd(), createdAt: 'C', updatedAt: 'U' },
    ]);
    expect(result[0]).toMatchObject({ description: 'd', enabled: true, createdAt: 'C', updatedAt: 'U' });
  });

  it('defaults provenance fields when absent or blank', () => {
    const result = sanitizeHooks([{ id: 'h1', version: '   ', event: 'Stop', action: cmd() }]);
    expect(result[0]).toMatchObject({ version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE' });
  });

  it('preserves explicit provenance fields', () => {
    const result = sanitizeHooks([
      { id: 'h1', version: '2.3.1', remoteVersion: '3.0.0', source: 'IN-LIBRARY', event: 'Stop', action: cmd() },
    ]);
    expect(result[0]).toMatchObject({ version: '2.3.1', remoteVersion: '3.0.0', source: 'IN-LIBRARY' });
  });

  it('normalizes a command action and keeps a matcher', () => {
    const result = sanitizeHooks([
      {
        id: 'h1',
        event: 'PreToolUse',
        matcher: 'Read',
        action: { type: 'command', command: 'echo', args: ['--json', 7], timeout: 1, timeoutMs: 5, async: true },
      },
    ]);
    expect(result[0].action).toEqual({ type: 'command', command: 'echo', args: ['--json'], timeout: 1, async: true });
    expect(result[0].matcher).toBe('Read');
  });

  it('drops hooks whose action is missing or malformed', () => {
    const result = sanitizeHooks([
      { id: 'a', event: 'PreToolUse', action: null },
      { id: 'b', event: 'PreToolUse', action: { type: 'command', command: '   ' } },
      { id: 'c', event: 'PreToolUse', action: { type: 'command' } },
      { id: 'd', event: 'PreToolUse', action: { type: 'prompt' } },
      { id: 'e', event: 'PreToolUse', action: { type: 'http', command: 'x' } },
    ]);
    expect(result).toEqual([]);
  });

  it('keeps and trims an if permission-rule condition', () => {
    const result = sanitizeHooks([
      { id: 'h1', event: 'PreToolUse', action: cmd({ if: 'execute_command(rm *)' }) },
      { id: 'h2', event: 'PreToolUse', action: cmd({ if: '   ' }) },
      { id: 'h3', event: 'PreToolUse', action: { type: 'http', url: 'https://example.com/hook', if: 'x'.repeat(MAX_HOOK_IF_LENGTH + 10) } },
    ]);
    expect(result[0].action.if).toBe('execute_command(rm *)');
    expect('if' in result[1].action).toBe(false);
    expect(result[2].action.if).toHaveLength(MAX_HOOK_IF_LENGTH);
  });

  it('caps persisted command and http hook timeouts at the runtime maximum', () => {
    const result = sanitizeHooks([
      { id: 'h1', event: 'PreToolUse', action: cmd({ timeout: 9999 }) },
      { id: 'h2', event: 'PostToolUse', action: { type: 'http', url: 'https://example.com/hook', timeoutMs: 900_000 } },
    ]);
    expect(result[0].action).toMatchObject({ timeout: 600 });
    expect(result[1].action).toMatchObject({ timeoutMs: 600_000 });
  });

  it('drops hooks with unknown event names or non-object actions', () => {
    const result = sanitizeHooks([
      { id: 'a', event: 'Bogus', action: cmd() },
      { id: 'b', event: 'PreToolUse', action: 'nope' },
      { id: 'c', action: cmd() },
    ]);
    expect(result).toEqual([]);
  });

  it('ignores a blank matcher string', () => {
    const result = sanitizeHooks([
      { id: 'h1', event: 'PreToolUse', matcher: '   ', action: cmd() },
    ]);
    expect(result[0].matcher).toBeUndefined();
  });

  it('accepts the Phase 3 observational events', () => {
    const result = sanitizeHooks([
      { id: 'h1', event: 'Stop', action: cmd() },
      { id: 'h2', event: 'PreCompact', action: cmd() },
      { id: 'h3', event: 'PostCompact', action: cmd() },
    ]);
    expect(result.map(hook => hook.event)).toEqual(['Stop', 'PreCompact', 'PostCompact']);
  });

  it('normalizes a fully-specified http action', () => {
    const result = sanitizeHooks([
      {
        id: 'h1',
        event: 'Stop',
        action: { type: 'http', url: 'https://example.com/hook', method: 'PUT', headers: { A: '1', B: 2 }, body: 'x', timeout: 2, timeoutMs: 1000, async: true },
      },
    ]);
    expect(result[0].action).toEqual({
      type: 'http',
      url: 'https://example.com/hook',
      method: 'PUT',
      headers: { A: '1' },
      body: 'x',
      timeout: 2,
      async: true,
    });
  });

  it('drops an invalid http method and empty headers but keeps the action', () => {
    const result = sanitizeHooks([
      { id: 'h1', event: 'Stop', action: { type: 'http', url: 'https://example.com/hook', method: 'TRACE', headers: { A: 5 } } },
    ]);
    expect(result[0].action).toEqual({ type: 'http', url: 'https://example.com/hook' });
  });

  it('drops a hook whose http action has a missing url', () => {
    const result = sanitizeHooks([
      { id: 'h1', event: 'Stop', action: { type: 'http' } },
      { id: 'h2', event: 'Stop', action: { type: 'http', url: 'https://example.com/hook' } },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].action).toEqual({ type: 'http', url: 'https://example.com/hook' });
  });

  it('caps persisted http headers and body', () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < MAX_HOOK_HTTP_HEADERS + 5; i += 1) {
      headers[`H${i}`] = 'v';
    }
    headers.large = 'x'.repeat(MAX_HOOK_HTTP_HEADER_CHARS + 1);
    const result = sanitizeHooks([
      {
        id: 'h1',
        event: 'Stop',
        action: { type: 'http', url: 'https://example.com/hook', headers, body: 'b'.repeat(MAX_HOOK_HTTP_BODY_LENGTH + 10) },
      },
    ]);
    const action = result[0].action;
    expect(action.type).toBe('http');
    if (action.type === 'http') {
      expect(Object.keys(action.headers ?? {})).toHaveLength(MAX_HOOK_HTTP_HEADERS);
      expect(action.headers?.large).toBeUndefined();
      expect(action.body).toHaveLength(MAX_HOOK_HTTP_BODY_LENGTH);
    }
  });

  it('drops http headers after the character cap', () => {
    const result = sanitizeHooks([
      {
        id: 'h1',
        event: 'Stop',
        action: {
          type: 'http',
          url: 'https://example.com/hook',
          headers: { huge: 'x'.repeat(MAX_HOOK_HTTP_HEADER_CHARS + 1), small: 'ok' },
        },
      },
    ]);
    const action = result[0].action;
    expect(action.type).toBe('http');
    if (action.type === 'http') {
      expect(action.headers).toBeUndefined();
    }
  });

  it('round-trips every core field of a fully-specified command hook', () => {
    const [hook] = sanitizeHooks([
      {
        id: 'cmd-all',
        name: 'Command All',
        description: 'guards bash',
        version: '2.1.0',
        remoteVersion: '3.4.5',
        source: 'IN-LIBRARY',
        enabled: true,
        event: 'PreToolUse',
        matcher: 'Read|Write',
        action: { type: 'command', command: 'echo hi', if: 'execute_command(rm *)', args: ['--json', '--verbose'], timeout: 12, async: true },
        createdAt: 'C',
        updatedAt: 'U',
      },
    ]);
    expect(hook).toEqual({
      id: 'cmd-all',
      name: 'Command All',
      description: 'guards bash',
      version: '2.1.0',
      remoteVersion: '3.4.5',
      source: 'IN-LIBRARY',
      enabled: true,
      event: 'PreToolUse',
      matcher: 'Read|Write',
      action: { type: 'command', command: 'echo hi', if: 'execute_command(rm *)', args: ['--json', '--verbose'], timeout: 12, async: true },
      createdAt: 'C',
      updatedAt: 'U',
    });
  });

  it('round-trips every core field of a fully-specified http hook', () => {
    const [hook] = sanitizeHooks([
      {
        id: 'http-all',
        name: 'Http All',
        description: 'notifies endpoint',
        version: '1.2.3',
        remoteVersion: '',
        source: 'ON-DEVICE',
        enabled: false,
        event: 'PostToolUse',
        matcher: 'mcp__.*',
        action: { type: 'http', url: 'https://example.com/h', if: 'WebFetch', method: 'PUT', headers: { A: '1', B: '2' }, body: 'payload', timeout: 30, async: false },
        createdAt: 'C2',
        updatedAt: 'U2',
      },
    ]);
    expect(hook).toEqual({
      id: 'http-all',
      name: 'Http All',
      description: 'notifies endpoint',
      version: '1.2.3',
      remoteVersion: '',
      source: 'ON-DEVICE',
      enabled: false,
      event: 'PostToolUse',
      matcher: 'mcp__.*',
      action: { type: 'http', url: 'https://example.com/h', if: 'WebFetch', method: 'PUT', headers: { A: '1', B: '2' }, body: 'payload', timeout: 30, async: false },
      createdAt: 'C2',
      updatedAt: 'U2',
    });
  });
});

describe('sanitizeProfileV2 – hooks field', () => {
  it('includes a sanitized hooks array', () => {
    const profile = makeProfile({
      hooks: [
        { id: 'h1', name: 'H1', enabled: true, event: 'Stop', action: cmd() },
      ] as ProfileV2['hooks'],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks?.[0].id).toBe('h1');
  });

  it('defaults hooks to an empty array when absent', () => {
    const result = sanitizeProfileV2(makeProfile());
    expect(result.hooks).toEqual([]);
  });

  it('defaults hooksEnabled to false when absent or malformed', () => {
    expect(sanitizeProfileV2(makeProfile()).hooksEnabled).toBe(false);
    expect(sanitizeProfileV2(makeProfile({ hooksEnabled: 'yes' as any })).hooksEnabled).toBe(false);
  });

  it('preserves a boolean hooksEnabled value', () => {
    expect(sanitizeProfileV2(makeProfile({ hooksEnabled: true })).hooksEnabled).toBe(true);
    expect(sanitizeProfileV2(makeProfile({ hooksEnabled: false })).hooksEnabled).toBe(false);
  });

  it('preserves sanitized hook selections on multi-agent chat members', () => {
    const result = sanitizeProfileV2(makeProfile({
      chats: [
        {
          chat_id: 'multi-1',
          chat_type: 'multi_agent',
          workspace: '/legacy-workspace',
          agent: { name: 'Primary Agent', hooks: ['primary-hook'] },
          agents: [
            {
              name: 'First Member',
              workspace: '/member-workspace',
              hooks: ['hook-a', '', '   ', 42, 'hook-b'],
              mcp_servers: ['filesystem'],
            },
            {
              name: 'Second Member',
              hooks: ['hook-c'],
              mcp_servers: [{ name: 'github', tools: ['search'] }, { name: '', tools: [] }],
            },
          ],
        },
      ] as any,
    }));

    const chat = result.chats[0];
    expect(chat.workspace).toBeUndefined();
    expect(chat.agent?.hooks).toEqual(['primary-hook']);
    expect(chat.agents).toHaveLength(2);
    expect(chat.agents?.[0]).toMatchObject({
      name: 'First Member',
      hooks: ['hook-a', 'hook-b'],
      mcp_servers: [{ name: 'filesystem', tools: [] }],
    });
    expect(chat.agents?.[0]).not.toHaveProperty('workspace');
    expect(chat.agents?.[1]).toMatchObject({
      name: 'Second Member',
      hooks: ['hook-c'],
      mcp_servers: [{ name: 'github', tools: ['search'] }],
    });
    expect(chat.agents?.[1]).not.toHaveProperty('workspace');
  });
});
