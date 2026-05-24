/**
 * subAgentChat.coverage3.test.ts
 *
 * Targets remaining uncovered branches in subAgentChat.ts:
 * - looksLikeIntentNotResult: patterns that match vs. short text
 * - getDeliverablesPath: deliverablesPath provided vs workspace fallback vs null
 * - buildWorkspaceAndSkillsInfo: workspace + skills + knowledge base
 * - truncateToLines: within-limit case with extra lines (appends ...)
 * - getElectronApp: electron throw path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

vi.mock('../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: vi.fn(() => ({
      getCurrentAuth: vi.fn().mockResolvedValue({
        ghcAuth: { copilotTokens: { token: 'mock-token' } },
      }),
    })),
  },
}));

vi.mock('../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://mock.api',
    USER_AGENT: 'mock',
    EDITOR_VERSION: '1.0',
    EDITOR_PLUGIN_VERSION: '1.0',
  },
}));

const { mockCallModel } = vi.hoisted(() => ({
  mockCallModel: vi.fn().mockResolvedValue('Summary'),
}));

vi.mock('../../llm/ghcModelApi', () => ({
  getEndpointForModel: vi.fn(() => '/chat/completions'),
  ghcModelApi: { callModel: mockCallModel },
}));

vi.mock('../../llm/ghcModelsManager', () => ({
  getModelCapabilities: vi.fn(() => ({ maxContextLength: 128000 })),
  buildMaxTokensParam: vi.fn(() => ({ max_tokens: 4096 })),
}));

vi.mock('../../chat/agentChatUtilities', () => ({
  normalizeToolCalls: vi.fn((calls: any) => calls),
}));

vi.mock('../../chat/systemReminderUtils', () => ({
  wrapInSystemReminder: vi.fn((text: string) => `[SYS]${text}[/SYS]`),
}));

vi.mock('../../skill/skillManager', () => ({
  skillManager: { getSkillMetadata: vi.fn(() => ({ metadata: { description: 'A test skill' } })) },
}));

vi.mock('../../token/TokenCounter', () => ({
  TokenCounter: vi.fn(function () {
    return { countTextTokens: vi.fn((text: string) => Math.ceil((text || '').length / 4)) };
  }),
}));

vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    setExecutionContext: vi.fn(),
    clearExecutionContext: vi.fn(),
    clearDeferredToolsContext: vi.fn(),
  },
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getToolsForSubAgent: vi.fn(() => []),
    executeTool: vi.fn().mockResolvedValue('tool result'),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { SubAgentChat, truncateToLines } from '../subAgentChat';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOptions(overrides: any = {}): any {
  return {
    task: 'test task',
    subAgent: {
      inheritedModel: 'gpt-4o',
      config: {
        name: 'test-agent',
        display_name: 'Test Agent',
        system_prompt: 'You are helpful.',
        mcp_servers: [],
        builtin_tools: [],
        disallow_builtin_tools: [],
        workspace: null,
        skills: [],
      },
      resolvedMcpServers: [],
      resolvedSkills: [],
      resolvedKnowledgeBase: null,
      parentSessionId: 'sess-1',
      parentChatId: 'chat-1',
      userAlias: 'testuser',
    },
    cancellationToken: {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onStepUpdate: vi.fn(),
    onTurnComplete: vi.fn(),
    currentUserAlias: 'testuser',
    deliverablesPath: null,
    ...overrides,
  };
}

// ─── truncateToLines edge cases ───────────────────────────────────────────────

describe('truncateToLines — additional branches', () => {
  it('appends ... when there are more lines than maxLines (within char limit)', () => {
    const text = 'line1\nline2\nline3\nline4\nline5';
    const result = truncateToLines(text, 2, 1000);
    // Lines sliced to 2, but there were 5 → appends '...'
    expect(result).toContain('...');
    expect(result).toContain('line1');
    expect(result).toContain('line2');
    expect(result).not.toContain('line3');
  });

  it('returns text within both limits unchanged', () => {
    const result = truncateToLines('hello world', 5, 100);
    expect(result).toBe('hello world');
  });

  it('filters blank lines before truncating', () => {
    const text = '  \nfoo\n  \nbar\n  ';
    const result = truncateToLines(text, 10, 1000);
    expect(result).not.toContain('  ');
    expect(result).toContain('foo');
    expect(result).toContain('bar');
  });
});

// ─── looksLikeIntentNotResult ─────────────────────────────────────────────────

describe('SubAgentChat — looksLikeIntentNotResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for short text (< 10 chars)', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('short')).toBe(false);
  });

  it('returns false for empty string', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('')).toBe(false);
  });

  it('returns true for text matching "let me" pattern', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('Let me search for the information you need.')).toBe(true);
  });

  it('returns true for text matching "I will" pattern', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('I will gather the data from the API.')).toBe(true);
  });

  it('returns true for text matching "step 1" pattern', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('step 1: analyze the data and find patterns')).toBe(true);
  });

  it('returns true for text matching "here\'s my plan" pattern', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult("here's my plan for completing the task efficiently")).toBe(true);
  });

  it('returns false for text that has no intent patterns', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('The analysis shows that revenue grew by 15% in Q3.')).toBe(false);
  });

  it('returns true for text matching "my approach" pattern', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('my approach to this problem involves three phases')).toBe(true);
  });

  it('returns true for "I need to" pattern', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).looksLikeIntentNotResult('I need to check the configuration files first')).toBe(true);
  });
});

// ─── getDeliverablesPath ──────────────────────────────────────────────────────

describe('SubAgentChat — getDeliverablesPath', () => {
  it('returns deliverablesPath when set', () => {
    const chat = new SubAgentChat(makeOptions({ deliverablesPath: '/custom/deliverables' }));
    expect((chat as any).getDeliverablesPath()).toBe('/custom/deliverables');
  });

  it('returns null when deliverablesPath is null (no workspace fallback)', () => {
    const chat = new SubAgentChat(makeOptions({
      deliverablesPath: null,
      subAgent: {
        inheritedModel: 'gpt-4o',
        config: {
          name: 'test-agent',
          display_name: 'Test Agent',
          system_prompt: '',
          mcp_servers: [],
          builtin_tools: [],
          disallow_builtin_tools: [],
          workspace: '/agent/workspace',
          skills: [],
        },
        resolvedMcpServers: [],
        resolvedSkills: [],
        resolvedKnowledgeBase: null,
        parentSessionId: 'sess-1',
        parentChatId: 'chat-1',
        userAlias: 'testuser',
      },
    }));
    // getDeliverablesPath no longer falls back to workspace; returns null
    expect((chat as any).getDeliverablesPath()).toBeNull();
  });

  it('returns null when both deliverablesPath and workspace are null', () => {
    const chat = new SubAgentChat(makeOptions({ deliverablesPath: null }));
    expect((chat as any).getDeliverablesPath()).toBeNull();
  });
});

// ─── buildWorkspaceAndSkillsInfo ─────────────────────────────────────────────

describe('SubAgentChat — buildWorkspaceAndSkillsInfo', () => {
  it('includes knowledge base and skills when configured', () => {
    const config = {
      name: 'test-agent',
      display_name: 'Test Agent',
      system_prompt: '',
      mcp_servers: [],
      builtin_tools: [],
      disallow_builtin_tools: [],
      workspace: '/my/workspace',
      skills: ['my-skill'],
    };
    const chat = new SubAgentChat(makeOptions({
      subAgent: {
        inheritedModel: 'gpt-4o',
        config,
        resolvedMcpServers: [],
        resolvedSkills: [{ name: 'my-skill', inherited: false }],
        resolvedKnowledgeBase: '/my/knowledge',
        parentSessionId: 'sess-1',
        parentChatId: 'chat-1',
        userAlias: 'testuser',
      },
    }));
    const result = (chat as any).buildWorkspaceAndSkillsInfo(config);
    // workspace is no longer shown in buildWorkspaceAndSkillsInfo (derived from deliverablesPath instead)
    expect(result).toContain('## Knowledge Base');
    expect(result).toContain('/my/knowledge');
  });

  it('includes inherited tag for inherited skills', () => {
    const config = {
      name: 'test-agent',
      display_name: '',
      system_prompt: '',
      mcp_servers: [],
      builtin_tools: [],
      disallow_builtin_tools: [],
      workspace: null,
      skills: [],
    };
    const chat = new SubAgentChat(makeOptions({
      subAgent: {
        inheritedModel: 'gpt-4o',
        config,
        resolvedMcpServers: [],
        resolvedSkills: [{ name: 'inherited-skill', inherited: true }],
        resolvedKnowledgeBase: null,
        parentSessionId: 'sess-1',
        parentChatId: 'chat-1',
        userAlias: 'testuser',
      },
    }));
    const result = (chat as any).buildWorkspaceAndSkillsInfo(config);
    expect(result).toContain('inherited from parent');
  });

  it('returns empty string when no workspace, skills, or knowledge base', () => {
    const config = {
      name: 'test-agent',
      display_name: '',
      system_prompt: '',
      mcp_servers: [],
      builtin_tools: [],
      disallow_builtin_tools: [],
      workspace: null,
      skills: [],
    };
    const chat = new SubAgentChat(makeOptions());
    const result = (chat as any).buildWorkspaceAndSkillsInfo(config);
    expect(result).toBe('');
  });
});

// ─── getElectronApp ───────────────────────────────────────────────────────────
// getElectronApp() was moved to subAgentPromptBuilder.ts and is no longer on SubAgentChat.

describe('SubAgentChat — getElectronApp', () => {
  it('getElectronApp no longer exists directly on SubAgentChat', () => {
    const chat = new SubAgentChat(makeOptions());
    expect((chat as any).getElectronApp).toBeUndefined();
  });
});
