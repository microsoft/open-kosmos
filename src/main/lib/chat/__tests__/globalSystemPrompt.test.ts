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

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

import { getGlobalSystemPrompt, getGlobalSystemPromptAsMessages } from '../globalSystemPrompt';
import { getBuddySystemPrompt } from '../../buddy/prompt';
import { isFeatureEnabled } from '../../featureFlags';
import { BuddyManager } from '../../buddy/BuddyManager';

const mockedIsFeatureEnabled = isFeatureEnabled as ReturnType<typeof vi.fn>;
const mockedGetBuddySystemPrompt = getBuddySystemPrompt as ReturnType<typeof vi.fn>;

describe('getGlobalSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuddyManagerInstance.isMuted.mockReturnValue(false);
    mockBuddyManagerInstance.getCompanion.mockReturnValue(null);
    mockedGetBuddySystemPrompt.mockReturnValue('');
    mockedIsFeatureEnabled.mockReturnValue(false);
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

  it('does NOT include coding agent section when feature disabled', () => {
    mockedIsFeatureEnabled.mockReturnValue(false);
    const prompt = getGlobalSystemPrompt();
    expect(prompt).not.toContain('CODING AGENT TOOL USAGE');
  });

  it('includes coding agent section when feature enabled', () => {
    mockedIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureCodingAgent');
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('CODING AGENT TOOL USAGE');
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
  });

  it('mentions request_interactive_input guidance', () => {
    const prompt = getGlobalSystemPrompt();
    expect(prompt).toContain('request_interactive_input');
  });
});

describe('getGlobalSystemPromptAsMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuddyManagerInstance.isMuted.mockReturnValue(false);
    mockBuddyManagerInstance.getCompanion.mockReturnValue(null);
    mockedGetBuddySystemPrompt.mockReturnValue('');
    mockedIsFeatureEnabled.mockReturnValue(false);
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
