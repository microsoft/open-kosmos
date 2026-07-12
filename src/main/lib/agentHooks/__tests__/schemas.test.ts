import { describe, it, expect } from 'vitest';

import {
  isCommandHookAction,
  isHttpHookAction,
  isHookAction,
  isValidHookDefinition,
  isHookJsonOutput,
} from '../schemas';

describe('isCommandHookAction', () => {
  it('accepts a minimal valid command action', () => {
    expect(isCommandHookAction({ type: 'command', command: 'echo hi' })).toBe(true);
  });

  it('accepts optional if, timeout, legacy timeoutMs, args, and async', () => {
    expect(
      isCommandHookAction({ type: 'command', command: 'echo hi', if: 'execute_command(rm *)', args: ['--json'], timeout: 5, timeoutMs: 5000, async: true }),
    ).toBe(true);
  });

  it('rejects non-records', () => {
    expect(isCommandHookAction(null)).toBe(false);
    expect(isCommandHookAction([])).toBe(false);
    expect(isCommandHookAction('x')).toBe(false);
  });

  it('rejects wrong type', () => {
    expect(isCommandHookAction({ type: 'http', command: 'echo' })).toBe(false);
  });

  it('rejects empty command', () => {
    expect(isCommandHookAction({ type: 'command', command: '   ' })).toBe(false);
    expect(isCommandHookAction({ type: 'command' })).toBe(false);
  });

  it('rejects a non-string if', () => {
    expect(isCommandHookAction({ type: 'command', command: 'e', if: 5 })).toBe(false);
  });

  it('rejects invalid timeout and args', () => {
    expect(isCommandHookAction({ type: 'command', command: 'e', timeout: 0 })).toBe(false);
    expect(isCommandHookAction({ type: 'command', command: 'e', timeout: 'x' })).toBe(false);
    expect(isCommandHookAction({ type: 'command', command: 'e', timeoutMs: 0 })).toBe(false);
    expect(isCommandHookAction({ type: 'command', command: 'e', timeoutMs: 'x' })).toBe(false);
    expect(isCommandHookAction({ type: 'command', command: 'e', args: 'x' })).toBe(false);
    expect(isCommandHookAction({ type: 'command', command: 'e', args: ['x', 1] })).toBe(false);
  });

  it('rejects invalid async', () => {
    expect(isCommandHookAction({ type: 'command', command: 'e', async: 'yes' })).toBe(false);
  });
});

describe('isHttpHookAction', () => {
  it('accepts a minimal valid http action', () => {
    expect(isHttpHookAction({ type: 'http', url: 'https://example.com/hook' })).toBe(true);
  });

  it('accepts optional if, method, headers, body, timeout, legacy timeoutMs and async', () => {
    expect(
      isHttpHookAction({
        type: 'http',
        url: 'https://example.com/hook',
        if: 'WebFetch',
        method: 'PUT',
        headers: { A: '1' },
        body: 'x',
        timeout: 5,
        timeoutMs: 5000,
        async: true,
      }),
    ).toBe(true);
  });

  it('rejects non-records and the wrong type', () => {
    expect(isHttpHookAction(null)).toBe(false);
    expect(isHttpHookAction({ type: 'command', url: 'https://x' })).toBe(false);
  });

  it('rejects an empty url', () => {
    expect(isHttpHookAction({ type: 'http', url: '   ' })).toBe(false);
    expect(isHttpHookAction({ type: 'http' })).toBe(false);
  });

  it('rejects a non-string if', () => {
    expect(isHttpHookAction({ type: 'http', url: 'https://x', if: 5 })).toBe(false);
  });

  it('rejects an invalid method', () => {
    expect(isHttpHookAction({ type: 'http', url: 'https://x', method: 'TRACE' })).toBe(false);
  });

  it('rejects non-string-record headers', () => {
    expect(isHttpHookAction({ type: 'http', url: 'https://x', headers: { A: 5 } })).toBe(false);
    expect(isHttpHookAction({ type: 'http', url: 'https://x', headers: [] })).toBe(false);
  });

  it('rejects a non-string body and invalid timeout/async', () => {
    expect(isHttpHookAction({ type: 'http', url: 'https://x', body: 5 })).toBe(false);
    expect(isHttpHookAction({ type: 'http', url: 'https://x', timeout: 0 })).toBe(false);
    expect(isHttpHookAction({ type: 'http', url: 'https://x', timeout: 'x' })).toBe(false);
    expect(isHttpHookAction({ type: 'http', url: 'https://x', timeoutMs: 0 })).toBe(false);
    expect(isHttpHookAction({ type: 'http', url: 'https://x', async: 'no' })).toBe(false);
  });
});

