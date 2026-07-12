/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Create a controllable appDataManager mock
let subscriberCallback: ((config: any) => void) | null = null;
let mockConfig: Record<string, any> = {};
let onZoomChangedCallback: ((level: number) => void) | null = null;
const cleanupZoomChangedMock = vi.fn();
const getZoomLevelMock = vi.fn();

vi.mock('../appDataManager', () => {
  const mockAppDataManager = {
    getConfig: vi.fn(() => ({ ...mockConfig })),
    subscribe: vi.fn((cb: (config: any) => void) => {
      subscriberCallback = cb;
      return () => { subscriberCallback = null; };
    }),
    isReady: vi.fn(() => false),
  };
  return {
    appDataManager: mockAppDataManager,
    AppDataManager: { getInstance: () => mockAppDataManager },
  };
});

Object.defineProperty(window, 'electronAPI', {
  value: {
    window: {
      getZoomLevel: getZoomLevelMock,
      onZoomChanged: vi.fn((cb: (level: number) => void) => {
        onZoomChangedCallback = cb;
        return cleanupZoomChangedMock;
      }),
    },
  },
  writable: true,
  configurable: true,
});

import { useAppZoomLevel } from '../useAppZoomLevel';
import { useVoiceInputEnabled } from '../useVoiceInputEnabled';
import { appDataManager } from '../appDataManager';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAppZoomLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
    subscriberCallback = null;
    onZoomChangedCallback = null;
    getZoomLevelMock.mockResolvedValue(null);
  });

  it('returns default zoom level (0) when config has none', () => {
    mockConfig = {};
    const { result } = renderHook(() => useAppZoomLevel());
    expect(result.current).toBe(0);
  });

  it('returns initial zoom level from config', () => {
    mockConfig = { zoomLevel: 1.5 };
    const { result } = renderHook(() => useAppZoomLevel());
    expect(result.current).toBe(1.5);
  });

  it('updates zoom level when subscriber fires', async () => {
    mockConfig = { zoomLevel: 1 };
    const { result } = renderHook(() => useAppZoomLevel());

    act(() => {
      subscriberCallback?.({ zoomLevel: 2 });
    });

    expect(result.current).toBe(2);
  });

  it('defaults to 0 when subscriber fires config without zoomLevel', () => {
    mockConfig = { zoomLevel: 1 };
    const { result } = renderHook(() => useAppZoomLevel());

    act(() => {
      subscriberCallback?.({});
    });

    expect(result.current).toBe(0);
  });

  it('syncs with actual window zoom level via electronAPI', async () => {
    getZoomLevelMock.mockResolvedValue(2.5);
    mockConfig = { zoomLevel: 1 };

    const { result } = renderHook(() => useAppZoomLevel());

    // Wait for the async syncWithWindowZoom call
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(2.5);
  });

  it('handles getZoomLevel returning non-number gracefully', async () => {
    getZoomLevelMock.mockResolvedValue('not-a-number');
    mockConfig = { zoomLevel: 1.2 };

    const { result } = renderHook(() => useAppZoomLevel());
    await act(async () => { await Promise.resolve(); });

    // Should remain at 1.2 since returned value is not a number
    expect(result.current).toBe(1.2);
  });

  it('handles getZoomLevel throwing gracefully', async () => {
    getZoomLevelMock.mockRejectedValue(new Error('permission denied'));
    mockConfig = { zoomLevel: 1.2 };

    const { result } = renderHook(() => useAppZoomLevel());
    await act(async () => { await Promise.resolve(); });

    expect(result.current).toBe(1.2);
  });

  it('updates zoom level when onZoomChanged fires', () => {
    mockConfig = { zoomLevel: 1 };
    const { result } = renderHook(() => useAppZoomLevel());

    act(() => {
      onZoomChangedCallback?.(3.0);
    });

    expect(result.current).toBe(3.0);
  });

  it('calls cleanup on unmount', () => {
    mockConfig = {};
    const { unmount } = renderHook(() => useAppZoomLevel());
    unmount();
    expect(cleanupZoomChangedMock).toHaveBeenCalled();
    expect(subscriberCallback).toBeNull();
  });

  it('handles missing electronAPI.window gracefully', () => {
    const original = (window as any).electronAPI;
    (window as any).electronAPI = {};

    expect(() => renderHook(() => useAppZoomLevel())).not.toThrow();

    (window as any).electronAPI = original;
  });
});

describe('useVoiceInputEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
    subscriberCallback = null;
    vi.mocked(appDataManager.getConfig).mockImplementation(() => ({ ...mockConfig }));
  });

  it('returns false when voiceInput is not configured', () => {
    mockConfig = {};
    const { result } = renderHook(() => useVoiceInputEnabled());
    expect(result.current).toBe(false);
  });

  it('returns false when voiceInputEnabled is false', () => {
    mockConfig = { voiceInput: { voiceInputEnabled: false } };
    const { result } = renderHook(() => useVoiceInputEnabled());
    expect(result.current).toBe(false);
  });

  it('returns true when voiceInputEnabled is true', () => {
    mockConfig = { voiceInput: { voiceInputEnabled: true } };
    const { result } = renderHook(() => useVoiceInputEnabled());
    expect(result.current).toBe(true);
  });

  it('updates when subscriber fires with enabled true', () => {
    mockConfig = { voiceInput: { voiceInputEnabled: false } };
    const { result } = renderHook(() => useVoiceInputEnabled());

    act(() => {
      subscriberCallback?.({ voiceInput: { voiceInputEnabled: true } });
    });

    expect(result.current).toBe(true);
  });

  it('updates when subscriber fires with enabled false', () => {
    mockConfig = { voiceInput: { voiceInputEnabled: true } };
    const { result } = renderHook(() => useVoiceInputEnabled());

    act(() => {
      subscriberCallback?.({ voiceInput: { voiceInputEnabled: false } });
    });

    expect(result.current).toBe(false);
  });

  it('updates when subscriber fires with no voiceInput', () => {
    mockConfig = { voiceInput: { voiceInputEnabled: true } };
    const { result } = renderHook(() => useVoiceInputEnabled());

    act(() => {
      subscriberCallback?.({});
    });

    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    mockConfig = {};
    const { unmount } = renderHook(() => useVoiceInputEnabled());
    unmount();
    expect(subscriberCallback).toBeNull();
  });
});
