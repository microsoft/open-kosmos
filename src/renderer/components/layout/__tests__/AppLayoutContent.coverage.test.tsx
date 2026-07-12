/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AppLayoutContent.tsx
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockLeftNavUse,
  mockLeftNavSizeData,
  mockIsMinimalMode,
} = vi.hoisted(() => ({
  mockLeftNavUse: vi.fn(() => [false, { toggle: vi.fn() }]),
  mockLeftNavSizeData: vi.fn(() => ({ width: 288, resizing: false })),
  mockIsMinimalMode: vi.fn(() => false),
}));

vi.mock('@/states/left-nav.atom', () => ({
  LeftNavCollapsedAtom: { use: mockLeftNavUse },
  LeftNavSizeAtom: { useData: mockLeftNavSizeData },
}));

vi.mock('../LayoutProvider', () => ({
  useLayout: () => ({ isMinimalMode: mockIsMinimalMode() }),
}));

vi.mock('../LeftNavigation', () => ({
  default: () => <div data-testid="left-nav" />,
}));

vi.mock('../ContentContainer', () => ({
  default: ({ sidebarVisible }: any) => <div data-testid="content-container" data-sidebar={String(sidebarVisible)} />,
}));

vi.mock('../../ui/ResizableDivider', () => ({
  default: () => <div data-testid="resizable-divider" />,
}));

vi.mock('../../ui/OverlayImageViewer', () => ({
  OverlayImageViewer: () => <div data-testid="overlay-image-viewer" />,
}));

vi.mock('../../ui/OverlayFileViewer', () => ({
  OverlayFileViewer: () => <div data-testid="overlay-file-viewer" />,
}));

vi.mock('../../skills/ApplySkillToAgentsDialog', () => ({
  default: () => <div data-testid="apply-skill-dialog" />,
}));

vi.mock('../../menu', () => ({
  AgentDropdownMenu: () => <div data-testid="agent-dropdown" />,
  WorkspaceMenuDropdown: () => <div data-testid="workspace-dropdown" />,
  EditAgentMenuDropdown: () => <div data-testid="edit-agent-dropdown" />,
  AttachMenuDropdown: () => <div data-testid="attach-dropdown" />,
  ChatSessionDropdownMenu: () => <div data-testid="chat-session-dropdown" />,
  FileTreeNodeContextMenu: () => <div data-testid="file-tree-context-menu" />,
  ImageGalleryContextMenu: () => <div data-testid="image-gallery-context-menu" />,
  TagFilterDropdown: () => <div data-testid="tag-filter-dropdown" />,
}));

vi.mock('../../buddy', () => ({
  default: () => <div data-testid="buddy" />,
}));

vi.mock('../UserMenu', () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock('../../overlay/DeleteOverlay', () => ({
  DeleteOverlay: () => <div data-testid="delete-overlay" />,
}));

vi.mock('../../overlay/ArchiveOverlay', () => ({
  ArchiveOverlay: () => <div data-testid="archive-overlay" />,
}));

vi.mock('../../overlay/DuplicateAgentOverlay', () => ({
  DuplicateAgentOverlay: () => <div data-testid="duplicate-overlay" />,
}));

vi.mock('../../overlay/RenameChatSessionOverlay', () => ({
  RenameChatSessionOverlay: () => <div data-testid="rename-overlay" />,
}));

vi.mock('lucide-react', () => ({
  PanelLeft: (props: any) => <span data-testid="icon-PanelLeft" />,
  ListTodo: (props: any) => <span data-testid="icon-ListTodo" />,
}));

const { mockBrandName } = vi.hoisted(() => ({
  mockBrandName: { value: 'openkosmos' },
}));

vi.mock('@shared/constants/branding', () => ({
  get BRAND_NAME() { return mockBrandName.value; },
}));

import { AppLayoutContent } from '../AppLayoutContent';

const defaultProps = {
  handleFileTreeNodeInstallSkill: vi.fn(),
  handleFileTreeNodeMoveToKnowledge: vi.fn(),
  currentKnowledgeBasePath: '/knowledge',
};

function setupElectronAPI(platform = 'win32', opts: any = {}) {
  const fullScreenCb: any[] = [];
  const zoomCb: any[] = [];
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      platform,
      getPlatformInfo: vi.fn().mockResolvedValue({ platform, arch: 'x64' }),
      window: {
        isFullScreen: vi.fn().mockResolvedValue(opts.fullScreen ?? false),
        onFullScreenChanged: vi.fn((cb: any) => { fullScreenCb.push(cb); return () => {}; }),
        onZoomChanged: vi.fn((cb: any) => { zoomCb.push(cb); return () => {}; }),
        getZoomLevel: vi.fn().mockResolvedValue(opts.zoomLevel ?? 0),
        setAlwaysOnTop: vi.fn().mockResolvedValue(true),
      },
      _fullScreenCb: fullScreenCb,
      _zoomCb: zoomCb,
    },
  });
}

