// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const hide = vi.fn();
  const backToList = vi.fn();
  const selectCard = vi.fn();
  const atomUse = vi.fn(() => [
    { visible: true, selectedSlug: null },
    { hide, backToList, selectCard },
  ]);
  const useCurrentChatId = vi.fn(() => 'chat-1');
  const useMemexMemoryEnabled = vi.fn(() => true);

  // memex IPC client mocks
  const listCards = vi.fn();
  const readCard = vi.fn();
  const getGraph = vi.fn();
  const searchCards = vi.fn();
  const cardsChanged = vi.fn(() => vi.fn()); // returns unsubscribe

  return { hide, backToList, selectCard, atomUse, useCurrentChatId, useMemexMemoryEnabled, listCards, readCard, getGraph, searchCards, cardsChanged };
});

// ── module mocks ────────────────────────────────────────────────────────────────
vi.mock('../chat-side.atom', () => ({
  MemexMemorySidepaneAtom: { use: mocks.atomUse },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: mocks.useCurrentChatId,
}));

vi.mock('../../../lib/userData/useMemexMemoryEnabled', () => ({
  useMemexMemoryEnabled: mocks.useMemexMemoryEnabled,
}));

vi.mock('../../../ipc/memex', () => ({
  memexApi: {
    listCards: mocks.listCards,
    readCard: mocks.readCard,
    getGraph: mocks.getGraph,
    searchCards: mocks.searchCards,
  },
  memexEvents: {
    cardsChanged: mocks.cardsChanged,
  },
}));

vi.mock('../../../styles/Sidepane.css', () => ({}));

// ── helpers ──────────────────────────────────────────────────────────────────────
function makeCard(overrides = {}) {
  return {
    slug: 'alpha-note',
    title: 'Alpha Note',
    category: 'work',
    modified: '2026-06-01',
    excerpt: 'This is the first paragraph.',
    ...overrides,
  };
}

function setAtom(state) {
  mocks.atomUse.mockReturnValue([
    state,
    { hide: mocks.hide, backToList: mocks.backToList, selectCard: mocks.selectCard },
  ]);
}

// ── import after mocks ───────────────────────────────────────────────────────────
import MemexMemorySidepane, { ToggleMemexMemory } from '../MemexMemorySidepane';

