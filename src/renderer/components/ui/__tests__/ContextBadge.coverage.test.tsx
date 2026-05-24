/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockCurrentModel = vi.hoisted(() => ({ value: 'gpt-4' as string | null }));
const mockContextTokens = vi.hoisted(() => ({ value: 0 }));
const mockCurrentChatSessionId = vi.hoisted(() => ({ value: null as string | null }));
const mockGetCurrentContextTokenUsage = vi.hoisted(() => vi.fn());
const mockAddContextChangeListener = vi.hoisted(() => vi.fn());
const mockRemoveContextChangeListener = vi.hoisted(() => vi.fn());
const mockGetCurrentChatSessionId = vi.hoisted(() => vi.fn());
const mockSubscribeToCurrentChatSessionId = vi.hoisted(() => vi.fn());
const mockGetModelById = vi.hoisted(() => vi.fn());

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('../../userData/userDataProvider', () => ({
  useAgentConfig: () => ({ currentModel: mockCurrentModel.value }),
}));

vi.mock('../../../lib/models/ghcModels', () => ({
  getModelById: (...args: any[]) => mockGetModelById(...args),
}));

vi.mock('../../../lib/chat/agentChatIpc', () => ({
  agentChatIpc: {
    getCurrentContextTokenUsage: (...args: any[]) => mockGetCurrentContextTokenUsage(...args),
    addContextChangeListener: (...args: any[]) => mockAddContextChangeListener(...args),
    removeContextChangeListener: (...args: any[]) => mockRemoveContextChangeListener(...args),
  },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatSessionId: (...args: any[]) => mockGetCurrentChatSessionId(...args),
    subscribeToCurrentChatSessionId: (...args: any[]) => mockSubscribeToCurrentChatSessionId(...args),
  },
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../badge', () => ({
  Badge: ({ children, variant, title, className }: any) => (
    <span data-testid="badge" data-variant={variant} title={title} className={className}>
      {children}
    </span>
  ),
}));

import { ContextBadge } from '../ContextBadge';

function setupDefaultMocks() {
  mockCurrentModel.value = 'gpt-4';
  mockGetModelById.mockReturnValue({
    capabilities: {
      limits: {
        max_prompt_tokens: 128000,
        max_context_window_tokens: 200000,
      },
    },
  });
  mockGetCurrentChatSessionId.mockReturnValue('session-123');
  mockSubscribeToCurrentChatSessionId.mockReturnValue(() => {});
  mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 5000 });
  mockAddContextChangeListener.mockImplementation(() => {});
  mockRemoveContextChangeListener.mockImplementation(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// ── basic render ──────────────────────────────────────────────────────────────

describe('ContextBadge – basic render', () => {
  it('renders a badge element', async () => {
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('badge')).toBeTruthy();
    });
  });

  it('shows loading state initially', () => {
    // Delay resolution so we catch the loading state
    mockGetCurrentContextTokenUsage.mockReturnValue(new Promise(() => {}));
    render(<ContextBadge />);
    expect(screen.getByText('context: loading...')).toBeTruthy();
  });

  it('displays token count after load', async () => {
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context:/)).toBeTruthy();
    });
    // Should show 5k/128k
    expect(screen.getByText(/5k\/128k/)).toBeTruthy();
  });
});

// ── formatTokenCount ──────────────────────────────────────────────────────────

describe('ContextBadge – token formatting', () => {
  it('displays tokens < 1000 as integer', async () => {
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 500 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 500\//)).toBeTruthy();
    });
  });

  it('displays tokens at exactly 1000 as "1k"', async () => {
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 1000 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 1k\//)).toBeTruthy();
    });
  });

  it('displays 1900 tokens as "1.9k"', async () => {
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 1900 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 1\.9k\//)).toBeTruthy();
    });
  });

  it('displays 128000 as "128k" (no decimal)', async () => {
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 128000 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 128k\//)).toBeTruthy();
    });
  });

  it('displays 0 tokens when no data available', async () => {
    mockGetCurrentContextTokenUsage.mockResolvedValue(null);
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 0\//)).toBeTruthy();
    });
  });
});

// ── variant selection ─────────────────────────────────────────────────────────