describe('AppLayoutContent - non-minimal, non-mac', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMinimalMode.mockReturnValue(false);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockLeftNavSizeData.mockReturnValue({ width: 288, resizing: false });
    setupElectronAPI('win32');
  });

  it('renders the content container', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.getByTestId('content-container')).toBeInTheDocument();
  });

  it('renders buddy', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.getByTestId('buddy')).toBeInTheDocument();
  });

  it('renders resizable divider when sidebar visible', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.getByTestId('resizable-divider')).toBeInTheDocument();
  });

  it('renders left nav in non-minimal mode', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.getByTestId('left-nav')).toBeInTheDocument();
  });

  it('renders user menu in non-minimal mode', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.getByTestId('user-menu')).toBeInTheDocument();
  });

  it('does NOT render mac titlebar on non-mac', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.queryByLabelText(/Show sidebar|Hide sidebar/i)).not.toBeInTheDocument();
  });

  it('applies left-panel-collapsed class when left panel collapsed', () => {
    mockLeftNavUse.mockReturnValue([true, { toggle: vi.fn() }]);
    const { container } = render(<AppLayoutContent {...defaultProps} />);
    expect(container.querySelector('.app-layout.left-panel-collapsed')).toBeInTheDocument();
  });

  it('does not render resizable divider when left panel collapsed', () => {
    mockLeftNavUse.mockReturnValue([true, { toggle: vi.fn() }]);
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.queryByTestId('resizable-divider')).not.toBeInTheDocument();
  });

  it('sets transition unset when resizing', () => {
    mockLeftNavSizeData.mockReturnValue({ width: 300, resizing: true });
    const { container } = render(<AppLayoutContent {...defaultProps} />);
    const wrapper = container.querySelector('.left-navigation-wrapper');
    expect(wrapper).toHaveStyle({ transition: 'unset' });
  });
});

describe('AppLayoutContent - minimal mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMinimalMode.mockReturnValue(true);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockLeftNavSizeData.mockReturnValue({ width: 288, resizing: false });
    setupElectronAPI('win32');
  });

  it('does not render left nav in minimal mode', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.queryByTestId('left-nav')).not.toBeInTheDocument();
  });

  it('does not render user menu in minimal mode', () => {
    render(<AppLayoutContent {...defaultProps} />);
    expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument();
  });

  it('applies minimal-mode class', () => {
    const { container } = render(<AppLayoutContent {...defaultProps} />);
    expect(container.querySelector('.app-layout.minimal-mode')).toBeInTheDocument();
  });
});

