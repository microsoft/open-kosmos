// @ts-nocheck
import {
  applyUserInputsToArgs,
  applyUserInputsToEnv,
  applyUserInputsToUrl,
  convertUserInputValue,
  validateUserInputValue,
  parseUserInputPlaceholders,
  UserInputField,
} from '../processUserInputPlaceholder';

const makeField = (overrides: Partial<UserInputField> & Pick<UserInputField, 'key' | 'originalValue'>): UserInputField => ({
  type: 'STRING',
  control: 'text',
  varName: overrides.key,
  isRequired: false,
  label: overrides.key,
  ...overrides,
});

describe('applyUserInputsToArgs', () => {
  it('passes through args with no placeholders', () => {
    const result = applyUserInputsToArgs(['mcp', 'bluebird'], {}, []);
    expect(result).toEqual(['mcp', 'bluebird']);
  });

  it('replaces placeholder with user input', () => {
    const fields = [
      makeField({ key: 'org', originalValue: '@USER_INPUT_ORG', isRequired: true }),
    ];
    const result = applyUserInputsToArgs(
      ['mcp', 'bluebird', '--organization', '@USER_INPUT_ORG'],
      { org: 'acme' },
      fields,
    );
    expect(result).toEqual(['mcp', 'bluebird', '--organization', 'acme']);
  });

  it('removes --flag and placeholder for optional empty input', () => {
    const fields = [
      makeField({ key: 'org', originalValue: '@USER_INPUT_ORG' }),
      makeField({ key: 'proj', originalValue: '@USER_INPUT_PROJ' }),
    ];
    const result = applyUserInputsToArgs(
      ['mcp', 'bluebird', '--organization', '@USER_INPUT_ORG', '--project', '@USER_INPUT_PROJ'],
      { org: '', proj: '' },
      fields,
    );
    expect(result).toEqual(['mcp', 'bluebird']);
  });

  it('removes only empty optional args, keeps filled ones', () => {
    const fields = [
      makeField({ key: 'org', originalValue: '@USER_INPUT_ORG' }),
      makeField({ key: 'proj', originalValue: '@USER_INPUT_PROJ' }),
    ];
    const result = applyUserInputsToArgs(
      ['mcp', 'bluebird', '--organization', '@USER_INPUT_ORG', '--project', '@USER_INPUT_PROJ'],
      { org: 'acme', proj: '' },
      fields,
    );
    expect(result).toEqual(['mcp', 'bluebird', '--organization', 'acme']);
  });

  it('keeps required field placeholder when input is empty', () => {
    const fields = [
      makeField({ key: 'org', originalValue: '@USER_INPUT_ORG', isRequired: true }),
    ];
    const result = applyUserInputsToArgs(
      ['mcp', 'bluebird', '--organization', '@USER_INPUT_ORG'],
      { org: '' },
      fields,
    );
    // Required field with empty input → still outputs the (empty) string value
    expect(result).toEqual(['mcp', 'bluebird', '--organization', '']);
  });

  it('converts non-string values to strings', () => {
    const fields = [
      makeField({ key: 'port', originalValue: '@USER_INPUT_PORT', isRequired: true }),
    ];
    const result = applyUserInputsToArgs(
      ['--port', '@USER_INPUT_PORT'],
      { port: 8080 },
      fields,
    );
    expect(result).toEqual(['--port', '8080']);
  });

  it('removes optional placeholder with no preceding --flag', () => {
    const fields = [makeField({ key: 'opt', originalValue: '@USER_INPUT_OPT' })];
    const result = applyUserInputsToArgs(['@USER_INPUT_OPT'], { opt: '' }, fields);
    expect(result).toEqual([]);
  });

  it('removes optional placeholder when value is null', () => {
    const fields = [makeField({ key: 'opt', originalValue: '@USER_INPUT_OPT' })];
    const result = applyUserInputsToArgs(['--flag', '@USER_INPUT_OPT'], { opt: null }, fields);
    expect(result).toEqual([]);
  });

  it('removes optional placeholder when value is undefined', () => {
    const fields = [makeField({ key: 'opt', originalValue: '@USER_INPUT_OPT' })];
    const result = applyUserInputsToArgs(['--flag', '@USER_INPUT_OPT'], { opt: undefined }, fields);
    expect(result).toEqual([]);
  });
});

