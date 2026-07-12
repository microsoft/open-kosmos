import {
  emptyOperationForm,
  emptyFormState,
  formStateToCreateInput,
  formStateToUpdatePatch,
  headersToText,
  hookToFormState,
  parseHeaders,
  operationToAction,
  validateFormState,
  HOOK_EVENTS,
  type HookFormState,
} from '../hookFormModel';
import type { HookDefinition } from '@shared/ipc/agentHooks';

const baseState = (overrides: Partial<HookFormState> = {}): HookFormState => ({
  ...emptyFormState(),
  ...overrides,
});

const baseHook = (overrides: Partial<HookDefinition> = {}): HookDefinition => ({
  id: 'h1',
  name: 'My Hook',
  description: 'desc',
  version: '1.0.0',
  source: 'ON-DEVICE',
  enabled: true,
  event: 'PreToolUse',
  matcher: 'execute_command',
  action: { type: 'command', command: 'echo' },
  createdAt: 't',
  updatedAt: 't',
  ...overrides,
});

describe('hookFormModel defaults', () => {
  it('exposes all lifecycle events', () => {
    expect(HOOK_EVENTS).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'PreCompact',
      'PostCompact',
    ]);
  });

  it('emptyOperationForm has flat hook defaults', () => {
    expect(emptyOperationForm()).toEqual({
      event: 'PreToolUse',
      matcher: '',
      actionType: 'command',
      ifCondition: '',
      command: '',
      execForm: false,
      argsText: '',
      url: '',
      method: 'POST',
      headersText: '',
      body: '',
      timeout: '',
      async: false,
    });
  });

  it('emptyFormState starts disabled with one empty operation', () => {
    const state = emptyFormState();
    expect(state.enabled).toBe(false);
    expect(state.operation).toEqual(emptyOperationForm());
  });
});

describe('hookToFormState', () => {
  it('projects a command hook including matcher, if condition, args, timeout, and async', () => {
    const state = hookToFormState(baseHook({
      enabled: false,
      action: { type: 'command', if: 'execute_command(rm *)', command: 'echo a', timeout: 1.5, args: ['--json'], async: true },
    }));

    expect(state).toEqual({
      name: 'My Hook',
      description: 'desc',
      enabled: false,
      operation: {
        ...emptyOperationForm(),
        event: 'PreToolUse',
        matcher: 'execute_command',
        ifCondition: 'execute_command(rm *)',
        command: 'echo a',
        execForm: true,
        argsText: '--json',
        timeout: '1.5',
        async: true,
      },
    });
  });

  it('uses defaults for optional command hook fields and timeoutMs', () => {
    const state = hookToFormState(baseHook({
      description: undefined,
      matcher: undefined,
      action: { type: 'command', command: 'notify', timeoutMs: 2500 },
    }));

    expect(state.description).toBe('');
    expect(state.operation).toEqual({
      ...emptyOperationForm(),
      event: 'PreToolUse',
      command: 'notify',
      timeout: '2.5',
    });
  });

  it('projects an http hook including if condition, headers, body, timeout, and async', () => {
    const state = hookToFormState(baseHook({
      event: 'PostCompact',
      matcher: undefined,
      action: {
        type: 'http',
        if: 'write_file(*.ts)',
        url: 'https://h.test/x',
        method: 'GET',
        headers: { K: 'v' },
        body: 'b',
        timeout: 1,
        async: true,
      },
    }));

    expect(state.operation).toEqual({
      ...emptyOperationForm(),
      event: 'PostCompact',
      actionType: 'http',
      ifCondition: 'write_file(*.ts)',
      url: 'https://h.test/x',
      method: 'GET',
      headersText: 'K: v',
      body: 'b',
      timeout: '1',
      async: true,
    });
  });

  it('defaults http method and optional fields when absent', () => {
    const state = hookToFormState(baseHook({
      matcher: undefined,
      action: { type: 'http', url: 'https://h.test/y', timeoutMs: 3000 },
    }));

    expect(state.operation.actionType).toBe('http');
    expect(state.operation.method).toBe('POST');
    expect(state.operation.headersText).toBe('');
    expect(state.operation.body).toBe('');
    expect(state.operation.ifCondition).toBe('');
    expect(state.operation.timeout).toBe('3');
  });
});

