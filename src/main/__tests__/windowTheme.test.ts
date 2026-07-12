import { describe, expect, it } from 'vitest';
import {
  getWindowBackgroundColor,
  resolveEffectiveWindowTheme,
  WINDOW_BACKGROUND_DARK,
  WINDOW_BACKGROUND_LIGHT,
} from '../lib/windowTheme';

describe('windowTheme', () => {
  it('resolves explicit and missing theme sources', () => {
    expect(resolveEffectiveWindowTheme('dark', { shouldUseDarkColors: false })).toBe('dark');
    expect(resolveEffectiveWindowTheme('light', { shouldUseDarkColors: true })).toBe('light');
    expect(resolveEffectiveWindowTheme(undefined, { shouldUseDarkColors: true })).toBe('light');
  });

  it('resolves system mode from native theme state', () => {
    expect(resolveEffectiveWindowTheme('system', { shouldUseDarkColors: true })).toBe('dark');
    expect(resolveEffectiveWindowTheme('system', { shouldUseDarkColors: false })).toBe('light');
    expect(resolveEffectiveWindowTheme('system', undefined)).toBe('light');
  });

  it('returns the shared window background color for the effective theme', () => {
    expect(getWindowBackgroundColor('dark', { shouldUseDarkColors: false })).toBe(WINDOW_BACKGROUND_DARK);
    expect(getWindowBackgroundColor('system', { shouldUseDarkColors: true })).toBe(WINDOW_BACKGROUND_DARK);
    expect(getWindowBackgroundColor('system', { shouldUseDarkColors: false })).toBe(WINDOW_BACKGROUND_LIGHT);
    expect(getWindowBackgroundColor('light', { shouldUseDarkColors: true })).toBe(WINDOW_BACKGROUND_LIGHT);
  });
});
