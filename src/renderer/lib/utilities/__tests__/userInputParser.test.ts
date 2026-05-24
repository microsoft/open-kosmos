import { describe, it, expect, vi } from 'vitest';
import {
  parseUserInputVariables,
  parseUserInputVariable,
  convertUserInputValue,
  validateUserInputValue,
  applyUserInputsToEnv,
  type UserInputVariable
} from '../userInputParser';

vi.mock('../logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

describe('parseUserInputVariables', () => {
  it('returns empty result for empty env', () => {
    const result = parseUserInputVariables({});
    expect(result.variables).toHaveLength(0);
    expect(result.hasUserInputs).toBe(false);
  });

  it('returns empty result for non-object input', () => {
    const result = parseUserInputVariables(null as any);
    expect(result.variables).toHaveLength(0);
    expect(result.hasUserInputs).toBe(false);
  });

  it('ignores non-USER_INPUT values', () => {
    const result = parseUserInputVariables({ FOO: 'bar', BAZ: 'qux' });
    expect(result.hasUserInputs).toBe(false);
  });

  it('parses valid USER_INPUT variables', () => {
    const result = parseUserInputVariables({
      MY_PATH: '@USER_INPUT_STRING_FOLDER_REQUIRED_myPath',
      MY_NAME: '@USER_INPUT_STRING_TEXT_OPTIONAL_myName'
    });
    expect(result.hasUserInputs).toBe(true);
    expect(result.variables).toHaveLength(2);
  });

  it('skips invalid USER_INPUT values', () => {
    const result = parseUserInputVariables({
      BAD: '@USER_INPUT_INVALID_FORMAT'
    });
    expect(result.hasUserInputs).toBe(false);
  });
});

describe('parseUserInputVariable', () => {
  it('parses STRING FOLDER REQUIRED', () => {
    const result = parseUserInputVariable('MY_DIR', '@USER_INPUT_STRING_FOLDER_REQUIRED_myDir');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('STRING');
    expect(result!.control).toBe('folder');
    expect(result!.isRequired).toBe(true);
    expect(result!.variableName).toBe('myDir');
    expect(result!.key).toBe('MY_DIR');
  });

  it('parses STRING FILE OPTIONAL', () => {
    const result = parseUserInputVariable('MY_FILE', '@USER_INPUT_STRING_FILE_OPTIONAL_myFile');
    expect(result).not.toBeNull();
    expect(result!.control).toBe('file');
    expect(result!.isRequired).toBe(false);
  });

  it('parses INT TEXT REQUIRED', () => {
    const result = parseUserInputVariable('COUNT', '@USER_INPUT_INT_TEXT_REQUIRED_count');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('INT');
    expect(result!.control).toBe('text');
  });

  it('parses DOUBLE TEXT OPTIONAL', () => {
    const result = parseUserInputVariable('RATE', '@USER_INPUT_DOUBLE_TEXT_OPTIONAL_rate');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('DOUBLE');
  });

  it('parses BOOLEAN TEXT REQUIRED', () => {
    const result = parseUserInputVariable('FLAG', '@USER_INPUT_BOOLEAN_TEXT_REQUIRED_flag');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('BOOLEAN');
  });

  it('returns null for invalid format', () => {
    expect(parseUserInputVariable('X', '@USER_INPUT_')).toBeNull();
    expect(parseUserInputVariable('X', 'REGULAR_VALUE')).toBeNull();
  });

  it('returns null for invalid type', () => {
    expect(parseUserInputVariable('X', '@USER_INPUT_UNKNOWN_TEXT_REQUIRED_key')).toBeNull();
  });

  it('returns null for invalid control', () => {
    expect(parseUserInputVariable('X', '@USER_INPUT_STRING_RADIO_REQUIRED_key')).toBeNull();
  });

  it('returns null for INT with FOLDER control', () => {
    expect(parseUserInputVariable('X', '@USER_INPUT_INT_FOLDER_REQUIRED_key')).toBeNull();
  });

  it('returns null for BOOLEAN with FILE control', () => {
    expect(parseUserInputVariable('X', '@USER_INPUT_BOOLEAN_FILE_REQUIRED_key')).toBeNull();
  });

  it('returns null for DOUBLE with FOLDER control', () => {
    expect(parseUserInputVariable('X', '@USER_INPUT_DOUBLE_FOLDER_OPTIONAL_key')).toBeNull();
  });
});

describe('convertUserInputValue', () => {
  it('returns string as-is for STRING type', () => {
    expect(convertUserInputValue('hello', 'STRING')).toBe('hello');
  });

  it('converts valid int', () => {
    expect(convertUserInputValue('42', 'INT')).toBe(42);
  });

  it('throws for invalid int', () => {
    expect(() => convertUserInputValue('abc', 'INT')).toThrow('Invalid integer value: abc');
  });

  it('converts valid double', () => {
    expect(convertUserInputValue('3.14', 'DOUBLE')).toBeCloseTo(3.14);
  });

  it('throws for invalid double', () => {
    expect(() => convertUserInputValue('xyz', 'DOUBLE')).toThrow('Invalid double value: xyz');
  });

  it('converts truthy boolean values', () => {
    expect(convertUserInputValue('true', 'BOOLEAN')).toBe(true);
    expect(convertUserInputValue('1', 'BOOLEAN')).toBe(true);
    expect(convertUserInputValue('yes', 'BOOLEAN')).toBe(true);
    expect(convertUserInputValue('YES', 'BOOLEAN')).toBe(true);
  });

  it('converts falsy boolean values', () => {
    expect(convertUserInputValue('false', 'BOOLEAN')).toBe(false);
    expect(convertUserInputValue('0', 'BOOLEAN')).toBe(false);
    expect(convertUserInputValue('no', 'BOOLEAN')).toBe(false);
  });

  it('throws for invalid boolean value', () => {
    expect(() => convertUserInputValue('maybe', 'BOOLEAN')).toThrow('Invalid boolean value: maybe');
  });
});

describe('validateUserInputValue', () => {
  const makeVar = (overrides: Partial<UserInputVariable> = {}): UserInputVariable => ({
    key: 'KEY',
    type: 'STRING',
    control: 'text',
    variableName: 'key',
    originalValue: '@USER_INPUT_STRING_TEXT_REQUIRED_key',
    isRequired: true,
    ...overrides
  });

  it('returns invalid when empty and required', () => {
    const result = validateUserInputValue('', makeVar({ isRequired: true }));
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('This field is required');
  });

  it('returns valid when empty and optional', () => {
    const result = validateUserInputValue('', makeVar({ isRequired: false }));
    expect(result.isValid).toBe(true);
  });

  it('returns valid for valid string', () => {
    const result = validateUserInputValue('hello', makeVar({ type: 'STRING' }));
    expect(result.isValid).toBe(true);
  });

  it('returns invalid for bad int value', () => {
    const result = validateUserInputValue('notanint', makeVar({ type: 'INT' }));
    expect(result.isValid).toBe(false);
  });

  it('returns valid for good int value', () => {
    const result = validateUserInputValue('10', makeVar({ type: 'INT' }));
    expect(result.isValid).toBe(true);
  });
});

describe('applyUserInputsToEnv', () => {
  it('replaces placeholder with user input', () => {
    const env = { PATH_KEY: '@USER_INPUT_STRING_FOLDER_REQUIRED_path' };
    const result = applyUserInputsToEnv(env, { PATH_KEY: '/some/path' });
    expect(result['PATH_KEY']).toBe('/some/path');
  });

  it('removes optional placeholder when no input provided', () => {
    const env = { OPT_KEY: '@USER_INPUT_STRING_TEXT_OPTIONAL_optKey' };
    const result = applyUserInputsToEnv(env, {});
    expect('OPT_KEY' in result).toBe(false);
  });

  it('keeps required placeholder when no input provided', () => {
    const env = { REQ_KEY: '@USER_INPUT_STRING_TEXT_REQUIRED_reqKey' };
    const result = applyUserInputsToEnv(env, {});
    expect(result['REQ_KEY']).toBe('@USER_INPUT_STRING_TEXT_REQUIRED_reqKey');
  });

  it('does not modify non-USER_INPUT keys', () => {
    const env = { NORMAL: 'value', OPT: '@USER_INPUT_STRING_TEXT_OPTIONAL_opt' };
    const result = applyUserInputsToEnv(env, { OPT: 'filled' });
    expect(result['NORMAL']).toBe('value');
    expect(result['OPT']).toBe('filled');
  });

  it('converts non-string user input values to strings', () => {
    const env = { COUNT: '@USER_INPUT_INT_TEXT_REQUIRED_count' };
    const result = applyUserInputsToEnv(env, { COUNT: 42 });
    expect(result['COUNT']).toBe('42');
  });
});
