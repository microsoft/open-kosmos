/**
 * React hooks over the {@link ./agentClientCacheManager} normalized agent cache.
 *
 * Part of the sidecar renderer-normalization workstream (see
 * docs/sidecar-renderer-normalization-tech-doc.md). These let consumers read
 * agents by id from the store-backed cache instead of the inline `chat.agent`
 * facade, while still accepting a `fallback` (typically the inline `chat.agent`)
 * so migrations can land additively before the facade is removed.
 */

import { useEffect, useRef, useState } from 'react';
import type { ChatAgent } from '../../../main/lib/userDataADO/types/profile';
import type { AgentConfig } from '../../../main/lib/userDataADO/types/agentStore';
import { agentClientCacheManager } from './agentClientCacheManager';

/** An agent resolved either from the store cache or an inline fallback. */
export type ResolvedAgent = ChatAgent | AgentConfig;

/**
 * Resolve a single agent by id from the normalized cache, re-rendering when the
 * cache changes. Falls back to `fallback` (e.g. inline `chat.agent`) when the id
 * is missing from the cache, so consumers can migrate before Phase 4/5.
 */
export function useAgent(
  id: string | undefined | null,
  fallback?: ResolvedAgent | null,
): ResolvedAgent | null {
  const fallbackRef = useRef<ResolvedAgent | null | undefined>(fallback);
  fallbackRef.current = fallback;

  const [agent, setAgent] = useState<ResolvedAgent | null>(
    () => agentClientCacheManager.getAgent(id) ?? fallback ?? null,
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
 * Resolve a list of agents by id from the normalized cache. When the cache
 * resolves none of the ids and a non-empty `fallback` is provided, the fallback
 * is returned instead (compat for the inline `chat.agents` facade).
 */
export function useAgents(
  ids: string[] | undefined | null,
  fallback?: ResolvedAgent[] | null,
): ResolvedAgent[] {
  const fallbackRef = useRef<ResolvedAgent[] | null | undefined>(fallback);
  fallbackRef.current = fallback;

  const idsKey = Array.isArray(ids) ? ids.join(',') : '';

  const [agents, setAgents] = useState<ResolvedAgent[]>(
    () => resolveAgents(ids, fallback),
  );

  useEffect(() => {
    const resolve = () => {
      setAgents(resolveAgents(ids, fallbackRef.current));
    };
    resolve();
    return agentClientCacheManager.subscribe(resolve);
    // idsKey captures the id list identity; fallback is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return agents;
}

function resolveAgents(
  ids: string[] | undefined | null,
  fallback: ResolvedAgent[] | null | undefined,
): ResolvedAgent[] {
  const resolved = agentClientCacheManager.getAgents(ids ?? []);
  if (resolved.length === 0 && fallback && fallback.length > 0) {
    return fallback;
  }
  return resolved;
}
