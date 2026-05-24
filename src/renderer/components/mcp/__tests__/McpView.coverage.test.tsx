/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockRefreshRuntimeInfo = vi.hoisted(() => vi.fn());
const mockOutletContext = vi.hoisted(() => ({
  onMcpServerMenuToggle: vi.fn(),
  mcpServerMenuState: {} as any,
  onMcpServerConnect: undefined as any,
  onMcpServerDisconnect: undefined as any,
  onMcpServerReconnect: undefined as any,
  onMcpServerDelete: undefined as any,
  onMcpServerEdit: undefined as any,
  onMcpAddMenuToggle: vi.fn(),
}));
const mockServers = vi.hoisted(() => [] as any[]);
const mockMcpConnect = vi.hoisted(() => vi.fn());
const mockMcpDisconnect = vi.hoisted(() => vi.fn());
const mockMcpReconnect = vi.hoisted(() => vi.fn());
const mockMcpDelete = vi.hoisted(() => vi.fn());

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useOutletContext: () => mockOutletContext,
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showError: mockShowError }),
}));

vi.mock('../../userData/userDataProvider', () => ({
  useMCPServers: () => ({
    servers: mockServers,
    stats: { totalServers: mockServers.length, connectedServers: 0, totalTools: 0 },
    tools: [],
    refreshRuntimeInfo: mockRefreshRuntimeInfo,
    isLoading: false,
  }),
}));

vi.mock('../McpHeaderView', () => ({
  default: ({ totalServers, connectedServers, totalTools, onAddMenuToggle }: any) => (
    <div data-testid="mcp-header">
      <span data-testid="total-servers">{totalServers}</span>
      <span data-testid="connected-servers">{connectedServers}</span>
      <span data-testid="total-tools">{totalTools}</span>
      <button data-testid="add-menu" onClick={onAddMenuToggle}>Add</button>
    </div>
  ),
}));

