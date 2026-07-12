import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getChatAgents,
  getChatPrimaryAgent,
  getChatAgentIds,
  chatHasAgentId,
  findChatByPrimaryChat,
  getChatWorkspace,
  setAccessorAgentResolver,
  agentIdOf,
  collectAgentIdsReferencedByOtherChats,
} from '../agentAccessor';
import { ChatConfig, ChatAgent } from '../types/profile';

function agent(name: string, source: 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL' = 'ON-DEVICE'): ChatAgent {
  return { name, source, mcp_servers: [], system_prompt: '' } as unknown as ChatAgent;
}

function chat(partial: Partial<ChatConfig>): ChatConfig {
  return { chat_id: 'chat_x', chat_type: 'single_agent', ...partial } as ChatConfig;
}

describe('agentAccessor', () => {
  describe('getChatAgents', () => {
    it('returns [] for undefined chat', () => {
      expect(getChatAgents(undefined)).toEqual([]);
    });
    it('prefers non-empty agents array', () => {
      const a = agent('A');
      const b = agent('B');
      expect(getChatAgents(chat({ agents: [a, b] }))).toEqual([a, b]);
    });
    it('falls back to inline single agent', () => {
      const a = agent('A');
      expect(getChatAgents(chat({ agents: [], agent: a }))).toEqual([a]);
    });
    it('returns [] when neither present', () => {
      expect(getChatAgents(chat({}))).toEqual([]);
    });
  });

  describe('getChatPrimaryAgent', () => {
    it('returns first agent', () => {
      const a = agent('A');
      expect(getChatPrimaryAgent(chat({ agents: [a, agent('B')] }))).toBe(a);
    });
    it('prefers the distinct inline primary agent over the agents list head', () => {
      const primary = agent('Primary');
      const listHead = agent('ListHead');
      expect(
        getChatPrimaryAgent(chat({ agent: primary, agents: [listHead, agent('Other')] })),
      ).toBe(primary);
    });
    it('returns undefined when none', () => {
      expect(getChatPrimaryAgent(chat({}))).toBeUndefined();
    });
  });

  describe('getChatWorkspace', () => {
    it('prefers chat.workspace over legacy agent.workspace', () => {
      expect(getChatWorkspace(chat({
        workspace: '/chat-workspace',
        agent: { ...agent('A'), workspace: '/legacy-agent-workspace' } as ChatAgent,
      }))).toBe('/chat-workspace');
    });

    it('falls back to legacy agent.workspace for pre-migration chats', () => {
      expect(getChatWorkspace(chat({
        agent: { ...agent('A'), workspace: '/legacy-agent-workspace' } as ChatAgent,
      }))).toBe('/legacy-agent-workspace');
    });
  });

  describe('agentIdOf', () => {
    it('returns the carried id when present (stable across renames)', () => {
      expect(agentIdOf({ id: 'agent_20260701_abc', name: 'Kobi', source: 'ON-DEVICE' })).toBe('agent_20260701_abc');
      // A rename (new name) keeps the same carried id.
      expect(agentIdOf({ id: 'agent_20260701_abc', name: 'Renamed', source: 'ON-DEVICE' })).toBe('agent_20260701_abc');
    });

    it('falls back to the legacy name-derived id when no id is carried', () => {
      expect(agentIdOf({ name: 'Kobi', source: 'ON-DEVICE' })).toBe('agent-kobi-on-device');
      expect(agentIdOf({ id: '', name: 'Kobi', source: 'ON-DEVICE' })).toBe('agent-kobi-on-device');
    });

    it('defaults source to on-device in the legacy fallback', () => {
      expect(agentIdOf({ name: 'Solo' })).toBe('agent-solo-on-device');
    });
  });

  describe('getChatAgentIds', () => {
    it('returns [] for undefined chat', () => {
      expect(getChatAgentIds(undefined)).toEqual([]);
    });
    it('prefers explicit agent_ids', () => {
      expect(getChatAgentIds(chat({ agent_ids: ['agent-x-on-device'] }))).toEqual(['agent-x-on-device']);
    });
    it('derives ids from inline agents, skipping nameless', () => {
      const named = agent('Kobi');
      const nameless = { source: 'ON-DEVICE', mcp_servers: [], system_prompt: '' } as unknown as ChatAgent;
      expect(getChatAgentIds(chat({ agent_ids: [], agents: [named, nameless] }))).toEqual(['agent-kobi-on-device']);
    });
  });

  describe('chatHasAgentId', () => {
    it('true when id present', () => {
      expect(chatHasAgentId(chat({ agent_ids: ['agent-kobi-on-device'] }), 'agent-kobi-on-device')).toBe(true);
    });
    it('false when absent', () => {
      expect(chatHasAgentId(chat({ agent_ids: ['agent-kobi-on-device'] }), 'agent-z-on-device')).toBe(false);
    });
  });

  describe('findChatByPrimaryChat', () => {
    const c1 = chat({ chat_id: 'c1', agent: agent('Kobi') });
    const c2 = chat({ chat_id: 'c2', agent_ids: ['agent-zed-on-device'], agent: agent('Zed') });
    it('returns undefined for non-array chats', () => {
      expect(findChatByPrimaryChat(undefined, 'c1')).toBeUndefined();
    });
    it('returns undefined when primaryChat empty', () => {
      expect(findChatByPrimaryChat([c1], '')).toBeUndefined();
    });
    it('matches by chat_id', () => {
      expect(findChatByPrimaryChat([c1, c2], 'c1')).toBe(c1);
      expect(findChatByPrimaryChat([c1, c2], 'c2')).toBe(c2);
    });
    it('returns undefined on no chat_id match', () => {
      expect(findChatByPrimaryChat([c1, c2], 'nope')).toBeUndefined();
    });
  });

  describe('setAccessorAgentResolver', () => {
    afterEach(() => {
      // Restore the inline-only default so other tests aren't affected.
      setAccessorAgentResolver(null);
    });

    it('resolves agent_ids through the installed resolver when no inline data', () => {
      const resolved = agent('Resolved');
      setAccessorAgentResolver((ids) => (ids.includes('id-1') ? [resolved] : []));
      expect(getChatAgents(chat({ agent_ids: ['id-1'] }))).toEqual([resolved]);
      expect(getChatPrimaryAgent(chat({ agent_ids: ['id-1'] }))).toBe(resolved);
    });

    it('does not call resolver when agent_ids is empty', () => {
      const r = vi.fn(() => [agent('X')]);
      setAccessorAgentResolver(r);
      expect(getChatAgents(chat({ agent_ids: [] }))).toEqual([]);
      expect(r).not.toHaveBeenCalled();
    });

    it('prefers inline over resolver', () => {
      const inline = agent('Inline');
      setAccessorAgentResolver(() => [agent('FromStore')]);
      expect(getChatAgents(chat({ agent: inline, agent_ids: ['id-1'] }))).toEqual([inline]);
    });

    it('null restores inline-only default returning [] for id-only chats', () => {
      setAccessorAgentResolver(() => [agent('X')]);
      setAccessorAgentResolver(null);
      expect(getChatAgents(chat({ agent_ids: ['id-1'] }))).toEqual([]);
    });
  });

  describe('collectAgentIdsReferencedByOtherChats', () => {
    it('returns an empty set for null/undefined profile', () => {
      expect(collectAgentIdsReferencedByOtherChats(null, 'c1').size).toBe(0);
      expect(collectAgentIdsReferencedByOtherChats(undefined, 'c1').size).toBe(0);
    });

    it('unions ids from other active chats and archived chats, excluding self', () => {
      const profile = {
        chats: [
          chat({ chat_id: 'c1', agent_ids: ['shared', 'only-c1'] }),
          chat({ chat_id: 'c2', agent_ids: ['shared', 'only-c2'] }),
        ],
        archived_chats: [
          { chat_id: 'arch1', agent_ids: ['shared', 'only-arch'] },
          { chat_id: 'c1', agent_ids: ['excluded-because-self'] },
        ],
      };
      const result = collectAgentIdsReferencedByOtherChats(profile, 'c1');
      expect([...result].sort()).toEqual(['only-arch', 'only-c2', 'shared'].sort());
      expect(result.has('only-c1')).toBe(false);
      expect(result.has('excluded-because-self')).toBe(false);
    });

    it('tolerates missing chats/archived_chats and skips null/id-less entries', () => {
      const profile = {
        chats: [null as any, chat({ chat_id: 'c9', agent_ids: ['a9'] })],
        archived_chats: [null as any, { chat_id: 'arch', agent_ids: undefined }],
      };
      const result = collectAgentIdsReferencedByOtherChats(profile, 'other');
      expect([...result]).toEqual(['a9']);
    });
  });
});
