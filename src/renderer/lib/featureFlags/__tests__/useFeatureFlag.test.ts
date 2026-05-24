/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsEnabled = vi.fn().mockReturnValue(false);
const mockGetAllFlags = vi.fn().mockReturnValue({});
let mockIsInitialized = false;

vi.mock('../featureFlagCacheManager', () => ({
  featureFlagCacheManager: {
    get isInitialized() { return mockIsInitialized; },
    isEnabled: (...args: unknown[]) => mockIsEnabled(...args),
    getAllFlags: (...args: unknown[]) => mockGetAllFlags(...args),
  },
}));

import { renderHook, act } from '@testing-library/react';
import { useFeatureFlag, useFeatureFlags } from '../useFeatureFlag';

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsInitialized = false;
    mockIsEnabled.mockReturnValue(false);
  });

  it('returns false when flag is disabled', () => {
    mockIsEnabled.mockReturnValue(false);
    const { result } = renderHook(() => useFeatureFlag('myFlag'));
    expect(result.current).toBe(false);
  });

  it('returns true when flag is enabled at init time', () => {
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

  it('does not re-check when manager is not yet initialized', () => {
    mockIsInitialized = false;
    mockIsEnabled.mockReturnValue(false);

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useFeatureFlag(name),
      { initialProps: { name: 'flagA' } }
    );
    expect(result.current).toBe(false);

    // Even if isEnabled would now return true, no re-check happens because not initialized
    mockIsEnabled.mockReturnValue(true);
    act(() => { rerender({ name: 'flagA' }); });
    // The effect won't call setEnabled because isInitialized is false
    expect(result.current).toBe(false);
  });
});

describe('useFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsInitialized = false;
    mockGetAllFlags.mockReturnValue({});
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
});
