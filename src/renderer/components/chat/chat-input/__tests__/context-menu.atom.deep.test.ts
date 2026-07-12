// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Supplementary tests for context-menu.atom.ts — covers branches missed by
 * the existing context-menu.atom.test.ts.
 *
 * Gaps targeted:
 *  - selectMenu: KnowledgeBase option with no value → expand KB file list
 *    (no KB path, empty results, error, happy path)
 *  - selectMenu: KnowledgeBase expand then ChatSession expand branches
 *    (no workspace, no session ID, bad session ID, empty results, error, happy)
 *  - triggerMenu @ with search query: KB + ChatSession search, no results
 *  - triggerMenu skills: filterSkillsByQuery returns partial results (non-empty query)
 *  - triggerMenu skills: filterSkillsByQuery returns empty WITH empty query
 *  - triggerMenu: skill trigger error path
 *  - triggerMenu: @ trigger error path
 *  - navigateMenu: wrap-around with real options populated
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextMenuOptionType, ContextMenuTriggerType } from '@/lib/chat/contextMentions';

// ── module mocks ──────────────────────────────────────────────────────────────

const mockFilterSkillsByQuery = vi.fn();
const mockGetDefaultMenuOptions = vi.fn();
const mockSearchWorkspaceFiles = vi.fn();
const mockGetCurrentChatSessionId = vi.fn();
const mockGetCurrentChat = vi.fn();
const mockGetCurrentAgentSkills = vi.fn();

vi.mock('@/lib/chat/contextMentions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chat/contextMentions')>();
  return {
    ...actual,
    filterSkillsByQuery: (...args: any[]) => mockFilterSkillsByQuery(...args),
    getDefaultMenuOptions: () => mockGetDefaultMenuOptions(),
  };
});

vi.mock('@/lib/workspace/workspaceSearchService', () => ({
  searchWorkspaceFiles: (...args: any[]) => mockSearchWorkspaceFiles(...args),
}));

vi.mock('@/lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatSessionId: (...args: any[]) => mockGetCurrentChatSessionId(...args),
  },
}));

vi.mock('@/lib/userData', () => ({
  profileDataManager: {
    getCurrentChat: (...args: any[]) => mockGetCurrentChat(...args),
    getCurrentAgentSkills: (...args: any[]) => mockGetCurrentAgentSkills(...args),
  },
}));

// ── import atom AFTER mocks ───────────────────────────────────────────────────

import { ContextMenuAtom, zeroContextMenuState, resolveChatSessionFolder } from '../context-menu.atom';

// ── store builder ─────────────────────────────────────────────────────────────

function buildStore() {
  const map: Record<string, any> = {};
  function query(atom: any): any {
    const key: string = atom.key;
    if (map[key]) return map[key];
    const ownSymbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(atom));
    const uniqSym = ownSymbols.find((s) => s.toString().includes('BUILD'));
    if (!uniqSym) throw new Error('Cannot find UNIQ symbol on atom');
    map[key] = (atom as any)[uniqSym](query);
    return map[key];
  }
  return query;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function kbExpandOption() {
  return {
    type: ContextMenuOptionType.KnowledgeBase,
    fileName: 'Knowledge Base',
    description: '',
    // No value, no relativePath → triggers expand
  };
}

function chatSessionExpandOption() {
  return {
    type: ContextMenuOptionType.ChatSession,
    fileName: 'Chat Session Files',
    description: '',
    // No value, no relativePath → triggers expand
  };
}

// ── selectMenu: KB expand branches ───────────────────────────────────────────

describe('ContextMenuAtom — selectMenu KB expand: no KB path', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { workspace: '/ws' } }); // no KB path
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('sets NoResults when knowledgeBasePath is empty', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/Knowledge Base path not set/i);
  });
});

describe('ContextMenuAtom — selectMenu KB expand: empty search results', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [] });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when no KB files found', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/No files found/i);
  });
});

describe('ContextMenuAtom — selectMenu KB expand: search throws', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    mockSearchWorkspaceFiles.mockRejectedValue(new Error('fs error'));
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when KB file search throws', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/Failed to load Knowledge Base files/i);
  });
});

describe('ContextMenuAtom — selectMenu KB expand: happy path', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [{ path: '/kb/doc.md' }] });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('populates KnowledgeBase options from search results', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
    const { options } = state.get();
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].type).toBe(ContextMenuOptionType.KnowledgeBase);
    expect(options[0].value).toContain('@knowledge-base:');
  });
});

// ── selectMenu: ChatSession expand sub-branches ────────────────────────────

describe('ContextMenuAtom — selectMenu ChatSession expand: no workspace', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: {} }); // no workspace
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults for workspace path not set', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(chatSessionExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/Workspace path not set/i);
  });
});

describe('ContextMenuAtom — selectMenu ChatSession expand: no active session', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { workspace: '/ws' } });
    mockGetCurrentChatSessionId.mockReturnValue(null); // no session
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when no active chat session', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(chatSessionExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/No active chat session/i);
  });
});

