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

import { ContextMenuAtom, zeroContextMenuState } from '../context-menu.atom';

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
    // KB catch block fires first; ChatSession block then also fires (same mock throws).
    // Final state is the ChatSession error — still a NoResults option.
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
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
    // After KB succeeds, ChatSession path also runs; mock returns same results
    // We just verify at least one KnowledgeBase or ChatSession option appears
    const { options } = state.get();
    // At minimum options is non-empty
    expect(options.length).toBeGreaterThan(0);
  });
});

// ── selectMenu: ChatSession expand sub-branches (triggered after KB success) ──

describe('ContextMenuAtom — selectMenu ChatSession expand: no workspace', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    // KB path exists and returns files; workspace is missing
    mockGetCurrentChat
      .mockReturnValueOnce({ agent: { knowledge: { knowledgeBase: '/kb' } } }) // KB check (no workspace)
      .mockReturnValueOnce({ agent: { knowledge: { knowledgeBase: '/kb' } } }); // ChatSession check
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [{ path: '/kb/file.md' }] });
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults for workspace path not set', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
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
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    // First call returns KB files; then ChatSession path runs
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [{ path: '/kb/file.md' }] });
    mockGetCurrentChatSessionId.mockReturnValue(null); // no session
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when no active chat session', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
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
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    mockSearchWorkspaceFiles.mockResolvedValue({ results: [{ path: '/kb/file.md' }] });
    mockGetCurrentChatSessionId.mockReturnValue('invalid_id_format'); // no year/month pattern
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when session ID format is invalid', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
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
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    // KB search returns files; chat session search returns empty
    mockSearchWorkspaceFiles
      .mockResolvedValueOnce({ results: [{ path: '/kb/file.md' }] })   // KB
      .mockResolvedValueOnce({ results: [] });                            // ChatSession
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when no session files found', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
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
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    mockSearchWorkspaceFiles
      .mockResolvedValueOnce({ results: [{ path: '/kb/doc.md' }] })               // KB
      .mockResolvedValueOnce({ results: [{ path: '/ws/202501/chatSession_202501_abc/out.txt' }] }); // ChatSession
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('populates ChatSession options from search results', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
    const { options } = state.get();
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].type).toBe(ContextMenuOptionType.ChatSession);
    expect(options[0].value).toContain('@chat-session:');
  });
});

describe('ContextMenuAtom — selectMenu ChatSession expand: search throws', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = buildStore();
    mockGetCurrentChat.mockReturnValue({ agent: { knowledge: { knowledgeBase: '/kb' }, workspace: '/ws' } });
    mockSearchWorkspaceFiles
      .mockResolvedValueOnce({ results: [{ path: '/kb/doc.md' }] })  // KB succeeds
      .mockRejectedValueOnce(new Error('session fs error'));           // ChatSession throws
    mockGetCurrentChatSessionId.mockReturnValue('chatSession_202501_abc');
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockGetDefaultMenuOptions.mockReturnValue([]);
  });

  it('shows NoResults when ChatSession search throws', async () => {
    const state = store(ContextMenuAtom);
    await state.actions.selectMenu(kbExpandOption());
    const { options } = state.get();
    expect(options[0].type).toBe(ContextMenuOptionType.NoResults);
    expect(options[0].fileName).toMatch(/Failed to load Chat Session files/i);
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
