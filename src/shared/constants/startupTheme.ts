export const INITIAL_THEME_SOURCE_ARG = '--openkosmos-initial-theme-source=';

export type InitialThemeSource = 'light' | 'dark' | 'system';

export function isInitialThemeSource(value: string): value is InitialThemeSource {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function buildInitialThemeSourceArgument(themeSource: InitialThemeSource): string {
  return `${INITIAL_THEME_SOURCE_ARG}${encodeURIComponent(themeSource)}`;
}

export function parseInitialThemeSourceArgument(argv: readonly string[]): InitialThemeSource | undefined {
  const arg = argv.find((item) => item.startsWith(INITIAL_THEME_SOURCE_ARG));
  if (!arg) return undefined;

  try {
    const value = decodeURIComponent(arg.slice(INITIAL_THEME_SOURCE_ARG.length));
    return isInitialThemeSource(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
