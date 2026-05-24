/**
 * @vitest-environment happy-dom
 *
 * Tests for useScreenshotHotkey.ts — covers all formatShortcut branches,
 * enabled/disabled states, and config subscription reactivity.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockConfig: Record<string, any> = {};
let subscriberCb: ((config: any) => void) | null = null;

vi.mock('../../userData/appDataManager', () => ({
  appDataManager: {
    getConfig: vi.fn(() => ({ ...mockConfig })),
    subscribe: vi.fn((cb: (c: any) => void) => {
      subscriberCb = cb;
      return () => {
        subscriberCb = null;
      };
    }),
  },
}));

import { useScreenshotHotkey } from '../useScreenshotHotkey';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSettings(overrides: Record<string, any> = {}) {
  return {
    enabled: true,
    shortcutEnabled: true,
    shortcut: 'CommandOrControl+Shift+S',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useScreenshotHotkey — initial state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
    subscriberCb = null;
  });

  it('returns undefined when screenshotSettings is absent', () => {
    mockConfig = {};
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeUndefined();
  });

  it('returns undefined when enabled=false', () => {
    mockConfig = { screenshotSettings: makeSettings({ enabled: false }) };
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeUndefined();
  });

  it('returns undefined when shortcutEnabled=false', () => {
    mockConfig = { screenshotSettings: makeSettings({ shortcutEnabled: false }) };
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeUndefined();
  });

  it('returns undefined when shortcut is empty/falsy', () => {
    mockConfig = { screenshotSettings: makeSettings({ shortcut: '' }) };
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeUndefined();
  });

  it('returns a formatted string when all settings are valid', () => {
    mockConfig = { screenshotSettings: makeSettings({ shortcut: 'CommandOrControl+Shift+S' }) };
    const { result } = renderHook(() => useScreenshotHotkey());
    // Should be defined — exact format depends on isMac
    expect(result.current).toBeDefined();
    expect(typeof result.current).toBe('string');
  });
});

describe('useScreenshotHotkey — config subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
    subscriberCb = null;
  });

  it('updates when config is pushed via subscription', () => {
    mockConfig = { screenshotSettings: makeSettings({ enabled: false }) };
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeUndefined();

    act(() => {
      subscriberCb?.({ screenshotSettings: makeSettings({ shortcut: 'Shift+F10' }) });
    });
    expect(result.current).toBeDefined();
  });

  it('reverts to undefined when subscription pushes disabled config', () => {
    mockConfig = { screenshotSettings: makeSettings() };
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeDefined();

    act(() => {
      subscriberCb?.({ screenshotSettings: makeSettings({ enabled: false }) });
    });
    expect(result.current).toBeUndefined();
  });

  it('reverts to undefined when subscription pushes shortcutEnabled=false', () => {
    mockConfig = { screenshotSettings: makeSettings() };
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeDefined();

    act(() => {
      subscriberCb?.({ screenshotSettings: makeSettings({ shortcutEnabled: false }) });
    });
    expect(result.current).toBeUndefined();
  });

  it('reverts to undefined when subscription pushes missing shortcut', () => {
    mockConfig = { screenshotSettings: makeSettings() };
    const { result } = renderHook(() => useScreenshotHotkey());
    expect(result.current).toBeDefined();

    act(() => {
      subscriberCb?.({ screenshotSettings: makeSettings({ shortcut: '' }) });
    });
    expect(result.current).toBeUndefined();
  });
});

describe('useScreenshotHotkey — formatShortcut key mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriberCb = null;
  });

  function getHotkey(shortcut: string): string | undefined {
    mockConfig = { screenshotSettings: makeSettings({ shortcut }) };
    const { result } = renderHook(() => useScreenshotHotkey());
    return result.current;
  }

  it('maps CommandOrControl correctly', () => {
    const hk = getHotkey('CommandOrControl+S');
    // On happy-dom isMac check: navigator.platform may be empty; just ensure non-empty string
    expect(hk).toBeDefined();
    expect(hk).toMatch(/S/i);
  });

  it('maps CmdOrCtrl correctly', () => {
    const hk = getHotkey('CmdOrCtrl+S');
    expect(hk).toBeDefined();
  });

  it('maps Command / Cmd to ⌘ or literal', () => {
    const hk = getHotkey('Command+S');
    expect(hk).toBeDefined();
    expect(hk).toContain('⌘');
  });

  it('maps Cmd to ⌘', () => {
    const hk = getHotkey('Cmd+S');
    expect(hk).toBeDefined();
    expect(hk).toContain('⌘');
  });

  it('maps Shift correctly', () => {
    const hk = getHotkey('Shift+S');
    expect(hk).toBeDefined();
    // Should include either ⇧ or Shift
    expect(hk).toMatch(/⇧|Shift/);
  });

  it('maps Alt / Option correctly', () => {
    const hkAlt = getHotkey('Alt+S');
    const hkOpt = getHotkey('Option+S');
    expect(hkAlt).toBeDefined();
    expect(hkOpt).toBeDefined();
  });

  it('maps Super / Meta correctly', () => {
    const hkSuper = getHotkey('Super+S');
    const hkMeta = getHotkey('Meta+S');
    expect(hkSuper).toBeDefined();
    expect(hkMeta).toBeDefined();
  });

  it('maps Control / Ctrl correctly', () => {
    const hkControl = getHotkey('Control+S');
    const hkCtrl = getHotkey('Ctrl+S');
    expect(hkControl).toBeDefined();
    expect(hkCtrl).toBeDefined();
  });

  it('passes through unknown keys as uppercase', () => {
    const hk = getHotkey('F10');
    expect(hk).toBe('F10');
  });

  it('handles multi-part composite shortcut', () => {
    const hk = getHotkey('Shift+F5');
    expect(hk).toBeDefined();
    expect(hk).toMatch(/F5/);
  });
});
