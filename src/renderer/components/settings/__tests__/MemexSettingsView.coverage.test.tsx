/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../styles/Header.css', () => ({}));
vi.mock('../../styles/DropdownMenu.css', () => ({}));
vi.mock('../../styles/ToolbarSettingsView.css', () => ({}));
vi.mock('../../styles/MemexMemory.css', () => ({}));
vi.mock('../../styles/ListSearchBox.css', () => ({}));

const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockUpdateMemexSettings = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const routerState = vi.hoisted(() => ({ search: '' }));
const memexMocks = vi.hoisted(() => {
  let changedCb: ((payload: { scope: string }) => void) | null = null;
  return {
    listProfileCards: vi.fn(),
    searchProfileCards: vi.fn(),
    readProfileCard: vi.fn(),
    archiveProfileCard: vi.fn(),
    deleteProfileCard: vi.fn(),
    cardsChanged: vi.fn((cb) => {
      changedCb = cb;
      return vi.fn();
    }),
    fireChanged: (payload: { scope: string } = { scope: 'profile-memory' }) => changedCb?.(payload),
  };
});

let mockProfile: Record<string, any> | null = {};

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { refresh: () => mockRefresh() },
}));

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ data: { profile: mockProfile } }),
}));

vi.mock('../../../ipc/memex', () => ({
  memexApi: {
    listProfileCards: memexMocks.listProfileCards,
    searchProfileCards: memexMocks.searchProfileCards,
    readProfileCard: memexMocks.readProfileCard,
    archiveProfileCard: memexMocks.archiveProfileCard,
    deleteProfileCard: memexMocks.deleteProfileCard,
  },
  memexEvents: {
    cardsChanged: memexMocks.cardsChanged,
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [new URLSearchParams(routerState.search)],
}));

import MemexSettingsView from '../MemexSettingsView';

beforeEach(() => {
  vi.clearAllMocks();
  routerState.search = '';
  mockProfile = { alias: 'alice', memex: { enabled: true } };
  mockUpdateMemexSettings.mockResolvedValue({ success: true });
  mockRefresh.mockResolvedValue(undefined);
  memexMocks.listProfileCards.mockResolvedValue({
    success: true,
    data: [{ slug: 'shared-card', title: 'Shared Card', excerpt: 'Shared context', category: 'team' }],
  });
  memexMocks.searchProfileCards.mockResolvedValue({
    success: true,
    data: [{ slug: 'search-hit', title: 'Search Hit', excerpt: 'Found context' }],
  });
  memexMocks.readProfileCard.mockResolvedValue({
    success: true,
    data: {
      slug: 'shared-card',
      title: 'Shared Card',
      category: 'team',
      created: '2026-07-04',
      source: 'OpenKosmos',
      tags: ['shared'],
      content: 'Body',
      outbound: ['next-card'],
      inbound: [],
    },
  });
  memexMocks.archiveProfileCard.mockResolvedValue({ success: true, data: 'Archived card: shared-card' });
  memexMocks.deleteProfileCard.mockResolvedValue({ success: true, data: 'Deleted card: shared-card' });
  (globalThis as any).window.electronAPI = {
    profile: { updateMemexSettings: mockUpdateMemexSettings },
  };
});

async function renderView() {
  render(<MemexSettingsView />);
  await screen.findByText('Memex Memory', { selector: '.header-name' });
}

describe('MemexSettingsView', () => {
  it('renders the Hooks-aligned enabled layout with list and detail', async () => {
    await renderView();
    expect(screen.getByTestId('profile-memory-manager')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Shared Card')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Body')).toBeTruthy());
    expect(screen.getAllByText('profile-memory').length).toBeGreaterThanOrEqual(1);
    expect(memexMocks.listProfileCards).toHaveBeenCalled();
    expect(memexMocks.readProfileCard).toHaveBeenCalledWith('shared-card');
  });

  it('shows the disabled empty state and enables from the CTA', async () => {
    mockProfile = { alias: 'alice', memex: { enabled: false } };
    await renderView();
    expect(screen.getByTestId('profile-memory-disabled-state')).toBeTruthy();
    expect(screen.getByText('Memex Memory Disabled')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Enable Memex Memory from empty state'));
    await waitFor(() => expect(mockUpdateMemexSettings).toHaveBeenCalledWith('alice', { enabled: true }));
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalledWith('Memex Memory enabled');
  });

  it('disables from the header master switch', async () => {
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable Memex Memory'));
    await waitFor(() => expect(mockUpdateMemexSettings).toHaveBeenCalledWith('alice', { enabled: false }));
    expect(screen.getByTestId('profile-memory-disabled-state')).toBeTruthy();
    expect(mockShowSuccess).toHaveBeenCalledWith('Memex Memory disabled');
  });

  it('searches profile memory cards from the list panel', async () => {
    await renderView();
    fireEvent.change(screen.getByPlaceholderText('Search profile memory...'), { target: { value: 'hit' } });
    await waitFor(() => expect(memexMocks.searchProfileCards).toHaveBeenCalledWith('hit'));
    await waitFor(() => expect(screen.getByText('Search Hit')).toBeTruthy());
  });

  it('does not expose manual create or edit actions', async () => {
    await renderView();
    expect(screen.queryByLabelText('Add profile memory card')).toBeNull();

    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    expect(screen.queryByLabelText('Edit Shared Card')).toBeNull();
    expect(screen.getByLabelText('Archive Shared Card')).toBeTruthy();
    expect(screen.getByLabelText('Delete Shared Card')).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('archives through the Hooks-style row menu and dialog', async () => {
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Archive Shared Card'));
    expect(screen.getByText('Archive Profile Memory')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Confirm archive profile memory'));
    await waitFor(() => expect(memexMocks.archiveProfileCard).toHaveBeenCalledWith('shared-card'));
    expect(mockShowSuccess).toHaveBeenCalledWith('Archived card: shared-card');
  });

  it('deletes through the row menu and dialog', async () => {
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Delete Shared Card'));
    expect(screen.getByText('Delete Profile Memory')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Confirm delete profile memory'));
    await waitFor(() => expect(memexMocks.deleteProfileCard).toHaveBeenCalledWith('shared-card'));
    expect(mockShowSuccess).toHaveBeenCalledWith('Deleted card: shared-card');
  });

  it('uses the selectCard query parameter when opening the page', async () => {
    routerState.search = 'selectCard=second-card';
    memexMocks.listProfileCards.mockResolvedValue({
      success: true,
      data: [
        { slug: 'first-card', title: 'First Card', excerpt: '' },
        { slug: 'second-card', title: 'Second Card', excerpt: '' },
      ],
    });
    memexMocks.readProfileCard.mockImplementation(async (slug: string) => ({
      success: true,
      data: {
        slug,
        title: slug === 'second-card' ? 'Second Card' : 'First Card',
        content: `${slug} body`,
        outbound: [],
        inbound: [],
      },
    }));
    await renderView();
    await waitFor(() => expect(screen.getByText('second-card body')).toBeTruthy());
  });

  it('does not render structured link chips in the Markdown file viewer', async () => {
    await renderView();
    await waitFor(() => expect(screen.getByText('Body')).toBeTruthy());
    expect(screen.queryByText('next-card')).toBeNull();
    expect(memexMocks.readProfileCard).not.toHaveBeenCalledWith('next-card');
  });

  it('selects cards from the list panel', async () => {
    memexMocks.listProfileCards.mockResolvedValue({
      success: true,
      data: [
        { slug: 'first-card', title: 'First Card', excerpt: '' },
        { slug: 'second-card', title: 'Second Card', excerpt: '' },
      ],
    });
    memexMocks.readProfileCard.mockImplementation(async (slug: string) => ({
      success: true,
      data: { slug, title: slug, content: `${slug} body`, outbound: [], inbound: [] },
    }));
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Select Second Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Select Second Card'));
    await waitFor(() => expect(memexMocks.readProfileCard).toHaveBeenCalledWith('second-card'));
  });

  it('navigates between profile-memory cards from Markdown wikilinks', async () => {
    memexMocks.listProfileCards.mockResolvedValue({
      success: true,
      data: [{ slug: 'shared-card', title: 'Shared Card', excerpt: '' }],
    });
    memexMocks.readProfileCard.mockImplementation(async (slug: string) => ({
      success: true,
      data: slug === 'shared-card'
        ? {
            slug: 'shared-card',
            title: 'Shared Card',
            content: 'See [[next-card|Next Card]].',
            rawContent: 'See [[next-card|Next Card]].',
            outbound: ['next-card'],
            resolvedWikilinks: { 'next-card': 'next-card' },
            inbound: [],
          }
        : { slug: 'next-card', title: 'Next Card', content: 'Target body', outbound: [], inbound: [] },
    }));
    await renderView();
    const link = await screen.findByRole('link', { name: 'Next Card' });

    fireEvent.click(link);

    await waitFor(() => expect(memexMocks.readProfileCard).toHaveBeenCalledWith('next-card'));
    expect(screen.getByPlaceholderText('Search profile memory...')).toHaveValue('');
  });

  it('ignores non-profile memory events and reloads on profile-memory events', async () => {
    await renderView();
    await waitFor(() => expect(memexMocks.listProfileCards).toHaveBeenCalledTimes(1));
    memexMocks.fireChanged({ scope: 'current-agent' });
    await Promise.resolve();
    expect(memexMocks.listProfileCards).toHaveBeenCalledTimes(1);

    memexMocks.fireChanged();
    await waitFor(() => expect(memexMocks.listProfileCards).toHaveBeenCalledTimes(2));
  });

  it('shows list and detail loading/error states', async () => {
    memexMocks.listProfileCards.mockResolvedValueOnce({ success: false, error: 'list failed' });
    const { unmount } = render(<MemexSettingsView />);
    expect(await screen.findByText('list failed')).toBeTruthy();
    unmount();

    memexMocks.listProfileCards.mockResolvedValueOnce({
      success: true,
      data: [{ slug: 'broken-detail', title: 'Broken Detail', excerpt: '' }],
    });
    memexMocks.readProfileCard.mockResolvedValueOnce({ success: false, error: 'detail failed' });
    render(<MemexSettingsView />);
    expect(await screen.findByText('detail failed')).toBeTruthy();
  });

  it('shows default list and detail API errors', async () => {
    memexMocks.listProfileCards.mockResolvedValueOnce({ success: false });
    const { unmount } = render(<MemexSettingsView />);
    expect(await screen.findByText('Failed to load profile memory.')).toBeTruthy();
    unmount();

    memexMocks.listProfileCards.mockResolvedValueOnce({
      success: true,
      data: [{ slug: 'broken-detail', title: 'Broken Detail', excerpt: '' }],
    });
    memexMocks.readProfileCard.mockResolvedValueOnce({ success: false });
    render(<MemexSettingsView />);
    expect(await screen.findByText('Failed to load profile memory card.')).toBeTruthy();
  });

  it('shows thrown list and detail errors', async () => {
    memexMocks.listProfileCards.mockRejectedValueOnce(new Error('list threw'));
    const { unmount } = render(<MemexSettingsView />);
    expect(await screen.findByText('list threw')).toBeTruthy();
    unmount();

    memexMocks.listProfileCards.mockResolvedValueOnce({
      success: true,
      data: [{ slug: 'broken-detail', title: 'Broken Detail', excerpt: '' }],
    });
    memexMocks.readProfileCard.mockRejectedValueOnce(new Error('detail threw'));
    render(<MemexSettingsView />);
    expect(await screen.findByText('detail threw')).toBeTruthy();
  });

  it('shows default thrown list and detail errors for non-Error rejections', async () => {
    memexMocks.listProfileCards.mockRejectedValueOnce('list rejected');
    const { unmount } = render(<MemexSettingsView />);
    expect(await screen.findByText('Failed to load profile memory.')).toBeTruthy();
    unmount();

    memexMocks.listProfileCards.mockResolvedValueOnce({
      success: true,
      data: [{ slug: 'broken-detail', title: 'Broken Detail', excerpt: '' }],
    });
    memexMocks.readProfileCard.mockRejectedValueOnce('detail rejected');
    render(<MemexSettingsView />);
    expect(await screen.findByText('Failed to load profile memory card.')).toBeTruthy();
  });

  it('handles omitted list and detail data', async () => {
    memexMocks.listProfileCards.mockResolvedValueOnce({ success: true });
    const { unmount } = render(<MemexSettingsView />);
    expect(await screen.findByText('No profile memory cards yet. Agents can create profile memory with the memex_memory tool.')).toBeTruthy();
    unmount();

    memexMocks.listProfileCards.mockResolvedValueOnce({
      success: true,
      data: [{ slug: 'empty-detail', title: 'Empty Detail', excerpt: '' }],
    });
    memexMocks.readProfileCard.mockResolvedValueOnce({ success: true });
    render(<MemexSettingsView />);
    expect(await screen.findByText('Select a profile memory card to view its content.')).toBeTruthy();
  });

  it('closes the row menu when toggled again or clicked outside', async () => {
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    const trigger = screen.getByLabelText('Profile memory options for Shared Card');
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Archive Shared Card')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByLabelText('Archive Shared Card')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByLabelText('Archive Shared Card')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText('Archive Shared Card')).toBeNull();
  });

  it('archives a non-selected card and uses the fallback success message', async () => {
    memexMocks.listProfileCards.mockResolvedValue({
      success: true,
      data: [
        { slug: 'first-card', title: 'First Card', excerpt: '' },
        { slug: 'second-card', title: 'Second Card', excerpt: '' },
      ],
    });
    memexMocks.readProfileCard.mockResolvedValue({
      success: true,
      data: { slug: 'first-card', title: 'First Card', content: 'first body', outbound: [], inbound: [] },
    });
    memexMocks.archiveProfileCard.mockResolvedValueOnce({ success: true });
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Second Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Second Card'));
    fireEvent.click(screen.getByLabelText('Archive Second Card'));
    fireEvent.click(screen.getByLabelText('Confirm archive profile memory'));
    await waitFor(() => expect(memexMocks.archiveProfileCard).toHaveBeenCalledWith('second-card'));
    expect(mockShowSuccess).toHaveBeenCalledWith('Archived card: second-card');
  });

  it('shows archive API and thrown errors', async () => {
    memexMocks.archiveProfileCard.mockResolvedValueOnce({ success: false, error: 'archive failed' });
    const { unmount } = render(<MemexSettingsView />);
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Archive Shared Card'));
    fireEvent.click(screen.getByLabelText('Confirm archive profile memory'));
    expect(await screen.findByText('archive failed')).toBeTruthy();
    expect(mockShowError).toHaveBeenCalledWith('archive failed');
    unmount();

    memexMocks.archiveProfileCard.mockRejectedValueOnce(new Error('archive threw'));
    render(<MemexSettingsView />);
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Archive Shared Card'));
    fireEvent.click(screen.getByLabelText('Confirm archive profile memory'));
    expect(await screen.findByText('archive threw')).toBeTruthy();
    expect(mockShowError).toHaveBeenCalledWith('archive threw');
  });

  it('shows default archive errors and supports canceling the archive dialog', async () => {
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Archive Shared Card'));
    fireEvent.click(screen.getByLabelText('Cancel archive profile memory'));
    expect(screen.queryByText('Archive Profile Memory')).toBeNull();

    memexMocks.archiveProfileCard.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Archive Shared Card'));
    fireEvent.click(screen.getByLabelText('Confirm archive profile memory'));
    expect(await screen.findByText('Failed to archive profile memory card.')).toBeTruthy();
    expect(mockShowError).toHaveBeenCalledWith('Failed to archive profile memory card.');
  });

  it('deletes a non-selected card and uses the fallback success message', async () => {
    memexMocks.listProfileCards.mockResolvedValue({
      success: true,
      data: [
        { slug: 'first-card', title: 'First Card', excerpt: '' },
        { slug: 'second-card', title: 'Second Card', excerpt: '' },
      ],
    });
    memexMocks.readProfileCard.mockResolvedValue({
      success: true,
      data: { slug: 'first-card', title: 'First Card', content: 'first body', outbound: [], inbound: [] },
    });
    memexMocks.deleteProfileCard.mockResolvedValueOnce({ success: true });
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Second Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Second Card'));
    fireEvent.click(screen.getByLabelText('Delete Second Card'));
    fireEvent.click(screen.getByLabelText('Confirm delete profile memory'));
    await waitFor(() => expect(memexMocks.deleteProfileCard).toHaveBeenCalledWith('second-card'));
    expect(mockShowSuccess).toHaveBeenCalledWith('Deleted card: second-card');
  });

  it('shows delete API and thrown errors', async () => {
    memexMocks.deleteProfileCard.mockResolvedValueOnce({ success: false, error: 'delete failed' });
    const { unmount } = render(<MemexSettingsView />);
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Delete Shared Card'));
    fireEvent.click(screen.getByLabelText('Confirm delete profile memory'));
    expect(await screen.findByText('delete failed')).toBeTruthy();
    expect(mockShowError).toHaveBeenCalledWith('delete failed');
    unmount();

    memexMocks.deleteProfileCard.mockRejectedValueOnce(new Error('delete threw'));
    render(<MemexSettingsView />);
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Delete Shared Card'));
    fireEvent.click(screen.getByLabelText('Confirm delete profile memory'));
    expect(await screen.findByText('delete threw')).toBeTruthy();
    expect(mockShowError).toHaveBeenCalledWith('delete threw');
  });

  it('shows default delete errors and supports canceling the delete dialog', async () => {
    await renderView();
    await waitFor(() => expect(screen.getByLabelText('Profile memory options for Shared Card')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Delete Shared Card'));
    fireEvent.click(screen.getByLabelText('Cancel delete profile memory'));
    expect(screen.queryByText('Delete Profile Memory')).toBeNull();

    memexMocks.deleteProfileCard.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    fireEvent.click(screen.getByLabelText('Delete Shared Card'));
    fireEvent.click(screen.getByLabelText('Confirm delete profile memory'));
    expect(await screen.findByText('Failed to delete profile memory card.')).toBeTruthy();
    expect(mockShowError).toHaveBeenCalledWith('Failed to delete profile memory card.');
  });

  it('surfaces settings update failures', async () => {
    mockProfile = { alias: 'alice', memex: { enabled: false } };
    mockUpdateMemexSettings.mockResolvedValueOnce({ success: false, error: 'update failed' });
    const { unmount } = render(<MemexSettingsView />);
    await screen.findByTestId('profile-memory-disabled-state');
    fireEvent.click(screen.getByLabelText('Enable Memex Memory from empty state'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to update: update failed'));
    unmount();

    mockProfile = { alias: 'alice', memex: { enabled: false } };
    mockUpdateMemexSettings.mockRejectedValueOnce(new Error('update threw'));
    render(<MemexSettingsView />);
    await screen.findByTestId('profile-memory-disabled-state');
    fireEvent.click(screen.getByLabelText('Enable Memex Memory from empty state'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to update: update threw'));
  });

  it('surfaces default settings update failures and non-Error rejections', async () => {
    mockProfile = { alias: 'alice', memex: { enabled: false } };
    mockUpdateMemexSettings.mockResolvedValueOnce({ success: false });
    const { unmount } = render(<MemexSettingsView />);
    await screen.findByTestId('profile-memory-disabled-state');
    fireEvent.click(screen.getByLabelText('Enable Memex Memory from empty state'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to update: Unknown error'));
    unmount();

    mockProfile = { alias: 'alice', memex: { enabled: false } };
    mockUpdateMemexSettings.mockRejectedValueOnce('update rejected');
    render(<MemexSettingsView />);
    await screen.findByTestId('profile-memory-disabled-state');
    fireEvent.click(screen.getByLabelText('Enable Memex Memory from empty state'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to update: update rejected'));
  });

  it('surfaces toggle errors without calling the settings API when signed out', async () => {
    mockProfile = null;
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable Memex Memory from empty state'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to update: No signed-in user.'));
    expect(mockUpdateMemexSettings).not.toHaveBeenCalled();
  });
});