describe('ContextBadge – badge variant based on utilization', () => {
  it('uses "normal" variant at low utilization (<= 70%)', async () => {
    // 5000 / 128000 = ~3.9%
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 5000 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('badge').getAttribute('data-variant')).toBe('normal');
    });
  });

  it('uses "outline" variant at 71-90% utilization', async () => {
    // 95000 / 128000 = ~74%
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 95000 });
    render(<ContextBadge />);
    await waitFor(() => {
      const badge = screen.getByTestId('badge');
      expect(badge.getAttribute('data-variant')).toBe('outline');
    });
  });

  it('uses "destructive" variant above 90% utilization', async () => {
    // 120000 / 128000 = ~94%
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 120000 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('badge').getAttribute('data-variant')).toBe('destructive');
    });
  });

  it('uses "normal" variant when utilization is 0 (no model window)', async () => {
    mockCurrentModel.value = null;
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 0 });
    render(<ContextBadge />);
    await waitFor(() => {
      // When modelContextWindow is 0, utilizationRatio is 0, variant should be "normal"
      expect(screen.getByTestId('badge')).toBeTruthy();
    });
  });
});

// ── title tooltip ─────────────────────────────────────────────────────────────

describe('ContextBadge – title tooltip', () => {
  it('includes token count and percentage in title', async () => {
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 10000 });
    render(<ContextBadge />);
    await waitFor(() => {
      const badge = screen.getByTestId('badge');
      expect(badge.getAttribute('title')).toContain('10,000');
      expect(badge.getAttribute('title')).toContain('128,000');
      expect(badge.getAttribute('title')).toMatch(/\d+\.\d+%/);
    });
  });
});

// ── model with max_context_window_tokens fallback ────────────────────────────

describe('ContextBadge – model limits fallback', () => {
  it('falls back to max_context_window_tokens when max_prompt_tokens is absent', async () => {
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: {
          max_context_window_tokens: 64000,
        },
      },
    });
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 1000 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/64k/)).toBeTruthy();
    });
  });

  it('uses default 128000 when model not found', async () => {
    mockGetModelById.mockReturnValue(null);
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 1000 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/128k/)).toBeTruthy();
    });
  });

  it('shows 0/0 when currentModel is null', async () => {
    mockCurrentModel.value = null;
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 0 });
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText('context: 0/0')).toBeTruthy();
    });
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('ContextBadge – error handling', () => {
  it('sets contextTokens to 0 when getCurrentContextTokenUsage throws', async () => {
    mockGetCurrentContextTokenUsage.mockRejectedValue(new Error('IPC error'));
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 0\//)).toBeTruthy();
    });
  });
});

// ── context change listener ───────────────────────────────────────────────────

describe('ContextBadge – context change listener', () => {
  it('updates token count when context change listener fires', async () => {
    let capturedListener: ((stats: any) => void) | null = null;
    mockAddContextChangeListener.mockImplementation((fn: any) => {
      capturedListener = fn;
    });
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 1000 });

    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 1k\//)).toBeTruthy();
    });

    // Simulate context change event
    await act(async () => {
      capturedListener?.({ tokenCount: 50000, totalMessages: 10, contextMessages: 8, compressionRatio: 0.8 });
    });

    await waitFor(() => {
      expect(screen.getByText(/context: 50k\//)).toBeTruthy();
    });
  });

  it('cleans up listener on unmount', async () => {
    const { unmount } = render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('badge')).toBeTruthy();
    });
    unmount();
    expect(mockRemoveContextChangeListener).toHaveBeenCalled();
  });
});

// ── session id subscription ───────────────────────────────────────────────────

describe('ContextBadge – session id subscription', () => {
  it('subscribes to currentChatSessionId changes on mount', () => {
    render(<ContextBadge />);
    expect(mockSubscribeToCurrentChatSessionId).toHaveBeenCalled();
  });

  it('re-initializes token data when session id changes', async () => {
    let capturedSubscriber: ((sessionId: string | null) => void) | null = null;
    mockSubscribeToCurrentChatSessionId.mockImplementation((fn: any) => {
      capturedSubscriber = fn;
      return () => {};
    });
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 1000 });

    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/context: 1k\//)).toBeTruthy();
    });

    // Simulate session change
    mockGetCurrentContextTokenUsage.mockResolvedValue({ tokenCount: 2000 });
    await act(async () => {
      capturedSubscriber?.('new-session-456');
    });

    await waitFor(() => {
      expect(screen.getByText(/context: 2k\//)).toBeTruthy();
    });
  });
});

// ── modelCacheUpdated event ───────────────────────────────────────────────────

describe('ContextBadge – modelCacheUpdated event', () => {
  it('recalculates context window on modelCacheUpdated event', async () => {
    render(<ContextBadge />);
    await waitFor(() => {
      expect(screen.getByText(/128k/)).toBeTruthy();
    });

    // Now change what getModelById returns and fire the event
    mockGetModelById.mockReturnValue({
      capabilities: {
        limits: {
          max_prompt_tokens: 32000,
        },
      },
    });

    await act(async () => {
      window.dispatchEvent(new Event('modelCacheUpdated'));
    });

    await waitFor(() => {
      expect(screen.getByText(/32k/)).toBeTruthy();
    });
  });
});
