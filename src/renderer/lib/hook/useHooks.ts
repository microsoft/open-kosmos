/**
 * React hook over the normalized hook cache (sidecar renderer-normalization).
 * Falls back to `fallback` (typically `profile.hooks`) while the cache is cold.
 */

import type { HookDefinition } from '../../../shared/agentHooks/profileTypes';
import { useSidecarList } from '../sidecar/useSidecarList';
import { hookClientCacheManager } from './hookClientCacheManager';

export function useHooks(fallback?: HookDefinition[] | null): HookDefinition[] {
  return useSidecarList(hookClientCacheManager, fallback);
}
