/**
 * SubAgentConfigResolver unit tests
 *
 * Tests the pure helper functions extracted from SubAgentManager:
 * - resolveSubAgentModel
 * - getParentAgentConfig
 * - deriveDeliverablesPath
 * - sanitizeSubAgentResult
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockGetModelById = vi.fn();
vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: (...args: any[]) => mockGetModelById(...args),
}));

vi.mock('@shared/constants/subAgent', async () => ({
  INHERIT_MODEL_VALUE: 'inherit',
}));

const mockGetAllChatConfigs = vi.fn();
vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getAllChatConfigs: (...args: any[]) => mockGetAllChatConfigs(...args),
  },
}));

vi.mock('../../userDataADO/pathUtils', async () => ({
  extractMonthFromChatSessionId: vi.fn((id: string) => {
    const match = id.match(/chatSession_(\d{6})/);
    return match ? match[1] : undefined;
  }),
}));

// ─── Imports ───

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveSubAgentModel,
  getParentAgentConfig,
  deriveDeliverablesPath,
  sanitizeSubAgentResult,
} from '../subAgentConfigResolver';
import { setAccessorAgentResolver } from '../../userDataADO/agentAccessor';
import type { SubAgentConfig } from '../../userDataADO/types/profile';

// ─── Helpers ───

function makeConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    description: 'A test sub-agent',
    system_prompt: 'You are a test sub-agent.',
    model: '',
    mcp_servers: [],
    builtin_tools: [],
    ...overrides,
  };
}

// ─── Tests ───

describe('SubAgentConfigResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── resolveSubAgentModel ───

  describe('resolveSubAgentModel', () => {
    it('returns parent model when config model is empty', () => {
      const result = resolveSubAgentModel(makeConfig({ model: '' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('returns parent model when config model is "inherit"', () => {
      const result = resolveSubAgentModel(makeConfig({ model: 'inherit' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('returns parent model when config model is "INHERIT" (case insensitive)', () => {
      const result = resolveSubAgentModel(makeConfig({ model: 'INHERIT' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('returns configured model when it exists in registry', () => {
      mockGetModelById.mockReturnValue({ id: 'gpt-4o' });
      const result = resolveSubAgentModel(makeConfig({ model: 'gpt-4o' }), 'parent-model', 'agent-1');
      expect(result).toBe('gpt-4o');
    });

    it('falls back to parent model when configured model is unknown', () => {
      mockGetModelById.mockReturnValue(undefined);
      const result = resolveSubAgentModel(makeConfig({ model: 'nonexistent-model' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('trims whitespace from model string', () => {
      mockGetModelById.mockReturnValue({ id: 'gpt-4o' });
      const result = resolveSubAgentModel(makeConfig({ model: '  gpt-4o  ' }), 'parent-model', 'agent-1');
      expect(result).toBe('gpt-4o');
    });
  });

  // ─── getParentAgentConfig ───

  describe('getParentAgentConfig', () => {
    it('returns agent config when chat is found', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { mcp_servers: [{ name: 's1' }], skills: ['sk1'] } },
      ]);
      const result = getParentAgentConfig('chat-1', 'alice');
      expect(result).toBeDefined();
      expect(result!.mcp_servers).toHaveLength(1);
    });

    it('returns undefined when chat not found', () => {
      mockGetAllChatConfigs.mockReturnValue([]);
      const result = getParentAgentConfig('chat-x', 'alice');
      expect(result).toBeUndefined();
    });

    it('returns undefined when getAllChatConfigs throws', () => {
      mockGetAllChatConfigs.mockImplementation(() => { throw new Error('DB error'); });
      const result = getParentAgentConfig('chat-1', 'alice');
      expect(result).toBeUndefined();
    });

    it('resolves a separated (agent_ids-only) parent chat via the store resolver', () => {
      // Post-separation getAllChatConfigs returns agent_ids-only cache chats with
      // no inline `.agent`. Reading `.agent` directly would yield undefined and the
      // sub-agent would stop inheriting the parent's MCP tools; getChatPrimaryAgent
      // resolves the id through the accessor resolver instead.
      setAccessorAgentResolver((ids: string[]) =>
        ids.map((id) => ({ name: id, model: 'm', source: 'ON-DEVICE', mcp_servers: [{ name: 'inherited-server', tools: [] }] })) as never
      );
      try {
        mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'chat-1', agent_ids: ['agent-x'] }]);
        const result = getParentAgentConfig('chat-1', 'alice');
        expect(result).toBeDefined();
        expect(result!.mcp_servers).toEqual([{ name: 'inherited-server', tools: [] }]);
      } finally {
        setAccessorAgentResolver(null);
      }
    });
  });

  // ─── deriveDeliverablesPath ───

  describe('deriveDeliverablesPath', () => {
    it('derives path with year-month when session ID matches pattern', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: '/workspace/proj' } },
      ]);

      const result = deriveDeliverablesPath(
        'chatSession_20260301120000', 'chat-1', 'alice', 'research-agent', 'sa_1234567890_abc'
      );
      expect(result).toContain('/workspace/proj');
      expect(result).toContain('202603');
      expect(result).toContain('research-agent');
    });

    it('returns path without year-month for non-standard session ID', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: '/workspace/proj' } },
      ]);

      const result = deriveDeliverablesPath(
        'random_session', 'chat-1', 'alice', 'agent-x', 'sa_task123'
      );
      expect(result).toBe('/workspace/proj/agent-x-sa_task123');
    });

    it('returns undefined when workspace is empty', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: '' } },
      ]);

      const result = deriveDeliverablesPath(
        'chatSession_20260301120000', 'chat-1', 'alice', 'agent', 'task'
      );
      expect(result).toBeUndefined();
    });

    it('returns undefined when chat not found', () => {
      mockGetAllChatConfigs.mockReturnValue([]);

      const result = deriveDeliverablesPath(
        'chatSession_20260301120000', 'chat-x', 'alice', 'agent', 'task'
      );
      expect(result).toBeUndefined();
    });

    it('uses a backslash separator for Windows-style workspace paths', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: 'C:\\workspace\\proj' } },
      ]);

      const result = deriveDeliverablesPath(
        'chatSession_20260301120000', 'chat-1', 'alice', 'research-agent', 'sa_1234567890_abc'
      );
      expect(result).toBe('C:\\workspace\\proj\\202603\\chatSession_20260301120000\\research-agent-sa_123456789');
    });

    it('uses a backslash separator without year-month for non-standard session IDs', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: 'C:\\workspace\\proj' } },
      ]);

      const result = deriveDeliverablesPath(
        'random_session', 'chat-1', 'alice', 'agent-x', 'sa_task123'
      );
      expect(result).toBe('C:\\workspace\\proj\\agent-x-sa_task123');
    });
  });

  // ─── sanitizeSubAgentResult ───

  describe('sanitizeSubAgentResult', () => {
    it('wraps result with sub_agent_result tags', () => {
      const result = sanitizeSubAgentResult('Hello world');
      expect(result).toBe('<sub_agent_result>\nHello world\n</sub_agent_result>');
    });

    it('preserves full content without truncation', () => {
      const long = 'X'.repeat(50000);
      const result = sanitizeSubAgentResult(long);
      expect(result).toContain(long);
    });

    it('handles empty string', () => {
      const result = sanitizeSubAgentResult('');
      expect(result).toBe('<sub_agent_result>\n\n</sub_agent_result>');
    });
  });
});
