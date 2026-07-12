/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// The hook reads the per-profile `memex.enabled` switch from the profile data
// provider. Mock useProfileData to return a controllable profile shape.

let mockProfile: Record<string, any> | null = {};

vi.mock('../../../components/userData/userDataProvider', () => ({
  useProfileData: vi.fn(() => ({ data: { profile: mockProfile } })),
}));

import { renderHook } from '@testing-library/react';
import { useMemexMemoryEnabled } from '../useMemexMemoryEnabled';

describe('useMemexMemoryEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = {};
  });

  it('returns false when memex config is absent (feature OFF by default)', () => {
    mockProfile = {};
    const { result } = renderHook(() => useMemexMemoryEnabled());
    expect(result.current).toBe(false);
  });

  it('returns false when memex.enabled is false', () => {
    mockProfile = { memex: { enabled: false } };
    const { result } = renderHook(() => useMemexMemoryEnabled());
    expect(result.current).toBe(false);
  });

  it('returns true when memex.enabled is true', () => {
    mockProfile = { memex: { enabled: true } };
    const { result } = renderHook(() => useMemexMemoryEnabled());
    expect(result.current).toBe(true);
  });

  it('treats a non-boolean enabled value as not-enabled (strict === true)', () => {
    mockProfile = { memex: { enabled: 1 as any } };
    const { result } = renderHook(() => useMemexMemoryEnabled());
    expect(result.current).toBe(false);
  });

  it('returns false when the profile itself is null', () => {
    mockProfile = null;
    const { result } = renderHook(() => useMemexMemoryEnabled());
    expect(result.current).toBe(false);
  });
});
