import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDebug, mockWarn, mockInfo, mockError } = vi.hoisted(() => ({
  mockDebug: vi.fn(),
  mockWarn: vi.fn(),
  mockInfo: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: mockDebug,
    warn: mockWarn,
    info: mockInfo,
    error: mockError,
  }),
}));

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

import { featureFlagManager, getAllFeatureFlags, isFeatureEnabled } from '../featureFlagManager';
import { FEATURE_FLAG_DEFINITIONS } from '../featureFlagDefinitions';

function resetManager() {
  const manager = featureFlagManager as any;
  manager.initialized = false;
  manager.flags = {};
  manager.context = {
    isDev: false,
    brandName: 'openkosmos',
    platform: process.platform,
    arch: process.arch,
  };
}

describe('featureFlagManager', () => {
  const originalArgv = [...process.argv];
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv.splice(0, process.argv.length, 'node', 'app.js');
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    resetManager();
  });

  it('initializes all definitions with default sources', () => {
    featureFlagManager.initialize();

    const values = getAllFeatureFlags();
    expect(Object.keys(values)).toHaveLength(FEATURE_FLAG_DEFINITIONS.length);
    expect(values.openkosmosFeatureScreenshot).toBe(true);
    expect(values.openkosmosFeatureScheduler).toBe(true);
  });

  it('detects development mode from NODE_ENV and preserves current context', () => {
    process.env.NODE_ENV = 'development';

    featureFlagManager.initialize();

    expect(featureFlagManager.isDevMode).toBe(true);
    expect(featureFlagManager.currentContext).toEqual({
      isDev: true,
      brandName: 'openkosmos',
      platform: process.platform,
      arch: process.arch,
    });
  });

  it('detects development mode from --dev argv', () => {
    process.argv.push('--dev');

    featureFlagManager.initialize();

    expect(featureFlagManager.isDevMode).toBe(true);
    expect(isFeatureEnabled('openkosmosFeatureVoiceInput')).toBe(true);
  });

  it('applies CLI enable and disable overrides', () => {
    process.argv.push(
      '--enable-features=openkosmosFeatureVoiceInput, openkosmosFeatureBuddy',
      '--disable-features=openkosmosFeatureScreenshot',
    );

    featureFlagManager.initialize();

    const values = getAllFeatureFlags();
    expect(values.openkosmosFeatureVoiceInput).toBe(true);
    expect(values.openkosmosFeatureBuddy).toBe(true);
    expect(values.openkosmosFeatureScreenshot).toBe(false);
  });

  it('warns and ignores unknown CLI flags', () => {
    process.argv.push('--enable-features=unknownFlag', '--disable-features=stillUnknown');

    featureFlagManager.initialize();

    expect(mockWarn).toHaveBeenCalledWith('[FeatureFlags] Unknown feature flag from CLI: unknownFlag');
    expect(mockWarn).toHaveBeenCalledWith('[FeatureFlags] Unknown feature flag from CLI: stillUnknown');
  });

  it('returns false and warns when checking an unknown feature flag', () => {
    featureFlagManager.initialize();

    const enabled = (featureFlagManager as any).isEnabled('not-real-feature');

    expect(enabled).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith('[FeatureFlags] Unknown feature flag: not-real-feature');
  });

  it('exposes the convenience helper for feature checks', () => {
    featureFlagManager.initialize();

    expect(isFeatureEnabled('openkosmosFeatureScreenshot')).toBe(true);
  });

  it('logs and skips repeated initialization', () => {
    featureFlagManager.initialize();
    featureFlagManager.initialize();

    expect(mockDebug).toHaveBeenCalledWith('[FeatureFlags] Already initialized, skipping...');
  });

  it('logs active non-default state entries after initialization', () => {
    process.argv.push('--disable-features=openkosmosFeatureScreenshot');

    featureFlagManager.initialize();

    expect(mockDebug).toHaveBeenCalledWith('[FeatureFlags] Current state:');
    expect(mockDebug).toHaveBeenCalledWith(
      expect.stringContaining('openkosmosFeatureScreenshot: false (source: cli)'),
    );
    expect(mockDebug).toHaveBeenCalledWith(
      expect.stringContaining(`Context: isDev=false, brandName=openkosmos, platform=${process.platform}`),
    );
  });
});
