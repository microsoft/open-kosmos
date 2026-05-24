/**
 * Profile type definition unit tests
 *
 * Tests pure functions and utility methods exported from profile.ts:
 * - isProfileV2(): ProfileV2 type guard
 * - detectProfileVersion(): version detection
 * - isMcpServerConfig(): MCP server config type guard
 * - isBuiltinAgent() / getBuiltinAgentNames(): built-in agent checks
 * - ChatSessionUtils: ChatSession utility methods
 */

// Mock ghcModelsManager — profile.ts imports { getDefaultModel } from '../../llm/ghcModelsManager' at the top
// Must declare mock before importing profile.ts
vi.mock('../../llm/ghcModelsManager', async () => ({
  getDefaultModel: vi.fn(() => 'mock-default-model'),
}));

// profile.ts uses a lazy require('../../utilities/idFactory') inside ChatSessionUtils.generateChatSessionId().
// Vitest's vi.mock() does not intercept runtime require() calls that run through Node's native CJS resolver
// (which cannot resolve .ts extensions). We therefore spy on the static method directly after importing
// ChatSessionUtils, stubbing it in the ChatSessionUtils describe block's beforeEach.

import {
  isProfileV2,
  detectProfileVersion,
  isProfile,
  isMcpServerConfig,
  isBuiltinAgent,
  getBuiltinAgentNames,
  ChatSessionUtils,
  DEFAULT_CHAT_AGENT,
  DEFAULT_PROFILE_V2,
  DEFAULT_MCP_SERVER,
  BUILTIN_AGENT_NAMES_OpenKosmos,
} from '../types/profile';

// ============================================================
// isProfileV2 type guard
// ============================================================
describe('isProfileV2', () => {
  it('should return true for valid ProfileV2 object', () => {
    const profile = {
      version: '2.0.0',
      alias: 'testUser',
      chats: [],
      mcp_servers: [],
    };
    expect(isProfileV2(profile)).toBe(true);
  });

  it('should return true when optional fields are present', () => {
    const profile = {
      version: '2.0.0',
      alias: 'testUser',
      chats: [{ chat_id: 'chat_1', chat_type: 'single_agent' }],
      mcp_servers: [],
      skills: [],
      primaryAgent: 'Kobi',
      freDone: true,
    };
    expect(isProfileV2(profile)).toBe(true);
  });

  it('should return false when alias is missing', () => {
    const profile = { version: '2.0.0', chats: [] };
    expect(isProfileV2(profile)).toBe(false);
  });

  it('should return false when chats is missing', () => {
    const profile = { version: '2.0.0', alias: 'testUser' };
    expect(isProfileV2(profile)).toBe(false);
  });

  it('should return false when chats is not an array', () => {
    const profile = { version: '2.0.0', alias: 'testUser', chats: 'invalid' };
    expect(isProfileV2(profile)).toBe(false);
  });

  it('should return false when alias is not a string', () => {
    const profile = { version: '2.0.0', alias: 123, chats: [] };
    expect(isProfileV2(profile)).toBe(false);
  });

  it('should return false for V1-like profile with authProvider', () => {
    const profile = {
      alias: 'testUser',
      chats: [],
      authProvider: 'github',
    };
    expect(isProfileV2(profile)).toBe(false);
  });

  it('should return false for V1-like profile with ghcAuth', () => {
    const profile = {
      alias: 'testUser',
      chats: [],
      ghcAuth: { token: 'xxx' },
    };
    expect(isProfileV2(profile)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isProfileV2(null)).toBeFalsy();
  });

  it('should return false for undefined', () => {
    expect(isProfileV2(undefined)).toBeFalsy();
  });

  it('should return false for non-object types', () => {
    expect(isProfileV2('string')).toBe(false);
    expect(isProfileV2(42)).toBe(false);
    expect(isProfileV2(true)).toBe(false);
  });
});

// ============================================================
// detectProfileVersion
// ============================================================
describe('detectProfileVersion', () => {
  it('should return "v2" for valid ProfileV2', () => {
    const profile = { alias: 'user1', chats: [], mcp_servers: [] };
    expect(detectProfileVersion(profile)).toBe('v2');
  });

  it('should return "unknown" for invalid profile', () => {
    expect(detectProfileVersion({})).toBe('unknown');
    expect(detectProfileVersion(null)).toBe('unknown');
    expect(detectProfileVersion({ authProvider: 'github', alias: 'x', chats: [] })).toBe('unknown');
  });
});