describe('operationToAction', () => {
  it('skips an operation with a blank command', () => {
    expect(operationToAction({ ...emptyOperationForm(), command: '   ' })).toBeUndefined();
  });

  it('builds a trimmed command action with if, timeout, and async', () => {
    expect(operationToAction({
      ...emptyOperationForm(),
      ifCondition: '  execute_command(rm *)  ',
      command: '  run  ',
      timeout: '2',
      async: true,
    })).toEqual({ type: 'command', command: 'run', if: 'execute_command(rm *)', timeout: 2, async: true });
  });

  it('builds a command action with exec-form args and drops invalid timeout', () => {
    expect(operationToAction({
      ...emptyOperationForm(),
      command: 'node',
      execForm: true,
      argsText: 'guard.js\n--flag value',
      timeout: 'abc',
    })).toEqual({ type: 'command', command: 'node', args: ['guard.js', '--flag value'] });
  });

  it('keeps an empty args array for enabled exec form with blank args text', () => {
    expect(operationToAction({ ...emptyOperationForm(), command: 'node', execForm: true })).toEqual({
      type: 'command',
      command: 'node',
      args: [],
    });
  });

  it('skips http operations with a blank URL', () => {
    expect(operationToAction({ ...emptyOperationForm(), actionType: 'http', url: '   ' })).toBeUndefined();
  });

  it('builds an http action with method, if, parsed headers, body, timeout, and async', () => {
    expect(operationToAction({
      ...emptyOperationForm(),
      actionType: 'http',
      ifCondition: 'execute_command(curl *)',
      url: ' https://example.com/hook ',
      method: 'PUT',
      headersText: 'Authorization: Bearer x\nX-Trace: 1',
      body: '{"a":1}',
      timeout: '3',
      async: true,
    })).toEqual({
      type: 'http',
      url: 'https://example.com/hook',
      if: 'execute_command(curl *)',
      method: 'PUT',
      headers: { Authorization: 'Bearer x', 'X-Trace': '1' },
      body: '{"a":1}',
      timeout: 3,
      async: true,
    });
  });

  it('omits optional http fields when empty', () => {
    expect(operationToAction({
      ...emptyOperationForm(),
      actionType: 'http',
      url: 'https://example.com/hook',
      headersText: '   ',
      body: '   ',
      ifCondition: '  ',
    })).toEqual({ type: 'http', url: 'https://example.com/hook', method: 'POST' });
  });
});

describe('header helpers', () => {
  it('headersToText serializes entries and returns empty for undefined', () => {
    expect(headersToText(undefined)).toBe('');
    expect(headersToText({ A: '1', B: '2' })).toBe('A: 1\nB: 2');
  });

  it('parseHeaders parses lines, trims, and skips malformed entries', () => {
    expect(parseHeaders('A: 1\n  \nB:2\nnocolon\n: noKey\nC:')).toEqual({ A: '1', B: '2', C: '' });
  });
});

describe('formStateToCreateInput', () => {
  it('trims command input and writes flat create fields with matcher and if condition', () => {
    const input = formStateToCreateInput(baseState({
      name: '  Hook  ',
      description: '  d  ',
      enabled: true,
      operation: {
        ...emptyOperationForm(),
        event: 'PostToolUse',
        matcher: '  execute_command  ',
        ifCondition: ' edit_file(*.ts) ',
        command: ' go ',
        timeout: '4',
      },
    }));

    expect(input).toEqual({
      name: 'Hook',
      description: 'd',
      enabled: false,
      event: 'PostToolUse',
      matcher: 'execute_command',
      action: { type: 'command', command: 'go', if: 'edit_file(*.ts)', timeout: 4 },
    });
  });

  it('omits blank description, matcher, and incomplete action', () => {
    const input = formStateToCreateInput(baseState({
      name: 'Hook',
      description: '   ',
      operation: { ...emptyOperationForm(), matcher: '   ', command: '   ' },
    }));

    expect(input).toEqual({ name: 'Hook', enabled: false, event: 'PreToolUse' });
  });

  it('writes flat http create action with async and no matcher', () => {
    const input = formStateToCreateInput(baseState({
      name: 'Hook',
      operation: { ...emptyOperationForm(), actionType: 'http', event: 'Stop', url: 'https://h.test', async: true },
    }));

    expect(input).toEqual({
      name: 'Hook',
      enabled: false,
      event: 'Stop',
      action: { type: 'http', url: 'https://h.test', method: 'POST', async: true },
    });
  });
});

