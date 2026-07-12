/**
 * Skill Client Cache Manager (Frontend).
 *
 * Thin instantiation of {@link ../sidecar/sidecarListCacheManager} for the
 * global skill registry (`skills.json`). Pulls via `profile.getSkillsForAlias`
 * and replaces the list on each `skills:changed` push. Part of the sidecar
 * renderer-normalization workstream (see
 * docs/sidecar-renderer-normalization-tech-doc.md).
 */

import type { SkillConfig } from '../../../main/lib/userDataADO/types/profile';
import { SidecarListCacheManager } from '../sidecar/sidecarListCacheManager';

export const skillClientCacheManager = new SidecarListCacheManager<SkillConfig>({
  label: 'Skill',
  pull: (alias) => window.electronAPI?.profile?.getSkillsForAlias?.(alias),
  subscribeRaw: (handler) => window.electronAPI?.profile?.onSkillsChanged?.(handler),
  extractItems: (payload) => payload?.skills ?? payload?.data,
});

export type { SkillConfig };
