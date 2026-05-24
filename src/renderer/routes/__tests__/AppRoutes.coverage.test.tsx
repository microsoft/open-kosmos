/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AppRoutes.tsx
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockNavigate,
  mockLocation,
  mockIsAuthenticated,
  mockBrowserControlEnabled,
  mockRemoteChannelEnabled,
  mockSubAgentEnabled,
  mockPluginsEnabled,
  mockMemexEnabled,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/', search: '', hash: '' },
  mockIsAuthenticated: vi.fn(() => false),
  mockBrowserControlEnabled: vi.fn(() => false),
  mockRemoteChannelEnabled: vi.fn(() => false),
  mockSubAgentEnabled: vi.fn(() => false),
  mockPluginsEnabled: vi.fn(() => false),
  mockMemexEnabled: vi.fn(() => false),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  Routes: ({ children }: any) => <div data-testid="routes">{children}</div>,
  Route: ({ path }: any) => <div data-testid={`route-${path ?? 'no-path'}`} />,
  Navigate: ({ to }: any) => <div data-testid={`navigate-to-${to.replace(/\//g, '-')}`} />,
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock('../lib/featureFlags', () => ({
  useFeatureFlag: (flag: string) => {
    if (flag === 'browserControl') return mockBrowserControlEnabled();
    if (flag === 'openkosmosFeatureRemoteChannel') return mockRemoteChannelEnabled();
    if (flag === 'openkosmosFeatureSubAgent') return mockSubAgentEnabled();
    if (flag === 'openkosmosFeaturePlugins') return mockPluginsEnabled();
    if (flag === 'openkosmosFeatureMemexMemory') return mockMemexEnabled();
    return false;
  },
}));

vi.mock('../components/auth/AuthProvider', () => ({
  useAuthContext: () => ({ isAuthenticated: mockIsAuthenticated() }),
}));

vi.mock('../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock all page/view components
vi.mock('../components/pages/StartupPage', () => ({ StartupPage: () => <div data-testid="startup-page" /> }));
vi.mock('../components/pages/SignInPage', () => ({ SignInPage: () => <div data-testid="signin-page" /> }));
vi.mock('../components/pages/DataLoadingPage', () => ({ DataLoadingPage: () => <div data-testid="data-loading-page" /> }));
vi.mock('../components/pages/AgentPage', () => ({ AgentPage: () => <div data-testid="agent-page" /> }));
vi.mock('../components/chat/ChatView', () => ({ default: () => <div data-testid="chat-view" /> }));
vi.mock('../components/mcp/McpView', () => ({ default: () => <div data-testid="mcp-view" /> }));
vi.mock('../components/mcp/AddNewMcpServerView', () => ({ default: () => <div data-testid="add-mcp-view" /> }));
vi.mock('../components/mcp/ImportVscodeMcpServerView', () => ({ default: () => <div data-testid="import-mcp-view" /> }));
vi.mock('../components/mcp/AddFromMcpLibraryView', () => ({ default: () => <div data-testid="mcp-library-view" /> }));
vi.mock('../components/mcp/AddFromSkillLibraryView', () => ({ default: () => <div data-testid="skill-library-view" /> }));
vi.mock('../components/skills/SkillsView', () => ({ default: () => <div data-testid="skills-view" /> }));
vi.mock('../components/plugin/PluginManagementView', () => ({ default: () => <div data-testid="plugins-view" /> }));
vi.mock('../components/subAgents/SubAgentsView', () => ({ default: () => <div data-testid="sub-agents-view" /> }));
vi.mock('../components/subAgents/CreateSubAgentView', () => ({ default: () => <div data-testid="create-sub-agent" /> }));
vi.mock('../components/subAgents/EditSubAgentView', () => ({ default: () => <div data-testid="edit-sub-agent" /> }));
vi.mock('../components/subAgents/SubAgentLibraryView', () => ({ default: () => <div data-testid="sub-agent-library" /> }));
vi.mock('../components/memory/MemoryView', () => ({ default: () => <div data-testid="memory-view" /> }));
vi.mock('../components/pages/SettingsPage', () => ({ default: () => <div data-testid="settings-page" /> }));
vi.mock('../components/settings/RuntimeSettingsView', () => ({ default: () => <div data-testid="runtime-view" /> }));
vi.mock('../components/settings/ToolbarSettingsView', () => ({ default: () => <div data-testid="toolbar-view" /> }));
vi.mock('../components/settings/VoiceInputSettingsView', () => ({ default: () => <div data-testid="voice-view" /> }));
vi.mock('../components/settings/TtsSettingsView', () => ({ default: () => <div data-testid="tts-view" /> }));
vi.mock('../components/settings/ScreenshotSettingsView', () => ({ default: () => <div data-testid="screenshot-view" /> }));
vi.mock('../components/settings/SyncSettingsView', () => ({ default: () => <div data-testid="sync-view" /> }));
vi.mock('../components/settings/AboutAppView', () => ({ default: () => <div data-testid="about-view" /> }));
vi.mock('../components/settings/BrowserControlView', () => ({ default: () => <div data-testid="browser-control-view" /> }));
vi.mock('../components/settings/MemexView', () => ({ default: () => <div data-testid="memex-view" /> }));
vi.mock('../components/settings/ArchivedAgentsView', () => ({ default: () => <div data-testid="archived-view" /> }));
vi.mock('../components/settings/MicrosoftSettingsView', () => ({ default: () => <div data-testid="microsoft-view" /> }));
vi.mock('../components/settings/RemoteChannelSettingsView', () => ({ default: () => <div data-testid="remote-channel-view" /> }));
vi.mock('../components/chat/agent-area/AgentChatEditingView', () => ({ default: () => <div data-testid="edit-view" /> }));
vi.mock('../components/chat/agent-area/AgentChatCreationView', () => ({ default: () => <div data-testid="creation-view" /> }));
vi.mock('../components/chat/agent-area/CreateCustomAgentView', () => ({ default: () => <div data-testid="custom-agent-view" /> }));
vi.mock('../components/chat/agent-area/AddFromAgentLibraryView', () => ({ default: () => <div data-testid="agent-library-view" /> }));
vi.mock('../components/chat/pm-project-agent-creation', () => ({ NewProjectAgentCreationView: () => <div data-testid="pm-project-view" /> }));
vi.mock('../routes/RequireAuth', () => ({ RequireAuth: () => <div data-testid="require-auth" /> }));
vi.mock('../components/auth/AutoLoginSingleUser', () => ({ AutoLoginSingleUser: () => <div data-testid="auto-login" /> }));

import { AppRoutes } from '../AppRoutes';

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

  it('renders with feature flags all enabled', () => {
    mockBrowserControlEnabled.mockReturnValue(true);
    mockRemoteChannelEnabled.mockReturnValue(true);
    mockSubAgentEnabled.mockReturnValue(true);
    mockPluginsEnabled.mockReturnValue(true);
    mockMemexEnabled.mockReturnValue(true);
    render(<AppRoutes />);
    expect(screen.getByTestId('routes')).toBeInTheDocument();
  });
});
