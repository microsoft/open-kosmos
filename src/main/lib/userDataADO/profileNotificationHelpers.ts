/**
 * Pure helpers extracted from ProfileCacheManager.performNotification so the
 * notification wire-format logic is unit-testable independently of the large
 * cache-manager flow (and to keep that legacy file from growing further).
 *
 * Three concerns live here:
 *  - {@link emitSidecarChangeEvents}: the granular per-entity change pushes
 *    (agents/skills/hooks) that feed the normalized renderer caches.
 *  - {@link buildRendererProfilePayload}: the `profile:cacheUpdated` profile
 *    body — chats stripped to `agent_ids` only, with the sidecar slices
 *    (mcp_servers/skills/hooks) re-attached so the renderer wire contract is
 *    unchanged even though those slices live outside profile.json now.
 *  - {@link mapChatSessionProjection}: maps a raw chatSession projection row to
 *    the wire shape, dropping absent optional fields.
 */

import type { WebContents } from 'electron';
import type { BrowserWindow } from 'electron';
import type {
  ProfileV2,
  ChatConfigRuntime,
  ChatSession,
  McpServerConfig,
  HookDefinition,
  SkillConfig,
} from './types/profile';
import type { AgentConfig } from './types/agentStore';

/**
 * Resolve the window that should receive profile notifications. Prefers an
 * explicitly-set main window (when still alive); otherwise scans all open
 * windows, matching by the OpenKosmos title or the provided APP_NAME, and
 * finally falls back to the sole open window. `getWindows` is a thunk so the
 * (potentially costly) window enumeration is skipped when the preferred window
 * is valid. Returns undefined when no suitable window is found.
 */
export function findNotificationTargetWindow(
  preferred: BrowserWindow | null | undefined,
  getWindows: () => BrowserWindow[],
  appTitle: string | undefined,
): BrowserWindow | null | undefined {
  if (preferred && !preferred.isDestroyed()) {
    return preferred;
  }
  const windows = getWindows();
  // Window lookup strategy:
  // 1. Exact title match
  // 2. Provided APP_NAME, or a title containing the OpenKosmos brand token
  // 3. Fall back to the only open window
  const match = windows.find((window) => {
    const title = window.title;
    if (title === 'OpenKosmos AI Studio') {
      return true;
    }
    if (appTitle && title === appTitle) {
      return true;
    }
    return title.includes('OpenKosmos');
  });
  if (match) {
    return match;
  }
  if (windows.length === 1) {
    return windows[0];
  }
  return undefined;
}

/** The three store-backed slices pushed as their own change events. */
export interface SidecarChangeSlices {
  agents: AgentConfig[];
  skills: SkillConfig[];
  hooks: HookDefinition[];
}

/**
 * Emit the per-sidecar change events (agents/skills/hooks) to a window's
 * webContents alongside the whole-profile `profile:cacheUpdated` push. Phase 1
 * of renderer normalization: the normalized renderer caches consume these
 * per-entity slices instead of re-parsing the monolithic profile. The full
 * current list is pushed per alias; each renderer cache replaces/merges by id.
 */
export function emitSidecarChangeEvents(
  webContents: WebContents,
  alias: string,
  slices: SidecarChangeSlices,
): void {
  const now = Date.now();
  webContents.send('agents:changed', { alias, agents: slices.agents, timestamp: now });
  webContents.send('skills:changed', { alias, skills: slices.skills, timestamp: now });
  webContents.send('hooks:changed', { alias, hooks: slices.hooks, timestamp: now });
}

/** The sidecar slices re-attached to the pushed profile body. */
export interface RendererProfileSidecars {
  mcp_servers: McpServerConfig[];
  skills: SkillConfig[];
  hooks: HookDefinition[];
}

/**
 * Build the profile body for the `profile:cacheUpdated` push. A chat is stripped
 * to `agent_ids` only when every id resolves in `registeredAgents` (the same
 * store-backed slice pushed via `agents:changed` just before this), so the
 * renderer resolves those agents from its client cache via the `resolveChatAgent`
 * bridge and the wire no longer carries a second, echo-prone source of truth.
 * A chat whose agent is NOT in the registry (e.g. its `agents/{id}/agent.json`
 * write failed, so `stripInlineChatAgentsForDisk` kept it inline on the cached
 * profile) KEEPS its inline `agent`/`agents` facade here too — otherwise the push
 * would drop the inline copy while `agents:changed` also lacks it, and
 * `resolveChatAgent` would resolve null and render the chat agent-less (no
 * model/tools). This mirrors {@link stripInlineChatAgentsForDisk}'s durability
 * gate on the disk copy. The installed MCP servers, global skill registry, and
 * Agent Hook library live in their own managers (mcp.json / skills.json /
 * hooks.json), so they are re-attached here to keep the renderer wire contract
 * unchanged. Does not mutate the input.
 */