describe('formStateToUpdatePatch', () => {
  it('always includes flat core fields and re-enables the hook', () => {
    const patch = formStateToUpdatePatch(baseState({
      name: ' Renamed ',
      description: 'x',
      enabled: false,
      operation: {
        ...emptyOperationForm(),
        event: 'Stop',
        matcher: '  ',
        command: 'go',
        ifCondition: 'execute_command(git *)',
      },
    }));

    expect(patch).toEqual({
      name: 'Renamed',
      description: 'x',
      enabled: true,
      event: 'Stop',
      matcher: '',
      action: { type: 'command', command: 'go', if: 'execute_command(git *)' },
    });
  });

  it('omits action from an update patch when the operation is incomplete', () => {
    const patch = formStateToUpdatePatch(baseState({
      name: 'Hook',
      operation: { ...emptyOperationForm(), actionType: 'http', url: ' ' },
    }));

    expect(patch).toEqual({
      name: 'Hook',
      description: '',
      enabled: true,
      event: 'PreToolUse',
      matcher: '',
    });
  });

  it('writes a flat http update action with matcher, headers, and if condition', () => {
    const patch = formStateToUpdatePatch(baseState({
      name: 'Hook',
      operation: {
        ...emptyOperationForm(),
        actionType: 'http',
        event: 'PostToolUseFailure',
        matcher: 'Fetch',
        ifCondition: 'Fetch(*)',
        url: 'https://h.test/fail',
        method: 'PATCH',
        headersText: 'A: 1',
      },
    }));

    expect(patch).toEqual({
      name: 'Hook',
      description: '',
      enabled: true,
      event: 'PostToolUseFailure',
      matcher: 'Fetch',
      action: { type: 'http', url: 'https://h.test/fail', if: 'Fetch(*)', method: 'PATCH', headers: { A: '1' } },
    });
  });
});

describe('validateFormState', () => {
  it('passes for a valid command form with numeric timeout', () => {
    expect(validateFormState(baseState({
      name: 'Hook',
      operation: { ...emptyOperationForm(), command: 'go', timeout: '1' },
    }))).toEqual([]);
  });

  it('flags a missing name', () => {
    expect(validateFormState(baseState({
      name: '   ',
      operation: { ...emptyOperationForm(), command: 'go' },
    }))).toContain('Name is required.');
  });

  it('flags when no command or URL is configured', () => {
    expect(validateFormState(baseState({ name: 'Hook', operation: emptyOperationForm() }))).toContain(
      'Configure one hook operation with a command or URL.',
    );
  });

  it('accepts an http operation with only a URL', () => {
    expect(validateFormState(baseState({
      name: 'Hook',
      operation: { ...emptyOperationForm(), actionType: 'http', url: 'https://example.com/hook' },
    }))).toEqual([]);
  });

  it('flags a non-numeric timeout on an http operation', () => {
    expect(validateFormState(baseState({
      name: 'Hook',
      operation: { ...emptyOperationForm(), actionType: 'http', url: 'https://example.com/hook', timeout: 'abc' },
    }))).toContain('Timeout must be a number.');
  });

  it('flags a non-numeric timeout on a command operation', () => {
    expect(validateFormState(baseState({
      name: 'Hook',
      operation: { ...emptyOperationForm(), command: 'go', timeout: 'abc' },
    }))).toContain('Timeout must be a number.');
  });

  it('ignores a blank timeout', () => {
    expect(validateFormState(baseState({
      name: 'Hook',
      operation: { ...emptyOperationForm(), command: 'go', timeout: '  ' },
    }))).toEqual([]);
  });
});
