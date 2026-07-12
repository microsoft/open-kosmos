/**
 * @vitest-environment happy-dom
 */

/**
 * SettingsPage — MCP + menu handler coverage
 *
 * Uses an Outlet mock that captures the settings context and renders buttons
 * to exercise every handler branch:
 *  - onMcpServerConnect / Disconnect / Reconnect / Delete / Edit
 *  - onMcpServerMenuToggle (open, re-click same = close, click different = open new)
 *  - onMcpAddMenuToggle (open / close)
 *  - onSkillsAddMenuToggle (open / close)
 *  - onSkillMenuToggle (open, re-click same = close)
 *  - handleConfirmDeleteMcp (success / failure / throw / missing API)
 */

import React from 'react';
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Shared mutable location (hoisted so the mock factory can close over it)
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
const loc = vi.hoisted(() => ({ pathname: '/settings/general', state: null as any }));

// A shared store for the settings context captured inside Outlet
const ctxStore = vi.hoisted(() => ({ current: null as any }));

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => loc,
  Outlet: (props: any) => {
    // Capture context on every render
    ctxStore.current = props.context;
    const ctx = props.context || {};
    return (
      <div data-testid="outlet">
        {/* MCP server menu toggle buttons */}
        <button data-testid="mcp-toggle-srv1" onClick={() => ctx.onMcpServerMenuToggle?.('srv1', document.createElement('button'))} />
        <button data-testid="mcp-toggle-srv2" onClick={() => ctx.onMcpServerMenuToggle?.('srv2', document.createElement('button'))} />
        {/* MCP action buttons — only reachable when menu is open, but callable directly */}
        <button data-testid="mcp-connect"     onClick={() => ctx.onMcpServerConnect?.('srv1')} />
        <button data-testid="mcp-disconnect"  onClick={() => ctx.onMcpServerDisconnect?.('srv1')} />
        <button data-testid="mcp-reconnect"   onClick={() => ctx.onMcpServerReconnect?.('srv1')} />
        <button data-testid="mcp-delete"      onClick={() => ctx.onMcpServerDelete?.('srv1')} />
        <button data-testid="mcp-edit"        onClick={() => ctx.onMcpServerEdit?.('srv1')} />
        {/* MCP add menu */}
        <button data-testid="mcp-add-toggle"  onClick={() => ctx.onMcpAddMenuToggle?.(document.createElement('button'))} />
        {/* Skills menus */}
        <button data-testid="skills-add-toggle" onClick={() => ctx.onSkillsAddMenuToggle?.(document.createElement('button'))} />
        <button data-testid="skill-menu-toggle" onClick={() => ctx.onSkillMenuToggle?.('skill1', document.createElement('button'))} />
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Other mocks (same as coverage test)
// ---------------------------------------------------------------------------

vi.mock('../../settings/SettingsNavigation', () => ({
  default: ({ onBack }: any) => (
    <div data-testid="settings-nav">
      <button data-testid="back-btn" onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('../../ui/ResizableDivider', () => ({ default: () => <div /> }));

vi.mock('../../menu', () => ({
  McpServerDropdownMenu: ({ mcpServerMenuRef, serverName, onConnect, onDisconnect, onReconnect, onDelete, onEdit, onClose }: any) => (
    <div ref={mcpServerMenuRef} data-testid="mcp-server-dropdown" data-server={serverName}>
      <button data-testid="dd-connect"    onClick={() => onConnect(serverName)}>Connect</button>
      <button data-testid="dd-disconnect" onClick={() => onDisconnect(serverName)}>Disconnect</button>
      <button data-testid="dd-reconnect"  onClick={() => onReconnect(serverName)}>Reconnect</button>
      <button data-testid="dd-delete"     onClick={() => onDelete(serverName)}>Delete</button>
      <button data-testid="dd-edit"       onClick={() => onEdit(serverName)}>Edit</button>
      <button data-testid="dd-close"      onClick={onClose}>Close</button>
    </div>
  ),
  McpAddMenuDropdown: ({ mcpAddMenuRef, onClose }: any) => (
    <div ref={mcpAddMenuRef} data-testid="mcp-add-dropdown"><button data-testid="mcp-add-close" onClick={onClose}>Close</button></div>
  ),
  SkillsAddMenuDropdown: ({ skillsAddMenuRef, onClose }: any) => (
    <div ref={skillsAddMenuRef} data-testid="skills-add-dropdown"><button data-testid="skills-add-close" onClick={onClose}>Close</button></div>
  ),
  SkillDropdownMenu: ({ skillMenuRef, skillName, onClose }: any) => (
    <div ref={skillMenuRef} data-testid="skill-dropdown" data-skill={skillName}><button data-testid="skill-close" onClick={onClose}>Close</button></div>
  ),
}));

vi.mock('../../skills/ApplySkillToAgentsDialog', () => ({ default: () => null }));

const mockShowSuccess = vi.fn();
const mockShowError   = vi.fn();

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({
    chats: [
      { chatId: 'c1', agent: { name: 'Agent A', skills: ['skill1'] } },
    ],
  }),
  useChats: () => ({ chats: [] }),
  useProfileDataRefresh: () => vi.fn(),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) =>
    open ? (
      <div data-testid="dialog">
        {children}
        <button data-testid="dialog-oc-close" onClick={() => onOpenChange(false)}>x</button>
      </div>
    ) : null,
  DialogContent:     ({ children }: any) => <div>{children}</div>,
  DialogHeader:      ({ children }: any) => <div>{children}</div>,
  DialogTitle:       ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter:      ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../../styles/ContentView.css', () => ({}));
vi.mock('../../../styles/DropdownMenu.css', () => ({}));

const mockRefresh = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/userData', () => ({
  profileDataManager: { refresh: () => mockRefresh() },
}));

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  ANCHORED_DROPDOWN_SIZE_PRESETS: {
    mcpServerMenu:   {},
    mcpAddMenu:      {},
    skillsAddMenu:   {},
    skillMenu:       {},
  },
  getAnchoredDropdownPosition: vi.fn(() => ({ top: 10, left: 10 })),
}));

