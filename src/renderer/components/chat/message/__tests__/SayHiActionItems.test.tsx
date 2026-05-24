/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../styles/SayHiActionItems.css', () => ({}));
vi.mock('lucide-react', () => ({
  MessageCircle: ({ size, className }: any) => <span data-testid="icon" className={className} />,
}));

const mockSendUserPrompt = vi.fn();
vi.mock('@/lib/chat/sendUserMessageOptimistically', () => ({
  sendUserPrompt: (...args: any[]) => mockSendUserPrompt(...args),
}));

import SayHiActionItems, {
  parseSayHiContent,
  SAY_HI_ACTION_ITEMS_DELIMITER,
} from '../SayHiActionItems';
import type { ActionItemGroup } from '../SayHiActionItems';

describe('parseSayHiContent', () => {
  it('returns full text as markdownBody when no delimiter', () => {
    const result = parseSayHiContent('Hello world');
    expect(result.markdownBody).toBe('Hello world');
    expect(result.actionItems).toEqual([]);
    expect(result.actionItemGroups).toEqual([]);
  });

  it('splits at delimiter into body and items', () => {
    const raw = `Hello\n${SAY_HI_ACTION_ITEMS_DELIMITER}\nItem one\nItem two`;
    const result = parseSayHiContent(raw);
    expect(result.markdownBody).toBe('Hello');
    expect(result.actionItems).toEqual(['Item one', 'Item two']);
  });

  it('groups items by ## heading', () => {
    const raw = `Body\n${SAY_HI_ACTION_ITEMS_DELIMITER}\n## Group A\nItem 1\nItem 2\n## Group B\nItem 3`;
    const result = parseSayHiContent(raw);
    expect(result.actionItemGroups).toHaveLength(2);
    expect(result.actionItemGroups[0].title).toBe('Group A');
    expect(result.actionItemGroups[0].items).toEqual(['Item 1', 'Item 2']);
    expect(result.actionItemGroups[1].title).toBe('Group B');
    expect(result.actionItemGroups[1].items).toEqual(['Item 3']);
  });

  it('flushes last group even without trailing newline', () => {
    const raw = `Body\n${SAY_HI_ACTION_ITEMS_DELIMITER}\n## Group\nOnly item`;
    const { actionItemGroups } = parseSayHiContent(raw);
    expect(actionItemGroups[0].items).toContain('Only item');
  });

  it('skips empty lines in action section', () => {
    const raw = `Body\n${SAY_HI_ACTION_ITEMS_DELIMITER}\n\nItem A\n\nItem B\n`;
    const { actionItems } = parseSayHiContent(raw);
    expect(actionItems).toEqual(['Item A', 'Item B']);
  });

  it('returns ungrouped items in single group with empty title', () => {
    const raw = `Body\n${SAY_HI_ACTION_ITEMS_DELIMITER}\nItem X`;
    const { actionItemGroups } = parseSayHiContent(raw);
    expect(actionItemGroups[0].title).toBe('');
    expect(actionItemGroups[0].items).toContain('Item X');
  });
});

describe('SayHiActionItems component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when groups is empty', () => {
    const { container } = render(<SayHiActionItems groups={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders group title when provided', () => {
    const groups: ActionItemGroup[] = [
      { title: 'My Group', items: ['Item 1'] },
    ];
    render(<SayHiActionItems groups={groups} />);
    expect(screen.getByText('My Group')).toBeInTheDocument();
  });

  it('does not render group title element when title is empty', () => {
    const groups: ActionItemGroup[] = [
      { title: '', items: ['Item 1'] },
    ];
    const { container } = render(<SayHiActionItems groups={groups} />);
    expect(container.querySelector('.say-hi-action-group-title')).toBeNull();
  });

  it('renders chips for each item', () => {
    const groups: ActionItemGroup[] = [
      { title: '', items: ['Do thing A', 'Do thing B'] },
    ];
    render(<SayHiActionItems groups={groups} />);
    expect(screen.getByText('Do thing A')).toBeInTheDocument();
    expect(screen.getByText('Do thing B')).toBeInTheDocument();
  });

  it('calls sendUserPrompt with item text when chip clicked', () => {
    const groups: ActionItemGroup[] = [
      { title: '', items: ['Send this message'] },
    ];
    render(<SayHiActionItems groups={groups} />);
    fireEvent.click(screen.getByText('Send this message'));
    expect(mockSendUserPrompt).toHaveBeenCalledWith('Send this message');
  });

  it('renders multiple groups', () => {
    const groups: ActionItemGroup[] = [
      { title: 'Alpha', items: ['A1'] },
      { title: 'Beta', items: ['B1', 'B2'] },
    ];
    render(<SayHiActionItems groups={groups} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
  });
});
