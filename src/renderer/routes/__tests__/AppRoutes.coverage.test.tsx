/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AppRoutes.tsx
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockNavigate,
  mockLocation,
  mockIsAuthenticated,
  mockAgentHooksMasterSwitch,
  mockStartupResult,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/', search: '', hash: '', state: null as any },
  mockIsAuthenticated: vi.fn(() => false),
  mockAgentHooksMasterSwitch: vi.fn(() => Promise.resolve({ success: true, enabled: true })),
  mockStartupResult: { current: null as any },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  Routes: ({ children }: any) => <div data-testid="routes">{children}</div>,
  // Render `element` and nested `children` so wrapper components actually mount.
  Route: ({ path, element, children }: any) => (
    <div data-testid={`route-${path ?? 'no-path'}`}>
      {element}
      {children}
    </div>
  ),
  Navigate: ({ to }: any) => <div data-testid={`navigate-to-${to.replace(/\//g, '-')}`} />,
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock('../../components/auth/AuthProvider', () => ({
  useAuthContext: () => ({ isAuthenticated: mockIsAuthenticated() }),
}));

vi.mock('../../ipc/agentHooks', () => ({
  agentHooksApi: {
    getMasterSwitch: mockAgentHooksMasterSwitch,
  },
}));

vi.mock('../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock all page/view components
vi.mock('../../components/pages/StartupPage', () => ({
  StartupPage: ({ onComplete }: any) => (
    <div
      data-testid="startup-page"
      onClick={() => onComplete?.((mockStartupResult.current))}
    />
  ),
}));
vi.mock('../../components/pages/SignInPage', () => ({ SignInPage: () => <div data-testid="signin-page" /> }));
vi.mock('../../components/pages/DataLoadingPage', () => ({
  DataLoadingPage: ({ onDataReady }: any) => (
    <div data-testid="data-loading-page" onClick={() => onDataReady?.()} />
  ),
}));
vi.mock('../../components/pages/AgentPage', () => ({ AgentPage: () => <div data-testid="agent-page" /> }));
vi.mock('../../components/chat/ChatView', () => ({ default: () => <div data-testid="chat-view" /> }));
vi.mock('../../components/mcp/McpView', () => ({ default: () => <div data-testid="mcp-view" /> }));
vi.mock('../../components/mcp/AddNewMcpServerView', () => ({ default: () => <div data-testid="add-mcp-view" /> }));
vi.mock('../../components/mcp/ImportVscodeMcpServerView', () => ({ default: () => <div data-testid="import-mcp-view" /> }));
vi.mock('../../components/skills/SkillsView', () => ({ default: () => <div data-testid="skills-view" /> }));
vi.mock('../../components/agentHooks/AgentHooksView', () => ({ default: () => <div data-testid="agent-hooks-view" /> }));
vi.mock('../../components/agentHooks/HookEditorView', () => ({ default: () => <div data-testid="hook-editor-view" /> }));
vi.mock('../../components/pages/SettingsPage', () => ({ default: () => <div data-testid="settings-page" /> }));
vi.mock('../../components/settings/RuntimeSettingsView', () => ({ default: () => <div data-testid="runtime-view" /> }));
vi.mock('../../components/settings/AppearanceSettingsView', () => ({ default: () => <div data-testid="appearance-view" /> }));
vi.mock('../../components/settings/VoiceInputSettingsView', () => ({ default: () => <div data-testid="voice-view" /> }));
vi.mock('../../components/settings/ScreenshotSettingsView', () => ({ default: () => <div data-testid="screenshot-view" /> }));
vi.mock('../../components/settings/SyncSettingsView', () => ({ default: () => <div data-testid="sync-view" /> }));
vi.mock('../../components/settings/AboutAppView', () => ({ default: () => <div data-testid="about-view" /> }));
vi.mock('../../components/settings/ArchivedAgentsView', () => ({ default: () => <div data-testid="archived-view" /> }));
vi.mock('../../components/settings/BrowserSettingsView', () => ({ default: () => <div data-testid="browser-settings-view" /> }));
vi.mock('../../components/settings/LanguageSettingsView', () => ({ default: () => <div data-testid="language-settings-view" /> }));
vi.mock('../../components/settings/MemexSettingsView', () => ({ default: () => <div data-testid="memex-settings-view" /> }));
vi.mock('../../components/settings/ComputerUseSettingsView', () => ({ default: () => <div data-testid="computer-use-settings-view" /> }));
vi.mock('../../components/settings/CodingCliSettingsView', () => ({ default: () => <div data-testid="coding-cli-view" /> }));
vi.mock('../../components/chat/agent-area/AgentChatEditingView', () => ({ default: () => <div data-testid="edit-view" /> }));
vi.mock('../../components/chat/agent-area/AgentChatCreationView', () => ({ default: () => <div data-testid="creation-view" /> }));
vi.mock('../../components/chat/agent-area/CreateCustomAgentView', () => ({ default: () => <div data-testid="custom-agent-view" /> }));
vi.mock('../RequireAuth', () => ({ RequireAuth: () => <div data-testid="require-auth" /> }));
vi.mock('../../components/auth/AutoLoginSingleUser', () => ({
  AutoLoginSingleUser: ({ onSuccess, onFailure }: any) => (
    <div data-testid="auto-login">
      <button data-testid="auto-login-success" onClick={() => onSuccess?.()} />
      <button data-testid="auto-login-failure" onClick={() => onFailure?.()} />
    </div>
  ),
}));

import { AppRoutes } from '../AppRoutes';
import { StartupAction } from '../../types/startupValidationTypes';
import { fireEvent } from '@testing-library/react';

function setupElectronAPI() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      on: vi.fn().mockReturnValue(() => {}),
      recordCrashBreadcrumb: vi.fn().mockResolvedValue(undefined),
    },
  });
}

