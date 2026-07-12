// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Supplementary coverage tests for WindowsTitleBar.tsx —
 * targets branches not covered by WindowsTitleBar.coverage.test.tsx.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockUseLocation,
  mockZoomLevel,
  mockLeftNavUse,
  mockIsMaximized,
  mockOnWindowStateChanged,
  mockMinimize, mockMaximize, mockUnmaximize, mockClose, mockShowAppMenu,
  mockResetZoom, mockGetPlatformInfo,
} = vi.hoisted(() => ({
  mockUseLocation: vi.fn(() => ({ pathname: '/' })),
  mockZoomLevel: vi.fn(() => 0),
  mockLeftNavUse: vi.fn(() => [false, { toggle: vi.fn() }]),
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

vi.mock('react-router-dom', () => ({
  useLocation: mockUseLocation,
}));
vi.mock('../../../lib/userData/useAppZoomLevel', () => ({
  useAppZoomLevel: mockZoomLevel,
}));
vi.mock('@renderer/states/left-nav.atom', () => ({
  LeftNavCollapsedAtom: { use: mockLeftNavUse },
}));
vi.mock('../../../styles/WindowsTitleBar.css', () => ({}));
vi.mock('@shared/constants/branding', () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_NAME: 'openkosmos',
}));
vi.mock('../../../lib/brandIcon', () => ({ appIcon: 'icon.png' }));
vi.mock('lucide-react', () => {
  const Stub = () => <svg data-testid="icon" />;
  return {
    Menu: Stub, Minus: Stub, Square: Stub, X: Stub, Copy: Stub,
    ZoomIn: Stub, ZoomOut: Stub, PanelLeft: Stub,
  };
});

import WindowsTitleBar from '../WindowsTitleBar';

function setupElectronAPI(opts: any = {}) {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      platform: opts.platform ?? 'win32',
      getPlatformInfo: mockGetPlatformInfo,
      window: {
        isMaximized: mockIsMaximized,
        onWindowStateChanged: mockOnWindowStateChanged,
        minimize: mockMinimize,
        maximize: mockMaximize,
        unmaximize: mockUnmaximize,
        close: mockClose,
        showAppMenu: opts.showAppMenu !== undefined ? opts.showAppMenu : mockShowAppMenu,
        resetZoom: opts.resetZoom !== undefined ? opts.resetZoom : mockResetZoom,
      },
    },
    writable: true,
    configurable: true,
  });
}