describe('applyUserInputsToEnv', () => {
  it('returns original env when fields is empty', () => {
    const env = { FOO: 'bar' };
    expect(applyUserInputsToEnv(env, {}, [])).toEqual({ FOO: 'bar' });
  });

  it('replaces env var for a field that has input', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'API_KEY', originalValue: '@USER_INPUT_API_KEY', isRequired: true }),
    ];
    const result = applyUserInputsToEnv({ API_KEY: '@USER_INPUT_API_KEY' }, { API_KEY: 'secret' }, fields);
    expect(result).toEqual({ API_KEY: 'secret' });
  });

  it('removes optional env var when input is empty string', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'OPT_KEY', originalValue: '@USER_INPUT_OPT_KEY' }),
    ];
    const result = applyUserInputsToEnv({ OPT_KEY: '@USER_INPUT_OPT_KEY' }, { OPT_KEY: '' }, fields);
    expect(result).not.toHaveProperty('OPT_KEY');
  });

  it('removes optional env var when input is null', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'OPT_KEY', originalValue: '@USER_INPUT_OPT_KEY' }),
    ];
    const result = applyUserInputsToEnv({ OPT_KEY: '@USER_INPUT_OPT_KEY' }, { OPT_KEY: null }, fields);
    expect(result).not.toHaveProperty('OPT_KEY');
  });

  it('removes optional env var when input is undefined', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'OPT_KEY', originalValue: '@USER_INPUT_OPT_KEY' }),
    ];
    const result = applyUserInputsToEnv({ OPT_KEY: '@USER_INPUT_OPT_KEY' }, { OPT_KEY: undefined }, fields);
    expect(result).not.toHaveProperty('OPT_KEY');
  });

  it('removes optional env var when key is absent from userInputs (undefined value)', () => {
    // When userInputs doesn't contain the field key at all, inputValue is undefined -> treated as empty
    // For an optional field with empty input, the env var is deleted
    const fields: UserInputField[] = [
      makeField({ key: 'MISSING', originalValue: '@USER_INPUT_MISSING' }),
    ];
    const result = applyUserInputsToEnv({ MISSING: '@USER_INPUT_MISSING' }, {}, fields);
    expect(result).not.toHaveProperty('MISSING');
  });

  it('converts non-string input to string', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'COUNT', originalValue: '@USER_INPUT_COUNT', isRequired: true }),
    ];
    const result = applyUserInputsToEnv({ COUNT: '@USER_INPUT_COUNT' }, { COUNT: 42 }, fields);
    expect(result).toEqual({ COUNT: '42' });
  });

  it('skips required field when key is absent from userInputs', () => {
    // isRequired=true + key absent -> isInputEmpty=true, !isRequired=false -> first branch false
    // then hasOwnProperty=false -> second branch false -> no update
    const fields: UserInputField[] = [
      makeField({ key: 'REQUIRED_KEY', originalValue: '@USER_INPUT_REQUIRED', isRequired: true }),
    ];
    const result = applyUserInputsToEnv({ REQUIRED_KEY: '@USER_INPUT_REQUIRED' }, {}, fields);
    // Key is absent from userInputs so env var remains unchanged
    expect(result).toEqual({ REQUIRED_KEY: '@USER_INPUT_REQUIRED' });
  });
});

describe('applyUserInputsToUrl', () => {
  it('returns original url when fields is empty', () => {
    expect(applyUserInputsToUrl('http://example.com', {}, [])).toBe('http://example.com');
  });

  it('returns falsy url unchanged', () => {
    expect(applyUserInputsToUrl('', {}, [])).toBe('');
  });

  it('replaces url when field key is "url" and value is provided', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'url', originalValue: '@USER_INPUT_URL', isRequired: true }),
    ];
    const result = applyUserInputsToUrl('@USER_INPUT_URL', { url: 'http://new.com' }, fields);
    expect(result).toBe('http://new.com');
  });

  it('does not replace url when field key is not "url"', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'other', originalValue: '@USER_INPUT_OTHER' }),
    ];
    const result = applyUserInputsToUrl('http://original.com', { other: 'http://new.com' }, fields);
    expect(result).toBe('http://original.com');
  });

  it('does not replace url when value is null', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'url', originalValue: '@USER_INPUT_URL' }),
    ];
    const result = applyUserInputsToUrl('http://original.com', { url: null }, fields);
    expect(result).toBe('http://original.com');
  });

  it('does not replace url when value is undefined', () => {
    const fields: UserInputField[] = [
      makeField({ key: 'url', originalValue: '@USER_INPUT_URL' }),
    ];
    const result = applyUserInputsToUrl('http://original.com', { url: undefined }, fields);
    expect(result).toBe('http://original.com');
  });
});

