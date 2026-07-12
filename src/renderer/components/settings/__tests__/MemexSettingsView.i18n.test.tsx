/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import MemexSettingsView from '../MemexSettingsView';

const i18nState = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'profileMemory.title': 'Memex Memory',
    'profileMemory.count': '{count} cards',
    'profileMemory.enableMemory': 'Enable Memex Memory',
  };
  const makeTranslator = () => (key: string, params?: Record<string, unknown>) => {
    const template = messages[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
  };

  return {
    language: 'en',
    translators: {
      en: makeTranslator(),
      zh: makeTranslator(),
    },
  };
});

const memexMocks = vi.hoisted(() => ({
  listProfileCards: vi.fn(),
  searchProfileCards: vi.fn(),
  readProfileCard: vi.fn(),
  cardsChanged: vi.fn(() => vi.fn()),
}));

vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh'],
  }),
}));
vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ data: { profile: { alias: 'alice', memex: { enabled: true } } } }),
}));
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { refresh: vi.fn() },
}));
vi.mock('../../../ipc/memex', () => ({
  memexApi: {
    listProfileCards: memexMocks.listProfileCards,
    searchProfileCards: memexMocks.searchProfileCards,
    readProfileCard: memexMocks.readProfileCard,
  },
  memexEvents: {
    cardsChanged: memexMocks.cardsChanged,
  },
}));
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('../ProfileMemoryListPanel', () => ({
  default: ({ cards }: { cards: Array<{ title: string; slug: string }> }) => (
    <div data-testid="profile-memory-list">
      {cards.map(card => <span key={card.slug}>{card.title}</span>)}
    </div>
  ),
}));
vi.mock('../ProfileMemoryDetailPanel', () => ({
  default: ({ card }: { card: { content?: string } | null }) => (
    <div data-testid="profile-memory-detail">{card?.content ?? ''}</div>
  ),
}));
vi.mock('../ProfileMemoryDropdownMenu', () => ({
  default: () => null,
}));
vi.mock('../../../styles/Header.css', () => ({}));
vi.mock('../../../styles/DropdownMenu.css', () => ({}));
vi.mock('../../../styles/ToolbarSettingsView.css', () => ({}));
vi.mock('../../../styles/MemexMemory.css', () => ({}));

describe('MemexSettingsView i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
    memexMocks.listProfileCards.mockResolvedValue({
      success: true,
      data: [{ slug: 'shared-card', title: 'Shared Card', excerpt: 'Shared context' }],
    });
    memexMocks.readProfileCard.mockResolvedValue({
      success: true,
      data: { slug: 'shared-card', title: 'Shared Card', content: 'Body', outbound: [], inbound: [] },
    });
  });

  it('does not refetch profile memory cards or detail when only language changes', async () => {
    const { rerender } = render(<MemexSettingsView />);
    await waitFor(() => expect(screen.getByText('Shared Card')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('profile-memory-detail')).toHaveTextContent('Body'));
    expect(memexMocks.listProfileCards).toHaveBeenCalledTimes(1);
    expect(memexMocks.readProfileCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      i18nState.language = 'zh';
      rerender(<MemexSettingsView />);
    });

    expect(memexMocks.listProfileCards).toHaveBeenCalledTimes(1);
    expect(memexMocks.readProfileCard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('profile-memory-detail')).toHaveTextContent('Body');
  });
});