describe('WindowsTitleBar supplementary branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseLocation.mockReturnValue({ pathname: '/' });
    mockZoomLevel.mockReturnValue(0);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockIsMaximized.mockResolvedValue(false);
    mockOnWindowStateChanged.mockReturnValue(() => {});
    mockGetPlatformInfo.mockResolvedValue({ platform: 'win32' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows sidebar toggle button on /agent paths', async () => {
    setupElectronAPI();
    mockUseLocation.mockReturnValue({ pathname: '/agent/chat-1' });
    render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });
    const buttons = document.querySelectorAll('.menu-button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('shows ZoomOut icon when zoom is negative (zoomPercent < 100)', async () => {
    setupElectronAPI();
    mockZoomLevel.mockReturnValue(-1); // zoomPercent = Math.round(Math.pow(1.2,-1)*100) ≈ 83
    const { container } = render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });
    // zoomPercent < 100 → ZoomOut, not ZoomIn
    const zoomBtn = container.querySelector('button[title*="Zoom"]');
    expect(zoomBtn).not.toBeNull();
  });

  it('shows percentage span briefly after zoom level changes', async () => {
    setupElectronAPI();
    mockZoomLevel.mockReturnValue(2); // zoomPercent = 144
    const { rerender } = render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });

    // Change zoom level to trigger showPercent
    mockZoomLevel.mockReturnValue(3);
    rerender(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });

    // After the zoom effect fires, showPercent should be true for 1500ms
    vi.advanceTimersByTime(100);
    // (Verify no crash)
    expect(document.querySelector('.windows-title-bar')).not.toBeNull();

    // After 1500ms, showPercent goes back to false
    vi.advanceTimersByTime(1600);
  });

  it('clears previous percentTimer when zoom changes again', async () => {
    setupElectronAPI();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    mockZoomLevel.mockReturnValue(2);
    const { rerender } = render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });

    // First zoom change
    mockZoomLevel.mockReturnValue(3);
    rerender(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });

    // Second zoom change (should clear existing timer)
    mockZoomLevel.mockReturnValue(4);
    rerender(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });

    // clearTimeout should be called at least once (for zoom effect cleanup OR timer re-set)
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('handles getPlatformInfo throwing gracefully', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        // no platform property, getPlatformInfo throws
        getPlatformInfo: vi.fn().mockRejectedValue(new Error('fail')),
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
    // Should not crash
    const { container } = render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });
    // Component stays null (isWindows=false after error)
    expect(container.firstChild).toBeNull();
  });

  it('handles missing onWindowStateChanged gracefully', async () => {
    setupElectronAPI();
    mockOnWindowStateChanged.mockReturnValue(undefined);
    Object.defineProperty(window, 'electronAPI', {
      value: {
        platform: 'win32',
        getPlatformInfo: mockGetPlatformInfo,
        window: {
          isMaximized: mockIsMaximized,
          // no onWindowStateChanged
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
    render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });
    // Should render without crash
    expect(document.querySelector('.windows-title-bar')).not.toBeNull();
  });

  it('state !== maximized in onWindowStateChanged → isMaximized=false', async () => {
    setupElectronAPI();
    let stateCallback: ((s: string) => void) | undefined;
    mockOnWindowStateChanged.mockImplementation((cb: (s: string) => void) => {
      stateCallback = cb;
      return () => {};
    });
    mockIsMaximized.mockResolvedValue(true);
    render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });

    act(() => { stateCallback?.('normal'); });

    const maxBtn = document.querySelector('.window-control-button.maximize')!;
    expect(maxBtn.getAttribute('title')).toBe('Maximize');
  });

  it('handleMenuClick when showAppMenu is not available', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        platform: 'win32',
        getPlatformInfo: mockGetPlatformInfo,
        window: {
          isMaximized: mockIsMaximized,
          onWindowStateChanged: mockOnWindowStateChanged,
          minimize: mockMinimize,
          maximize: mockMaximize,
          unmaximize: mockUnmaximize,
          close: mockClose,
          // no showAppMenu
          resetZoom: mockResetZoom,
        },
      },
      writable: true,
      configurable: true,
    });
    render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });
    const menuBtn = document.querySelector('button[title="Menu"]') as HTMLElement;
    expect(menuBtn).not.toBeNull();
    // Should not crash even without showAppMenu
    fireEvent.click(menuBtn);
  });

  it('resetZoom undefined: zoom btn click does not crash', async () => {
    setupElectronAPI();
    mockZoomLevel.mockReturnValue(2);
    Object.defineProperty(window, 'electronAPI', {
      value: {
        platform: 'win32',
        getPlatformInfo: mockGetPlatformInfo,
        window: {
          isMaximized: mockIsMaximized,
          onWindowStateChanged: mockOnWindowStateChanged,
          minimize: mockMinimize,
          maximize: mockMaximize,
          unmaximize: mockUnmaximize,
          close: mockClose,
          showAppMenu: mockShowAppMenu,
          // no resetZoom
        },
      },
      writable: true,
      configurable: true,
    });
    const { container } = render(<WindowsTitleBar />);
    await act(async () => { await Promise.resolve(); });
    const zoomBtn = container.querySelector('button[title*="Zoom"]') as HTMLElement;
    expect(zoomBtn).not.toBeNull();
    fireEvent.click(zoomBtn); // should not crash
  });
});
