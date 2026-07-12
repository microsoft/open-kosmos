/**
 * React hook over the normalized skill cache (sidecar renderer-normalization).
 * Falls back to `fallback` (typically `profile.skills`) while the cache is cold.
 */

import type { SkillConfig } from '../../../main/lib/userDataADO/types/profile';
import { useSidecarList } from '../sidecar/useSidecarList';
import { skillClientCacheManager } from './skillClientCacheManager';

export function useSkills(fallback?: SkillConfig[] | null): SkillConfig[] {
  return useSidecarList(skillClientCacheManager, fallback);
}
