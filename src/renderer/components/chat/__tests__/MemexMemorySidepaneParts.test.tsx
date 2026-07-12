// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CardListItem, MemexCardDetail } from '../MemexMemorySidepaneParts';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const readCard = vi.fn();
  let changedCb: ((data: { chatId: string }) => void) | null = null;
  const cardsChanged = vi.fn((cb) => {
    changedCb = cb;
    return vi.fn(); // unsubscribe
  });
  return {
    readCard,
    cardsChanged,
    fireChanged: (data: { chatId: string }) => changedCb?.(data),
  };
});
const i18nState = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'profileMemory.loading': 'Loading...',
    'profileMemory.cardNotFound': 'Card not found',
    'profileMemory.failedToLoadCard': 'Failed to load card',
    'profileMemory.noContentShort': 'No content',
  };
  const makeTranslator = () => (key: string) => messages[key] ?? key;
  return {
    language: 'en',
    translators: {
      en: makeTranslator(),
      'zh-CN': makeTranslator(),
    },
  };
});

vi.mock('../../../ipc/memex', () => ({
  memexApi: { readCard: mocks.readCard },
  memexEvents: { cardsChanged: mocks.cardsChanged },
}));
vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh-CN'],
  }),
}));

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fullCard(overrides = {}) {
  return {
    slug: 'alpha',
    title: 'Alpha',
    category: 'work',
    status: 'active',
    created: '2026-01-01',
    modified: '2026-06-01',
    source: 'note',
    tags: ['x', 'y'],
    content: 'Body text',
    outbound: ['beta'],
    inbound: ['gamma'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  i18nState.language = 'en';
});

// ── CardListItem ──────────────────────────────────────────────────────────────
describe('CardListItem', () => {
  it('renders title and reacts to click + hover', () => {
    const onClick = vi.fn();
    render(
      <CardListItem
        card={{ slug: 's', title: 'My Title', excerpt: 'Some excerpt', category: 'cat', modified: 'mod' }}
        onClick={onClick}
      />,
    );
    expect(screen.getByText('My Title')).toBeTruthy();
    expect(screen.getByText('Some excerpt')).toBeTruthy();
    expect(screen.getByText('cat · mod')).toBeTruthy();

    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.mouseEnter(btn);
    expect(btn.style.backgroundColor).toContain('rgba(0, 0, 0, 0.05)');
    fireEvent.mouseLeave(btn);
    expect(btn.style.backgroundColor).toBe('var(--color-white)');
  });

  it('falls back to slug and hides optional rows when absent', () => {
    render(<CardListItem card={{ slug: 'only-slug' }} onClick={vi.fn()} />);
    expect(screen.getByText('only-slug')).toBeTruthy();
    // no excerpt, no category/modified line
    expect(screen.queryByText('·')).toBeNull();
  });
});

// ── MemexCardDetail ───────────────────────────────────────────────────────────
describe('MemexCardDetail', () => {
  it('shows loading state while the card request is pending', () => {
    const d = makeDeferred();
    mocks.readCard.mockReturnValue(d.promise);
    render(<MemexCardDetail chatId="c1" slug="alpha" />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders the raw card Markdown with the Skill markdown viewer', async () => {
    mocks.readCard.mockResolvedValue({
      success: true,
      data: fullCard({
        rawContent: [
          '---',
          'title: Alpha',
          'category: work',
          'source: note',
          '---',
          '# Memory Heading',
          '',
          '- Body text',
        ].join('\n'),
      }),
    });
    render(<MemexCardDetail chatId="c1" slug="alpha" />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Memory Heading' })).toBeTruthy());
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('source')).toBeTruthy();
    expect(screen.getByText('note')).toBeTruthy();
    expect(screen.getByText('Body text')).toBeTruthy();
    expect(screen.queryByText('Category')).toBeNull();
    expect(screen.queryByText('#x')).toBeNull();
    expect(screen.queryByText('Links to')).toBeNull();
    expect(screen.queryByText('Linked from')).toBeNull();
    expect(screen.queryByText('beta')).toBeNull();
  });

  it('navigates when a rendered Memex wikilink is clicked', async () => {
    const onNavigate = vi.fn();
    mocks.readCard.mockResolvedValue({
      success: true,
      data: fullCard({
        rawContent: 'See [[beta|Beta Memory]].',
        resolvedWikilinks: { beta: 'beta' },
      }),
    });
    render(<MemexCardDetail chatId="c1" slug="alpha" onNavigate={onNavigate} />);

    const link = await screen.findByRole('link', { name: 'Beta Memory' });
    fireEvent.click(link);

    expect(onNavigate).toHaveBeenCalledWith('beta');
  });

  it('renders "No content" and hides empty sections', async () => {
    mocks.readCard.mockResolvedValue({
      success: true,
      data: { slug: 'a', outbound: [], inbound: [], tags: [], content: '' },
    });
    render(<MemexCardDetail chatId="c1" slug="a" />);
    await waitFor(() => expect(screen.getByText('No content')).toBeTruthy());
    expect(screen.queryByText('Links to')).toBeNull();
    expect(screen.queryByText('Linked from')).toBeNull();
  });

  it('shows "Card not found" when success but no data', async () => {
    mocks.readCard.mockResolvedValue({ success: true, data: null });
    render(<MemexCardDetail chatId="c1" slug="a" />);
    await waitFor(() => expect(screen.getByText('Card not found')).toBeTruthy());
  });

  it('shows the error string when the request fails', async () => {
    mocks.readCard.mockResolvedValue({ success: false, error: 'boom' });
    render(<MemexCardDetail chatId="c1" slug="a" />);
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });

  it('shows a fallback message when the promise rejects with an Error', async () => {
    mocks.readCard.mockRejectedValue(new Error('network down'));
    render(<MemexCardDetail chatId="c1" slug="a" />);
    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());
  });

  it('shows a generic message when the promise rejects with a non-Error', async () => {
    mocks.readCard.mockRejectedValue('nope');
    render(<MemexCardDetail chatId="c1" slug="a" />);
    await waitFor(() => expect(screen.getByText('Failed to load card')).toBeTruthy());
  });

  it('reloads when a cardsChanged event matches the chatId, ignores other chats', async () => {
    mocks.readCard.mockResolvedValue({ success: true, data: fullCard({ content: 'first' }) });
    render(<MemexCardDetail chatId="c1" slug="alpha" />);
    await waitFor(() => expect(screen.getByText('first')).toBeTruthy());
    expect(mocks.readCard).toHaveBeenCalledTimes(1);

    mocks.readCard.mockResolvedValue({ success: true, data: fullCard({ content: 'second' }) });
    await act(async () => {
      mocks.fireChanged({ chatId: 'other' });
    });
    expect(mocks.readCard).toHaveBeenCalledTimes(1); // ignored

    await act(async () => {
      mocks.fireChanged({ chatId: 'c1' });
    });
    await waitFor(() => expect(screen.getByText('second')).toBeTruthy());
    expect(mocks.readCard).toHaveBeenCalledTimes(2);
  });

  it('does not reload card detail data when only language changes', async () => {
    mocks.readCard.mockResolvedValue({ success: true, data: fullCard({ content: 'stable body' }) });
    const { rerender } = render(<MemexCardDetail chatId="c1" slug="alpha" />);

    await waitFor(() => expect(screen.getByText('stable body')).toBeTruthy());
    expect(mocks.readCard).toHaveBeenCalledTimes(1);

    i18nState.language = 'zh-CN';
    rerender(<MemexCardDetail chatId="c1" slug="alpha" />);

    expect(screen.getByText('stable body')).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.readCard).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes and cancels pending loads on unmount', async () => {
    const unsub = vi.fn();
    mocks.cardsChanged.mockReturnValueOnce(unsub);
    mocks.readCard.mockResolvedValue({ success: true, data: fullCard() });
    const { unmount } = render(<MemexCardDetail chatId="c1" slug="alpha" />);
    await waitFor(() => expect(screen.getByText('Body text')).toBeTruthy());
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
