import { describe, it, expect, vi } from 'vitest';
import { getFeatureFlagConfig, resolveDefaultValue, getAllFeatureFlagNames, FEATURE_FLAG_DEFINITIONS, FEATURE_FLAG_CONFIG_MAP } from '../featureFlagDefinitions';
import type { FeatureFlagContext } from '../types';

describe('featureFlagDefinitions', () => {
  const productionContext: FeatureFlagContext = {
    isDev: false,
    brandName: 'openkosmos',
    platform: 'darwin',
    arch: 'arm64',
  };

  const devContext: FeatureFlagContext = {
    isDev: true,
    brandName: 'openkosmos',
    platform: 'darwin',
    arch: 'arm64',
  };

  it('enables openkosmosFeatureExternalAgent in dev only', () => {
    const config = getFeatureFlagConfig('openkosmosFeatureExternalAgent');

    expect(config).toBeDefined();
    expect(resolveDefaultValue(config!.defaultValue, devContext)).toBe(true);
    expect(resolveDefaultValue(config!.defaultValue, productionContext)).toBe(false);
  });

  it('enables openkosmosFeatureToolSearch in all environments', () => {
    const config = getFeatureFlagConfig('openkosmosFeatureToolSearch');

    expect(config).toBeDefined();
    expect(resolveDefaultValue(config!.defaultValue, productionContext)).toBe(true);
    expect(resolveDefaultValue(config!.defaultValue, devContext)).toBe(true);
  });

  it('returns undefined for unknown flag name', () => {
    expect(getFeatureFlagConfig('unknownFlag' as any)).toBeUndefined();
  });

  describe('getAllFeatureFlagNames()', () => {
    it('returns all flag names', () => {
      const names = getAllFeatureFlagNames();
      expect(names.length).toBe(FEATURE_FLAG_DEFINITIONS.length);
      expect(names).toEqual([
        'openkosmosFeatureScreenshot',
        'openkosmosFeatureVoiceInput',
        'openkosmosUseGit',
        'openkosmosFeatureScheduler',
        'openkosmosUseSync',
        'openkosmosPathPortability',
        'openkosmosFeatureBuddy',
        'openkosmosFeatureExternalAgent',
        'openkosmosFeatureToolSearch',
      ]);
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
    it('openkosmosFeatureScreenshot: always enabled', () => {
      const config = getFeatureFlagConfig('openkosmosFeatureScreenshot')!;
      expect(resolveDefaultValue(config.defaultValue, productionContext)).toBe(true);
      expect(resolveDefaultValue(config.defaultValue, devContext)).toBe(true);
    });

    it('openkosmosFeatureScheduler: always enabled', () => {
      const config = getFeatureFlagConfig('openkosmosFeatureScheduler')!;
      expect(resolveDefaultValue(config.defaultValue, productionContext)).toBe(true);
    });

    it('dev-only flags are false in production and true in dev', () => {
      const devOnlyFlags = [
        'openkosmosFeatureVoiceInput',
        'openkosmosUseGit',
        'openkosmosUseSync',
        'openkosmosPathPortability',
        'openkosmosFeatureBuddy',
      ] as const;

      for (const flagName of devOnlyFlags) {
        const config = getFeatureFlagConfig(flagName)!;
        expect(resolveDefaultValue(config.defaultValue, productionContext)).toBe(false);
        expect(resolveDefaultValue(config.defaultValue, devContext)).toBe(true);
      }
    });
  });
});
