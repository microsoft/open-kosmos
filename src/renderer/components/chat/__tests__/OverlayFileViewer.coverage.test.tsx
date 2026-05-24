/**
 * @vitest-environment happy-dom
 *
 * OverlayFileViewer coverage tests
 * Covers additional paths in src/renderer/components/ui/OverlayFileViewer.tsx
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

// ---- atom mock ----
vi.mock('@/atom', () => ({
  atom: (initialValue: unknown, actionFactory?: (get: () => unknown, set: (v: unknown) => void) => unknown) => {
    let _state = initialValue;
    const subscribers: Array<() => void> = [];
    function get() { return _state; }
    function set(v: unknown) {
      _state = v;
      subscribers.forEach(fn => fn());
    }
    const actions = actionFactory ? actionFactory(get, set) : { set };
    return {
      use: () => {
        const [val, setVal] = React.useState(_state);
        React.useEffect(() => {
          const refresh = () => setVal({ ..._state as object } as any);
          subscribers.push(refresh);
          return () => { subscribers.splice(subscribers.indexOf(refresh), 1); };
        }, []);
        return [val, actions];
      },
    };
  },
  WithStore: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-markdown', () => ({
  default: function MockReactMarkdown({ children }: { children: React.ReactNode }) {
    return <div data-testid="markdown-content">{children}</div>;
  },
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-raw', () => ({ default: vi.fn() }));
vi.mock('../../../styles/OverlayFileViewer.css', () => ({}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showToast: vi.fn(),
  }),
}));

const mockParseFrontMatter = vi.fn().mockReturnValue({ frontMatter: null, content: '' });
vi.mock('../../../lib/utils/yamlFrontMatter', () => ({
  parseFrontMatter: (...args: any[]) => mockParseFrontMatter(...args),
}));

const mockIsInstallableSkillArtifact = vi.fn().mockReturnValue(false);
vi.mock('../../../lib/skills/installableSkillArtifacts', () => ({
  isInstallableSkillArtifact: (...args: any[]) => mockIsInstallableSkillArtifact(...args),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { OverlayFileViewer, FileViewerAtom, type OverlayFileDescriptor } from '../../ui/OverlayFileViewer';

// Fake blob URLs
let blobCounter = 0;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
beforeAll(() => {
  URL.createObjectURL = () => `blob:fake-${++blobCounter}`;
  URL.revokeObjectURL = vi.fn();
});
afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

function setupElectronApi(overrides: Record<string, any> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      fs: {
        readFile: vi.fn().mockResolvedValue({ success: true, content: 'file content here' }),
        writeFile: vi.fn().mockResolvedValue({ success: true }),
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 2048 } }),
        ...(overrides.fs || {}),
      },
      workspace: {
        openPath: vi.fn(),
        ...(overrides.workspace || {}),
      },
    },
  });
}

function openViewer(descriptor: OverlayFileDescriptor, onInstallSkill?: (p: string) => void) {
  function Wrapper() {
    const [, actions] = FileViewerAtom.use();
    return (
      <>
        <button onClick={() => actions.open(descriptor)}>Open</button>
        <OverlayFileViewer onInstallSkill={onInstallSkill} />
      </>
    );
  }
  render(<Wrapper />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParseFrontMatter.mockReturnValue({ frontMatter: null, content: '' });
  mockIsInstallableSkillArtifact.mockReturnValue(false);
  setupElectronApi();
});

// ============================================================
// PDF file rendering
// ============================================================

describe('PDF file category', () => {
  it('renders an iframe for a local PDF file', async () => {
    openViewer({ name: 'doc.pdf', url: '/tmp/doc.pdf' });
    await waitFor(() => {
      const iframe = document.querySelector('iframe.file-viewer-pdf-embed');
      expect(iframe).not.toBeNull();
    });
  });

  it('renders an iframe for a remote PDF file', async () => {
    openViewer({ name: 'report.pdf', url: 'https://example.com/report.pdf' });
    await waitFor(() => {
      const iframe = document.querySelector('iframe.file-viewer-pdf-embed');
      expect(iframe).not.toBeNull();
    });
  });
});

// ============================================================
// Office file rendering
// ============================================================

describe('Office file category', () => {
  it('shows cannot-preview message for a local docx file', async () => {
    openViewer({ name: 'doc.docx', url: '/tmp/doc.docx' });
    await waitFor(() => {
      expect(screen.getByText(/cannot be previewed/i)).toBeInTheDocument();
    });
  });

  it('renders iframe for remote xlsx via Office Online Viewer', async () => {
    openViewer({ name: 'sheet.xlsx', url: 'https://example.com/sheet.xlsx' });
    await waitFor(() => {
      const iframe = document.querySelector('iframe.file-viewer-pdf-embed');
      expect(iframe).not.toBeNull();
      expect((iframe as HTMLIFrameElement).src).toContain('view.officeapps.live.com');
    });
  });

  it('shows lastModified when provided for local office file', async () => {
    openViewer({ name: 'doc.docx', url: '/tmp/doc.docx', lastModified: '2024-01-15' });
    await waitFor(() => {
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    });
  });
});

// ============================================================
// Unknown / other file category
// ============================================================

describe('Other / unknown file category', () => {
  it('shows unsupported message for unknown file extension', async () => {
    openViewer({ name: 'archive.bin', url: '/tmp/archive.bin' });
    await waitFor(() => {
      expect(screen.getByText(/not supported for preview/i)).toBeInTheDocument();
    });
  });

  it('shows Install Skill button when file is an installable skill artifact (local)', async () => {
    mockIsInstallableSkillArtifact.mockReturnValue(true);
    const onInstallSkill = vi.fn();
    openViewer({ name: 'my.skill', url: '/tmp/my.skill' }, onInstallSkill);
    await waitFor(() => {
      expect(screen.getByText(/Install Skill/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Install Skill/i));
    expect(onInstallSkill).toHaveBeenCalledWith('/tmp/my.skill');
  });

  it('does not show Install Skill button when not installable', async () => {
    mockIsInstallableSkillArtifact.mockReturnValue(false);
    openViewer({ name: 'archive.bin', url: '/tmp/archive.bin' }, vi.fn());
    await waitFor(() => {
      expect(screen.queryByText(/Install Skill/i)).toBeNull();
    });
  });

  it('shows lastModified for unknown file', async () => {
    openViewer({ name: 'archive.bin', url: '/tmp/archive.bin', lastModified: '2024-03-01' });
    await waitFor(() => {
      expect(screen.getByText('2024-03-01')).toBeInTheDocument();
    });
  });
});

// ============================================================
// Remote text file loading (fetch path)
// ============================================================

describe('Remote text file fetch path', () => {
  it('loads content via fetch for remote text file', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'remote text content',
    } as any);
    openViewer({ name: 'notes.txt', url: 'https://example.com/notes.txt' });
    await waitFor(() => {
      expect(screen.queryByText('notes.txt')).toBeTruthy();
    });
  });

  it('shows error state when remote fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    } as any);
    openViewer({ name: 'missing.txt', url: 'https://example.com/missing.txt' });
    await waitFor(() => {
      expect(screen.getByText(/Failed to load file/i)).toBeInTheDocument();
    });
  });

  it('shows error state when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    openViewer({ name: 'error.txt', url: 'https://example.com/error.txt' });
    await waitFor(() => {
      expect(screen.getByText(/Failed to load file/i)).toBeInTheDocument();
    });
  });
});

// ============================================================
// Local file not found (stat fails)
// ============================================================

describe('Local file not found path', () => {
  it('shows error when stat fails (file not found)', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: false }),
        readFile: vi.fn(),
        writeFile: vi.fn(),
      },
    });
    openViewer({ name: 'ghost.txt', url: '/tmp/ghost.txt' });
    await waitFor(() => {
      expect(screen.getByText(/File not found/i)).toBeInTheDocument();
    });
  });

  it('shows error when readFile throws', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 100 } }),
        readFile: vi.fn().mockRejectedValue(new Error('read error')),
        writeFile: vi.fn(),
      },
    });
    openViewer({ name: 'throw.txt', url: '/tmp/throw.txt' });
    await waitFor(() => {
      expect(screen.getByText(/cannot be read/i)).toBeInTheDocument();
    });
  });
});

// ============================================================
// HTML file rendering
// ============================================================

describe('HTML file rendering', () => {
  it('renders HTML file in an iframe (render mode)', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 512 } }),
        readFile: vi.fn().mockResolvedValue({ success: true, content: '<h1>Hello</h1>' }),
        writeFile: vi.fn(),
      },
    });
    openViewer({ name: 'page.html', url: '/tmp/page.html' });
    await waitFor(() => {
      const iframe = document.querySelector('iframe.file-viewer-html-embed');
      expect(iframe).not.toBeNull();
    });
  });

  it('view source toggle shows monaco viewer for HTML', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 512 } }),
        readFile: vi.fn().mockResolvedValue({ success: true, content: '<h1>Hello</h1>' }),
        writeFile: vi.fn(),
      },
    });
    openViewer({ name: 'page.html', url: '/tmp/page.html' });
    // Wait for viewer header to load
    await waitFor(() => expect(screen.queryByTitle('View Source')).toBeTruthy());
    fireEvent.click(screen.getByTitle('View Source'));
    // After toggling to source mode, the "View Rendered" button should appear
    await waitFor(() => expect(screen.queryByTitle('View Rendered')).toBeTruthy());
  });
});

// ============================================================
// Markdown file rendering
// ============================================================

describe('Markdown file rendering', () => {
  it('renders markdown file content', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 512 } }),
        readFile: vi.fn().mockResolvedValue({ success: true, content: '# Hello\nWorld' }),
        writeFile: vi.fn(),
      },
    });
    mockParseFrontMatter.mockReturnValue({ frontMatter: { title: 'Test' }, content: '# Hello\nWorld' });
    openViewer({ name: 'readme.md', url: '/tmp/readme.md' });
    await waitFor(() => {
      expect(screen.queryByText('readme.md')).toBeTruthy();
    });
  });

  it('view source toggle works for markdown', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 512 } }),
        readFile: vi.fn().mockResolvedValue({ success: true, content: '# Title' }),
        writeFile: vi.fn(),
      },
    });
    mockParseFrontMatter.mockReturnValue({ frontMatter: null, content: '# Title' });
    openViewer({ name: 'notes.md', url: '/tmp/notes.md' });
    await waitFor(() => expect(screen.queryByTitle('View Source')).toBeTruthy());
    fireEvent.click(screen.getByTitle('View Source'));
    await waitFor(() => expect(screen.queryByTitle('View Rendered')).toBeTruthy());
  });
});

// ============================================================
// handleDownload — local vs remote
// ============================================================

describe('handleDownload', () => {
  it('calls openPath for local file on download', async () => {
    setupElectronApi();
    openViewer({ name: 'local.txt', url: '/tmp/local.txt' });
    await waitFor(() => expect(screen.queryByTitle('Download')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Download'));
    expect((window.electronAPI as any).workspace.openPath).toHaveBeenCalledWith('/tmp/local.txt');
  });

  it('creates a download link for remote file on download', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'content',
    } as any);
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    openViewer({ name: 'data.txt', url: 'https://example.com/data.txt' });
    await waitFor(() => expect(screen.queryByTitle('Download')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Download'));
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

// ============================================================
// handleOpenExternal
// ============================================================

describe('handleOpenExternal', () => {
  it('calls openPath for local office file', async () => {
    openViewer({ name: 'doc.docx', url: '/tmp/doc.docx' });
    await waitFor(() => expect(screen.getByText(/Open with Default App/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Open with Default App/i));
    expect((window.electronAPI as any).workspace.openPath).toHaveBeenCalledWith('/tmp/doc.docx');
  });
});

// ============================================================
// fileViewer:open event — skips when __inlineFilePreviewEnabled
// ============================================================

describe('fileViewer:open event', () => {
  it('ignores event when __inlineFilePreviewEnabled is set', async () => {
    (window as any).__inlineFilePreviewEnabled = true;
    render(<OverlayFileViewer />);
    const event = new CustomEvent('fileViewer:open', {
      detail: { file: { name: 'blocked.txt', url: '/tmp/blocked.txt' } },
    });
    window.dispatchEvent(event);
    // Component should remain closed
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText('blocked.txt')).toBeNull();
    delete (window as any).__inlineFilePreviewEnabled;
  });

  it('ignores event when _inlineHandled is set on event', async () => {
    render(<OverlayFileViewer />);
    const event = new CustomEvent('fileViewer:open', {
      detail: { file: { name: 'handled.txt', url: '/tmp/handled.txt' } },
    });
    (event as any)._inlineHandled = true;
    window.dispatchEvent(event);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText('handled.txt')).toBeNull();
  });
});

// ============================================================
// Keyboard shortcuts
// ============================================================

describe('keyboard shortcuts', () => {
  it('Escape key closes viewer when not editing', async () => {
    setupElectronApi();
    openViewer({ name: 'close-esc.txt', url: '/tmp/close-esc.txt' });
    await waitFor(() => expect(screen.queryByText('close-esc.txt')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('close-esc.txt')).toBeNull());
  });
});

// ============================================================
// File size display
// ============================================================

describe('file size display', () => {
  it('shows file size when provided in descriptor', async () => {
    openViewer({ name: 'sized.txt', url: '/tmp/sized.txt', size: 1024 });
    await waitFor(() => {
      // 1024 bytes = 1.0 KB
      expect(screen.getByText(/1\.0 KB/)).toBeInTheDocument();
    });
  });

  it('shows Unknown size when size is not available and stat returns no stats', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: false }),
        readFile: vi.fn().mockResolvedValue({ success: true, content: 'data' }),
        writeFile: vi.fn(),
      },
    });
    openViewer({ name: 'unknown.txt', url: '/tmp/unknown.txt' });
    await waitFor(() => expect(screen.queryByText('unknown.txt')).toBeTruthy());
  });

  it('shows file size in bytes for tiny files', async () => {
    openViewer({ name: 'tiny.txt', url: '/tmp/tiny.txt', size: 500 });
    await waitFor(() => {
      expect(screen.getByText(/500 B/)).toBeInTheDocument();
    });
  });

  it('shows file size in MB for large files', async () => {
    openViewer({ name: 'big.txt', url: '/tmp/big.txt', size: 2 * 1024 * 1024 });
    await waitFor(() => {
      expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    });
  });
});

// ============================================================
// isLocalFile helper — Windows paths and file:// URLs
// ============================================================

describe('Windows path and file:// URL support', () => {
  it('renders correctly for Windows-style path', async () => {
    setupElectronApi();
    openViewer({ name: 'report.pdf', url: 'C:\\Users\\user\\report.pdf' });
    await waitFor(() => {
      const iframe = document.querySelector('iframe.file-viewer-pdf-embed');
      expect(iframe).not.toBeNull();
    });
  });

  it('renders correctly for file:// URL', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 100 } }),
        readFile: vi.fn().mockResolvedValue({ success: true, content: 'text from file://' }),
        writeFile: vi.fn(),
      },
    });
    openViewer({ name: 'local.txt', url: 'file:///tmp/local.txt' });
    await waitFor(() => expect(screen.queryByText('local.txt')).toBeTruthy());
  });
});

// ============================================================
// Close error dialog via button
// ============================================================

describe('error state close button', () => {
  it('error state close button calls onClose', async () => {
    setupElectronApi({
      fs: {
        stat: vi.fn().mockResolvedValue({ success: false }),
        readFile: vi.fn(),
        writeFile: vi.fn(),
      },
    });
    openViewer({ name: 'notfound.txt', url: '/tmp/notfound.txt' });
    await waitFor(() => {
      expect(screen.getByText(/File not found/i)).toBeInTheDocument();
    });
    // The error state has a "Close" button
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('notfound.txt')).toBeNull();
    });
  });
});
