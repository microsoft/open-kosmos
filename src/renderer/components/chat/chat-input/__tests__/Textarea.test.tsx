/**
 * @vitest-environment happy-dom
 */
import React, { createRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/userData/profileDataManager', () => ({
  profileDataManager: {
    getPreviousPrompt: vi.fn(() => null),
    getNextPrompt: vi.fn(() => null),
    setCurrentEditingPrompt: vi.fn(),
  },
}));

vi.mock('@shared/types/chatTypes', () => ({
  validateImageFile: vi.fn(() => true),
}));

// MentionHighlight lives at chat/MentionHighlight.tsx (one level above chat-input/)
vi.mock('../../MentionHighlight', () => ({
  MentionHighlight: () => <div data-testid="mention-highlight" />,
}));

const mockGetChatInputEnterAction = vi.fn();
vi.mock('@/lib/chat/chatInputKeyboard', () => ({
  getChatInputEnterAction: (...args: any[]) => mockGetChatInputEnterAction(...args),
}));

vi.mock('@/lib/chat/contextMentions', () => ({
  getCurrentSearchQuery: vi.fn(() => ''),
  insertMention: vi.fn((text: string, cursor: number, path: string) => ({
    newText: text + path,
    newCursorPos: cursor + path.length,
  })),
  insertSkillMention: vi.fn((text: string, cursor: number, name: string) => ({
    newText: text + name,
    newCursorPos: cursor + name.length,
  })),
  ContextMenuOptionType: {
    KnowledgeBase: 'KnowledgeBase',
    ChatSession: 'ChatSession',
    Skill: 'Skill',
    NoResults: 'NoResults',
  },
  ContextMenuTriggerType: {
    Workspace: 'Workspace',
    Skill: 'Skill',
  },
  MentionSourceType: {
    KnowledgeBase: 'KnowledgeBase',
    ChatSession: 'ChatSession',
  },
  getContextMenuTriggerType: vi.fn(() => null),
  getCurrentSkillSearchQuery: vi.fn(() => ''),
}));

// ContextMenuAtom mock
const mockTriggerMenu = vi.fn();
const mockCloseMenu = vi.fn();
const mockNavigateMenu = vi.fn();
const mockHoverMenu = vi.fn();
const mockSelectMenu = vi.fn();

const mockContextMenuState = {
  show: false,
  options: [] as any[],
  selectedIndex: 0,
  position: { top: 0, left: 0, width: 0 },
};

vi.mock('../context-menu.atom', () => ({
  ContextMenuAtom: {
    use: () => [
      mockContextMenuState,
      {
        triggerMenu: mockTriggerMenu,
        closeMenu: mockCloseMenu,
        navigateMenu: mockNavigateMenu,
        hoverMenu: mockHoverMenu,
        selectMenu: mockSelectMenu,
      },
    ],
  },
  zeroContextMenuState: {
    show: false,
    options: [],
    selectedIndex: 0,
    position: { top: 0, left: 0, width: 0 },
  },
}));

