/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseFeatureFlag = vi.fn().mockReturnValue(false);
vi.mock('../../featureFlags', () => ({
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
}));

let mockConfig: Record<string, any> = {};
let subscriberCb: ((config: any) => void) | null = null;

vi.mock('../../userData/appDataManager', () => ({
  appDataManager: {
    getConfig: vi.fn(() => ({ ...mockConfig })),
    subscribe: vi.fn((cb: (c: any) => void) => {
      subscriberCb = cb;
      return () => { subscriberCb = null; };
    }),
  },
}));

import { renderHook, act } from '@testing-library/react';
import { useScreenshotEnabled } from '../useScreenshotEnabled';

describe('useScreenshotEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
    subscriberCb = null;
    mockUseFeatureFlag.mockReturnValue(false);
  });

  it('returns false when feature flag is disabled', () => {
    mockConfig = { screenshotSettings: { enabled: true } };
    mockUseFeatureFlag.mockReturnValue(false);
    const { result } = renderHook(() => useScreenshotEnabled());
    expect(result.current).toBe(false);
  });

  it('returns false when feature flag is enabled but config says disabled', () => {
    mockConfig = { screenshotSettings: { enabled: false } };
    mockUseFeatureFlag.mockReturnValue(true);
    const { result } = renderHook(() => useScreenshotEnabled());
    expect(result.current).toBe(false);
  });

  it('returns true when feature flag is enabled and config says enabled', () => {
    mockConfig = { screenshotSettings: { enabled: true } };
    mockUseFeatureFlag.mockReturnValue(true);
    const { result } = renderHook(() => useScreenshotEnabled());
    expect(result.current).toBe(true);
  });

  it('returns false when screenshotSettings is absent', () => {
    mockConfig = {};
    mockUseFeatureFlag.mockReturnValue(true);
    const { result } = renderHook(() => useScreenshotEnabled());
    expect(result.current).toBe(false);
  });

  it('reacts to config subscription updates', () => {
    mockConfig = { screenshotSettings: { enabled: false } };
    mockUseFeatureFlag.mockReturnValue(true);
    const { result } = renderHook(() => useScreenshotEnabled());
    expect(result.current).toBe(false);

    act(() => {
      subscriberCb?.({ screenshotSettings: { enabled: true } });
    });
    expect(result.current).toBe(true);
  });
});
