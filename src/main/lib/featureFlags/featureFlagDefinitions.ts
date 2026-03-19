/**
 * Feature Flag Definitions
 * 
 * All feature flag configurations are defined in this file.
 * 
 * Naming convention: kosmosFeatureXXXXX
 * 
 * When adding a new feature flag:
 * 1. Add the name to FeatureFlagName in types.ts
 * 2. Add the configuration in this file
 * 
 * defaultValue supports two forms:
 * 1. Static boolean: defaultValue: false
 * 2. Dynamic function: defaultValue: (ctx) => ctx.isDev && ctx.brandName === 'kosmos'
 */

import { FeatureFlagConfig, FeatureFlagName, FeatureFlagContext, FeatureFlagDefaultValue } from './types';

/**
 * Feature Flag configuration list
 * 
 * Grouped by feature module for easier maintenance
 */
export const FEATURE_FLAG_DEFINITIONS: FeatureFlagConfig[] = [
  // ============== Settings Page ==============
  {
    name: 'kosmosFeatureToolbarSettings',
    description: 'Show Toolbar entry in Settings page (kosmos brand only, dev environment only)',

    defaultValue: (ctx) => ctx.isDev && ctx.brandName === 'kosmos',
  },

  // ============== Memory/Context Enhancement ==============
  {
    name: 'kosmosFeatureMemory',
    description: 'Memory/Context Enhancement feature (dev environment only, unavailable on Windows ARM)',
    // Condition: dev environment + non-Windows ARM (better-sqlite3/sqlite-vec does not support Windows ARM)
    defaultValue: (ctx) => ctx.isDev && !(ctx.platform === 'win32' && ctx.arch === 'arm64'),
  },

  // ============== Screenshot ==============
  {
    name: 'kosmosFeatureScreenshot',
    description: 'Screenshot feature (enabled in all environments)',
    defaultValue: true,
  },

  // ============== Voice Input ==============
  {
    name: 'kosmosFeatureVoiceInput',
    description: 'Voice Input (Speech-to-Text) feature (dev environment only)',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Browser Control ==============
  {
    name: 'browserControl',
    description: 'Browser Control / Chrome Extension integration (dev environment only, Windows only for now)',
    defaultValue: (ctx) => ctx.isDev && ctx.platform === 'win32',
  },
];

/**
 * Map for fast configuration lookup
 */
export const FEATURE_FLAG_CONFIG_MAP: Map<FeatureFlagName, FeatureFlagConfig> = new Map(
  FEATURE_FLAG_DEFINITIONS.map(config => [config.name, config])
);

/**
 * Get feature flag configuration
 */
export function getFeatureFlagConfig(name: FeatureFlagName): FeatureFlagConfig | undefined {
  return FEATURE_FLAG_CONFIG_MAP.get(name);
}

/**
 * Get all feature flag names
 */
export function getAllFeatureFlagNames(): FeatureFlagName[] {
  return FEATURE_FLAG_DEFINITIONS.map(config => config.name);
}

/**
 * Resolve default value (supports both static values and dynamic functions)
 */
export function resolveDefaultValue(
  defaultValue: FeatureFlagDefaultValue,
  context: FeatureFlagContext
): boolean {
  if (typeof defaultValue === 'function') {
    return defaultValue(context);
  }
  return defaultValue;
}
