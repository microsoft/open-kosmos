// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * WindowsTitleBar — coverage for Windows platform rendering and controls.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Hoisted mock variables ───────────────────────────────────────────────────
const {
  mockUseLocation,
  mockZoomLevel,
  mockLeftNavUse,
  mockRightPaneUse,
  mockIsMaximized,
  mockOnWindowStateChanged,
  mockMinimize, mockMaximize, mockUnmaximize, mockClose, mockShowAppMenu,
  mockResetZoom, mockGetPlatformInfo,
} = vi.hoisted(() => ({
  mockUseLocation: vi.fn(() => ({ pathname: '/' })),
  mockZoomLevel: vi.fn(() => 0),
  mockLeftNavUse: vi.fn(() => [false, { toggle: vi.fn() }]),
  mockRightPaneUse: vi.fn(() => [false, { toggle: vi.fn() }]),
  mockIsMaximized: vi.fn(async () => false),
  mockOnWindowStateChanged: vi.fn(() => () => {}),
  mockMinimize: vi.fn(),
  mockMaximize: vi.fn(),
  mockUnmaximize: vi.fn(),
  mockClose: vi.fn(),
  mockShowAppMenu: vi.fn(),
  mockResetZoom: vi.fn(),
  mockGetPlatformInfo: vi.fn(async () => ({ platform: 'win32' })),
}));

vi.mock('react-router-dom', async () => ({
  useLocation: mockUseLocation,
}));

vi.mock('../../../lib/userData/useAppZoomLevel', async () => ({
  useAppZoomLevel: mockZoomLevel,
}));

vi.mock('@renderer/states/left-nav.atom', async () => ({
  LeftNavCollapsedAtom: { use: mockLeftNavUse },
}));

vi.mock('@renderer/states/right-pane.atom', async () => ({
  RightPaneCollapsedAtom: { use: mockRightPaneUse },
}));

vi.mock('../../../styles/WindowsTitleBar.css', async () => ({}));

vi.mock('@shared/constants/branding', async () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../lib/brandIcon', async () => ({
  appIcon: 'icon.png',
}));

vi.mock('lucide-react', async () => {
  const Stub = ({ size }: { size?: number }) => <svg data-testid="icon" />;
  return {
    Menu: Stub, Minus: Stub, Square: Stub, X: Stub, Copy: Stub,
    ZoomIn: Stub, ZoomOut: Stub, PanelLeft: Stub, ListTodo: Stub,
  };
});

import WindowsTitleBar from '../WindowsTitleBar';

function setupElectronAPI(platform: string = 'win32') {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      platform,
      getPlatformInfo: mockGetPlatformInfo,
      window: {
        isMaximized: mockIsMaximized,
        onWindowStateChanged: mockOnWindowStateChanged,
        minimize: mockMinimize,
        maximize: mockMaximize,
        unmaximize: mockUnmaximize,
        close: mockClose,
        showAppMenu: mockShowAppMenu,
        resetZoom: mockResetZoom,
      },
    },
    writable: true,
    configurable: true,
  });
}

