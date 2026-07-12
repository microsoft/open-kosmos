/**
 * Hook Client Cache Manager (Frontend).
 *
 * Thin instantiation of {@link ../sidecar/sidecarListCacheManager} for the
 * global Agent Hook library (`hooks.json`). Pulls via
 * `profile.getHooksForAlias` and replaces the list on each `hooks:changed`
 * push. Part of the sidecar renderer-normalization workstream (see
 * docs/sidecar-renderer-normalization-tech-doc.md).
 */

import type { HookDefinition } from '../../../shared/agentHooks/profileTypes';
import { SidecarListCacheManager } from '../sidecar/sidecarListCacheManager';

export const hookClientCacheManager = new SidecarListCacheManager<HookDefinition>({
  label: 'Hook',
  pull: (alias) => window.electronAPI?.profile?.getHooksForAlias?.(alias),
  subscribeRaw: (handler) => window.electronAPI?.profile?.onHooksChanged?.(handler),
  extractItems: (payload) => payload?.hooks ?? payload?.data,
});

export type { HookDefinition };
