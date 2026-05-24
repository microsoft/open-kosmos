/**
 * @vitest-environment happy-dom
 *
 * Tests for ErrorBar.tsx — covers all fix-suggestion branches and retry logic.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── CSS mock ──────────────────────────────────────────────────────────────────
vi.mock('../../../styles/ErrorBar.css', () => ({}));

// ── Dependency mocks ──────────────────────────────────────────────────────────

const mockGetChatSessionCache = vi.fn();
const mockGetSelectedModel = vi.fn();
const mockGetCurrentModel = vi.fn();
const mockClearErrorMessage = vi.fn();
const mockSetErrorMessage = vi.fn();
const mockRetryChat = vi.fn();

vi.mock('../../../lib/models/ghcModels', () => ({
  MODEL_CATEGORIES: {
    claude: ['claude-sonnet', 'claude-haiku', 'claude-opus'],
  },
}));

vi.mock('../../../lib/userData', () => ({
  profileDataManager: {
    getSelectedModel: (...args: unknown[]) => mockGetSelectedModel(...args),
    getCurrentModel: () => mockGetCurrentModel(),
  },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getChatSessionCache: (...args: unknown[]) => mockGetChatSessionCache(...args),
    clearErrorMessage: (...args: unknown[]) => mockClearErrorMessage(...args),
    setErrorMessage: (...args: unknown[]) => mockSetErrorMessage(...args),
  },
}));

vi.mock('@renderer/lib', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// ── Setup window.electronAPI.agentChat ───────────────────────────────────────
// Use Object.defineProperty to avoid overwriting the entire window object
// (which would break React DOM's internal focus/selection APIs).
Object.defineProperty(window, 'electronAPI', {
  configurable: true,
  writable: true,
  value: new Proxy({}, {
    get(_target, ns: string | symbol) {
      if (ns === 'agentChat') {
        return {
          retryChat: (...args: unknown[]) => mockRetryChat(...args),
        };
      }
      // Fallback namespace stub for any other calls in the component
      const invoke = vi.fn(async () => undefined);
      return new Proxy({}, { get: () => invoke });
    },
  }),
});

import ErrorBar from '../ErrorBar';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderBar(errorMessage: string, chatSessionId = 'session-1') {
  return render(<ErrorBar errorMessage={errorMessage} chatSessionId={chatSessionId} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ErrorBar — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);
  });

  afterEach(() => cleanup());

  it('renders the error message', () => {
    renderBar('Something went wrong');
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
  });

  it('renders the Retry button', () => {
    renderBar('Error');
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('shows no fix suggestion for an unknown error without Claude model', () => {
    renderBar('Unknown failure');
    expect(screen.queryByText(/VPN/)).toBeNull();
    expect(screen.queryByText(/network interruption/i)).toBeNull();
  });
});

describe('ErrorBar — fix suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('shows Claude VPN suggestion for "model is not supported" when Claude model active', () => {
    mockGetChatSessionCache.mockReturnValue({ chatId: 'chat-1' });
    mockGetSelectedModel.mockReturnValue('claude-sonnet');

    renderBar('model is not supported in this region');
    expect(screen.getByText(/VPN/)).toBeTruthy();
  });

  it('shows Claude VPN suggestion for "not available" error', () => {
    mockGetChatSessionCache.mockReturnValue({ chatId: 'chat-1' });
    mockGetSelectedModel.mockReturnValue('claude-opus');

    renderBar('The service is not available');
    expect(screen.getByText(/VPN/)).toBeTruthy();
  });

  it('shows Claude VPN suggestion for "region" error', () => {
    mockGetChatSessionCache.mockReturnValue({ chatId: 'chat-1' });
    mockGetSelectedModel.mockReturnValue('claude-haiku');

    renderBar('restricted in your region');
    expect(screen.getByText(/VPN/)).toBeTruthy();
  });

  it('shows Claude VPN suggestion for "blocked" error', () => {
    mockGetChatSessionCache.mockReturnValue({ chatId: 'chat-1' });
    mockGetSelectedModel.mockReturnValue('claude-sonnet');

    renderBar('request blocked');
    expect(screen.getByText(/VPN/)).toBeTruthy();
  });

  it('does NOT show Claude VPN suggestion when model is not Claude', () => {
    mockGetChatSessionCache.mockReturnValue({ chatId: 'chat-1' });
    mockGetSelectedModel.mockReturnValue('gpt-4o');

    renderBar('model is not supported');
    expect(screen.queryByText(/VPN/)).toBeNull();
  });

  it('does NOT show Claude VPN suggestion when no model found', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('model is not supported');
    expect(screen.queryByText(/VPN/)).toBeNull();
  });

  it('uses getCurrentModel when cache has no chatId', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue('claude-opus');

    renderBar('model is not supported');
    expect(screen.getByText(/VPN/)).toBeTruthy();
  });

  it('shows network interruption suggestion for "terminated"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('Connection terminated unexpectedly');
    expect(screen.getByText(/network interruption/i)).toBeTruthy();
  });

  it('shows network interruption suggestion for "connection terminated"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('connection terminated');
    expect(screen.getByText(/network interruption/i)).toBeTruthy();
  });

  it('shows network interruption suggestion for "network connection"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('network connection lost');
    expect(screen.getByText(/network interruption/i)).toBeTruthy();
  });

  it('shows network interruption suggestion for "fetch failed"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('fetch failed: network error');
    expect(screen.getByText(/network interruption/i)).toBeTruthy();
  });

  it('shows internal server error suggestion for "internal error"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('internal error occurred');
    expect(screen.getAllByText(/internal error/i).length).toBeGreaterThan(0);
  });

  it('shows internal server error suggestion for "server internal error"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('server internal error happened');
    expect(screen.getAllByText(/internal error/i).length).toBeGreaterThan(0);
  });

  it('shows internal server error suggestion for "status: 500"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('Request failed: status: 500');
    expect(screen.getByText(/internal error/i)).toBeTruthy();
  });

  it('shows truncation suggestion for "truncat"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('response was truncated');
    expect(screen.getAllByText(/truncated/i).length).toBeGreaterThan(0);
  });

  it('shows truncation suggestion for "incomplete json"', () => {
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);

    renderBar('incomplete json received');
    expect(screen.getAllByText(/truncated/i).length).toBeGreaterThan(0);
  });
});

describe('ErrorBar — retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChatSessionCache.mockReturnValue(null);
    mockGetCurrentModel.mockReturnValue(null);
  });

  afterEach(() => cleanup());

  it('calls clearErrorMessage and retryChat on Retry click', async () => {
    mockRetryChat.mockResolvedValue({ success: true });

    renderBar('Some error', 'sess-1');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockClearErrorMessage).toHaveBeenCalledWith('sess-1');
      expect(mockRetryChat).toHaveBeenCalledWith('sess-1');
    });
  });

  it('restores error message when retry returns { success: false }', async () => {
    mockRetryChat.mockResolvedValue({ success: false, error: 'Model overloaded' });

    renderBar('Some error', 'sess-2');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockSetErrorMessage).toHaveBeenCalledWith('sess-2', 'Model overloaded');
    });
  });

  it('restores error message with fallback text when retry returns failure with no error field', async () => {
    mockRetryChat.mockResolvedValue({ success: false });

    renderBar('Some error', 'sess-3');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockSetErrorMessage).toHaveBeenCalledWith('sess-3', 'Retry failed');
    });
  });

  it('restores error message when retry throws an Error', async () => {
    mockRetryChat.mockRejectedValue(new Error('Network down'));

    renderBar('Some error', 'sess-4');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockSetErrorMessage).toHaveBeenCalledWith('sess-4', 'Network down');
    });
  });

  it('restores error message when retry throws a non-Error', async () => {
    mockRetryChat.mockRejectedValue('plain string error');

    renderBar('Some error', 'sess-5');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockSetErrorMessage).toHaveBeenCalledWith('sess-5', 'plain string error');
    });
  });
});
