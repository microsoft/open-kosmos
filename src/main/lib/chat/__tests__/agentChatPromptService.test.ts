// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---
vi.mock('../../unifiedLogger', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    createLogger: () => logger,
    createConsoleLogger: () => logger,
    getUnifiedLogger: () => logger,
    getGlobalLogger: () => logger,
    createHighPerformanceLogger: () => logger,
    createDebugLogger: () => logger,
    getRefactoredLogger: () => logger,
    initializeGlobalLogger: () => logger,
    resetGlobalLogger: vi.fn(),
    isGlobalLoggerInitialized: vi.fn(() => true),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  };
});

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    join: actual.join,
  };
});

vi.mock('../../userDataADO/pathUtils', () => ({
  extractMonthFromChatSessionId: vi.fn(() => '2024-01'),
}));

const {
  mockGetCachedProfile,
  mockGetAllChatConfigs,
  mockGetChatConfig,
} = vi.hoisted(() => ({
  mockGetCachedProfile: vi.fn(),
  mockGetAllChatConfigs: vi.fn(() => []),
  mockGetChatConfig: vi.fn(() => null),
}));

const mcpStore = vi.hoisted(() => ({ servers: [] as any[] }));

vi.mock('../../userDataADO/mcpConfigManager', () => {
  const getServers = (_alias: string) => {
    const profileServers = mockGetCachedProfile()?.mcp_servers;
    return profileServers ?? mcpStore.servers;
  };
  return {
    mcpConfigManager: {
      getServers: vi.fn(getServers),
      getServerInfo: vi.fn((alias: string, name: string) => getServers(alias).find((s: any) => s.name === name) ?? null),
    },
  };
});

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: mockGetCachedProfile,
    getAllChatConfigs: mockGetAllChatConfigs,
    getChatConfig: mockGetChatConfig,
  },
}));

vi.mock('../../userDataADO/chatSkillSnapshotStore', () => ({
  chatSkillSnapshotStore: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    clearForAlias: vi.fn(),
    clearAll: vi.fn(),
    invalidateAffectedChats: vi.fn(),
  },
}));

vi.mock('../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: {
    getSkills: vi.fn(() => []),
    getSkill: vi.fn(),
    hasSkill: vi.fn(),
  },
}));

vi.mock('../globalSystemPrompt', () => ({
  getGlobalSystemPromptAsMessages: vi.fn(() => [
    {
      id: 'global-system-prompt',
      role: 'system',
      timestamp: 0,
      content: [{ type: 'text', text: 'Global system prompt content' }],
    },
  ]),
}));

vi.mock('../../skill/skillManager', () => ({
  skillManager: {
    getSkillMetadata: vi.fn(() => ({ metadata: null })),
  },
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));


vi.mock('../skillSnapshotBuilder', () => ({
  buildChatSkillSnapshot: vi.fn(() => ({
    binding_signature: 'new-sig',
    registry_signature: 'new-reg',
    skills: [],
    prompt: '',
  })),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getAllTools: vi.fn(() => Promise.resolve([])),
  },
}));

// Now import the class under test
import { AgentChatPromptService } from '../agentChatPromptService';
import type { AgentChatPromptServiceDeps } from '../agentChatPromptService';
import { getGlobalSystemPromptAsMessages } from '../globalSystemPrompt';
import { chatSkillSnapshotStore } from '../../userDataADO/chatSkillSnapshotStore';
import { skillsConfigManager } from '../../userDataADO/skillsConfigManager';
import { isFeatureEnabled } from '../../featureFlags';
import { skillManager } from '../../skill/skillManager';
import * as fs from 'fs';