describe('isHookAction', () => {
  it('accepts both command and http actions', () => {
    expect(isHookAction({ type: 'command', command: 'echo' })).toBe(true);
    expect(isHookAction({ type: 'http', url: 'https://x' })).toBe(true);
  });

  it('rejects unknown action types', () => {
    expect(isHookAction({ type: 'prompt' })).toBe(false);
    expect(isHookAction({ type: 'mcp_tool' })).toBe(false);
    expect(isHookAction({ type: 'agent' })).toBe(false);
  });
});

describe('isValidHookDefinition', () => {
  const base = {
    id: 'h1',
    name: 'Hook 1',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
  };

  it('accepts a valid definition', () => {
    expect(isValidHookDefinition(base)).toBe(true);
  });

  it('accepts optional description and matcher', () => {
    expect(isValidHookDefinition({ ...base, description: 'desc', matcher: 'execute_command' })).toBe(true);
  });

  it('accepts the Phase 3 observational events', () => {
    expect(isValidHookDefinition({ ...base, event: 'Stop' })).toBe(true);
    expect(isValidHookDefinition({ ...base, event: 'PreCompact' })).toBe(true);
    expect(isValidHookDefinition({ ...base, event: 'PostCompact' })).toBe(true);
  });

  it('accepts an http action', () => {
    expect(isValidHookDefinition({ ...base, action: { type: 'http', url: 'https://x' } })).toBe(true);
  });

  it('rejects non-records', () => {
    expect(isValidHookDefinition(null)).toBe(false);
  });

  it('rejects missing id', () => {
    expect(isValidHookDefinition({ ...base, id: '' })).toBe(false);
  });

  it('rejects non-string name', () => {
    expect(isValidHookDefinition({ ...base, name: 5 })).toBe(false);
  });

  it('rejects non-string description', () => {
    expect(isValidHookDefinition({ ...base, description: 5 })).toBe(false);
  });

  it('rejects a non-string version', () => {
    expect(isValidHookDefinition({ ...base, version: 5 })).toBe(false);
    expect(isValidHookDefinition({ ...base, version: undefined })).toBe(false);
  });

  it('accepts an optional string remoteVersion and rejects a non-string one', () => {
    expect(isValidHookDefinition({ ...base, remoteVersion: '2.0.0' })).toBe(true);
    expect(isValidHookDefinition({ ...base, remoteVersion: 5 })).toBe(false);
  });

  it('accepts the IN-LIBRARY source and rejects an invalid source', () => {
    expect(isValidHookDefinition({ ...base, source: 'IN-LIBRARY' })).toBe(true);
    expect(isValidHookDefinition({ ...base, source: 'INVALID' })).toBe(false);
    expect(isValidHookDefinition({ ...base, source: undefined })).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    expect(isValidHookDefinition({ ...base, enabled: 'yes' })).toBe(false);
  });

  it('rejects an invalid event', () => {
    expect(isValidHookDefinition({ ...base, event: 'Bad' })).toBe(false);
    expect(isValidHookDefinition({ ...base, event: 123 })).toBe(false);
  });

  it('rejects a non-string matcher', () => {
    expect(isValidHookDefinition({ ...base, matcher: 5 })).toBe(false);
  });

  it('rejects a missing or invalid action', () => {
    expect(isValidHookDefinition({ ...base, action: undefined })).toBe(false);
    expect(isValidHookDefinition({ ...base, action: { type: 'command' } })).toBe(false);
  });
});

describe('isHookJsonOutput', () => {
  it('accepts an empty object', () => {
    expect(isHookJsonOutput({})).toBe(true);
  });

  it('accepts a fully-populated valid object', () => {
    expect(
      isHookJsonOutput({
        continue: true,
        suppressOutput: false,
        stopReason: 'stop',
        decision: 'block',
        reason: 'because',
        systemMessage: 'msg',
        hookSpecificOutput: { hookEventName: 'PreToolUse' },
      }),
    ).toBe(true);
  });

  it('rejects non-records', () => {
    expect(isHookJsonOutput(null)).toBe(false);
    expect(isHookJsonOutput([])).toBe(false);
  });

  it('rejects bad field types', () => {
    expect(isHookJsonOutput({ continue: 'x' })).toBe(false);
    expect(isHookJsonOutput({ suppressOutput: 'x' })).toBe(false);
    expect(isHookJsonOutput({ stopReason: 5 })).toBe(false);
    expect(isHookJsonOutput({ decision: 'maybe' })).toBe(false);
    expect(isHookJsonOutput({ reason: 5 })).toBe(false);
    expect(isHookJsonOutput({ systemMessage: 5 })).toBe(false);
    expect(isHookJsonOutput({ hookSpecificOutput: 'x' })).toBe(false);
  });
});
