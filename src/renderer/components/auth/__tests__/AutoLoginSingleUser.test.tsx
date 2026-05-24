/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';

// ── Hoisted mock variables ─────────────────────────────────────────────────

const { mockSetCurrentAuth } = vi.hoisted(() => ({
  mockSetCurrentAuth: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../lib/auth/authManagerProxy', () => {
  function AuthManagerProxy(this: any) {
    this.setCurrentAuth = mockSetCurrentAuth;
  }
  return { AuthManagerProxy };
});

// ── Helpers ────────────────────────────────────────────────────────────────

import { AutoLoginSingleUser } from '../AutoLoginSingleUser';
import type { StartupValidationResult } from '../../../types/startupValidationTypes';

const fakeAuthData = {
  version: '1',
  createdAt: '',
  updatedAt: '',
  authProvider: 'github',
  ghcAuth: {
    alias: 'a',
    user: {
      id: '1',
      login: 'octocat',
      email: 'octocat@github.com',
      name: 'Octocat',
      avatarUrl: '',
      copilotPlan: 'individual' as const,
    },
    gitHubTokens: { timestamp: '', api_url: '', access_token: 'tok', token_type: 'bearer', scope: '' },
    copilotTokens: { timestamp: '', api_url: '', expires_at: 9999999999, token: 'coptok' },
    capabilities: [],
  },
};

function makeValidationResult(validUsers: any[]): StartupValidationResult {
  return {
    stage1: { isValid: true, errors: [] },
    stage2: { validUsers } as any,
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AutoLoginSingleUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentAuth.mockResolvedValue(undefined);
  });

  it('renders the loading spinner UI', async () => {
    const result = makeValidationResult([{ authData: fakeAuthData }]);
    await act(async () => {
      render(<AutoLoginSingleUser startupValidationResult={result} />);
    });
    expect(screen.getByText('Signing In...')).toBeTruthy();
    expect(screen.getByText('Loading your profile...')).toBeTruthy();
  });

  it('calls setCurrentAuth with authData on mount', async () => {
    const result = makeValidationResult([{ authData: fakeAuthData }]);
    await act(async () => {
      render(<AutoLoginSingleUser startupValidationResult={result} />);
    });
    expect(mockSetCurrentAuth).toHaveBeenCalledWith(fakeAuthData);
  });

  it('dispatches ghc:authSuccess event and calls onSuccess on success', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const onSuccess = vi.fn();
    const result = makeValidationResult([{ authData: fakeAuthData }]);

    await act(async () => {
      render(<AutoLoginSingleUser startupValidationResult={result} onSuccess={onSuccess} />);
    });

    expect(onSuccess).toHaveBeenCalled();
    const dispatchedEvent = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'ghc:authSuccess',
    );
    expect(dispatchedEvent).toBeTruthy();
    const detail = (dispatchedEvent![0] as CustomEvent).detail;
    expect(detail.autoLogin).toBe(true);
    expect(detail.authData).toBe(fakeAuthData);
  });

  it('calls onFailure and dispatches autoLogin:failed when no valid user', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const onFailure = vi.fn();
    const result = makeValidationResult([]);

    await act(async () => {
      render(<AutoLoginSingleUser startupValidationResult={result} onFailure={onFailure} />);
    });

    expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
    const failEvent = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'autoLogin:failed',
    );
    expect(failEvent).toBeTruthy();
  });

  it('calls onFailure and dispatches autoLogin:failed when setCurrentAuth throws', async () => {
    mockSetCurrentAuth.mockRejectedValue(new Error('IPC failed'));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const onFailure = vi.fn();
    const result = makeValidationResult([{ authData: fakeAuthData }]);

    await act(async () => {
      render(<AutoLoginSingleUser startupValidationResult={result} onFailure={onFailure} />);
    });

    expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(onFailure.mock.calls[0][0].message).toBe('IPC failed');
    const failEvent = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'autoLogin:failed',
    );
    expect(failEvent).toBeTruthy();
    const detail = (failEvent![0] as CustomEvent).detail;
    expect(detail.error).toBe('IPC failed');
  });

  it('handles validUser present but authData is null', async () => {
    const onFailure = vi.fn();
    const result = makeValidationResult([{ authData: null }]);

    await act(async () => {
      render(<AutoLoginSingleUser startupValidationResult={result} onFailure={onFailure} />);
    });

    expect(onFailure).toHaveBeenCalled();
    expect(mockSetCurrentAuth).not.toHaveBeenCalled();
  });
});
