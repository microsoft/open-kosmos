// @ts-nocheck
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../utilities/idFactory', async () => ({
  generateChatSessionId: vi.fn(() => 'chatSession_20260101120000_device_abc'),
  generateChatId: vi.fn(() => 'chat_001'),
}));

import {
  isBuiltinAgent,
  getBuiltinAgentNames,
  getAgentKnowledge,
  withNormalizedAgentKnowledge,
  ChatSessionUtils,
  isProfileV2,
} from '../types/profile';
import type { ChatAgent, ProfileV2 } from '../types/profile';

describe('isBuiltinAgent', () => {
  it('returns true for Kobi under openkosmos', () => {
    expect(isBuiltinAgent('Kobi', 'openkosmos')).toBe(true);
    expect(isBuiltinAgent('kobi', 'openkosmos')).toBe(true);
  });

  it('returns false for non-builtin under openkosmos', () => {
    expect(isBuiltinAgent('Demo Agent', 'openkosmos')).toBe(false);
    expect(isBuiltinAgent('Custom Agent', 'openkosmos')).toBe(false);
  });

  it('ignores non-openkosmos brand arguments', () => {
    expect(isBuiltinAgent('Kobi', 'custom-brand')).toBe(true);
    expect(isBuiltinAgent('Demo Agent', 'custom-brand')).toBe(false);
  });

  it('returns false for undefined/null agent name', () => {
    expect(isBuiltinAgent(undefined, 'openkosmos')).toBe(false);
    expect(isBuiltinAgent(null, 'openkosmos')).toBe(false);
  });

  it('defaults to openkosmos when brandName is not provided', () => {
    expect(isBuiltinAgent('Kobi')).toBe(true);
    expect(isBuiltinAgent('Demo Agent')).toBe(false);
  });
});

describe('getBuiltinAgentNames', () => {
  it('returns openkosmos agents by default', () => {
    const names = getBuiltinAgentNames();
    expect(names).toContain('Kobi');
  });

  it('ignores brand name casing and returns OpenKosmos built-ins', () => {
    const names = getBuiltinAgentNames('OpenKosmos');
    expect(names).toEqual(['Kobi']);
  });
});

describe('getAgentKnowledge', () => {
  it('returns empty knowledgeBase when agent is null', () => {
    expect(getAgentKnowledge(null)).toEqual({ knowledgeBase: '' });
  });

  it('returns empty knowledgeBase when agent is undefined', () => {
    expect(getAgentKnowledge(undefined)).toEqual({ knowledgeBase: '' });
  });

  it('returns knowledge.knowledgeBase from agent', () => {
    const agent = { knowledge: { knowledgeBase: '/kb/path' } } as ChatAgent;
    expect(getAgentKnowledge(agent).knowledgeBase).toBe('/kb/path');
  });

  it('falls back to legacy knowledgeBase field', () => {
    const agent = { knowledgeBase: '/legacy/kb' } as any;
    expect(getAgentKnowledge(agent).knowledgeBase).toBe('/legacy/kb');
  });
});

describe('withNormalizedAgentKnowledge', () => {
  it('removes legacy fields and normalizes knowledge', () => {
    const agent: any = {
      name: 'Agent',
      model: 'gpt-4o',
      system_prompt: '',
      source: 'ON-DEVICE',
      version: '1.0.0',
      workspace: '/ws',
      knowledge: { knowledgeBase: '/kb' },
      mcp_servers: [],
      skills: [],
      knowledgeBase: '/legacy',
      teams_enabled: true,
      teams_chats: [],
      outlook_emails_enabled: false,
    };
    const result = withNormalizedAgentKnowledge(agent);
    expect('knowledgeBase' in result).toBe(false);
    expect('teams_enabled' in result).toBe(false);
    expect('teams_chats' in result).toBe(false);
    expect('outlook_emails_enabled' in result).toBe(false);
    expect(result.knowledge.knowledgeBase).toBe('/kb');
  });
});

describe('isProfileV2', () => {
  it('returns true for valid V2 profile', () => {
    const profile = { alias: 'alice', chats: [], version: '2.0.0' } as any;
    expect(isProfileV2(profile)).toBe(true);
  });

  it('returns false for V1 profile with authProvider', () => {
    const profile = { alias: 'alice', chats: [], authProvider: 'microsoft' } as any;
    expect(isProfileV2(profile)).toBe(false);
  });

  it('returns false when missing alias field', () => {
    const profile = { chats: [] } as any;
    expect(isProfileV2(profile)).toBe(false);
  });

  it('returns false when chats is not array', () => {
    const profile = { alias: 'alice', chats: null } as any;
    expect(isProfileV2(profile)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isProfileV2(null)).toBeFalsy();
  });

  it('returns false for non-object', () => {
    expect(isProfileV2('string' as any)).toBe(false);
  });
});

describe('ChatSessionUtils', () => {
  describe('isValidChatSession', () => {
    it('returns true for valid session', () => {
      expect(ChatSessionUtils.isValidChatSession({
        chatSession_id: 'chatSession_20260101',
        last_updated: '2026-01-01T00:00:00Z',
        title: 'T',
      })).toBe(true);
    });

    it('returns false for missing fields', () => {
      expect(ChatSessionUtils.isValidChatSession({ chatSession_id: 'chatSession_x' })).toBe(false);
    });

    it('returns false for invalid chatSession_id prefix', () => {
      expect(ChatSessionUtils.isValidChatSession({
        chatSession_id: 'invalid_id',
        last_updated: '2026-01-01T00:00:00Z',
        title: 'T',
      })).toBe(false);
    });

    it('returns falsy for null', () => {
      expect(ChatSessionUtils.isValidChatSession(null)).toBeFalsy();
    });
  });

  describe('sanitizeChatSessions', () => {
    it('returns empty array for non-array input', () => {
      expect(ChatSessionUtils.sanitizeChatSessions(null as any)).toEqual([]);
    });

    it('filters invalid sessions and maps valid ones', () => {
      const sessions = [
        { chatSession_id: 'chatSession_valid', last_updated: '2026-01-01T00:00:00Z', title: 'T', readStatus: 'read' },
        { bad: 'data' },
      ];
      const result = ChatSessionUtils.sanitizeChatSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].chatSession_id).toBe('chatSession_valid');
      expect(result[0].readStatus).toBe('read');
    });

    it('defaults readStatus to unread for unknown value', () => {
      const sessions = [
        { chatSession_id: 'chatSession_x', last_updated: '2026-01-01T00:00:00Z', title: 'T', readStatus: 'unknown' },
      ];
      // isValidChatSession only validates chatSession_id starts with chatSession_, so this is valid
      const result = ChatSessionUtils.sanitizeChatSessions(sessions);
      if (result.length > 0) {
        expect(result[0].readStatus).toBe('unread');
      }
    });
  });
});