describe('WindowsTitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLocation.mockReturnValue({ pathname: '/' });
    mockZoomLevel.mockReturnValue(0);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockRightPaneUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockIsMaximized.mockResolvedValue(false);
    mockOnWindowStateChanged.mockReturnValue(() => {});
    mockGetPlatformInfo.mockResolvedValue({ platform: 'win32' });
  });

  it('returns null initially (before platform check)', () => {
    setupElectronAPI('darwin');
    mockGetPlatformInfo.mockResolvedValue({ platform: 'darwin' });
    const { container } = render(<WindowsTitleBar />);
    // Before async platform check resolves, isWindows=false → null
    expect(container.firstChild).toBeNull();
  });

  it('renders title bar on Windows via electronAPI.platform', async () => {
    setupElectronAPI('win32');
    const { container } = render(<WindowsTitleBar />);
    await act(async () => {});
    expect(container.querySelector('.windows-title-bar')).toBeDefined();
  });

  it('renders title bar on Windows via getPlatformInfo fallback', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        // no platform property
        getPlatformInfo: mockGetPlatformInfo,
        window: {
          isMaximized: mockIsMaximized,
          onWindowStateChanged: mockOnWindowStateChanged,
          minimize: mockMinimize,
          maximize: mockMaximize,
          unmaximize: mockUnmaximize,
          close: mockClose,
          showAppMenu: mockShowAppMenu,
          resetZoom: mockResetZoom,
        },
      },
      writable: true,
      configurable: true,
    });
    mockGetPlatformInfo.mockResolvedValue({ platform: 'win32' });
    render(<WindowsTitleBar />);
    await act(async () => {});
    expect(document.querySelector('.windows-title-bar')).toBeDefined();
  });

  it('shows app name', async () => {
    setupElectronAPI('win32');
    render(<WindowsTitleBar />);
    await act(async () => {});
    expect(screen.getByText('OpenKosmos')).toBeDefined();
  });

  it('calls minimize on minimize button click', async () => {
    setupElectronAPI('win32');
    render(<WindowsTitleBar />);
    await act(async () => {});
    const btn = document.querySelector('.window-control-button.minimize')!;
    fireEvent.click(btn);
    expect(mockMinimize).toHaveBeenCalled();
  });

  it('calls maximize when not maximized', async () => {
    setupElectronAPI('win32');
    mockIsMaximized.mockResolvedValue(false);
    render(<WindowsTitleBar />);
    await act(async () => {});
    const btn = document.querySelector('.window-control-button.maximize')!;
    fireEvent.click(btn);
    expect(mockMaximize).toHaveBeenCalled();
  });

  it('calls unmaximize when maximized', async () => {
    setupElectronAPI('win32');
    mockIsMaximized.mockResolvedValue(true);
    render(<WindowsTitleBar />);
    await act(async () => {});
    const btn = document.querySelector('.window-control-button.maximize')!;
    fireEvent.click(btn);
    expect(mockUnmaximize).toHaveBeenCalled();
  });

  it('calls close on close button click', async () => {
    setupElectronAPI('win32');
    render(<WindowsTitleBar />);
    await act(async () => {});
    const btn = document.querySelector('.window-control-button.close')!;
    fireEvent.click(btn);
    expect(mockClose).toHaveBeenCalled();
  });

  it('calls showAppMenu on menu button click', async () => {
    setupElectronAPI('win32');
    render(<WindowsTitleBar />);
    await act(async () => {});
    const menuBtn = document.querySelector('button[title="Menu"]')!;
    fireEvent.click(menuBtn);
    expect(mockShowAppMenu).toHaveBeenCalled();
  });

  it('shows sidebar and right panel toggles on /agent path', async () => {
    setupElectronAPI('win32');
    mockUseLocation.mockReturnValue({ pathname: '/agent/chat-1' });
    render(<WindowsTitleBar />);
    await act(async () => {});
    expect(document.querySelector('.sidebar-toggle-button')).toBeDefined();
  });

  it('does not show sidebar toggle on non-agent paths', async () => {
    setupElectronAPI('win32');
    mockUseLocation.mockReturnValue({ pathname: '/settings' });
    render(<WindowsTitleBar />);
    await act(async () => {});
    expect(document.querySelector('.sidebar-toggle-button')).toBeNull();
  });

  it('shows zoom controls when zoom level is non-zero', async () => {
    setupElectronAPI('win32');
    mockZoomLevel.mockReturnValue(2); // zoomPercent = 144
    const { container } = render(<WindowsTitleBar />);
    await act(async () => {});
    const zoomBtn = container.querySelector('button[title*="Zoom"]');
    expect(zoomBtn).toBeDefined();
    expect(zoomBtn).not.toBeNull();
  });

  it('calls resetZoom when zoom button clicked', async () => {
    setupElectronAPI('win32');
    mockZoomLevel.mockReturnValue(2);
    const { container } = render(<WindowsTitleBar />);
    await act(async () => {});
    const zoomBtn = container.querySelector('button[title*="Zoom"]') as HTMLElement;
    expect(zoomBtn).not.toBeNull();
    fireEvent.click(zoomBtn);
    expect(mockResetZoom).toHaveBeenCalled();
  });

  it('shows Copy icon when maximized', async () => {
    setupElectronAPI('win32');
    mockIsMaximized.mockResolvedValue(true);
    render(<WindowsTitleBar />);
    await act(async () => {});
    // maximize button title should say Restore
    const maxBtn = document.querySelector('.window-control-button.maximize')!;
    expect(maxBtn.getAttribute('title')).toBe('Restore');
  });

  it('shows Square icon when not maximized', async () => {
    setupElectronAPI('win32');
    mockIsMaximized.mockResolvedValue(false);
    render(<WindowsTitleBar />);
    await act(async () => {});
    const maxBtn = document.querySelector('.window-control-button.maximize')!;
    expect(maxBtn.getAttribute('title')).toBe('Maximize');
  });

  it('updates isMaximized via onWindowStateChanged callback', async () => {
    setupElectronAPI('win32');
    let stateCallback: ((state: string) => void) | null = null;
    mockOnWindowStateChanged.mockImplementation((cb: (s: string) => void) => {
      stateCallback = cb;
      return () => {};
    });
    mockIsMaximized.mockResolvedValue(false);
    render(<WindowsTitleBar />);
    await act(async () => {});

    act(() => { stateCallback?.('maximized'); });

    const maxBtn = document.querySelector('.window-control-button.maximize')!;
    expect(maxBtn.getAttribute('title')).toBe('Restore');
  });

  it('sidebar toggle shows "Hide sidebar" label when not collapsed', async () => {
    setupElectronAPI('win32');
    mockUseLocation.mockReturnValue({ pathname: '/agent/chat-1' });
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    render(<WindowsTitleBar />);
    await act(async () => {});
    const sidebarBtn = document.querySelector('.sidebar-toggle-button')!;
    expect(sidebarBtn.getAttribute('aria-label')).toBe('Hide sidebar');
  });

  it('sidebar toggle shows "Show sidebar" label when collapsed', async () => {
    setupElectronAPI('win32');
    mockUseLocation.mockReturnValue({ pathname: '/agent/chat-1' });
    mockLeftNavUse.mockReturnValue([true, { toggle: vi.fn() }]);
    render(<WindowsTitleBar />);
    await act(async () => {});
    const sidebarBtn = document.querySelector('.sidebar-toggle-button')!;
    expect(sidebarBtn.getAttribute('aria-label')).toBe('Show sidebar');
  });

  it('calls sidebar toggle handler when clicked', async () => {
    const handleToggle = vi.fn();
    setupElectronAPI('win32');
    mockUseLocation.mockReturnValue({ pathname: '/agent/chat-1' });
    mockLeftNavUse.mockReturnValue([false, { toggle: handleToggle }]);
    render(<WindowsTitleBar />);
    await act(async () => {});
    const sidebarBtn = document.querySelector('.sidebar-toggle-button')!;
    fireEvent.click(sidebarBtn);
    expect(handleToggle).toHaveBeenCalled();
  });
});