describe('convertUserInputValue', () => {
  it('returns null as-is', () => {
    expect(convertUserInputValue(null as any, 'STRING')).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(convertUserInputValue(undefined as any, 'STRING')).toBeUndefined();
  });

  it('returns empty string as-is', () => {
    expect(convertUserInputValue('', 'INT')).toBe('');
  });

  it('converts STRING', () => {
    expect(convertUserInputValue('hello', 'STRING')).toBe('hello');
  });

  it('converts INT', () => {
    expect(convertUserInputValue('42', 'INT')).toBe(42);
  });

  it('throws on invalid INT', () => {
    expect(() => convertUserInputValue('abc', 'INT')).toThrow('Invalid integer value: abc');
  });

  it('converts DOUBLE', () => {
    expect(convertUserInputValue('3.14', 'DOUBLE')).toBeCloseTo(3.14);
  });

  it('throws on invalid DOUBLE', () => {
    expect(() => convertUserInputValue('xyz', 'DOUBLE')).toThrow('Invalid double value: xyz');
  });

  it('converts BOOLEAN true values', () => {
    expect(convertUserInputValue('true', 'BOOLEAN')).toBe(true);
    expect(convertUserInputValue('1', 'BOOLEAN')).toBe(true);
    expect(convertUserInputValue('yes', 'BOOLEAN')).toBe(true);
  });

  it('converts BOOLEAN false values', () => {
    expect(convertUserInputValue('false', 'BOOLEAN')).toBe(false);
    expect(convertUserInputValue('0', 'BOOLEAN')).toBe(false);
    expect(convertUserInputValue('no', 'BOOLEAN')).toBe(false);
  });

  it('throws on invalid BOOLEAN', () => {
    expect(() => convertUserInputValue('maybe', 'BOOLEAN')).toThrow('Invalid boolean value: maybe');
  });

  it('returns value for unknown type (default branch)', () => {
    expect(convertUserInputValue('val', 'UNKNOWN' as any)).toBe('val');
  });
});

describe('validateUserInputValue', () => {
  it('returns invalid for required field with empty value', () => {
    const field = makeField({ key: 'k', originalValue: '@v', isRequired: true });
    expect(validateUserInputValue('', field)).toEqual({ isValid: false, error: 'This field is required' });
  });

  it('returns invalid for required field with whitespace-only value', () => {
    const field = makeField({ key: 'k', originalValue: '@v', isRequired: true });
    expect(validateUserInputValue('   ', field)).toEqual({ isValid: false, error: 'This field is required' });
  });

  it('returns valid for optional field with empty value', () => {
    const field = makeField({ key: 'k', originalValue: '@v' });
    expect(validateUserInputValue('', field)).toEqual({ isValid: true });
  });

  it('returns valid for correct INT value', () => {
    const field = makeField({ key: 'k', originalValue: '@v', type: 'INT' });
    expect(validateUserInputValue('10', field)).toEqual({ isValid: true });
  });

  it('returns invalid for bad INT value with error message', () => {
    const field = makeField({ key: 'k', originalValue: '@v', type: 'INT' });
    const result = validateUserInputValue('bad', field);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid integer/);
  });

  it('returns invalid with generic error when non-Error is thrown', () => {
    const field = makeField({ key: 'k', originalValue: '@v', type: 'BOOLEAN' });
    const result = validateUserInputValue('maybe', field);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('parseUserInputPlaceholders', () => {
  beforeEach(() => {
    // @ts-ignore
    global.window = {
      electronAPI: {
        openkosmos: {
          parseUserInputPlaceholders: vi.fn(),
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed fields on success', async () => {
    const mockResult = { fields: [{ key: 'k' }], hasUserInputFields: true };
    // @ts-ignore
    window.electronAPI.openkosmos.parseUserInputPlaceholders.mockResolvedValue({
      success: true,
      data: mockResult,
    });
    const result = await parseUserInputPlaceholders({ env: {} });
    expect(result).toEqual(mockResult);
  });

  it('returns empty result on failure response', async () => {
    // @ts-ignore
    window.electronAPI.openkosmos.parseUserInputPlaceholders.mockResolvedValue({
      success: false,
      error: 'some error',
    });
    const result = await parseUserInputPlaceholders({});
    expect(result).toEqual({ fields: [], hasUserInputFields: false });
  });

  it('returns empty result on thrown error', async () => {
    // @ts-ignore
    window.electronAPI.openkosmos.parseUserInputPlaceholders.mockRejectedValue(new Error('IPC fail'));
    const result = await parseUserInputPlaceholders({});
    expect(result).toEqual({ fields: [], hasUserInputFields: false });
  });
});
