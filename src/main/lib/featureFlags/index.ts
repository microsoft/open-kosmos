/**
 * Feature Flag Module Export
 * 
 * Usage (Main Process):
 * 
 * ```typescript
 * import { featureFlagManager, isFeatureEnabled } from './lib/featureFlags';
 * 
 * // Initialize (call once at application startup)
 * featureFlagManager.initialize();
 * 
 * // Check feature flag
 * if (isFeatureEnabled('devTools')) {
 *   // Enable developer tools
 * }
 * ```
 * 
 * Define feature flag default values:
 * 1. Static value: defaultValue: false
 * 2. Dynamic logic: defaultValue: (ctx) => ctx.isDev && ctx.brandName === 'kosmos'
 * 
 * Enable via command line arguments:
 * --enable-features=flag1,flag2 --disable-features=flag3
 */

// Type exports
export * from './types';

// Configuration exports
export {
  FEATURE_FLAG_DEFINITIONS,
  getFeatureFlagConfig,
  getAllFeatureFlagNames,
  resolveDefaultValue,
} from './featureFlagDefinitions';

// Manager exports
export {
  featureFlagManager,
  isFeatureEnabled,
  getAllFeatureFlags,
} from './featureFlagManager';
