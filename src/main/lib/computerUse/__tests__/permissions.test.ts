import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMediaAccessStatus = vi.fn(() => 'granted');
const isTrustedAccessibilityClient = vi.fn(() => true);

// Per-file mock with a static-import surface (the global setup mock omits
// `systemPreferences`). Vitest applies this to `import { systemPreferences }`.
vi.mock('electron', () => ({
  systemPreferences: {
    getMediaAccessStatus: (...a: unknown[]) => getMediaAccessStatus(...(a as [])),
    isTrustedAccessibilityClient: (...a: unknown[]) => isTrustedAccessibilityClient(...(a as [])),
  },
}));

import {
  getPermissionStatus,
  hasRequiredPermissions,
  permissionBlockReason,
  defaultPermissionDeps,
  type PermissionDeps,
} from '../permissions';

const macDeps = (screen: string, accessibility: boolean): PermissionDeps => ({
  platform: 'darwin',
  getScreenStatus: () => screen,
  isTrustedAccessibility: () => accessibility,
});

beforeEach(() => {
  getMediaAccessStatus.mockClear().mockReturnValue('granted');
  isTrustedAccessibilityClient.mockClear().mockReturnValue(true);
});

describe('getPermissionStatus', () => {
  it('reports granted/true off macOS without probing the OS', () => {
    const probe = vi.fn();
    const status = getPermissionStatus(false, {
      platform: 'win32',
      getScreenStatus: probe,
      isTrustedAccessibility: probe,
    });
    expect(status).toEqual({ screenRecording: 'granted', accessibility: true });
    expect(probe).not.toHaveBeenCalled();
  });

  it('reads the real OS status on macOS', () => {
    const status = getPermissionStatus(false, macDeps('denied', false));
    expect(status).toEqual({ screenRecording: 'denied', accessibility: false });
  });

  it('passes the prompt flag through to accessibility', () => {
    const isTrusted = vi.fn(() => true);
    getPermissionStatus(true, { platform: 'darwin', getScreenStatus: () => 'granted', isTrustedAccessibility: isTrusted });
    expect(isTrusted).toHaveBeenCalledWith(true);
  });

  it('defaults prompt to false', () => {
    const isTrusted = vi.fn(() => true);
    getPermissionStatus(undefined, { platform: 'darwin', getScreenStatus: () => 'granted', isTrustedAccessibility: isTrusted });
    expect(isTrusted).toHaveBeenCalledWith(false);
  });

  it('binds the real electron systemPreferences via the default deps', () => {
    getMediaAccessStatus.mockReturnValue('granted');
    isTrustedAccessibilityClient.mockReturnValue(true);
    const deps = defaultPermissionDeps();
    expect(deps.getScreenStatus()).toBe('granted');
    expect(deps.isTrustedAccessibility(true)).toBe(true);
    expect(getMediaAccessStatus).toHaveBeenCalledWith('screen');
    expect(isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    expect(typeof deps.platform).toBe('string');
  });

  it('uses the default deps when none are injected', () => {
    getMediaAccessStatus.mockReturnValue('denied');
    isTrustedAccessibilityClient.mockReturnValue(false);
    // Force the darwin branch regardless of host OS by going through default deps.
    const deps = defaultPermissionDeps();
    if (deps.platform === 'darwin') {
      const status = getPermissionStatus();
      expect(status.screenRecording).toBe('denied');
      expect(status.accessibility).toBe(false);
    } else {
      const status = getPermissionStatus(false, macDeps('denied', false));
      expect(status.screenRecording).toBe('denied');
    }
  });
});

describe('hasRequiredPermissions', () => {
  it('is true only when both granted', () => {
    expect(hasRequiredPermissions({ screenRecording: 'granted', accessibility: true })).toBe(true);
    expect(hasRequiredPermissions({ screenRecording: 'denied', accessibility: true })).toBe(false);
    expect(hasRequiredPermissions({ screenRecording: 'granted', accessibility: false })).toBe(false);
  });
});

describe('permissionBlockReason', () => {
  it('flags screen recording first', () => {
    expect(permissionBlockReason({ screenRecording: 'denied', accessibility: true })).toContain('Screen Recording');
  });
  it('flags accessibility when screen is granted', () => {
    expect(permissionBlockReason({ screenRecording: 'granted', accessibility: false })).toContain('Accessibility');
  });
  it('returns null when fully permitted', () => {
    expect(permissionBlockReason({ screenRecording: 'granted', accessibility: true })).toBeNull();
  });
});