describe('AppLayoutContent - macOS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMinimalMode.mockReturnValue(false);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockLeftNavSizeData.mockReturnValue({ width: 288, resizing: false });
    setupElectronAPI('darwin');
  });

  it('renders mac titlebar buttons on macOS (direct platform detection)', async () => {
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Hide sidebar/i)).toBeInTheDocument();
    });
  });

  it('adds macos-layout class when isMac', async () => {
    const { container } = render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(container.querySelector('.app-layout.macos-layout')).toBeInTheDocument();
    });
  });

  it('shows "Show sidebar" when left panel is collapsed on mac', async () => {
    mockLeftNavUse.mockReturnValue([true, { toggle: vi.fn() }]);
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Show sidebar')).toBeInTheDocument();
      expect(screen.getByTitle('Show Sidebar')).toBeInTheDocument();
    });
  });

  it('handles fullscreen state change on macOS', async () => {
    setupElectronAPI('darwin', { fullScreen: true });
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(document.documentElement.classList.contains('mac-fullscreen')).toBe(true);
    });
  });

  it('handles fullscreen callback on macOS', async () => {
    setupElectronAPI('darwin', { fullScreen: false });
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Hide sidebar/i)).toBeInTheDocument();
    });
    // Trigger fullscreen change callback
    act(() => {
      const api = (window as any).electronAPI;
      api._fullScreenCb.forEach((cb: any) => cb(true));
    });
    await waitFor(() => {
      expect(document.documentElement.classList.contains('mac-fullscreen')).toBe(true);
    });
  });

  it('handles zoom level on macOS', async () => {
    setupElectronAPI('darwin', { zoomLevel: 2 });
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      const factor = document.documentElement.style.getPropertyValue('--mac-zoom-factor');
      expect(factor).toBe(String(Math.pow(1.2, 2)));
    });
  });

  it('handles zoom change callback on macOS', async () => {
    setupElectronAPI('darwin', { zoomLevel: 0 });
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Hide sidebar/i)).toBeInTheDocument();
    });
    act(() => {
      const api = (window as any).electronAPI;
      api._zoomCb.forEach((cb: any) => cb(3));
    });
    await waitFor(() => {
      const factor = document.documentElement.style.getPropertyValue('--mac-zoom-factor');
      expect(factor).toBe(String(Math.pow(1.2, 3)));
    });
  });

  it('does not show mac titlebar in minimal mode on macOS', async () => {
    mockIsMinimalMode.mockReturnValue(true);
    render(<AppLayoutContent {...defaultProps} />);
    // Wait a tick for useEffect
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.queryByLabelText(/Show sidebar|Hide sidebar/i)).not.toBeInTheDocument();
  });
});

describe('AppLayoutContent - macOS fallback platform detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMinimalMode.mockReturnValue(false);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockLeftNavSizeData.mockReturnValue({ width: 288, resizing: false });
  });

  it('detects macOS via getPlatformInfo fallback when platform prop is missing', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        platform: undefined,
        getPlatformInfo: vi.fn().mockResolvedValue({ platform: 'darwin', arch: 'x64' }),
        window: {
          isFullScreen: vi.fn().mockResolvedValue(false),
          onFullScreenChanged: vi.fn().mockReturnValue(() => {}),
          onZoomChanged: vi.fn().mockReturnValue(() => {}),
          getZoomLevel: vi.fn().mockResolvedValue(0),
        },
      },
    });
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Hide sidebar/i)).toBeInTheDocument();
    });
  });

  it('handles getPlatformInfo rejection gracefully', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        platform: undefined,
        getPlatformInfo: vi.fn().mockRejectedValue(new Error('fail')),
        window: {
          isFullScreen: vi.fn().mockResolvedValue(false),
          onFullScreenChanged: vi.fn().mockReturnValue(() => {}),
          onZoomChanged: vi.fn().mockReturnValue(() => {}),
          getZoomLevel: vi.fn().mockResolvedValue(0),
        },
      },
    });
    render(<AppLayoutContent {...defaultProps} />);
    // Should not crash, remain non-mac
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.queryByLabelText(/Show sidebar|Hide sidebar/i)).not.toBeInTheDocument();
  });
});
