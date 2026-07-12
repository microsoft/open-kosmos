/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import App from '../App';

const closeAllAndDestroyMock = vi.hoisted(() => vi.fn());

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

vi.mock('../components/theme/ThemeProvider', async () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../routes/AppRoutes', async () => ({
  AppRoutes: () => <div data-testid="app-routes" />,
}));

vi.mock('../components/layout/WindowsTitleBar', () => ({
  default: () => <div data-testid="windows-title-bar" />,
}));
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
vi.mock('../components/mcp/McpAuthConsentDialog', () => ({
  default: () => <div data-testid="mcp-auth-consent-dialog" />,
}));
vi.mock('../components/mcp/RequestOAuthClientIdDialog', () => ({
  default: () => null,
}));
vi.mock('../components/browser/embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: {
    useChange: () => ({
      closeAllAndDestroy: closeAllAndDestroyMock,
    }),
  },
}));

function setElectronAPI(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: overrides,
  });
}

beforeEach(() => {
  (window as any).isDebugWindow = false;
});

afterEach(() => {
  (window as any).isDebugWindow = false;
  closeAllAndDestroyMock.mockClear();
});

describe('App coverage – loading and readiness', () => {
  it('shows loading screen when isReady returns success:false', async () => {
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: false, data: false })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);
    // The loading screen should be visible until isAppReady becomes true
    expect(screen.getByText('Initializing Core Services...')).toBeInTheDocument();
  });

  it('shows loading screen when isReady returns success:true but data:false', async () => {
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: false })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);
    expect(screen.getByText('Initializing Core Services...')).toBeInTheDocument();
  });

  it('transitions to app when onAppReady callback fires with true', async () => {
    let capturedCallback: ((ready: boolean) => void) | null = null;
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: false })),
      onAppReady: vi.fn((cb: (ready: boolean) => void) => {
        capturedCallback = cb;
        return () => {};
      }),
    });

    render(<App />);
    expect(screen.getByText('Initializing Core Services...')).toBeInTheDocument();

    await act(async () => {
      capturedCallback!(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });
  });

  it('closes embedded browser state when the browser disable event is dispatched', async () => {
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: true })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('embedded-browser:disable'));
    });

    expect(closeAllAndDestroyMock).toHaveBeenCalledTimes(1);
  });

  it('transitions to app (fallback) when no electronAPI.isReady exists', async () => {
    setElectronAPI({
      // no isReady
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });
  });

  it('transitions to app (fail-open) when isReady throws', async () => {
    setElectronAPI({
      isReady: vi.fn(async () => { throw new Error('network error'); }),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });
  });

  it('works when electronAPI is entirely absent', async () => {
    setElectronAPI({}); // no isReady, no onAppReady

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });
  });
});

describe('App coverage – debug window branch', () => {
  it('renders debug mode UI when isDebugWindow is true from the start', async () => {
    (window as any).isDebugWindow = true;
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: true })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Debug Mode Unavailable')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('app-routes')).not.toBeInTheDocument();
  });

  it('transitions to debug UI when debugWindowReady event fires', async () => {
    (window as any).isDebugWindow = false;
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: true })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });

    await act(async () => {
      window.dispatchEvent(new Event('debugWindowReady'));
    });

    await waitFor(() => {
      expect(screen.getByText('Debug Mode Unavailable')).toBeInTheDocument();
    });
  });

  it('transitions to debug UI when isDebugWindow flag is set and interval fires', async () => {
    (window as any).isDebugWindow = false;
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: true })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });

    // Set the flag; the 100ms interval will pick it up
    (window as any).isDebugWindow = true;

    await waitFor(
      () => {
        expect(screen.getByText('Debug Mode Unavailable')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('stays in normal mode when isDebugWindow flag stays false past interval period', async () => {
    (window as any).isDebugWindow = false;
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: true })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    });

    // Wait for some interval ticks but flag is still false
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.getByTestId('app-routes')).toBeInTheDocument();
  });

  it('setTimeout clears the interval after 5 seconds (fake timers)', async () => {
    vi.useFakeTimers();
    (window as any).isDebugWindow = false;
    setElectronAPI({
      isReady: vi.fn(async () => ({ success: true, data: true })),
      onAppReady: vi.fn(() => () => {}),
    });

    render(<App />);

    // Flush promises so the readiness effect runs
    await act(async () => {
      await Promise.resolve();
    });

    // Advance to trigger the 5-second clearInterval
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    // App is still in normal mode (no debug flag)
    expect(screen.getByTestId('app-routes')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
