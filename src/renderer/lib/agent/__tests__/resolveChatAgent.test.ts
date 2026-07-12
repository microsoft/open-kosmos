/**
 * @vitest-environment happy-dom
 *
 * Tests for the Phase 3b chat -> agent resolution bridge. Drives the real
 * helpers with a mocked agentClientCacheManager so every branch of chatAgentId,
 * resolveChatAgent, useChatAgent and useChatAgentMap is covered.
 */

import { renderHook, act } from '@testing-library/react';

let cacheStore: Map<string, ResolvedAgent>;
let capturedListener: (() => void) | null;

vi.mock('../agentClientCacheManager', () => ({
  agentClientCacheManager: {
    getAgent: (id: string | undefined | null) =>
      (id ? cacheStore.get(id) ?? null : null),
    getAgents: (ids: string[] | undefined | null) => {
      if (!Array.isArray(ids)) {
        return [];
      }
      const resolved: ResolvedAgent[] = [];
      for (const id of ids) {
        const agent = cacheStore.get(id);
        if (agent) {
          resolved.push(agent);
        }
      }
      return resolved;
    },
    subscribe: (cb: () => void) => {
      capturedListener = cb;
      return () => {
        capturedListener = null;
      };
    },
  },
}));

import {
  chatAgentId,
  resolveChatAgent,
  resolveChatAgents,
  useChatAgent,
  useChatAgentMap,
} from '../resolveChatAgent';
import type { ResolvedAgent } from '../useAgents';

const mkAgent = (id: string, name: string): ResolvedAgent =>
  ({ id, name, mcp_servers: [], skills: [] }) as unknown as ResolvedAgent;

const cacheAgent = mkAgent('agent_1', 'Cache Agent');
const inlineAgent = mkAgent('agent_1', 'Inline Agent');

beforeEach(() => {
  cacheStore = new Map();
  capturedListener = null;
});

describe('chatAgentId', () => {
  it('prefers the inline agent id', () => {
    expect(chatAgentId({ agent: mkAgent('a', 'x'), agent_ids: ['b'] })).toBe('a');
  });

  it('falls back to agent_ids[0] when the inline agent has no id', () => {
    expect(chatAgentId({ agent: { name: 'x', mcp_servers: [], skills: [] } as never, agent_ids: ['b'] })).toBe('b');
  });

  it('returns undefined when neither is present', () => {
    expect(chatAgentId({ agent_ids: [] })).toBeUndefined();
    expect(chatAgentId({})).toBeUndefined();
  });

  it('returns undefined for a null chat', () => {
    expect(chatAgentId(null)).toBeUndefined();
    expect(chatAgentId(undefined)).toBeUndefined();
  });
});

describe('resolveChatAgent', () => {
  it('returns the cached agent when present', () => {
    cacheStore.set('agent_1', cacheAgent);
    expect(resolveChatAgent({ agent: inlineAgent, agent_ids: ['agent_1'] })).toBe(cacheAgent);
  });

  it('falls back to the inline agent on a cache miss', () => {
    expect(resolveChatAgent({ agent: inlineAgent, agent_ids: ['agent_1'] })).toBe(inlineAgent);
  });

  it('returns null when the cache misses and there is no inline agent', () => {
    expect(resolveChatAgent({ agent_ids: ['agent_1'] })).toBeNull();
    expect(resolveChatAgent(null)).toBeNull();
  });
});

describe('resolveChatAgents', () => {
  const cacheA = mkAgent('a', 'Cache A');
  const cacheB = mkAgent('b', 'Cache B');
  const inlineAgents = [mkAgent('a', 'Inline A'), mkAgent('b', 'Inline B')];

  it('returns the cached agents in agent_ids order on a full cache hit', () => {
    cacheStore.set('a', cacheA);
    cacheStore.set('b', cacheB);
    expect(resolveChatAgents({ agent_ids: ['a', 'b'], agents: inlineAgents })).toEqual([
      cacheA,
      cacheB,
    ]);
  });

  it('uses cached agents and inline fallback by id order when the cache resolves only some ids', () => {
    cacheStore.set('a', cacheA);
    expect(resolveChatAgents({ agent_ids: ['a', 'b'], agents: inlineAgents })).toEqual([cacheA, inlineAgents[1]]);
  });

  it('keeps partially resolved cached agents even without inline agents', () => {
    cacheStore.set('a', cacheA);
    expect(resolveChatAgents({ agent_ids: ['a', 'b'] })).toEqual([cacheA]);
  });

  it('falls back to inline agents when agent_ids is empty', () => {
    expect(resolveChatAgents({ agent_ids: [], agents: inlineAgents })).toBe(inlineAgents);
  });

  it('falls back to inline agents when there are no agent_ids', () => {
    expect(resolveChatAgents({ agents: inlineAgents })).toBe(inlineAgents);
  });

  it('returns an empty array for a null chat', () => {
    expect(resolveChatAgents(null)).toEqual([]);
    expect(resolveChatAgents(undefined)).toEqual([]);
  });
});

