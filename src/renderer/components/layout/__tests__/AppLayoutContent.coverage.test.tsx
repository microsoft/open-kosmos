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
  mockRightPaneUse,
  mockIsMinimalMode,
} = vi.hoisted(() => ({
  mockLeftNavUse: vi.fn(() => [false, { toggle: vi.fn() }]),
  mockLeftNavSizeData: vi.fn(() => ({ width: 288, resizing: false })),
  mockRightPaneUse: vi.fn(() => [false, { toggle: vi.fn() }]),
  mockIsMinimalMode: vi.fn(() => false),
}));

vi.mock('@/states/left-nav.atom', () => ({
  LeftNavCollapsedAtom: { use: mockLeftNavUse },
  LeftNavSizeAtom: { useData: mockLeftNavSizeData },
}));

vi.mock('@/states/right-pane.atom', () => ({
  RightPaneCollapsedAtom: { use: mockRightPaneUse },
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

vi.mock('../../ui/RightResizableDivider', () => ({
  default: () => <div data-testid="right-resizable-divider" />,
}));

vi.mock('../RightGlobalSidepane', () => ({
  RightGlobalSidepane: () => <div data-testid="right-sidepane" />,
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

vi.mock('../../msalAuth/MsalAuthProgressOverlay', () => ({
  default: () => <div data-testid="msal-overlay" />,
  MsalAuthConsentDialog: () => <div data-testid="msal-consent" />,
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

import { AppLayoutContent } from '../AppLayoutContent';

const defaultProps = {
  handleFileTreeNodeInstallSkill: vi.fn(),
  handleFileTreeNodeMoveToKnowledge: vi.fn(),
  currentKnowledgeBasePath: '/knowledge',
};

function setupElectronAPI(platform = 'win32') {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      platform,
      getPlatformInfo: vi.fn().mockResolvedValue({ platform, arch: 'x64' }),
      window: {
        isFullScreen: vi.fn().mockResolvedValue(false),
        onFullScreenChanged: vi.fn().mockReturnValue(() => {}),
        onZoomChanged: vi.fn().mockReturnValue(() => {}),
        getZoomLevel: vi.fn().mockResolvedValue(0),
        setAlwaysOnTop: vi.fn().mockResolvedValue(true),
      },
    },
  });
}

describe('AppLayoutContent - non-minimal, non-mac', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMinimalMode.mockReturnValue(false);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockRightPaneUse.mockReturnValue([false, { toggle: vi.fn() }]);
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
});

describe('AppLayoutContent - minimal mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMinimalMode.mockReturnValue(true);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockRightPaneUse.mockReturnValue([false, { toggle: vi.fn() }]);
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
});

describe('AppLayoutContent - macOS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMinimalMode.mockReturnValue(false);
    mockLeftNavUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockRightPaneUse.mockReturnValue([false, { toggle: vi.fn() }]);
    mockLeftNavSizeData.mockReturnValue({ width: 288, resizing: false });
    setupElectronAPI('darwin');
  });

  it('renders mac titlebar buttons on macOS', async () => {
    render(<AppLayoutContent {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Hide sidebar/i)).toBeInTheDocument();
    });
  });
});