export function buildRendererProfilePayload(
  profile: Omit<ProfileV2, 'chats'> & { chats: ChatConfigRuntime[] },
  fieldAlias: string,
  sidecars: RendererProfileSidecars,
  registeredAgents: AgentConfig[],
): Omit<ProfileV2, 'chats'> & { chats: ChatConfigRuntime[] } {
  const registeredIds = new Set(registeredAgents.map((agent) => agent.id));
  return {
    ...profile,
    chats: Array.isArray(profile.chats)
      ? profile.chats.map((chat) => {
          const ids = Array.isArray(chat.agent_ids) ? chat.agent_ids : [];
          const durable = ids.length > 0 && ids.every((id) => registeredIds.has(id));
          if (!durable) {
            return chat;
          }
          const rest = { ...chat };
          delete rest.agent;
          delete rest.agents;
          return rest;
        })
      : profile.chats,
    alias: fieldAlias,
    mcp_servers: sidecars.mcp_servers,
    skills: sidecars.skills,
    hooks: sidecars.hooks,
  };
}

/**
 * Inverse of {@link buildRendererProfilePayload}'s agent stripping: re-attach the
 * inline `agent`/`agents` facade to an `agent_ids`-only profile by resolving each
 * chat's ids against the in-memory agent registry snapshot.
 *
 * This exists for the `profile:getProfile` fallback path. The `profile:cacheUpdated`
 * push is safe with agent_ids-only chats because it emits `agents:changed` to warm the
 * renderer agent cache *before* the profile arrives (see performNotification), so
 * `resolveChatAgent` always finds the agent. The direct `getProfile` return has no such
 * ordering guarantee: it is applied by the renderer fallback (profileDataManager) to
 * recover a lost push, and the agent cache may still be cold at that moment, so
 * `resolveChatAgent` would resolve `null` and leave the active agent/model/MCP set empty.
 * Re-injecting the inline agents (consumed by `resolveChatAgent`'s inline fallback until
 * the cache warms, then superseded by it) keeps the fallback self-sufficient — symmetric
 * with the mcp_servers/skills/hooks re-injection on the same response.
 *
 * A chat is left untouched when it already carries the inline facade, has no `agent_ids`,
 * or its ids resolve to nothing. Does not mutate the input.
 */
export function reinjectInlineChatAgents(
  profile: ProfileV2,
  registeredAgents: AgentConfig[],
): ProfileV2 {
  if (!Array.isArray(profile.chats) || profile.chats.length === 0) {
    return profile;
  }
  const byId = new Map(registeredAgents.map((agent) => [agent.id, agent]));
  const chats = profile.chats.map((chat) => {
    const ids = Array.isArray(chat.agent_ids) ? chat.agent_ids : [];
    if (ids.length === 0 || chat.agent || (Array.isArray(chat.agents) && chat.agents.length > 0)) {
      return chat;
    }
    const resolved = ids
      .map((id) => byId.get(id))
      .filter((agent): agent is AgentConfig => Boolean(agent));
    if (resolved.length === 0) {
      return chat;
    }
    return resolved.length > 1
      ? { ...chat, agent: resolved[0], agents: resolved }
      : { ...chat, agent: resolved[0] };
  });
  return { ...profile, chats };
}

/**
 * Map a raw chatSession projection row to the wire shape, including only the
 * optional scheduler/starred fields that are actually present so the payload
 * stays minimal (mirrors the projection's own sparseness).
 */
export function mapChatSessionProjection(s: any): ChatSession {
  return {
    chatSession_id: s.chatSession_id,
    last_updated: s.last_updated,
    title: s.title,
    readStatus: s.readStatus,
    ...(typeof s.starred === 'boolean' ? { starred: s.starred } : {}),
    ...(s.starredAt ? { starredAt: s.starredAt } : {}),
    ...(s.schedulerJobId ? { schedulerJobId: s.schedulerJobId } : {}),
    ...(s.schedulerExecutionStatus ? { schedulerExecutionStatus: s.schedulerExecutionStatus } : {}),
    ...(s.schedulerStartedAt ? { schedulerStartedAt: s.schedulerStartedAt } : {}),
    ...(s.schedulerCompletedAt ? { schedulerCompletedAt: s.schedulerCompletedAt } : {}),
    ...(s.schedulerError ? { schedulerError: s.schedulerError } : {}),
    source: s.source ? { ...s.source } : undefined,
  } as ChatSession;
}
