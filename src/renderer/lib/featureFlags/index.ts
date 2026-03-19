/**
 * Feature Flags Frontend Module Exports (Read-only Access)
 * 
 * Feature flags are defined by developers in the backend, or passed via command-line arguments:
 * --enable-features=flag1,flag2 --disable-features=flag3
 * 
 * Usage:
 * 
 * ```typescript
 * // Outside of components
 * import { isFeatureEnabled } from '../lib/featureFlags';
 * 
 * if (isFeatureEnabled('devTools')) {
 *   // ...
 * }
 * 
 * // In React components
 * import { useFeatureFlag } from '../lib/featureFlags';
 * 
 * function MyComponent() {
 *   const isDevToolsEnabled = useFeatureFlag('devTools');
 *   // ...
 * }
 * ```
 */

export {
  featureFlagCacheManager,
  isFeatureEnabled,
  getAllFeatureFlags,
} from './featureFlagCacheManager';

export {
  useFeatureFlag,
  useFeatureFlags,
} from './useFeatureFlag';