// ============================================================
// isProfile (alias for isProfileV2)
// ============================================================
describe('isProfile', () => {
  it('should behave identically to isProfileV2', () => {
    const valid = { alias: 'user1', chats: [], mcp_servers: [] };
    const invalid = { foo: 'bar' };

    expect(isProfile(valid)).toBe(isProfileV2(valid));
    expect(isProfile(invalid)).toBe(isProfileV2(invalid));
    expect(isProfile(null)).toBe(isProfileV2(null));
  });
});

// ============================================================
// isMcpServerConfig type guard
// ============================================================
describe('isMcpServerConfig', () => {
  const validConfig = {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { NODE_ENV: 'test' },
    url: '',
    in_use: true,
  };

  it('should return true for valid stdio config', () => {
    expect(isMcpServerConfig(validConfig)).toBe(true);
  });

  it('should return true for valid sse config', () => {
    expect(isMcpServerConfig({ ...validConfig, transport: 'sse', url: 'http://localhost:3000' })).toBe(true);
  });

  it('should return true for valid StreamableHttp config', () => {
    expect(isMcpServerConfig({ ...validConfig, transport: 'StreamableHttp' })).toBe(true);
  });

  it('should return false when name is missing', () => {
    const { name, ...rest } = validConfig;
    expect(isMcpServerConfig(rest)).toBe(false);
  });

  it('should return false when transport is invalid', () => {
    expect(isMcpServerConfig({ ...validConfig, transport: 'websocket' })).toBe(false);
  });

  it('should return false when args is not an array', () => {
    expect(isMcpServerConfig({ ...validConfig, args: 'invalid' })).toBe(false);
  });

  it('should return false when env is not an object', () => {
    expect(isMcpServerConfig({ ...validConfig, env: 'invalid' })).toBe(false);
  });

  it('should return false when in_use is not boolean', () => {
    expect(isMcpServerConfig({ ...validConfig, in_use: 'yes' })).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isMcpServerConfig(null)).toBeFalsy();
    expect(isMcpServerConfig(undefined)).toBeFalsy();
  });
});

// ============================================================
// getBuiltinAgentNames
// ============================================================
describe('getBuiltinAgentNames', () => {
  it('should return ["Kobi"] for openkosmos brand', () => {
    expect(getBuiltinAgentNames('openkosmos')).toEqual(['Kobi']);
  });

  it('should be case-insensitive for brand name', () => {
    expect(getBuiltinAgentNames('OpenKosmos')).toEqual(['Kobi']);
    expect(getBuiltinAgentNames('OpenKosmos')).toEqual(['Kobi']);
  });

  it('should default to openkosmos when no brand is provided', () => {
    expect(getBuiltinAgentNames()).toEqual(['Kobi']);
    expect(getBuiltinAgentNames(undefined)).toEqual(['Kobi']);
  });

  it('should default to openkosmos for unknown brands', () => {
    expect(getBuiltinAgentNames('unknown-brand')).toEqual(['Kobi']);
  });

  it('should match BUILTIN_AGENT_NAMES_OpenKosmos constant', () => {
    expect(getBuiltinAgentNames('openkosmos')).toEqual(BUILTIN_AGENT_NAMES_OpenKosmos);
  });
});

// ============================================================
// isBuiltinAgent
// ============================================================
describe('isBuiltinAgent', () => {
  it('should return true for "Kobi" in openkosmos brand', () => {
    expect(isBuiltinAgent('Kobi', 'openkosmos')).toBe(true);
  });

  it('should return false for "PM Agent" in openkosmos brand', () => {
    expect(isBuiltinAgent('PM Agent', 'openkosmos')).toBe(false);
  });

  it('should be case-insensitive for agent name', () => {
    expect(isBuiltinAgent('kobi', 'openkosmos')).toBe(true);
    expect(isBuiltinAgent('KOBI', 'openkosmos')).toBe(true);
  });

  it('should return false for custom agent names', () => {
    expect(isBuiltinAgent('My Custom Agent', 'openkosmos')).toBe(false);
  });

  it('should return false for null/undefined agent name', () => {
    expect(isBuiltinAgent(null, 'openkosmos')).toBe(false);
    expect(isBuiltinAgent(undefined, 'openkosmos')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isBuiltinAgent('', 'openkosmos')).toBe(false);
  });

  it('should default to openkosmos when no brand is provided', () => {
    expect(isBuiltinAgent('Kobi')).toBe(true);
    expect(isBuiltinAgent('PM Agent')).toBe(false);
  });
});

