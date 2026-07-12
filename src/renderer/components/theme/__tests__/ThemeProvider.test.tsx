/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../lib/userData/types';

const appDataMock = vi.hoisted(() => {
  const state = {
    currentConfig: {} as AppConfig,
    listeners: new Set<(config: AppConfig) => void>(),
  };
  const manager = {
    getConfig: vi.fn(() => state.currentConfig),
    subscribe: vi.fn((listener: (config: AppConfig) => void) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    }),
  };
  return { manager, state };
});

vi.mock('../../../lib/userData/appDataManager', () => ({
  appDataManager: appDataMock.manager,
}));

import { ThemeProvider, themeProviderInternals } from '../ThemeProvider';

function renderProvider() {
  return render(
    <ThemeProvider>
      <div>content</div>
    </ThemeProvider>,
  );
}

function pushConfig(config: AppConfig) {
  appDataMock.state.currentConfig = config;
  act(() => {
    appDataMock.state.listeners.forEach((listener) => listener(config));
  });
}

describe('ThemeProvider', () => {
  let mediaListeners: Array<(event: { matches: boolean }) => void>;
  let mediaMatches: boolean;

  beforeEach(() => {
    appDataMock.state.currentConfig = {};
    appDataMock.state.listeners.clear();
    mediaListeners = [];
    mediaMatches = false;
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    appDataMock.manager.getConfig.mockClear();
    appDataMock.manager.subscribe.mockClear();

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        get matches() {
          return mediaMatches;
        },
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn((_event: string, listener: (event: { matches: boolean }) => void) => {
          mediaListeners.push(listener);
        }),
        removeEventListener: vi.fn((_event: string, listener: (event: { matches: boolean }) => void) => {
          mediaListeners = mediaListeners.filter((item) => item !== listener);
        }),
      })),
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to light when no appearance config exists', async () => {
    renderProvider();

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('applies explicit dark theme from initial config', async () => {
    appDataMock.state.currentConfig = { appearance: { themeSource: 'dark' } };
    renderProvider();

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });
  });

  it('updates when app config changes', async () => {
    renderProvider();

    pushConfig({ appearance: { themeSource: 'dark' } });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });

  it('resolves system theme and reacts to media-query changes', async () => {
    appDataMock.state.currentConfig = { appearance: { themeSource: 'system' } };
    mediaMatches = false;
    renderProvider();

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    act(() => {
      mediaMatches = true;
      mediaListeners.forEach((listener) => listener({ matches: true }));
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });

  it('uses light fallback when matchMedia is unavailable', async () => {
    appDataMock.state.currentConfig = { appearance: { themeSource: 'system' } };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    renderProvider();

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });
  });

  it('cleans up the app config subscription on unmount', () => {
    const { unmount } = renderProvider();

    expect(appDataMock.state.listeners.size).toBe(1);
    unmount();
    expect(appDataMock.state.listeners.size).toBe(0);
  });

  it('exposes deterministic resolver internals for branch coverage', () => {
    expect(themeProviderInternals.resolveEffectiveTheme('light', true)).toBe('light');
    expect(themeProviderInternals.resolveEffectiveTheme('dark', false)).toBe('dark');
    expect(themeProviderInternals.resolveEffectiveTheme('system', true)).toBe('dark');
    expect(themeProviderInternals.resolveEffectiveTheme('system', false)).toBe('light');
    expect(themeProviderInternals.getThemeSource({})).toBe('light');
    expect(themeProviderInternals.getThemeSource({ appearance: { themeSource: 'system' } })).toBe('system');
  });
});