describe('MemexMemorySidepane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAtom({ visible: true, selectedSlug: null });
    mocks.useCurrentChatId.mockReturnValue('chat-1');
    mocks.useMemexMemoryEnabled.mockReturnValue(true);
    mocks.listCards.mockResolvedValue({ success: true, data: [makeCard()] });
    mocks.searchCards.mockResolvedValue({ success: true, data: [] });
    mocks.readCard.mockResolvedValue({ success: true, data: { slug: 'alpha-note', title: 'Alpha Note', content: 'Body text', outbound: [], inbound: [] } });
    mocks.cardsChanged.mockReturnValue(vi.fn());
  });

  // ── gating ──────────────────────────────────────────────────────────────────
  it('returns null when memex memory is disabled', () => {
    mocks.useMemexMemoryEnabled.mockReturnValue(false);
    const { container } = render(<MemexMemorySidepane />);
    expect(container.firstChild).toBeNull();
  });

  it('hides the atom when memex memory is disabled while visible', async () => {
    mocks.useMemexMemoryEnabled.mockReturnValue(false);
    setAtom({ visible: true, selectedSlug: 'alpha-note' });

    await act(async () => { render(<MemexMemorySidepane />); });

    expect(mocks.hide).toHaveBeenCalled();
  });

  it('returns null when not visible', () => {
    setAtom({ visible: false, selectedSlug: null });
    const { container } = render(<MemexMemorySidepane />);
    expect(container.firstChild).toBeNull();
  });

  // ── list view ──────────────────────────────────────────────────────────────
  it('renders the header and loads cards when visible', async () => {
    await act(async () => { render(<MemexMemorySidepane />); });
    expect(screen.getByText('Agent Memory')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Alpha Note')).toBeTruthy());
    expect(mocks.listCards).toHaveBeenCalledWith('chat-1');
  });

  it('shows the empty state when there are no cards', async () => {
    mocks.listCards.mockResolvedValue({ success: true, data: [] });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('No memory cards yet')).toBeTruthy());
  });

  it('shows an error when the list load fails', async () => {
    mocks.listCards.mockResolvedValue({ success: false, error: 'boom' });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });

  it('selecting a card calls selectCard with the slug', async () => {
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Alpha Note')).toBeTruthy());
    fireEvent.click(screen.getByText('Alpha Note'));
    expect(mocks.selectCard).toHaveBeenCalledWith('alpha-note');
  });

  it('typing in the search box routes to searchCards', async () => {
    mocks.searchCards.mockResolvedValue({ success: true, data: [makeCard({ slug: 'hit', title: 'Search Hit' })] });
    await act(async () => { render(<MemexMemorySidepane />); });

    const input = screen.getByPlaceholderText('Search memory...');
    await act(async () => { fireEvent.change(input, { target: { value: 'hit' } }); });

    await waitFor(() => expect(mocks.searchCards).toHaveBeenCalledWith('chat-1', 'hit'));
    await waitFor(() => expect(screen.getByText('Search Hit')).toBeTruthy());
  });

  it('shows a no-match message for an empty search result', async () => {
    mocks.searchCards.mockResolvedValue({ success: true, data: [] });
    await act(async () => { render(<MemexMemorySidepane />); });
    const input = screen.getByPlaceholderText('Search memory...');
    await act(async () => { fireEvent.change(input, { target: { value: 'zzz' } }); });
    await waitFor(() => expect(screen.getByText('No matching cards')).toBeTruthy());
  });

  it('subscribes to cardsChanged and reloads on a matching chatId', async () => {
    let handler;
    mocks.cardsChanged.mockImplementation((cb) => { handler = cb; return vi.fn(); });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(mocks.listCards).toHaveBeenCalledTimes(1));

    // Non-matching chat is ignored
    await act(async () => { handler({ chatId: 'other' }); });
    expect(mocks.listCards).toHaveBeenCalledTimes(1);

    // Matching chat triggers a reload
    await act(async () => { handler({ chatId: 'chat-1' }); });
    await waitFor(() => expect(mocks.listCards).toHaveBeenCalledTimes(2));
  });

  it('drops a stale slow load so it cannot overwrite a newer one (chatId switch race)', async () => {
    // Reproduces the T12.4 bug: switching from an agent with many cards to a
    // brand-new empty agent. The slow request for the old chatId must NOT
    // overwrite the fast empty result for the new chatId.
    let resolveSlow;
    const slow = new Promise((r) => { resolveSlow = r; });
    // First load (chat-1) is slow; second load (chat-2) is fast + empty.
    mocks.listCards
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ success: true, data: [] });

    const { rerender } = render(<MemexMemorySidepane />);
    // chat-1's load is now in-flight (unresolved).
    expect(mocks.listCards).toHaveBeenNthCalledWith(1, 'chat-1');

    // Switch to a brand-new empty agent; its load resolves immediately.
    mocks.useCurrentChatId.mockReturnValue('chat-2');
    await act(async () => { rerender(<MemexMemorySidepane />); });
    await waitFor(() => expect(mocks.listCards).toHaveBeenNthCalledWith(2, 'chat-2'));
    await waitFor(() => expect(screen.getByText('No memory cards yet')).toBeTruthy());

    // Now the slow chat-1 request finally returns with 4 cards — it must be dropped.
    await act(async () => {
      resolveSlow({ success: true, data: [makeCard({ slug: 'stale', title: 'Stale Card' })] });
      await slow;
    });
    expect(screen.queryByText('Stale Card')).toBeNull();
    expect(screen.getByText('No memory cards yet')).toBeTruthy();
  });

  it('clears the previous agent cards immediately when chatId changes', async () => {
    const { rerender } = render(<MemexMemorySidepane />);
    await waitFor(() => expect(screen.getByText('Alpha Note')).toBeTruthy());

    // Switching agents must not flash the prior agent's cards while loading:
    // chat-2's load is held pending so we can assert the interim render state.
    let resolveNext;
    mocks.listCards.mockReturnValueOnce(new Promise((r) => { resolveNext = r; }));
    mocks.useCurrentChatId.mockReturnValue('chat-2');
    await act(async () => { rerender(<MemexMemorySidepane />); });

    // While chat-2 is still loading, chat-1's card must already be gone.
    expect(screen.queryByText('Alpha Note')).toBeNull();
    await act(async () => { resolveNext?.({ success: true, data: [] }); });
    await waitFor(() => expect(screen.getByText('No memory cards yet')).toBeTruthy());
  });

  it('drops back to list mode (clears selectedSlug) when chatId changes', async () => {
    // Viewing a card detail (selectedSlug set) then switching agents must reset to
    // list mode, or the detail view would read the old slug against the new chatId.
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    const { rerender } = render(<MemexMemorySidepane />);
    mocks.backToList.mockClear(); // ignore any mount-time invocation

    mocks.useCurrentChatId.mockReturnValue('chat-2');
    await act(async () => { rerender(<MemexMemorySidepane />); });

    expect(mocks.backToList).toHaveBeenCalled();
  });

  // ── detail view ──────────────────────────────────────────────────────────────
  it('renders the detail view and loads the card when a slug is selected', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    mocks.readCard.mockResolvedValue({
      success: true,
      data: {
        slug: 'alpha-note',
        title: 'Alpha Note',
        content: 'Detailed body',
        rawContent: 'Detailed body with [[beta|Beta Memory]]',
        category: 'work',
        outbound: ['beta'],
        resolvedWikilinks: { beta: 'beta' },
        inbound: ['gamma'],
      },
    });
    await act(async () => { render(<MemexMemorySidepane />); });

    expect(screen.getByText('Back')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Detailed body/)).toBeTruthy());
    expect(mocks.readCard).toHaveBeenCalledWith('chat-1', 'alpha-note');
    expect(document.querySelector('.file-viewer-markdown-content')).not.toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Beta Memory' }));
    expect(mocks.selectCard).toHaveBeenCalledWith('beta');
    expect(screen.queryByText('gamma')).toBeNull();
  });

  it('detail view: Back button calls backToList', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    await act(async () => { render(<MemexMemorySidepane />); });
    fireEvent.click(screen.getByText('Back'));
    expect(mocks.backToList).toHaveBeenCalled();
  });

  it('detail view: surfaces a read error', async () => {
    setAtom({ visible: true, selectedSlug: 'missing' });
    mocks.readCard.mockResolvedValue({ success: false, error: 'not found' });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('not found')).toBeTruthy());
  });

  it('detail view renders raw Markdown content through the file viewer', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    mocks.readCard.mockResolvedValue({
      success: true,
      data: {
        slug: 'alpha-note',
        title: 'Alpha Note',
        content: 'Stripped body',
        rawContent: [
          '---',
          'title: Alpha Note',
          'source: openkosmos',
          '---',
          'Raw body',
        ].join('\n'),
        outbound: ['beta'],
        inbound: [],
      },
    });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Raw body')).toBeTruthy());
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('source')).toBeTruthy();
    expect(screen.queryByText('Stripped body')).toBeNull();
    expect(mocks.selectCard).not.toHaveBeenCalled();
  });

  it('detail view refreshes the selected card on matching cardsChanged events', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    let handler;
    mocks.cardsChanged.mockImplementation((cb) => { handler = cb; return vi.fn(); });
    mocks.readCard
      .mockResolvedValueOnce({
        success: true,
        data: { slug: 'alpha-note', title: 'Alpha Note', content: 'Old body', outbound: [], inbound: [] },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { slug: 'alpha-note', title: 'Alpha Note', content: 'New body', outbound: [], inbound: [] },
      });

    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Old body')).toBeTruthy());

    await act(async () => { handler({ chatId: 'other' }); });
    expect(mocks.readCard).toHaveBeenCalledTimes(1);

    await act(async () => { handler({ chatId: 'chat-1' }); });
    await waitFor(() => expect(screen.getByText('New body')).toBeTruthy());
    expect(screen.queryByText('Old body')).toBeNull();
    expect(mocks.readCard).toHaveBeenCalledTimes(2);
  });

  it('detail view surfaces not found when the selected card is archived after cardsChanged', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    let handler;
    mocks.cardsChanged.mockImplementation((cb) => { handler = cb; return vi.fn(); });
    mocks.readCard
      .mockResolvedValueOnce({
        success: true,
        data: { slug: 'alpha-note', title: 'Alpha Note', content: 'Existing body', outbound: [], inbound: [] },
      })
      .mockResolvedValueOnce({ success: false, error: 'not found' });

    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Existing body')).toBeTruthy());

    await act(async () => { handler({ chatId: 'chat-1' }); });
    await waitFor(() => expect(screen.getByText('not found')).toBeTruthy());
    expect(screen.queryByText('Existing body')).toBeNull();
  });

  it('detail view cancels an event-triggered reload on unmount', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    let handler;
    let resolveReload;
    mocks.cardsChanged.mockImplementation((cb) => { handler = cb; return vi.fn(); });
    mocks.readCard
      .mockResolvedValueOnce({
        success: true,
        data: { slug: 'alpha-note', title: 'Alpha Note', content: 'Existing body', outbound: [], inbound: [] },
      })
      .mockReturnValueOnce(new Promise((resolve) => { resolveReload = resolve; }));

    const { unmount } = render(<MemexMemorySidepane />);
    await waitFor(() => expect(screen.getByText('Existing body')).toBeTruthy());
    await act(async () => { handler({ chatId: 'chat-1' }); });

    unmount();
    await act(async () => {
      resolveReload?.({
        success: true,
        data: { slug: 'alpha-note', title: 'Alpha Note', content: 'Stale body', outbound: [], inbound: [] },
      });
    });

    expect(screen.queryByText('Stale body')).toBeNull();
  });

  // ── list item hover + render fallbacks ──────────────────────────────────────
  it('hovering a card list item toggles its background (mouse enter/leave handlers)', async () => {
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Alpha Note')).toBeTruthy());
    const item = screen.getByText('Alpha Note').closest('button')!;
    fireEvent.mouseEnter(item);
    expect(item.style.backgroundColor).toBe('rgba(0, 0, 0, 0.05)');
    fireEvent.mouseLeave(item);
    // happy-dom preserves the literal inline value (var(--color-white), not rgb()).
    expect(item.style.backgroundColor).toBe('var(--color-white)');
  });

  it('falls back to the slug as the title and shows the date-only meta line', async () => {
    // A card with an empty title exercises `card.title || card.slug`; a card with
    // no category but a `modified` date exercises the `category || modified` meta
    // guard's right-hand side.
    mocks.listCards.mockResolvedValue({
      success: true,
      data: [{ slug: 'plain-slug', title: '', category: undefined, modified: '2026-06-02', excerpt: '' }],
    });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('plain-slug')).toBeTruthy());
    expect(screen.getByText('2026-06-02')).toBeTruthy();
  });

  // ── search clear button ──────────────────────────────────────────────────────
  it('clear-search button empties the query and reloads the full list', async () => {
    mocks.searchCards.mockResolvedValue({ success: true, data: [makeCard({ slug: 'hit', title: 'Search Hit' })] });
    await act(async () => { render(<MemexMemorySidepane />); });
    const input = screen.getByPlaceholderText('Search memory...');
    await act(async () => { fireEvent.change(input, { target: { value: 'hit' } }); });
    await waitFor(() => expect(screen.getByText('Search Hit')).toBeTruthy());

    // The clear (X) button only appears while the query is non-empty.
    const clearBtn = screen.getByLabelText('Clear search');
    await act(async () => { fireEvent.click(clearBtn); });
    expect((input as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(mocks.listCards).toHaveBeenCalled());
  });

  // ── loadCards guards + catch paths ─────────────────────────────────────────────
  it('renders the empty state without calling the service when there is no chatId', async () => {
    mocks.useCurrentChatId.mockReturnValue(null);
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('No memory cards yet')).toBeTruthy());
    expect(mocks.listCards).not.toHaveBeenCalled();
  });

  it('coerces a successful response with no data into an empty list', async () => {
    mocks.listCards.mockResolvedValue({ success: true, data: undefined });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('No memory cards yet')).toBeTruthy());
  });

  it('surfaces a thrown Error message from the list load', async () => {
    mocks.listCards.mockRejectedValue(new Error('network down'));
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());
  });

  it('falls back to a generic message when the list load throws a non-Error', async () => {
    mocks.listCards.mockRejectedValue('just a string');
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Failed to load memory')).toBeTruthy());
  });

  // ── detail view: file viewer content + error fallbacks ──────
  it('detail view renders only the file body, not structured metadata or link chips', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    mocks.readCard.mockResolvedValue({
      success: true,
      data: {
        slug: 'alpha-note',
        title: 'Alpha Note',
        content: 'Full body',
        category: 'work',
        status: 'draft',
        created: '2026-05-01',
        modified: '2026-06-01',
        source: 'openkosmos',
        tags: ['red', 'green'],
        outbound: ['beta'],
        inbound: ['gamma'],
      },
    });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Full body')).toBeTruthy());
    expect(document.querySelector('.file-viewer-markdown-content')).not.toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('Created')).toBeNull();
    expect(screen.queryByText('Modified')).toBeNull();
    expect(screen.queryByText('Source')).toBeNull();
    expect(screen.queryByText('#red')).toBeNull();
    expect(screen.queryByText('#green')).toBeNull();
    expect(screen.queryByText('beta')).toBeNull();
    expect(screen.queryByText('gamma')).toBeNull();
  });

  it('detail view shows the "No content" placeholder for an empty body', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    mocks.readCard.mockResolvedValue({
      success: true,
      data: { slug: 'alpha-note', title: 'Alpha Note', content: '', outbound: [], inbound: [] },
    });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('No content')).toBeTruthy());
  });

  it('detail view reports "Card not found" when the read succeeds without data', async () => {
    setAtom({ visible: true, selectedSlug: 'ghost' });
    mocks.readCard.mockResolvedValue({ success: true, data: undefined });
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Card not found')).toBeTruthy());
  });

  it('detail view surfaces a thrown Error from readCard', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    mocks.readCard.mockRejectedValue(new Error('kaboom'));
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('kaboom')).toBeTruthy());
  });

  it('detail view falls back to a generic message when readCard throws a non-Error', async () => {
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    mocks.readCard.mockRejectedValue('plain rejection');
    await act(async () => { render(<MemexMemorySidepane />); });
    await waitFor(() => expect(screen.getByText('Failed to load card')).toBeTruthy());
  });

  it('detail header uses the selected summary title carried over from the list', async () => {
    // Render the list first so `cards` is populated, then switch to the detail
    // view for that same slug WITHOUT unmounting: `cards.find(...)` resolves the
    // summary and the header renders its title (exercising the find callback).
    const { rerender } = render(<MemexMemorySidepane />);
    await waitFor(() => expect(screen.getByText('Alpha Note')).toBeTruthy());

    mocks.readCard.mockResolvedValue({
      success: true,
      data: { slug: 'alpha-note', title: 'Alpha Note', content: 'Body', outbound: [], inbound: [] },
    });
    setAtom({ visible: true, selectedSlug: 'alpha-note' });
    await act(async () => { rerender(<MemexMemorySidepane />); });
    // The header title comes from the carried-over summary, not the loaded detail.
    await waitFor(() => expect(screen.getByText('Back')).toBeTruthy());
    expect(screen.getAllByText('Alpha Note').length).toBeGreaterThan(0);
  });
});

describe('ToggleMemexMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMemexMemoryEnabled.mockReturnValue(true);
  });

  it('returns null when memex memory is disabled', () => {
    mocks.useMemexMemoryEnabled.mockReturnValue(false);
    setAtom({ visible: false, selectedSlug: null });
    const { container } = render(<ToggleMemexMemory />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a button and toggles the pane on click', () => {
    const effectiveToggle = vi.fn();
    mocks.atomUse.mockReturnValue([{ visible: false, selectedSlug: null }, { effectiveToggle }]);
    render(<ToggleMemexMemory />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(effectiveToggle).toHaveBeenCalled();
  });

  it('reflects the active state when the pane is visible', () => {
    mocks.atomUse.mockReturnValue([{ visible: true, selectedSlug: null }, { effectiveToggle: vi.fn() }]);
    render(<ToggleMemexMemory />);
    expect(screen.getByRole('button').className).toContain('active');
  });
});