describe('ContextMenuAtom — selectMenu ChatSession expand: invalid session ID format', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { workspace: '/ws' } });
    mockGetCurrentChatSessionId.mockReturnValue('invalid_id_format'); // no year/month pattern
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when session ID format is invalid', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(chatSessionExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/Invalid chat session ID/i);
  });
});

describe('ContextMenuAtom — selectMenu ChatSession expand: no session files', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { workspace: '/ws' } });
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [] });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when no session files found', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(chatSessionExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/No files found/i);
  });
});

describe('ContextMenuAtom — selectMenu ChatSession expand: happy path', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { workspace: '/ws' } });
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [{ path: '/ws/202501/chatSession_202501_abc/out.txt' }] });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('populates ChatSession options from search results', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(chatSessionExpandOption());
    const { options } = state.get();
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].type).toBe(ContextMenuOptionType.ChatSession);
    expect(options[0].value).toContain('@chat-session:');
  });

  it('searches chat session files under the chat-owned workspace', async () => {
    mockGetCurrentChat.mockReturnValue({
      workspace: '/chat-workspace',
      agent: { workspace: '/legacy-agent-workspace' },
    });
    mockSearchWorkspaceFiles.mockResolvedValue({
      results: [{ path: '/chat-workspace/202501/chatSession_202501_abc/out.txt' }],
    });

    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(chatSessionExpandOption());

    expect(mockSearchWorkspaceFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: '/chat-workspace/202501/chatSession_202501_abc',
        searchTarget: 'files',
      }),
    );
  });
});

describe('ContextMenuAtom — selectMenu ChatSession expand: search throws', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { workspace: '/ws' } });
    mockSearchWorkspaceFiles.mockRejectedValue(new Error('session fs error'));
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when ChatSession search throws', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(chatSessionExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/Failed to load Chat Session files/i);
  });
});

describe('resolveChatSessionFolder', () => {
  it('returns folder path with forward slashes', () => {
    expect(resolveChatSessionFolder('/ws', 'chatSession_202501_abc'))
      .toBe('/ws/202501/chatSession_202501_abc');
  });

  it('works with Windows-style workspace paths (main process normalizes)', () => {
    expect(resolveChatSessionFolder('C:\\Users\\test\\workspace', 'chatSession_202506_xyz'))
      .toBe('C:\\Users\\test\\workspace/202506/chatSession_202506_xyz');
  });

  it('returns null when workspace is empty', () => {
    expect(resolveChatSessionFolder('', 'chatSession_202501_abc')).toBeNull();
  });

  it('returns null when workspace is undefined', () => {
    expect(resolveChatSessionFolder(undefined, 'chatSession_202501_abc')).toBeNull();
  });

  it('returns null when chatSessionId is null', () => {
    expect(resolveChatSessionFolder('/ws', null)).toBeNull();
  });

  it('returns null when chatSessionId format is invalid', () => {
    expect(resolveChatSessionFolder('/ws', 'invalid_id')).toBeNull();
  });
});

// ── triggerMenu: @ with search query ─────────────────────────────────────────

describe('ContextMenuAtom — triggerMenu @ with search query: files found', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({
      agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' },
    });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockSearchWorkspaceFiles
      .mockResolvedValueOnce({ results: [{ path: '/kb/report.md' }] })                           // KB
      .mockResolvedValueOnce({ results: [{ path: '/ws/202501/chatSession_202501_abc/out.txt' }] }); // ChatSession
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('returns mixed KB and ChatSession options', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('report', rect, ContextMenuTriggerType.Mention);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    const types = options.map((o) => o.type);
    expect(types).toContain(ContextMenuOptionType.KnowledgeBase);
    expect(types).toContain(ContextMenuOptionType.ChatSession);
  });
});

describe('ContextMenuAtom — triggerMenu @ with search query: no files found', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({
      agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' },
    });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [] });
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('shows NoResults when search returns nothing', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('xyzzy', rect, ContextMenuTriggerType.Mention);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toContain('xyzzy');
  });
});

describe('ContextMenuAtom — triggerMenu @ error path', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    mockGetCurrentChat.mockImplementation(() => { throw new Error('state error'); });
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([{ type: ContextMenuOptionType.KnowledgeBase, fileName: 'KB', description: '' }]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('falls back to default menu options on error', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('q', rect, ContextMenuTriggerType.Mention);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options.length).toBeGreaterThan(0);
  });
});

// ── triggerMenu: skill branches ───────────────────────────────────────────────

describe('ContextMenuAtom — triggerMenu skills: non-empty query with matches', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    const skills = [{ name: 'web-search', description: 'Search the web' }];
    mockGetCurrentAgentSkills.mockReturnValue(skills);
    mockFilterSkillsByQuery.mockReturnValue([{
      type: ContextMenuOptionType.Skill,
      fileName: 'web-search',
      description: 'Search the web',
      value: 'web-search',
    }]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('shows filtered skill options', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('web', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.Skill);
    expect(options[0].value).toBe('web-search');
  });
});

