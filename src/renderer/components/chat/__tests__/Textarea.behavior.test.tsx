/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockProfileDataManager,
  mockGetChatInputEnterAction,
  mockContextMenuState,
  mockContextMenuActions,
  mockGetContextMenuTriggerType,
  mockGetCurrentSearchQuery,
  mockGetCurrentSkillSearchQuery,
  mockInsertMention,
  mockInsertSkillMention,
  MockContextMenuOptionType,
  MockContextMenuTriggerType,
  MockMentionSourceType,
} = vi.hoisted(() => {
  const MockContextMenuOptionType = {
    KnowledgeBase: 'knowledge_base',
    ChatSession: 'chat_session',
    Skill: 'skill',
  };
  const MockContextMenuTriggerType = {
    Workspace: 'workspace',
    Skill: 'skill',
  };
  const MockMentionSourceType = {
    KnowledgeBase: 'knowledge_base',
    ChatSession: 'chat_session',
  };
  return {
    mockProfileDataManager: {
      setCurrentEditingPrompt: vi.fn(),
      getPreviousPrompt: vi.fn(() => null as string | null),
      getNextPrompt: vi.fn(() => null as string | null),
    },
    mockGetChatInputEnterAction: vi.fn(() => 'send'),
    mockContextMenuState: {
      value: { show: false, options: [] as any[], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
    },
    mockContextMenuActions: {
      triggerMenu: vi.fn(),
      closeMenu: vi.fn(),
      navigateMenu: vi.fn(),
      hoverMenu: vi.fn(),
      selectMenu: vi.fn(),
    },
    mockGetContextMenuTriggerType: vi.fn((): any => null),
    mockGetCurrentSearchQuery: vi.fn(() => 'workspace-query'),
    mockGetCurrentSkillSearchQuery: vi.fn(() => 'skill-query'),
    mockInsertMention: vi.fn((text: string, cursor: number, path: string, source?: string) => ({
      newText: `${text}|${path}|${source ?? 'none'}`,
      newCursorPos: cursor + path.length,
    })),
    mockInsertSkillMention: vi.fn((text: string, cursor: number, skillName: string) => ({
      newText: `${text}|#${skillName}`,
      newCursorPos: cursor + skillName.length,
    })),
    MockContextMenuOptionType,
    MockContextMenuTriggerType,
    MockMentionSourceType,
  };
});

vi.mock('../../../lib/userData/profileDataManager', () => ({
  profileDataManager: mockProfileDataManager,
}));
vi.mock('../../../lib/chat/chatInputKeyboard', () => ({
  getChatInputEnterAction: mockGetChatInputEnterAction,
}));
vi.mock('../../../lib/chat/contextMentions', () => ({
  getCurrentSearchQuery: mockGetCurrentSearchQuery,
  insertMention: mockInsertMention,
  ContextOption: {},
  ContextMenuOptionType: MockContextMenuOptionType,
  ContextMenuTriggerType: MockContextMenuTriggerType,
  MentionSourceType: MockMentionSourceType,
  getContextMenuTriggerType: mockGetContextMenuTriggerType,
  getCurrentSkillSearchQuery: mockGetCurrentSkillSearchQuery,
  insertSkillMention: mockInsertSkillMention,
}));
vi.mock('../MentionHighlight', () => ({
  MentionHighlight: ({ text }: { text: string }) => <div data-testid="highlight">{text}</div>,
}));
vi.mock('../chat-input/context-menu.atom', () => ({
  ContextMenuAtom: {
    use: () => [mockContextMenuState.value, mockContextMenuActions],
  },
  zeroContextMenuState: { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } },
}));

import { createTextareaAtom, TextArea } from '../chat-input/Textarea';

