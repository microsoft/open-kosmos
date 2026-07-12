// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Comprehensive coverage tests for InteractiveAuthCard.tsx
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockShowToast = vi.hoisted(() => vi.fn());
const mockWriteText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCancelActiveToolExecution = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: any) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  }}),
}));

vi.mock('lucide-react', () => ({
  ShieldAlert: () => <svg data-testid="shield-icon" />,
}));

import InteractiveAuthCard from '../InteractiveAuthCard';

function makeHint(overrides = {}) {
  return {
    commandFamily: 'gh-auth-login' as const,
    startedAt: Date.now(),
    timeoutMs: 60000,
    deviceCode: 'ABC-123',
    verificationUri: 'https://github.com/login/device',
    ...overrides,
  };
}

describe('InteractiveAuthCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    });
    (window as any).electronAPI = {
      agentChat: {
        cancelActiveToolExecution: mockCancelActiveToolExecution,
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders null when remainingMs <= 0 (timed out)', () => {
    const hint = makeHint({ startedAt: Date.now() - 70000, timeoutMs: 60000 });
    const { container } = render(<InteractiveAuthCard hint={hint} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the card when there is remaining time', () => {
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} />);
    expect(screen.getByTestId('shield-icon')).toBeTruthy();
  });

  it('shows the device code when provided', () => {
    const hint = makeHint({ deviceCode: 'XYZ-789' });
    render(<InteractiveAuthCard hint={hint} />);
    expect(screen.getByText('XYZ-789')).toBeTruthy();
  });

  it('shows verification URI when provided', () => {
    const hint = makeHint({ verificationUri: 'https://github.com/login/device' });
    render(<InteractiveAuthCard hint={hint} />);
    expect(screen.getByText('https://github.com/login/device')).toBeTruthy();
  });

  it('shows command when provided', () => {
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} command="gh auth login" />);
    expect(screen.getByText('gh auth login')).toBeTruthy();
  });

  it('hides command section when command not provided', () => {
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} />);
    expect(screen.queryByText('auth.interactive.command')).toBeNull();
  });

  it('copies device code when copy button clicked', async () => {
    const hint = makeHint({ deviceCode: 'XYZ-789' });
    render(<InteractiveAuthCard hint={hint} />);
    await act(async () => {
      fireEvent.click(screen.getByText('auth.interactive.copyDeviceCode'));
    });
    expect(mockWriteText).toHaveBeenCalledWith('XYZ-789');
    expect(mockShowToast).toHaveBeenCalledWith('auth.interactive.deviceCodeCopied', 'success');
  });

  it('shows error toast when clipboard write fails', async () => {
    mockWriteText.mockRejectedValueOnce(new Error('Permission denied'));
    const hint = makeHint({ deviceCode: 'XYZ-789' });
    render(<InteractiveAuthCard hint={hint} />);
    await act(async () => {
      fireEvent.click(screen.getByText('auth.interactive.copyDeviceCode'));
    });
    expect(mockShowToast).toHaveBeenCalledWith('auth.interactive.deviceCodeCopyFailed', 'error');
  });

  it('does not copy when deviceCode is missing', async () => {
    const hint = makeHint({ deviceCode: undefined });
    render(<InteractiveAuthCard hint={hint} />);
    // Copy Device Code button should not be visible
    expect(screen.queryByText('auth.interactive.copyDeviceCode')).toBeNull();
  });

  it('opens verification URI in new window', () => {
    const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const hint = makeHint({ verificationUri: 'https://github.com/login/device' });
    render(<InteractiveAuthCard hint={hint} />);
    fireEvent.click(screen.getByText('common.openLink'));
    expect(mockOpen).toHaveBeenCalledWith(
      'https://github.com/login/device',
      '_blank',
      'noopener,noreferrer',
    );
    mockOpen.mockRestore();
  });

  it('does not open window when verificationUri is missing', () => {
    const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const hint = makeHint({ verificationUri: undefined });
    render(<InteractiveAuthCard hint={hint} />);
    // Open Link button should not be visible
    expect(screen.queryByText('common.openLink')).toBeNull();
    mockOpen.mockRestore();
  });

  it('cancels active tool execution on Cancel click (success)', async () => {
    mockCancelActiveToolExecution.mockResolvedValueOnce({ success: true });
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} chatSessionId="session-1" />);
    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'));
    });
    expect(mockCancelActiveToolExecution).toHaveBeenCalledWith('session-1');
  });

  it('shows error toast when cancel fails (result.success=false)', async () => {
    mockCancelActiveToolExecution.mockResolvedValueOnce({ success: false, error: 'cancel error' });
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} chatSessionId="session-1" />);
    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'));
    });
    expect(mockShowToast).toHaveBeenCalledWith('auth.interactive.cancelFailed', 'error');
  });

  it('shows error toast when cancel throws', async () => {
    mockCancelActiveToolExecution.mockRejectedValueOnce(new Error('network'));
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} chatSessionId="session-1" />);
    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'));
    });
    expect(mockShowToast).toHaveBeenCalledWith('auth.interactive.cancelFailed', 'error');
  });

  it('shows cancelFailed toast when no chatSessionId', async () => {
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} chatSessionId={null} />);
    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'));
    });
    expect(mockShowToast).toHaveBeenCalledWith('auth.interactive.cancelFailed', 'error');
    expect(mockCancelActiveToolExecution).not.toHaveBeenCalled();
  });

  it('shows cancelFailed when electronAPI is absent', async () => {
    (window as any).electronAPI = undefined;
    const hint = makeHint();
    render(<InteractiveAuthCard hint={hint} chatSessionId="session-1" />);
    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'));
    });
    expect(mockShowToast).toHaveBeenCalledWith('auth.interactive.cancelFailed', 'error');
  });

  it('renders null after dismissal', async () => {
    mockCancelActiveToolExecution.mockResolvedValueOnce({ success: true });
    const hint = makeHint();
    const { container } = render(<InteractiveAuthCard hint={hint} chatSessionId="s-1" />);
    await act(async () => {
      fireEvent.click(screen.getByText('common.cancel'));
    });
    expect(container.firstChild).toBeNull();
  });

  it('updates remaining time on interval', () => {
    const hint = makeHint({ timeoutMs: 5000 });
    render(<InteractiveAuthCard hint={hint} />);
    // Should contain some time display
    expect(screen.getByText(/auth.interactive.timeoutIn/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    // Should still render (4 seconds left)
    expect(screen.getByText(/auth.interactive.timeoutIn/)).toBeTruthy();
  });

  it('disappears when timer expires', async () => {
    const hint = makeHint({ timeoutMs: 2000 });
    const { container } = render(<InteractiveAuthCard hint={hint} />);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(container.firstChild).toBeNull();
  });

  // Test various command families for the title key mapping
  it.each([
    ['gh-auth-login', 'auth.interactive.githubDeviceLoginRequired'],
    ['gh-auth-refresh', 'auth.interactive.githubAuthRefreshRequired'],
    ['npm-login', 'auth.interactive.npmLoginRequired'],
    ['npm-adduser', 'auth.interactive.npmAdduserRequired'],
    ['pnpm-login', 'auth.interactive.pnpmLoginRequired'],
    ['yarn-npm-login', 'auth.interactive.yarnNpmLoginRequired'],
    ['unknown', 'auth.interactive.browserAuthRequired'],
  ] as const)('shows correct title for commandFamily %s', (family, expectedKey) => {
    const hint = makeHint({ commandFamily: family as any });
    render(<InteractiveAuthCard hint={hint} />);
    expect(screen.getByText(expectedKey)).toBeTruthy();
  });
});
