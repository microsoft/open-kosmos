/**
 * @vitest-environment happy-dom
 *
 * Wrapper-component coverage tests for AppRoutes.tsx
 * These tests mount the Route element props so wrapper components are exercised.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockNavigate,
  mockLocation,
  mockIsAuthenticated,
  capturedStartupOnComplete,
  capturedDataLoadingOnDataReady,
  capturedAutoLoginOnSuccess,
  capturedAutoLoginOnFailure,
} = vi.hoisted(() => {
  const capturedStartupOnComplete = { fn: null as any };
  const capturedDataLoadingOnDataReady = { fn: null as any };
  const capturedAutoLoginOnSuccess = { fn: null as any };
  const capturedAutoLoginOnFailure = { fn: null as any };
  return {
    mockNavigate: vi.fn(),
    mockLocation: { pathname: '/', search: '', hash: '', state: null as any },
    mockIsAuthenticated: vi.fn(() => false),
    capturedStartupOnComplete,
    capturedDataLoadingOnDataReady,
    capturedAutoLoginOnSuccess,
    capturedAutoLoginOnFailure,
  };
});

// Route renders element prop so wrappers mount
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  Routes: ({ children }: any) => <div data-testid="routes">{children}</div>,
  Route: ({ element, path }: any) => (
    <div data-testid={`route-${path ?? 'no-path'}`}>{element}</div>
  ),
  Navigate: ({ to }: any) => <div data-testid={`navigate-to-${to.replace(/\//g, '-')}`} />,
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock('../../components/auth/AuthProvider', () => ({
  useAuthContext: () => ({ isAuthenticated: mockIsAuthenticated() }),
}));

vi.mock('../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Page mocks that capture callbacks
vi.mock('../../components/pages/StartupPage', () => ({
  StartupPage: ({ onComplete }: any) => {
    capturedStartupOnComplete.fn = onComplete;
    return <div data-testid="startup-page" />;
  },
}));
vi.mock('../../components/pages/SignInPage', () => ({
  SignInPage: () => <div data-testid="signin-page" />,
}));
vi.mock('../../components/pages/DataLoadingPage', () => ({
  DataLoadingPage: ({ onDataReady }: any) => {
    capturedDataLoadingOnDataReady.fn = onDataReady;
    return <div data-testid="data-loading-page" />;
  },
}));
vi.mock('../../components/pages/AgentPage', () => ({
  AgentPage: () => <div data-testid="agent-page" />,
}));
vi.mock('../../components/auth/AutoLoginSingleUser', () => ({
  AutoLoginSingleUser: ({ onSuccess, onFailure }: any) => {
    capturedAutoLoginOnSuccess.fn = onSuccess;
    capturedAutoLoginOnFailure.fn = onFailure;
    return <div data-testid="auto-login" />;
  },
}));

// Other view mocks
vi.mock('../../components/chat/ChatView', () => ({ default: () => <div /> }));
vi.mock('../../components/mcp/McpView', () => ({ default: () => <div /> }));
vi.mock('../../components/mcp/AddNewMcpServerView', () => ({ default: () => <div /> }));
vi.mock('../../components/mcp/ImportVscodeMcpServerView', () => ({ default: () => <div /> }));
vi.mock('../../components/skills/SkillsView', () => ({ default: () => <div /> }));
vi.mock('../../components/agentHooks/AgentHooksView', () => ({ default: () => <div /> }));
vi.mock('../../components/pages/SettingsPage', () => ({ default: () => <div /> }));
vi.mock('../../components/settings/RuntimeSettingsView', () => ({ default: () => <div /> }));
vi.mock('../../components/settings/VoiceInputSettingsView', () => ({ default: () => <div /> }));
vi.mock('../../components/settings/ScreenshotSettingsView', () => ({ default: () => <div /> }));
vi.mock('../../components/settings/SyncSettingsView', () => ({ default: () => <div /> }));
vi.mock('../../components/settings/AboutAppView', () => ({ default: () => <div /> }));
vi.mock('../../components/settings/ArchivedAgentsView', () => ({ default: () => <div /> }));
vi.mock('../../components/chat/agent-area/AgentChatEditingView', () => ({ default: () => <div /> }));
vi.mock('../../components/chat/agent-area/AgentChatCreationView', () => ({ default: () => <div /> }));
vi.mock('../../components/chat/agent-area/CreateCustomAgentView', () => ({ default: () => <div /> }));
vi.mock('../RequireAuth', () => ({ RequireAuth: () => <div data-testid="require-auth" /> }));

import { AppRoutes } from '../AppRoutes';
import { StartupAction } from '../../types/startupValidationTypes';

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

describe('AppRoutes wrapper components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    (mockLocation as any).pathname = '/';
    (mockLocation as any).search = '';
    (mockLocation as any).hash = '';
    (mockLocation as any).state = null;
  });

  // ── StartupWrapper ────────────────────────────────────────────────────────

  it('StartupWrapper renders StartupPage', () => {
    render(<AppRoutes />);
    expect(screen.getByTestId('startup-page')).toBeInTheDocument();
  });

  it('StartupWrapper: AUTO_LOGIN_SINGLE_USER navigates to /auto-login', () => {
    render(<AppRoutes />);
    act(() => {
      capturedStartupOnComplete.fn({
        recommendedAction: StartupAction.AUTO_LOGIN_SINGLE_USER,
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith('/auto-login', {
      state: { startupResult: { recommendedAction: StartupAction.AUTO_LOGIN_SINGLE_USER } },
    });
  });

  it('StartupWrapper: SHOW_USER_SELECTION navigates to /login with state', () => {
    render(<AppRoutes />);
    const result = { recommendedAction: StartupAction.SHOW_USER_SELECTION };
    act(() => {
      capturedStartupOnComplete.fn(result);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { startupResult: result } });
  });

  it('StartupWrapper: SHOW_NEW_USER_SIGNUP navigates to /login with state', () => {
    render(<AppRoutes />);
    const result = { recommendedAction: StartupAction.SHOW_NEW_USER_SIGNUP };
    act(() => {
      capturedStartupOnComplete.fn(result);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { startupResult: result } });
  });

  it('StartupWrapper: else-branch navigates to /login', () => {
    render(<AppRoutes />);
    act(() => {
      capturedStartupOnComplete.fn({ recommendedAction: 'unknown-action' });
    });
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  // ── AutoLoginWrapper ──────────────────────────────────────────────────────

  it('AutoLoginWrapper: no startupResult renders Navigate to /', () => {
    (mockLocation as any).state = null;
    render(<AppRoutes />);
    // Navigate with to="/" is rendered — testid uses replace(/\//g, '-') so to="/" → "-"
    expect(screen.getAllByTestId('navigate-to--').length).toBeGreaterThan(0);
  });

  it('AutoLoginWrapper: with startupResult renders AutoLoginSingleUser', () => {
    const startupResult = { recommendedAction: StartupAction.AUTO_LOGIN_SINGLE_USER };
    (mockLocation as any).state = { startupResult };
    render(<AppRoutes />);
    expect(screen.getByTestId('auto-login')).toBeInTheDocument();
  });

  it('AutoLoginWrapper.handleSuccess navigates to /loading', () => {
    const startupResult = { recommendedAction: StartupAction.AUTO_LOGIN_SINGLE_USER };
    (mockLocation as any).state = { startupResult };
    render(<AppRoutes />);
    act(() => {
      capturedAutoLoginOnSuccess.fn();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/loading');
  });

  it('AutoLoginWrapper.handleFailure navigates to /login with state', () => {
    const startupResult = { recommendedAction: StartupAction.AUTO_LOGIN_SINGLE_USER };
    (mockLocation as any).state = { startupResult };
    render(<AppRoutes />);
    act(() => {
      capturedAutoLoginOnFailure.fn();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { startupResult } });
  });

  // ── SignInWrapper ─────────────────────────────────────────────────────────

  it('SignInWrapper: isAuthenticated=false does not navigate to /loading', async () => {
    mockIsAuthenticated.mockReturnValue(false);
    render(<AppRoutes />);
    await act(async () => {});
    expect(mockNavigate).not.toHaveBeenCalledWith('/loading');
  });

  it('SignInWrapper: isAuthenticated=true navigates to /loading', async () => {
    mockIsAuthenticated.mockReturnValue(true);
    render(<AppRoutes />);
    await act(async () => {});
    expect(mockNavigate).toHaveBeenCalledWith('/loading');
  });

  // ── DataLoadingWrapper ────────────────────────────────────────────────────

  it('DataLoadingWrapper renders DataLoadingPage', () => {
    render(<AppRoutes />);
    expect(screen.getByTestId('data-loading-page')).toBeInTheDocument();
  });

  it('DataLoadingWrapper.handleDataReady navigates to /agent', () => {
    render(<AppRoutes />);
    act(() => {
      capturedDataLoadingOnDataReady.fn();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent');
  });

});
