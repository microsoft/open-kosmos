import {
  validateCreateHookInput,
  validateUpdateHookPatch,
  MAX_HOOK_NAME_LENGTH,
  MAX_HOOK_DESCRIPTION_LENGTH,
  MAX_HOOK_MATCHER_LENGTH,
  MAX_HOOK_IF_LENGTH,
  MIN_HOOK_TIMEOUT_MS,
  MAX_HOOK_TIMEOUT_MS,
  MIN_HOOK_TIMEOUT_SECONDS,
  MAX_HOOK_TIMEOUT_SECONDS,
  MAX_HOOK_URL_LENGTH,
  MAX_HOOK_HTTP_HEADERS,
  MAX_HOOK_HTTP_HEADER_CHARS,
  MAX_HOOK_HTTP_BODY_LENGTH,
} from '../hookInputValidation';

const validAction = { type: 'command', command: 'echo hi' };

/** A minimal valid flat create payload, with optional field overrides. */
const base = (over: Record<string, unknown> = {}) => ({
  name: 'n',
  event: 'PreToolUse',
  action: validAction,
  ...over,
});

/** A flat create payload whose action is replaced wholesale. */
const withAction = (action: unknown, over: Record<string, unknown> = {}) => ({
  name: 'n',
  event: 'PreToolUse',
  action,
  ...over,
});

