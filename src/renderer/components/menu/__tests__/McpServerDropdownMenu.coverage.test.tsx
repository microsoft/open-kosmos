/** @vitest-environment happy-dom */

import React, { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── mock deps ──────────────────────────────────────────────────────────────────

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
}));

const mockMcpServers = vi.fn(() => [] as any[]);

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ mcpServers: mockMcpServers() }),
}));

vi.mock('lucide-react', () => ({
  Pencil: () => <span data-testid="icon-pencil" />,
  Play: () => <span data-testid="icon-play" />,
  Pause: () => <span data-testid="icon-pause" />,
  RotateCw: () => <span data-testid="icon-rotate-cw" />,
  Trash2: () => <span data-testid="icon-trash2" />,
}));

// ── import SUT ─────────────────────────────────────────────────────────────────

import McpServerDropdownMenu from '../McpServerDropdownMenu';

// ── helpers ────────────────────────────────────────────────────────────────────

const defaultPosition = { top: 100, left: 200, triggerTop: 0, triggerRight: 0 };

function renderMenu(props: Partial<React.ComponentProps<typeof McpServerDropdownMenu>> = {}) {
  const ref = createRef<HTMLDivElement>();
  return render(
    <McpServerDropdownMenu
      mcpServerMenuRef={ref}
      serverName="my-server"
      position={defaultPosition}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('McpServerDropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpServers.mockReturnValue([]);
    // Clear any __mcpServerOperations from previous tests
    delete (window as any).__mcpServerOperations;
  });

  // ── null returns ─────────────────────────────────────────────────────────────
  it('returns null for builtin-tools server', () => {
    const { container } = renderMenu({ serverName: 'builtin-tools' });
    expect(container.firstChild).toBeNull();
  });

  it('returns null for plugin server with PLUGIN source', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', source: 'PLUGIN' }]);
    const { container } = renderMenu({ serverName: 'my-server' });
    expect(container.firstChild).toBeNull();
  });

  it('returns null for server with plugin-- name prefix', () => {
    mockMcpServers.mockReturnValue([{ name: 'plugin--foo', source: 'USER' }]);
    const { container } = renderMenu({ serverName: 'plugin--foo' });
    expect(container.firstChild).toBeNull();
  });

  // ── no actions hint ──────────────────────────────────────────────────────────
  it('shows "No actions available" when no action handlers provided', () => {
    renderMenu({ serverName: 'my-server' });
    expect(screen.getByText('No actions available')).toBeTruthy();
  });

  // ── disconnected server actions ──────────────────────────────────────────────
  it('shows Connect button for disconnected server', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'disconnected' }]);
    const onConnect = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onConnect, onClose });
    expect(screen.getByText('Connect')).toBeTruthy();
    expect(screen.queryByText('Disconnect')).toBeNull();
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('calls onConnect and onClose when Connect is clicked', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'disconnected' }]);
    const onConnect = vi.fn();
    const onClose = vi.fn();
    renderMenu({ serverName: 'my-server', onConnect, onClose });
    fireEvent.click(screen.getByText('Connect'));
    expect(onConnect).toHaveBeenCalledWith('my-server');
    expect(onClose).toHaveBeenCalled();
  });

  // ── connected server actions ─────────────────────────────────────────────────
  it('shows Disconnect button for connected server', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'connected' }]);
    const onDisconnect = vi.fn();
    renderMenu({ onDisconnect });
    expect(screen.getByText('Disconnect')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('calls onDisconnect and onClose when Disconnect is clicked', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'connected' }]);
    const onDisconnect = vi.fn();
    const onClose = vi.fn();
    renderMenu({ serverName: 'my-server', onDisconnect, onClose });
    fireEvent.click(screen.getByText('Disconnect'));
    expect(onDisconnect).toHaveBeenCalledWith('my-server');
    expect(onClose).toHaveBeenCalled();
  });

  // ── error server actions ─────────────────────────────────────────────────────
  it('shows both Disconnect and Reconnect buttons for error server', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'error' }]);
    const onDisconnect = vi.fn();
    const onReconnect = vi.fn();
    renderMenu({ onDisconnect, onReconnect });
    expect(screen.getByText('Disconnect')).toBeTruthy();
    expect(screen.getByText('Reconnect')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
  });

  it('calls onReconnect and onClose when Reconnect is clicked', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'error' }]);
    const onReconnect = vi.fn();
    const onClose = vi.fn();
    renderMenu({ serverName: 'my-server', onReconnect, onClose });
    fireEvent.click(screen.getByText('Reconnect'));
    expect(onReconnect).toHaveBeenCalledWith('my-server');
    expect(onClose).toHaveBeenCalled();
  });

  // ── connecting/disconnecting states ──────────────────────────────────────────
  it('shows no connect/disconnect/reconnect buttons when connecting', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'connecting' }]);
    renderMenu({ onConnect: vi.fn(), onDisconnect: vi.fn(), onReconnect: vi.fn() });
    expect(screen.queryByText('Connect')).toBeNull();
    expect(screen.queryByText('Disconnect')).toBeNull();
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('shows no connect/disconnect/reconnect buttons when disconnecting', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'disconnecting' }]);
    renderMenu({ onConnect: vi.fn(), onDisconnect: vi.fn(), onReconnect: vi.fn() });
    expect(screen.queryByText('Connect')).toBeNull();
    expect(screen.queryByText('Disconnect')).toBeNull();
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  // ── edit button ───────────────────────────────────────────────────────────────
  it('shows Edit button when onEdit is provided', () => {
    renderMenu({ onEdit: vi.fn() });
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('calls onEdit and onClose when Edit is clicked (and server not connecting)', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'disconnected' }]);
    const onEdit = vi.fn();
    const onClose = vi.fn();
    renderMenu({ serverName: 'my-server', onEdit, onClose });
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith('my-server');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onEdit when server is connecting', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'connecting' }]);
    const onEdit = vi.fn();
    const onClose = vi.fn();
    renderMenu({ serverName: 'my-server', onEdit, onClose });
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call onEdit when server is disconnecting', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'disconnecting' }]);
    const onEdit = vi.fn();
    const onClose = vi.fn();
    renderMenu({ serverName: 'my-server', onEdit, onClose });
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  // ── delete button ─────────────────────────────────────────────────────────────
  it('shows Delete button when onDelete is provided', () => {
    renderMenu({ onDelete: vi.fn() });
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onDelete and onClose when Delete is clicked', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    renderMenu({ serverName: 'my-server', onDelete, onClose });
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('my-server');
    expect(onClose).toHaveBeenCalled();
  });

  // ── window.__mcpServerOperations fallback ─────────────────────────────────────
  it('uses window.__mcpServerOperations when prop handlers are absent', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'disconnected' }]);
    const onConnect = vi.fn();
    const onClose = vi.fn();
    (window as any).__mcpServerOperations = { onConnect };
    renderMenu({ serverName: 'my-server', onClose });
    fireEvent.click(screen.getByText('Connect'));
    expect(onConnect).toHaveBeenCalledWith('my-server');
  });

  // ── unknown server (no mcpServers entry) ──────────────────────────────────────
  it('shows Connect for unknown server (no entry in mcpServers)', () => {
    mockMcpServers.mockReturnValue([]);
    const onConnect = vi.fn();
    renderMenu({ serverName: 'unknown-server', onConnect });
    expect(screen.getByText('Connect')).toBeTruthy();
  });

  // ── position style ────────────────────────────────────────────────────────────
  it('applies position styles to the container', () => {
    const { container } = renderMenu({ onConnect: vi.fn() });
    const menuDiv = container.querySelector('.dropdown-menu');
    expect(menuDiv).toBeTruthy();
    expect((menuDiv as HTMLElement).style.top).toBe('100px');
    expect((menuDiv as HTMLElement).style.left).toBe('200px');
  });

  // ── default status branch ─────────────────────────────────────────────────────
  it('shows Connect for unknown status (default branch)', () => {
    mockMcpServers.mockReturnValue([{ name: 'my-server', status: 'unknown-status' }]);
    const onConnect = vi.fn();
    renderMenu({ onConnect });
    expect(screen.getByText('Connect')).toBeTruthy();
  });
});