vi.mock('../McpContentView', () => ({
  default: ({ servers, isLoading, onConnect, onDisconnect, onReconnect, onDelete, onEdit }: any) => (
    <div data-testid="mcp-content">
      {isLoading && <span data-testid="loading">loading</span>}
      {servers.map((s: any) => (
        <div key={s.name} data-testid={`server-${s.name}`}>
          <button data-testid={`connect-${s.name}`} onClick={() => onConnect(s.name)}>Connect</button>
          <button data-testid={`disconnect-${s.name}`} onClick={() => onDisconnect(s.name)}>Disconnect</button>
          <button data-testid={`reconnect-${s.name}`} onClick={() => onReconnect(s.name)}>Reconnect</button>
          <button data-testid={`delete-${s.name}`} onClick={() => onDelete(s.name)}>Delete</button>
          <button data-testid={`edit-${s.name}`} onClick={() => onEdit(s.name)}>Edit</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../lib/mcp/mcpOps', () => ({
  McpOps: {
    connect: mockMcpConnect,
    disconnect: mockMcpDisconnect,
    reconnect: mockMcpReconnect,
    delete: mockMcpDelete,
  },
}));

import McpView from '../McpView';

describe('McpView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServers.length = 0;
    mockRefreshRuntimeInfo.mockResolvedValue(undefined);
    mockOutletContext.onMcpServerConnect = undefined;
    mockOutletContext.onMcpServerDisconnect = undefined;
    mockOutletContext.onMcpServerReconnect = undefined;
    mockOutletContext.onMcpServerDelete = undefined;
    mockOutletContext.onMcpServerEdit = undefined;
  });

  it('renders header and content', () => {
    render(<McpView />);
    expect(screen.getByTestId('mcp-header')).toBeTruthy();
    expect(screen.getByTestId('mcp-content')).toBeTruthy();
  });

  it('uses external onMcpAddMenuToggle', async () => {
    render(<McpView />);
    await act(async () => {
      screen.getByTestId('add-menu').click();
    });
    expect(mockOutletContext.onMcpAddMenuToggle).toHaveBeenCalled();
  });

  describe('with servers', () => {
    beforeEach(() => {
      mockServers.push({ name: 'my-server', status: 'connected' });
    });

    it('uses external onMcpServerConnect when provided', async () => {
      const mockConnect = vi.fn();
      mockOutletContext.onMcpServerConnect = mockConnect;

      render(<McpView />);
      await act(async () => {
        screen.getByTestId('connect-my-server').click();
      });
      expect(mockConnect).toHaveBeenCalledWith('my-server');
    });

    it('uses local connect when no external handler', async () => {
      mockMcpConnect.mockResolvedValue({ success: true });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('connect-my-server').click();
      });

      expect(mockMcpConnect).toHaveBeenCalledWith('my-server');
    });

    it('shows error when local connect fails', async () => {
      mockMcpConnect.mockResolvedValue({ success: false, error: 'Connection refused' });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('connect-my-server').click();
      });

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Connection refused'));
    });

    it('shows error when local connect throws', async () => {
      mockMcpConnect.mockRejectedValue(new Error('network error'));
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('connect-my-server').click();
      });

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('network error'));
    });

    it('uses external onMcpServerDisconnect when provided', async () => {
      const mockDisc = vi.fn();
      mockOutletContext.onMcpServerDisconnect = mockDisc;

      render(<McpView />);
      await act(async () => {
        screen.getByTestId('disconnect-my-server').click();
      });
      expect(mockDisc).toHaveBeenCalledWith('my-server');
    });

    it('uses local disconnect when no external handler', async () => {
      mockMcpDisconnect.mockResolvedValue({ success: true });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('disconnect-my-server').click();
      });

      expect(mockMcpDisconnect).toHaveBeenCalledWith('my-server');
    });

    it('shows error when local disconnect fails', async () => {
      mockMcpDisconnect.mockResolvedValue({ success: false, error: 'Disconnect error' });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('disconnect-my-server').click();
      });

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Disconnect error'));
    });

    it('shows error when local disconnect throws', async () => {
      mockMcpDisconnect.mockRejectedValue(new Error('disc crash'));
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('disconnect-my-server').click();
      });

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('disc crash'));
    });

    it('uses external onMcpServerReconnect when provided', async () => {
      const mockReconn = vi.fn();
      mockOutletContext.onMcpServerReconnect = mockReconn;

      render(<McpView />);
      await act(async () => {
        screen.getByTestId('reconnect-my-server').click();
      });
      expect(mockReconn).toHaveBeenCalledWith('my-server');
    });

    it('uses local reconnect when no external handler', async () => {
      mockMcpReconnect.mockResolvedValue({ success: true });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('reconnect-my-server').click();
      });

      expect(mockMcpReconnect).toHaveBeenCalledWith('my-server');
    });

    it('shows error when local reconnect fails', async () => {
      mockMcpReconnect.mockResolvedValue({ success: false, error: 'Reconnect error' });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('reconnect-my-server').click();
      });

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Reconnect error'));
    });

    it('shows error when local reconnect throws', async () => {
      mockMcpReconnect.mockRejectedValue(new Error('reconn crash'));
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('reconnect-my-server').click();
      });

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('reconn crash'));
    });

    it('uses external onMcpServerDelete when provided', async () => {
      const mockDel = vi.fn();
      mockOutletContext.onMcpServerDelete = mockDel;

      render(<McpView />);
      await act(async () => {
        screen.getByTestId('delete-my-server').click();
      });
      expect(mockDel).toHaveBeenCalledWith('my-server');
    });

    it('uses local delete when no external handler', async () => {
      mockMcpDelete.mockResolvedValue({ success: true });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('delete-my-server').click();
      });

      await waitFor(() => {
        expect(mockMcpDelete).toHaveBeenCalledWith('my-server');
      });
    });

    it('shows error when local delete fails', async () => {
      mockMcpDelete.mockResolvedValue({ success: false, error: 'Delete error' });
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('delete-my-server').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Delete error'));
      });
    });

    it('uses external onMcpServerEdit when provided', async () => {
      const mockEdit = vi.fn();
      mockOutletContext.onMcpServerEdit = mockEdit;

      render(<McpView />);
      await act(async () => {
        screen.getByTestId('edit-my-server').click();
      });
      expect(mockEdit).toHaveBeenCalledWith('my-server');
    });

    it('navigates to edit page when no external edit handler', async () => {
      render(<McpView />);

      await act(async () => {
        screen.getByTestId('edit-my-server').click();
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('my-server'));
      });
    });
  });
});
