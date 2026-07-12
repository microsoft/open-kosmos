/**
 * Feature Flag React Hook
 *
 * Provides convenient hooks for checking feature flags in React components (read-only)
 */

import { useState, useEffect } from 'react';
import { featureFlagCacheManager } from './featureFlagCacheManager';

export interface FeatureFlagState {
  enabled: boolean;
  initialized: boolean;
}

function readFeatureFlagState(flagName: string): FeatureFlagState {
  const initialized = featureFlagCacheManager.isInitialized;
  return {
    enabled: initialized ? featureFlagCacheManager.isEnabled(flagName) : false,
    initialized,
  };
}

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
  return useFeatureFlagState(flagName).enabled;
}

export function useFeatureFlagState(flagName: string): FeatureFlagState {
  const [state, setState] = useState(() => readFeatureFlagState(flagName));

  useEffect(() => {
    const update = () => setState(readFeatureFlagState(flagName));
    update();
    return featureFlagCacheManager.subscribe(update);
  }, [flagName]);

  return state;
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
    const update = () => setFlags(featureFlagCacheManager.getAllFlags());
    update();
    return featureFlagCacheManager.subscribe(update);
  }, []);

  return flags;
}
