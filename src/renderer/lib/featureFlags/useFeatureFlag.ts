/**
 * Feature Flag React Hook
 *
 * Provides convenient hooks for checking feature flags in React components (read-only)
 */

import { useState, useEffect } from 'react';
import { featureFlagCacheManager } from './featureFlagCacheManager';

/**
 * Check whether a single feature flag is enabled
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isDevToolsEnabled = useFeatureFlag('devTools');
 *
 *   if (!isDevToolsEnabled) return null;
 *
 *   return <DevToolsPanel />;
 * }
 * ```
 */
export function useFeatureFlag(flagName: string): boolean {
  const [enabled, setEnabled] = useState(() =>
    featureFlagCacheManager.isEnabled(flagName)
  );

  useEffect(() => {
    // Re-check after initialization
    if (featureFlagCacheManager.isInitialized) {
      setEnabled(featureFlagCacheManager.isEnabled(flagName));
    }
  }, [flagName]);

  return enabled;
}

/**
 * Get all feature flags (read-only)
 *
 * @example
 * ```tsx
 * function DebugPanel() {
 *   const flags = useFeatureFlags();
 *
 *   return (
 *     <div>
 *       {Object.entries(flags).map(([name, enabled]) => (
 *         <div key={name}>{name}: {enabled ? 'ON' : 'OFF'}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFeatureFlags(): Record<string, boolean> {
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    featureFlagCacheManager.getAllFlags()
  );

  useEffect(() => {
    if (featureFlagCacheManager.isInitialized) {
      setFlags(featureFlagCacheManager.getAllFlags());
    }
  }, []);

  return flags;
}