// atom mock — simple state store backed by useState
vi.mock('@/atom', () => ({
  atom: (initialValue: any) => ({
    use: () => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [val, setVal] = React.useState(initialValue);
      return [val, { set: setVal }];
    },
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

import { TextArea, createTextareaAtom } from '../Textarea';

function renderTextArea(overrides?: Partial<React.ComponentProps<typeof TextArea>>) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  const textareaStateAtom = createTextareaAtom();

  const handleSend = vi.fn();
  const handleImageSelect = vi.fn().mockResolvedValue(undefined);

  // Wrap in a stateful component so the atom's useState works
  function Wrapper(props: Partial<React.ComponentProps<typeof TextArea>>) {
    return (
      <TextArea
        textareaRef={textareaRef as any}
        readOnly={false}
        title="Chat input"
        supportsImages={false}
        handleSend={handleSend}
        handleImageSelect={handleImageSelect}
        textareaStateAtom={textareaStateAtom}
        {...props}
      />
    );
  }

  const utils = render(<Wrapper {...overrides} />);
  return { ...utils, handleSend, handleImageSelect, textareaRef };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TextArea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mutable shared state
    mockContextMenuState.show = false;
    mockContextMenuState.options = [];
    mockContextMenuState.selectedIndex = 0;
    mockGetChatInputEnterAction.mockReturnValue('send');
  });

  it('renders a textarea element', () => {
    renderTextArea();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('renders the MentionHighlight layer', () => {
    renderTextArea();
    expect(screen.getByTestId('mention-highlight')).toBeTruthy();
  });

  it('sets readOnly attribute correctly', () => {
    renderTextArea({ readOnly: true });
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.readOnly).toBe(true);
  });

  it('shows image-aware placeholder when supportsImages=true', () => {
    renderTextArea({ supportsImages: true });
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.placeholder).toContain('images');
  });

  it('shows plain placeholder when supportsImages=false', () => {
    renderTextArea({ supportsImages: false });
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.placeholder).not.toContain('images');
  });

  it('calls handleSend on Enter key when enterAction=send', () => {
    mockGetChatInputEnterAction.mockReturnValue('send');
    const { handleSend } = renderTextArea();
    const ta = screen.getByRole('textbox');
    fireEvent.keyDown(ta, { key: 'Enter', nativeEvent: { isComposing: false } });
    expect(handleSend).toHaveBeenCalled();
  });

  it('does not call handleSend when enterAction=ignore', () => {
    mockGetChatInputEnterAction.mockReturnValue('ignore');
    const { handleSend } = renderTextArea();
    const ta = screen.getByRole('textbox');
    fireEvent.keyDown(ta, { key: 'Enter', nativeEvent: { isComposing: false } });
    expect(handleSend).not.toHaveBeenCalled();
  });

  it('updates textarea value on change', () => {
    renderTextArea();
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hello world', selectionStart: 11 } });
    expect(ta.value).toBe('hello world');
  });

  it('trims and inserts pasted plain text', () => {
    renderTextArea();
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

    const clipboardData = {
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? '  pasted  ' : ''),
      items: [],
    };

    fireEvent.paste(ta, { clipboardData });
    expect(ta.value).toBe('pasted');
  });

  it('does NOT process image paste when supportsImages=false', () => {
    const { handleImageSelect } = renderTextArea({ supportsImages: false });
    const ta = screen.getByRole('textbox');

    const imageItem = {
      type: 'image/png',
      getAsFile: () => new File(['img'], 'img.png', { type: 'image/png' }),
    };

    const clipboardData = {
      types: [],
      getData: () => '',
      items: [imageItem],
    };

    fireEvent.paste(ta, { clipboardData });
    expect(handleImageSelect).not.toHaveBeenCalled();
  });

  it('processes image paste when supportsImages=true', async () => {
    const { handleImageSelect } = renderTextArea({ supportsImages: true });
    const ta = screen.getByRole('textbox');

    const imageItem = {
      type: 'image/png',
      getAsFile: () => new File(['img'], 'img.png', { type: 'image/png' }),
    };

    const clipboardData = {
      types: [],
      getData: () => '',
      items: [imageItem],
    };

    await act(async () => {
      fireEvent.paste(ta, { clipboardData });
    });

    expect(handleImageSelect).toHaveBeenCalled();
  });

  it('fills input when agent:fillInput event is dispatched', async () => {
    renderTextArea();
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('agent:fillInput', { detail: { text: 'auto-filled text' } }),
      );
    });

    expect(ta.value).toBe('auto-filled text');
  });

  it('inserts @ on chatInput:triggerMention event', async () => {
    renderTextArea({ enableContextMenu: true });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:triggerMention'));
      await new Promise(r => setTimeout(r, 100));
    });

    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe('@');
  });

  it('closes context menu on Escape key when menu is open', () => {
    mockContextMenuState.show = true;
    mockContextMenuState.options = [
      { type: 'KnowledgeBase', fileName: 'file.md', relativePath: '/file.md' },
    ];

    renderTextArea({ enableContextMenu: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(mockCloseMenu).toHaveBeenCalled();
  });

  it('navigates context menu down with ArrowDown key when menu is open', () => {
    mockContextMenuState.show = true;
    mockContextMenuState.options = [
      { type: 'KnowledgeBase', fileName: 'a.md', relativePath: '/a.md' },
      { type: 'KnowledgeBase', fileName: 'b.md', relativePath: '/b.md' },
    ];

    renderTextArea({ enableContextMenu: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });
    expect(mockNavigateMenu).toHaveBeenCalledWith('down');
  });

  it('navigates context menu up with ArrowUp key when menu is open', () => {
    mockContextMenuState.show = true;
    mockContextMenuState.options = [
      { type: 'KnowledgeBase', fileName: 'a.md', relativePath: '/a.md' },
      { type: 'KnowledgeBase', fileName: 'b.md', relativePath: '/b.md' },
    ];

    renderTextArea({ enableContextMenu: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp' });
    expect(mockNavigateMenu).toHaveBeenCalledWith('up');
  });
});