// ============================================================
// ChatSessionUtils
// ============================================================
describe('ChatSessionUtils', () => {
  // profile.ts uses a lazy require('../../utilities/idFactory') inside
  // ChatSessionUtils.generateChatSessionId(). Vitest's vi.mock() does not intercept
  // runtime require() calls resolved by Node's native CJS resolver (which cannot
  // resolve .ts extensions). We replace the static method with a spy that
  // produces IDs in the same format as the real implementation.
  let generateSpy: ReturnType<typeof vi.spyOn>;
  let callCount = 0;
  beforeEach(() => {
    callCount = 0;
    generateSpy = vi.spyOn(ChatSessionUtils, 'generateChatSessionId').mockImplementation(() => {
      callCount++;
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      return `chatSession_${ts}_test-device_${Math.random().toString(36).slice(2, 11)}${callCount}`;
    });
  });
  afterEach(() => {
    generateSpy.mockRestore();
  });
  describe('generateChatSessionId', () => {
    it('should return a string starting with "chatSession_"', () => {
      const id = ChatSessionUtils.generateChatSessionId();
      expect(id).toMatch(/^chatSession_\d{14}_[a-z0-9-]+_[a-z0-9]+$/i);
    });

    it('should generate unique IDs even when called back to back', () => {
      const id1 = ChatSessionUtils.generateChatSessionId();
      const id2 = ChatSessionUtils.generateChatSessionId();
      expect(id1).toMatch(/^chatSession_\d{14}_[a-z0-9-]+_[a-z0-9]+$/i);
      expect(id2).toMatch(/^chatSession_\d{14}_[a-z0-9-]+_[a-z0-9]+$/i);
      expect(id1).not.toBe(id2);
    });

    it('should embed current date/time in the ID', () => {
      const now = new Date();
      const id = ChatSessionUtils.generateChatSessionId();
      const year = now.getFullYear().toString();
      // ID should contain the current year
      expect(id).toContain(year);
    });
  });

  describe('createDefaultChatSession', () => {
    it('should create a session with default title', () => {
      const session = ChatSessionUtils.createDefaultChatSession();
      expect(session.title).toBe('New ChatSession');
      expect(session.chatSession_id).toMatch(/^chatSession_\d{14}_[a-z0-9-]+_[a-z0-9]+$/i);
      expect(session.last_updated).toBeTruthy();
    });

    it('should create a session with custom title', () => {
      const session = ChatSessionUtils.createDefaultChatSession('My Session');
      expect(session.title).toBe('My Session');
    });

    it('should have a valid ISO date in last_updated', () => {
      const session = ChatSessionUtils.createDefaultChatSession();
      const date = new Date(session.last_updated);
      expect(date.getTime()).not.toBeNaN();
    });
  });

  describe('isValidChatSession', () => {
    it('should return true for valid chat session', () => {
      const session = {
        chatSession_id: 'chatSession_20250101120000',
        last_updated: '2025-01-01T12:00:00.000Z',
        title: 'Test Session',
      };
      expect(ChatSessionUtils.isValidChatSession(session)).toBe(true);
    });

    it('should return true for session created by createDefaultChatSession', () => {
      const session = ChatSessionUtils.createDefaultChatSession();
      expect(ChatSessionUtils.isValidChatSession(session)).toBe(true);
    });

    it('should return false when chatSession_id does not start with "chatSession_"', () => {
      const session = {
        chatSession_id: 'invalid_20250101120000',
        last_updated: '2025-01-01T12:00:00.000Z',
        title: 'Test',
      };
      expect(ChatSessionUtils.isValidChatSession(session)).toBe(false);
    });

    it('should return false when fields are missing', () => {
      expect(ChatSessionUtils.isValidChatSession({})).toBe(false);
      expect(ChatSessionUtils.isValidChatSession({ chatSession_id: 'chatSession_123' })).toBe(false);
      expect(ChatSessionUtils.isValidChatSession(null)).toBeFalsy();
      expect(ChatSessionUtils.isValidChatSession(undefined)).toBeFalsy();
    });

    it('should return false when fields have wrong types', () => {
      expect(ChatSessionUtils.isValidChatSession({
        chatSession_id: 123,
        last_updated: '2025-01-01',
        title: 'Test',
      })).toBe(false);
    });
  });

  describe('sanitizeChatSessions', () => {
    it('should filter and return only valid sessions', () => {
      const sessions = [
        {
          chatSession_id: 'chatSession_20250101120000',
          last_updated: '2025-01-01T12:00:00.000Z',
          title: 'Valid Session',
        },
        {
          chatSession_id: 'invalid_id',
          last_updated: '2025-01-01',
          title: 'Invalid Session',
        },
        null,
        undefined,
        'string',
      ];
      const result = ChatSessionUtils.sanitizeChatSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Valid Session');
    });

    it('should return empty array for non-array input', () => {
      expect(ChatSessionUtils.sanitizeChatSessions(null as any)).toEqual([]);
      expect(ChatSessionUtils.sanitizeChatSessions(undefined as any)).toEqual([]);
      expect(ChatSessionUtils.sanitizeChatSessions('invalid' as any)).toEqual([]);
    });

    it('should return empty array for array of all invalid sessions', () => {
      const sessions = [{ foo: 'bar' }, null, 42];
      expect(ChatSessionUtils.sanitizeChatSessions(sessions)).toEqual([]);
    });

    it('should set "Untitled ChatSession" for sessions with empty title', () => {
      const sessions = [
        {
          chatSession_id: 'chatSession_20250101120000',
          last_updated: '2025-01-01T12:00:00.000Z',
          title: '',
        },
      ];
      const result = ChatSessionUtils.sanitizeChatSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Untitled ChatSession');
    });

    it('should preserve valid sessions without mutation', () => {
      const original = {
        chatSession_id: 'chatSession_20250101120000',
        last_updated: '2025-01-01T12:00:00.000Z',
        title: 'My Session',
        extraField: 'should be stripped',
      };
      const result = ChatSessionUtils.sanitizeChatSessions([original]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        chatSession_id: 'chatSession_20250101120000',
        last_updated: '2025-01-01T12:00:00.000Z',
        title: 'My Session',
        readStatus: 'unread',
        source: undefined,
      });
      // Should not have extra fields
      expect((result[0] as any).extraField).toBeUndefined();
    });
  });
});

