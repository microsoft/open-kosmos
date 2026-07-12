import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { appDataManager } from '../../lib/userData/appDataManager';
import type { AppConfig, ThemeSource } from '../../lib/userData/types';

type EffectiveTheme = 'light' | 'dark';

const DEFAULT_THEME_SOURCE: ThemeSource = 'light';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function getThemeSource(config: AppConfig): ThemeSource {
  return config.appearance?.themeSource ?? DEFAULT_THEME_SOURCE;
}

function resolveEffectiveTheme(themeSource: ThemeSource, prefersDark: boolean): EffectiveTheme {
  if (themeSource === 'dark') return 'dark';
  if (themeSource === 'system') return prefersDark ? 'dark' : 'light';
  return 'light';
}

function getSystemThemeQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(MEDIA_QUERY);
}

function applyTheme(theme: EffectiveTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [themeSource, setThemeSource] = useState<ThemeSource>(() => getThemeSource(appDataManager.getConfig()));
  const mediaQuery = useMemo(() => getSystemThemeQuery(), []);
  const [prefersDark, setPrefersDark] = useState(() => mediaQuery?.matches ?? false);

  useEffect(() => {
    const unsubscribe = appDataManager.subscribe((config) => {
      setThemeSource(getThemeSource(config));
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!mediaQuery) return;

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    setPrefersDark(mediaQuery.matches);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [mediaQuery]);

  useLayoutEffect(() => {
    applyTheme(resolveEffectiveTheme(themeSource, prefersDark));
  }, [prefersDark, themeSource]);

  return <>{children}</>;
};

export const themeProviderInternals = {
  applyTheme,
  getThemeSource,
  resolveEffectiveTheme,
};