describe('AppRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    (mockLocation as any).pathname = '/';
    (mockLocation as any).search = '';
    (mockLocation as any).hash = '';
    (mockLocation as any).state = null;
    mockStartupResult.current = null;
    mockIsAuthenticated.mockReturnValue(false);
    mockAgentHooksMasterSwitch.mockResolvedValue({ success: true, enabled: true });
  });

  it('renders without crashing', () => {
    render(<AppRoutes />);
    expect(screen.getByTestId('routes')).toBeInTheDocument();
  });

  it('registers navigate:to event listener on mount', () => {
    render(<AppRoutes />);
    expect((window.electronAPI as any).on).toHaveBeenCalledWith('navigate:to', expect.any(Function));
  });

  it('cleans up navigate:to listener on unmount', () => {
    const cleanup = vi.fn();
    (window.electronAPI as any).on.mockReturnValue(cleanup);
    const { unmount } = render(<AppRoutes />);
    unmount();
    expect(cleanup).toHaveBeenCalled();
  });

  it('calls recordCrashBreadcrumb on location change', async () => {
    render(<AppRoutes />);
    await act(async () => {});
    expect((window.electronAPI as any).recordCrashBreadcrumb).toHaveBeenCalledWith('route-change', expect.any(Object));
  });

  it('handles navigate:to event', () => {
    let capturedCallback: (data: any) => void = () => {};
    (window.electronAPI as any).on.mockImplementation((event: string, cb: any) => {
      if (event === 'navigate:to') capturedCallback = cb;
      return () => {};
    });
    render(<AppRoutes />);
    capturedCallback({ route: '/settings', state: { foo: 'bar' } });
    expect(mockNavigate).toHaveBeenCalledWith('/settings', { state: { foo: 'bar' } });
  });

  it('does not navigate when navigate:to data is empty', () => {
    let capturedCallback: (data: any) => void = () => {};
    (window.electronAPI as any).on.mockImplementation((event: string, cb: any) => {
      if (event === 'navigate:to') capturedCallback = cb;
      return () => {};
    });
    render(<AppRoutes />);
    capturedCallback({ route: '' });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate when navigate:to data is null', () => {
    let capturedCallback: (data: any) => void = () => {};
    (window.electronAPI as any).on.mockImplementation((event: string, cb: any) => {
      if (event === 'navigate:to') capturedCallback = cb;
      return () => {};
    });
    render(<AppRoutes />);
    capturedCallback(null);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('always registers the /settings/browser route regardless of feature flags', () => {
    render(<AppRoutes />);
    // BrowserSettingsView is mounted unconditionally (no flag gate).
    expect(screen.getByTestId('browser-settings-view')).toBeInTheDocument();
    expect(screen.getByTestId('route-browser')).toBeInTheDocument();
  });

  it('always registers the /settings/memex route regardless of feature flags', () => {
    render(<AppRoutes />);
    // MemexSettingsView is mounted unconditionally (gated only by the app.json
    // master switch at runtime, not a route-level feature flag).
    expect(screen.getByTestId('memex-settings-view')).toBeInTheDocument();
    expect(screen.getByTestId('route-memex')).toBeInTheDocument();
    expect(screen.getByTestId('route-memex/new')).toBeInTheDocument();
    expect(screen.getByTestId('route-memex/edit/:slug')).toBeInTheDocument();
    expect(screen.getAllByTestId('navigate-to--settings-memex')).toHaveLength(2);
  });

  it('always registers the /settings/coding-cli route regardless of feature flags', () => {
    render(<AppRoutes />);
    // CodingCliSettingsView is mounted unconditionally (gated only by the
    // profile-level master switch at runtime, not a route-level feature flag).
    expect(screen.getByTestId('coding-cli-view')).toBeInTheDocument();
    expect(screen.getByTestId('route-coding-cli')).toBeInTheDocument();
  });

  it('always registers the /settings/language route', () => {
    render(<AppRoutes />);
    expect(screen.getByTestId('language-settings-view')).toBeInTheDocument();
    expect(screen.getByTestId('route-language')).toBeInTheDocument();
  });

  it('always registers the /settings/agent-hooks route so users can reach the master switch', async () => {
    const { unmount } = render(<AppRoutes />);
    await screen.findByTestId('route-agent-hooks');
    expect(screen.getByTestId('agent-hooks-view')).toBeInTheDocument();

    unmount();
    mockAgentHooksMasterSwitch.mockResolvedValue({ success: true, enabled: false });
    render(<AppRoutes />);
    expect(screen.getByTestId('route-agent-hooks')).toBeInTheDocument();
  });

  it('keeps the /settings/agent-hooks route mounted while the master switch is loading', async () => {
    let resolveSwitch: (value: { success: boolean; enabled: boolean }) => void = () => {};
    mockAgentHooksMasterSwitch.mockReturnValue(new Promise(resolve => {
      resolveSwitch = resolve;
    }));

    render(<AppRoutes />);
    expect(screen.getByTestId('route-agent-hooks')).toBeInTheDocument();
    resolveSwitch({ success: true, enabled: false });
    await waitFor(() => expect(screen.getByTestId('route-agent-hooks')).toBeInTheDocument());
  });

  it('keeps the /settings/agent-hooks route mounted when the master switch change event disables it', async () => {
    render(<AppRoutes />);
    await screen.findByTestId('route-agent-hooks');
    window.dispatchEvent(new CustomEvent('agent-hooks-master-switch-changed', { detail: { enabled: false } }));
    expect(screen.getByTestId('route-agent-hooks')).toBeInTheDocument();
  });

  // ── StartupWrapper.handleStartupComplete ───────────────────────────────────
  describe('StartupWrapper', () => {
    it('navigates to /auto-login for AUTO_LOGIN_SINGLE_USER', () => {
      mockStartupResult.current = { recommendedAction: StartupAction.AUTO_LOGIN_SINGLE_USER };
      render(<AppRoutes />);
      fireEvent.click(screen.getByTestId('startup-page'));
      expect(mockNavigate).toHaveBeenCalledWith('/auto-login', { state: { startupResult: mockStartupResult.current } });
    });

    it('navigates to /login with state for SHOW_USER_SELECTION', () => {
      mockStartupResult.current = { recommendedAction: StartupAction.SHOW_USER_SELECTION };
      render(<AppRoutes />);
      fireEvent.click(screen.getByTestId('startup-page'));
      expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { startupResult: mockStartupResult.current } });
    });

    it('navigates to /login with state for SHOW_NEW_USER_SIGNUP', () => {
      mockStartupResult.current = { recommendedAction: StartupAction.SHOW_NEW_USER_SIGNUP };
      render(<AppRoutes />);
      fireEvent.click(screen.getByTestId('startup-page'));
      expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { startupResult: mockStartupResult.current } });
    });

    it('navigates to /login (no state) for any other action', () => {
      mockStartupResult.current = { recommendedAction: 'SOMETHING_ELSE' };
      render(<AppRoutes />);
      fireEvent.click(screen.getByTestId('startup-page'));
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  describe('AutoLoginWrapper', () => {
    it('redirects to / when there is no startupResult in location state', () => {
      (mockLocation as any).state = null;
      render(<AppRoutes />);
      expect(screen.getAllByTestId('navigate-to--').length).toBeGreaterThan(0);
    });

    it('navigates to /loading on success and /login on failure', () => {
      (mockLocation as any).state = { startupResult: { recommendedAction: StartupAction.AUTO_LOGIN_SINGLE_USER } };
      render(<AppRoutes />);
      fireEvent.click(screen.getByTestId('auto-login-success'));
      expect(mockNavigate).toHaveBeenCalledWith('/loading');
      fireEvent.click(screen.getByTestId('auto-login-failure'));
      expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { startupResult: (mockLocation as any).state.startupResult } });
    });
  });

  describe('SignInWrapper', () => {
    it('redirects to /loading when already authenticated', async () => {
      mockIsAuthenticated.mockReturnValue(true);
      render(<AppRoutes />);
      await act(async () => {});
      expect(mockNavigate).toHaveBeenCalledWith('/loading');
    });

    it('does not redirect when not authenticated', async () => {
      mockIsAuthenticated.mockReturnValue(false);
      render(<AppRoutes />);
      await act(async () => {});
      expect(mockNavigate).not.toHaveBeenCalledWith('/loading');
    });
  });

  describe('DataLoadingWrapper', () => {
    it('navigates to /agent when data is ready', () => {
      render(<AppRoutes />);
      fireEvent.click(screen.getByTestId('data-loading-page'));
      expect(mockNavigate).toHaveBeenCalledWith('/agent');
    });
  });
});