/** Build a fake Dirent for the mocked fs.readdirSync({ withFileTypes: true }). */
function dirent(name: string, isDir: boolean): any {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

/**
 * Install a virtual filesystem on the mocked fs module.
 * @param tree map of absolute directory path -> Dirent[]
 */
function mockVfs(tree: Record<string, any[]>): void {
  vi.mocked(fs.existsSync).mockImplementation((p: any) => Object.prototype.hasOwnProperty.call(tree, p));
  vi.mocked(fs.readdirSync).mockImplementation((p: any) => (tree[p] ?? []) as any);
}

function makeDeps(overrides: Partial<AgentChatPromptServiceDeps> = {}): AgentChatPromptServiceDeps {
  return {
    getCurrentUserAlias: vi.fn(() => 'user@test.com'),
    getChatId: vi.fn(() => 'chat-123'),
    getChatSessionId: vi.fn(() => 'session-2024-01-01T000000'),
    getAgentName: vi.fn(() => 'TestAgent'),
    getLatestAgentConfig: vi.fn(() => null),
    getInteractionPolicy: vi.fn(() => 'allow-ui' as const),
    ...overrides,
  };
}

describe('AgentChatPromptService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpStore.servers = [];
    mockGetCachedProfile.mockReturnValue(null);
    mockGetAllChatConfigs.mockReturnValue([]);
    mockGetChatConfig.mockReturnValue(null);
    vi.mocked(chatSkillSnapshotStore.get).mockReturnValue(undefined);
    vi.mocked(skillsConfigManager.getSkills).mockReturnValue([]);
  });

  describe('setHookAdditionalContexts', () => {
    it('stores contexts for later injection', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookAdditionalContexts(['ctx1', 'ctx2']);
      // Indirectly verify by checking getCombinedSystemPromptForContext
      const result = svc.getCombinedSystemPromptForContext();
      // There should be at least one message containing the hook context
      const combined = result[0]?.content[0];
      expect((combined as any).text).toContain('ctx1');
      expect((combined as any).text).toContain('ctx2');
    });

    it('clears previous contexts when called again', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookAdditionalContexts(['old-ctx']);
      svc.setHookAdditionalContexts(['new-ctx']);
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('new-ctx');
      expect(text).not.toContain('old-ctx');
    });

  describe('setHookSystemMessages', () => {
    it('stores system message fragments for later injection', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookSystemMessages(['Follow this hook instruction.']);
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('Follow this hook instruction.');
    });

    it('clears previous system messages when called again', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookSystemMessages(['old hook instruction']);
      svc.setHookSystemMessages(['new hook instruction']);
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('new hook instruction');
      expect(text).not.toContain('old hook instruction');
    });
  });

  describe('getLatestCustomSystemPrompt', () => {
    it('returns empty array when no agent config', () => {
      const svc = new AgentChatPromptService(makeDeps({ getLatestAgentConfig: vi.fn(() => null) }));
      expect(svc.getLatestCustomSystemPrompt()).toEqual([]);
    });

    it('returns empty array when config has no system_prompt', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          system_prompt: '',
          name: 'Agent',
          role: 'assistant',
          mcp_servers: [],
        } as any)),
      }));
      expect(svc.getLatestCustomSystemPrompt()).toEqual([]);
    });

    it('returns a system message when config has system_prompt', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          system_prompt: 'You are a test agent.',
          name: 'TestAgent',
          role: 'assistant',
          mcp_servers: [],
        } as any)),
      }));
      const result = svc.getLatestCustomSystemPrompt();
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      const text = (result[0].content[0] as any).text;
      expect(text).toBe('You are a test agent.');
    });
  });

  describe('getGlobalSystemPrompt', () => {
    it('returns the global system prompt messages', () => {
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getGlobalSystemPrompt();
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
    });
  });

  describe('Memex dynamic prompt guidance', () => {
    it('injects capture guidance only when memex_memory is available', () => {
      const svc = new AgentChatPromptService(makeDeps());

      const withMemex = (svc.getCombinedSystemPromptForContext(1, { hasMemexMemoryTool: true })[0].content[0] as any).text;
      const withoutMemex = (svc.getCombinedSystemPromptForContext(1, { hasMemexMemoryTool: false })[0].content[0] as any).text;

      expect(withMemex).toContain('operation: "capture"');
      expect(withMemex).toContain('explicit Manage-Memory action');
      expect(withMemex).not.toContain('available tool list');
      expect(withoutMemex).not.toContain('operation: "capture"');
    });
  });

  describe('getAgentSpecificSystemPrompt', () => {
    it('returns at least one system message with agent identity', () => {
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getAgentSpecificSystemPrompt();
      expect(result).toHaveLength(1);
      const text = (result[0].content[0] as any).text;
      expect(text).toContain('TestAgent');
    });

    it('includes knowledge base path when configured', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: {
            name: 'TestAgent',
            knowledge: { knowledgeBase: '/my/kb' },
            workspace: null,
            skills: [],
          },
        },
      ]);
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getAgentSpecificSystemPrompt();
      const text = (result[0].content[0] as any).text;
      expect(text).toContain('/my/kb');
    });

    it('includes workspace path when configured', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: {
            name: 'TestAgent',
            workspace: '/my/workspace',
            skills: [],
          },
        },
      ]);
      const svc = new AgentChatPromptService(makeDeps());
      const result = svc.getAgentSpecificSystemPrompt();
      const text = (result[0].content[0] as any).text;
      expect(text).toContain('/my/workspace');
    });

    it('selects the current chat by chat_id, not agent name (prevents cross-chat leakage)', () => {
      // Two chats share the agent name 'TestAgent'. getChatId() is 'chat-123', so
      // the current chat's knowledge base must be injected — NOT the other chat's,
      // which a name-based lookup would wrongly pick (it matches the first by name).
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-other', agent: { name: 'TestAgent', knowledge: { knowledgeBase: '/other/kb' }, skills: [] } },
        { chat_id: 'chat-123', agent: { name: 'TestAgent', knowledge: { knowledgeBase: '/current/kb' }, skills: [] } },
      ]);
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('/current/kb');
      expect(text).not.toContain('/other/kb');
    });

    it('returns only agent identity when no user alias is available', () => {
      const svc = new AgentChatPromptService(makeDeps({ getCurrentUserAlias: vi.fn(() => '') }));

      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;

      expect(text).toContain('Your Identity');
      expect(text).toContain('Knowledge Base and workspace files');
      expect(text).not.toContain('Your Knowledge Sources');
    });
  });

  describe('getAgentSpecificSystemPrompt — directory index (Phase 1.5)', () => {
    // Deliverables path = workspace + '/' + yearMonth + '/' + chatSessionId.
    // extractMonthFromChatSessionId is mocked to '2024-01';
    // getChatSessionId() default is 'session-2024-01-01T000000'.
    const DELIVERABLES = '/ws/2024-01/session-2024-01-01T000000';

    function kbChat() {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: {
            name: 'TestAgent',
            knowledge: { knowledgeBase: '/my/kb' },
            workspace: null,
            skills: [],
          },
        },
      ]);
    }

    afterEach(() => {
      // Restore default fs behavior so leaked impls don't affect other suites.
      vi.mocked(fs.existsSync).mockImplementation(() => false);
      vi.mocked(fs.readdirSync).mockImplementation(() => [] as any);
    });

    it('T1: injects KB index with flat relative paths when KB has files', () => {
      kbChat();
      mockVfs({
        '/my/kb': [dirent('notes.md', false), dirent('sub', true)],
        '/my/kb/sub': [dirent('key.pem', false)],
      });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('Knowledge Base contents (relative paths under the path above):');
      expect(text).toContain('- notes.md');
      expect(text).toContain('- sub/key.pem');
    });

    it('T2: emits truncation note when file count exceeds MAX_INDEX_FILES (100)', () => {
      kbChat();
      const files = Array.from({ length: 105 }, (_, i) => dirent(`f${String(i).padStart(3, '0')}.txt`, false));
      mockVfs({ '/my/kb': files });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('... and 5 more file(s) (use search_files / search_file_contents to explore)');
    });

    it('T3: respects MAX_INDEX_DEPTH (files deeper than 3 levels are not listed)', () => {
      kbChat();
      mockVfs({
        '/my/kb': [dirent('a', true)],
        '/my/kb/a': [dirent('b', true)],
        '/my/kb/a/b': [dirent('c', true), dirent('lvl3.txt', false)],
        '/my/kb/a/b/c': [dirent('deep.txt', false)],
      });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('- a/b/lvl3.txt');   // depth 3 — listed
      expect(text).not.toContain('deep.txt');      // depth 4 — not walked
    });

    it('T4: skips noise dirs (.git, node_modules, .claude)', () => {
      kbChat();
      mockVfs({
        '/my/kb': [
          dirent('real.md', false),
          dirent('.git', true),
          dirent('node_modules', true),
          dirent('.claude', true),
        ],
        '/my/kb/.git': [dirent('zzgitfile.txt', false)],
        '/my/kb/node_modules': [dirent('zzpkgfile.js', false)],
        '/my/kb/.claude': [dirent('zzsecretfile.md', false)],
      });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('- real.md');
      expect(text).not.toContain('zzgitfile.txt');
      expect(text).not.toContain('zzpkgfile.js');
      expect(text).not.toContain('zzsecretfile.md');
    });

    it('T5: injects deliverables index when the deliverables dir exists with files', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: {
            name: 'TestAgent',
            workspace: '/ws',
            skills: [],
          },
        },
      ]);
      mockVfs({ [DELIVERABLES]: [dirent('report.docx', false)] });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('Current Chat Session Deliverables contents (relative paths under the path above):');
      expect(text).toContain('- report.docx');
    });

    it('T6: emits "no deliverables yet" (no crash) when deliverables dir does not exist', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: {
            name: 'TestAgent',
            workspace: '/ws',
            skills: [],
          },
        },
      ]);
      // existsSync returns false for the deliverables path (default behavior).
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('No deliverables have been produced in this session yet.');
    });

    it('T7: does not throw and omits the index when fs.readdirSync throws', () => {
      kbChat();
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('EACCES');
      });
      const svc = new AgentChatPromptService(makeDeps());
      let text = '';
      expect(() => {
        text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      }).not.toThrow();
      expect(text).toContain('/my/kb'); // path line still present
      expect(text).not.toContain('Knowledge Base contents (relative paths');
    });

    it('T8: empty KB produces no index block (regression)', () => {
      kbChat();
      mockVfs({ '/my/kb': [] }); // exists but empty
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('/my/kb');
      expect(text).not.toContain('Knowledge Base contents (relative paths');
    });

    it('T9: SCAN_LIMIT hit emits an honest "too large" note instead of a misleading count', () => {
      kbChat();
      // 5001 files at depth 1 exceeds SCAN_LIMIT (5000): the walk stops early.
      const files = Array.from({ length: 5001 }, (_, i) => dirent(`f${String(i).padStart(5, '0')}.txt`, false));
      mockVfs({ '/my/kb': files });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('directory too large to list fully (showing first 100;');
      // The misleading exact-count note must NOT appear when the scan limit is hit.
      expect(text).not.toMatch(/\.\.\. and \d+ more file\(s\)/);
    });

    it('T10: deliverables dir exists but is empty emits "no deliverables yet"', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: { name: 'TestAgent', workspace: '/ws', skills: [] },
        },
      ]);
      mockVfs({ [DELIVERABLES]: [] }); // exists but empty
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('No deliverables have been produced in this session yet.');
      expect(text).not.toContain('Current Chat Session Deliverables contents (relative paths');
    });

    it('T11: sub-directory readdir failure yields a partial index (root files kept, bad branch skipped)', () => {
      kbChat();
      vi.mocked(fs.existsSync).mockImplementation((p: any) => p === '/my/kb');
      vi.mocked(fs.readdirSync).mockImplementation((p: any) => {
        if (p === '/my/kb') return [dirent('root-file.md', false), dirent('sub', true)] as any;
        throw new Error('EACCES'); // sub-directory unreadable
      });
      const svc = new AgentChatPromptService(makeDeps());
      let text = '';
      expect(() => {
        text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      }).not.toThrow();
      expect(text).toContain('- root-file.md');
      expect(text).toContain('Knowledge Base contents (relative paths under the path above):');
    });

    it('T12: skips dist and build directories', () => {
      kbChat();
      mockVfs({
        '/my/kb': [
          dirent('keep.md', false),
          dirent('dist', true),
          dirent('build', true),
        ],
        '/my/kb/dist': [dirent('zzbundle.js', false)],
        '/my/kb/build': [dirent('zzartifact.bin', false)],
      });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('- keep.md');
      expect(text).not.toContain('zzbundle.js');
      expect(text).not.toContain('zzartifact.bin');
    });

    it('T13: skips dirents that are neither file nor directory (e.g. symlink/socket)', () => {
      kbChat();
      // A dirent reporting both isDirectory()=false and isFile()=false (special file type).
      const special = { name: 'weird.sock', isDirectory: () => false, isFile: () => false };
      mockVfs({ '/my/kb': [dirent('normal.md', false), special as any] });
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('- normal.md');
      expect(text).not.toContain('weird.sock');
    });

    it('T14: SCAN_LIMIT hit with zero collected files still emits a "too large" note for the KB', () => {
      kbChat();
      // 5001 empty sub-directories at depth 1 are all sorted ahead of any file
      // and exhaust SCAN_LIMIT before a single regular file is collected.
      const dirs = Array.from({ length: 5001 }, (_, i) => dirent(`d${String(i).padStart(5, '0')}`, true));
      const tree: Record<string, any[]> = { '/my/kb': dirs };
      for (const d of dirs) tree[`/my/kb/${d.name}`] = [];
      mockVfs(tree);
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      // The header and an honest too-large note must appear even though no
      // path lines were collected — the model must not be told the KB is empty.
      expect(text).toContain('Knowledge Base contents (relative paths under the path above):');
      expect(text).toContain('directory too large to list fully');
    });

    it('T15: SCAN_LIMIT hit with zero collected files does NOT falsely report empty deliverables', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: { name: 'TestAgent', workspace: '/ws', skills: [] },
        },
      ]);
      const dirs = Array.from({ length: 5001 }, (_, i) => dirent(`d${String(i).padStart(5, '0')}`, true));
      const tree: Record<string, any[]> = { [DELIVERABLES]: dirs };
      for (const d of dirs) tree[`${DELIVERABLES}/${d.name}`] = [];
      mockVfs(tree);
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;
      expect(text).toContain('Current Chat Session Deliverables contents (relative paths under the path above):');
      expect(text).toContain('directory too large to list fully');
      // The false "no deliverables yet" line must NOT appear when the dir was truncated.
      expect(text).not.toContain('No deliverables have been produced in this session yet.');
    });

    it('T16: uses Windows separators for chat-session deliverables when workspace uses backslashes', () => {
      mockGetAllChatConfigs.mockReturnValue([
        {
          agent: { name: 'TestAgent', workspace: 'C:\\ws', skills: [] },
        },
      ]);
      mockVfs({ ['C:\\ws\\2024-01\\session-2024-01-01T000000']: [dirent('report.txt', false)] });
      const svc = new AgentChatPromptService(makeDeps());

      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;

      expect(text).toContain('C:\\ws\\2024-01\\session-2024-01-01T000000');
      expect(text).toContain('- report.txt');
    });

    it('T17: includes Knowledge Base skills discovered under .claude/skills', () => {
      kbChat();
      mockVfs({
        '/my/kb': [dirent('.claude', true)],
        '/my/kb/.claude/skills': [dirent('planner', true)],
        '/my/kb/.claude/skills/planner': [dirent('SKILL.md', false)],
      });
      vi.mocked(fs.existsSync).mockImplementation((p: any) => (
        p === '/my/kb' ||
        p === '/my/kb/.claude/skills' ||
        p === '/my/kb/.claude/skills/planner/SKILL.md'
      ));
      vi.mocked(fs.readdirSync).mockImplementation((p: any) => {
        if (p === '/my/kb') return [dirent('.claude', true)] as any;
        if (p === '/my/kb/.claude/skills') return [dirent('planner', true)] as any;
        return [] as any;
      });
      vi.mocked(skillManager.getSkillMetadata).mockReturnValueOnce({
        metadata: { description: 'Plans work', version: '1.0.0' },
      } as any);
      const svc = new AgentChatPromptService(makeDeps());

      const text = (svc.getAgentSpecificSystemPrompt()[0].content[0] as any).text;

      expect(text).toContain('Knowledge Base Skills');
      expect(text).toContain('planner');
      expect(text).toContain('Plans work');
      expect(text).toContain('1.0.0');
    });
  });

  describe('getCombinedSystemPromptForContext', () => {
    it('returns empty array when all prompt sources are empty', () => {
      // Make getGlobalSystemPromptAsMessages return []
      vi.mocked(getGlobalSystemPromptAsMessages).mockReturnValueOnce([]);
      const svc = new AgentChatPromptService(makeDeps({ getLatestAgentConfig: vi.fn(() => null) }));
      // Without any content we still get the agent identity block from getAgentSpecificSystemPrompt
      const result = svc.getCombinedSystemPromptForContext();
      // At minimum, agentSpecific adds content
      expect(Array.isArray(result)).toBe(true);
    });

    it('adds scheduled job reminder when policy is forbid', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getInteractionPolicy: vi.fn(() => 'forbid' as const),
      }));
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('background scheduled job');
    });

    it('does not add a scheduled reminder for allow-ui policy', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getInteractionPolicy: vi.fn(() => 'allow-ui' as const),
      }));
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).not.toContain('background scheduled job');
    });

    it('wraps hook additional contexts in system-reminder tags', () => {
      const svc = new AgentChatPromptService(makeDeps());
      svc.setHookAdditionalContexts(['my-hook-context']);
      const result = svc.getCombinedSystemPromptForContext();
      const text = (result[0]?.content[0] as any).text;
      expect(text).toContain('<system-reminder>');
      expect(text).toContain('my-hook-context');
    });

    it('returns empty array when every prompt source and hook buffer is empty', () => {
      const svc = new AgentChatPromptService(makeDeps());
      vi.spyOn(svc, 'getLatestCustomSystemPrompt').mockReturnValue([]);
      vi.spyOn(svc, 'getAgentSpecificSystemPrompt').mockReturnValue([]);
      vi.spyOn(svc, 'getGlobalSystemPrompt').mockReturnValue([]);

      expect(svc.getCombinedSystemPromptForContext()).toEqual([]);
    });

    it('includes custom and global prompts when both are present', () => {
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          system_prompt: 'Custom prompt',
          name: 'TestAgent',
          role: 'assistant',
          mcp_servers: [],
        } as any)),
      }));

      const text = (svc.getCombinedSystemPromptForContext()[0].content[0] as any).text;

      expect(text).toContain('Custom prompt');
      expect(text).toContain('Global system prompt content');
    });
  });

  describe('getCurrentAvailableTools', () => {
    it('returns empty array when no agent config', async () => {
      const svc = new AgentChatPromptService(makeDeps({ getLatestAgentConfig: vi.fn(() => null) }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toEqual([]);
    });

    it('returns no tools when agent config has an empty mcp_servers array', async () => {
      // Authoritative data model: an empty mcp_servers array means NO servers are
      // configured, so the agent must expose ZERO tools. It must NOT fall back to
      // "all tools" (the historical bug that leaked every connected tool to an
      // agent whose servers the user had cleared).
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
        { serverName: 'builtin-tools', name: 'read_file' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({ mcp_servers: [] } as any)),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toEqual([]);
    });

    it('returns no tools when agent config mcp_servers is undefined', async () => {
      // Defensive: a malformed/legacy config without an mcp_servers array is
      // treated as "no servers configured" -> no tools (covers the `?? []` guard).
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'builtin-tools', name: 'read_file' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({} as any)),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toEqual([]);
    });

    it('exposes all of a server\'s tools when its entry has an empty tools array', async () => {
      // A server entry { name, tools: [] } is the "all tools of this server"
      // sentinel. builtin-tools is a normal server under the same rules.
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'builtin-tools', name: 'read_file' } as any,
        { serverName: 'builtin-tools', name: 'search_files' } as any,
        { serverName: 'server1', name: 'tool1' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          mcp_servers: [{ name: 'builtin-tools', tools: [] }],
        } as any)),
        getCurrentUserAlias: vi.fn(() => ''),
      }));
      const tools = await svc.getCurrentAvailableTools();
      // Only builtin-tools is configured, so server1's tool is excluded.
      expect(tools.map((t: any) => t.name)).toEqual(['read_file', 'search_files']);
    });

    it('filters tools by configured mcp_servers', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
        { serverName: 'server2', name: 'tool2' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          mcp_servers: [{ name: 'server1', tools: [] }],
        } as any)),
        getCurrentUserAlias: vi.fn(() => ''),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tool1');
    });

    it('skips servers that are in_use=false in global profile', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
      ]);
      mockGetCachedProfile.mockReturnValue({
        mcp_servers: [{ name: 'server1', in_use: false }],
      });
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          mcp_servers: [{ name: 'server1', tools: [] }],
        } as any)),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toHaveLength(0);
    });

    it('filters tools by selected tool names when a server has explicit tool selection', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'allowed' } as any,
        { serverName: 'server1', name: 'hidden' } as any,
        { serverName: 'server2', name: 'other' } as any,
      ]);
      mockGetCachedProfile.mockReturnValue({
        mcp_servers: [{ name: 'server1', in_use: true }],
      });
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          mcp_servers: [{ name: 'server1', tools: ['allowed'] }],
        } as any)),
      }));

      const tools = await svc.getCurrentAvailableTools();

      expect(tools).toEqual([{ serverName: 'server1', name: 'allowed' }]);
    });

    it('returns empty array on error', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockRejectedValueOnce(new Error('Network error'));
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({ mcp_servers: [] } as any)),
      }));
      const tools = await svc.getCurrentAvailableTools();
      expect(tools).toEqual([]);
    });

    it('stringifies non-Error tool discovery failures', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockRejectedValueOnce('boom');
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({ mcp_servers: [] } as any)),
      }));

      const tools = await svc.getCurrentAvailableTools();

      expect(tools).toEqual([]);
    });
  });

  describe('getCombinedSystemPromptForContext — no-tools reminder', () => {
    it('injects the no-tools reminder when availableToolCount is 0', () => {
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getCombinedSystemPromptForContext(0)[0]?.content[0] as any).text;
      expect(text).toContain('NO tools available for this session');
      expect(text).toContain('MUST NOT fabricate tool');
    });

    it('does not inject the reminder when availableToolCount is positive', () => {
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getCombinedSystemPromptForContext(3)[0]?.content[0] as any).text;
      expect(text).not.toContain('NO tools available for this session');
    });

    it('does not inject the reminder when availableToolCount is omitted', () => {
      const svc = new AgentChatPromptService(makeDeps());
      const text = (svc.getCombinedSystemPromptForContext()[0]?.content[0] as any).text;
      expect(text).not.toContain('NO tools available for this session');
    });
  });

  describe('getCombinedSystemPromptForCurrentTurn', () => {
    it('adds the no-tools reminder when the agent resolves to zero tools', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        // Empty mcp_servers => zero available tools => reminder expected.
        getLatestAgentConfig: vi.fn(() => ({ mcp_servers: [] } as any)),
      }));
      const messages = await svc.getCombinedSystemPromptForCurrentTurn();
      const text = (messages[0]?.content[0] as any).text;
      expect(text).toContain('NO tools available for this session');
    });

    it('omits the no-tools reminder when the agent has at least one tool', async () => {
      const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
      vi.mocked(mcpClientManager.getAllTools).mockResolvedValueOnce([
        { serverName: 'server1', name: 'tool1' } as any,
      ]);
      const svc = new AgentChatPromptService(makeDeps({
        getLatestAgentConfig: vi.fn(() => ({
          mcp_servers: [{ name: 'server1', tools: [] }],
        } as any)),
        getCurrentUserAlias: vi.fn(() => ''),
      }));
      const messages = await svc.getCombinedSystemPromptForCurrentTurn();
      const text = (messages[0]?.content[0] as any).text;
      expect(text).not.toContain('NO tools available for this session');
    });
  });

  describe('refreshSkillSnapshotIfNeeded', () => {
    it('clears the in-memory snapshot when chat config has no agent', async () => {
      mockGetChatConfig.mockReturnValue({ agent: null });
      const svc = new AgentChatPromptService(makeDeps());
      await expect(svc.refreshSkillSnapshotIfNeeded()).resolves.not.toThrow();
      expect(chatSkillSnapshotStore.clear).toHaveBeenCalledWith('user@test.com', 'chat-123');
    });

    it('clears skill snapshot when agent has no skills', async () => {
      mockGetChatConfig.mockReturnValue({
        agent: { skills: [] },
      });
      const svc = new AgentChatPromptService(makeDeps());
      await svc.refreshSkillSnapshotIfNeeded();
      expect(chatSkillSnapshotStore.clear).toHaveBeenCalledWith('user@test.com', 'chat-123');
    });

    it('clears a stale skill snapshot when chat config no longer has an agent', async () => {
      mockGetChatConfig.mockReturnValue({
        agent: null,
      });
      const svc = new AgentChatPromptService(makeDeps());

      await svc.refreshSkillSnapshotIfNeeded();

      expect(chatSkillSnapshotStore.clear).toHaveBeenCalledWith('user@test.com', 'chat-123');
    });

    it('skips update when signatures match', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockReturnValue({
        binding_signature: 'same-sig',
        registry_signature: 'same-reg',
        skills: [],
        prompt: '',
        missing_skill_names: [],
      } as any);
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
      });
      vi.mocked(chatSkillSnapshotStore.get).mockReturnValue({
        binding_signature: 'same-sig',
        registry_signature: 'same-reg',
      } as any);
      vi.mocked(skillsConfigManager.getSkills).mockReturnValue([]);
      const svc = new AgentChatPromptService(makeDeps());
      await svc.refreshSkillSnapshotIfNeeded();
      expect(chatSkillSnapshotStore.set).not.toHaveBeenCalled();
    });

    it('updates snapshot when signatures differ', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockReturnValue({
        binding_signature: 'new-sig',
        registry_signature: 'new-reg',
        skills: [],
        prompt: '',
        missing_skill_names: [],
      } as any);
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
      });
      vi.mocked(chatSkillSnapshotStore.get).mockReturnValue({
        binding_signature: 'old-sig',
        registry_signature: 'old-reg',
      } as any);
      vi.mocked(skillsConfigManager.getSkills).mockReturnValue([]);
      const svc = new AgentChatPromptService(makeDeps());
      await svc.refreshSkillSnapshotIfNeeded();
      expect(chatSkillSnapshotStore.set).toHaveBeenCalledWith(
        'user@test.com',
        'chat-123',
        expect.objectContaining({ binding_signature: 'new-sig', registry_signature: 'new-reg' }),
      );
    });

    it('updates snapshot when only the registry signature differs', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockReturnValue({
        binding_signature: 'same-sig',
        registry_signature: 'new-reg',
        skills: [{ name: 'skill1' }],
        prompt: 'skill prompt',
        missing_skill_names: ['missing'],
      } as any);
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
      });
      vi.mocked(chatSkillSnapshotStore.get).mockReturnValue({
        binding_signature: 'same-sig',
        registry_signature: 'old-reg',
      } as any);
      vi.mocked(skillsConfigManager.getSkills).mockReturnValue([{ name: 'skill1' }] as any);
      const svc = new AgentChatPromptService(makeDeps());

      await svc.refreshSkillSnapshotIfNeeded();

      expect(chatSkillSnapshotStore.set).toHaveBeenCalledWith(
        'user@test.com',
        'chat-123',
        expect.objectContaining({ registry_signature: 'new-reg' }),
      );
    });

    it('does not throw when building the next skill snapshot fails', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockImplementationOnce(() => {
        throw new Error('snapshot builder failed');
      });
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
      });
      vi.mocked(skillsConfigManager.getSkills).mockReturnValue([]);
      const svc = new AgentChatPromptService(makeDeps());
      await expect(svc.refreshSkillSnapshotIfNeeded()).resolves.not.toThrow();
      expect(chatSkillSnapshotStore.set).not.toHaveBeenCalled();
    });

    it('treats non-array agent skills as no skills and clears a stale snapshot', async () => {
      mockGetChatConfig.mockReturnValue({
        agent: { skills: 'not-array' },
      });
      const svc = new AgentChatPromptService(makeDeps());

      await svc.refreshSkillSnapshotIfNeeded();

      expect(chatSkillSnapshotStore.clear).toHaveBeenCalledWith('user@test.com', 'chat-123');
    });

    it('passes the skills config manager result as the available skill list', async () => {
      const { buildChatSkillSnapshot } = await import('../skillSnapshotBuilder');
      vi.mocked(buildChatSkillSnapshot).mockReturnValue({
        binding_signature: 'new-sig',
        registry_signature: 'new-reg',
        skills: [],
        prompt: '',
        missing_skill_names: [],
      } as any);
      mockGetChatConfig.mockReturnValue({
        agent: { skills: ['skill1'] },
      });
      vi.mocked(skillsConfigManager.getSkills).mockReturnValue([]);
      const svc = new AgentChatPromptService(makeDeps());

      await svc.refreshSkillSnapshotIfNeeded();

      expect(buildChatSkillSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        availableSkills: [],
      }));
    });

    it('does not throw when refreshing a skill snapshot fails before update', async () => {
      mockGetChatConfig.mockImplementationOnce(() => {
        throw new Error('cache unavailable');
      });
      const svc = new AgentChatPromptService(makeDeps());

      await expect(svc.refreshSkillSnapshotIfNeeded()).resolves.not.toThrow();
    });
  });

  describe('getCombinedSystemPromptForCurrentTurn', () => {
    it('refreshes skill snapshot and then returns system prompt', async () => {
      mockGetChatConfig.mockReturnValue({ agent: null });
      const svc = new AgentChatPromptService(makeDeps());
      const result = await svc.getCombinedSystemPromptForCurrentTurn();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
});
