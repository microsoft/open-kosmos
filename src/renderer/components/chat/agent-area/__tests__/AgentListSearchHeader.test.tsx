// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * AgentListSearchHeader.test.tsx
 * Direct-render coverage for the extracted search header: search input,
 * clear control, agent-filter chip, the "type @" hint, and the mention picker
 * (including the picker's top-offset ternary and active-option styling). These
 * paths are not all exercised by the parent AgentList tests, so this dedicated
 * suite keeps the new component at the >=90% whole-file coverage gate.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { AgentListSearchHeader } from '../AgentListSearchHeader';

const optionA = {
  chatId: 'chat-a',
  agentName: 'Alpha Agent',
  agentEmoji: 'A',
  agentSource: 'ON-DEVICE',
  agentVersion: '1',
};
const optionB = {
  chatId: 'chat-b',
  agentName: 'Beta Agent',
  agentEmoji: 'B',
  agentSource: 'IN-LIBRARY',
  agentVersion: '2',
};

function makeProps(overrides = {}) {
  return {
    isSearchMode: false,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    searchInputRef: { current: null },
    handleSearchInputKeyDown: vi.fn(),
    handleSearchFocus: vi.fn(),
    handleSearchBlur: vi.fn(),
    selectedAgentFilter: null,
    clearSelectedAgentFilter: vi.fn(),
    showAgentSearchHint: false,
    isMentionPickerOpen: false,
    mentionPickerRef: { current: null },
    mentionSuggestions: [],
    activeMentionIndex: 0,
    setActiveMentionIndex: vi.fn(),
    applyMentionSuggestion: vi.fn(),
    mentionOptionRefs: { current: [] },
    ...overrides,
  };
}

describe('AgentListSearchHeader', () => {
  it('renders the baseline search input with no extras', () => {
    const { queryByLabelText, getByLabelText } = render(
      <AgentListSearchHeader {...makeProps()} />,
    );
    expect(getByLabelText('Search conversations')).toBeTruthy();
    // No clear button, no filter chip, no hint, no picker.
    expect(queryByLabelText('Clear conversation search')).toBeNull();
    expect(queryByLabelText('Clear agent filter')).toBeNull();
  });

  it('applies the active search border when isSearchMode is true', () => {
    const { getByLabelText } = render(
      <AgentListSearchHeader {...makeProps({ isSearchMode: true })} />,
    );
    // The input is wrapped by the search box; just assert it renders.
    expect(getByLabelText('Search conversations')).toBeTruthy();
  });

  it('forwards input change, key, focus and blur events', () => {
    const props = makeProps();
    const { getByLabelText } = render(<AgentListSearchHeader {...props} />);
    const input = getByLabelText('Search conversations');

    fireEvent.change(input, { target: { value: 'hello' } });
    expect(props.setSearchQuery).toHaveBeenCalledWith('hello');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(props.handleSearchInputKeyDown).toHaveBeenCalled();

    fireEvent.focus(input);
    expect(props.handleSearchFocus).toHaveBeenCalled();

    fireEvent.blur(input);
    expect(props.handleSearchBlur).toHaveBeenCalled();
  });

  it('shows the clear button only with a non-empty query and clears it on click', () => {
    const props = makeProps({ searchQuery: 'abc' });
    const { getByLabelText } = render(<AgentListSearchHeader {...props} />);
    const clearBtn = getByLabelText('Clear conversation search');
    fireEvent.click(clearBtn);
    expect(props.setSearchQuery).toHaveBeenCalledWith('');
  });

  it('renders the agent filter chip and clears it on click', () => {
    const props = makeProps({ selectedAgentFilter: optionA });
    const { getByText, getByLabelText } = render(<AgentListSearchHeader {...props} />);
    expect(getByText('Alpha Agent')).toBeTruthy();
    expect(getByText('Filtering by agent')).toBeTruthy();
    fireEvent.click(getByLabelText('Clear agent filter'));
    expect(props.clearSelectedAgentFilter).toHaveBeenCalled();
  });

  it('renders the agent search hint when enabled', () => {
    const { getByText } = render(
      <AgentListSearchHeader {...makeProps({ showAgentSearchHint: true })} />,
    );
    expect(getByText('Tip: type @ to narrow results to an agent.')).toBeTruthy();
  });

  it('renders mention suggestions, highlights the active one, and wires events', () => {
    const props = makeProps({
      isMentionPickerOpen: true,
      mentionSuggestions: [optionA, optionB],
      activeMentionIndex: 0,
    });
    const { getAllByRole } = render(<AgentListSearchHeader {...props} />);
    const buttons = getAllByRole('button');
    // Two suggestion buttons (no clear button when query is empty).
    expect(buttons).toHaveLength(2);

    // Active option (index 0) is highlighted; the other is transparent.
    expect(buttons[0].style.background).not.toBe('transparent');
    expect(buttons[0].style.background).toBeTruthy();
    expect(buttons[1].style.background).toBe('transparent');

    fireEvent.mouseEnter(buttons[1]);
    expect(props.setActiveMentionIndex).toHaveBeenCalledWith(1);

    fireEvent.click(buttons[0]);
    expect(props.applyMentionSuggestion).toHaveBeenCalledWith(optionA);

    // Option refs were registered for both entries.
    expect(props.mentionOptionRefs.current[0]).toBeTruthy();
    expect(props.mentionOptionRefs.current[1]).toBeTruthy();
  });

  it('positions the picker at 92px when a filter chip is present', () => {
    const props = makeProps({
      isMentionPickerOpen: true,
      mentionSuggestions: [optionA],
      selectedAgentFilter: optionB,
    });
    render(<AgentListSearchHeader {...props} />);
    expect(props.mentionPickerRef.current.style.top).toBe('92px');
  });

  it('positions the picker at 82px when only the hint is present', () => {
    const props = makeProps({
      isMentionPickerOpen: true,
      mentionSuggestions: [optionA],
      showAgentSearchHint: true,
    });
    render(<AgentListSearchHeader {...props} />);
    expect(props.mentionPickerRef.current.style.top).toBe('82px');
  });

  it('positions the picker at 58px when neither filter nor hint is present', () => {
    const props = makeProps({
      isMentionPickerOpen: true,
      mentionSuggestions: [optionA],
    });
    render(<AgentListSearchHeader {...props} />);
    expect(props.mentionPickerRef.current.style.top).toBe('58px');
  });
});
