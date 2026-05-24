/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

vi.mock('../components/auth/AuthProvider', async () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/auth/ReauthProvider', async () => ({
  ReauthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/userData/userDataProvider', async () => ({
  ProfileDataProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/ui/ToastProvider', async () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ToastContextSetter: () => null,
}));


vi.mock('../routes/AppRoutes', async () => ({
  AppRoutes: () => <div data-testid="app-routes" />,
}));

vi.mock('../components/layout/WindowsTitleBar', () => ({ default: () => <div data-testid="windows-title-bar" /> }));
vi.mock('../components/layout/WindowZoomHotkeys', () => ({ default: () => null }));
vi.mock('../lib/mcp/useMcpConnectionFailureToast', async () => ({
  useMcpConnectionFailureToast: () => null,
}));
vi.mock('../lib/utilities/logger', async () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../components/mcp/McpAuthConsentDialog', () => ({ default: () => (
  <div data-testid="mcp-auth-consent-dialog" />
) }));

describe('App MCP auth consent dialog mounting', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        isReady: vi.fn(async () => ({ success: true, data: true })),
        onAppReady: vi.fn(() => () => {}),
      },
    });
    window.location.hash = '#/settings/mcp';
    (window as any).isDebugWindow = false;
  });

  it('mounts the MCP auth consent dialog outside agent-only layout routes', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-auth-consent-dialog')).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-routes')).toBeInTheDocument();
  });
});