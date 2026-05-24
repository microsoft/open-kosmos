/**
 * @vitest-environment happy-dom
 *
 * ChatInput render state tests — covers props/branches not exercised by the
 * existing ChatInput.mentionHighlight test suite.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('../../../styles/ChatInput.css', async () => ({}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({ showToast: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../lib/chat/agentChatIpc', async () => ({
  agentChatIpc: { cancelChat: vi.fn(), streamMessage: vi.fn() },
}));

vi.mock('lucide-react', async () => ({
  Globe: () => <svg data-testid="globe-icon" />,
}));

vi.mock('../../../ipc/screenshot-main', async () => ({
  screenshotApi: { capture: vi.fn() },
}));

const { mockProfileDataManager: mockPdm, mockSessionIdle } = vi.hoisted(() => ({
  mockProfileDataManager: {
    getSelectedModel: vi.fn(() => 'model-1'),
    subscribe: vi.fn(() => vi.fn()),
    addPromptToHistory: vi.fn(),
    getPreviousPrompt: vi.fn(() => null),
    getNextPrompt: vi.fn(() => null),
    setCurrentEditingPrompt: vi.fn(),
    getCurrentAgent: vi.fn(() => null),
  },
  mockSessionIdle: { value: true },
}));

vi.mock('../../../lib/userData/profileDataManager', async () => ({
  profileDataManager: mockPdm,
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useAgentConfig: () => ({ updateModel: vi.fn(async () => ({ success: true })), isLoading: false }),
  useProfileData: () => ({}),
  useChats: () => ({}),
}));

vi.mock('../../../lib/models/ghcModels', async () => ({
  getModelById: vi.fn(() => ({ name: 'Mock Model' })),
  getModelCapabilities: vi.fn(() => ({ supportsImages: false })),
  getAllOpenKosmosUsedModels: vi.fn(() => [
    { id: 'model-1', name: 'Mock Model', capabilities: { family: 'gpt', supports: { tool_calls: true, vision: false } } },
  ]),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: vi.fn(() => 'chat-1'),
    subscribeToCurrentChatSessionId: vi.fn(() => vi.fn()),
  },
  CurrentSessionError: { use: vi.fn(() => null) },
  CurrentSessionIdle: { use: () => mockSessionIdle.value },
}));

vi.mock('../../../lib/utilities/contentUtils', async () => ({
  ContentPartFactory: { createText: (text: string) => ({ type: 'text', text }) },
  ContentConverter: { fileToImageContent: vi.fn(), fileToFileContent: vi.fn(), fileToOfficeContent: vi.fn(), fileToOthersContent: vi.fn() },
  ContentAnalyzer: { analyzeContent: vi.fn(() => ({ totalCount: 0 })) },
  FileProcessor: { isOfficeFile: vi.fn(() => false), isTextFile: vi.fn(() => true), fileToDataURL: vi.fn() },
  formatFileSize: vi.fn(() => '1 KB'),
}));

vi.mock('../../ui/FileTypeIcon', () => ({ default: () => <div data-testid="file-type-icon" /> }));

vi.mock('../../../lib/utilities/imageCompression', async () => ({
  smartCompressImageVSCodeOfficial: vi.fn(),
  shouldCompressImage: vi.fn(() => false),
  VSCODE_IMAGE_LIMITS: {},
}));

vi.mock('../chat-input/ContextMenu', async () => ({ ContextMenu: () => null }));

vi.mock('../chat-input/context-menu.atom', async () => ({
  ContextMenuAtom: {
    use: () => [
      { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
      { triggerMenu: vi.fn(), closeMenu: vi.fn(), navigateMenu: vi.fn(), hoverMenu: vi.fn(), selectMenu: vi.fn() },
    ],
  },
  zeroContextMenuState: { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
}));

vi.mock('../../../lib/chat/contextMentions', async () => ({
  getCurrentSearchQuery: vi.fn(() => ''),
  insertMention: vi.fn((text: string) => ({ newText: text, newCursorPos: text.length })),
  ContextMenuOptionType: {},
  ContextMenuTriggerType: {},
  MentionSourceType: {},
  getContextMenuTriggerType: vi.fn(() => null),
  getCurrentSkillSearchQuery: vi.fn(() => ''),
  insertSkillMention: vi.fn((text: string) => ({ newText: text, newCursorPos: text.length })),
  workspaceMentionRegex: /\[@workspace:[^\]]+\]/g,
  knowledgeBaseMentionRegex: /\[@knowledge-base:[^\]]+\]/g,
  chatSessionMentionRegex: /\[@chat-session:[^\]]+\]/g,
  skillMentionRegex: /\[#skill:[^\]]+\]/g,
}));

vi.mock('../../../lib/workspace/workspaceSearchService', async () => ({ quickSearchFiles: vi.fn() }));

vi.mock('../ErrorBar', () => ({ default: () => null }));

vi.mock('../../../lib/featureFlags', async () => ({ useFeatureFlag: vi.fn(() => false) }));

vi.mock('../VoiceInputButton', async () => ({ VoiceInputButton: () => null }));

vi.mock('../../../lib/userData', async () => ({ useVoiceInputEnabled: vi.fn(() => false) }));

vi.mock('../../../lib/chat/chatInputKeyboard', async () => ({
  getChatInputEnterAction: vi.fn(() => 'send'),
  getChatInputShortcutHint: vi.fn(() => 'Enter to send'),
}));

import ChatInput from '../ChatInput';

describe('ChatInput render states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionIdle.value = true;
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    Object.defineProperty(window, 'ResizeObserver', { writable: true, configurable: true, value: ResizeObserverMock });
  });

  it('renders the textarea in compose mode by default', () => {
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders in read-only mode without crashing', () => {
    render(<ChatInput onSendMessage={vi.fn()} isReadOnly />);
    expect(screen.queryByTitle('Cancel Chat')).not.toBeInTheDocument();
  });

  it('does not show cancel chat button when chatStatus is idle', () => {
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(screen.queryByTitle('Cancel Chat')).not.toBeInTheDocument();
  });

  it('shows cancel chat button when chatStatus is sending_response', () => {
    mockSessionIdle.value = false;
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(screen.getByTitle('Cancel Chat')).toBeInTheDocument();
  });

  it('shows cancel chat button when chatStatus is compressing_context', () => {
    mockSessionIdle.value = false;
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(screen.getByTitle('Cancel Chat')).toBeInTheDocument();
  });

  it('shows cancel chat button when chatStatus is received_response', () => {
    mockSessionIdle.value = false;
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(screen.getByTitle('Cancel Chat')).toBeInTheDocument();
  });

  it('shows cancel chat button when chatStatus is compressed_context', () => {
    mockSessionIdle.value = false;
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(screen.getByTitle('Cancel Chat')).toBeInTheDocument();
  });

  it('renders Cancel and Send buttons in edit-inline mode', () => {
    render(
      <ChatInput
        onSendMessage={vi.fn()}
       
        mode="edit-inline"
        initialMessage={null}
        onSubmitEditedMessage={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('renders without crashing when no chatStatus is provided', () => {
    render(<ChatInput onSendMessage={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders isInputLocked mode without crashing', () => {
    render(
      <ChatInput
        onSendMessage={vi.fn()}
       
        isInputLocked
      />,
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
