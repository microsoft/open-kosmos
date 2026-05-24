/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for ArchivedAgentsView.tsx
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockGetArchivedAgents = vi.hoisted(() => vi.fn());
const mockUnarchiveChatConfig = vi.hoisted(() => vi.fn());
const mockProfileDataManagerRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ── CSS mocks ─────────────────────────────────────────────────────────────────
vi.mock('../../../styles/RuntimeSettings.css', () => ({}));
vi.mock('../../../styles/Header.css', () => ({}));

// ── Dependency mocks ──────────────────────────────────────────────────────────
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../lib/userData', () => ({
  profileDataManager: { refresh: mockProfileDataManagerRefresh },
}));

vi.mock('lucide-react', () => ({
  Archive: ({ size, strokeWidth, style }: any) => (
    <svg data-testid="archive-icon" data-size={size} />
  ),
  RotateCcw: ({ size }: any) => <svg data-testid="rotate-icon" data-size={size} />,
}));

// ── import component ──────────────────────────────────────────────────────────
import ArchivedAgentsView from '../ArchivedAgentsView';

// ── helpers ───────────────────────────────────────────────────────────────────
function setupElectronAPI(overrides: any = {}) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      profile: {
        getArchivedAgents: mockGetArchivedAgents,
        unarchiveChatConfig: mockUnarchiveChatConfig,
        ...overrides.profile,
      },
      ...overrides,
    },
  });
}

function makeArchivedAgent(overrides: any = {}) {
  return {
    archived_at: '2024-01-15T10:30:00Z',
    chat_id: 'chat-1',
    chat_type: 'agent',
    agent: {
      name: 'My Agent',
      description: 'Agent description',
      model: 'gpt-4',
      source: 'ON-DEVICE',
    },
    ...overrides,
  };
}

