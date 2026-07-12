// @ts-nocheck
const mockBuddyManager = vi.hoisted(() => ({
  getInstance: vi.fn(),
  isMuted: vi.fn(() => false),
  getCompanion: vi.fn(() => null),
}));

const mockBuddyManagerInstance = vi.hoisted(() => ({
  isMuted: vi.fn(() => false),
  getCompanion: vi.fn(() => null),
}));

vi.mock('../../buddy/BuddyManager', () => ({
  BuddyManager: {
    getInstance: vi.fn(() => mockBuddyManagerInstance),
  },
}));

vi.mock('../../buddy/prompt', () => ({
  getBuddySystemPrompt: vi.fn(() => ''),
}));

const mockProfileCacheManager = vi.hoisted(() => ({
  getCurrentUserAlias: vi.fn(() => 'tester'),
  getCodingAgentSettings: vi.fn(() => ({ enabled: false, cli: 'claude' })),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: mockProfileCacheManager,
}));

import { getGlobalSystemPrompt, getGlobalSystemPromptAsMessages } from '../globalSystemPrompt';
import { getBuddySystemPrompt } from '../../buddy/prompt';
import { BuddyManager } from '../../buddy/BuddyManager';

const mockedGetBuddySystemPrompt = getBuddySystemPrompt as ReturnType<typeof vi.fn>;

describe('getGlobalSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuddyManagerInstance.isMuted.mockReturnValue(false);
    mockBuddyManagerInstance.getCompanion.mockReturnValue(null);
    mockedGetBuddySystemPrompt.mockReturnValue('');
    mockProfileCacheManager.getCurrentUserAlias.mockReturnValue('tester');
    mockProfileCacheManager.getCodingAgentSettings.mockReturnValue({ enabled: false, cli: 'claude' });
    (BuddyManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockBuddyManagerInstance);
  });

  it('returns a non-empty string', () => {
    const prompt = getGlobalSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes system notifications section', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('SYSTEM NOTIFICATIONS AND REMINDERS');
  });

  it('includes command execution principles', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('COMMAND EXECUTION PRINCIPLES');
  });

  it('includes file operations workspace restriction', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('FILE OPERATIONS WORKSPACE RESTRICTION');
  });

  it('includes temporal reference handling', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('TEMPORAL REFERENCE HANDLING');
  });

  it('does NOT include coding agent section when master switch disabled', () => {
    mockProfileCacheManager.getCodingAgentSettings.mockReturnValue({ enabled: false, cli: 'claude' });
    const prompt = getGlobalSystemPrompt();
    expect(prompt).not.toContain('CODING AGENT TOOL USAGE');
  });

  it('includes coding agent section when master switch enabled', () => {
    mockProfileCacheManager.getCodingAgentSettings.mockReturnValue({ enabled: true, cli: 'claude' });
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('CODING AGENT TOOL USAGE');
    expect(prompt).toContain('configured coding CLI');
    expect(prompt).toContain('Codex CLI');
    expect(prompt).not.toContain('spawns Claude Code CLI');
  });

  it('does NOT include coding agent section when no profile alias is active', () => {
    mockProfileCacheManager.getCurrentUserAlias.mockReturnValue(null);
    mockProfileCacheManager.getCodingAgentSettings.mockReturnValue({ enabled: true, cli: 'claude' });
    const prompt = getGlobalSystemPrompt();
    expect(prompt).not.toContain('CODING AGENT TOOL USAGE');
  });

  it('does NOT include buddy prompt when muted', () => {
    mockBuddyManagerInstance.isMuted.mockReturnValue(true);
    mockedGetBuddySystemPrompt.mockReturnValue('BUDDY CONTENT');

    const prompt = getGlobalSystemPrompt();
    expect(prompt).not.toContain('BUDDY CONTENT');
    expect(mockedGetBuddySystemPrompt).not.toHaveBeenCalled();
  });

  it('includes buddy prompt when not muted and companion exists', () => {
    mockBuddyManagerInstance.isMuted.mockReturnValue(false);
    mockBuddyManagerInstance.getCompanion.mockReturnValue({ name: 'Aria' });
    mockedGetBuddySystemPrompt.mockReturnValue('\n\nBUDDY SECTION');

    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('BUDDY SECTION');
  });

  it('does NOT include buddy prompt when getBuddySystemPrompt returns empty', () => {
    mockBuddyManagerInstance.isMuted.mockReturnValue(false);
    mockBuddyManagerInstance.getCompanion.mockReturnValue({ name: 'Aria' });
    mockedGetBuddySystemPrompt.mockReturnValue('');

    const prompt = getGlobalSystemPrompt();
    expect(prompt).not.toContain('BUDDY SECTION');
  });

  it('mentions forbidden OAuth logout operations', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('FORBIDDEN Operations');
    expect(prompt).toContain('OAuth');
    expect(prompt).toContain("a browser's User Data or Profile directory");
  });

  it('mentions request_interactive_input guidance', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('request_interactive_input');
  });

  it('includes information retrieval priority section', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('INFORMATION RETRIEVAL PRIORITY');
  });

  it('instructs to search Knowledge Base and Deliverables before answering', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('Knowledge Base');
    expect(prompt).toContain('Current Chat Session Deliverables');
    // The retrieval section must appear before the file-output rules so the
    // model reads "search first" before "write here".
    const retrievalIndex = prompt.indexOf('INFORMATION RETRIEVAL PRIORITY');
    const fileOpsIndex = prompt.indexOf('FILE OPERATIONS WORKSPACE RESTRICTION');
    expect(retrievalIndex).toBeGreaterThan(-1);
    expect(fileOpsIndex).toBeGreaterThan(-1);
    expect(retrievalIndex).toBeLessThan(fileOpsIndex);
  });

  it('forbids answering factual questions from memory alone when sources are configured', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('do NOT answer factual or task-specific questions from memory alone');
  });

  it('includes an override-priority instruction that beats keyword shortcuts (Phase 1.5)', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('OVERRIDE your default behavior');
    // Must order retrieval before execution/agent/ask tools.
    expect(prompt).toContain('BEFORE invoking any execution, agent, or ask-the-user tool');
    expect(prompt).toContain('last resort, not a first response');
    // The override must live inside the retrieval-priority section, before file-ops rules.
    const overrideIndex = prompt.indexOf('OVERRIDE your default behavior');
    const fileOpsIndex = prompt.indexOf('FILE OPERATIONS WORKSPACE RESTRICTION');
    expect(overrideIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeLessThan(fileOpsIndex);
  });

  it('routes Office and PDF files to read_office_file', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('read_office_file');
    // Office/PDF formats must be named so the model knows which reader to use.
    expect(prompt).toContain('.pdf');
    expect(prompt).toContain('.docx');
    expect(prompt).toContain('.xlsx');
    expect(prompt).toContain('.pptx');
  });

  it('routes HTML files to read_html', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('read_html');
    expect(prompt).toContain('.html');
  });

  it('warns that search_file_contents cannot read binary documents', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('search_file_contents');
    expect(prompt).toContain('binary');
  });

  it('defines a fallback order after own sources', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('general knowledge');
    expect(prompt).toContain('web search');
  });
});

describe('getGlobalSystemPromptAsMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuddyManagerInstance.isMuted.mockReturnValue(false);
    mockBuddyManagerInstance.getCompanion.mockReturnValue(null);
    mockedGetBuddySystemPrompt.mockReturnValue('');
    mockProfileCacheManager.getCurrentUserAlias.mockReturnValue('tester');
    mockProfileCacheManager.getCodingAgentSettings.mockReturnValue({ enabled: false, cli: 'claude' });
    (BuddyManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockBuddyManagerInstance);
  });

  it('returns an array with a single message', () => {
    const messages = getGlobalSystemPromptAsMessages();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages).toHaveLength(1);
  });

  it('message has id global-system-prompt', () => {
    const [msg] = getGlobalSystemPromptAsMessages();
    expect(msg.id).toBe('global-system-prompt');
  });

  it('message has role system', () => {
    const [msg] = getGlobalSystemPromptAsMessages();
    expect(msg.role).toBe('system');
  });

  it('message content is a text part array', () => {
    const [msg] = getGlobalSystemPromptAsMessages();
    expect(Array.isArray(msg.content)).toBe(true);
    expect((msg.content as any[])[0].type).toBe('text');
    expect(typeof (msg.content as any[])[0].text).toBe('string');
  });

  it('message has a numeric timestamp', () => {
    const [msg] = getGlobalSystemPromptAsMessages();
    expect(typeof msg.timestamp).toBe('number');
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('text content matches getGlobalSystemPrompt output', () => {
    const [msg] = getGlobalSystemPromptAsMessages();
    const promptText = getGlobalSystemPrompt();
    expect((msg.content as any[])[0].text).toBe(promptText);
  });
});
