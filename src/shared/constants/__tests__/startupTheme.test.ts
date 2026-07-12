import { describe, expect, it } from 'vitest';
import {
  buildInitialThemeSourceArgument,
  INITIAL_THEME_SOURCE_ARG,
  isInitialThemeSource,
  parseInitialThemeSourceArgument,
} from '../startupTheme';

describe('startupTheme constants', () => {
  it('builds and parses supported initial theme source arguments', () => {
    const arg = buildInitialThemeSourceArgument('dark');

    expect(arg).toBe(`${INITIAL_THEME_SOURCE_ARG}dark`);
    expect(parseInitialThemeSourceArgument(['--other', arg])).toBe('dark');
  });

  it('rejects missing, invalid, and malformed initial theme source arguments', () => {
    expect(parseInitialThemeSourceArgument([])).toBeUndefined();
    expect(parseInitialThemeSourceArgument([`${INITIAL_THEME_SOURCE_ARG}sepia`])).toBeUndefined();
    expect(parseInitialThemeSourceArgument([`${INITIAL_THEME_SOURCE_ARG}%E0%A4%A`])).toBeUndefined();
  });

  it('identifies valid initial theme source values', () => {
    expect(isInitialThemeSource('light')).toBe(true);
    expect(isInitialThemeSource('dark')).toBe(true);
    expect(isInitialThemeSource('system')).toBe(true);
    expect(isInitialThemeSource('sepia')).toBe(false);
  });
});
