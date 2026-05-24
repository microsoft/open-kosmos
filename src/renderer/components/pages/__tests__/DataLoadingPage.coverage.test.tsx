/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for DataLoadingPage.tsx
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── hoisted mocks ──────────────────────────────────────────────────────────────

const { mockUser, mockProfileData } = vi.hoisted(() => ({
  mockUser: {
    current: null as any,
  },
  mockProfileData: {
    isInitialized: false,
    isLoading: true,
    data: null as any,
  },
}));

vi.mock('../../../styles/DataLoadingPage.css', () => ({}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ user: mockUser.current }),
}));

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => mockProfileData,
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { DataLoadingPage } from '../DataLoadingPage';

// ── helpers ───────────────────────────────────────────────────────────────────

function renderPage(onDataReady = vi.fn()) {
  return render(<DataLoadingPage onDataReady={onDataReady} />);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DataLoadingPage - basic rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUser.current = { name: 'Alice', login: 'alice', avatarUrl: undefined };
    mockProfileData.isInitialized = false;
    mockProfileData.isLoading = true;
    mockProfileData.data = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the data loading page container', () => {
    renderPage();
    expect(document.querySelector('.data-loading-page')).toBeInTheDocument();
  });

  it('shows welcome message with user name', () => {
    renderPage();
    expect(screen.getByText(/Welcome back, Alice/)).toBeInTheDocument();
  });

  it('shows welcome message with login when name is absent', () => {
    mockUser.current = { login: 'bob', avatarUrl: undefined };
    renderPage();
    expect(screen.getByText(/Welcome back, bob/)).toBeInTheDocument();
  });

  it('shows user avatar when avatarUrl provided', () => {
    mockUser.current = { name: 'Alice', login: 'alice', avatarUrl: 'http://example.com/avatar.png' };
    renderPage();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'http://example.com/avatar.png');
  });

  it('shows initials when no avatarUrl', () => {
    mockUser.current = { name: 'Alice', login: 'alice', avatarUrl: undefined };
    renderPage();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('shows login initial when no name', () => {
    mockUser.current = { login: 'bob', avatarUrl: undefined };
    renderPage();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('shows fallback "U" when no name or login', () => {
    mockUser.current = null;
    renderPage();
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('renders progress section', () => {
    renderPage();
    expect(document.querySelector('.data-loading-progress-bar')).toBeInTheDocument();
    expect(document.querySelector('.data-loading-progress-fill')).toBeInTheDocument();
  });

  it('renders detail items', () => {
    renderPage();
    expect(screen.getByText(/Initialize user configuration/)).toBeInTheDocument();
    expect(screen.getByText(/Load Chat configurations/)).toBeInTheDocument();
  });
});

describe('DataLoadingPage - loading states', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser.current = { name: 'Alice', login: 'alice' };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading indicator when not initialized', () => {
    mockProfileData.isInitialized = false;
    mockProfileData.data = null;
    renderPage();
    expect(screen.getByText(/Initialize user configuration \.\.\./)).toBeInTheDocument();
  });

  it('shows completed indicator when initialized', () => {
    mockProfileData.isInitialized = true;
    mockProfileData.data = { chats: [] };
    renderPage();
    const indicators = screen.getAllByText(/✓/);
    expect(indicators.length).toBeGreaterThan(0);
  });

  it('shows chats completed when data.chats is empty array', () => {
    mockProfileData.isInitialized = false;
    mockProfileData.data = { chats: [] };
    renderPage();
    expect(screen.getByText(/Load Chat configurations ✓/)).toBeInTheDocument();
  });

  it('shows chats loading when data is null', () => {
    mockProfileData.isInitialized = false;
    mockProfileData.data = null;
    renderPage();
    expect(screen.getByText(/Load Chat configurations \.\.\./)).toBeInTheDocument();
  });
});

describe('DataLoadingPage - animated dots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser.current = { name: 'Alice', login: 'alice' };
    mockProfileData.isInitialized = false;
    mockProfileData.data = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty dots', () => {
    renderPage();
    // Initially dots is '' so text is "Loading your data"
    expect(screen.getByText(/Loading your data$/)).toBeInTheDocument();
  });

  it('progresses to single dot after 500ms', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/Loading your data\.$/)).toBeInTheDocument();
  });

  it('progresses to double dot after 1000ms', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/Loading your data\.\.$/)).toBeInTheDocument();
  });

  it('progresses to triple dot after 1500ms', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(/Loading your data\.\.\.$/)).toBeInTheDocument();
  });

  it('resets to empty after 2000ms', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText(/Loading your data$/)).toBeInTheDocument();
  });
});

describe('DataLoadingPage - loading messages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser.current = { name: 'Alice', login: 'alice' };
    mockProfileData.isInitialized = false;
    mockProfileData.data = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Connecting to server" at 0s', () => {
    renderPage();
    expect(screen.getByText('Connecting to server')).toBeInTheDocument();
  });

  it('shows "Loading configuration files" at 2s', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.getByText('Loading configuration files')).toBeInTheDocument();
  });

  it('shows "Initializing MCP servers" at 5s', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.getByText('Initializing MCP servers')).toBeInTheDocument();
  });

  it('shows "Syncing GitHub Copilot models" at 8s', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(8100); });
    expect(screen.getByText('Syncing GitHub Copilot models')).toBeInTheDocument();
  });

  it('shows "Almost complete" at 12s', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(12100); });
    expect(screen.getByText('Almost complete')).toBeInTheDocument();
  });
});

describe('DataLoadingPage - progress percentage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser.current = { name: 'Alice', login: 'alice' };
    mockProfileData.isInitialized = false;
    mockProfileData.data = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows 0% width at start', () => {
    renderPage();
    const fill = document.querySelector('.data-loading-progress-fill') as HTMLElement;
    // At 0s: min(0 * 20, 60) = 0
    expect(fill.style.width).toBe('0%');
  });

  it('shows 100% when initialized', () => {
    mockProfileData.isInitialized = true;
    mockProfileData.data = { chats: [] };
    renderPage();
    const fill = document.querySelector('.data-loading-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('shows time-based progress at 1s', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(1100); });
    const fill = document.querySelector('.data-loading-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('20%');
  });

  it('shows capped progress at 3s (60%)', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(3100); });
    const fill = document.querySelector('.data-loading-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('60%');
  });

  it('shows 95% cap at 10s without initialization', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(10100); });
    const fill = document.querySelector('.data-loading-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('95%');
  });
});

describe('DataLoadingPage - onDataReady callback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser.current = { name: 'Alice', login: 'alice' };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onDataReady after 800ms delay when isInitialized becomes true', async () => {
    mockProfileData.isInitialized = true;
    mockProfileData.data = { chats: [] };
    const onDataReady = vi.fn();
    renderPage(onDataReady);
    expect(onDataReady).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(800); });
    expect(onDataReady).toHaveBeenCalledTimes(1);
  });

  it('does not call onDataReady when not initialized', () => {
    mockProfileData.isInitialized = false;
    mockProfileData.data = null;
    const onDataReady = vi.fn();
    renderPage(onDataReady);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onDataReady).not.toHaveBeenCalled();
  });
});

describe('DataLoadingPage - elapsed time display', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser.current = { name: 'Alice', login: 'alice' };
    mockProfileData.isInitialized = false;
    mockProfileData.data = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows 0s at start', () => {
    renderPage();
    expect(screen.getByText('Loading time: 0s')).toBeInTheDocument();
  });

  it('shows elapsed time after 3 seconds', () => {
    renderPage();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('Loading time: 3s')).toBeInTheDocument();
  });
});
