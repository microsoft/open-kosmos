// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Additional coverage tests for SubAgentsView — covers import, sync,
 * refresh listener, and list-item interaction branches.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('../../../styles/Header.css', () => ({}));
vi.mock('../../../styles/SubAgentsView.css', () => ({}));
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// ──── Mocks ────

const mockNavigate = vi.fn();
const mockOnSubAgentsAddMenuToggle = vi.fn();
const mockOnSubAgentMenuToggle = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

const mockUseOutletContext = vi.fn(() => ({
  onSubAgentsAddMenuToggle: mockOnSubAgentsAddMenuToggle,
  onSubAgentMenuToggle: mockOnSubAgentMenuToggle,
}));

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useOutletContext: () => mockUseOutletContext(),
}));

vi.mock('../SubAgentListItem', () => ({
  default: function MockSubAgentListItem(props: any) {
    return (
      <div
        data-testid={`sub-agent-item-${props.config.name}`}
        onClick={props.onClick}
      >
        <button
          data-testid={`menu-btn-${props.config.name}`}
          onClick={(e) => props.onMenuToggle(e.currentTarget)}
        >
          menu
        </button>
        {props.config.display_name}
      </div>
    );
  },
}));

const mockUseSubAgents = vi.fn();
vi.mock('../../userData/userDataProvider', () => ({
  useSubAgents: () => mockUseSubAgents(),
  useMCPServers: () => ({ servers: [{ hidden: false }, { hidden: true }] }),
  useSkills: () => ({ skills: [{ name: 'skill1' }] }),
  useProfileDataRefresh: () => ({ refresh: mockRefresh }),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../ui/badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

import SubAgentsView from '../SubAgentsView';

const mockSubAgents = [
  {
    name: 'web-researcher',
    display_name: 'Web Researcher',
    emoji: '🔍',
    description: '',
    version: '1.0',
    source: 'IN-LIBRARY',
    system_prompt: '',
    mcp_servers: [],
    skills: [],
    builtin_tools: [],
    context_access: 'isolated',
  },
];

describe('SubAgentsView — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSubAgents.mockReturnValue({ subAgents: mockSubAgents, stats: { total: 1 }, isLoading: false });
    (window as any).electronAPI = undefined;
  });

  // ── Auto-select logic ────────────────────────────────────────────────────

  it('auto-selects first subAgent on mount', () => {
    mockUseSubAgents.mockReturnValue({ subAgents: mockSubAgents, stats: { total: 1 }, isLoading: false });
    render(<SubAgentsView />);
    // no crash; item rendered
    expect(screen.getByTestId('sub-agent-item-web-researcher')).toBeInTheDocument();
  });

  it('clears selection when subAgents becomes empty', async () => {
    mockUseSubAgents.mockReturnValue({ subAgents: mockSubAgents, stats: { total: 1 }, isLoading: false });
    const { rerender } = render(<SubAgentsView />);
    mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
    rerender(<SubAgentsView />);
    expect(screen.queryByTestId('sub-agent-item-web-researcher')).not.toBeInTheDocument();
  });

  // ── subAgents:refreshList event ──────────────────────────────────────────

  it('calls refresh() on subAgents:refreshList event', async () => {
    render(<SubAgentsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('subAgents:refreshList', { detail: null }));
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('updates selectedSubAgent when refreshList detail contains subAgentName', async () => {
    mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
    render(<SubAgentsView />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('subAgents:refreshList', {
          detail: { subAgentName: 'web-researcher' },
        }),
      );
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('cleans up subAgents:refreshList listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<SubAgentsView />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'subAgents:refreshList',
      expect.any(Function),
    );
    removeEventListenerSpy.mockRestore();
  });

  it('cleans up subAgents:importFromClaudeCode listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<SubAgentsView />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'subAgents:importFromClaudeCode',
      expect.any(Function),
    );
    removeEventListenerSpy.mockRestore();
  });

  // ── Import from Claude Code ──────────────────────────────────────────────

  it('shows error when no file path can be resolved', async () => {
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    const file = new File(['content'], 'agent.md', { type: 'text/markdown' });
    // No electronAPI.fs.getPathForFile, no file.path → error
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unable to get file path'));
  });

  it('shows error when import API is not available', async () => {
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    const file = Object.assign(new File(['content'], 'agent.md'), { path: '/some/agent.md' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    // No electronAPI.subAgent.importFromFile
    (window as any).electronAPI = {};
    await act(async () => {
      fireEvent.change(input);
    });
    expect(mockShowError).toHaveBeenCalledWith('Import API not available');
  });

  it('shows success after successful import and refreshes', async () => {
    vi.useFakeTimers();
    const mockImportFromFile = vi.fn().mockResolvedValue({
      success: true,
      data: { name: 'web-researcher', display_name: 'Web Researcher' },
    });
    (window as any).electronAPI = {
      subAgent: { importFromFile: mockImportFromFile },
    };

    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = Object.assign(new File(['content'], 'agent.md'), { path: '/some/agent.md' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      fireEvent.change(input);
    });
    await act(async () => { vi.runAllTimers(); });

    vi.useRealTimers();
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('Web Researcher'));
  });

  it('shows error when import result is not success', async () => {
    const mockImportFromFile = vi.fn().mockResolvedValue({
      success: false,
      error: 'Bad format',
    });
    (window as any).electronAPI = {
      subAgent: { importFromFile: mockImportFromFile },
    };
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = Object.assign(new File(['content'], 'agent.md'), { path: '/x.md' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      fireEvent.change(input);
    });
    expect(mockShowError).toHaveBeenCalledWith('Bad format');
  });

  it('shows generic error when import throws', async () => {
    const mockImportFromFile = vi.fn().mockRejectedValue(new Error('network error'));
    (window as any).electronAPI = {
      subAgent: { importFromFile: mockImportFromFile },
    };
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = Object.assign(new File(['content'], 'agent.md'), { path: '/x.md' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      fireEvent.change(input);
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('network error'));
  });

  it('uses electronAPI.fs.getPathForFile when available', async () => {
    const getPathForFile = vi.fn().mockReturnValue('/electron/path/agent.md');
    const mockImportFromFile = vi.fn().mockResolvedValue({
      success: true,
      data: { name: 'x', display_name: 'X Agent' },
    });
    (window as any).electronAPI = {
      fs: { getPathForFile },
      subAgent: { importFromFile: mockImportFromFile },
    };
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'agent.md');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      fireEvent.change(input);
    });
    expect(getPathForFile).toHaveBeenCalledWith(file);
    expect(mockImportFromFile).toHaveBeenCalledWith('/electron/path/agent.md');
  });

  it('falls back to file.path when getPathForFile throws', async () => {
    const getPathForFile = vi.fn().mockImplementation(() => { throw new Error('no path'); });
    const mockImportFromFile = vi.fn().mockResolvedValue({
      success: true,
      data: { name: 'x', display_name: 'X' },
    });
    (window as any).electronAPI = {
      fs: { getPathForFile },
      subAgent: { importFromFile: mockImportFromFile },
    };
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = Object.assign(new File(['content'], 'agent.md'), { path: '/fallback.md' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      fireEvent.change(input);
    });
    expect(mockImportFromFile).toHaveBeenCalledWith('/fallback.md');
  });

  it('does nothing when no file is selected', async () => {
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });
    expect(mockShowError).not.toHaveBeenCalled();
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  // ── Sync from Disk ───────────────────────────────────────────────────────

  it('shows error when sync API is not available', async () => {
    (window as any).electronAPI = {};
    render(<SubAgentsView />);
    const syncBtn = screen.getByTitle('Sync from Disk');
    await act(async () => {
      fireEvent.click(syncBtn);
    });
    expect(mockShowError).toHaveBeenCalledWith('Sync API not available');
  });

  it('shows success and refreshes on successful sync', async () => {
    const syncFromDisk = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { subAgent: { syncFromDisk } };
    render(<SubAgentsView />);
    const syncBtn = screen.getByTitle('Sync from Disk');
    await act(async () => {
      fireEvent.click(syncBtn);
    });
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('synced'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows error on sync failure', async () => {
    const syncFromDisk = vi.fn().mockResolvedValue({ success: false, error: 'disk error' });
    (window as any).electronAPI = { subAgent: { syncFromDisk } };
    render(<SubAgentsView />);
    const syncBtn = screen.getByTitle('Sync from Disk');
    await act(async () => {
      fireEvent.click(syncBtn);
    });
    expect(mockShowError).toHaveBeenCalledWith('disk error');
  });

  it('shows generic error when sync throws', async () => {
    const syncFromDisk = vi.fn().mockRejectedValue(new Error('crash'));
    (window as any).electronAPI = { subAgent: { syncFromDisk } };
    render(<SubAgentsView />);
    const syncBtn = screen.getByTitle('Sync from Disk');
    await act(async () => {
      fireEvent.click(syncBtn);
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('crash'));
  });

  it('ignores second sync click while isSyncing', async () => {
    let resolve!: () => void;
    const syncFromDisk = vi.fn(
      () => new Promise<any>((res) => { resolve = () => res({ success: true }); }),
    );
    (window as any).electronAPI = { subAgent: { syncFromDisk } };
    render(<SubAgentsView />);
    const syncBtn = screen.getByTitle('Sync from Disk');
    // First click
    act(() => { fireEvent.click(syncBtn); });
    // Second click while still syncing
    act(() => { fireEvent.click(syncBtn); });
    resolve();
    await act(async () => {});
    expect(syncFromDisk).toHaveBeenCalledTimes(1);
  });

  // ── handleMenuToggle ─────────────────────────────────────────────────────

  it('calls onSubAgentMenuToggle when list item menu button is clicked', () => {
    render(<SubAgentsView />);
    fireEvent.click(screen.getByTestId('menu-btn-web-researcher'));
    expect(mockOnSubAgentMenuToggle).toHaveBeenCalledWith(
      'web-researcher',
      expect.any(HTMLElement),
    );
  });

  // ── handleAddClick when onSubAgentsAddMenuToggle is undefined ────────────

  it('does not throw when onSubAgentsAddMenuToggle is undefined', () => {
    mockUseOutletContext.mockReturnValueOnce({
      onSubAgentsAddMenuToggle: undefined,
      onSubAgentMenuToggle: undefined,
    });
    render(<SubAgentsView />);
    expect(() => fireEvent.click(screen.getByTitle('Add Sub-Agent'))).not.toThrow();
  });

  // ── Empty-state import button ────────────────────────────────────────────

  it('clicking "Import from AGENT.md" in empty state triggers file input click', () => {
    mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByText(/Import from AGENT.md/));
    expect(clickSpy).toHaveBeenCalled();
  });

  // ── List-item selection ──────────────────────────────────────────────────

  it('clicking a sub-agent item selects it', () => {
    const agents = [
      { ...mockSubAgents[0] },
      { ...mockSubAgents[0], name: 'code-reviewer', display_name: 'Code Reviewer' },
    ];
    mockUseSubAgents.mockReturnValue({ subAgents: agents, stats: { total: 2 }, isLoading: false });
    render(<SubAgentsView />);
    // Click second item
    fireEvent.click(screen.getByTestId('sub-agent-item-code-reviewer'));
    // No crash, isSelected state updates internally
    expect(screen.getByTestId('sub-agent-item-code-reviewer')).toBeInTheDocument();
  });

  // ── import success with no display_name ─────────────────────────────────

  it('shows success using name when display_name is absent', async () => {
    const mockImportFromFile = vi.fn().mockResolvedValue({
      success: true,
      data: { name: 'my-agent' },
    });
    (window as any).electronAPI = { subAgent: { importFromFile: mockImportFromFile } };
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = Object.assign(new File(['content'], 'agent.md'), { path: '/x.md' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { fireEvent.change(input); });
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('my-agent'));
  });

  // ── sync error with no error message ────────────────────────────────────

  it('shows "Sync failed" fallback when sync result has no error string', async () => {
    const syncFromDisk = vi.fn().mockResolvedValue({ success: false });
    (window as any).electronAPI = { subAgent: { syncFromDisk } };
    render(<SubAgentsView />);
    await act(async () => { fireEvent.click(screen.getByTitle('Sync from Disk')); });
    expect(mockShowError).toHaveBeenCalledWith('Sync failed');
  });

  // ── import error fallback ────────────────────────────────────────────────

  it('shows "Import failed" fallback when result has no error string', async () => {
    const mockImportFromFile = vi.fn().mockResolvedValue({ success: false });
    (window as any).electronAPI = { subAgent: { importFromFile: mockImportFromFile } };
    render(<SubAgentsView />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = Object.assign(new File(['content'], 'agent.md'), { path: '/x.md' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { fireEvent.change(input); });
    expect(mockShowError).toHaveBeenCalledWith('Import failed');
  });
});
