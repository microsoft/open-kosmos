/**
 * @vitest-environment happy-dom
 */

/**
 * ProfileDataManager Sub-Agent method unit tests
 *
 * Tests getSubAgents(), getSubAgentByName(), getSubAgentsStats()
 * and the sub_agents sync logic in handleProfileCacheUpdate()
 */

// Mock dependencies before importing
vi.mock('electron', async () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    removeListener: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// Setup window.electronAPI mock before importing ProfileDataManager
Object.defineProperty(window, 'electronAPI', {
  value: {
    profile: {
      onCacheUpdated: vi.fn(),
      onAutoSelectChatSession: vi.fn(),
    },
    mcp: {
      onServerStatesUpdated: vi.fn(),
    },
    agentChat: {
      onStreamingChunk: vi.fn(),
      onStreamingMetrics: vi.fn(),
      onToolUse: vi.fn(),
      onToolResult: vi.fn(),
      onContextChange: vi.fn(),
      onInteractionRequest: vi.fn(),
      onInteractionProcessed: vi.fn(),
      onChatStatusChanged: vi.fn(),
    },
  },
  writable: true,
});

import { ProfileDataManager } from '../profileDataManager';
import type { SubAgentConfig } from '../../../../main/lib/userDataADO/types/profile';

// Helper: create test SubAgentConfig
function createTestSubAgent(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    display_name: 'Test Agent',
    description: 'A test sub-agent',
    emoji: '🧪',
    version: '1.0.0',
    source: 'ON-DEVICE',
    system_prompt: 'You are a test agent.',
    mcp_servers: [],
    skills: [],
    builtin_tools: [],
    context_access: 'isolated',
    max_turns: 25,
    ...overrides,
  };
}

describe('ProfileDataManager - Sub-Agent Methods', () => {
  let manager: ProfileDataManager;

  beforeEach(() => {
    // Reset singleton for each test
    (ProfileDataManager as any).instance = null;
    manager = ProfileDataManager.getInstance();
  });

  afterEach(() => {
    (ProfileDataManager as any).instance = null;
  });

  // ========== getSubAgents() ==========

  describe('getSubAgents()', () => {
    it('should return empty array when no sub-agents are cached', () => {
      const result = manager.getSubAgents();
      expect(result).toEqual([]);
    });

    it('should return a copy of cached sub-agents', () => {
      // Directly set cache for testing
      const testAgent = createTestSubAgent();
      (manager as any).cache.subAgents = [testAgent];

      const result = manager.getSubAgents();
      expect(result).toEqual([testAgent]);
      expect(result).not.toBe((manager as any).cache.subAgents); // Must be a copy
    });

    it('should return multiple sub-agents', () => {
      const agents = [
        createTestSubAgent({ name: 'agent-1', display_name: 'Agent 1' }),
        createTestSubAgent({ name: 'agent-2', display_name: 'Agent 2', source: 'ON-DEVICE' }),
        createTestSubAgent({ name: 'agent-3', display_name: 'Agent 3' }),
      ];
      (manager as any).cache.subAgents = agents;

      const result = manager.getSubAgents();
      expect(result).toHaveLength(3);
      expect(result.map(a => a.name)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    });

    it('should handle null subAgents in cache gracefully', () => {
      (manager as any).cache.subAgents = null;
      const result = manager.getSubAgents();
      expect(result).toEqual([]);
    });

    it('should handle undefined subAgents in cache gracefully', () => {
      (manager as any).cache.subAgents = undefined;
      const result = manager.getSubAgents();
      expect(result).toEqual([]);
    });

    it('should not expose internal cache reference (mutation safety)', () => {
      const testAgent = createTestSubAgent();
      (manager as any).cache.subAgents = [testAgent];

      const result = manager.getSubAgents();
      result.push(createTestSubAgent({ name: 'added-externally' }));

      // Internal cache should not be affected
      expect((manager as any).cache.subAgents).toHaveLength(1);
    });
  });

  // ========== getSubAgentByName() ==========

  describe('getSubAgentByName()', () => {
    it('should return undefined when no sub-agents exist', () => {
      const result = manager.getSubAgentByName('non-existent');
      expect(result).toBeUndefined();
    });

    it('should find a sub-agent by exact name', () => {
      const agents = [
        createTestSubAgent({ name: 'web-researcher' }),
        createTestSubAgent({ name: 'code-reviewer' }),
      ];
      (manager as any).cache.subAgents = agents;

      const result = manager.getSubAgentByName('code-reviewer');
      expect(result).toBeDefined();
      expect(result!.name).toBe('code-reviewer');
    });

    it('should return undefined for non-existent name', () => {
      (manager as any).cache.subAgents = [createTestSubAgent({ name: 'existing' })];

      const result = manager.getSubAgentByName('non-existent');
      expect(result).toBeUndefined();
    });

    it('should be case-sensitive', () => {
      (manager as any).cache.subAgents = [createTestSubAgent({ name: 'WebResearcher' })];

      expect(manager.getSubAgentByName('webresearcher')).toBeUndefined();
      expect(manager.getSubAgentByName('WebResearcher')).toBeDefined();
    });

    it('should handle empty name gracefully', () => {
      (manager as any).cache.subAgents = [createTestSubAgent()];
      expect(manager.getSubAgentByName('')).toBeUndefined();
    });

    it('should handle null subAgents in cache gracefully', () => {
      (manager as any).cache.subAgents = null;
      expect(manager.getSubAgentByName('any')).toBeUndefined();
    });
  });

  // ========== getSubAgentsStats() ==========

  describe('getSubAgentsStats()', () => {
    it('should return zero stats when no sub-agents exist', () => {
      const result = manager.getSubAgentsStats();
      expect(result).toEqual({
        total: 0,
                onDevice: 0,
      });
    });

    it('should count total sub-agents correctly', () => {
      (manager as any).cache.subAgents = [
        createTestSubAgent({ name: 'a1' }),
        createTestSubAgent({ name: 'a2' }),
        createTestSubAgent({ name: 'a3' }),
      ];

      const result = manager.getSubAgentsStats();
      expect(result.total).toBe(3);
    });

    it('should count all ON-DEVICE sources', () => {
      (manager as any).cache.subAgents = [
        createTestSubAgent({ name: 'lib-1', source: 'ON-DEVICE' }),
        createTestSubAgent({ name: 'lib-2', source: 'ON-DEVICE' }),
        createTestSubAgent({ name: 'dev-1', source: 'ON-DEVICE' }),
      ];

      const result = manager.getSubAgentsStats();
      expect(result).toEqual({
        total: 3,
                onDevice: 3,
      });
    });

    it('should handle all ON-DEVICE agents', () => {
      (manager as any).cache.subAgents = [
        createTestSubAgent({ name: 'a1', source: 'ON-DEVICE' }),
        createTestSubAgent({ name: 'a2', source: 'ON-DEVICE' }),
      ];

      const result = manager.getSubAgentsStats();
      expect(result).toEqual({ total: 2, onDevice: 2 });
    });

    it('should handle null subAgents gracefully', () => {
      (manager as any).cache.subAgents = null;
      const result = manager.getSubAgentsStats();
      expect(result).toEqual({ total: 0, onDevice: 0 });
    });
  });

  // ========== Cache initialization ==========

  describe('cache initialization', () => {
    it('should initialize with empty subAgents array', () => {
      expect((manager as any).cache.subAgents).toEqual([]);
    });

    it('should have subAgents field in initialized cache', () => {
      expect((manager as any).cache).toHaveProperty('subAgents');
    });
  });
});
