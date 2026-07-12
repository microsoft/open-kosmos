/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsEnabled = vi.fn().mockReturnValue(false);
const mockGetAllFlags = vi.fn().mockReturnValue({});
const mockSubscribe = vi.fn();
let mockIsInitialized = false;

vi.mock('../featureFlagCacheManager', () => ({
  featureFlagCacheManager: {
    get isInitialized() { return mockIsInitialized; },
    isEnabled: (...args: unknown[]) => mockIsEnabled(...args),
    getAllFlags: (...args: unknown[]) => mockGetAllFlags(...args),
    subscribe: (...args: [() => void]) => mockSubscribe(...args),
  },
}));

import { renderHook, act } from '@testing-library/react';
import { useFeatureFlag, useFeatureFlags, useFeatureFlagState } from '../useFeatureFlag';

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsInitialized = false;
    mockIsEnabled.mockReturnValue(false);
    mockSubscribe.mockImplementation(() => vi.fn());
  });

  it('returns false when flag is disabled', () => {
    mockIsEnabled.mockReturnValue(false);
    const { result } = renderHook(() => useFeatureFlag('myFlag'));
    expect(result.current).toBe(false);
  });

  it('returns true when flag is enabled at init time', () => {
    mockIsInitialized = true;
    mockIsEnabled.mockReturnValue(true);
    const { result } = renderHook(() => useFeatureFlag('myFlag'));
    expect(result.current).toBe(true);
  });

  it('re-checks flag when flagName changes and manager is initialized', () => {
    mockIsInitialized = true;
    mockIsEnabled.mockReturnValue(false);

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useFeatureFlag(name),
      { initialProps: { name: 'flagA' } }
    );
    expect(result.current).toBe(false);

    mockIsEnabled.mockReturnValue(true);
    act(() => {
      rerender({ name: 'flagB' });
    });
    expect(result.current).toBe(true);
  });

  it('updates when manager initialization is published', () => {
    mockIsInitialized = false;
    mockIsEnabled.mockReturnValue(false);
    let listener: (() => void) | undefined;
    mockSubscribe.mockImplementation((callback: () => void) => {
      listener = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useFeatureFlag('flagA'));
    expect(result.current).toBe(false);

    act(() => {
      mockIsInitialized = true;
      mockIsEnabled.mockReturnValue(true);
      listener?.();
    });

    expect(result.current).toBe(true);
  });

  it('exposes initialized state separately from enabled state', () => {
    mockIsInitialized = false;
    mockIsEnabled.mockReturnValue(true);

    const { result } = renderHook(() => useFeatureFlagState('flagA'));

    expect(result.current).toEqual({ enabled: false, initialized: false });
  });
});

describe('useFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsInitialized = false;
    mockGetAllFlags.mockReturnValue({});
    mockSubscribe.mockImplementation(() => vi.fn());
  });

  it('returns empty flags object initially', () => {
    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current).toEqual({});
  });

  it('returns flags from getAllFlags', () => {
    mockGetAllFlags.mockReturnValue({ devTools: true, beta: false });
    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current).toEqual({ devTools: true, beta: false });
  });

  it('updates flags when initialized', () => {
    mockIsInitialized = true;
    mockGetAllFlags.mockReturnValue({ featureX: true });

    const { result } = renderHook(() => useFeatureFlags());
    // effect runs synchronously in happy-dom
    expect(result.current).toEqual({ featureX: true });
  });

  it('updates flags when manager initialization is published', () => {
    let listener: (() => void) | undefined;
    mockSubscribe.mockImplementation((callback: () => void) => {
      listener = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current).toEqual({});

    act(() => {
      mockIsInitialized = true;
      mockGetAllFlags.mockReturnValue({ featureX: true });
      listener?.();
    });

    expect(result.current).toEqual({ featureX: true });
  });
});
