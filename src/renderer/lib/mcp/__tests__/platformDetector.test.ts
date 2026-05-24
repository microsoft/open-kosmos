/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getCurrentPlatform,
  getVSCodeConfigPaths,
  getVSCodeConfigPath,
  isPlatformSupported,
  getPlatformInfo,
  getAllSupportedPlatforms,
  getPlatformFilePatterns,
  PLATFORM_CONSTANTS,
  type SupportedPlatform,
} from '../platformDetector';

// Helper to mock navigator properties
function mockNavigator(platform: string, userAgent: string) {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
}

afterEach(() => {
  // Restore to jsdom defaults
  Object.defineProperty(navigator, 'platform', { value: '', configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: '', configurable: true });
});

describe('getCurrentPlatform', () => {
  it('detects macOS from platform string', () => {
    mockNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(getCurrentPlatform()).toBe('macOS');
  });

  it('detects Windows from platform string', () => {
    mockNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(getCurrentPlatform()).toBe('Windows');
  });

  it('detects Linux from platform string', () => {
    mockNavigator('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');
    expect(getCurrentPlatform()).toBe('Linux');
  });

  it('defaults to macOS when unrecognized platform', () => {
    mockNavigator('Unknown', 'Some unknown user agent');
    expect(getCurrentPlatform()).toBe('macOS');
  });
});

describe('getVSCodeConfigPaths', () => {
  it('returns array of Windows paths for Windows platform', () => {
    const paths = getVSCodeConfigPaths('Windows');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('mcp.json');
    expect(paths[0]).toContain('Code');
  });

  it('returns array of macOS paths for macOS platform', () => {
    const paths = getVSCodeConfigPaths('macOS');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('Application Support/Code');
  });

  it('returns array of Linux paths for Linux platform', () => {
    const paths = getVSCodeConfigPaths('Linux');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('.config/Code');
  });

  it('includes both mcp.json and settings.json paths for macOS', () => {
    const paths = getVSCodeConfigPaths('macOS');
    const hasMcpJson = paths.some(p => p.endsWith('mcp.json'));
    const hasSettingsJson = paths.some(p => p.endsWith('settings.json'));
    expect(hasMcpJson).toBe(true);
    expect(hasSettingsJson).toBe(true);
  });
});

describe('getVSCodeConfigPath (legacy)', () => {
  it('returns first macOS path for macOS', () => {
    const path = getVSCodeConfigPath('macOS');
    expect(path).toContain('Application Support/Code');
  });

  it('returns first Windows path for Windows', () => {
    const path = getVSCodeConfigPath('Windows');
    expect(path).toContain('mcp.json');
  });

  it('returns first Linux path for Linux', () => {
    const path = getVSCodeConfigPath('Linux');
    expect(path).toContain('settings.json');
  });
});

describe('isPlatformSupported', () => {
  it('macOS is supported', () => {
    expect(isPlatformSupported('macOS')).toBe(true);
  });

  it('Windows is supported', () => {
    expect(isPlatformSupported('Windows')).toBe(true);
  });

  it('Linux is not supported', () => {
    expect(isPlatformSupported('Linux')).toBe(false);
  });
});

describe('getPlatformInfo', () => {
  it('returns correct info for macOS', () => {
    const info = getPlatformInfo('macOS');
    expect(info.platform).toBe('macOS');
    expect(info.isSupported).toBe(true);
    expect(info.displayName).toBe('macOS');
    expect(info.vscodeConfigPaths.length).toBeGreaterThan(0);
    expect(info.vscodeConfigPath).toBeTruthy();
  });

  it('returns correct info for Windows', () => {
    const info = getPlatformInfo('Windows');
    expect(info.platform).toBe('Windows');
    expect(info.isSupported).toBe(true);
    expect(info.vscodeConfigPath).toContain('APPDATA');
  });

  it('returns correct info for Linux', () => {
    const info = getPlatformInfo('Linux');
    expect(info.platform).toBe('Linux');
    expect(info.isSupported).toBe(false);
    expect(info.displayName).toBe('Linux');
  });
});

describe('getAllSupportedPlatforms', () => {
  it('returns exactly 2 platforms', () => {
    const platforms = getAllSupportedPlatforms();
    expect(platforms).toHaveLength(2);
  });

  it('includes macOS and Windows', () => {
    const platforms = getAllSupportedPlatforms();
    const names = platforms.map(p => p.platform);
    expect(names).toContain('macOS');
    expect(names).toContain('Windows');
  });

  it('all returned platforms are marked as supported', () => {
    const platforms = getAllSupportedPlatforms();
    expect(platforms.every(p => p.isSupported)).toBe(true);
  });
});

describe('getPlatformFilePatterns', () => {
  it('returns patterns for macOS', () => {
    const patterns = getPlatformFilePatterns('macOS');
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].extensions).toContain('json');
  });

  it('returns patterns for Windows', () => {
    const patterns = getPlatformFilePatterns('Windows');
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].name).toContain('MCP');
  });

  it('returns patterns for Linux', () => {
    const patterns = getPlatformFilePatterns('Linux');
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('each pattern has name and extensions', () => {
    const patterns = getPlatformFilePatterns('macOS');
    patterns.forEach(p => {
      expect(p.name).toBeTruthy();
      expect(Array.isArray(p.extensions)).toBe(true);
    });
  });
});

describe('PLATFORM_CONSTANTS', () => {
  it('has macOS constants', () => {
    expect(PLATFORM_CONSTANTS.macOS).toBeDefined();
    expect(PLATFORM_CONSTANTS.macOS.pathSeparator).toBe('/');
    expect(PLATFORM_CONSTANTS.macOS.homePrefix).toBe('~/');
  });

  it('has Windows constants', () => {
    expect(PLATFORM_CONSTANTS.Windows).toBeDefined();
    expect(PLATFORM_CONSTANTS.Windows.pathSeparator).toBe('\\');
    expect(PLATFORM_CONSTANTS.Windows.homePrefix).toContain('APPDATA');
  });

  it('has Linux constants', () => {
    expect(PLATFORM_CONSTANTS.Linux).toBeDefined();
    expect(PLATFORM_CONSTANTS.Linux.pathSeparator).toBe('/');
  });
});
