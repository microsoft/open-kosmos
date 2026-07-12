// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for UserSection.tsx
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────
const mockAuthData = vi.hoisted(() => ({
  value: null as any,
}));
const mockSetUserMenuVisible = vi.hoisted(() => vi.fn((fn: any) => {
  // Execute the updater function if passed to cover the (prev) => !prev arrow function
  if (typeof fn === 'function') fn(false);
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuthContext: () => ({ authData: mockAuthData.value }),
}));

vi.mock('@/components/layout/UserMenu', () => ({
  userMenuVisibleAtom: {
    useChange: () => mockSetUserMenuVisible,
  },
}));

vi.mock('@/components/buddy', () => ({
  BuddyEntryButton: () => <div data-testid="buddy-entry-button" />,
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import UserSection from '../UserSection';

describe('UserSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthData.value = null;
  });

  it('renders without auth data', () => {
    render(<UserSection />);
    expect(screen.getByTestId('buddy-entry-button')).toBeTruthy();
  });

  it('renders profile avatar when user has avatarUrl', () => {
    mockAuthData.value = {
      ghcAuth: {
        user: { name: 'Alice', login: 'alice', avatarUrl: 'https://example.com/avatar.png' },
      },
    };
    render(<UserSection />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.png');
    expect(img.getAttribute('alt')).toBe('Alice');
  });

  it('renders fallback icon when no avatarUrl', () => {
    mockAuthData.value = {
      ghcAuth: {
        user: { name: 'Bob', login: 'bob', avatarUrl: null },
      },
    };
    render(<UserSection />);
    expect(screen.getByText('👤')).toBeTruthy();
  });

  it('uses login as display name when name is missing', () => {
    mockAuthData.value = {
      ghcAuth: { user: { login: 'alice', avatarUrl: null } },
    };
    render(<UserSection />);
    const btn = screen.getByRole('button', { name: 'userSection.userMenu' });
    expect(btn.title).toBe('alice');
  });

  it('uses alias as display name when user is missing', () => {
    mockAuthData.value = {
      ghcAuth: { alias: 'alias-user', user: null },
    };
    render(<UserSection />);
    const btn = screen.getByRole('button', { name: 'userSection.userMenu' });
    expect(btn.title).toBe('alias-user');
  });

  it('uses Unknown User as fallback display name', () => {
    mockAuthData.value = { ghcAuth: {} };
    render(<UserSection />);
    const btn = screen.getByRole('button', { name: 'userSection.userMenu' });
    expect(btn.title).toBe('Unknown User');
  });

  it('toggles user menu on profile button click', () => {
    render(<UserSection />);
    fireEvent.click(screen.getByRole('button', { name: 'userSection.userMenu' }));
    expect(mockSetUserMenuVisible).toHaveBeenCalled();
  });

  it('handles avatar image error (hides image)', () => {
    mockAuthData.value = {
      ghcAuth: {
        user: { name: 'Alice', login: 'alice', avatarUrl: 'https://example.com/avatar.png' },
      },
    };
    render(<UserSection />);
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(img.style.display).toBe('none');
  });
});

describe('UserSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthData.value = null;
  });

  it('renders without auth data', () => {
    render(<UserSection />);
    expect(screen.getByTestId('buddy-entry-button')).toBeTruthy();
  });

  it('renders profile avatar when user has avatarUrl', () => {
    mockAuthData.value = {
      ghcAuth: {
        user: { name: 'Alice', login: 'alice', avatarUrl: 'https://example.com/avatar.png' },
      },
    };
    render(<UserSection />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.png');
    expect(img.getAttribute('alt')).toBe('Alice');
  });

  it('renders fallback icon when no avatarUrl', () => {
    mockAuthData.value = {
      ghcAuth: {
        user: { name: 'Bob', login: 'bob', avatarUrl: null },
      },
    };
    render(<UserSection />);
    expect(screen.getByText('👤')).toBeTruthy();
  });

  it('uses login as display name when name is missing', () => {
    mockAuthData.value = {
      ghcAuth: { user: { login: 'alice', avatarUrl: null } },
    };
    render(<UserSection />);
    const btn = screen.getByRole('button', { name: 'userSection.userMenu' });
    expect(btn.title).toBe('alice');
  });

  it('uses alias as display name when user is missing', () => {
    mockAuthData.value = {
      ghcAuth: { alias: 'alias-user', user: null },
    };
    render(<UserSection />);
    const btn = screen.getByRole('button', { name: 'userSection.userMenu' });
    expect(btn.title).toBe('alias-user');
  });

  it('uses Unknown User as fallback display name', () => {
    mockAuthData.value = { ghcAuth: {} };
    render(<UserSection />);
    const btn = screen.getByRole('button', { name: 'userSection.userMenu' });
    expect(btn.title).toBe('Unknown User');
  });

  it('toggles user menu on profile button click', () => {
    render(<UserSection />);
    fireEvent.click(screen.getByRole('button', { name: 'userSection.userMenu' }));
    expect(mockSetUserMenuVisible).toHaveBeenCalled();
  });

  it('handles avatar image error (hides image)', () => {
    mockAuthData.value = {
      ghcAuth: {
        user: { name: 'Alice', login: 'alice', avatarUrl: 'https://example.com/avatar.png' },
      },
    };
    render(<UserSection />);
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(img.style.display).toBe('none');
  });
});