describe('useChatAgent', () => {
  it('resolves from the cache and re-renders on a cache push', () => {
    const chat = { agent: inlineAgent, agent_ids: ['agent_1'] };
    const { result } = renderHook(() => useChatAgent(chat));
    // Cache cold -> inline fallback.
    expect(result.current).toBe(inlineAgent);

    // Warm the cache and fire the push.
    cacheStore.set('agent_1', cacheAgent);
    act(() => {
      capturedListener?.();
    });
    expect(result.current).toBe(cacheAgent);
  });

  it('returns null when there is no id and no inline fallback', () => {
    const { result } = renderHook(() => useChatAgent({ agent_ids: [] }));
    expect(result.current).toBeNull();
  });

  it('re-resolves when the chat id changes', () => {
    cacheStore.set('agent_1', cacheAgent);
    cacheStore.set('agent_2', mkAgent('agent_2', 'Second'));
    const { result, rerender } = renderHook(({ chat }) => useChatAgent(chat), {
      initialProps: { chat: { agent_ids: ['agent_1'] } as { agent_ids: string[] } },
    });
    expect(result.current).toBe(cacheAgent);

    rerender({ chat: { agent_ids: ['agent_2'] } });
    expect(result.current?.name).toBe('Second');
  });
});

describe('useChatAgentMap', () => {
  it('returns an empty map for null/empty chats', () => {
    const { result } = renderHook(() => useChatAgentMap(null));
    expect(result.current.size).toBe(0);
  });

  it('builds a chat_id -> agent map preferring the cache, dropping unresolved chats', () => {
    cacheStore.set('agent_1', cacheAgent);
    const chats = [
      { chat_id: 'chat-1', agent: inlineAgent, agent_ids: ['agent_1'] },
      { chat_id: 'chat-2', agent: { name: 'Inline Only', mcp_servers: [], skills: [] } as never, agent_ids: ['agent_2'] },
      { chat_id: 'chat-3', agent_ids: ['missing'] },
      { chat_id: 'chat-4' },
    ];
    const { result } = renderHook(() => useChatAgentMap(chats));
    expect(result.current.get('chat-1')).toBe(cacheAgent);
    // chat-2 cache miss -> inline fallback kept.
    expect(result.current.get('chat-2')).toMatchObject({ name: 'Inline Only' });
    // chat-3 has neither cache nor inline -> dropped.
    expect(result.current.has('chat-3')).toBe(false);
    // chat-4 has no agent id at all (key builder '' arm) -> dropped.
    expect(result.current.has('chat-4')).toBe(false);
    expect(result.current.size).toBe(2);
  });

  it('rebuilds when a cache push arrives', () => {
    const chats = [{ chat_id: 'chat-1', agent: inlineAgent, agent_ids: ['agent_1'] }];
    const { result } = renderHook(() => useChatAgentMap(chats));
    expect(result.current.get('chat-1')).toBe(inlineAgent);

    cacheStore.set('agent_1', cacheAgent);
    act(() => {
      capturedListener?.();
    });
    expect(result.current.get('chat-1')).toBe(cacheAgent);
  });

  it('rebuilds when the chat set identity changes', () => {
    cacheStore.set('agent_1', cacheAgent);
    const { result, rerender } = renderHook(({ chats }) => useChatAgentMap(chats), {
      initialProps: { chats: [{ chat_id: 'chat-1', agent_ids: ['agent_1'] }] as Array<{ chat_id: string; agent_ids: string[] }> },
    });
    expect(result.current.size).toBe(1);

    rerender({ chats: [] });
    expect(result.current.size).toBe(0);
  });
});