describe('validateCreateHookInput', () => {
  it('rejects non-object input', () => {
    expect(validateCreateHookInput(null)).toMatchObject({ ok: false });
    expect(validateCreateHookInput([])).toMatchObject({ ok: false });
  });

  it('rejects missing/empty/non-string name', () => {
    expect(validateCreateHookInput({ name: 123 })).toEqual({ ok: false, error: 'Hook name is required' });
    expect(validateCreateHookInput({ name: '   ' })).toEqual({ ok: false, error: 'Hook name is required' });
  });

  it('rejects too-long name', () => {
    const res = validateCreateHookInput({ name: 'x'.repeat(MAX_HOOK_NAME_LENGTH + 1) });
    expect(res.ok).toBe(false);
  });

  it('rejects non-string description', () => {
    expect(validateCreateHookInput({ name: 'n', description: 5 })).toEqual({
      ok: false,
      error: 'Hook description must be a string',
    });
  });

  it('rejects too-long description', () => {
    const res = validateCreateHookInput({ name: 'n', description: 'd'.repeat(MAX_HOOK_DESCRIPTION_LENGTH + 1) });
    expect(res.ok).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    expect(validateCreateHookInput({ name: 'n', enabled: 'yes' })).toEqual({
      ok: false,
      error: 'Hook enabled must be a boolean',
    });
  });

  it('defaults enabled to false and normalizes a flat command hook', () => {
    const res = validateCreateHookInput(base({ name: '  n  ' }));
    expect(res).toEqual({
      ok: true,
      value: { name: 'n', enabled: false, event: 'PreToolUse', action: { type: 'command', command: 'echo hi' } },
    });
  });

  it('keeps a provided description but normalizes explicit enabled to false', () => {
    const res = validateCreateHookInput(base({ description: 'desc', enabled: true }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.description).toBe('desc');
      expect(res.value.enabled).toBe(false);
    }
  });

  it('rejects a missing or invalid event', () => {
    expect(validateCreateHookInput({ name: 'n', action: validAction })).toEqual({
      ok: false,
      error: 'Hook event is invalid',
    });
    expect(validateCreateHookInput({ name: 'n', event: 'Nope', action: validAction })).toEqual({
      ok: false,
      error: 'Hook event is invalid',
    });
  });

  it('accepts every supported event', () => {
    for (const event of [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'PreCompact',
      'PostCompact',
    ]) {
      expect(validateCreateHookInput(base({ event })).ok).toBe(true);
    }
  });

  it('rejects a non-string matcher', () => {
    expect(validateCreateHookInput(base({ matcher: 5 }))).toEqual({ ok: false, error: 'Hook matcher must be a string' });
  });

  it('rejects a too-long matcher', () => {
    expect(validateCreateHookInput(base({ matcher: 'a'.repeat(MAX_HOOK_MATCHER_LENGTH + 1) })).ok).toBe(false);
  });

  it('accepts empty and wildcard matchers without regex compilation', () => {
    expect(validateCreateHookInput(base({ matcher: '' })).ok).toBe(true);
    expect(validateCreateHookInput(base({ event: 'PostToolUse', matcher: '*' })).ok).toBe(true);
  });

  it('rejects an invalid matcher regex', () => {
    expect(validateCreateHookInput(base({ matcher: '(' }))).toEqual({
      ok: false,
      error: 'Hook matcher is not a valid pattern',
    });
  });

  it('keeps a valid matcher regex on the normalized hook', () => {
    const res = validateCreateHookInput(base({ matcher: 'read.*' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.matcher).toBe('read.*');
  });

  it('rejects a missing or non-object action', () => {
    expect(validateCreateHookInput({ name: 'n', event: 'PreToolUse' })).toEqual({
      ok: false,
      error: 'Hook action must be an object',
    });
    expect(validateCreateHookInput(withAction(null))).toEqual({ ok: false, error: 'Hook action must be an object' });
  });

  it('rejects an unknown action type', () => {
    expect(validateCreateHookInput(withAction({ type: 'prompt' }))).toEqual({
      ok: false,
      error: 'Only command and http Hook actions are supported',
    });
  });

  it('rejects the deferred mcp_tool and agent action types', () => {
    expect(validateCreateHookInput(withAction({ type: 'mcp_tool' }))).toEqual({
      ok: false,
      error: 'Only command and http Hook actions are supported',
    });
    expect(validateCreateHookInput(withAction({ type: 'agent' }))).toEqual({
      ok: false,
      error: 'Only command and http Hook actions are supported',
    });
  });

  it('rejects a missing/empty command', () => {
    expect(validateCreateHookInput(withAction({ type: 'command', command: '   ' }))).toEqual({
      ok: false,
      error: 'Hook command is required',
    });
  });

  it('rejects a command blocked by the security policy', () => {
    const res = validateCreateHookInput(withAction({ type: 'command', command: 'rm -rf /' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('dangerous pattern');
  });

  it('rejects invalid command args and scans args with the command policy', () => {
    expect(validateCreateHookInput(withAction({ ...validAction, args: 'x' }))).toEqual({
      ok: false,
      error: 'Hook args must be an array',
    });
    expect(validateCreateHookInput(withAction({ ...validAction, args: ['safe', 5] }))).toEqual({
      ok: false,
      error: 'Hook args entries must be strings',
    });
    const blocked = validateCreateHookInput(withAction({ ...validAction, args: ['rm -rf /'] }));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain('dangerous pattern');
  });

  it('rejects a non-string if condition', () => {
    expect(validateCreateHookInput(withAction({ ...validAction, if: 5 }))).toEqual({
      ok: false,
      error: 'Hook if must be a string',
    });
  });

  it('treats a blank if condition as absent', () => {
    const res = validateCreateHookInput(withAction({ ...validAction, if: '   ' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect('if' in res.value.action).toBe(false);
  });

  it('rejects a too-long if condition', () => {
    expect(validateCreateHookInput(withAction({ ...validAction, if: 'x'.repeat(MAX_HOOK_IF_LENGTH + 1) })).ok).toBe(false);
  });

  it('keeps a trimmed if condition on the normalized command action', () => {
    const res = validateCreateHookInput(withAction({ ...validAction, if: '  execute_command(rm *)  ' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.action.if).toBe('execute_command(rm *)');
  });

  it('rejects a non-number / non-finite timeoutMs', () => {
    expect(validateCreateHookInput(withAction({ ...validAction, timeoutMs: 'x' }))).toEqual({
      ok: false,
      error: 'Hook timeoutMs must be a number',
    });
    expect(validateCreateHookInput(withAction({ ...validAction, timeoutMs: Number.NaN }))).toEqual({
      ok: false,
      error: 'Hook timeoutMs must be a number',
    });
  });

  it('rejects an out-of-range timeoutMs', () => {
    expect(validateCreateHookInput(withAction({ ...validAction, timeoutMs: MIN_HOOK_TIMEOUT_MS - 1 })).ok).toBe(false);
    expect(validateCreateHookInput(withAction({ ...validAction, timeoutMs: MAX_HOOK_TIMEOUT_MS + 1 })).ok).toBe(false);
  });

  it('rejects an invalid official timeout in seconds', () => {
    expect(validateCreateHookInput(withAction({ ...validAction, timeout: 'x' }))).toEqual({
      ok: false,
      error: 'Hook timeout must be a number of seconds',
    });
    expect(validateCreateHookInput(withAction({ ...validAction, timeout: MIN_HOOK_TIMEOUT_SECONDS - 0.01 })).ok).toBe(false);
    expect(validateCreateHookInput(withAction({ ...validAction, timeout: MAX_HOOK_TIMEOUT_SECONDS + 1 })).ok).toBe(false);
  });

  it('rejects a non-boolean async', () => {
    expect(validateCreateHookInput(withAction({ ...validAction, async: 'x' }))).toEqual({
      ok: false,
      error: 'Hook async must be a boolean',
    });
  });

  it('keeps a valid official timeout, args, and async on the normalized action', () => {
    const res = validateCreateHookInput(
      withAction({ ...validAction, args: ['--json'], timeout: 1, timeoutMs: 1000, async: true }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.action).toMatchObject({ args: ['--json'], timeout: 1 });
      expect('timeoutMs' in res.value.action).toBe(false);
      expect(res.value.action.async).toBe(true);
    }
  });

  it('keeps legacy timeoutMs when official timeout is omitted', () => {
    const res = validateCreateHookInput(withAction({ ...validAction, timeoutMs: 1000 }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.action).toMatchObject({ timeoutMs: 1000 });
  });

  const httpAction = (over: Record<string, unknown> = {}) => ({ type: 'http', url: 'https://example.com/hook', ...over });
  const httpInput = (over: Record<string, unknown> = {}) => withAction(httpAction(over), { event: 'Stop' });

  it('rejects a missing or empty http url', () => {
    expect(validateCreateHookInput(withAction({ type: 'http' }, { event: 'Stop' }))).toEqual({
      ok: false,
      error: 'Hook url is required',
    });
  });

  it('rejects a too-long http url', () => {
    const url = `https://example.com/${'a'.repeat(MAX_HOOK_URL_LENGTH)}`;
    expect(validateCreateHookInput(httpInput({ url })).ok).toBe(false);
  });

  it('rejects a blocked http url', () => {
    const res = validateCreateHookInput(httpInput({ url: 'http://127.0.0.1/x' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('blocked');
  });

  it('rejects an invalid http method', () => {
    expect(validateCreateHookInput(httpInput({ method: 'TRACE' }))).toEqual({ ok: false, error: 'Hook method is invalid' });
  });

  it('rejects non-object / non-string-value headers and too many headers', () => {
    expect(validateCreateHookInput(httpInput({ headers: 'x' }))).toEqual({
      ok: false,
      error: 'Hook headers must be an object',
    });
    expect(validateCreateHookInput(httpInput({ headers: { A: 5 } }))).toEqual({
      ok: false,
      error: 'Hook header values must be strings',
    });
    const headers: Record<string, string> = {};
    for (let i = 0; i <= MAX_HOOK_HTTP_HEADERS; i += 1) headers[`H${i}`] = 'v';
    expect(validateCreateHookInput(httpInput({ headers })).ok).toBe(false);
  });

  it('rejects oversized http header characters', () => {
    expect(validateCreateHookInput(httpInput({ headers: { A: 'v'.repeat(MAX_HOOK_HTTP_HEADER_CHARS + 1) } })).ok).toBe(false);
  });

  it('rejects a non-string and too-long http body', () => {
    expect(validateCreateHookInput(httpInput({ body: 5 }))).toEqual({ ok: false, error: 'Hook body must be a string' });
    expect(validateCreateHookInput(httpInput({ body: 'b'.repeat(MAX_HOOK_HTTP_BODY_LENGTH + 1) })).ok).toBe(false);
  });

  it('rejects an out-of-range http timeout', () => {
    expect(validateCreateHookInput(httpInput({ timeoutMs: MAX_HOOK_TIMEOUT_MS + 1 })).ok).toBe(false);
    expect(validateCreateHookInput(httpInput({ timeout: MAX_HOOK_TIMEOUT_SECONDS + 1 })).ok).toBe(false);
  });

  it('rejects a non-boolean http async', () => {
    expect(validateCreateHookInput(httpInput({ async: 'x' }))).toEqual({ ok: false, error: 'Hook async must be a boolean' });
  });

  it('rejects a non-string http if condition', () => {
    expect(validateCreateHookInput(httpInput({ if: 5 }))).toEqual({ ok: false, error: 'Hook if must be a string' });
  });

  it('normalizes a fully-specified http action including the if condition', () => {
    const res = validateCreateHookInput(
      httpInput({ if: 'execute_command(git *)', method: 'PUT', headers: { A: '1' }, body: 'x', timeout: 1, timeoutMs: 1000, async: true }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.action).toEqual({
        type: 'http',
        url: 'https://example.com/hook',
        if: 'execute_command(git *)',
        method: 'PUT',
        headers: { A: '1' },
        body: 'x',
        timeout: 1,
        async: true,
      });
    }
  });

  it('omits empty headers from a normalized http action', () => {
    const res = validateCreateHookInput(httpInput({ headers: {} }));
    expect(res.ok).toBe(true);
    if (res.ok) expect('headers' in res.value.action).toBe(false);
  });
});

describe('validateUpdateHookPatch', () => {
  it('rejects a non-object patch', () => {
    expect(validateUpdateHookPatch(null)).toEqual({ ok: false, error: 'Hook patch is required' });
  });

  it('returns an empty patch when no known keys are present', () => {
    expect(validateUpdateHookPatch({ unknown: 1 })).toEqual({ ok: true, value: {} });
  });

  it('validates and returns only present keys', () => {
    const res = validateUpdateHookPatch({
      name: ' renamed ',
      description: 'd',
      enabled: false,
      event: 'PreToolUse',
      matcher: 'Read',
      action: validAction,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({
        name: 'renamed',
        description: 'd',
        enabled: false,
        event: 'PreToolUse',
        matcher: 'Read',
        action: { type: 'command', command: 'echo hi' },
      });
    }
  });

  it('propagates a name error', () => {
    expect(validateUpdateHookPatch({ name: '' })).toEqual({ ok: false, error: 'Hook name is required' });
  });

  it('propagates a description error', () => {
    expect(validateUpdateHookPatch({ description: 5 })).toEqual({
      ok: false,
      error: 'Hook description must be a string',
    });
  });

  it('propagates an enabled error', () => {
    expect(validateUpdateHookPatch({ enabled: 'no' })).toEqual({
      ok: false,
      error: 'Hook enabled must be a boolean',
    });
  });

  it('propagates an event error', () => {
    expect(validateUpdateHookPatch({ event: 'Nope' })).toEqual({ ok: false, error: 'Hook event is invalid' });
  });

  it('propagates a matcher error', () => {
    expect(validateUpdateHookPatch({ matcher: 5 })).toEqual({ ok: false, error: 'Hook matcher must be a string' });
  });

  it('propagates an action error', () => {
    expect(validateUpdateHookPatch({ action: null })).toEqual({ ok: false, error: 'Hook action must be an object' });
  });

  it('allows clearing description and matcher to undefined', () => {
    expect(validateUpdateHookPatch({ description: undefined })).toEqual({ ok: true, value: { description: undefined } });
    expect(validateUpdateHookPatch({ matcher: undefined })).toEqual({ ok: true, value: { matcher: undefined } });
  });

  it('defaults enabled to true when the key is present but undefined', () => {
    expect(validateUpdateHookPatch({ enabled: undefined })).toEqual({ ok: true, value: { enabled: true } });
  });
});
