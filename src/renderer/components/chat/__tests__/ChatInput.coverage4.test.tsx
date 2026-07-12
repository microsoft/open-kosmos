// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * ChatInput coverage4 — targets the remaining uncovered branches:
 * - handleUnifiedFileInputChange (browser file input): 508, 514, 519, 524-528,
 *   533, 537, 550-551, 562
 * - handleDrop path resolution: 310 (false), 315 (catch), 320-324, 329/333
 * - handleDragEnter with Files (274); handleDragLeave inside bounds (288 false)
 * - handleElectronFileSelect: image without support (447 else), inner processing
 *   error (468-469), getFileTypeFromPath no-extension (482)
 * - handleSend locked early-return (568-569)
 * - handleSend focus with real textareaRef (655-656)
 * - VoiceInputButton onTranscript callback (802, 804-805, 808-816)
 * - error bar render branch (712)
 *
 * Key harness differences vs coverage3:
 *  - TextArea mock forwards `textareaRef` so textareaRef.current is a real node
 *  - ModelSelector mock reads `mockSupportsImages.value` for setSupportsImages
 *  - textareaManager.set invokes updater functions so the voice updater body runs
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const {
  mockShowToast,
  mockCancelChat,
  mockScreenshotCapture,
  mockProfileDataManager,
  mockEditAgentToggle,
  mockAttachMenuToggle,
  mockVoiceInputEnabled,
  mockVoiceFeatureFlag,
  mockCurrentSessionError,
  mockSubscribeCbRef,
  mockIsOffice,
  mockIsText,
  mockIsImage,
  mockIsOthers,
  mockShouldCompress,
  mockSmartCompress,
  mockSessionIdle,
  mockAddImage,
  mockAddFile,
  mockAddOffice,
  mockAddOthers,
  mockSupportsImages,
  mockPrevValue,
} = vi.hoisted(() => {
  return {
    mockShowToast: vi.fn(),
    mockCancelChat: vi.fn().mockResolvedValue(undefined),
    mockScreenshotCapture: vi.fn(),
    mockProfileDataManager: {
      getSelectedModel: vi.fn(() => 'model-1'),
      subscribe: vi.fn(() => vi.fn()),
      addPromptToHistory: vi.fn(),
      getPreviousPrompt: vi.fn(() => null),
      getNextPrompt: vi.fn(() => null),
      setCurrentEditingPrompt: vi.fn(),
      getCurrentAgent: vi.fn(() => null),
    },
    mockEditAgentToggle: vi.fn(),
    mockAttachMenuToggle: vi.fn(),
    mockVoiceInputEnabled: { value: false },
    mockVoiceFeatureFlag: { value: false },
    mockCurrentSessionError: { value: null as string | null },
    mockSubscribeCbRef: { cb: null as (() => void) | null },
    mockIsOffice: vi.fn(() => false),
    mockIsText: vi.fn(() => false),
    mockIsImage: vi.fn(() => false),
    mockIsOthers: vi.fn(() => false),
    mockShouldCompress: vi.fn(() => false),
    mockSmartCompress: vi.fn().mockResolvedValue({
      compressedFile: new File(['x'], 'img.png', { type: 'image/png' }),
    }),
    mockSessionIdle: { value: true },
    mockAddImage: vi.fn().mockResolvedValue(undefined),
    mockAddFile: vi.fn().mockResolvedValue(undefined),
    mockAddOffice: vi.fn().mockResolvedValue(undefined),
    mockAddOthers: vi.fn().mockResolvedValue(undefined),
    mockSupportsImages: { value: true },
    mockPrevValue: { value: 'existing' },
  };
});

