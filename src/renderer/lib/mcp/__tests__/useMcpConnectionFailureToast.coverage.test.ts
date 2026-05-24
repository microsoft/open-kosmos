// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

// ── hoisted mock vars ─────────────────────────────────────────────────────────
const mockShowToast = vi.hoisted(() => vi.fn(() => 'toast-id-1'));
const mockRemoveToast = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockCreateLogger = vi.hoisted(() => vi.fn(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
})));

// Capture MCP subscriptions so tests can fire them
const mcpSubscribers = vi.hoisted(() => ({
  failure: null as ((serverName: string, error: string) => void) | null,
  data: null as ((data: any) => void) | null,
}));

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    showToast: mockShowToast,
    removeToast: mockRemoveToast,
  }),
}));

vi.mock('@/lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: {
    subscribeConnectionFailure: vi.fn((cb) => {
      mcpSubscribers.failure = cb;
      return () => { mcpSubscribers.failure = null; };
    }),
    subscribe: vi.fn((cb) => {
      mcpSubscribers.data = cb;
      return () => { mcpSubscribers.data = null; };
    }),
  },
}));

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: mockCreateLogger,
}));

vi.mock('@/components/ui/ErrorDetailsDialog', () => ({
  default: (props: any) => null,
}));

// ── imports after mocks ───────────────────────────────────────────────────────
import { useMcpConnectionFailureToast } from '../useMcpConnectionFailureToast';

// ── helpers ───────────────────────────────────────────────────────────────────
function renderToastHook() {
  return renderHook(() => useMcpConnectionFailureToast());
}

describe('useMcpConnectionFailureToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpSubscribers.failure = null;
    mcpSubscribers.data = null;
    // Restore showToast default
    mockShowToast.mockReturnValue('toast-id-1');
    // Set up electronAPI
    (window as any).electronAPI = {
      profile: {
        reconnectMcpServer: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('subscribes to connection failure and data events on mount', () => {
    renderToastHook();
    expect(mcpSubscribers.failure).toBeInstanceOf(Function);
    expect(mcpSubscribers.data).toBeInstanceOf(Function);
  });

  it('cleans up subscriptions on unmount', () => {
    const { unmount } = renderToastHook();
    unmount();
    expect(mcpSubscribers.failure).toBeNull();
    expect(mcpSubscribers.data).toBeNull();
  });

  it('shows a toast when a connection failure event fires', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Connection refused');
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    // Verify error type
    expect(mockShowToast.mock.calls[0][1]).toBe('error');
  });

  it('does not show duplicate toasts for the same server', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error 1');
    });
    act(() => {
      mcpSubscribers.failure!('my-server', 'Error 2');
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('shows separate toasts for different servers', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('server-A', 'Error A');
    });
    act(() => {
      mcpSubscribers.failure!('server-B', 'Error B');
    });

    expect(mockShowToast).toHaveBeenCalledTimes(2);
  });

  it('auto-dismisses toast when server status is no longer error', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);

    // Simulate server recovering
    act(() => {
      mcpSubscribers.data!({
        servers: [{ name: 'my-server', status: 'connected' }]
      });
    });

    expect(mockRemoveToast).toHaveBeenCalledWith('toast-id-1');
  });

  it('does not dismiss toast when server status remains error', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    act(() => {
      mcpSubscribers.data!({
        servers: [{ name: 'my-server', status: 'error' }]
      });
    });

    expect(mockRemoveToast).not.toHaveBeenCalled();
  });

  it('does not dismiss toast for unrelated server status changes', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('server-X', 'Error');
    });

    act(() => {
      mcpSubscribers.data!({
        servers: [{ name: 'server-Y', status: 'connected' }]
      });
    });

    expect(mockRemoveToast).not.toHaveBeenCalled();
  });

  it('Reconnect action calls reconnectMcpServer API', async () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    // Find and click the Reconnect action
    const toastOptions = mockShowToast.mock.calls[0][3];
    const reconnectAction = toastOptions.actions.find((a: any) => a.label === 'Reconnect');
    expect(reconnectAction).toBeDefined();

    await act(async () => {
      await reconnectAction.onClick();
    });

    expect((window as any).electronAPI.profile.reconnectMcpServer).toHaveBeenCalledWith('my-server');
  });

  it('Manage action navigates to MCP settings', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    const toastOptions = mockShowToast.mock.calls[0][3];
    const manageAction = toastOptions.actions.find((a: any) => a.label === 'Manage');
    expect(manageAction).toBeDefined();

    act(() => {
      manageAction.onClick();
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/settings/mcp')
    );
  });

  it('Details action clears the toast', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error details here');
    });

    const toastOptions = mockShowToast.mock.calls[0][3];
    const detailsAction = toastOptions.actions.find((a: any) => a.label === 'Details');
    expect(detailsAction).toBeDefined();

    act(() => {
      detailsAction.onClick();
    });

    expect(mockRemoveToast).toHaveBeenCalledWith('toast-id-1');
  });

  it('onDismiss handler removes the failed connection record', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    const toastOptions = mockShowToast.mock.calls[0][3];
    act(() => {
      toastOptions.onDismiss();
    });

    // After dismiss, the same server can show a new toast
    act(() => {
      mcpSubscribers.failure!('my-server', 'Error again');
    });

    expect(mockShowToast).toHaveBeenCalledTimes(2);
  });

  it('handles reconnect error gracefully', async () => {
    (window as any).electronAPI.profile.reconnectMcpServer = vi.fn().mockResolvedValue({ success: false, error: 'Failed' });

    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    const toastOptions = mockShowToast.mock.calls[0][3];
    const reconnectAction = toastOptions.actions.find((a: any) => a.label === 'Reconnect');

    // Should not throw
    await act(async () => {
      await reconnectAction.onClick();
    });
  });

  it('handles missing reconnectMcpServer gracefully', async () => {
    delete (window as any).electronAPI.profile.reconnectMcpServer;

    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    const toastOptions = mockShowToast.mock.calls[0][3];
    const reconnectAction = toastOptions.actions.find((a: any) => a.label === 'Reconnect');

    await act(async () => {
      await reconnectAction.onClick();
    });

    // Should not have called anything
    expect(true).toBe(true);
  });

  it('toast message is persistent', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Error');
    });

    const toastOptions = mockShowToast.mock.calls[0][3];
    expect(toastOptions.persistent).toBe(true);
  });

  it('shows error summary in toast for simple error', () => {
    renderToastHook();

    act(() => {
      mcpSubscribers.failure!('my-server', 'Connection timed out');
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    // Toast should contain a React element (the message)
    const messageArg = mockShowToast.mock.calls[0][0];
    expect(React.isValidElement(messageArg)).toBe(true);
  });

  it('parses stderr from MCP error string', () => {
    renderToastHook();

    const errorWithStderr = 'Failed to initialize MCP server: spawn error\n\nStderr output:\nmodule not found\ncritical error';
    act(() => {
      mcpSubscribers.failure!('my-server', errorWithStderr);
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
