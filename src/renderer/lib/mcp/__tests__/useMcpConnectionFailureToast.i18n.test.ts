/**
 * @vitest-environment happy-dom
 */

import { act, renderHook } from '@testing-library/react';

const mockShowToast = vi.hoisted(() => vi.fn(() => 'toast-id-1'));
const mockRemoveToast = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mcpSubscribers = vi.hoisted(() => ({
  failure: null as ((serverName: string, error: string) => void) | null,
  data: null as ((data: any) => void) | null,
}));
const i18nState = vi.hoisted(() => ({
  t: ((key: string, params?: Record<string, unknown>) => {
    if (key === 'mcp.connectionFailure.title') return `Failed: ${params?.serverName}`;
    if (key === 'mcp.connectionFailure.manage') return 'Manage';
    if (key === 'mcp.connectionFailure.details') return 'Details';
    if (key === 'mcp.connectionFailure.reconnect') return 'Reconnect';
    if (key === 'mcp.connectionFailure.fallbackSummary') return 'Connection failed';
    return key;
  }) as (key: string, params?: Record<string, unknown>) => string,
}));

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
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/components/ui/ErrorDetailsDialog', () => ({
  default: () => null,
}));

vi.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({ language: 'en', setLanguage: vi.fn(), t: i18nState.t }),
}));

import { useMcpConnectionFailureToast } from '../useMcpConnectionFailureToast';

describe('useMcpConnectionFailureToast i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpSubscribers.failure = null;
    mcpSubscribers.data = null;
    mockShowToast.mockReturnValue('toast-id-1');
    i18nState.t = (key: string, params?: Record<string, unknown>) => {
      if (key === 'mcp.connectionFailure.title') return `Failed: ${params?.serverName}`;
      if (key === 'mcp.connectionFailure.manage') return 'Manage';
      if (key === 'mcp.connectionFailure.details') return 'Details';
      if (key === 'mcp.connectionFailure.reconnect') return 'Reconnect';
      if (key === 'mcp.connectionFailure.fallbackSummary') return 'Connection failed';
      return key;
    };
    (window as any).electronAPI = {
      profile: {
        reconnectMcpServer: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('preserves duplicate-toast tracking when only the active language changes', () => {
    const { rerender } = renderHook(() => useMcpConnectionFailureToast());

    act(() => {
      mcpSubscribers.failure?.('my-server', 'Error 1');
    });

    i18nState.t = (key: string) => `zh:${key}`;
    rerender();

    act(() => {
      mcpSubscribers.failure?.('my-server', 'Error 2');
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
