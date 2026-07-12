import type { ThemeSource } from './userDataADO/types/app';

export const WINDOW_BACKGROUND_LIGHT = '#fffbf8';
export const WINDOW_BACKGROUND_DARK = '#111318';

type NativeThemeState = {
  shouldUseDarkColors?: boolean;
};

export function resolveEffectiveWindowTheme(
  themeSource: ThemeSource | undefined,
  nativeTheme: NativeThemeState | undefined,
): 'light' | 'dark' {
  if (themeSource === 'dark') return 'dark';
  if (themeSource === 'system' && nativeTheme?.shouldUseDarkColors) return 'dark';
  return 'light';
}

export function getWindowBackgroundColor(
  themeSource: ThemeSource | undefined,
  nativeTheme: NativeThemeState | undefined,
): string {
  return resolveEffectiveWindowTheme(themeSource, nativeTheme) === 'dark'
    ? WINDOW_BACKGROUND_DARK
    : WINDOW_BACKGROUND_LIGHT;
}