vi.mock('../../../styles/ChatInput.css', () => ({}));
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showToast: mockShowToast, showError: vi.fn() }),
}));
vi.mock('../../../lib/chat/agentChatIpc', () => ({
  agentChatIpc: { cancelChat: mockCancelChat, streamMessage: vi.fn() },
}));
vi.mock('lucide-react', () => ({
  Globe: () => <span data-testid="globe-icon" />,
}));
vi.mock('../../../ipc/screenshot-main', () => ({
  screenshotApi: { capture: mockScreenshotCapture },
}));
vi.mock('../ErrorBar', () => ({ default: () => <div data-testid="error-bar" /> }));
vi.mock('../VoiceInputButton', () => ({
  VoiceInputButton: ({ onTranscript, disabled }: any) => (
    <button data-testid="voice-btn" disabled={disabled} onClick={() => onTranscript('hello', true)}>Voice</button>
  ),
}));
vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: () => mockVoiceFeatureFlag.value,
}));
vi.mock('../../../lib/userData', () => ({
  useVoiceInputEnabled: () => mockVoiceInputEnabled.value,
}));
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: vi.fn(() => 'chat-1'),
    subscribeToCurrentChatSessionId: vi.fn((cb: () => void) => {
      mockSubscribeCbRef.cb = cb;
      return vi.fn();
    }),
  },
  CurrentSessionError: { use: () => mockCurrentSessionError.value },
  CurrentSessionIdle: { use: () => mockSessionIdle.value },
}));
vi.mock('../../../lib/userData/profileDataManager', () => ({
  profileDataManager: mockProfileDataManager,
}));
vi.mock('../../userData/userDataProvider', () => ({
  useAgentConfig: () => ({ updateModel: vi.fn(async () => ({ success: true })), isLoading: false }),
  useProfileData: () => ({}),
  useChats: () => ({}),
}));
vi.mock('../../../lib/models/ghcModels', () => ({
  getModelById: vi.fn(() => ({ name: 'Mock Model' })),
  getModelCapabilities: vi.fn(() => ({ supportsImages: true })),
  getAllOpenKosmosUsedModels: vi.fn(() => [
    { id: 'model-1', name: 'Mock Model', capabilities: { family: 'gpt', supports: { tool_calls: true, vision: true } } },
  ]),
}));

const attachmentManagerMock = {
  addImage: mockAddImage,
  addFile: mockAddFile,
  addOffice: mockAddOffice,
  addOthers: mockAddOthers,
  loadFromMessage: vi.fn(),
  clear: vi.fn(),
  createMessage: vi.fn((text: string) => ({ role: 'user', content: [{ type: 'text', text }] })),
  get: vi.fn(() => []),
};

vi.mock('../chat-input/Attachments', () => {
  const createAttachmentsAtom = vi.fn(() => ({ useChange: () => attachmentManagerMock, use: () => [] }));
  return { createAttachmentsAtom, AttachmentList: () => null, AttachmentsStatus: () => null };
});

const textareaManagerMock = {
  // Invoke updater functions so functional-set callbacks (e.g. the voice updater) run.
  set: vi.fn((arg: any) => { if (typeof arg === 'function') return arg(mockPrevValue.value); }),
  get: vi.fn(() => 'hello world'),
};

vi.mock('../chat-input/Textarea', () => ({
  createTextareaAtom: vi.fn(() => ({ useChange: () => textareaManagerMock, use: () => 'hello world' })),
  // Forward textareaRef so textareaRef.current is a real DOM node.
  TextArea: ({ handleSend, textareaRef }: any) => (
    <textarea
      ref={textareaRef}
      data-testid="textarea"
      role="textbox"
      onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
    />
  ),
}));

vi.mock('../chat-input/ModelSelector', () => ({
  ModelSelector: ({ setSupportsImages }: any) => {
    React.useEffect(() => { setSupportsImages?.(mockSupportsImages.value); }, []);
    return null;
  },
}));
vi.mock('../chat-input/ReasoningEffortSelector', () => ({ ReasoningEffortSelector: () => null }));
vi.mock('../chat-input/Icons', () => ({
  attachment_icon_1: <span>attach1</span>,
  attachment_icon_2: <span>attach2</span>,
  cancel_icon: <span>cancel</span>,
  send_icon: <span>send</span>,
  send_icon_disabled: <span>send-disabled</span>,
  send_icon_spin: <span>send-spin</span>,
}));