function renderTextArea(options: {
  enableContextMenu?: boolean;
  handleSend?: () => void;
  handleImageSelect?: (file: File) => Promise<void>;
  onDraftChange?: (text: string) => void;
  supportsImages?: boolean;
  updatePromptHistoryDraft?: boolean;
} = {}) {
  const textareaRef = React.createRef<HTMLTextAreaElement>();
  const result = render(
    <TextArea
      textareaRef={textareaRef}
      readOnly={false}
      title="Enter to send"
      supportsImages={options.supportsImages ?? true}
      enableContextMenu={options.enableContextMenu}
      handleSend={options.handleSend ?? vi.fn()}
      handleImageSelect={options.handleImageSelect ?? vi.fn()}
      textareaStateAtom={createTextareaAtom()}
      onDraftChange={options.onDraftChange}
      updatePromptHistoryDraft={options.updatePromptHistoryDraft}
    />,
  );
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { ...result, textarea, textareaRef };
}

describe('TextArea behavior coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextMenuState.value = { show: false, options: [], selectedIndex: 0, position: { top: 0, left: 0, width: 0 } };
    mockGetContextMenuTriggerType.mockReturnValue(null);
    mockGetChatInputEnterAction.mockReturnValue('send');
    mockProfileDataManager.getPreviousPrompt.mockReturnValue(null);
    mockProfileDataManager.getNextPrompt.mockReturnValue(null);
  });

  it('opens workspace and skill menus from typed triggers and closes on plain text', () => {
    const { textarea, container } = renderTextArea({ enableContextMenu: true });
    const wrapper = container.querySelector('.textarea-layer-container') as HTMLElement;
    const wrapperRect = { top: 1, left: 2, right: 3, bottom: 4, width: 5, height: 6, x: 2, y: 1, toJSON: () => ({}) } as DOMRect;
    wrapper.getBoundingClientRect = vi.fn(() => wrapperRect);

    mockGetContextMenuTriggerType.mockReturnValueOnce(MockContextMenuTriggerType.Workspace);
    fireEvent.change(textarea, { target: { value: '@repo', selectionStart: 5 } });
    expect(mockContextMenuActions.triggerMenu).toHaveBeenCalledWith('workspace-query', wrapperRect, MockContextMenuTriggerType.Workspace);

    mockGetContextMenuTriggerType.mockReturnValueOnce(MockContextMenuTriggerType.Skill);
    fireEvent.change(textarea, { target: { value: '#skill', selectionStart: 6 } });
    expect(mockContextMenuActions.triggerMenu).toHaveBeenCalledWith('skill-query', wrapperRect, MockContextMenuTriggerType.Skill);

    mockGetContextMenuTriggerType.mockReturnValueOnce(null);
    fireEvent.change(textarea, { target: { value: 'plain', selectionStart: 5 } });
    expect(mockContextMenuActions.closeMenu).toHaveBeenCalled();
  });

  it('handles context-menu keyboard navigation and selection paths', async () => {
    mockContextMenuState.value = {
      show: true,
      selectedIndex: 0,
      position: { top: 0, left: 0, width: 0 },
      options: [{ type: MockContextMenuOptionType.Skill, value: 'figma' }],
    };
    let rendered = renderTextArea({ enableContextMenu: true });

    fireEvent.keyDown(rendered.textarea, { key: 'ArrowUp' });
    fireEvent.keyDown(rendered.textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(rendered.textarea, { key: 'Enter' });
    expect(mockContextMenuActions.navigateMenu).toHaveBeenCalledWith('up');
    expect(mockContextMenuActions.navigateMenu).toHaveBeenCalledWith('down');
    await waitFor(() => expect(mockInsertSkillMention).toHaveBeenCalledWith('', 0, 'figma'));
    rendered.unmount();

    mockContextMenuState.value = {
      show: true,
      selectedIndex: 0,
      position: { top: 0, left: 0, width: 0 },
      options: [{ type: 'empty' }],
    };
    rendered = renderTextArea({ enableContextMenu: true });
    fireEvent.keyDown(rendered.textarea, { key: 'Tab' });
    fireEvent.keyDown(rendered.textarea, { key: 'Escape' });
    expect(mockContextMenuActions.selectMenu).toHaveBeenCalledWith({ type: 'empty' });
    expect(mockContextMenuActions.closeMenu).toHaveBeenCalled();
    rendered.unmount();

    mockContextMenuState.value = {
      show: true,
      selectedIndex: 0,
      position: { top: 0, left: 0, width: 0 },
      options: [{ type: MockContextMenuOptionType.KnowledgeBase, value: 'kb' }],
    };
    rendered = renderTextArea({ enableContextMenu: true });
    fireEvent.keyDown(rendered.textarea, { key: 'ArrowRight' });
    await waitFor(() => expect(mockInsertMention).toHaveBeenCalledWith('', 0, 'kb', MockMentionSourceType.KnowledgeBase));
  });

  it('handles programmatic mention, skill, fill, and trigger events with the latest draft callback', async () => {
    const firstDraft = vi.fn();
    const secondDraft = vi.fn();
    const textareaRef = React.createRef<HTMLTextAreaElement>();
    const textareaStateAtom = createTextareaAtom();
    const { rerender } = render(
      <TextArea
        textareaRef={textareaRef}
        readOnly={false}
        title="Enter to send"
        supportsImages
        enableContextMenu
        handleSend={vi.fn()}
        handleImageSelect={vi.fn()}
        textareaStateAtom={textareaStateAtom}
        onDraftChange={firstDraft}
        updatePromptHistoryDraft
      />,
    );

    rerender(
      <TextArea
        textareaRef={textareaRef}
        readOnly={false}
        title="Enter to send"
        supportsImages
        enableContextMenu
        handleSend={vi.fn()}
        handleImageSelect={vi.fn()}
        textareaStateAtom={textareaStateAtom}
        onDraftChange={secondDraft}
        updatePromptHistoryDraft={false}
      />,
    );

    const currentTextarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    mockProfileDataManager.setCurrentEditingPrompt.mockClear();
    fireEvent.change(currentTextarea, { target: { value: 'hello ', selectionStart: 6 } });
    fireEvent(window, new CustomEvent('context:mentionSelect', {
      detail: { option: { type: MockContextMenuOptionType.ChatSession, relativePath: 'chat-2' } },
    }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(secondDraft).toHaveBeenCalledWith('hello |chat-2|chat_session');
    expect(firstDraft).not.toHaveBeenCalledWith('hello |chat-2|chat_session');
    expect(mockProfileDataManager.setCurrentEditingPrompt).not.toHaveBeenCalled();

    fireEvent(window, new CustomEvent('context:skillMentionSelect', { detail: {} }));
    fireEvent(window, new CustomEvent('context:skillMentionSelect', { detail: { skillName: 'planner' } }));
    await waitFor(() => expect(mockInsertSkillMention).toHaveBeenCalledWith(expect.any(String), expect.any(Number), 'planner'));

    fireEvent(window, new CustomEvent('agent:fillInput', { detail: { text: 42 } }));
    fireEvent(window, new CustomEvent('agent:fillInput', { detail: { text: 'filled' } }));
    await waitFor(() => expect(secondDraft).toHaveBeenCalledWith('filled'));
    expect(mockProfileDataManager.setCurrentEditingPrompt).not.toHaveBeenCalled();

    const wrapper = currentTextarea.closest('.textarea-layer-container') as HTMLElement;
    wrapper.getBoundingClientRect = vi.fn(() => ({ top: 1, left: 2, right: 3, bottom: 4, width: 5, height: 6, x: 2, y: 1, toJSON: () => ({}) } as DOMRect));
    fireEvent(window, new CustomEvent('chatInput:triggerMention', { detail: { focusIndex: 2 } }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    expect(mockContextMenuActions.triggerMenu).toHaveBeenCalledWith('', expect.any(Object), MockContextMenuTriggerType.Workspace);
    expect(mockContextMenuActions.hoverMenu).toHaveBeenCalledWith(2);

    mockContextMenuActions.hoverMenu.mockClear();
    fireEvent(window, new CustomEvent('chatInput:triggerMention'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(mockContextMenuActions.hoverMenu).not.toHaveBeenCalled();
    expect(mockProfileDataManager.setCurrentEditingPrompt).not.toHaveBeenCalled();
    expect(currentTextarea).toBeTruthy();
  });

  it('handles prompt history, enter actions, and paste forwarding', async () => {
    const handleSend = vi.fn();
    const handleImageSelect = vi.fn().mockResolvedValue(undefined);
    const { textarea } = renderTextArea({ handleSend, handleImageSelect });

    fireEvent.change(textarea, { target: { value: 'abc', selectionStart: 3 } });
    textarea.setSelectionRange(0, 0);
    mockProfileDataManager.getPreviousPrompt.mockReturnValueOnce('previous');
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => expect(textarea.value).toBe('previous'));

    textarea.setSelectionRange(2, 2);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea.selectionStart).toBe(0);

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    mockProfileDataManager.getNextPrompt.mockReturnValueOnce('next');
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await waitFor(() => expect(textarea.value).toBe('next'));

    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea.selectionStart).toBe(textarea.value.length);

    mockGetChatInputEnterAction.mockReturnValueOnce('ignore');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(handleSend).not.toHaveBeenCalled();

    mockGetChatInputEnterAction.mockReturnValueOnce('newline');
    textarea.value = 'ab';
    textarea.setSelectionRange(1, 1);
    fireEvent.keyDown(textarea, { key: 'Enter', altKey: true });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(textarea.value).toBe('a\nb');

    mockGetChatInputEnterAction.mockReturnValueOnce('send');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(handleSend).toHaveBeenCalled();

    fireEvent.paste(textarea, {
      clipboardData: {
        types: ['text/plain'],
        getData: () => ' pasted ',
        items: [],
      },
    });
    await waitFor(() => expect(textarea.value).toContain('pasted'));
  });

  it('covers defensive no-op branches for missing rectangles, history misses, and unsupported images', async () => {
    const { textarea, unmount } = renderTextArea({ enableContextMenu: true, supportsImages: false });
    expect(textarea).toHaveAttribute('placeholder', 'Type a message, drag files, @ to mention files, # for skills...');

    textarea.closest = vi.fn(() => null);

    mockGetContextMenuTriggerType.mockReturnValueOnce(MockContextMenuTriggerType.Skill);
    fireEvent.change(textarea, { target: { value: '#', selectionStart: 1 } });
    expect(mockContextMenuActions.triggerMenu).not.toHaveBeenCalled();

    mockGetContextMenuTriggerType.mockReturnValueOnce(MockContextMenuTriggerType.Workspace);
    fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } });
    expect(mockContextMenuActions.triggerMenu).not.toHaveBeenCalled();

    mockProfileDataManager.getPreviousPrompt.mockReturnValueOnce(null);
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    mockProfileDataManager.getNextPrompt.mockReturnValueOnce(null);
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });

    mockGetChatInputEnterAction.mockReturnValueOnce('noop');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Home' });

    fireEvent(window, new CustomEvent('chatInput:triggerMention'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(mockContextMenuActions.hoverMenu).not.toHaveBeenCalled();

    fireEvent(window, new CustomEvent('context:mentionSelect', {
      detail: { option: { type: 'empty' } },
    }));
    expect(mockInsertMention).not.toHaveBeenCalledWith(expect.any(String), expect.any(Number), '', undefined);

    fireEvent(window, new CustomEvent('context:mentionSelect', {
      detail: { option: { type: 'other', value: 'plain' } },
    }));
    expect(mockInsertMention).toHaveBeenCalledWith(expect.any(String), expect.any(Number), 'plain', undefined);

    fireEvent(window, new CustomEvent('context:mentionSelect', {
      detail: { option: { type: MockContextMenuOptionType.KnowledgeBase, value: 'kb' } },
    }));
    fireEvent(window, new CustomEvent('context:skillMentionSelect', { detail: { skillName: 'after-unmount' } }));
    fireEvent(window, new CustomEvent('agent:fillInput', { detail: { text: 'after-unmount' } }));
    unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('falls through context-menu keyboard handling for unhandled keys', () => {
    mockContextMenuState.value = {
      show: true,
      selectedIndex: 0,
      position: { top: 0, left: 0, width: 0 },
      options: [{ type: 'empty' }],
    };
    const { textarea } = renderTextArea({ enableContextMenu: true });
    fireEvent.keyDown(textarea, { key: 'PageDown' });
    expect(mockContextMenuActions.closeMenu).not.toHaveBeenCalled();
  });
});
