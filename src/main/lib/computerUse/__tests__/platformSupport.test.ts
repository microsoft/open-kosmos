import { describe, expect, it } from 'vitest';
import {
  getComputerUsePlatformSupport,
  getComputerUseUnsupportedReason,
  isComputerUsePlatformSupported,
} from '../platformSupport';

describe('Computer Use platform support', () => {
  it('supports macOS and Windows x64', () => {
    expect(isComputerUsePlatformSupported('darwin', 'arm64')).toBe(true);
    expect(isComputerUsePlatformSupported('darwin', 'x64')).toBe(true);
    expect(isComputerUsePlatformSupported('win32', 'x64')).toBe(true);
    expect(getComputerUseUnsupportedReason('win32', 'x64')).toBeNull();
  });

  it('blocks Windows ARM64 because the native input addon is unavailable', () => {
    const reason = getComputerUseUnsupportedReason('win32', 'arm64');

    expect(reason).toContain('Windows ARM64');
    expect(isComputerUsePlatformSupported('win32', 'arm64')).toBe(false);
    expect(getComputerUsePlatformSupport('win32', 'arm64')).toEqual({
      platform: 'win32',
      arch: 'arm64',
      platformSupported: false,
      unsupportedReason: reason,
    });
  });

  it('returns a supported status without an unsupported reason on supported platforms', () => {
    expect(getComputerUsePlatformSupport('linux', 'arm64')).toEqual({
      platform: 'linux',
      arch: 'arm64',
      platformSupported: true,
    });
  });
});
