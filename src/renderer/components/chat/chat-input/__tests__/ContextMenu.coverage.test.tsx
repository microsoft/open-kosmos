/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// --- hoisted mocks ---
const mockSelectMenu = vi.fn();
const mockCloseMenu = vi.fn();
const mockHoverMenu = vi.fn();

const mockContextMenuState = vi.hoisted(() => ({
  show: true,
  options: [] as any[],
  selectedIndex: 0,
  position: { top: 100, left: 50, width: 400 },
}));

vi.mock('../context-menu.atom', () => ({
  ContextMenuAtom: {
    use: () => [
      mockContextMenuState,
      {
        selectMenu: mockSelectMenu,
        closeMenu: mockCloseMenu,
        hoverMenu: mockHoverMenu,
      },
    ],
  },
}));

vi.mock('@/lib/chat/contextMentions', () => ({
  ContextMenuOptionType: {
    File: 'File',
    Folder: 'Folder',
    KnowledgeBase: 'KnowledgeBase',
    ChatSession: 'ChatSession',
    Skill: 'Skill',
    NoResults: 'NoResults',
  },
}));

import { ContextMenu } from '../ContextMenu';

const fileOption = (overrides: any = {}): any => ({
  type: 'File',
  fileName: 'test.ts',
  value: 'src/test.ts',
  ...overrides,
});

const folderOption = (overrides: any = {}): any => ({
  type: 'Folder',
  fileName: 'myFolder',
  value: 'src/myFolder',
  ...overrides,
});

const skillOption = (overrides: any = {}): any => ({
  type: 'Skill',
  fileName: 'mySkill',
  description: 'Does something',
  value: 'mySkill',
  ...overrides,
});

const noResultsOption = (overrides: any = {}): any => ({
  type: 'NoResults',
  fileName: 'No results',
  description: 'Nothing found',
  ...overrides,
});

const kbOption = (overrides: any = {}): any => ({
  type: 'KnowledgeBase',
  fileName: 'doc.md',
  value: '@knowledge-base:/doc.md',
  ...overrides,
});

const chatOption = (overrides: any = {}): any => ({
  type: 'ChatSession',
  fileName: 'session.txt',
  value: '@chat-session:/session.txt',
  ...overrides,
});

describe('ContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextMenuState.show = true;
    mockContextMenuState.options = [];
    mockContextMenuState.selectedIndex = 0;
  });

  it('returns null when show is false', () => {
    mockContextMenuState.show = false;
    const { container } = render(<ContextMenu />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "No results found" when options array is empty', () => {
    mockContextMenuState.options = [];
    render(<ContextMenu />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('renders file option with icon and path', () => {
    mockContextMenuState.options = [fileOption()];
    render(<ContextMenu />);
    expect(screen.getByText('test.ts')).toBeInTheDocument();
  });

  it('renders folder option with folder icon', () => {
    mockContextMenuState.options = [folderOption()];
    render(<ContextMenu />);
    // Folder emoji
    expect(screen.getByText('📁')).toBeInTheDocument();
  });

  it('renders skill option with skill icon', () => {
    mockContextMenuState.options = [skillOption()];
    render(<ContextMenu />);
    expect(screen.getByText('⚡')).toBeInTheDocument();
    expect(screen.getByText('mySkill')).toBeInTheDocument();
  });

  it('renders knowledge base option with book icon', () => {
    mockContextMenuState.options = [kbOption()];
    render(<ContextMenu />);
    expect(screen.getByText('📚')).toBeInTheDocument();
  });

  it('renders chat session option with chat icon', () => {
    mockContextMenuState.options = [chatOption()];
    render(<ContextMenu />);
    expect(screen.getByText('💬')).toBeInTheDocument();
  });

  it('renders NoResults option without being selectable', () => {
    mockContextMenuState.options = [noResultsOption()];
    render(<ContextMenu />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('calls selectMenu when clicking a selectable option', () => {
    const opt = fileOption();
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    fireEvent.click(screen.getAllByText('test.ts')[0].closest('.context-menu-item')!);
    expect(mockSelectMenu).toHaveBeenCalledWith(opt);
  });

  it('does not call selectMenu when clicking NoResults option', () => {
    const opt = noResultsOption();
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    fireEvent.click(screen.getByText('No results').closest('.context-menu-item')!);
    expect(mockSelectMenu).not.toHaveBeenCalled();
  });

  it('calls hoverMenu on mouse enter over selectable option', () => {
    const opt = fileOption();
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    fireEvent.mouseEnter(screen.getAllByText('test.ts')[0].closest('.context-menu-item')!);
    expect(mockHoverMenu).toHaveBeenCalledWith(0);
  });

  it('calls closeMenu when clicking outside', () => {
    mockContextMenuState.options = [fileOption()];
    render(<ContextMenu />);
    fireEvent.mouseDown(document.body);
    expect(mockCloseMenu).toHaveBeenCalled();
  });

  it('highlights the selected index item', () => {
    mockContextMenuState.options = [fileOption(), folderOption()];
    mockContextMenuState.selectedIndex = 1;
    render(<ContextMenu />);
    const items = document.querySelectorAll('.context-menu-item');
    // Second item should have blue background style
    expect((items[1] as HTMLElement).style.backgroundColor).not.toBe('transparent');
  });

  it('renders default File/Folder option without a value (shows chevron)', () => {
    const opt = { type: 'File', fileName: '', value: '', relativePath: '' };
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('renders default KnowledgeBase label when no fileName', () => {
    const opt = { type: 'KnowledgeBase', fileName: '', value: '', relativePath: '' };
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    expect(screen.getByText('Add Knowledge File')).toBeInTheDocument();
  });

  it('renders default ChatSession label when no fileName', () => {
    const opt = { type: 'ChatSession', fileName: '', value: '', relativePath: '' };
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    expect(screen.getByText('Add Chat Session File')).toBeInTheDocument();
  });

  it('renders NoResults description when present', () => {
    const opt = noResultsOption({ description: 'Try something else' });
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    expect(screen.getByText('Try something else')).toBeInTheDocument();
  });

  it('renders skill description when present', () => {
    const opt = skillOption({ description: 'Skill description text' });
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    expect(screen.getByText('Skill description text')).toBeInTheDocument();
  });

  it('renders multiple options', () => {
    mockContextMenuState.options = [fileOption(), folderOption(), skillOption()];
    render(<ContextMenu />);
    expect(document.querySelectorAll('.context-menu-item').length).toBe(3);
  });

  it('renders different file extension icons', () => {
    const jsOpt = fileOption({ fileName: 'app.js', value: 'app.js' });
    mockContextMenuState.options = [jsOpt];
    render(<ContextMenu />);
    expect(screen.getByText('📒')).toBeInTheDocument();
  });

  it('renders path with @workspace: prefix stripped', () => {
    const opt = fileOption({ fileName: 'file.md', value: '@workspace:/docs/file.md' });
    mockContextMenuState.options = [opt];
    render(<ContextMenu />);
    expect(screen.getByText('./docs')).toBeInTheDocument();
  });
});
