/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@shared/types/chatTypes';

vi.mock('../../../styles/ChatInput.css', async () => ({}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock('../../../lib/chat/agentChatIpc', async () => ({
  agentChatIpc: {
    cancelChat: vi.fn(),
    streamMessage: vi.fn(),
  },
}));

vi.mock('lucide-react', async () => ({
  Globe: () => <svg data-testid="globe-icon" />,
}));

vi.mock('../../../ipc/screenshot-main', async () => ({
  screenshotApi: {
    capture: vi.fn(),
  },
}));

const { mockProfileDataManager, mockSessionIdle } = vi.hoisted(() => ({
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
  profileDataManager: mockProfileDataManager,
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useAgentConfig: () => ({
    updateModel: vi.fn(async () => ({ success: true })),
    isLoading: false,
  }),
  useProfileData: () => ({}),
  useChats: () => ({}),
}));

vi.mock('../../../lib/models/ghcModels', async () => ({
  getModelById: vi.fn(() => ({ name: 'Mock Model' })),
  getModelCapabilities: vi.fn(() => ({ supportsImages: true })),
  getAllOpenKosmosUsedModels: vi.fn(() => [
    {
      id: 'model-1',
      name: 'Mock Model',
      capabilities: {
        family: 'gpt',
        supports: {
          tool_calls: true,
          vision: true,
        },
      },
    },
  ]),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: vi.fn(() => 'chat-1'),
    subscribeToCurrentChatSessionId: vi.fn(() => vi.fn()),
  },
  CurrentSessionError: {
    use: vi.fn(() => null),
  },
  CurrentSessionIdle: { use: () => mockSessionIdle.value },
}));

vi.mock('../../../lib/utilities/contentUtils', async () => ({
  ContentPartFactory: {
    createText: (text: string) => ({ type: 'text', text }),
  },
  ContentConverter: {
    fileToImageContent: vi.fn(),
    fileToFileContent: vi.fn(),
    fileToOfficeContent: vi.fn(),
    fileToOthersContent: vi.fn(),
  },
  ContentAnalyzer: {
    analyzeContent: vi.fn(() => ({ totalCount: 0 })),
  },
  FileProcessor: {
    isOfficeFile: vi.fn(() => false),
    isTextFile: vi.fn(() => true),
    fileToDataURL: vi.fn(),
  },
  formatFileSize: vi.fn(() => '1 KB'),
}));

vi.mock('../../ui/FileTypeIcon', () => ({ default: () => <div data-testid="file-type-icon" /> }));

vi.mock('../../../lib/utilities/imageCompression', async () => ({
  smartCompressImageVSCodeOfficial: vi.fn(),
  shouldCompressImage: vi.fn(() => false),
  VSCODE_IMAGE_LIMITS: {},
}));

const {
  MockContextMenuOptionType,
  MockContextMenuTriggerType,
  MockMentionSourceType,
} = vi.hoisted(() => {
  enum MockContextMenuOptionType {
    KnowledgeBase = 'knowledge_base',
    ChatSession = 'chat_session',
    Skill = 'skill',
    NoResults = 'no_results',
  }

  enum MockContextMenuTriggerType {
    Workspace = 'workspace',
    Skill = 'skill',
  }

  enum MockMentionSourceType {
    KnowledgeBase = 'knowledge_base',
    ChatSession = 'chat_session',
  }

  return { MockContextMenuOptionType, MockContextMenuTriggerType, MockMentionSourceType };
});

vi.mock('../../../lib/chat/contextMentions', async () => ({
  getCurrentSearchQuery: vi.fn(() => 'workspace-query'),
  insertMention: vi.fn((text: string) => ({ newText: text, newCursorPos: text.length })),
  ContextMenuOptionType: MockContextMenuOptionType,
  ContextMenuTriggerType: MockContextMenuTriggerType,
  MentionSourceType: MockMentionSourceType,
  getContextMenuTriggerType: vi.fn((value: string, cursorPos: number) => {
    const beforeCursor = value.slice(0, cursorPos);
    if (beforeCursor.includes('#')) {
      return MockContextMenuTriggerType.Skill;
    }
    if (beforeCursor.includes('@')) {
      return MockContextMenuTriggerType.Workspace;
    }
    return null;
  }),
  getCurrentSkillSearchQuery: vi.fn(() => 'skill-query'),
  insertSkillMention: vi.fn((text: string) => ({ newText: text, newCursorPos: text.length })),
  workspaceMentionRegex: /\[@workspace:[^\]]+\]/g,
  knowledgeBaseMentionRegex: /\[@knowledge-base:[^\]]+\]/g,
  chatSessionMentionRegex: /\[@chat-session:[^\]]+\]/g,
  skillMentionRegex: /\[#skill:[^\]]+\]/g,
}));

