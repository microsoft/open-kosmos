import { describe, it, expect, vi } from 'vitest';
import { getFeatureFlagConfig, resolveDefaultValue, getAllFeatureFlagNames, FEATURE_FLAG_DEFINITIONS, FEATURE_FLAG_CONFIG_MAP } from '../featureFlagDefinitions';
import type { FeatureFlagContext } from '../types';

describe('featureFlagDefinitions', () => {
  const productionContext: FeatureFlagContext = {
    isDev: false,
    brandName: 'kosmos',
    platform: 'darwin',
    arch: 'arm64',
  };

  const devContext: FeatureFlagContext = {
    isDev: true,
    brandName: 'kosmos',
    platform: 'darwin',
    arch: 'arm64',
  };

  it('enables kosmosFeatureRemoteChannel by default in production', () => {
    const config = getFeatureFlagConfig('kosmosFeatureRemoteChannel');

    expect(config).toBeDefined();
    expect(resolveDefaultValue(config!.defaultValue, productionContext)).toBe(true);
  });

  it('keeps kosmosFeatureRemoteChannel enabled in development too', () => {
    const config = getFeatureFlagConfig('kosmosFeatureRemoteChannel');
    const developmentContext: FeatureFlagContext = {
      ...productionContext,
      isDev: true,
    };

    expect(config).toBeDefined();
    expect(resolveDefaultValue(config!.defaultValue, developmentContext)).toBe(true);
  });

  it('enables kosmosFeatureExternalAgent by default', () => {
    const config = getFeatureFlagConfig('kosmosFeatureExternalAgent');

    expect(config).toBeDefined();
    expect(resolveDefaultValue(config!.defaultValue, productionContext)).toBe(true);
  });

  it('keeps kosmosFeatureSubAgent dev-only', () => {
    const config = getFeatureFlagConfig('kosmosFeatureSubAgent');

    expect(config).toBeDefined();
    expect(resolveDefaultValue(config!.defaultValue, productionContext)).toBe(false);
  });

  it('returns undefined for unknown flag name', () => {
    expect(getFeatureFlagConfig('unknownFlag' as any)).toBeUndefined();
  });

  describe('getAllFeatureFlagNames()', () => {
    it('returns all flag names', () => {
      const names = getAllFeatureFlagNames();
      expect(names.length).toBe(FEATURE_FLAG_DEFINITIONS.length);
      expect(names).toContain('kosmosFeatureScreenshot');
      expect(names).toContain('kosmosFeatureRemoteChannel');
    });
  });

  describe('FEATURE_FLAG_CONFIG_MAP', () => {
    it('contains all definitions', () => {
      expect(FEATURE_FLAG_CONFIG_MAP.size).toBe(FEATURE_FLAG_DEFINITIONS.length);
    });
  });

  describe('resolveDefaultValue()', () => {
    it('returns static boolean directly', () => {
      expect(resolveDefaultValue(true, productionContext)).toBe(true);
      expect(resolveDefaultValue(false, productionContext)).toBe(false);
    });

    it('calls function with context when defaultValue is a function', () => {
      const fn = vi.fn().mockReturnValue(true);
      expect(resolveDefaultValue(fn, productionContext)).toBe(true);
      expect(fn).toHaveBeenCalledWith(productionContext);
    });
  });

  describe('dynamic flag conditions', () => {
    it('kosmosFeatureScreenshot: always enabled', () => {
      const config = getFeatureFlagConfig('kosmosFeatureScreenshot')!;
      expect(resolveDefaultValue(config.defaultValue, productionContext)).toBe(true);
      expect(resolveDefaultValue(config.defaultValue, devContext)).toBe(true);
    });

    it('kosmosFeatureScheduler: always enabled', () => {
      const config = getFeatureFlagConfig('kosmosFeatureScheduler')!;
      expect(resolveDefaultValue(config.defaultValue, productionContext)).toBe(true);
    });

    it('browserControl: enabled in dev on win32 and darwin, disabled on linux', () => {
      const config = getFeatureFlagConfig('browserControl')!;
      expect(resolveDefaultValue(config.defaultValue, { ...devContext, platform: 'win32' })).toBe(true);
      expect(resolveDefaultValue(config.defaultValue, { ...devContext, platform: 'darwin' })).toBe(true);
      expect(resolveDefaultValue(config.defaultValue, { ...devContext, platform: 'linux' })).toBe(false);
      expect(resolveDefaultValue(config.defaultValue, { ...productionContext, platform: 'darwin' })).toBe(false);
    });

    it('dev-only flags are false in production and true in dev', () => {
      const devOnlyFlags = [
        'kosmosUseGit',
        'kosmosPathPortability',
        'kosmosFeatureCodingAgent',
        'kosmosFeatureDoctor',
        'kosmosFeatureBuddy',
        'kosmosFeaturePlugins',
        'kosmosFeatureToolSearch',
      ] as const;

      for (const flagName of devOnlyFlags) {
        const config = getFeatureFlagConfig(flagName)!;
        expect(resolveDefaultValue(config.defaultValue, productionContext)).toBe(false);
        expect(resolveDefaultValue(config.defaultValue, devContext)).toBe(true);
      }
    });
  });
});
