/**
 * Feature Flags frontend module exports (read-only access)
 *
 * Feature flags are defined by developers in the backend, or passed via CLI arguments:
 * --enable-features=flag1,flag2 --disable-features=flag3
 *
 * Usage:
 *
 * ```typescript
 * // Outside a component
 * import { isFeatureEnabled } from '../lib/featureFlags';
 *
 * if (isFeatureEnabled('devTools')) {
 *   // ...
 * }
 *
 * // Inside a React component
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
