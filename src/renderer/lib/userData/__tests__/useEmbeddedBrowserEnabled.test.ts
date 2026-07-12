/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// The hook reads the per-profile `browser.enabled` switch from the profile data
// provider. Mock useProfileData to return a controllable profile shape.

let mockProfile: Record<string, any> | null = {};

vi.mock('../../../components/userData/userDataProvider', () => ({
  useProfileData: vi.fn(() => ({ data: { profile: mockProfile } })),
}));

import { renderHook } from '@testing-library/react';
import { useEmbeddedBrowserEnabled } from '../useEmbeddedBrowserEnabled';

describe('useEmbeddedBrowserEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = {};
  });

  it('returns false when browser config is absent (feature OFF by default)', () => {
    mockProfile = {};
    const { result } = renderHook(() => useEmbeddedBrowserEnabled());
    expect(result.current).toBe(false);
  });

  it('returns false when browser.enabled is false', () => {
    mockProfile = { browser: { enabled: false } };
    const { result } = renderHook(() => useEmbeddedBrowserEnabled());
    expect(result.current).toBe(false);
  });

  it('returns true when browser.enabled is true', () => {
    mockProfile = { browser: { enabled: true } };
    const { result } = renderHook(() => useEmbeddedBrowserEnabled());
    expect(result.current).toBe(true);
  });

  it('treats a non-boolean enabled value as not-enabled (strict === true)', () => {
    mockProfile = { browser: { enabled: 'yes' as any } };
    const { result } = renderHook(() => useEmbeddedBrowserEnabled());
    expect(result.current).toBe(false);
  });

  it('returns false when the profile itself is null', () => {
    mockProfile = null;
    const { result } = renderHook(() => useEmbeddedBrowserEnabled());
    expect(result.current).toBe(false);
  });
});
