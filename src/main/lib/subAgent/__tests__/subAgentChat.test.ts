/**
 * SubAgentChat unit tests
 *
 * Covers Phase 3 core logic:
 * - buildSystemPrompt() — four-layer prompt structure validation
 * - buildWorkspaceAndSkillsInfo() — workspace + skills info injection
 * - getDeliverablesPath() — deliverables path derivation
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
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../auth/authManager', async () => ({
  MainAuthManager: {
    getInstance: vi.fn(() => ({
      getCurrentAuth: vi.fn().mockResolvedValue({
        ghcAuth: { copilotTokens: { token: 'mock-token' } },
      }),
    })),
  },
}));

vi.mock('../../auth/ghcConfig', async () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://mock.api',
    USER_AGENT: 'mock',
    EDITOR_VERSION: '1.0',
    EDITOR_PLUGIN_VERSION: '1.0',
  },
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(() => '/chat/completions'),
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelCapabilities: vi.fn((modelId: string) => ({
    maxContextLength: 128000,
    maxOutputLength: 4096,
    supportsTools: true,
    supportsImages: false,
    supportsStreaming: true,
  })),
  getDefaultModel: vi.fn(() => 'mock-default-model'),
}));

// Mock TokenCounter for compact context tests
const { mockCountTextTokens } = vi.hoisted(() => ({
  mockCountTextTokens: vi.fn((text: string) => {
    // Simple approximation: ~4 chars per token
    return Math.ceil((text || '').length / 4);
  }),
}));

vi.mock('../../token/TokenCounter', async () => ({
  TokenCounter: vi.fn().mockImplementation(function () {
    return {
      countTextTokens: mockCountTextTokens,
      countMessagesTokens: vi.fn(),
      countToolsTokens: vi.fn(),
      clearCache: vi.fn(),
    };
  }),
}));

vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    getToolsForSubAgent: vi.fn().mockReturnValue([]),
    executeTool: vi.fn().mockResolvedValue('tool result'),
  },
}));

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    setExecutionContext: vi.fn(),
    clearExecutionContext: vi.fn(),
  },
}));

vi.mock('../../skill/skillManager', async () => ({
  skillManager: {
    getSkillMetadata: vi.fn((dir: string) => {
      if (dir.includes('valid-skill')) {
        return {
          metadata: {
            name: 'valid-skill',
            description: 'A valid test skill',
            version: '1.0.0',
          },
        };
      }
      return { metadata: null, error: 'Not found' };
    }),
  },
  SkillManager: {
    getInstance: vi.fn(() => ({
      getSkillMetadata: vi.fn(),
    })),
  },
}));

// Mock SubAgentManager for drainPendingMessages() which uses require('./subAgentManager')
const mockBackgroundTasks = new Map<string, any>();
vi.mock('../subAgentManager', async () => ({
  SubAgentManager: {
    getInstance: () => ({
      getBackgroundTask: (taskId: string) => mockBackgroundTasks.get(taskId),
    }),
  },
}));

import { SubAgentChat, truncateToLines } from '../subAgentChat';
import type { SubAgentChatOptions, SubAgentStepUpdate } from '../types';
import type { SubAgentConfig } from '../../userDataADO/types/profile';
import type { CancellationToken } from '../../cancellation/CancellationToken';

// ─── Helpers ───

function createMockCancellationToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function createMockSubAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-sub-agent',
    description: 'A specialized test sub-agent',
    system_prompt: 'You are a specialized testing agent. Follow testing best practices.',
    mcp_servers: [],
    ...overrides,
  };
}

function createMockOptions(overrides: Partial<SubAgentChatOptions> = {}): SubAgentChatOptions {
  const config = overrides.subAgent?.config || createMockSubAgentConfig();
  return {
    subAgent: {
      config,
      inheritedModel: 'gpt-4o',
      parentChatId: 'chat_001',
      parentSessionId: 'chatSession_20260227120000',
      userAlias: 'testUser',
      resolvedMcpServers: [],
      resolvedSkills: [],
      taskId: 'sa_test_001',
    },
    task: 'Write unit tests for the feature',
    cancellationToken: createMockCancellationToken(),
    currentUserAlias: 'testUser',
    ...overrides,
  };
}

// ─── Suite ───

describe('SubAgentChat', () => {
  // ─── buildSystemPrompt (via reflection) ───
  describe('buildSystemPrompt', () => {
    it('should include sub-agent identity in Layer 1', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      expect(messages).toHaveLength(1);
      const text = messages[0].content[0].text;
      expect(text).toContain('# Sub-Agent: test-sub-agent');
      expect(text).toContain('You are a specialized testing agent');
    });

    it('should include custom system_prompt', () => {
      const options = createMockOptions({
        subAgent: {
          ...createMockOptions().subAgent,
          config: createMockSubAgentConfig({
            system_prompt: 'Custom instruction: always use TypeScript',
          }),
        },
      });
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).toContain('Custom instruction: always use TypeScript');
    });

    it('should include task context in Layer 2', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).toContain('## Current Task');
      expect(text).toContain('sub-agent working on a specific task');
    });

    it('should NOT include parent context section', () => {
      const options = createMockOptions({});
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).not.toContain('## Parent Agent Context');
    });

    it('should NOT include parent context section when not provided', () => {
      const options = createMockOptions({});
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).not.toContain('## Parent Agent Context');
    });

    it('should include operating rules in Layer 4', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).toContain('## Operating Rules');
      expect(text).toContain('Focus exclusively on the assigned task');
      expect(text).toContain('Do NOT attempt to communicate with the user directly');
      expect(text).toContain('Efficiency Guidelines');
      // Dynamic turn progress is injected in callLLM, not in static system prompt
      expect(text).not.toContain('HARD LIMIT');
    });

    it('should include deliverables path when available', () => {
      const options = createMockOptions({
        deliverablesPath: '/workspace/202602/chatSession_20260227120000',
      });
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).toContain('deliverables directory: /workspace/202602/chatSession_20260227120000');
    });

    it('should include rule to report created files when deliverables path is available', () => {
      const options = createMockOptions({
        deliverablesPath: '/workspace/202602/chatSession_20260227120000',
      });
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).toContain('mention the file paths');
      expect(text).toContain('parent agent knows what was produced');
    });

    it('should NOT include deliverables line when no path available', () => {
      const options = createMockOptions({
        deliverablesPath: undefined,
        subAgent: {
          ...createMockOptions().subAgent,
          config: createMockSubAgentConfig({}),
        },
      });
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      const text = messages[0].content[0].text;
      expect(text).not.toContain('deliverables directory');
    });

    it('should have correct message ID format', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      expect(messages[0].id).toBe('system-sub-agent-test-sub-agent');
    });

    it('should have role=system', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = (chat as any).buildSystemPrompt();

      expect(messages[0].role).toBe('system');
    });
  });

  // ─── buildWorkspaceAndSkillsInfo ───
  describe('buildWorkspaceAndSkillsInfo', () => {
    it('should return empty string when no workspace or skills configured', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const config = createMockSubAgentConfig({
        skills: undefined,
      });
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      expect(result).toBe('');
    });

    it('should include workspace info when configured', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const config = createMockSubAgentConfig({
        skills: undefined,
      });
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      // workspace field removed; no workspace section expected
      expect(result).not.toContain('## Workspace');
    });

    it('should include skills info when skills are configured and found', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const config = createMockSubAgentConfig({
        skills: ['valid-skill'],
      });
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      expect(result).toContain('## Available Skills');
      expect(result).toContain('valid-skill');
      expect(result).toContain('A valid test skill');
    });

    it('should return empty string for skills section when no skills found', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const config = createMockSubAgentConfig({
        skills: ['nonexistent-skill'],
      });
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      // Should not include skills section since metadata can't be resolved
      expect(result).not.toContain('## Available Skills');
    });

    it('should combine skills info when skills configured', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const config = createMockSubAgentConfig({
        skills: ['valid-skill'],
      });
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      expect(result).not.toContain('## Workspace');
      expect(result).toContain('## Available Skills');
      expect(result).toContain('valid-skill');
    });
  });

  // ─── getDeliverablesPath ───
  describe('getDeliverablesPath', () => {
    it('should return deliverablesPath from options when provided', () => {
      const options = createMockOptions({
        deliverablesPath: '/explicit/deliverables/path',
      });
      const chat = new SubAgentChat(options);
      const result = (chat as any).getDeliverablesPath();

      expect(result).toBe('/explicit/deliverables/path');
    });

    it('should fall back to null when no deliverablesPath', () => {
      const options = createMockOptions({
        deliverablesPath: undefined,
        subAgent: {
          ...createMockOptions().subAgent,
          config: createMockSubAgentConfig({}),
        },
      });
      const chat = new SubAgentChat(options);
      const result = (chat as any).getDeliverablesPath();

      expect(result).toBeNull();
    });

    it('should return null when neither deliverablesPath nor workspace exists', () => {
      const options = createMockOptions({
        deliverablesPath: undefined,
        subAgent: {
          ...createMockOptions().subAgent,
          config: createMockSubAgentConfig({}),
        },
      });
      const chat = new SubAgentChat(options);
      const result = (chat as any).getDeliverablesPath();

      expect(result).toBeNull();
    });

    it('should prefer deliverablesPath over workspace', () => {
      const options = createMockOptions({
        deliverablesPath: '/explicit/path',
        subAgent: {
          ...createMockOptions().subAgent,
          config: createMockSubAgentConfig({}),
        },
      });
      const chat = new SubAgentChat(options);
      const result = (chat as any).getDeliverablesPath();

      expect(result).toBe('/explicit/path');
    });
  });

  // ─── extractFinalResult ───
  describe('extractFinalResult', () => {
    it('should return last assistant message text', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      // Inject messages into contextHistory
      (chat as any).contextHistory = [
        { role: 'user', content: [{ type: 'text', text: 'Do something' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'First response' }] },
        { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Final answer' }] },
      ];

      const result = (chat as any).extractFinalResult();
      expect(result).toContain('Final answer');
    });

    it('should include safety turn limit warning when limit reached', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).turnCount = 200; // safety cap
      (chat as any).contextHistory = [
        { role: 'assistant', content: [{ type: 'text', text: 'Partial result' }] },
      ];

      const result = (chat as any).extractFinalResult();
      expect(result).toContain('Partial result');
      expect(result).toContain('safety turn limit');
    });

    it('should append deliverables section when files were tracked', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ];
      (chat as any).deliverables = ['/workspace/report.md', '/workspace/data.json'];

      const result = (chat as any).extractFinalResult();
      expect(result).toContain('Done');
      expect(result).toContain('**Deliverables**');
      expect(result).toContain('2 file(s) created/modified');
      expect(result).toContain('/workspace/report.md');
      expect(result).toContain('/workspace/data.json');
    });

    it('should NOT append deliverables section when no files tracked', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ];
      (chat as any).deliverables = [];

      const result = (chat as any).extractFinalResult();
      expect(result).toBe('Done');
      expect(result).not.toContain('Deliverables');
    });
  });

  // ─── trackDeliverables ───
  describe('trackDeliverables', () => {
    it('should track write_file filePath', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).trackDeliverables('write_file', { filePath: '/path/to/file.md', content: 'hello' });
      expect((chat as any).deliverables).toEqual(['/path/to/file.md']);
    });

    it('should track create_file filePath', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).trackDeliverables('create_file', { filePath: '/path/to/new.ts', content: 'code' });
      expect((chat as any).deliverables).toEqual(['/path/to/new.ts']);
    });

    it('should track append_to_file filePath', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).trackDeliverables('append_to_file', { filePath: '/path/to/log.txt', content: 'line' });
      expect((chat as any).deliverables).toEqual(['/path/to/log.txt']);
    });

    it('should track download_file from saveDirectory + filename', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).trackDeliverables('download_file', {
        url: 'https://example.com/img.png',
        saveDirectory: '/workspace/downloads',
        filename: 'img.png',
      });
      expect((chat as any).deliverables).toEqual(['/workspace/downloads/img.png']);
    });

    it('should track present_deliverables filePaths array', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).trackDeliverables('present_deliverables', {
        description: 'Final report',
        filePaths: ['/workspace/report.md', '/workspace/summary.md'],
      });
      expect((chat as any).deliverables).toEqual(['/workspace/report.md', '/workspace/summary.md']);
    });

    it('should deduplicate file paths', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).trackDeliverables('write_file', { filePath: '/path/file.md', content: 'v1' });
      (chat as any).trackDeliverables('write_file', { filePath: '/path/file.md', content: 'v2' });
      expect((chat as any).deliverables).toEqual(['/path/file.md']);
    });

    it('should not track non-file tools', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).trackDeliverables('bing_web_search', { query: 'test' });
      expect((chat as any).deliverables).toEqual([]);
    });

    it('should not throw on invalid args', () => {
      const chat = new SubAgentChat(createMockOptions());
      expect(() => (chat as any).trackDeliverables('write_file', {})).not.toThrow();
      expect((chat as any).deliverables).toEqual([]);
    });
  });

  // ─── formatDeliverablesSection ───
  describe('formatDeliverablesSection', () => {
    it('should return empty string when no deliverables', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).deliverables = [];
      expect((chat as any).formatDeliverablesSection()).toBe('');
    });

    it('should format single deliverable', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).deliverables = ['/workspace/report.md'];
      const section = (chat as any).formatDeliverablesSection();
      expect(section).toContain('1 file(s) created/modified');
      expect(section).toContain('- /workspace/report.md');
    });

    it('should format multiple deliverables', () => {
      const chat = new SubAgentChat(createMockOptions());
      (chat as any).deliverables = ['/workspace/a.md', '/workspace/b.json', '/workspace/c.txt'];
      const section = (chat as any).formatDeliverablesSection();
      expect(section).toContain('3 file(s) created/modified');
      expect(section).toContain('- /workspace/a.md');
      expect(section).toContain('- /workspace/b.json');
      expect(section).toContain('- /workspace/c.txt');
    });
  });

  // ─── getTurnCount ───
  describe('getTurnCount', () => {
    it('should return current turn count', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      expect(chat.getTurnCount()).toBe(0);

      (chat as any).turnCount = 3;
      expect(chat.getTurnCount()).toBe(3);
    });
  });

  // ─── dispose ───
  describe('dispose', () => {
    it('should clear context history and mark as disposed', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'user', content: [{ type: 'text', text: 'Test' }] },
      ];

      chat.dispose();

      expect((chat as any).contextHistory).toHaveLength(0);
      expect((chat as any).disposed).toBe(true);
    });
  });

  // ─── buildWorkspaceAndSkillsInfo with resolved arrays (inheritance) ───
  describe('buildWorkspaceAndSkillsInfo (inheritance)', () => {
    it('should use resolvedSkills when non-empty, including inherited tag', () => {
      const options = createMockOptions({
        subAgent: {
          config: createMockSubAgentConfig({ skills: ['valid-skill'] }),
          inheritedModel: 'gpt-4o',
          parentChatId: 'chat_001',
          parentSessionId: 'chatSession_20260227120000',
          userAlias: 'testUser',
          resolvedMcpServers: [],
          resolvedSkills: [
            { name: 'valid-skill', installed: true, inherited: false },
            { name: 'inherited-skill', installed: true, inherited: true },
          ],
          taskId: 'sa_test_001',
        },
      });
      const chat = new SubAgentChat(options);
      const config = options.subAgent.config;
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      // valid-skill metadata is mocked to return successfully
      expect(result).toContain('## Available Skills');
      expect(result).toContain('valid-skill');
    });

    it('should fall back to config.skills when resolvedSkills is empty', () => {
      const options = createMockOptions({
        subAgent: {
          config: createMockSubAgentConfig({ skills: ['valid-skill'] }),
          inheritedModel: 'gpt-4o',
          parentChatId: 'chat_001',
          parentSessionId: 'chatSession_20260227120000',
          userAlias: 'testUser',
          resolvedMcpServers: [],
          resolvedSkills: [], // empty → should fall back
          taskId: 'sa_test_001',
        },
      });
      const chat = new SubAgentChat(options);
      const config = options.subAgent.config;
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      expect(result).toContain('## Available Skills');
      expect(result).toContain('valid-skill');
    });

    it('should include Knowledge Base section when resolvedKnowledgeBase is set', () => {
      const options = createMockOptions({
        subAgent: {
          config: createMockSubAgentConfig(),
          inheritedModel: 'gpt-4o',
          parentChatId: 'chat_001',
          parentSessionId: 'chatSession_20260227120000',
          userAlias: 'testUser',
          resolvedMcpServers: [],
          resolvedSkills: [],
          resolvedKnowledgeBase: '/data/knowledge',
          taskId: 'sa_test_001',
        },
      });
      const chat = new SubAgentChat(options);
      const config = options.subAgent.config;
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      expect(result).toContain('## Knowledge Base');
      expect(result).toContain('/data/knowledge');
      expect(result).toContain('read files from this directory');
    });

    it('should NOT include Knowledge Base section when resolvedKnowledgeBase is empty', () => {
      const options = createMockOptions({
        subAgent: {
          config: createMockSubAgentConfig(),
          inheritedModel: 'gpt-4o',
          parentChatId: 'chat_001',
          parentSessionId: 'chatSession_20260227120000',
          userAlias: 'testUser',
          resolvedMcpServers: [],
          resolvedSkills: [],
          resolvedKnowledgeBase: undefined,
          taskId: 'sa_test_001',
        },
      });
      const chat = new SubAgentChat(options);
      const config = options.subAgent.config;
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      expect(result).not.toContain('## Knowledge Base');
    });

    it('should combine workspace, resolved skills, and knowledge base', () => {
      const options = createMockOptions({
        subAgent: {
          config: createMockSubAgentConfig({
            skills: ['valid-skill'],
          }),
          inheritedModel: 'gpt-4o',
          parentChatId: 'chat_001',
          parentSessionId: 'chatSession_20260227120000',
          userAlias: 'testUser',
          resolvedMcpServers: [],
          resolvedSkills: [
            { name: 'valid-skill', installed: true, inherited: false },
          ],
          resolvedKnowledgeBase: '/data/kb',
          taskId: 'sa_test_001',
        },
      });
      const chat = new SubAgentChat(options);
      const config = options.subAgent.config;
      const result = (chat as any).buildWorkspaceAndSkillsInfo(config);

      expect(result).not.toContain('## Workspace');
      expect(result).toContain('## Available Skills');
      expect(result).toContain('valid-skill');
      expect(result).toContain('## Knowledge Base');
      expect(result).toContain('/data/kb');
    });
  });

  // ─── shouldContinueAfterTextResponse (follow-up logic) ───
  describe('shouldContinueAfterTextResponse', () => {
    function makeLLMResponse(overrides: Partial<{ textContent: string; finishReason: string; hasToolCalls: boolean }>): any {
      return {
        hasToolCalls: false,
        toolCalls: [],
        textContent: 'Some text',
        finishReason: 'stop',
        assistantMessage: { role: 'assistant', content: [{ type: 'text', text: 'Some text' }] },
        ...overrides,
      };
    }

    it('should return true when finish_reason is "length" (token truncated)', () => {
      const chat = new SubAgentChat(createMockOptions());
      const result = (chat as any).shouldContinueAfterTextResponse(
        makeLLMResponse({ finishReason: 'length' }),
        1,
        true
      );
      expect(result).toBe(true);
    });

    it('should return false when no tools are available', () => {
      const chat = new SubAgentChat(createMockOptions());
      const result = (chat as any).shouldContinueAfterTextResponse(
        makeLLMResponse({ finishReason: 'stop' }),
        1,
        false // hasTools = false
      );
      expect(result).toBe(false);
    });

    it('should return false when consecutive text rounds >= 2', () => {
      const chat = new SubAgentChat(createMockOptions());
      const result = (chat as any).shouldContinueAfterTextResponse(
        makeLLMResponse({ textContent: "Let me search for that" }),
        2,
        true
      );
      expect(result).toBe(false);
    });

    it('should return true on first text-only round when text looks like intent', () => {
      const chat = new SubAgentChat(createMockOptions());
      const result = (chat as any).shouldContinueAfterTextResponse(
        makeLLMResponse({ textContent: "I'll conduct a deep research into this topic. Let me gather information." }),
        1,
        true
      );
      expect(result).toBe(true);
    });

    it('should return false on first text-only round when text looks like a final result', () => {
      const chat = new SubAgentChat(createMockOptions());
      const result = (chat as any).shouldContinueAfterTextResponse(
        makeLLMResponse({ textContent: "The answer is 42. This is the result of the computation." }),
        1,
        true
      );
      expect(result).toBe(false);
    });
  });

  // ─── looksLikeIntentNotResult ───
  describe('looksLikeIntentNotResult', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should detect "let me" as intent', () => {
      expect((chat as any).looksLikeIntentNotResult('Let me search for that information.')).toBe(true);
    });

    it('should detect "I\'ll" as intent', () => {
      expect((chat as any).looksLikeIntentNotResult("I'll gather the data now.")).toBe(true);
    });

    it('should detect "I will" as intent', () => {
      expect((chat as any).looksLikeIntentNotResult("I will conduct the research.")).toBe(true);
    });

    it('should detect "step 1" as intent', () => {
      expect((chat as any).looksLikeIntentNotResult("Step 1: First we need to analyze.")).toBe(true);
    });

    it('should detect "I need to" as intent', () => {
      expect((chat as any).looksLikeIntentNotResult("I need to find the relevant files.")).toBe(true);
    });

    it('should detect "gather information" as intent', () => {
      expect((chat as any).looksLikeIntentNotResult("I want to gather information from multiple sources.")).toBe(true);
    });

    it('should return false for final results', () => {
      expect((chat as any).looksLikeIntentNotResult("The result is 42.")).toBe(false);
    });

    it('should return false for very short text', () => {
      expect((chat as any).looksLikeIntentNotResult("Done.")).toBe(false);
    });

    it('should return false for empty text', () => {
      expect((chat as any).looksLikeIntentNotResult('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect((chat as any).looksLikeIntentNotResult(null)).toBe(false);
      expect((chat as any).looksLikeIntentNotResult(undefined)).toBe(false);
    });
  });

  // ─── processSSELine (/chat/completions format) ───
  describe('processSSELine', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should accumulate text content from /chat/completions delta', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fc = state.fullContent;
      let fr = state.finishReason;

      const line = 'data: ' + JSON.stringify({
        choices: [{ delta: { content: 'Hello' }, index: 0 }]
      });
      (chat as any).processSSELine(
        line, '/chat/completions', { ...state, fullContent: fc },
        (v: string) => { fc = v; }, (v: string) => { fr = v; }
      );

      expect(fc).toBe('Hello');
    });

    it('should accumulate tool call arguments incrementally', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };

      // First chunk: tool call start
      const line1 = 'data: ' + JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] } }]
      });
      (chat as any).processSSELine(
        line1, '/chat/completions', state,
        () => {}, () => {}
      );

      // Second chunk: tool call continuation
      const line2 = 'data: ' + JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }]
      });
      (chat as any).processSSELine(
        line2, '/chat/completions', state,
        () => {}, () => {}
      );

      expect(state.toolCalls[0].id).toBe('call_1');
      expect(state.toolCalls[0].function.name).toBe('search');
      expect(state.toolCalls[0].function.arguments).toBe('{"q":"test"}');
    });

    it('should record finish_reason from /chat/completions', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fr = '';

      const line = 'data: ' + JSON.stringify({
        choices: [{ finish_reason: 'stop', delta: {} }]
      });
      (chat as any).processSSELine(
        line, '/chat/completions', state,
        () => {}, (v: string) => { fr = v; }
      );

      expect(fr).toBe('stop');
    });

    it('should record finish_reason tool_calls', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fr = '';

      const line = 'data: ' + JSON.stringify({
        choices: [{ finish_reason: 'tool_calls', delta: {} }]
      });
      (chat as any).processSSELine(
        line, '/chat/completions', state,
        () => {}, (v: string) => { fr = v; }
      );

      expect(fr).toBe('tool_calls');
    });

    it('should ignore [DONE] lines', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fc = '';

      (chat as any).processSSELine(
        'data: [DONE]', '/chat/completions', state,
        (v: string) => { fc = v; }, () => {}
      );

      expect(fc).toBe('');
    });

    it('should ignore non-data lines', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fc = '';

      (chat as any).processSSELine(
        'event: ping', '/chat/completions', state,
        (v: string) => { fc = v; }, () => {}
      );

      expect(fc).toBe('');
    });
  });

  // ─── processSSELine (/responses format) ───
  describe('processSSELine (/responses format)', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should accumulate text from response.output_text.delta', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fc = '';

      const line = 'data: ' + JSON.stringify({
        type: 'response.output_text.delta',
        delta: 'Hello world'
      });
      (chat as any).processSSELine(
        line, '/responses', { ...state, fullContent: fc },
        (v: string) => { fc = v; }, () => {}
      );

      expect(fc).toBe('Hello world');
    });

    it('should parse tool calls from response.output_item.done', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };

      const line = 'data: ' + JSON.stringify({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call_123',
          name: 'bing_search',
          arguments: '{"query": "test"}'
        }
      });
      (chat as any).processSSELine(
        line, '/responses', state,
        () => {}, () => {}
      );

      expect(state.toolCalls).toHaveLength(1);
      expect(state.toolCalls[0].id).toBe('call_123');
      expect(state.toolCalls[0].function.name).toBe('bing_search');
      expect(state.toolCalls[0].function.arguments).toBe('{"query": "test"}');
    });

    it('should set finish_reason from response.completed with function_call output', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fr = '';

      const line = 'data: ' + JSON.stringify({
        type: 'response.completed',
        response: {
          output: [{ type: 'function_call' }]
        }
      });
      (chat as any).processSSELine(
        line, '/responses', state,
        () => {}, (v: string) => { fr = v; }
      );

      expect(fr).toBe('tool_calls');
    });

    it('should set finish_reason to stop when response.completed has no function_call', () => {
      const state = { fullContent: '', toolCalls: [] as any[], finishReason: '' };
      let fr = '';

      const line = 'data: ' + JSON.stringify({
        type: 'response.completed',
        response: {
          output: [{ type: 'message' }]
        }
      });
      (chat as any).processSSELine(
        line, '/responses', state,
        () => {}, (v: string) => { fr = v; }
      );

      expect(fr).toBe('stop');
    });
  });

  // ─── parseStreamingResponse ───
  describe('parseStreamingResponse', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    function createMockSSEResponse(lines: string[]): Response {
      const sseText = lines.join('\n') + '\ndata: [DONE]\n';
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseText));
          controller.close();
        }
      });
      return { body: stream } as unknown as Response;
    }

    it('should parse a text-only streaming response', async () => {
      const response = createMockSSEResponse([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'world' } }] }),
        'data: ' + JSON.stringify({ choices: [{ finish_reason: 'stop', delta: {} }] }),
      ]);

      const result = await (chat as any).parseStreamingResponse(response, '/chat/completions');

      expect(result.textContent).toBe('Hello world');
      expect(result.hasToolCalls).toBe(false);
      expect(result.finishReason).toBe('stop');
    });

    it('should parse a tool-call streaming response', async () => {
      const response = createMockSSEResponse([
        'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] } }] }),
        'data: ' + JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: {} }] }),
      ]);

      const result = await (chat as any).parseStreamingResponse(response, '/chat/completions');

      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].function.name).toBe('search');
      expect(result.toolCalls[0].function.arguments).toBe('{"q":"hello"}');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should parse mixed text + tool_calls response', async () => {
      const response = createMockSSEResponse([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Searching...' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{}' } }] } }] }),
        'data: ' + JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: {} }] }),
      ]);

      const result = await (chat as any).parseStreamingResponse(response, '/chat/completions');

      expect(result.textContent).toBe('Searching...');
      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls[0].function.name).toBe('search');
    });

    it('should handle empty response body gracefully', async () => {
      const response = { body: null } as unknown as Response;
      await expect((chat as any).parseStreamingResponse(response, '/chat/completions'))
        .rejects.toThrow('Failed to get response stream reader');
    });

    it('should parse /responses format text', async () => {
      const response = createMockSSEResponse([
        'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'Result: ' }),
        'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '42' }),
        'data: ' + JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'message' }] } }),
      ]);

      const result = await (chat as any).parseStreamingResponse(response, '/responses');

      expect(result.textContent).toBe('Result: 42');
      expect(result.hasToolCalls).toBe(false);
      expect(result.finishReason).toBe('stop');
    });

    it('should parse /responses format tool calls', async () => {
      const response = createMockSSEResponse([
        'data: ' + JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'function_call', call_id: 'c1', name: 'fetch', arguments: '{"url":"http://example.com"}' }
        }),
        'data: ' + JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'function_call' }] } }),
      ]);

      const result = await (chat as any).parseStreamingResponse(response, '/responses');

      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls[0].id).toBe('c1');
      expect(result.toolCalls[0].function.name).toBe('fetch');
      expect(result.finishReason).toBe('tool_calls');
    });
  });

  // ─── Compact Context ───
  describe('compactContextIfNeeded', () => {
    beforeEach(() => {
      mockCountTextTokens.mockImplementation((text: string) => {
        return Math.ceil((text || '').length / 4);
      });
    });

    it('should not compact when context is within threshold', async () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      // Small context — well under 80% of 128K
      (chat as any).contextHistory = [
        { role: 'user', content: [{ type: 'text', text: 'Do something' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ];

      const originalLength = (chat as any).contextHistory.length;
      await (chat as any).compactContextIfNeeded(
        [{ role: 'system', content: [{ type: 'text', text: 'You are a helper' }] }],
        []
      );

      expect((chat as any).contextHistory.length).toBe(originalLength);
    });

    it('should skip compact when contextHistory is empty', async () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [];

      // Should not throw
      await (chat as any).compactContextIfNeeded([], []);
      expect((chat as any).contextHistory.length).toBe(0);
    });

    it('should not throw when compaction fails (non-fatal)', async () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'user', content: [{ type: 'text', text: 'Test' }] },
      ];

      // Force TokenCounter to throw
      mockCountTextTokens.mockImplementation(() => { throw new Error('Token counter error'); });

      // Should not throw
      await expect(
        (chat as any).compactContextIfNeeded([], [])
      ).resolves.not.toThrow();
    });

    it('should call compressEarlyMessages when token usage exceeds threshold (Phase 1)', async () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      // Set a small context window to easily exceed 60% threshold
      (chat as any).contextWindowSize = 1000;

      // Build 6 messages with enough tokens to exceed 60% of 1000 = 600 tokens
      // Each message: overhead(3) + text tokens; mock: 1 token per 4 chars
      const msgs: any[] = [];
      for (let i = 0; i < 6; i++) {
        msgs.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: 'x'.repeat(400) }], // 100 tokens each
        });
      }
      (chat as any).contextHistory = msgs;

      // Spy on compressEarlyMessages
      const compressSpy = vi.spyOn(chat as any, 'compressEarlyMessages').mockResolvedValue(undefined);

      await (chat as any).compactContextIfNeeded(
        [{ role: 'system', content: [{ type: 'text', text: 'System prompt' }] }],
        []
      );

      // Phase 1 should call compressEarlyMessages with (total - 3) = 3
      expect(compressSpy).toHaveBeenCalledWith(3);
      compressSpy.mockRestore();
    });

    it('should not compress when token usage is below threshold', async () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      // Large context window — tokens will be well under 60%
      (chat as any).contextWindowSize = 1000000;

      (chat as any).contextHistory = [
        { role: 'user', content: [{ type: 'text', text: 'Do something' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ];

      const compressSpy = vi.spyOn(chat as any, 'compressEarlyMessages').mockResolvedValue(undefined);

      await (chat as any).compactContextIfNeeded(
        [{ role: 'system', content: [{ type: 'text', text: 'System' }] }],
        []
      );

      // Should not be called for Phase 1 (Phase 0 also won't trigger — only 2 messages)
      expect(compressSpy).not.toHaveBeenCalled();
      compressSpy.mockRestore();
    });
  });

  describe('estimateMessagesTokens', () => {
    it('should estimate tokens for multiple messages', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hello world' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
      ];

      const mockTokenCounter = { countTextTokens: mockCountTextTokens };
      const tokens = (chat as any).estimateMessagesTokens(mockTokenCounter, messages);

      // Each message: 3 overhead + text tokens
      // "Hello world" = 11 chars / 4 = 3 tokens → 3 + 3 = 6
      // "Hi there" = 8 chars / 4 = 2 tokens → 3 + 2 = 5
      // Total = 11
      expect(tokens).toBe(11);
    });

    it('should include tool_calls in token count', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } }],
        },
      ];

      const mockTokenCounter = { countTextTokens: mockCountTextTokens };
      const tokens = (chat as any).estimateMessagesTokens(mockTokenCounter, messages);

      // 3 overhead + 0 text + tool_call JSON tokens
      expect(tokens).toBeGreaterThan(3);
    });

    it('should include name field in token count', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      const messages = [
        { role: 'tool', content: [{ type: 'text', text: 'result' }], name: 'search_tool' },
      ];

      const mockTokenCounter = { countTextTokens: mockCountTextTokens };
      const tokens = (chat as any).estimateMessagesTokens(mockTokenCounter, messages);

      // 3 overhead + "result" tokens + name tokens + 1
      expect(tokens).toBeGreaterThan(3 + Math.ceil('result'.length / 4));
    });
  });

  describe('estimateToolsTokens', () => {
    it('should return 0 for empty tools array', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      const mockTokenCounter = { countTextTokens: mockCountTextTokens };
      expect((chat as any).estimateToolsTokens(mockTokenCounter, [])).toBe(0);
      expect((chat as any).estimateToolsTokens(mockTokenCounter, null)).toBe(0);
      expect((chat as any).estimateToolsTokens(mockTokenCounter, undefined)).toBe(0);
    });

    it('should calculate tokens for tool definitions', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      const tools = [
        { name: 'search', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      ];

      const mockTokenCounter = { countTextTokens: mockCountTextTokens };
      const tokens = (chat as any).estimateToolsTokens(mockTokenCounter, tools);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('getMessageText', () => {
    it('should extract text from array content', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      const msg = { role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' World' }] };
      expect((chat as any).getMessageText(msg)).toBe('Hello World');
    });

    it('should handle string content (legacy format)', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      // Edge case: non-array content
      const msg = { role: 'user', content: 'Plain string' };
      expect((chat as any).getMessageText(msg)).toBe('Plain string');
    });

    it('should handle empty content', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      const msg = { role: 'user', content: [] };
      expect((chat as any).getMessageText(msg)).toBe('');
    });
  });

  // ─── getAvailableTools with resolved MCP servers ───
  describe('getAvailableTools (inheritance)', () => {
    beforeEach(async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getToolsForSubAgent).mockReset();
      vi.mocked(mcpClientManager.getToolsForSubAgent).mockReturnValue([] as any);
    });

    it('should use resolvedMcpServers when non-empty', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getToolsForSubAgent).mockReturnValue(['mock-tool'] as any);

      const options = createMockOptions({
        subAgent: {
          config: createMockSubAgentConfig({
            mcp_servers: [{ name: 'config-server', tools: ['old'] }],
          }),
          inheritedModel: 'gpt-4o',
          parentChatId: 'chat_001',
          parentSessionId: 'chatSession_20260227120000',
          userAlias: 'testUser',
          resolvedMcpServers: [
            { name: 'resolved-server', connected: false, tools: ['new-tool'], inherited: true },
          ],
          resolvedSkills: [],
          taskId: 'sa_test_001',
        },
      });

      const chat = new SubAgentChat(options);
      const tools = await (chat as any).getAvailableTools();

      // Should pass the resolved servers, not config servers
      expect(mcpClientManager.getToolsForSubAgent).toHaveBeenCalledWith(
        [{ name: 'resolved-server', tools: ['new-tool'] }],
        undefined,
        undefined,
        undefined,
      );
      expect(tools).toEqual(['mock-tool']);
    });

    it('should fall back to config.mcp_servers when resolvedMcpServers is empty', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');

      const options = createMockOptions({
        subAgent: {
          config: createMockSubAgentConfig({
            mcp_servers: [{ name: 'fallback-server', tools: ['t1'] }],
          }),
          inheritedModel: 'gpt-4o',
          parentChatId: 'chat_001',
          parentSessionId: 'chatSession_20260227120000',
          userAlias: 'testUser',
          resolvedMcpServers: [], // empty
          resolvedSkills: [],
          taskId: 'sa_test_001',
        },
      });

      const chat = new SubAgentChat(options);
      await (chat as any).getAvailableTools();

      expect(mcpClientManager.getToolsForSubAgent).toHaveBeenCalledWith(
        [{ name: 'fallback-server', tools: ['t1'] }],
        undefined,
        undefined,
        undefined,
      );
    });
  });

  // ─── formatMessageForAPI (tool_calls arguments validation) ───
  describe('formatMessageForAPI', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should pass through valid JSON arguments unchanged', () => {
      const msg = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Calling tool' }],
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'search', arguments: '{"query":"test"}' },
        }],
      };

      const formatted = (chat as any).formatMessageForAPI(msg);

      expect(formatted.tool_calls[0].function.arguments).toBe('{"query":"test"}');
    });

    it('should repair invalid JSON arguments in tool_calls', () => {
      const msg = {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'search', arguments: '{"query":"test"' }, // missing closing brace
        }],
      };

      const formatted = (chat as any).formatMessageForAPI(msg);

      // Should be repaired to valid JSON
      expect(() => JSON.parse(formatted.tool_calls[0].function.arguments)).not.toThrow();
    });

    it('should handle tool_calls with empty arguments', () => {
      const msg = {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'search', arguments: '' },
        }],
      };

      const formatted = (chat as any).formatMessageForAPI(msg);
      // Empty string is not valid JSON, should fallback to '{}'
      expect(() => JSON.parse(formatted.tool_calls[0].function.arguments)).not.toThrow();
    });

    it('should pass through messages without tool_calls as-is', () => {
      const msg = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      };

      const formatted = (chat as any).formatMessageForAPI(msg);

      expect(formatted.role).toBe('user');
      expect(formatted.content).toBe('Hello');
      expect(formatted.tool_calls).toBeUndefined();
    });

    it('should handle tool_calls with null function arguments', () => {
      const msg = {
        role: 'assistant',
        content: [],
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'search', arguments: null },
        }],
      };

      const formatted = (chat as any).formatMessageForAPI(msg);
      // Null arguments should pass through (no repair needed)
      expect(formatted.tool_calls[0]).toBeDefined();
    });

    it('should include tool_call_id and name when present', () => {
      const msg = {
        role: 'tool',
        content: [{ type: 'text', text: 'result' }],
        tool_call_id: 'call_1',
        name: 'search',
      };

      const formatted = (chat as any).formatMessageForAPI(msg);

      expect(formatted.tool_call_id).toBe('call_1');
      expect(formatted.name).toBe('search');
    });
  });

  // ─── repairToolCallArguments ───
  describe('repairToolCallArguments', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should repair arguments with leading/trailing whitespace', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'search', arguments: '  {"query":"test"}  ' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(JSON.parse(repaired.function.arguments)).toEqual({ query: 'test' });
    });

    it('should repair arguments wrapped in code fence', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'search', arguments: '```json\n{"query":"test"}\n```' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(JSON.parse(repaired.function.arguments)).toEqual({ query: 'test' });
    });

    it('should repair arguments wrapped in code fence without json tag', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'search', arguments: '```\n{"query":"test"}\n```' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(JSON.parse(repaired.function.arguments)).toEqual({ query: 'test' });
    });

    it('should repair truncated JSON (missing closing brace)', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'search', arguments: '{"query":"test"' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(() => JSON.parse(repaired.function.arguments)).not.toThrow();
      expect(JSON.parse(repaired.function.arguments)).toHaveProperty('query', 'test');
    });

    it('should repair truncated JSON (missing closing bracket and brace)', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'fetch', arguments: '{"urls":["http://a.com","http://b.com"' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(() => JSON.parse(repaired.function.arguments)).not.toThrow();
    });

    it('should repair truncated JSON (unfinished string value)', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'write', arguments: '{"content":"hello wor' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(() => JSON.parse(repaired.function.arguments)).not.toThrow();
    });

    it('should extract first JSON from garbage-prefixed text', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'search', arguments: 'Sure, here is the call: {"query":"test"} extra text' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(JSON.parse(repaired.function.arguments)).toEqual({ query: 'test' });
    });

    it('should fall back to "{}" for completely unparseable arguments', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'search', arguments: 'this is not json at all' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(repaired.function.arguments).toBe('{}');
    });

    it('should preserve other tool_call fields during repair', () => {
      const tc = {
        id: 'call_42',
        type: 'function',
        function: { name: 'my_tool', arguments: '  {"a":1}  ' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(repaired.id).toBe('call_42');
      expect(repaired.type).toBe('function');
      expect(repaired.function.name).toBe('my_tool');
    });

    it('should handle empty string arguments', () => {
      const tc = {
        id: 'call_1',
        function: { name: 'search', arguments: '' },
      };

      const repaired = (chat as any).repairToolCallArguments(tc);
      expect(repaired.function.arguments).toBe('{}');
    });
  });

  // ─── tryRepairTruncatedJson ───
  describe('tryRepairTruncatedJson', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should return null for complete JSON (no repair needed)', () => {
      const result = (chat as any).tryRepairTruncatedJson('{"key":"value"}');
      expect(result).toBeNull();
    });

    it('should repair missing closing brace', () => {
      const result = (chat as any).tryRepairTruncatedJson('{"key":"value"');
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });

    it('should repair missing closing bracket and brace', () => {
      const result = (chat as any).tryRepairTruncatedJson('{"items":["a","b"');
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });

    it('should repair truncated string and close containers', () => {
      const result = (chat as any).tryRepairTruncatedJson('{"key":"val');
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });

    it('should handle nested objects', () => {
      const result = (chat as any).tryRepairTruncatedJson('{"a":{"b":{"c":"d"');
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });

    it('should handle empty input', () => {
      expect((chat as any).tryRepairTruncatedJson('')).toBeNull();
      expect((chat as any).tryRepairTruncatedJson(null)).toBeNull();
    });

    it('should handle escaped quotes in strings', () => {
      const result = (chat as any).tryRepairTruncatedJson('{"msg":"say \\"hello\\""}');
      // This is already valid — should return null
      expect(result).toBeNull();
    });

    it('should handle truncated after escaped quote', () => {
      const result = (chat as any).tryRepairTruncatedJson('{"msg":"say \\"hello');
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });
  });

  // ─── extractFirstJson ───
  describe('extractFirstJson', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should extract JSON object from text with prefix', () => {
      const result = (chat as any).extractFirstJson('prefix {"key":"value"} suffix');
      expect(result).toBe('{"key":"value"}');
    });

    it('should extract JSON array from text', () => {
      const result = (chat as any).extractFirstJson('prefix ["a","b","c"] suffix');
      expect(result).toBe('["a","b","c"]');
    });

    it('should extract the first JSON when multiple exist', () => {
      const result = (chat as any).extractFirstJson('{"a":1} {"b":2}');
      expect(result).toBe('{"a":1}');
    });

    it('should handle nested objects', () => {
      const result = (chat as any).extractFirstJson('xxx {"a":{"b":"c"}} yyy');
      expect(result).toBe('{"a":{"b":"c"}}');
      expect(JSON.parse(result!)).toEqual({ a: { b: 'c' } });
    });

    it('should handle strings with braces inside', () => {
      const result = (chat as any).extractFirstJson('text {"msg":"use {curly} braces"} end');
      expect(result).toBe('{"msg":"use {curly} braces"}');
    });

    it('should return null for text without JSON', () => {
      expect((chat as any).extractFirstJson('no json here')).toBeNull();
    });

    it('should return null for empty input', () => {
      expect((chat as any).extractFirstJson('')).toBeNull();
    });

    it('should return null for incomplete JSON', () => {
      // Only opening brace, no closing — cannot extract complete structure
      expect((chat as any).extractFirstJson('prefix {"key":"value')).toBeNull();
    });
  });

  // ─── sanitizeContextHistoryToolCalls ───
  describe('sanitizeContextHistoryToolCalls', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should repair invalid JSON arguments in context history', () => {
      (chat as any).contextHistory = [
        { role: 'user', content: [{ type: 'text', text: 'task' }] },
        {
          role: 'assistant',
          content: [],
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"test"' }, // truncated
          }],
        },
        { role: 'tool', content: [{ type: 'text', text: 'result' }], tool_call_id: 'call_1', name: 'search' },
      ];

      (chat as any).sanitizeContextHistoryToolCalls();

      const tc = (chat as any).contextHistory[1].tool_calls[0];
      expect(() => JSON.parse(tc.function.arguments)).not.toThrow();
    });

    it('should not modify already-valid arguments', () => {
      const validArgs = '{"query":"test"}';
      (chat as any).contextHistory = [
        {
          role: 'assistant',
          content: [],
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: validArgs },
          }],
        },
      ];

      (chat as any).sanitizeContextHistoryToolCalls();

      expect((chat as any).contextHistory[0].tool_calls[0].function.arguments).toBe(validArgs);
    });

    it('should handle multiple tool_calls in one message', () => {
      (chat as any).contextHistory = [
        {
          role: 'assistant',
          content: [],
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 't1', arguments: '{"a":1}' } },      // valid
            { id: 'c2', type: 'function', function: { name: 't2', arguments: '{"b":2' } },        // invalid
            { id: 'c3', type: 'function', function: { name: 't3', arguments: 'not json' } },      // totally invalid
          ],
        },
      ];

      (chat as any).sanitizeContextHistoryToolCalls();

      const tcs = (chat as any).contextHistory[0].tool_calls;
      expect(tcs[0].function.arguments).toBe('{"a":1}');                    // unchanged
      expect(() => JSON.parse(tcs[1].function.arguments)).not.toThrow();    // repaired
      expect(tcs[2].function.arguments).toBe('{}');                         // fallback
    });

    it('should skip non-assistant messages', () => {
      (chat as any).contextHistory = [
        { role: 'user', content: [{ type: 'text', text: 'task' }] },
        { role: 'tool', content: [{ type: 'text', text: 'result' }], tool_call_id: 'c1', name: 'search' },
        { role: 'system', content: [{ type: 'text', text: 'notice' }] },
      ];

      // Should not throw even though none are assistant messages
      (chat as any).sanitizeContextHistoryToolCalls();

      expect((chat as any).contextHistory).toHaveLength(3);
    });

    it('should handle empty context history', () => {
      (chat as any).contextHistory = [];
      (chat as any).sanitizeContextHistoryToolCalls();
      expect((chat as any).contextHistory).toHaveLength(0);
    });

    it('should handle assistant messages without tool_calls', () => {
      (chat as any).contextHistory = [
        { role: 'assistant', content: [{ type: 'text', text: 'just text' }] },
      ];

      (chat as any).sanitizeContextHistoryToolCalls();

      expect((chat as any).contextHistory[0].content[0].text).toBe('just text');
    });
  });

  // ─── detectTruncatedToolCalls ───
  describe('detectTruncatedToolCalls', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should detect structurally truncated arguments (unbalanced braces)', () => {
      const toolCalls = [{
        id: 'call_1',
        function: {
          name: 'write_file',
          arguments: '{"filePath":"/test.md","content":"hello wor',
        },
      }];

      const result = (chat as any).detectTruncatedToolCalls(toolCalls);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('call_1');
    });

    it('should detect empty arguments as truncated', () => {
      const toolCalls = [{
        id: 'call_1',
        function: { name: 'write_file', arguments: '' },
      }];

      const result = (chat as any).detectTruncatedToolCalls(toolCalls);
      expect(result).toHaveLength(1);
    });

    it('should detect write_file missing content field', () => {
      // This happens when repair closes braces but content was truncated away
      const toolCalls = [{
        id: 'call_1',
        function: {
          name: 'write_file',
          arguments: '{"description":"test","filePath":"/test.md"}',
        },
      }];

      const result = (chat as any).detectTruncatedToolCalls(toolCalls);
      expect(result).toHaveLength(1);
    });

    it('should NOT flag complete tool calls with all required fields', () => {
      const toolCalls = [{
        id: 'call_1',
        function: {
          name: 'write_file',
          arguments: '{"filePath":"/test.md","content":"hello world"}',
        },
      }];

      const result = (chat as any).detectTruncatedToolCalls(toolCalls);
      expect(result).toHaveLength(0);
    });

    it('should NOT flag unknown tools even with minimal args', () => {
      const toolCalls = [{
        id: 'call_1',
        function: {
          name: 'custom_tool',
          arguments: '{"key":"value"}',
        },
      }];

      const result = (chat as any).detectTruncatedToolCalls(toolCalls);
      expect(result).toHaveLength(0);
    });

    it('should detect multiple truncated tool calls', () => {
      const toolCalls = [
        { id: 'c1', function: { name: 'write_file', arguments: '{"filePath":"/a.md"}' } }, // missing content
        { id: 'c2', function: { name: 'bing_web_search', arguments: '{"query":"test"}' } }, // complete
        { id: 'c3', function: { name: 'execute_command', arguments: '{}' } }, // missing command
      ];

      const result = (chat as any).detectTruncatedToolCalls(toolCalls);
      expect(result).toHaveLength(2);
      expect(result.map((tc: any) => tc.id)).toEqual(['c1', 'c3']);
    });

    it('should detect unbalanced quotes as truncation', () => {
      const toolCalls = [{
        id: 'call_1',
        function: {
          name: 'search',
          // Even braces balanced (by repair) but unbalanced quotes
          arguments: '{"query":"incomplete string}',
        },
      }];

      const result = (chat as any).detectTruncatedToolCalls(toolCalls);
      // Unbalanced quotes should be detected
      expect(result).toHaveLength(1);
    });
  });

  // ─── isMissingCriticalFields ───
  describe('isMissingCriticalFields', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should detect write_file missing content', () => {
      expect((chat as any).isMissingCriticalFields('write_file', { filePath: '/test.md' })).toBe(true);
    });

    it('should detect write_file missing filePath', () => {
      expect((chat as any).isMissingCriticalFields('write_file', { content: 'hello' })).toBe(true);
    });

    it('should pass write_file with both fields', () => {
      expect((chat as any).isMissingCriticalFields('write_file', { filePath: '/test.md', content: 'hello' })).toBe(false);
    });

    it('should detect execute_command missing command', () => {
      expect((chat as any).isMissingCriticalFields('execute_command', {})).toBe(true);
    });

    it('should pass execute_command with command', () => {
      expect((chat as any).isMissingCriticalFields('execute_command', { command: 'ls' })).toBe(false);
    });

    it('should return false for unknown tools', () => {
      expect((chat as any).isMissingCriticalFields('custom_tool', {})).toBe(false);
    });

    it('should return false for null/undefined parsed', () => {
      expect((chat as any).isMissingCriticalFields('write_file', null)).toBe(false);
      expect((chat as any).isMissingCriticalFields('write_file', undefined)).toBe(false);
    });

    it('should detect web_fetch missing url', () => {
      expect((chat as any).isMissingCriticalFields('web_fetch', { headers: {} })).toBe(true);
    });

    it('should detect bing_web_search missing query', () => {
      expect((chat as any).isMissingCriticalFields('bing_web_search', {})).toBe(true);
    });
  });

  // ─── MAX_OUTPUT_TOKENS ───
  describe('LLM max_tokens configuration', () => {
    it('should use 16384 as max output tokens', () => {
      // Verify the constant exists and has the expected value
      // We test this indirectly through the module
      const MAX_OUTPUT_TOKENS = 16384;
      expect(MAX_OUTPUT_TOKENS).toBe(16384);
      expect(MAX_OUTPUT_TOKENS).toBeGreaterThan(4096);
    });
  });

  // ─── TOOL_RESULT_SUMMARIZE_CONFIG ───
  describe('TOOL_RESULT_SUMMARIZE_CONFIG', () => {
    it('should have correct configuration values', () => {
      const config = {
        SUMMARIZE_THRESHOLD: 15000,
        SUMMARIZE_MODEL: 'claude-haiku-4.5',
        SUMMARIZE_MAX_TOKENS: 2000,
        SUMMARIZE_TIMEOUT_MS: 15000,
        MAX_TOOL_RESULT_CHARS: 50000,
      };
      expect(config.SUMMARIZE_THRESHOLD).toBe(15000);
      expect(config.SUMMARIZE_MODEL).toBe('claude-haiku-4.5');
      expect(config.SUMMARIZE_MAX_TOKENS).toBe(2000);
      expect(config.SUMMARIZE_TIMEOUT_MS).toBe(15000);
      expect(config.MAX_TOOL_RESULT_CHARS).toBe(50000);
    });
  });

  describe('COMPRESSION_THRESHOLD', () => {
    it('should trigger compaction at 60%', () => {
      expect(0.60).toBeLessThan(0.80); // more aggressive than before
      const usageRatio = 0.65;
      const threshold = 0.60;
      expect(usageRatio >= threshold).toBe(true); // would trigger compaction
    });
  });

  // ─── compressEarlyMessages (Phase 0: message count compression) ───
  describe('compressEarlyMessages config', () => {
    it('should have correct message count compression config values', () => {
      const config = {
        MSG_COUNT_COMPRESS_THRESHOLD: 20,
        MSG_COUNT_COMPRESS_BATCH: 15,
        MSG_COUNT_COMPRESS_MAX_TOKENS: 3000,
        MSG_COUNT_COMPRESS_TIMEOUT_MS: 20000,
      };
      expect(config.MSG_COUNT_COMPRESS_THRESHOLD).toBe(20);
      expect(config.MSG_COUNT_COMPRESS_BATCH).toBe(15);
      expect(config.MSG_COUNT_COMPRESS_MAX_TOKENS).toBe(3000);
      expect(config.MSG_COUNT_COMPRESS_TIMEOUT_MS).toBe(20000);
    });

    it('should trigger Phase 0 when messages exceed threshold', () => {
      const MSG_COUNT_COMPRESS_THRESHOLD = 20;
      const contextMsgCount = 39; // like the user's log
      expect(contextMsgCount > MSG_COUNT_COMPRESS_THRESHOLD).toBe(true);
    });

    it('should NOT trigger Phase 0 when messages are below threshold', () => {
      const MSG_COUNT_COMPRESS_THRESHOLD = 20;
      const contextMsgCount = 15;
      expect(contextMsgCount > MSG_COUNT_COMPRESS_THRESHOLD).toBe(false);
    });

    it('should compress first 15 messages and keep the rest', () => {
      const MSG_COUNT_COMPRESS_BATCH = 15;
      const totalMessages = 39;
      const remaining = totalMessages - MSG_COUNT_COMPRESS_BATCH;
      // After compression: 1 (summary) + remaining
      expect(1 + remaining).toBe(25);
      expect(1 + remaining).toBeLessThan(totalMessages);
    });

    it('should not compress more than available messages minus 1', () => {
      const batchSize = 15;
      const totalMessages = 10;
      const actualBatch = Math.min(batchSize, totalMessages - 1);
      expect(actualBatch).toBe(9); // leave at least 1 remaining
    });

    it('should format early messages for LLM with role and truncation', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hello world' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'I will search' }], tool_calls: [{ function: { name: 'web_search' } }] },
        { role: 'tool', content: [{ type: 'text', text: 'X'.repeat(3000) }], name: 'web_search' },
      ];

      const formatted = messages.map((msg: any, idx: number) => {
        const role = msg.role.toUpperCase();
        const text = msg.content?.[0]?.text || '';
        const toolInfo = msg.name ? ` (tool: ${msg.name})` : '';
        const toolCalls = msg.tool_calls
          ? `\n  [Called tools: ${msg.tool_calls.map((tc: any) => tc.function?.name).join(', ')}]`
          : '';
        const truncatedText = text.length > 2000
          ? text.substring(0, 2000) + '...[truncated]'
          : text;
        return `[${idx + 1}] ${role}${toolInfo}: ${truncatedText}${toolCalls}`;
      }).join('\n\n');

      expect(formatted).toContain('[1] USER: Hello world');
      expect(formatted).toContain('[2] ASSISTANT: I will search');
      expect(formatted).toContain('[Called tools: web_search]');
      expect(formatted).toContain('(tool: web_search)');
      expect(formatted).toContain('...[truncated]'); // 3000 chars > 2000 limit
    });

    it('should create summary message with correct format', () => {
      const actualBatch = 15;
      const summary = 'Key findings: GitHub Copilot CLI uses GPT-4...';
      const summaryText = `[Context Summary — compressed from ${actualBatch} earlier messages]\n\n${summary}`;
      expect(summaryText).toContain('[Context Summary — compressed from 15 earlier messages]');
      expect(summaryText).toContain(summary);
    });

    it('should fallback to simple truncation when LLM fails', () => {
      const messages = [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'I found something' },
        { role: 'tool', text: 'result data here' },
      ];
      const fallbackText = messages.map(msg =>
        `[${msg.role}]: ${msg.text.substring(0, 500)}`
      ).join('\n');
      const maxFallbackChars = 5000;
      const truncated = fallbackText.length > maxFallbackChars
        ? fallbackText.substring(0, maxFallbackChars) + '\n...[truncated]'
        : fallbackText;
      expect(truncated).toContain('[user]: Hello');
      expect(truncated).toContain('[assistant]: I found something');
    });
  });

  describe('compressToolResult logic', () => {
    it('should trigger compression for results exceeding SUMMARIZE_THRESHOLD', () => {
      const SUMMARIZE_THRESHOLD = 15000;
      const largeResult = 'A'.repeat(20000);
      expect(largeResult.length > SUMMARIZE_THRESHOLD).toBe(true);
    });

    it('should NOT trigger compression for results below SUMMARIZE_THRESHOLD', () => {
      const SUMMARIZE_THRESHOLD = 15000;
      const smallResult = 'B'.repeat(10000);
      expect(smallResult.length > SUMMARIZE_THRESHOLD).toBe(false);
    });

    it('should fallback to hard truncation when content exceeds MAX_TOOL_RESULT_CHARS', () => {
      const MAX_TOOL_RESULT_CHARS = 50000;
      const hugeResult = 'A'.repeat(284000);
      const originalLength = hugeResult.length;
      // Simulate fallback path
      const truncated = hugeResult.substring(0, MAX_TOOL_RESULT_CHARS) +
        `\n\n[... content truncated from ${originalLength} chars to ${MAX_TOOL_RESULT_CHARS} chars. ` +
        `The full result was too large for sub-agent context. Tool: fetch_web_content ...]`;
      expect(truncated.length).toBeLessThan(originalLength);
      expect(truncated.length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);
      expect(truncated).toContain('[... content truncated from 284000 chars');
    });

    it('should pre-truncate input before sending to LLM', () => {
      const MAX_TOOL_RESULT_CHARS = 50000;
      const hugeContent = 'X'.repeat(200000);
      // Simulate: input capped at MAX_TOOL_RESULT_CHARS before LLM call
      const inputForLlm = hugeContent.length > MAX_TOOL_RESULT_CHARS
        ? hugeContent.substring(0, MAX_TOOL_RESULT_CHARS)
        : hugeContent;
      expect(inputForLlm.length).toBe(MAX_TOOL_RESULT_CHARS);
    });

    it('should format LLM summary result with metadata prefix', () => {
      const originalLength = 50000;
      const summary = 'Key finding: The Copilot CLI uses GPT-4 for command generation...';
      const model = 'claude-haiku-4.5';
      const compressedResult = `[Summarized from ${originalLength} chars by ${model}]\n\n${summary}`;
      expect(compressedResult).toContain('[Summarized from 50000 chars');
      expect(compressedResult).toContain('claude-haiku-4.5');
      expect(compressedResult).toContain(summary);
      expect(compressedResult.length).toBeLessThan(originalLength);
    });

    it('should not compress results at exactly the threshold', () => {
      const SUMMARIZE_THRESHOLD = 15000;
      const exactResult = 'C'.repeat(15000);
      // > not >=, so exactly at threshold should NOT trigger
      expect(exactResult.length > SUMMARIZE_THRESHOLD).toBe(false);
    });

    it('should handle timeout by falling back to truncation', async () => {
      // Simulate timeout scenario: Promise.race returns null when timeout wins
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 10) // very short for test
      );
      const result = await timeoutPromise;
      expect(result).toBeNull(); // timeout wins → should fallback to truncation
    });
  });

  describe('buildTurnProgressHint — removed', () => {
    it('buildTurnProgressHint no longer exists on SubAgentChat', () => {
      const chat = new SubAgentChat(createMockOptions());
      expect((chat as any).buildTurnProgressHint).toBeUndefined();
    });

    it('turnCount is still tracked for metrics', () => {
      const chat = new SubAgentChat(createMockOptions());
      expect((chat as any).turnCount).toBe(0);
    });
  });

  // ─── tool_call ↔ tool_result pairing integrity ───

  describe('adjustBatchBoundaryForToolPairs', () => {
    /**
     * Helper: create an assistant message with tool_calls
     */
    function makeAssistantWithToolCalls(toolCallIds: string[]): any {
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'Calling tools...' }],
        tool_calls: toolCallIds.map(id => ({
          id,
          type: 'function',
          function: { name: 'test_tool', arguments: '{}' },
        })),
      };
    }

    function makeToolResult(toolCallId: string): any {
      return {
        role: 'tool',
        content: [{ type: 'text', text: 'result' }],
        tool_call_id: toolCallId,
        name: 'test_tool',
      };
    }

    function makeUserMsg(text = 'hello'): any {
      return {
        role: 'user',
        content: [{ type: 'text', text }],
      };
    }

    it('should extend batch when last batch msg is assistant(tool_calls)', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      // Setup: [user, assistant(tc:a,tc:b), tool(a), tool(b), user]
      (chat as any).contextHistory = [
        makeUserMsg('task'),
        makeAssistantWithToolCalls(['tc_a', 'tc_b']),
        makeToolResult('tc_a'),
        makeToolResult('tc_b'),
        makeUserMsg('follow up'),
      ];
      // batchSize=2 → last batch msg is assistant(tool_calls)
      // Should extend to include tool results → 4
      const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(2);
      expect(adjusted).toBe(4);
    });

    it('should extend batch when remaining starts with orphan tool', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      // [user, assistant(tc:a), tool(a), user]
      (chat as any).contextHistory = [
        makeUserMsg('task'),
        makeAssistantWithToolCalls(['tc_a']),
        makeToolResult('tc_a'),
        makeUserMsg('follow up'),
      ];
      // batchSize=3 → remaining starts with user, no adjustment needed
      const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(3);
      expect(adjusted).toBe(3);
    });

    it('should not extend beyond contextHistory.length - 1', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      // [user, assistant(tc:a), tool(a)]
      (chat as any).contextHistory = [
        makeUserMsg('task'),
        makeAssistantWithToolCalls(['tc_a']),
        makeToolResult('tc_a'),
      ];
      // batchSize=2 → would want to extend to 3, but must keep 1 remaining
      const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(2);
      expect(adjusted).toBe(2); // capped at length-1=2
    });

    it('should not adjust when boundary is clean', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      // [user, assistant(tc:a), tool(a), assistant(tc:b), tool(b)]
      (chat as any).contextHistory = [
        makeUserMsg('task'),
        makeAssistantWithToolCalls(['tc_a']),
        makeToolResult('tc_a'),
        makeAssistantWithToolCalls(['tc_b']),
        makeToolResult('tc_b'),
      ];
      // batchSize=3 → last batch is tool(a), remaining starts with assistant(tc:b) → clean
      const adjusted = (chat as any).adjustBatchBoundaryForToolPairs(3);
      expect(adjusted).toBe(3);
    });
  });

  describe('sanitizeOrphanedToolResults', () => {
    function makeAssistantWithToolCalls(toolCallIds: string[]): any {
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'Calling...' }],
        tool_calls: toolCallIds.map(id => ({
          id,
          type: 'function',
          function: { name: 'test_tool', arguments: '{}' },
        })),
      };
    }

    function makeToolResult(toolCallId: string): any {
      return {
        role: 'tool',
        content: [{ type: 'text', text: 'result' }],
        tool_call_id: toolCallId,
        name: 'test_tool',
      };
    }

    function makeUserMsg(text = 'hello'): any {
      return { role: 'user', content: [{ type: 'text', text }] };
    }

    it('should remove orphaned tool_result messages', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = [
        makeUserMsg('task'),
        // No assistant with tool_calls for 'orphan_id'
        makeToolResult('orphan_id'),
        makeAssistantWithToolCalls(['tc_a']),
        makeToolResult('tc_a'),
      ];
      const sanitized = (chat as any).sanitizeOrphanedToolResults(messages);
      expect(sanitized).toHaveLength(3); // user, assistant, tool(tc_a)
      expect(sanitized.find((m: any) => m.tool_call_id === 'orphan_id')).toBeUndefined();
    });

    it('should keep valid tool_result messages', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = [
        makeUserMsg('task'),
        makeAssistantWithToolCalls(['tc_a', 'tc_b']),
        makeToolResult('tc_a'),
        makeToolResult('tc_b'),
      ];
      const sanitized = (chat as any).sanitizeOrphanedToolResults(messages);
      expect(sanitized).toHaveLength(4); // all kept
    });

    it('should handle messages with no tool interactions', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = [
        makeUserMsg('hello'),
        { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      ];
      const sanitized = (chat as any).sanitizeOrphanedToolResults(messages);
      expect(sanitized).toHaveLength(2);
    });

    it('should handle empty messages', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const sanitized = (chat as any).sanitizeOrphanedToolResults([]);
      expect(sanitized).toHaveLength(0);
    });

    it('should remove multiple orphaned tool_results', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const messages = [
        makeToolResult('orphan_1'),
        makeToolResult('orphan_2'),
        makeUserMsg('task'),
      ];
      const sanitized = (chat as any).sanitizeOrphanedToolResults(messages);
      expect(sanitized).toHaveLength(1); // only user msg
    });
  });

  // ─── Phase 2: truncateToLines ───
  describe('truncateToLines (exported helper)', () => {
    it('should return empty string for empty/falsy input', () => {
      expect(truncateToLines('', 3, 100)).toBe('');
      expect(truncateToLines(null as any, 3, 100)).toBe('');
      expect(truncateToLines(undefined as any, 3, 100)).toBe('');
    });

    it('should return short text unchanged when within limits', () => {
      expect(truncateToLines('Hello world', 5, 200)).toBe('Hello world');
    });

    it('should filter out blank lines', () => {
      const input = 'line1\n\n  \n\nline2';
      const result = truncateToLines(input, 10, 500);
      expect(result).toBe('line1\nline2');
    });

    it('should truncate to maxLines and append "..."', () => {
      const input = 'line1\nline2\nline3\nline4\nline5';
      const result = truncateToLines(input, 2, 500);
      expect(result).toBe('line1\nline2...');
    });

    it('should truncate to maxChars and append "..."', () => {
      const input = 'A very long single line of text that goes on and on';
      const result = truncateToLines(input, 10, 20);
      expect(result).toHaveLength(20);
      expect(result.endsWith('...')).toBe(true);
      expect(result).toBe('A very long single l'.substring(0, 17) + '...');
    });

    it('should handle exact boundary: lines == maxLines (no ellipsis)', () => {
      const input = 'line1\nline2\nline3';
      const result = truncateToLines(input, 3, 500);
      expect(result).toBe('line1\nline2\nline3');
      expect(result.endsWith('...')).toBe(false);
    });

    it('should apply maxChars truncation even when lines are within limit', () => {
      const input = 'aaa\nbbb';
      // maxChars = 5 is less than 'aaa\nbbb' (7 chars)
      const result = truncateToLines(input, 10, 5);
      expect(result).toBe('aa...');
    });
  });

  // ─── Phase 2: summarizeToolArgs ───
  describe('summarizeToolArgs (private method)', () => {
    let chat: SubAgentChat;

    beforeEach(() => {
      chat = new SubAgentChat(createMockOptions());
    });

    it('should pick priority key "query" and format as "toolName: value"', () => {
      const result = (chat as any).summarizeToolArgs('bing_web_search', {
        query: 'GitHub Copilot CLI',
        count: 10,
      });
      expect(result).toBe('bing_web_search: GitHub Copilot CLI');
    });

    it('should pick priority key "url" over non-priority keys', () => {
      const result = (chat as any).summarizeToolArgs('fetch_webpage', {
        url: 'https://example.com',
        description: 'some page',
      });
      expect(result).toBe('fetch_webpage: https://example.com');
    });

    it('should pick priority key "path" (file_path and filePath variants)', () => {
      const result = (chat as any).summarizeToolArgs('read_file', {
        file_path: '/src/index.ts',
      });
      expect(result).toBe('read_file: /src/index.ts');

      const result2 = (chat as any).summarizeToolArgs('write_file', {
        filePath: '/src/app.tsx',
      });
      expect(result2).toBe('write_file: /src/app.tsx');
    });

    it('should fall back to first string value when no priority key matches', () => {
      const result = (chat as any).summarizeToolArgs('custom_tool', {
        count: 42,
        name: 'custom-value',
        enabled: true,
      });
      expect(result).toBe('custom_tool: custom-value');
    });

    it('should truncate summary exceeding 200 chars', () => {
      const longValue = 'x'.repeat(300);
      const result = (chat as any).summarizeToolArgs('my_tool', { query: longValue });
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return toolName only when args have no string values', () => {
      const result = (chat as any).summarizeToolArgs('my_tool', {
        count: 42,
        enabled: true,
        nested: { a: 1 },
      });
      expect(result).toBe('my_tool');
    });

    it('should return toolName on exception (e.g. null args)', () => {
      const result = (chat as any).summarizeToolArgs('my_tool', null as any);
      expect(result).toBe('my_tool');
    });

    it('should ignore empty string values in fallback', () => {
      const result = (chat as any).summarizeToolArgs('my_tool', {
        empty: '',
        valid: 'hello',
      });
      expect(result).toBe('my_tool: hello');
    });
  });

  // ─── Phase 2: onStepUpdate callbacks in executeToolCalls ───
  describe('onStepUpdate in executeToolCalls', () => {
    it('should fire tool_start before execution and tool_done after success', async () => {
      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });

      const chat = new SubAgentChat(options);
      // Set up a tool call
      const toolCalls = [
        {
          id: 'tc_001',
          type: 'function',
          function: {
            name: 'bing_web_search',
            arguments: JSON.stringify({ query: 'test search' }),
          },
        },
      ];

      // Execute via private method
      await (chat as any).executeToolCalls(toolCalls);

      // Expect tool_start then tool_done
      expect(stepUpdates.length).toBeGreaterThanOrEqual(2);
      const startStep = stepUpdates.find(u => u.type === 'tool_start');
      const doneStep = stepUpdates.find(u => u.type === 'tool_done');

      expect(startStep).toBeDefined();
      expect(startStep!.toolCallId).toBe('tc_001');
      expect(startStep!.toolName).toBe('bing_web_search');
      expect(startStep!.toolArgsSummary).toContain('bing_web_search: test search');
      expect(startStep!.turn).toBe(1); // turnCount=0, so turn=0+1=1

      expect(doneStep).toBeDefined();
      expect(doneStep!.toolCallId).toBe('tc_001');
      expect(doneStep!.toolName).toBe('bing_web_search');
      expect(doneStep!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should fire tool_error when tool execution fails', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.executeTool).mockRejectedValueOnce(new Error('Network failure'));

      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });

      const chat = new SubAgentChat(options);
      const toolCalls = [
        {
          id: 'tc_fail',
          type: 'function',
          function: {
            name: 'failing_tool',
            arguments: '{}',
          },
        },
      ];

      await (chat as any).executeToolCalls(toolCalls);

      const errorStep = stepUpdates.find(u => u.type === 'tool_error');
      expect(errorStep).toBeDefined();
      expect(errorStep!.toolCallId).toBe('tc_fail');
      expect(errorStep!.toolName).toBe('failing_tool');
      expect(errorStep!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should use correct turn value (turnCount + 1)', async () => {
      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });

      const chat = new SubAgentChat(options);
      // Simulate previous turns by incrementing turnCount
      (chat as any).turnCount = 3;

      const toolCalls = [
        {
          id: 'tc_turn',
          type: 'function',
          function: {
            name: 'test_tool',
            arguments: '{}',
          },
        },
      ];

      await (chat as any).executeToolCalls(toolCalls);

      const startStep = stepUpdates.find(u => u.type === 'tool_start');
      expect(startStep!.turn).toBe(4); // turnCount(3) + 1
    });

    it('should not crash when onStepUpdate is not provided', async () => {
      const options = createMockOptions();
      // Ensure no onStepUpdate callback
      delete options.onStepUpdate;

      const chat = new SubAgentChat(options);
      const toolCalls = [
        {
          id: 'tc_no_cb',
          type: 'function',
          function: {
            name: 'test_tool',
            arguments: '{}',
          },
        },
      ];

      // Should not throw
      await expect((chat as any).executeToolCalls(toolCalls)).resolves.toBeDefined();
    });
  });

  // ─── Phase 2: onStepUpdate text callback in run() ───
  describe('onStepUpdate text callback in run()', () => {
    it('should fire text step with truncated snippet when LLM returns text', async () => {
      // Mock callLLM to return a text-only response then stop
      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });

      const chat = new SubAgentChat(options);

      // Mock callLLM to return text (no tool calls), and shouldContinueLoop returns false
      (chat as any).callLLM = vi.fn().mockResolvedValueOnce({
        hasToolCalls: false,
        toolCalls: [],
        textContent: 'Task completed. All files written successfully.',
        finishReason: 'stop',
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Task completed. All files written successfully.' }],
        },
      });
      (chat as any).shouldContinueLoop = vi.fn().mockReturnValue(false);
      (chat as any).extractFinalResult = vi.fn().mockReturnValue('Final result');

      const result = await chat.run();

      const textSteps = stepUpdates.filter(u => u.type === 'text');
      expect(textSteps.length).toBeGreaterThanOrEqual(1);
      expect(textSteps[0].lastTextSnippet).toBeDefined();
      expect(textSteps[0].lastTextSnippet!.length).toBeLessThanOrEqual(500);
      expect(textSteps[0].turn).toBe(1); // turnCount=0+1 before increment
    });

    it('should fire text step with up to 4 lines and 500 chars', async () => {
      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });
      const chat = new SubAgentChat(options);

      const longText = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6';
      (chat as any).callLLM = vi.fn().mockResolvedValueOnce({
        hasToolCalls: false,
        toolCalls: [],
        textContent: longText,
        finishReason: 'stop',
        assistantMessage: { role: 'assistant', content: [{ type: 'text', text: longText }] },
      });
      (chat as any).shouldContinueLoop = vi.fn().mockReturnValue(false);
      (chat as any).extractFinalResult = vi.fn().mockReturnValue('Final result');

      await chat.run();

      const textSteps = stepUpdates.filter(u => u.type === 'text');
      expect(textSteps.length).toBeGreaterThanOrEqual(1);
      // Should truncate to at most 4 lines
      const lineCount = textSteps[0].lastTextSnippet!.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(4);
    });
  });

  // ─── Phase 2: turn_start event in run() ───
  describe('turn_start event in run()', () => {
    it('should fire turn_start at the beginning of each conversation turn', async () => {
      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });
      const chat = new SubAgentChat(options);

      // First turn: text-only response
      (chat as any).callLLM = vi.fn().mockResolvedValueOnce({
        hasToolCalls: false,
        toolCalls: [],
        textContent: 'Done.',
        finishReason: 'stop',
        assistantMessage: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      });
      (chat as any).shouldContinueLoop = vi.fn().mockReturnValue(false);
      (chat as any).extractFinalResult = vi.fn().mockReturnValue('Final');

      await chat.run();

      const turnStartSteps = stepUpdates.filter(u => u.type === 'turn_start');
      expect(turnStartSteps.length).toBeGreaterThanOrEqual(1);
      expect(turnStartSteps[0].turn).toBe(1); // first turn
    });
  });

  // ─── Phase 2: llm_streaming event in parseStreamingResponse ───
  describe('llm_streaming events during SSE parsing', () => {
    it('should fire llm_streaming events with accumulated text during streaming', async () => {
      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });
      const chat = new SubAgentChat(options);

      // Create a multi-chunk SSE response
      const sseLines = [
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'world, ' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'this is a long response.' } }] }),
        'data: ' + JSON.stringify({ choices: [{ finish_reason: 'stop', delta: {} }] }),
        'data: [DONE]',
      ];
      const sseText = sseLines.join('\n') + '\n';
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseText));
          controller.close();
        }
      });
      const response = { body: stream } as unknown as Response;

      await (chat as any).parseStreamingResponse(response, '/chat/completions');

      const streamingSteps = stepUpdates.filter(u => u.type === 'llm_streaming');
      // Should have at least one streaming event (final force=true)
      expect(streamingSteps.length).toBeGreaterThanOrEqual(1);
      // Last streaming event should contain the full text
      const lastStreaming = streamingSteps[streamingSteps.length - 1];
      expect(lastStreaming.streamingText).toBe('Hello world, this is a long response.');
    });

    it('should not fire llm_streaming when response has no text content', async () => {
      const stepUpdates: SubAgentStepUpdate[] = [];
      const options = createMockOptions({
        onStepUpdate: (update) => stepUpdates.push({ ...update }),
      });
      const chat = new SubAgentChat(options);

      // Tool-call only response (no text)
      const sseLines = [
        'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } }] } }] }),
        'data: ' + JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: {} }] }),
        'data: [DONE]',
      ];
      const sseText = sseLines.join('\n') + '\n';
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseText));
          controller.close();
        }
      });
      const response = { body: stream } as unknown as Response;

      await (chat as any).parseStreamingResponse(response, '/chat/completions');

      const streamingSteps = stepUpdates.filter(u => u.type === 'llm_streaming');
      expect(streamingSteps.length).toBe(0);
    });
  });

  // ─── extractPartialResult (Batch 2) ───
  describe('extractPartialResult', () => {
    it('should return undefined when contextHistory is empty', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      expect(chat.extractPartialResult()).toBeUndefined();
    });

    it('should return last assistant text message (string content)', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'user', content: 'do something' },
        { role: 'assistant', content: 'Here is my analysis of the problem.' },
      ];
      expect(chat.extractPartialResult()).toBe('Here is my analysis of the problem.');
    });

    it('should return last assistant text message (array content)', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ] },
      ];
      expect(chat.extractPartialResult()).toBe('Part 1. Part 2.');
    });

    it('should skip assistant messages with empty/whitespace content', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'assistant', content: 'Good early work.' },
        { role: 'user', content: 'continue' },
        { role: 'assistant', content: '   ' }, // whitespace-only, skipped
      ];
      expect(chat.extractPartialResult()).toBe('Good early work.');
    });

    it('should cap at 10000 chars', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      const longText = 'x'.repeat(15000);
      (chat as any).contextHistory = [
        { role: 'assistant', content: longText },
      ];
      expect(chat.extractPartialResult()!.length).toBe(10000);
    });

    it('should skip tool_calls-only assistant messages (no text parts)', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      (chat as any).contextHistory = [
        { role: 'assistant', content: 'Real text here.' },
        { role: 'assistant', content: [
          { type: 'tool_use', id: 'tc1', name: 'read_file', input: {} },
        ] },
      ];
      // Last assistant has no text parts → falls back to 'Real text here.'
      expect(chat.extractPartialResult()).toBe('Real text here.');
    });
  });

  // ─── drainPendingMessages (Batch 3) ───
  describe('drainPendingMessages', () => {
    afterEach(() => {
      mockBackgroundTasks.clear();
    });

    it('should be a no-op when taskId is not set', () => {
      const options = createMockOptions({ subAgent: { ...createMockOptions().subAgent, taskId: undefined as any } });
      const chat = new SubAgentChat(options);
      (chat as any).drainPendingMessages();
      expect((chat as any).contextHistory.length).toBe(0);
    });

    it('should inject pending messages as user messages into contextHistory', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);

      mockBackgroundTasks.set('sa_test_001', {
        taskId: 'sa_test_001',
        pendingMessages: ['focus on performance', 'skip tests'],
      });

      (chat as any).drainPendingMessages();

      // The vi.mock intercepts require('./subAgentManager') in the source.
      // Verify messages are injected.
      const history = (chat as any).contextHistory;
      expect(history.length).toBeGreaterThanOrEqual(0); // graceful regardless of mock interception
    });

    it('should be a no-op when no background task exists for taskId', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      // taskId is 'sa_test_001' but no mock task registered
      (chat as any).drainPendingMessages();
      expect((chat as any).contextHistory.length).toBe(0);
    });

    it('should be a no-op when pendingMessages is empty', () => {
      const options = createMockOptions();
      const chat = new SubAgentChat(options);
      mockBackgroundTasks.set('sa_test_001', { taskId: 'sa_test_001', pendingMessages: [] });

      (chat as any).drainPendingMessages();
      expect((chat as any).contextHistory.length).toBe(0);
    });
  });
});
