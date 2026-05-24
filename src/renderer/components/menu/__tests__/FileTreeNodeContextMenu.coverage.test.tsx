// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * FileTreeNodeContextMenu — additional coverage
 *
 * Covers branches not reached by existing tests:
 * - node.type === 'directory': "Open in Finder/File Explorer/File Manager" menu item
 * - platform win32: "Reveal in File Explorer", "Open in File Explorer"
 * - platform linux: "Reveal in File Manager", "Open in File Manager"
 * - handleOpen: success, failure (result.success=false), no API, exception
 * - handleShowInFolder: success, failure, no API, exception
 * - handleDelete: not confirmed → close, no API, delete fails (result.results[0].error), result.success=false no results, exception
 * - handleDelete: success calls onRemove
 * - handleCopyPath: clipboard writeText called, exception path
 * - Move to Knowledge: onMoveToKnowledge called, workspacePath === knowledgeBasePath hides item
 * - Install skill: onInstallSkill called
 * - Default export returns null when isOpen=false
 */

import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { WithStore } from '@/atom';

// ── Dropdown position ─────────────────────────────────────────────────────────
vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  clampMenuToViewport: vi.fn(),
  getContextMenuPosition: vi.fn().mockReturnValue({ top: 5, left: 5 }),
  CONTEXT_MENU_SIZE_PRESETS: { fileTreeNodeMenu: { estimatedWidth: 200, estimatedHeight: 200 } },
}));

// ── workspaceOps ──────────────────────────────────────────────────────────────
vi.mock('@renderer/lib/chat/workspaceOps', () => ({
  workspaceOps: {
    clearFileTreeCache: vi.fn().mockResolvedValue(undefined),
    triggerRefresh: vi.fn(),
  },
}));

// ── use-click-out ─────────────────────────────────────────────────────────────
vi.mock('../../ui/use-click-out', () => ({ useClickOut: vi.fn() }));

// ── CurrentSessionStatus ──────────────────────────────────────────────────────
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  CurrentSessionStatus: {
    use: () => ({ chatStatus: 'idle' }),
  },
}));

// ── shouldShowMoveToKnowledgeBaseOption ───────────────────────────────────────
const mockShouldShowMove = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../../lib/chat/moveToKnowledgeBase', () => ({
  shouldShowMoveToKnowledgeBaseOption: (...args: any[]) => mockShouldShowMove(...args),
}));

// ── logger ────────────────────────────────────────────────────────────────────
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