vi.mock('../../../lib/utilities/contentUtils', () => ({
  ContentPartFactory: { createText: (text: string) => ({ type: 'text', text }) },
  ContentConverter: {
    fileToImageContent: vi.fn().mockResolvedValue({ type: 'image', image_url: { url: 'data:image/png;base64,abc' }, metadata: {} }),
    fileToFileContent: vi.fn().mockResolvedValue({ type: 'file', file: { fileName: 'test.txt', content: 'hello' }, metadata: {} }),
    fileToOfficeContent: vi.fn().mockResolvedValue({ type: 'office', file: { fileName: 'doc.docx', content: '' }, metadata: {} }),
    fileToOthersContent: vi.fn().mockResolvedValue({ type: 'others', file: { fileName: 'archive.zip' }, metadata: {} }),
  },
  ContentAnalyzer: { analyzeContent: vi.fn(() => ({ totalCount: 0 })) },
  FileProcessor: {
    isOfficeFile: (f: File) => mockIsOffice(f),
    isTextFile: (f: File) => mockIsText(f),
    isImageFile: (f: File) => mockIsImage(f),
    isOthersFile: (f: File) => mockIsOthers(f),
    fileToDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
  },
  formatFileSize: vi.fn(() => '1 KB'),
}));

vi.mock('../../../lib/utilities/imageCompression', () => ({
  smartCompressImageVSCodeOfficial: mockSmartCompress,
  shouldCompressImage: mockShouldCompress,
  VSCODE_IMAGE_LIMITS: {},
}));
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../../../lib/chat/chatInputKeyboard', () => ({
  getChatInputEnterAction: vi.fn(() => 'send'),
  getChatInputShortcutHint: vi.fn(() => 'Enter to send'),
}));
vi.mock('../../ui/FileTypeIcon', () => ({ default: () => <div data-testid="file-type-icon" /> }));
vi.mock('../chat-input/ContextMenu', () => ({ ContextMenu: () => null }));
vi.mock('../chat-input/context-menu.atom', () => ({
  ContextMenuAtom: {
    use: () => [
      { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
      { triggerMenu: vi.fn(), closeMenu: vi.fn(), navigateMenu: vi.fn(), hoverMenu: vi.fn(), selectMenu: vi.fn() },
    ],
  },
  zeroContextMenuState: { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
}));
vi.mock('../../../lib/chat/contextMentions', () => ({
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
vi.mock('../../../lib/workspace/workspaceSearchService', () => ({ quickSearchFiles: vi.fn() }));
vi.mock('../../menu/EditAgentMenuDropdown', () => ({
  EditAgentMenuAtom: { useChange: () => ({ toggle: mockEditAgentToggle }) },
}));
vi.mock('../../menu/AttachMenuDropdown', () => ({
  AttachMenuAtom: { useChange: () => ({ toggle: mockAttachMenuToggle }) },
}));
vi.mock('@/atom', async () => {
  const original = await vi.importActual('@/atom');
  return {
    ...original,
    atom: (getter: any) => {
      const value = typeof getter === 'function' ? true : getter;
      return { use: () => value, useChange: () => vi.fn() };
    },
  };
});
vi.mock('@shared/types/chatTypes', async () => {
  const orig = await vi.importActual('@shared/types/chatTypes') as any;
  return { ...orig, validateImageFile: vi.fn(() => true), MessageHelper: { getText: vi.fn(() => '') } };
});

import ChatInput from '../ChatInput';

function setupElectronApi(overrides: any = {}) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true, configurable: true,
    value: {
      fs: {
        getPathForFile: vi.fn((f: File) => `/full/path/${f.name}`),
        selectFiles: vi.fn().mockResolvedValue({ success: false, filePaths: [] }),
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 1024, mtime: 100 } }),
        readFile: vi.fn().mockResolvedValue({ success: true, content: btoa('PNG') }),
        ...overrides.fs,
      },
      ...overrides,
    },
  });
}

