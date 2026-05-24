/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ---- mocks ----

vi.mock('react-markdown', () => ({
  default: function MockReactMarkdown({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  },
}));

vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-raw', () => ({ default: vi.fn() }));

vi.mock('../../../styles/InlineFilePreviewPanel.css', () => ({}));

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

import { InlineFilePreviewPanel, InlineFileDescriptor } from '../InlineFilePreviewPanel';

// ---- helpers ----

function setupElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      fs: {
        readFile: vi.fn().mockResolvedValue({ success: true, content: '# Hello\nFile content here' }),
        writeFile: vi.fn().mockResolvedValue({ success: true }),
        stat: vi.fn().mockResolvedValue({ success: true, size: 512 }),
      },
      workspace: {
        openPath: vi.fn(),
        showInFolder: vi.fn(),
      },
    },
  });
}

const TXT_FILE: InlineFileDescriptor = { name: 'notes.txt', url: '/tmp/notes.txt' };
const MD_FILE: InlineFileDescriptor = { name: 'readme.md', url: '/tmp/readme.md' };
const mockOnClose = vi.fn();

describe('InlineFilePreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronApi();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <InlineFilePreviewPanel file={TXT_FILE} isOpen={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when file is null', () => {
    const { container } = render(
      <InlineFilePreviewPanel file={null} isOpen={true} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders panel header with file name when open', async () => {
    render(
      <InlineFilePreviewPanel file={TXT_FILE} isOpen={true} onClose={mockOnClose} />
    );

    await waitFor(() => {
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    render(
      <InlineFilePreviewPanel file={TXT_FILE} isOpen={true} onClose={mockOnClose} />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows file name in header for markdown file', async () => {
    render(
      <InlineFilePreviewPanel file={MD_FILE} isOpen={true} onClose={mockOnClose} />
    );

    await waitFor(() => {
      expect(screen.getByText('readme.md')).toBeInTheDocument();
    });
  });

  it('shows loading state while reading file', async () => {
    // Delay the readFile so loading state is briefly visible
    (window.electronAPI as any).fs.readFile = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <InlineFilePreviewPanel file={TXT_FILE} isOpen={true} onClose={mockOnClose} />
    );

    // Loading indicator should appear
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows error state when file read fails', async () => {
    (window.electronAPI as any).fs.readFile = vi.fn().mockResolvedValue({
      success: false,
      error: 'Access denied',
    });

    render(
      <InlineFilePreviewPanel file={TXT_FILE} isOpen={true} onClose={mockOnClose} />
    );

    await waitFor(() => {
      const errEl = document.querySelector('.inline-preview-error');
      expect(errEl).not.toBeNull();
    }, { timeout: 3000 });
  });
});