describe('ContextMenuAtom — triggerMenu skills: non-empty query no matches', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    mockGetCurrentAgentSkills.mockReturnValue([{ name: 'web-search', description: '' }]);
    mockFilterSkillsByQuery.mockReturnValue([]); // no matches
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('shows NoResults hint with skill count', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('xyzzy', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toContain('xyzzy');
    expect(options[0].description).toContain('1 skills available');
  });
});

describe('ContextMenuAtom — triggerMenu skills: empty query filterSkillsByQuery returns empty', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    const skills = [{ name: 'web-search', description: 'Search the web' }];
    mockGetCurrentAgentSkills.mockReturnValue(skills);
    mockFilterSkillsByQuery.mockReturnValue([]); // returns empty even for empty query
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('lists all available skills when query is empty and filter returns nothing', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.Skill);
    expect(options[0].value).toBe('web-search');
  });
});

describe('ContextMenuAtom — triggerMenu skill error path', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    mockGetCurrentAgentSkills.mockImplementation(() => { throw new Error('skills error'); });
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('shows Failed to load skills on error', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/Failed to load skills/i);
  });
});

// ── navigateMenu with populated options ───────────────────────────────────────

describe('ContextMenuAtom — navigateMenu with options', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    const skills = [
      { name: 'a', description: '' },
      { name: 'b', description: '' },
      { name: 'c', description: '' },
    ];
    mockGetCurrentAgentSkills.mockReturnValue(skills);
    mockFilterSkillsByQuery.mockReturnValue(
      skills.map((s) => ({ type: ContextMenuOptionType.Skill, fileName: s.name, description: '', value: s.name }))
    );
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('wraps from last to first on down navigation', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();

    // 3 options: selectedIndex starts at 0, navigate down 3 times to wrap
    state.actions.navigateMenu('down'); // 1
    state.actions.navigateMenu('down'); // 2
    state.actions.navigateMenu('down'); // 3 → wraps to 0
    expect(state.get().selectedIndex).toBe(0);
  });

  it('wraps from first to last on up navigation', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();

    state.actions.navigateMenu('up'); // 0 → 2
    expect(state.get().selectedIndex).toBe(2);
  });
});

// ── triggerMenu: additional skill + @ branch coverage ─────────────────────────

describe('ContextMenuAtom — triggerMenu skills: no skills available', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    mockGetCurrentAgentSkills.mockReturnValue([]); // agent has zero skills
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('shows "No skills available" when the agent has no skills', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/No skills available/i);
  });
});

describe('ContextMenuAtom — triggerMenu skills: list-all with a description-less skill', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    // Empty query + filter returns [] -> "show all skills" map path, where a
    // skill missing `description` exercises the `skill.description || ''` arm.
    mockGetCurrentAgentSkills.mockReturnValue([{ name: 'no-desc-skill' }]);
    mockFilterSkillsByQuery.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('defaults a missing skill description to an empty string', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.Skill);
    expect(options[0].value).toBe('no-desc-skill');
    expect(options[0].description).toBe('');
  });
});

describe('ContextMenuAtom — triggerMenu @ with a flat knowledgeBase and no workspace', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    // Deprecated flat `knowledgeBase` (no nested `knowledge`) exercises the
    // `?? agent?.knowledgeBase` right arm; absent workspace makes
    // resolveChatSessionFolder return null -> the `?? ''` right arm.
    mockGetCurrentChat.mockReturnValue({ agent: { knowledgeBase: '/flat/kb' } });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [{ path: '/flat/kb/note.md' }] });
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('searches the flat knowledgeBase and skips the (empty) chat-session source', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    state.actions.triggerMenu('note', rect, ContextMenuTriggerType.Mention);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    const types = options.map((o) => o.type);
    expect(types).toContain(ContextMenuOptionType.KnowledgeBase);
    expect(types).not.toContain(ContextMenuOptionType.ChatSession);
  });
});

describe('ContextMenuAtom — triggerMenu debounce clears a pending timer', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = buildStore();
    mockGetCurrentAgentSkills.mockReturnValue([{ name: 'web-search', description: 'Search' }]);
    mockFilterSkillsByQuery.mockReturnValue([{
      type: ContextMenuOptionType.Skill,
      fileName: 'web-search',
      description: 'Search',
      value: 'web-search',
    }]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('clears the previous debounce timer when triggered again before it fires', async () => {
    const state = store(ContextMenuAtom);
    const rect = { top: 0, left: 0, width: 0 } as DOMRect;
    // First call schedules a timer; second call (before timers run) hits the
    // `if (timer) clearTimeout(timer)` truthy arm.
    state.actions.triggerMenu('we', rect, ContextMenuTriggerType.Skill);
    state.actions.triggerMenu('web', rect, ContextMenuTriggerType.Skill);
    await vi.runAllTimersAsync();
    const { options } = state.get();
    expect(options[0].value).toBe('web-search');
    // Only the second (surviving) timer ran its search.
    expect(mockFilterSkillsByQuery).toHaveBeenCalledTimes(1);
  });
});