function makeFile(name: string, type = 'text/plain', size = 100) {
  return new File(['x'.repeat(size)], name, { type });
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('ChatInput — coverage4 (remaining branches)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
    mockVoiceFeatureFlag.value = false;
    mockVoiceInputEnabled.value = false;
    mockCurrentSessionError.value = null;
    mockSessionIdle.value = true;
    mockSubscribeCbRef.cb = null;
    mockIsOffice.mockReturnValue(false);
    mockIsText.mockReturnValue(false);
    mockIsImage.mockReturnValue(false);
    mockIsOthers.mockReturnValue(false);
    mockShouldCompress.mockReturnValue(false);
    mockSmartCompress.mockResolvedValue({ compressedFile: new File(['x'], 'img.png', { type: 'image/png' }) });
    mockProfileDataManager.getCurrentAgent.mockReturnValue(null);
    mockAddImage.mockResolvedValue(undefined);
    mockAddFile.mockResolvedValue(undefined);
    mockAddOffice.mockResolvedValue(undefined);
    mockAddOthers.mockResolvedValue(undefined);
    mockSupportsImages.value = true;
    textareaManagerMock.get.mockReturnValue('hello world');
    setupElectronApi();
    class ResizeObserverMock { observe() {} disconnect() {} unobserve() {} }
    Object.defineProperty(window, 'ResizeObserver', { writable: true, configurable: true, value: ResizeObserverMock });
  });

  // ── handleUnifiedFileInputChange (browser file input) ──────────────────────

  describe('handleUnifiedFileInputChange', () => {
    it('image with support: getPathForFile resolves, calls addImage and resets input (514, 533, 550-551, 562)', async () => {
      mockIsImage.mockImplementation((f: File) => f.type.startsWith('image/'));
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {}); // let ModelSelector effect set supportsImages
      const input = getFileInput();
      await act(async () => {
        fireEvent.change(input, { target: { files: [makeFile('p.png', 'image/png')] } });
      });
      await waitFor(() => expect(mockAddImage).toHaveBeenCalled());
      expect(input.value).toBe('');
    });

    it('getPathForFile throws → catch (519), falls back to file.path (524-528)', async () => {
      setupElectronApi({ fs: { getPathForFile: vi.fn(() => { throw new Error('webUtils fail'); }) } });
      mockIsText.mockReturnValue(true);
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      const input = getFileInput();
      const f = makeFile('notes.txt', 'text/plain');
      Object.defineProperty(f, 'path', { value: '/disk/notes.txt', configurable: true });
      await act(async () => { fireEvent.change(input, { target: { files: [f] } }); });
      await waitFor(() => expect(mockAddFile).toHaveBeenCalled());
    });

    it('no getPathForFile and no file.path → else branch (537), still processes file', async () => {
      setupElectronApi({ fs: { getPathForFile: undefined } });
      mockIsText.mockReturnValue(true);
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      const input = getFileInput();
      await act(async () => {
        fireEvent.change(input, { target: { files: [makeFile('plain.txt', 'text/plain')] } });
      });
      await waitFor(() => expect(mockAddFile).toHaveBeenCalled());
    });

    it('image without support → alert and no addImage (550 else)', async () => {
      mockSupportsImages.value = false;
      mockIsImage.mockImplementation((f: File) => f.type.startsWith('image/'));
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      const input = getFileInput();
      await act(async () => {
        fireEvent.change(input, { target: { files: [makeFile('p.png', 'image/png')] } });
      });
      await waitFor(() =>
        expect(window.alert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(expect.stringContaining('does not support images')),
      );
      expect(mockAddImage).not.toHaveBeenCalled();
    });

    it('null files → if(files) false, no handlers invoked (508 false)', async () => {
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      const input = getFileInput();
      await act(async () => { fireEvent.change(input, { target: { files: null } }); });
      expect(mockAddFile).not.toHaveBeenCalled();
      expect(mockAddImage).not.toHaveBeenCalled();
    });
  });

  // ── handleDrop path resolution ─────────────────────────────────────────────

  describe('handleDrop path resolution', () => {
    it('getPathForFile throws → catch (315), falls back to file.path (320-324, 329)', async () => {
      setupElectronApi({ fs: { getPathForFile: vi.fn(() => { throw new Error('drop webUtils fail'); }) } });
      mockIsText.mockReturnValue(true);
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      const container = document.querySelector('.chat-input-container') as HTMLElement;
      const f = makeFile('drop.txt', 'text/plain');
      Object.defineProperty(f, 'path', { value: '/disk/drop.txt', configurable: true });
      await act(async () => { fireEvent.drop(container, { dataTransfer: { files: [f] } }); });
      await waitFor(() => expect(mockAddFile).toHaveBeenCalled());
    });

    it('no getPathForFile and no file.path → 310 false, 322 false, else branch (333)', async () => {
      setupElectronApi({ fs: { getPathForFile: undefined } });
      mockIsText.mockReturnValue(true);
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      const container = document.querySelector('.chat-input-container') as HTMLElement;
      await act(async () => {
        fireEvent.drop(container, { dataTransfer: { files: [makeFile('nopath.txt', 'text/plain')] } });
      });
      await waitFor(() => expect(mockAddFile).toHaveBeenCalled());
    });
  });

  // ── drag enter / leave ─────────────────────────────────────────────────────

  describe('drag enter / leave branches', () => {
    it('dragEnter with Files in types sets drag-over (274)', async () => {
      render(<ChatInput onSendMessage={vi.fn()} />);
      const container = document.querySelector('.chat-input-container') as HTMLElement;
      await act(async () => {
        fireEvent.dragEnter(container, { dataTransfer: { types: ['Files'] } });
      });
      expect(container.className).toContain('drag-over');
    });

    it('dragLeave inside bounds does NOT clear drag-over (288 false branch)', async () => {
      const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);
      try {
        render(<ChatInput onSendMessage={vi.fn()} />);
        const container = document.querySelector('.chat-input-container') as HTMLElement;
        // First enter to set drag-over
        await act(async () => { fireEvent.dragEnter(container, { dataTransfer: { types: ['Files'] } }); });
        // Leave with coords strictly inside [0,100): condition is false → still drag-over
        await act(async () => { fireEvent.dragLeave(container, { clientX: 50, clientY: 50 }); });
        expect(container.className).toContain('drag-over');
      } finally {
        rectSpy.mockRestore();
      }
    });
  });

  // ── handleElectronFileSelect branches ──────────────────────────────────────

  describe('handleElectronFileSelect', () => {
    it('image path without support → alert (447 else)', async () => {
      mockSupportsImages.value = false;
      const selectFiles = vi.fn().mockResolvedValue({ success: true, filePaths: ['/tmp/pic.png'] });
      const stat = vi.fn().mockResolvedValue({ success: true, stats: { size: 10, mtime: 0 } });
      const readFile = vi.fn().mockResolvedValue({ success: true, content: btoa('PNG') });
      setupElectronApi({ fs: { selectFiles, stat, readFile, getPathForFile: vi.fn() } });
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      await act(async () => { window.dispatchEvent(new CustomEvent('chatInput:selectFiles')); });
      await waitFor(() =>
        expect(window.alert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(expect.stringContaining('does not support images')),
      );
    });

    it('inner processing error (stat rejects) → catch (468-469) alerts', async () => {
      const selectFiles = vi.fn().mockResolvedValue({ success: true, filePaths: ['/tmp/x.png'] });
      const stat = vi.fn().mockRejectedValue(new Error('stat boom'));
      setupElectronApi({ fs: { selectFiles, stat, getPathForFile: vi.fn() } });
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      await act(async () => { window.dispatchEvent(new CustomEvent('chatInput:selectFiles')); });
      await waitFor(() =>
        expect(window.alert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(expect.stringContaining('processing the selected files')),
      );
    });

    it('path without extension → getFileTypeFromPath "" fallback (482), processes as non-image', async () => {
      const selectFiles = vi.fn().mockResolvedValue({ success: true, filePaths: ['/tmp/file.'] });
      const stat = vi.fn().mockResolvedValue({ success: true, stats: { size: 5, mtime: 0 } });
      setupElectronApi({ fs: { selectFiles, stat, getPathForFile: vi.fn() } });
      mockIsOthers.mockReturnValue(true);
      render(<ChatInput onSendMessage={vi.fn()} />);
      await act(async () => {});
      await act(async () => { window.dispatchEvent(new CustomEvent('chatInput:selectFiles')); });
      await waitFor(() => expect(mockAddOthers).toHaveBeenCalled());
    });
  });

  // ── handleSend locked + focus ──────────────────────────────────────────────

  describe('handleSend', () => {
    it('locked compose returns early, does not send (568-569)', async () => {
      const onSendMessage = vi.fn();
      render(<ChatInput onSendMessage={onSendMessage} isInputLocked />);
      const textarea = screen.getByRole('textbox');
      await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('compose send focuses the real textareaRef (655-656)', async () => {
      const onSendMessage = vi.fn();
      render(<ChatInput onSendMessage={onSendMessage} />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      const focusSpy = vi.spyOn(textarea, 'focus');
      await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
      expect(onSendMessage).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('busy external agents do not expose or create queued drafts', async () => {
      mockSessionIdle.value = false;
      mockProfileDataManager.getCurrentAgent.mockReturnValue({ source: 'EXTERNAL' });
      const onSendMessage = vi.fn();

      render(<ChatInput onSendMessage={onSendMessage} />);
      textareaManagerMock.set.mockClear();

      expect(screen.getByRole('button', { name: 'Cancel current response' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Queue message after current response' })).not.toBeInTheDocument();

      await act(async () => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });

      expect(mockShowToast).toHaveBeenCalledWith(
        'External agent is still responding. Please wait before sending another message.',
        'warning',
      );
      expect(onSendMessage).not.toHaveBeenCalled();
      expect(textareaManagerMock.set).not.toHaveBeenCalledWith('');
    });
  });

  // ── Voice transcript callback ──────────────────────────────────────────────

  describe('VoiceInputButton onTranscript callback', () => {
    it('final transcript with existing text appends and focuses (802, 805 truthy, 808-816)', async () => {
      mockVoiceFeatureFlag.value = true;
      mockVoiceInputEnabled.value = true;
      textareaManagerMock.get.mockReturnValue('existing');
      render(<ChatInput onSendMessage={vi.fn()} />);
      const voiceBtn = screen.getByTestId('voice-btn');
      await act(async () => {
        fireEvent.click(voiceBtn);
        await new Promise((r) => setTimeout(r, 5));
      });
      // The final transcript appends to the existing draft.
      expect(textareaManagerMock.set).toHaveBeenCalled();
      expect(textareaManagerMock.set).toHaveBeenCalledWith('existing hello');
    });

    it('final transcript with empty previous uses transcript only (805 falsy branch)', async () => {
      mockVoiceFeatureFlag.value = true;
      mockVoiceInputEnabled.value = true;
      textareaManagerMock.get.mockReturnValue('');
      render(<ChatInput onSendMessage={vi.fn()} />);
      const voiceBtn = screen.getByTestId('voice-btn');
      await act(async () => {
        fireEvent.click(voiceBtn);
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(textareaManagerMock.set).toHaveBeenCalledWith('hello');
    });
  });

  // ── error bar render branch (712) ──────────────────────────────────────────

  describe('error bar', () => {
    it('renders ErrorBar when not edit mode, error present, and chatSessionId set (712)', () => {
      mockCurrentSessionError.value = 'Something failed';
      render(<ChatInput onSendMessage={vi.fn()} chatSessionId="cs-1" />);
      expect(screen.getByTestId('error-bar')).toBeInTheDocument();
    });
  });
});
