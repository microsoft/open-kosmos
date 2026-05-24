/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ---- atom mock (must come before component import) ----
// Supports both simple atom(initialValue) and atom(initialValue, actionFactory)
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
        // eslint-disable-next-line react-hooks/rules-of-hooks
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
    return <>{children}</>;
  },
}));

vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-raw', () => ({ default: vi.fn() }));

vi.mock('../../../styles/OverlayFileViewer.css', () => ({}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showToast: vi.fn(),
  }),
}));

vi.mock('../../../lib/utils/yamlFrontMatter', () => ({
  parseFrontMatter: vi.fn().mockReturnValue({ frontMatter: null, content: '' }),
}));

vi.mock('../../../lib/skills/installableSkillArtifacts', () => ({
  isInstallableSkillArtifact: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Import after mocks
import { OverlayFileViewer, FileViewerAtom } from '../OverlayFileViewer';

// ---- helpers ----

function setupElectronApi(readFileResult = { success: true, content: 'Hello file content' }) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      fs: {
        readFile: vi.fn().mockResolvedValue(readFileResult),
        writeFile: vi.fn().mockResolvedValue({ success: true }),
        stat: vi.fn().mockResolvedValue({ success: true, size: 1024 }),
      },
      workspace: {
        openPath: vi.fn(),
      },
    },
  });
}

describe('OverlayFileViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronApi();
  });

  it('renders nothing when viewer is closed', () => {
    const { container } = render(<OverlayFileViewer />);
    // When isOpen is false, the component returns null
    expect(container.firstChild).toBeNull();
  });

  it('shows overlay when file is opened via FileViewerAtom', async () => {
    function TestWrapper() {
      const [, actions] = FileViewerAtom.use();
      return (
        <>
          <button
            onClick={() => actions.open({ name: 'test.txt', url: '/tmp/test.txt' })}
          >
            Open
          </button>
          <OverlayFileViewer />
        </>
      );
    }

    render(<TestWrapper />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('test.txt')).toBeInTheDocument();
    });
  });

  it('shows file name in overlay header', async () => {
    function TestWrapper() {
      const [, actions] = FileViewerAtom.use();
      return (
        <>
          <button
            onClick={() => actions.open({ name: 'readme.md', url: '/tmp/readme.md' })}
          >
            Open
          </button>
          <OverlayFileViewer />
        </>
      );
    }

    render(<TestWrapper />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('readme.md')).toBeInTheDocument();
    });
  });

  it('dispatching fileViewer:open event opens the overlay', async () => {
    render(<OverlayFileViewer />);

    const event = new CustomEvent('fileViewer:open', {
      detail: { file: { name: 'hello.txt', url: '/tmp/hello.txt' } },
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByText('hello.txt')).toBeInTheDocument();
    });
  });

  it('close button closes the overlay', async () => {
    function TestWrapper() {
      const [, actions] = FileViewerAtom.use();
      return (
        <>
          <button
            onClick={() => actions.open({ name: 'close-me.txt', url: '/tmp/close-me.txt' })}
          >
            Open
          </button>
          <OverlayFileViewer />
        </>
      );
    }

    render(<TestWrapper />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('close-me.txt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close file viewer' }));

    await waitFor(() => {
      expect(screen.queryByText('close-me.txt')).not.toBeInTheDocument();
    });
  });

  it('shows error state when file read fails', async () => {
    setupElectronApi({ success: false, content: '' });
    // Make stat succeed but readFile fail
    (window.electronAPI as any).fs.readFile = vi.fn().mockResolvedValue({
      success: false,
      error: 'Permission denied',
    });

    function TestWrapper() {
      const [, actions] = FileViewerAtom.use();
      return (
        <>
          <button
            onClick={() => actions.open({ name: 'fail.txt', url: '/tmp/fail.txt' })}
          >
            Open
          </button>
          <OverlayFileViewer />
        </>
      );
    }

    render(<TestWrapper />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText(/Permission denied|failed|error/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