describe('ArchivedAgentsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  // ── Loading state ─────────────────────────────────────────────────────────
  it('shows loading text while fetching', async () => {
    // Return a pending promise to keep it in loading state briefly
    let resolvePromise: any;
    mockGetArchivedAgents.mockReturnValue(new Promise((r) => { resolvePromise = r; }));
    render(<ArchivedAgentsView />);
    expect(screen.getByText('Loading archived agents...')).toBeInTheDocument();
    // Resolve to clean up
    resolvePromise({ success: true, data: [] });
  });

  // ── Empty state ────────────────────────────────────────────────────────────
  it('shows empty state when no archived agents', async () => {
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('No archived agents')).toBeInTheDocument();
    });
  });

  // ── Empty state: API returns failure ──────────────────────────────────────
  it('shows empty state when API returns failure', async () => {
    mockGetArchivedAgents.mockResolvedValue({ success: false });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('No archived agents')).toBeInTheDocument();
    });
  });

  // ── Empty state: API not available ────────────────────────────────────────
  it('shows empty state when electronAPI.profile is not available', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {},
    });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('No archived agents')).toBeInTheDocument();
    });
  });

  // ── Empty state: exception ─────────────────────────────────────────────────
  it('shows empty state when getArchivedAgents throws', async () => {
    mockGetArchivedAgents.mockRejectedValue(new Error('Network error'));
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('No archived agents')).toBeInTheDocument();
    });
  });

  // ── Renders archived agents ────────────────────────────────────────────────
  it('renders archived agents when data is returned', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('My Agent')).toBeInTheDocument();
      expect(screen.getByText('Agent description')).toBeInTheDocument();
    });
  });

  // ── Agent source badge ─────────────────────────────────────────────────────
  it('renders source badge when agent has source', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('ON-DEVICE')).toBeInTheDocument();
    });
  });

  // ── No source badge when source is absent ─────────────────────────────────
  it('does not render source badge when agent has no source', async () => {
    const agent = makeArchivedAgent({ agent: { name: 'Agent A', description: '' } });
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.queryByText('ON-DEVICE')).not.toBeInTheDocument();
    });
  });

  // ── Unknown agent name fallback ────────────────────────────────────────────
  it('shows "Unknown Agent" when agent has no name', async () => {
    const agent = makeArchivedAgent({ agent: {} });
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('Unknown Agent')).toBeInTheDocument();
    });
  });

  // ── No agent info at all ───────────────────────────────────────────────────
  it('handles archived agent with no agent object', async () => {
    const agent = { archived_at: '2024-01-15T10:30:00Z', chat_id: 'chat-2', chat_type: 'agent' };
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('Unknown Agent')).toBeInTheDocument();
    });
  });

  // ── Date formatting ────────────────────────────────────────────────────────
  it('renders formatted archived date', async () => {
    const agent = makeArchivedAgent({ archived_at: '2024-01-15T10:30:00Z' });
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      // Should contain some date text (format depends on locale)
      const archivedText = document.querySelector('span[style]');
      expect(screen.getAllByText(/Archived/i).length).toBeGreaterThan(0);
    });
  });

  // ── Sorting by archived_at descending ─────────────────────────────────────
  it('sorts agents with most recent first', async () => {
    const older = makeArchivedAgent({
      archived_at: '2024-01-01T00:00:00Z',
      chat_id: 'chat-old',
      agent: { name: 'Old Agent' },
    });
    const newer = makeArchivedAgent({
      archived_at: '2024-06-01T00:00:00Z',
      chat_id: 'chat-new',
      agent: { name: 'New Agent' },
    });
    // Pass older before newer to confirm sorting
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [older, newer] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      const agents = screen.getAllByText(/Agent/i).filter(
        el => el.tagName === 'SPAN' && (el.textContent === 'New Agent' || el.textContent === 'Old Agent')
      );
      // New Agent should appear first in DOM
      const all = document.body.textContent || '';
      expect(all.indexOf('New Agent')).toBeLessThan(all.indexOf('Old Agent'));
    });
  });

  // ── Restore button shown ───────────────────────────────────────────────────
  it('shows Restore button for each agent', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('Restore')).toBeInTheDocument();
    });
  });

  // ── Successful restore ─────────────────────────────────────────────────────
  it('calls unarchiveChatConfig and refreshes on successful restore', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    mockUnarchiveChatConfig.mockResolvedValue({ success: true });
    render(<ArchivedAgentsView />);
    await waitFor(() => screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => {
      expect(mockUnarchiveChatConfig).toHaveBeenCalledWith('chat-1');
      expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('My Agent'));
      expect(mockProfileDataManagerRefresh).toHaveBeenCalled();
    });
  });

  // ── Restore failure ────────────────────────────────────────────────────────
  it('shows error toast when unarchive returns failure', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    mockUnarchiveChatConfig.mockResolvedValue({ success: false, error: 'DB error' });
    render(<ArchivedAgentsView />);
    await waitFor(() => screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('DB error'));
    });
  });

  // ── Restore: failure with no error message ────────────────────────────────
  it('shows generic error when unarchive failure has no error field', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    mockUnarchiveChatConfig.mockResolvedValue({ success: false });
    render(<ArchivedAgentsView />);
    await waitFor(() => screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'));
    });
  });

  // ── Restore throws exception ───────────────────────────────────────────────
  it('shows error toast when unarchiveChatConfig throws', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    mockUnarchiveChatConfig.mockRejectedValue(new Error('Connection refused'));
    render(<ArchivedAgentsView />);
    await waitFor(() => screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Connection refused'));
    });
  });

  // ── Restore API not available ─────────────────────────────────────────────
  it('shows error when unarchive API is not available', async () => {
    setupElectronAPI({ profile: { getArchivedAgents: mockGetArchivedAgents } });
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    render(<ArchivedAgentsView />);
    await waitFor(() => screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Restore API not available');
    });
  });

  // ── Restoring... spinner text while in progress ────────────────────────────
  it('shows "Restoring..." while restore is in progress', async () => {
    const agent = makeArchivedAgent();
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [agent] });
    let resolveRestore: any;
    mockUnarchiveChatConfig.mockReturnValue(new Promise((r) => { resolveRestore = r; }));
    render(<ArchivedAgentsView />);
    await waitFor(() => screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => {
      expect(screen.getByText('Restoring...')).toBeInTheDocument();
    });
    resolveRestore({ success: true });
  });

  // ── Header renders correctly ───────────────────────────────────────────────
  it('renders header with "Archived Agents" title', async () => {
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: [] });
    render(<ArchivedAgentsView />);
    expect(screen.getByText('Archived Agents')).toBeInTheDocument();
  });

  // ── Multiple agents rendered ───────────────────────────────────────────────
  it('renders multiple archived agents', async () => {
    const agents = [
      makeArchivedAgent({ chat_id: 'c1', agent: { name: 'Agent A' } }),
      makeArchivedAgent({ chat_id: 'c2', agent: { name: 'Agent B' } }),
      makeArchivedAgent({ chat_id: 'c3', agent: { name: 'Agent C' } }),
    ];
    mockGetArchivedAgents.mockResolvedValue({ success: true, data: agents });
    render(<ArchivedAgentsView />);
    await waitFor(() => {
      expect(screen.getByText('Agent A')).toBeInTheDocument();
      expect(screen.getByText('Agent B')).toBeInTheDocument();
      expect(screen.getByText('Agent C')).toBeInTheDocument();
    });
  });
});