// ============================================================
// Default constants validation
// ============================================================
describe('Default constants', () => {
  it('DEFAULT_CHAT_AGENT should have required fields', () => {
    expect(DEFAULT_CHAT_AGENT.name).toBe('Kobi');
    expect(DEFAULT_CHAT_AGENT.emoji).toBe('\uD83D\uDC2C'); // dolphin emoji
    expect(DEFAULT_CHAT_AGENT.role).toBe('Default Assistant');
    expect(DEFAULT_CHAT_AGENT.model).toBe('claude-sonnet-4.6');
    expect(DEFAULT_CHAT_AGENT.mcp_servers).toEqual([{ name: 'builtin-tools', tools: [] }]);
    expect(DEFAULT_CHAT_AGENT.system_prompt).toBeTruthy();
    expect(typeof DEFAULT_CHAT_AGENT.system_prompt).toBe('string');
  });

  it('DEFAULT_PROFILE_V2 should have correct version', () => {
    expect(DEFAULT_PROFILE_V2.version).toBe('2.0.0');
    expect(DEFAULT_PROFILE_V2.primaryAgent).toBe('Kobi');
    expect(DEFAULT_PROFILE_V2.freDone).toBe(false);
    expect(DEFAULT_PROFILE_V2.mcp_servers).toEqual([]);
    expect(DEFAULT_PROFILE_V2.chats).toEqual([]);
  });

  it('DEFAULT_MCP_SERVER should have correct transport', () => {
    expect(DEFAULT_MCP_SERVER.transport).toBe('stdio');
    expect(DEFAULT_MCP_SERVER.in_use).toBe(true);
    expect(DEFAULT_MCP_SERVER.source).toBe('ON-DEVICE');
  });
});