// ---------------------------------------------------------------------------

import SettingsPage from '../SettingsPage';

function setupAPI(overrides: any = {}) {
  (window as any).electronAPI = {
    platform: 'win32',
    profile: {
      connectMcpServer:    vi.fn().mockResolvedValue({ success: true }),
      disconnectMcpServer: vi.fn().mockResolvedValue({ success: true }),
      reconnectMcpServer:  vi.fn().mockResolvedValue({ success: true }),
      deleteMcpServer:     vi.fn().mockResolvedValue({ success: true }),
    },
    skills: {
      deleteSkill: vi.fn().mockResolvedValue({ success: true }),
    },
    ...overrides,
  };
}

describe('SettingsPage — MCP + menu handler coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAPI();
    sessionStorage.clear();
    loc.pathname = '/settings/general';
    loc.state = null;
  });

  describe('page shell', () => {
    it('uses the managed warm background utility', () => {
      const { container } = render(<SettingsPage />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.classList.contains('bg-warm-50')).toBe(true);
      expect(root.className).not.toContain('bg-[#FFFBF8]');
    });

    it('renders the mac titlebar region on macOS', () => {
      setupAPI({ platform: 'darwin' });
      render(<SettingsPage />);
      expect(document.querySelector('.mac-titlebar-region')).toBeInTheDocument();
    });

    it('stores the previous path when entering settings', () => {
      sessionStorage.setItem('previousPath', '/agent/chat/from-history');
      render(<SettingsPage />);
      expect(sessionStorage.getItem('settingsReturnPath')).toBe('/agent/chat/from-history');
    });

    it('navigates to the stored return path from route state', () => {
      loc.state = { returnPath: '/agent/chat/custom-session' };
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('back-btn'));
      expect(sessionStorage.getItem('settingsReturnPath')).toBeNull();
      expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/custom-session');
    });

    it('falls back to the chat page when no return path is available', () => {
      loc.pathname = '/profile';
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('back-btn'));
      expect(mockNavigate).toHaveBeenCalledWith('/agent/chat');
    });

    it('closes all open floating menus on outside click', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-toggle-srv1'));
      fireEvent.click(screen.getByTestId('mcp-add-toggle'));
      fireEvent.click(screen.getByTestId('skills-add-toggle'));
      fireEvent.click(screen.getByTestId('skill-menu-toggle'));
      await waitFor(() => {
        expect(screen.getByTestId('mcp-server-dropdown')).toBeInTheDocument();
        expect(screen.getByTestId('mcp-add-dropdown')).toBeInTheDocument();
        expect(screen.getByTestId('skills-add-dropdown')).toBeInTheDocument();
        expect(screen.getByTestId('skill-dropdown')).toBeInTheDocument();
      });

      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByTestId('mcp-server-dropdown')).toBeNull();
        expect(screen.queryByTestId('mcp-add-dropdown')).toBeNull();
        expect(screen.queryByTestId('skills-add-dropdown')).toBeNull();
        expect(screen.queryByTestId('skill-dropdown')).toBeNull();
      });
    });

    it('keeps floating menus open when clicking inside them', async () => {
      const cases = [
        ['mcp-toggle-srv1', 'mcp-server-dropdown'],
        ['mcp-add-toggle', 'mcp-add-dropdown'],
        ['skills-add-toggle', 'skills-add-dropdown'],
        ['skill-menu-toggle', 'skill-dropdown'],
      ];

      for (const [toggleId, dropdownId] of cases) {
        const { unmount } = render(<SettingsPage />);
        fireEvent.click(screen.getByTestId(toggleId));
        await waitFor(() => expect(screen.getByTestId(dropdownId)).toBeInTheDocument());
        fireEvent.mouseDown(screen.getByTestId(dropdownId));
        expect(screen.getByTestId(dropdownId)).toBeInTheDocument();
        unmount();
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP server menu toggle
  // ────────────────────────────────────────────────────────────────────────

  describe('onMcpServerMenuToggle', () => {
    it('opens MCP server dropdown when toggle is first called', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-toggle-srv1'));
      await waitFor(() => screen.getByTestId('mcp-server-dropdown'));
      expect(screen.getByTestId('mcp-server-dropdown').dataset.server).toBe('srv1');
    });

    it('closes MCP dropdown when same server is toggled again', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-toggle-srv1'));
      await waitFor(() => screen.getByTestId('mcp-server-dropdown'));
      fireEvent.click(screen.getByTestId('mcp-toggle-srv1'));
      await waitFor(() => expect(screen.queryByTestId('mcp-server-dropdown')).toBeNull());
    });

    it('switches to a different server when a different toggle is clicked', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-toggle-srv1'));
      await waitFor(() => screen.getByTestId('mcp-server-dropdown'));
      fireEvent.click(screen.getByTestId('mcp-toggle-srv2'));
      await waitFor(() =>
        expect(screen.getByTestId('mcp-server-dropdown').dataset.server).toBe('srv2'),
      );
    });

    it('closes menu via onClose button in dropdown', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-toggle-srv1'));
      await waitFor(() => screen.getByTestId('dd-close'));
      fireEvent.click(screen.getByTestId('dd-close'));
      await waitFor(() => expect(screen.queryByTestId('mcp-server-dropdown')).toBeNull());
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP add menu toggle
  // ────────────────────────────────────────────────────────────────────────

  describe('onMcpAddMenuToggle', () => {
    it('opens MCP add menu', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-add-toggle'));
      await waitFor(() => screen.getByTestId('mcp-add-dropdown'));
    });

    it('closes MCP add menu when toggled again', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-add-toggle'));
      await waitFor(() => screen.getByTestId('mcp-add-dropdown'));
      fireEvent.click(screen.getByTestId('mcp-add-toggle'));
      await waitFor(() => expect(screen.queryByTestId('mcp-add-dropdown')).toBeNull());
    });

    it('closes MCP add menu via onClose', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-add-toggle'));
      await waitFor(() => screen.getByTestId('mcp-add-close'));
      fireEvent.click(screen.getByTestId('mcp-add-close'));
      await waitFor(() => expect(screen.queryByTestId('mcp-add-dropdown')).toBeNull());
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Skills add menu toggle
  // ────────────────────────────────────────────────────────────────────────

  describe('onSkillsAddMenuToggle', () => {
    it('opens skills add menu', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('skills-add-toggle'));
      await waitFor(() => screen.getByTestId('skills-add-dropdown'));
    });

    it('closes skills add menu when toggled again', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('skills-add-toggle'));
      await waitFor(() => screen.getByTestId('skills-add-dropdown'));
      fireEvent.click(screen.getByTestId('skills-add-toggle'));
      await waitFor(() => expect(screen.queryByTestId('skills-add-dropdown')).toBeNull());
    });

    it('closes skills add menu via onClose', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('skills-add-toggle'));
      await waitFor(() => screen.getByTestId('skills-add-close'));
      fireEvent.click(screen.getByTestId('skills-add-close'));
      await waitFor(() => expect(screen.queryByTestId('skills-add-dropdown')).toBeNull());
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Skill menu toggle
  // ────────────────────────────────────────────────────────────────────────

  describe('onSkillMenuToggle', () => {
    it('opens skill dropdown menu', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('skill-menu-toggle'));
      await waitFor(() => screen.getByTestId('skill-dropdown'));
      expect(screen.getByTestId('skill-dropdown').dataset.skill).toBe('skill1');
    });

    it('closes skill dropdown when same skill toggled again', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('skill-menu-toggle'));
      await waitFor(() => screen.getByTestId('skill-dropdown'));
      fireEvent.click(screen.getByTestId('skill-menu-toggle'));
      await waitFor(() => expect(screen.queryByTestId('skill-dropdown')).toBeNull());
    });

    it('closes skill dropdown via onClose', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('skill-menu-toggle'));
      await waitFor(() => screen.getByTestId('skill-close'));
      fireEvent.click(screen.getByTestId('skill-close'));
      await waitFor(() => expect(screen.queryByTestId('skill-dropdown')).toBeNull());
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP connect
  // ────────────────────────────────────────────────────────────────────────

  describe('onMcpServerConnect', () => {
    it('calls connectMcpServer API on success', async () => {
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-connect')); });
      await waitFor(() =>
        expect((window as any).electronAPI.profile.connectMcpServer).toHaveBeenCalledWith('srv1'),
      );
    });

    it('calls refresh after successful connect', async () => {
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-connect')); });
      await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    });

    it('shows error when connect returns failure', async () => {
      (window as any).electronAPI.profile.connectMcpServer = vi.fn().mockResolvedValue({ success: false, error: 'Timeout' });
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-connect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Timeout')));
    });

    it('shows error when connect throws', async () => {
      (window as any).electronAPI.profile.connectMcpServer = vi.fn().mockRejectedValue(new Error('Net error'));
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-connect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Net error')));
    });

    it('uses fallback messages when connect fails without an error or throws a non-Error', async () => {
      (window as any).electronAPI.profile.connectMcpServer = vi.fn().mockResolvedValueOnce({ success: false });
      const { unmount } = render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-connect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
      unmount();

      mockShowError.mockClear();
      setupAPI({ profile: { ...(window as any).electronAPI.profile, connectMcpServer: vi.fn().mockRejectedValue('nope') } });
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-connect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
    });

    it('shows error when connect API not available', async () => {
      (window as any).electronAPI.profile = undefined;
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-connect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('not available')));
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP disconnect
  // ────────────────────────────────────────────────────────────────────────

  describe('onMcpServerDisconnect', () => {
    it('calls disconnectMcpServer and shows success', async () => {
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-disconnect')); });
      await waitFor(() => {
        expect((window as any).electronAPI.profile.disconnectMcpServer).toHaveBeenCalledWith('srv1');
        expect(mockShowSuccess).toHaveBeenCalled();
      });
    });

    it('shows error on disconnect failure', async () => {
      (window as any).electronAPI.profile.disconnectMcpServer = vi.fn().mockResolvedValue({ success: false, error: 'Busy' });
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-disconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Busy')));
    });

    it('shows error when disconnect throws', async () => {
      (window as any).electronAPI.profile.disconnectMcpServer = vi.fn().mockRejectedValue(new Error('Crash'));
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-disconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Crash')));
    });

    it('uses fallback messages when disconnect fails without an error or throws a non-Error', async () => {
      (window as any).electronAPI.profile.disconnectMcpServer = vi.fn().mockResolvedValueOnce({ success: false });
      const { unmount } = render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-disconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
      unmount();

      mockShowError.mockClear();
      setupAPI({ profile: { ...(window as any).electronAPI.profile, disconnectMcpServer: vi.fn().mockRejectedValue('nope') } });
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-disconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
    });

    it('shows error when disconnect API not available', async () => {
      (window as any).electronAPI.profile = undefined;
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-disconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('not available')));
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP reconnect
  // ────────────────────────────────────────────────────────────────────────

  describe('onMcpServerReconnect', () => {
    it('calls reconnectMcpServer on success', async () => {
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-reconnect')); });
      await waitFor(() =>
        expect((window as any).electronAPI.profile.reconnectMcpServer).toHaveBeenCalledWith('srv1'),
      );
    });

    it('shows error on reconnect failure', async () => {
      (window as any).electronAPI.profile.reconnectMcpServer = vi.fn().mockResolvedValue({ success: false, error: 'Offline' });
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-reconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Offline')));
    });

    it('shows error when reconnect throws', async () => {
      (window as any).electronAPI.profile.reconnectMcpServer = vi.fn().mockRejectedValue(new Error('Timeout'));
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-reconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Timeout')));
    });

    it('uses fallback messages when reconnect fails without an error or throws a non-Error', async () => {
      (window as any).electronAPI.profile.reconnectMcpServer = vi.fn().mockResolvedValueOnce({ success: false });
      const { unmount } = render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-reconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
      unmount();

      mockShowError.mockClear();
      setupAPI({ profile: { ...(window as any).electronAPI.profile, reconnectMcpServer: vi.fn().mockRejectedValue('nope') } });
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-reconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
    });

    it('shows error when reconnect API not available', async () => {
      (window as any).electronAPI.profile = undefined;
      render(<SettingsPage />);
      await act(async () => { fireEvent.click(screen.getByTestId('mcp-reconnect')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('not available')));
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP delete (handleMcpServerDelete + handleConfirmDeleteMcp)
  // ────────────────────────────────────────────────────────────────────────

  describe('MCP server delete', () => {
    it('opens delete MCP dialog when onMcpServerDelete is called', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByTestId('dialog'));
    });

    it('closes MCP delete dialog via onOpenChange', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByTestId('dialog'));
      fireEvent.click(screen.getByTestId('dialog-oc-close'));
      await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
    });

    it('closes MCP delete dialog via No button', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByText('No'));
      fireEvent.click(screen.getByText('No'));
      await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
    });

    it('calls deleteMcpServer and shows success on confirm', async () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByText('Delete'));
      await act(async () => { fireEvent.click(screen.getByText('Delete')); });
      await waitFor(() => {
        expect((window as any).electronAPI.profile.deleteMcpServer).toHaveBeenCalledWith('srv1');
        expect(mockShowSuccess).toHaveBeenCalled();
      });
    });

    it('shows error when deleteMcpServer returns failure', async () => {
      (window as any).electronAPI.profile.deleteMcpServer = vi.fn().mockResolvedValue({ success: false, error: 'Permission denied' });
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByText('Delete'));
      await act(async () => { fireEvent.click(screen.getByText('Delete')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Permission denied')));
    });

    it('shows error when deleteMcpServer throws', async () => {
      (window as any).electronAPI.profile.deleteMcpServer = vi.fn().mockRejectedValue(new Error('DB error'));
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByText('Delete'));
      await act(async () => { fireEvent.click(screen.getByText('Delete')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('DB error')));
    });

    it('uses fallback messages when MCP deletion fails without an error or throws a non-Error', async () => {
      (window as any).electronAPI.profile.deleteMcpServer = vi.fn().mockResolvedValueOnce({ success: false });
      const { unmount } = render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByText('Delete'));
      await act(async () => { fireEvent.click(screen.getByText('Delete')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
      unmount();

      mockShowError.mockClear();
      setupAPI({ profile: { ...(window as any).electronAPI.profile, deleteMcpServer: vi.fn().mockRejectedValue('nope') } });
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByText('Delete'));
      await act(async () => { fireEvent.click(screen.getByText('Delete')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));
    });

    it('shows error when deleteMcpServer API not available', async () => {
      (window as any).electronAPI.profile = undefined;
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-delete'));
      await waitFor(() => screen.getByText('Delete'));
      await act(async () => { fireEvent.click(screen.getByText('Delete')); });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('not available')));
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP edit
  // ────────────────────────────────────────────────────────────────────────

  describe('onMcpServerEdit', () => {
    it('navigates to mcp edit route with encoded server name', () => {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-edit'));
      expect(mockNavigate).toHaveBeenCalledWith(
        `/settings/mcp/edit/${encodeURIComponent('srv1')}`,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP server dropdown connect/disconnect/reconnect/delete buttons
  // (tests that use the rendered dropdown menu component)
  // ────────────────────────────────────────────────────────────────────────

  describe('MCP server dropdown menu actions', () => {
    async function openDropdown() {
      render(<SettingsPage />);
      fireEvent.click(screen.getByTestId('mcp-toggle-srv1'));
      await waitFor(() => screen.getByTestId('mcp-server-dropdown'));
    }

    it('connect via dropdown calls API', async () => {
      await openDropdown();
      await act(async () => { fireEvent.click(screen.getByTestId('dd-connect')); });
      await waitFor(() =>
        expect((window as any).electronAPI.profile.connectMcpServer).toHaveBeenCalledWith('srv1'),
      );
    });

    it('disconnect via dropdown calls API', async () => {
      await openDropdown();
      await act(async () => { fireEvent.click(screen.getByTestId('dd-disconnect')); });
      await waitFor(() =>
        expect((window as any).electronAPI.profile.disconnectMcpServer).toHaveBeenCalledWith('srv1'),
      );
    });

    it('reconnect via dropdown calls API', async () => {
      await openDropdown();
      await act(async () => { fireEvent.click(screen.getByTestId('dd-reconnect')); });
      await waitFor(() =>
        expect((window as any).electronAPI.profile.reconnectMcpServer).toHaveBeenCalledWith('srv1'),
      );
    });

    it('delete via dropdown opens confirm dialog', async () => {
      await openDropdown();
      fireEvent.click(screen.getByTestId('dd-delete'));
      await waitFor(() => screen.getByTestId('dialog'));
    });

    it('edit via dropdown navigates', async () => {
      await openDropdown();
      fireEvent.click(screen.getByTestId('dd-edit'));
      expect(mockNavigate).toHaveBeenCalledWith(
        `/settings/mcp/edit/${encodeURIComponent('srv1')}`,
      );
    });
  });

  describe('Skill deletion', () => {
    function openSkillDeleteDialog() {
      render(<SettingsPage />);
      act(() => {
        window.dispatchEvent(new CustomEvent('skill:delete', { detail: { skillName: 'skill1' } }));
      });
      return waitFor(() => screen.getByText('Delete Skill'));
    }

    it('opens and closes the skill delete dialog via onOpenChange', async () => {
      await openSkillDeleteDialog();
      expect(screen.getByText(/currently being used by 1 agent/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('dialog-oc-close'));
      await waitFor(() => expect(screen.queryByText('Delete Skill')).toBeNull());
    });

    it('closes the skill delete dialog via No', async () => {
      await openSkillDeleteDialog();
      fireEvent.click(screen.getByText('No'));
      await waitFor(() => expect(screen.queryByText('Delete Skill')).toBeNull());
    });

    it('confirms skill deletion and refreshes profile data', async () => {
      await openSkillDeleteDialog();
      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });
      await waitFor(() => {
        expect((window as any).electronAPI.skills.deleteSkill).toHaveBeenCalledWith('skill1');
        expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('skill1'));
        expect(mockRefresh).toHaveBeenCalled();
      });
    });

    it('shows an error when skill deletion fails', async () => {
      (window as any).electronAPI.skills.deleteSkill = vi.fn().mockResolvedValue({ success: false, error: 'Locked' });
      await openSkillDeleteDialog();
      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Locked')));
    });

    it('uses fallback messages when skill deletion fails without an error or throws a non-Error', async () => {
      (window as any).electronAPI.skills.deleteSkill = vi.fn().mockResolvedValueOnce({ success: false });
      await openSkillDeleteDialog();
      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')));

      mockShowError.mockClear();
      setupAPI({ skills: { deleteSkill: vi.fn().mockRejectedValue('nope') } });
      act(() => {
        window.dispatchEvent(new CustomEvent('skill:delete', { detail: { skillName: 'skill1' } }));
      });
      await waitFor(() => screen.getByText('Delete Skill'));
      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('unknown error')));
    });


    it('shows an error when skill deletion throws', async () => {
      (window as any).electronAPI.skills.deleteSkill = vi.fn().mockRejectedValue(new Error('Skill DB down'));
      await openSkillDeleteDialog();
      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Skill DB down')));
    });

    it('shows an error when the skill deletion API is missing', async () => {
      (window as any).electronAPI.skills = undefined;
      await openSkillDeleteDialog();
      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });
      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('not available')));
    });
  });

});