vi.mock('../chat-input/ContextMenu', async () => ({
  ContextMenu: () => null,
}));

const { mockTriggerMenu } = vi.hoisted(() => ({ mockTriggerMenu: vi.fn() }));
vi.mock('../chat-input/context-menu.atom', async () => ({
  ContextMenuAtom: {
    use: () => [
      { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
      { triggerMenu: mockTriggerMenu, closeMenu: vi.fn(), navigateMenu: vi.fn(), hoverMenu: vi.fn(), selectMenu: vi.fn() },
    ],
  },
  zeroContextMenuState: { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
}));

vi.mock('../../../lib/workspace/workspaceSearchService', async () => ({
  quickSearchFiles: vi.fn(),
}));

vi.mock('../ErrorBar', () => ({ default: () => null }));
vi.mock('../../../lib/featureFlags', async () => ({
  useFeatureFlag: vi.fn(() => false),
}));
vi.mock('../VoiceInputButton', async () => ({
  VoiceInputButton: () => null,
}));
vi.mock('../../../lib/userData', async () => ({
  useVoiceInputEnabled: vi.fn(() => false),
}));
vi.mock('../../../lib/chat/chatInputKeyboard', async () => ({
  getChatInputEnterAction: vi.fn(() => 'send'),
  getChatInputShortcutHint: vi.fn(() => 'Enter to send'),
}));

import ChatInput from '../ChatInput';

function createMessageWithAttachment(): Message {
  return {
    id: 'message-1',
    role: 'user',
    timestamp: Date.now(),
    content: [
      { type: 'text', text: '[#skill:figma-make]' },
      {
        type: 'file',
        file: {
          fileName: 'design-spec.md',
          mimeType: 'text/markdown',
          filePath: '/tmp/design-spec.md',
        },
        metadata: {
          fileSize: 1024,
          lastModified: new Date().toISOString(),
        },
      },
    ],
  } as Message;
}

describe('ChatInput mention highlight layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionIdle.value = true;

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      configurable: true,
      value: ResizeObserverMock,
    });
  });

  it('keeps the mention highlight layer scoped to the textarea wrapper when attachments are present', () => {
    const { container } = render(
      <ChatInput
        onSendMessage={vi.fn()}

        mode="edit-inline"
        initialMessage={createMessageWithAttachment()}
        onSubmitEditedMessage={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    const attachmentsArea = container.querySelector('.attachments-area') as HTMLElement | null;
    const textareaWrapper = container.querySelector('.textarea-layer-container') as HTMLElement | null;
    const highlightLayer = container.querySelector('.mention-highlight-layer') as HTMLElement | null;

    expect(attachmentsArea).toBeInTheDocument();
    expect(textareaWrapper).toBeInTheDocument();
    expect(highlightLayer).toBeInTheDocument();
    expect(textareaWrapper).toContainElement(highlightLayer);
    expect(attachmentsArea).not.toContainElement(highlightLayer);
  });

  it('anchors mention menu positioning to the textarea wrapper instead of the full composer when attachments exist', () => {
    const { container } = render(
      <ChatInput
        onSendMessage={vi.fn()}
        enableContextMenu

        mode="edit-inline"
        initialMessage={createMessageWithAttachment()}
        onSubmitEditedMessage={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    const textarea = container.querySelector('textarea');
    const textareaWrapper = container.querySelector('.textarea-layer-container') as HTMLElement | null;
    const composer = container.querySelector('.chat-input-container') as HTMLElement | null;

    expect(textarea).toBeInTheDocument();
    expect(textareaWrapper).toBeInTheDocument();
    expect(composer).toBeInTheDocument();

    const wrapperRect = {
      top: 320,
      left: 40,
      width: 640,
      height: 72,
      bottom: 392,
      right: 680,
      x: 40,
      y: 320,
      toJSON: () => ({}),
    } as DOMRect;

    const composerRect = {
      top: 180,
      left: 24,
      width: 700,
      height: 220,
      bottom: 400,
      right: 724,
      x: 24,
      y: 180,
      toJSON: () => ({}),
    } as DOMRect;

    textareaWrapper!.getBoundingClientRect = vi.fn(() => wrapperRect);
    composer!.getBoundingClientRect = vi.fn(() => composerRect);

    fireEvent.change(textarea!, {
      target: {
        value: '@design',
        selectionStart: 7,
        selectionEnd: 7,
      },
    });

    expect(mockTriggerMenu).toHaveBeenCalledWith(
      'workspace-query',
      wrapperRect,
      MockContextMenuTriggerType.Workspace,
    );
  });

  it('uses the same textarea wrapper rect for skill mention triggers when attachments exist', () => {
    const { container } = render(
      <ChatInput
        onSendMessage={vi.fn()}
        enableContextMenu

        mode="edit-inline"
        initialMessage={createMessageWithAttachment()}
        onSubmitEditedMessage={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    const textarea = container.querySelector('textarea');
    const textareaWrapper = container.querySelector('.textarea-layer-container') as HTMLElement | null;
    const composer = container.querySelector('.chat-input-container') as HTMLElement | null;

    expect(textarea).toBeInTheDocument();
    expect(textareaWrapper).toBeInTheDocument();
    expect(composer).toBeInTheDocument();

    const wrapperRect = {
      top: 320,
      left: 40,
      width: 640,
      height: 72,
      bottom: 392,
      right: 680,
      x: 40,
      y: 320,
      toJSON: () => ({}),
    } as DOMRect;

    const composerRect = {
      top: 180,
      left: 24,
      width: 700,
      height: 220,
      bottom: 400,
      right: 724,
      x: 24,
      y: 180,
      toJSON: () => ({}),
    } as DOMRect;

    textareaWrapper!.getBoundingClientRect = vi.fn(() => wrapperRect);
    composer!.getBoundingClientRect = vi.fn(() => composerRect);

    fireEvent.change(textarea!, {
      target: {
        value: '#figma',
        selectionStart: 6,
        selectionEnd: 6,
      },
    });

    expect(mockTriggerMenu).toHaveBeenCalledWith(
      'skill-query',
      wrapperRect,
      MockContextMenuTriggerType.Skill,
    );
  });

  it('requests AppLayout confirmation before submitting an inline edit and no longer shows the old inline warning copy', async () => {
    const onSubmitEditedMessage = vi.fn().mockResolvedValue(undefined);
    const confirmRequestListener = vi.fn((event: Event) => {
      const customEvent = event as CustomEvent<{
        requestId?: string;
        title?: string;
        description?: string;
      }>;

      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditResult', {
        detail: {
          requestId: customEvent.detail?.requestId,
          confirmed: true,
        },
      }));
    });

    window.addEventListener('chatInput:confirmInlineEditRequest', confirmRequestListener as EventListener);

    try {
      render(
        <ChatInput
          onSendMessage={vi.fn()}
  
          mode="edit-inline"
          initialMessage={createMessageWithAttachment()}
          onSubmitEditedMessage={onSubmitEditedMessage}
          onCancelEdit={vi.fn()}
          warningMessage="Regenerating will not undo external actions that were already executed."
        />,
      );

      expect(screen.queryByText('Editing latest message. Saving will replace the response below and regenerate from this message.')).not.toBeInTheDocument();
      expect(screen.queryByText('Regenerating will not undo external actions that were already executed.')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      expect(onSubmitEditedMessage).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(confirmRequestListener).toHaveBeenCalledTimes(1);
      });

      const confirmRequestEvent = confirmRequestListener.mock.calls[0][0] as CustomEvent<{
        title?: string;
        description?: string;
      }>;

      expect(confirmRequestEvent.detail?.title).toBe('Regenerate response?');
      expect(confirmRequestEvent.detail?.description).toBe('This will replace the response below and regenerate from your edited message. External actions already run will not be undone.');

      await waitFor(() => {
        expect(onSubmitEditedMessage).toHaveBeenCalledTimes(1);
      });
    } finally {
      window.removeEventListener('chatInput:confirmInlineEditRequest', confirmRequestListener as EventListener);
    }
  });

  it('submits inline edits with a single user text part instead of appending the original text content again', async () => {
    const onSubmitEditedMessage = vi.fn().mockResolvedValue(undefined);
    const confirmRequestListener = vi.fn((event: Event) => {
      const customEvent = event as CustomEvent<{ requestId?: string }>;

      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditResult', {
        detail: {
          requestId: customEvent.detail?.requestId,
          confirmed: true,
        },
      }));
    });

    window.addEventListener('chatInput:confirmInlineEditRequest', confirmRequestListener as EventListener);

    try {
      render(
        <ChatInput
          onSendMessage={vi.fn()}
  
          mode="edit-inline"
          initialMessage={createMessageWithAttachment()}
          onSubmitEditedMessage={onSubmitEditedMessage}
          onCancelEdit={vi.fn()}
        />,
      );

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, {
        target: {
          value: 'Updated strategy text',
        },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(onSubmitEditedMessage).toHaveBeenCalledTimes(1);
      });

      const submittedMessage = onSubmitEditedMessage.mock.calls[0][0] as Message;
      const textParts = submittedMessage.content.filter((part) => part.type === 'text');

      expect(textParts).toEqual([
        { type: 'text', text: 'Updated strategy text' },
      ]);
      expect(submittedMessage.content.some((part) => part.type === 'file')).toBe(true);
    } finally {
      window.removeEventListener('chatInput:confirmInlineEditRequest', confirmRequestListener as EventListener);
    }
  });

  it('keeps inline edit text and attachments isolated from the bottom composer', () => {
    const { container } = render(
      <>
        <ChatInput
          onSendMessage={vi.fn()}
  
        />
        <ChatInput
          onSendMessage={vi.fn()}
  
          mode="edit-inline"
          initialMessage={createMessageWithAttachment()}
          onSubmitEditedMessage={vi.fn()}
          onCancelEdit={vi.fn()}
        />
      </>,
    );

    const textboxes = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    expect(textboxes).toHaveLength(2);
    expect(textboxes[0].value).toBe('');
    expect(textboxes[1].value).toBe('[#skill:figma-make]');

    const chatInputs = container.querySelectorAll('.chat-input-container');
    expect(chatInputs).toHaveLength(2);
    expect(chatInputs[0]).not.toHaveTextContent('design-spec.md');
    expect(chatInputs[1]).toHaveTextContent('design-spec.md');
  });

  it('contains inline edit submission failures after confirmation instead of surfacing an uncaught rejection', async () => {
    const rejection = new Error('prompt token count of 472939 exceeds the limit of 168000');
    const onSubmitEditedMessage = vi.fn().mockRejectedValue(rejection);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const confirmRequestListener = vi.fn((event: Event) => {
      const customEvent = event as CustomEvent<{
        requestId?: string;
      }>;

      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditResult', {
        detail: {
          requestId: customEvent.detail?.requestId,
          confirmed: true,
        },
      }));
    });

    window.addEventListener('chatInput:confirmInlineEditRequest', confirmRequestListener as EventListener);

    try {
      render(
        <ChatInput
          onSendMessage={vi.fn()}
  
          mode="edit-inline"
          initialMessage={createMessageWithAttachment()}
          onSubmitEditedMessage={onSubmitEditedMessage}
          onCancelEdit={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(confirmRequestListener).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(onSubmitEditedMessage).toHaveBeenCalledTimes(1);
      });

      await expect(waitFor(() => {
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      })).resolves.toBeUndefined();
    } finally {
      consoleErrorSpy.mockRestore();
      window.removeEventListener('chatInput:confirmInlineEditRequest', confirmRequestListener as EventListener);
    }
  });

  it('keeps the send button disabled while chat status is sending_response', () => {
    mockSessionIdle.value = false;
    const onSendMessage = vi.fn();
    const { container } = render(
      <ChatInput
        onSendMessage={onSendMessage}
      />,
    );

    const textarea = container.querySelector('textarea');

    expect(textarea).toBeInTheDocument();

    fireEvent.change(textarea!, {
      target: {
        value: 'hello',
      },
    });

    const cancelButton = screen.getByTitle('Cancel Chat');
    expect(cancelButton).toBeInTheDocument();

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('keeps inline edit actions visible when chat status is not provided', () => {
    render(
      <ChatInput
        onSendMessage={vi.fn()}
        mode="edit-inline"
        initialMessage={createMessageWithAttachment()}
        onSubmitEditedMessage={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows the cancel chat button and calls onCancelChat while the chat is active', () => {
    mockSessionIdle.value = false;
    render(
      <ChatInput
        onSendMessage={vi.fn()}
      />,
    );

    const cancelButton = screen.getByTitle('Cancel Chat');
    expect(cancelButton).toBeInTheDocument();
  });

  it('does not show the cancel chat button when the chat is idle', () => {
    render(
      <ChatInput
        onSendMessage={vi.fn()}
      />,
    );

    expect(screen.queryByTitle('Cancel Chat')).not.toBeInTheDocument();
  });
});