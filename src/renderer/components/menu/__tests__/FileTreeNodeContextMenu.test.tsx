/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { WithStore } from '@/atom';

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  clampMenuToViewport: vi.fn(),
  getContextMenuPosition: vi.fn().mockReturnValue({ top: 0, left: 0 }),
  CONTEXT_MENU_SIZE_PRESETS: { fileTreeNodeMenu: { estimatedWidth: 200, estimatedHeight: 200 } },
}));

describe('FileTreeNodeContextMenu', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        platform: 'darwin',
        workspace: {
          openPath: vi.fn(),
          showInFolder: vi.fn(),
        },
        fs: {
          deletePaths: vi.fn(),
        },
      },
    });

    Object.defineProperty(window, 'confirm', {
      writable: true,
      configurable: true,
      value: vi.fn(() => true),
    });

    Object.defineProperty(global.navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: {
        writeText: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hides Move to Agent Knowledge for files already inside the current knowledge base', async () => {
    const { default: FileTreeNodeContextMenu, FileTreeNodeMenuAtom: fileTreeNodeMenuAtom } = await import('../FileTreeNodeContextMenu');

    const Wrapper = () => {
      const actions = fileTreeNodeMenuAtom.useChange();
      React.useEffect(() => {
        actions.open(0, 0, { type: 'file', name: 'doc.md', path: '/workspace/knowledge/doc.md' }, '/workspace');
      }, []);
      return (
        <FileTreeNodeContextMenu
          knowledgeBasePath="/workspace/knowledge"
          onMoveToKnowledge={vi.fn()}
        />
      );
    };

    render(<WithStore><Wrapper /></WithStore>);

    expect(screen.queryByText('Move to Agent Knowledge')).not.toBeInTheDocument();
  });

  it('shows Move to Agent Knowledge for files outside the current knowledge base', async () => {
    const { default: FileTreeNodeContextMenu, FileTreeNodeMenuAtom: fileTreeNodeMenuAtom } = await import('../FileTreeNodeContextMenu');

    const Wrapper = () => {
      const actions = fileTreeNodeMenuAtom.useChange();
      React.useEffect(() => {
        actions.open(0, 0, { type: 'file', name: 'doc.md', path: '/workspace/output/doc.md' }, '/workspace');
      }, []);
      return (
        <FileTreeNodeContextMenu
          knowledgeBasePath="/workspace/knowledge"
          onMoveToKnowledge={vi.fn()}
        />
      );
    };

    render(<WithStore><Wrapper /></WithStore>);

    expect(screen.getByText('Move to Agent Knowledge')).toBeInTheDocument();
  });

  it('shows Install skill for .zip and SKILL.md artifacts', async () => {
    const { default: FileTreeNodeContextMenu, FileTreeNodeMenuAtom: fileTreeNodeMenuAtom } = await import('../FileTreeNodeContextMenu');

    const Wrapper = ({ node }: { node: any }) => {
      const actions = fileTreeNodeMenuAtom.useChange();
      React.useEffect(() => {
        actions.open(0, 0, node, '/workspace');
      }, [node]);
      return (
        <FileTreeNodeContextMenu
          knowledgeBasePath="/workspace/knowledge"
          onInstallSkill={vi.fn()}
        />
      );
    };

    const { rerender } = render(
      <WithStore>
        <Wrapper node={{ type: 'file', name: 'pptx.zip', path: '/workspace/output/pptx.zip' }} />
      </WithStore>
    );

    expect(screen.getByText('Install skill')).toBeInTheDocument();

    rerender(
      <WithStore>
        <Wrapper node={{ type: 'file', name: 'SKILL.md', path: '/workspace/output/pptx/SKILL.md' }} />
      </WithStore>
    );

    expect(screen.getByText('Install skill')).toBeInTheDocument();
  });
});