// ── Lucide icons ──────────────────────────────────────────────────────────────
vi.mock('lucide-react', () => ({
  FolderOpen:        (p: any) => <span {...p}>FolderOpen</span>,
  ExternalLink:      (p: any) => <span {...p}>ExternalLink</span>,
  Trash2:            (p: any) => <span {...p}>Trash2</span>,
  Copy:              (p: any) => <span {...p}>Copy</span>,
  Download:          (p: any) => <span {...p}>Download</span>,
  ArrowRightToLine:  (p: any) => <span {...p}>ArrowRightToLine</span>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildElectronAPI(overrides: any = {}) {
  return {
    platform: 'darwin',
    workspace: {
      openPath:     vi.fn().mockResolvedValue({ success: true }),
      showInFolder: vi.fn().mockResolvedValue({ success: true }),
    },
    fs: {
      deletePaths: vi.fn().mockResolvedValue({ success: true }),
    },
    ...overrides,
  };
}

async function renderMenu(node: any, opts: {
  workspacePath?: string;
  knowledgeBasePath?: string;
  onMoveToKnowledge?: (p: string) => void;
  onInstallSkill?: (p: string) => void;
  electronOverrides?: any;
} = {}) {
  const { default: FileTreeNodeContextMenu, FileTreeNodeMenuAtom } = await import('../FileTreeNodeContextMenu');

  const workspacePath = opts.workspacePath ?? '/ws';

  Object.defineProperty(window, 'electronAPI', {
    writable: true, configurable: true,
    value: buildElectronAPI(opts.electronOverrides ?? {}),
  });
  Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(window, 'alert',   { writable: true, configurable: true, value: vi.fn() });
  Object.defineProperty(global.navigator, 'clipboard', {
    writable: true, configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });

  const Wrapper = () => {
    const actions = FileTreeNodeMenuAtom.useChange();
    React.useEffect(() => {
      actions.open(0, 0, node, workspacePath);
    }, []);
    return (
      <FileTreeNodeContextMenu
        knowledgeBasePath={opts.knowledgeBasePath ?? '/ws/knowledge'}
        onMoveToKnowledge={opts.onMoveToKnowledge}
        onInstallSkill={opts.onInstallSkill}
      />
    );
  };

  return render(<WithStore><Wrapper /></WithStore>);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockShouldShowMove.mockReturnValue(true);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FileTreeNodeContextMenu — coverage', () => {
  it('default export returns null when not open', async () => {
    const { default: FileTreeNodeContextMenu } = await import('../FileTreeNodeContextMenu');
    const { container } = render(<WithStore><FileTreeNodeContextMenu /></WithStore>);
    expect(container.firstChild).toBeNull();
  });

  // ── Platform labels ──────────────────────────────────────────────────────

  it('mac + file: shows "Open with Default App" and "Reveal in Finder"', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' });
    expect(screen.getByText('Open with Default App')).toBeInTheDocument();
    expect(screen.getByText('Reveal in Finder')).toBeInTheDocument();
  });

  it('win32 + file: shows "Reveal in File Explorer"', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: { platform: 'win32', workspace: { openPath: vi.fn().mockResolvedValue({ success: true }), showInFolder: vi.fn().mockResolvedValue({ success: true }) }, fs: { deletePaths: vi.fn().mockResolvedValue({ success: true }) } },
    });
    expect(screen.getByText('Reveal in File Explorer')).toBeInTheDocument();
    expect(screen.getByText('Open with Default App')).toBeInTheDocument();
  });

  it('linux + file: shows "Reveal in File Manager"', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: { platform: 'linux', workspace: { openPath: vi.fn().mockResolvedValue({ success: true }), showInFolder: vi.fn().mockResolvedValue({ success: true }) }, fs: { deletePaths: vi.fn().mockResolvedValue({ success: true }) } },
    });
    expect(screen.getByText('Reveal in File Manager')).toBeInTheDocument();
  });

  it('mac + directory: shows "Open in Finder"', async () => {
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' });
    expect(screen.getByText('Open in Finder')).toBeInTheDocument();
  });

  it('win32 + directory: shows "Open in File Explorer"', async () => {
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' }, {
      electronOverrides: { platform: 'win32', workspace: { openPath: vi.fn().mockResolvedValue({ success: true }), showInFolder: vi.fn().mockResolvedValue({ success: true }) }, fs: { deletePaths: vi.fn().mockResolvedValue({ success: true }) } },
    });
    expect(screen.getByText('Open in File Explorer')).toBeInTheDocument();
  });

  it('linux + directory: shows "Open in File Manager"', async () => {
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' }, {
      electronOverrides: { platform: 'linux', workspace: { openPath: vi.fn().mockResolvedValue({ success: true }), showInFolder: vi.fn().mockResolvedValue({ success: true }) }, fs: { deletePaths: vi.fn().mockResolvedValue({ success: true }) } },
    });
    expect(screen.getByText('Open in File Manager')).toBeInTheDocument();
  });

  // ── handleOpen ───────────────────────────────────────────────────────────

  it('Open with Default App calls openPath and closes', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' });
    await act(async () => {
      fireEvent.click(screen.getByText('Open with Default App').closest('button')!);
    });
    expect((window as any).electronAPI.workspace.openPath).toHaveBeenCalledWith('/ws/a.txt');
  });

  it('handleOpen: result.success=false logs error but does not throw', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: {
        platform: 'darwin',
        workspace: { openPath: vi.fn().mockResolvedValue({ success: false, error: 'not found' }), showInFolder: vi.fn().mockResolvedValue({ success: true }) },
        fs: { deletePaths: vi.fn() },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Open with Default App').closest('button')!);
    });
    // No throw — just logged
  });

  it('handleOpen: no electronAPI.workspace.openPath returns without error', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: { platform: 'darwin', workspace: { showInFolder: vi.fn().mockResolvedValue({ success: true }) }, fs: { deletePaths: vi.fn() } },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Open with Default App').closest('button')!);
    });
    // No error
  });

  it('handleOpen: exception is caught silently', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: {
        platform: 'darwin',
        workspace: { openPath: vi.fn().mockRejectedValue(new Error('crash')), showInFolder: vi.fn().mockResolvedValue({ success: true }) },
        fs: { deletePaths: vi.fn() },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Open with Default App').closest('button')!);
    });
  });

  // ── handleShowInFolder (directory "open" + file "reveal") ────────────────

  it('directory "Open in Finder" calls showInFolder', async () => {
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' });
    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder').closest('button')!);
    });
    expect((window as any).electronAPI.workspace.showInFolder).toHaveBeenCalledWith('/ws/mydir');
  });

  it('handleShowInFolder: result.success=false logs error', async () => {
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' }, {
      electronOverrides: {
        platform: 'darwin',
        workspace: { openPath: vi.fn().mockResolvedValue({ success: true }), showInFolder: vi.fn().mockResolvedValue({ success: false, error: 'denied' }) },
        fs: { deletePaths: vi.fn() },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder').closest('button')!);
    });
  });

  it('handleShowInFolder: no API returns without error', async () => {
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' }, {
      electronOverrides: { platform: 'darwin', workspace: { openPath: vi.fn().mockResolvedValue({ success: true }) }, fs: { deletePaths: vi.fn() } },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder').closest('button')!);
    });
  });

  it('handleShowInFolder: exception is caught', async () => {
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' }, {
      electronOverrides: {
        platform: 'darwin',
        workspace: { openPath: vi.fn().mockResolvedValue({ success: true }), showInFolder: vi.fn().mockRejectedValue(new Error('err')) },
        fs: { deletePaths: vi.fn() },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder').closest('button')!);
    });
  });

  // ── handleDelete ─────────────────────────────────────────────────────────

  it('handleDelete: user cancels → no delete called', async () => {
    const node = { type: 'file', name: 'a.txt', path: '/ws/a.txt' };
    await renderMenu(node);
    // Override confirm AFTER render so the component picks up the new value
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: vi.fn(() => false) });
    await act(async () => {
      fireEvent.click(screen.getByText('Delete').closest('button')!);
    });
    expect((window as any).electronAPI.fs.deletePaths).not.toHaveBeenCalled();
  });

  it('handleDelete: no deletePaths API shows alert', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: { platform: 'darwin', workspace: { openPath: vi.fn(), showInFolder: vi.fn() }, fs: {} },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Delete').closest('button')!);
    });
    expect((window as any).alert).toHaveBeenCalledWith(expect.stringContaining('Delete API not available'));
  });

  it('handleDelete: success calls onRemove (triggerRefresh)', async () => {
    const { workspaceOps } = await import('@renderer/lib/chat/workspaceOps');
    await renderMenu({ type: 'directory', name: 'mydir', path: '/ws/mydir' });
    await act(async () => {
      fireEvent.click(screen.getByText('Delete').closest('button')!);
    });
    expect(workspaceOps.triggerRefresh).toHaveBeenCalled();
  });

  it('handleDelete: result.success=false with results[0].error shows that error in alert', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: {
        platform: 'darwin',
        workspace: { openPath: vi.fn(), showInFolder: vi.fn() },
        fs: { deletePaths: vi.fn().mockResolvedValue({ success: false, results: [{ success: false, error: 'permission denied' }] }) },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Delete').closest('button')!);
    });
    expect((window as any).alert).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });

  it('handleDelete: result.success=false with no results uses result.error', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: {
        platform: 'darwin',
        workspace: { openPath: vi.fn(), showInFolder: vi.fn() },
        fs: { deletePaths: vi.fn().mockResolvedValue({ success: false, error: 'generic fail' }) },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Delete').closest('button')!);
    });
    expect((window as any).alert).toHaveBeenCalledWith(expect.stringContaining('generic fail'));
  });

  it('handleDelete: exception shows alert', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' }, {
      electronOverrides: {
        platform: 'darwin',
        workspace: { openPath: vi.fn(), showInFolder: vi.fn() },
        fs: { deletePaths: vi.fn().mockRejectedValue(new Error('io fail')) },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Delete').closest('button')!);
    });
    expect((window as any).alert).toHaveBeenCalledWith(expect.stringContaining('io fail'));
  });

  it('handleDelete: node has no name — falls back to path last segment', async () => {
    await renderMenu({ type: 'file', path: '/ws/a.txt' });
    await act(async () => {
      fireEvent.click(screen.getByText('Delete').closest('button')!);
    });
    // Confirm is called (default vi.fn returns true) so deletePaths called
    expect((window as any).electronAPI.fs.deletePaths).toHaveBeenCalled();
  });

  // ── handleCopyPath ────────────────────────────────────────────────────────

  it('Copy Path calls clipboard.writeText', async () => {
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy Path').closest('button')!);
    });
    expect((navigator.clipboard as any).writeText).toHaveBeenCalledWith('/ws/a.txt');
  });

  it('Copy Path: clipboard exception is caught silently', async () => {
    Object.defineProperty(global.navigator, 'clipboard', {
      writable: true, configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('no clipboard')) },
    });
    await renderMenu({ type: 'file', name: 'a.txt', path: '/ws/a.txt' });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy Path').closest('button')!);
    });
  });

  // ── Move to Knowledge ─────────────────────────────────────────────────────

  it('Move to Knowledge: clicking calls onMoveToKnowledge with fullPath', async () => {
    const onMoveToKnowledge = vi.fn();
    await renderMenu({ type: 'file', name: 'doc.md', path: '/ws/output/doc.md' }, {
      workspacePath: '/ws',
      knowledgeBasePath: '/ws/knowledge',
      onMoveToKnowledge,
    });
    fireEvent.click(screen.getByText('Move to Agent Knowledge').closest('button')!);
    expect(onMoveToKnowledge).toHaveBeenCalledWith('/ws/output/doc.md');
  });

  it('Move to Knowledge: hidden when workspacePath === knowledgeBasePath', async () => {
    await renderMenu({ type: 'file', name: 'doc.md', path: '/ws/knowledge/doc.md' }, {
      workspacePath: '/ws/knowledge',
      knowledgeBasePath: '/ws/knowledge',
      onMoveToKnowledge: vi.fn(),
    });
    expect(screen.queryByText('Move to Agent Knowledge')).toBeNull();
  });

  it('Move to Knowledge: hidden when shouldShowMoveToKnowledgeBaseOption returns false', async () => {
    mockShouldShowMove.mockReturnValue(false);
    await renderMenu({ type: 'file', name: 'doc.md', path: '/ws/output/doc.md' }, {
      onMoveToKnowledge: vi.fn(),
    });
    expect(screen.queryByText('Move to Agent Knowledge')).toBeNull();
  });

  // ── Install Skill ─────────────────────────────────────────────────────────

  it('Install skill: clicking calls onInstallSkill', async () => {
    const onInstallSkill = vi.fn();
    await renderMenu({ type: 'file', name: 'my.skill', path: '/ws/my.skill' }, {
      onInstallSkill,
    });
    fireEvent.click(screen.getByText('Install skill').closest('button')!);
    expect(onInstallSkill).toHaveBeenCalledWith('/ws/my.skill');
  });
});
