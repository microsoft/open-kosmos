/**
 * Chat -> agent resolution bridge for the sidecar renderer-normalization
 * workstream (see docs/sidecar-renderer-normalization-tech-doc.md).
 *
 * Phase 3b migrates the ~20 renderer consumers that still read the inline
 * `chat.agent` recompose facade. Rather than rewrite each consumer's reactivity
 * model, they resolve the agent through these helpers, which prefer the
 * normalized {@link ./agentClientCacheManager} and fall back to the inline
 * `chat.agent` while the facade still exists (pre-Phase 4). Once the recompose
 * glue is removed, the same call sites keep working because the agent is
 * resolved from the store-backed cache by `agent_ids`.
 */

import { useEffect, useRef, useState } from 'react';
import { agentClientCacheManager } from './agentClientCacheManager';
import type { ResolvedAgent } from './useAgents';

/**
 * The minimal shape these helpers need from a chat: the inline facade (still
 * present pre-Phase 4) plus the store id references.
 */
export interface ChatAgentSource {
  agent?: ResolvedAgent | null;
  agents?: ResolvedAgent[] | null;
  agent_ids?: string[];
}

/**
 * The store id to resolve a chat's (single) agent by: the inline agent's own id
 * when present, otherwise the first `agent_ids` entry.
 */
export function chatAgentId(chat: ChatAgentSource | null | undefined): string | undefined {
  return chat?.agent?.id ?? chat?.agent_ids?.[0];
}

/**
 * Imperative resolve: the cached agent if present, else the inline `chat.agent`
 * fallback. Use in non-React contexts (helpers invoked from effects, imperative
 * `profileDataManager` readers). Not reactive on its own — the caller's existing
 * subscription (e.g. `profileDataManager.subscribe`) drives re-renders while the
 * facade still pushes; Phase 4 adds cache subscriptions where needed.
 */
export function resolveChatAgent(
  chat: ChatAgentSource | null | undefined,
): ResolvedAgent | null {
  return agentClientCacheManager.getAgent(chatAgentId(chat)) ?? chat?.agent ?? null;
}

/**
 * Imperative resolve for a multi-agent chat: walk `agent_ids` in order and use
 * each cached agent when available, falling back to the matching inline facade
 * entry. This keeps cold or partially-warmed renderer caches from collapsing a
 * migrated multi-agent chat to zero agents while preserving the `agent_ids`
 * order callers expect. Returns `[]` for a chat with neither.
 */
export function resolveChatAgents(
  chat: ChatAgentSource | null | undefined,
): ResolvedAgent[] {
  const ids = chat?.agent_ids;
  const inlineAgents = Array.isArray(chat?.agents) ? chat.agents : [];
  if (Array.isArray(ids) && ids.length > 0) {
    const inlineById = new Map(
      inlineAgents
        .filter((agent): agent is ResolvedAgent & { id: string } => typeof agent?.id === 'string' && agent.id.length > 0)
        .map(agent => [agent.id, agent]),
    );
    const resolved = ids
      .map((id, index) => agentClientCacheManager.getAgent(id) ?? inlineById.get(id) ?? inlineAgents[index] ?? null)
      .filter((agent): agent is ResolvedAgent => Boolean(agent));
    if (resolved.length > 0) {
      return resolved;
    }
  }
  return inlineAgents;
}

/**
 * Reactive single-chat resolve for React components: reads the chat's agent from
 * the normalized cache (inline fallback) and re-renders when the cache changes.
 */
export function useChatAgent(
  chat: ChatAgentSource | null | undefined,
): ResolvedAgent | null {
  const fallbackRef = useRef<ResolvedAgent | null>(chat?.agent ?? null);
  fallbackRef.current = chat?.agent ?? null;
  const id = chatAgentId(chat);

  const [agent, setAgent] = useState<ResolvedAgent | null>(
    () => agentClientCacheManager.getAgent(id) ?? chat?.agent ?? null,
  );

  useEffect(() => {
    const resolve = () => {
      setAgent(agentClientCacheManager.getAgent(id) ?? fallbackRef.current ?? null);
    };
    resolve();
    return agentClientCacheManager.subscribe(resolve);
  }, [id]);

  return agent;
}

/**
 * Reactive multi-chat resolve: returns a `chat_id -> agent` map for consumers
 * that filter/map over the whole chat list (nav, badges, apply dialogs). Rebuilds
 * when the cache changes or the chat set (ids + agent ids) changes.
 */
export function useChatAgentMap(
  chats: Array<{ chat_id: string } & ChatAgentSource> | null | undefined,
): Map<string, ResolvedAgent> {
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const key = Array.isArray(chats)
    ? chats.map((chat) => `${chat.chat_id}:${chatAgentId(chat) ?? ''}`).join('|')
    : '';

  const [map, setMap] = useState<Map<string, ResolvedAgent>>(() => buildChatAgentMap(chats));

  useEffect(() => {
    const resolve = () => {
      setMap(buildChatAgentMap(chatsRef.current));
    };
    resolve();
    return agentClientCacheManager.subscribe(resolve);
    // `key` captures the chat set identity; the chat list is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

function buildChatAgentMap(
  chats: Array<{ chat_id: string } & ChatAgentSource> | null | undefined,
): Map<string, ResolvedAgent> {
  const next = new Map<string, ResolvedAgent>();
  if (!Array.isArray(chats)) {
    return next;
  }
  for (const chat of chats) {
    const resolved = resolveChatAgent(chat);
    if (resolved) {
      next.set(chat.chat_id, resolved);
    }
  }
  return next;
}
