/**
 * @vitest-environment happy-dom
 *
 * UpdateDialog — coverage for all status branches and footer actions.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateDialog, type UpdateDialogProps } from '../UpdateDialog';

// ── Mock lucide-react icons ─────────────────────────────────────────────────
vi.mock('lucide-react', async () => {
  const Stub = ({ className }: { className?: string }) => <svg className={className} />;
  return {
    X: Stub, SkipForward: Stub, Clock: Stub, Download: Stub, Minimize2: Stub,
    Clock3: Stub, PackageCheck: Stub, XCircle: Stub, RotateCw: Stub,
    CheckCircle: Stub, PartyPopper: Stub, CheckCircle2: Stub, Lightbulb: Stub,
    AlertCircle: Stub, Sparkles: Stub, RefreshCw: Stub, Settings: Stub,
    Search: Stub,
  };
});

// ── Mock UI components ──────────────────────────────────────────────────────
vi.mock('../../ui/dialog', async () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    <div data-testid="dialog-footer">{children}</div>,
}));

vi.mock('../../ui/button', async () => ({
  Button: ({ children, onClick, variant }: { children: React.ReactNode; onClick?: () => void; variant?: string }) =>
    <button onClick={onClick} data-variant={variant}>{children}</button>,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const baseProps: UpdateDialogProps = {
  isOpen: true,
  onClose: vi.fn(),
  status: 'checking',
  onCheckForUpdates: vi.fn(),
  onDownloadUpdate: vi.fn(),
  onInstallUpdate: vi.fn(),
  onSkipVersion: vi.fn(),
  onDismiss: vi.fn(),
};

function setup(overrides: Partial<UpdateDialogProps> = {}) {
  const props = { ...baseProps, onClose: vi.fn(), onCheckForUpdates: vi.fn(),
    onDownloadUpdate: vi.fn(), onInstallUpdate: vi.fn(),
    onSkipVersion: vi.fn(), onDismiss: vi.fn(), ...overrides };
  const result = render(<UpdateDialog {...props} />);
  return { ...result, props };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('UpdateDialog', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = setup({ isOpen: false });
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull();
  });

  it('renders dialog when isOpen=true', () => {
    setup({ status: 'checking' });
    expect(screen.getByTestId('dialog')).toBeDefined();
  });

  describe('status: checking', () => {
    it('shows "Download in Background" button', () => {
      const { props } = setup({ status: 'checking' });
      fireEvent.click(screen.getByText(/Download in Background/i));
      expect(props.onDismiss).toHaveBeenCalled();
    });

    it('renders unified flow with updater progress', () => {
      setup({
        status: 'checking',
        checkPhase: 'downloadingUpdater',
        updaterProgress: { percent: 50, transferred: 5, total: 10, speed: 1 },
      });
      expect(screen.getByTestId('dialog-content')).toBeDefined();
    });
  });

  describe('status: downloading', () => {
    it('shows "Download in Background" button', () => {
      const { props } = setup({
        status: 'downloading',
        progress: { percent: 30, transferred: 30, total: 100, speed: 10 },
      });
      fireEvent.click(screen.getByText(/Download in Background/i));
      expect(props.onDismiss).toHaveBeenCalled();
    });
  });

  describe('status: downloaded', () => {
    it('shows Restart Now and Restart Later buttons', () => {
      const { props } = setup({
        status: 'downloaded',
        updateInfo: { version: '2.0.0' },
      });
      fireEvent.click(screen.getByText(/Restart Now/i));
      expect(props.onInstallUpdate).toHaveBeenCalled();

      fireEvent.click(screen.getByText(/Restart Later/i));
      expect(props.onClose).toHaveBeenCalled();
    });

    it('shows version in step 2 title when downloaded', () => {
      setup({ status: 'downloaded', updateInfo: { version: '3.1.0' } });
      expect(screen.getByText(/3.1.0/)).toBeDefined();
    });
  });

  describe('status: available', () => {
    it('shows Download Now button and calls onDownloadUpdate', () => {
      const { props } = setup({
        status: 'available',
        updateInfo: { version: '1.5.0' },
      });
      fireEvent.click(screen.getByText(/Download Now/i));
      expect(props.onDownloadUpdate).toHaveBeenCalled();
    });

    it('calls onSkipVersion when Skip This Version clicked', () => {
      const { props } = setup({
        status: 'available',
        updateInfo: { version: '1.5.0' },
      });
      fireEvent.click(screen.getByText(/Skip This Version/i));
      expect(props.onSkipVersion).toHaveBeenCalledWith('1.5.0');
    });

    it('calls onDismiss when Remind Later clicked', () => {
      const { props } = setup({
        status: 'available',
        updateInfo: { version: '1.5.0' },
      });
      fireEvent.click(screen.getByText(/Remind Later/i));
      expect(props.onDismiss).toHaveBeenCalled();
    });

    it('shows release notes when provided', () => {
      setup({
        status: 'available',
        updateInfo: { version: '1.5.0', releaseNotes: 'Bug fixes and improvements' },
      });
      expect(screen.getByText(/Bug fixes and improvements/)).toBeDefined();
    });

    it('shows release date and download size', () => {
      setup({
        status: 'available',
        updateInfo: {
          version: '1.5.0',
          releaseDate: '2024-01-15',
          downloadSize: 50 * 1024 * 1024,
        },
      });
      expect(screen.getByText(/Size:/)).toBeDefined();
      expect(screen.getByText(/Release Date:/)).toBeDefined();
    });

    it('shows unknown version when updateInfo has no version', () => {
      setup({ status: 'available' });
      expect(screen.getByText(/New version v/)).toBeDefined();
    });
  });

  describe('status: error', () => {
    it('shows error message', () => {
      setup({ status: 'error', error: 'Something went wrong' });
      expect(screen.getByText(/Something went wrong/)).toBeDefined();
    });

    it('shows default error message when no error prop', () => {
      setup({ status: 'error' });
      expect(screen.getByText(/unknown error/i)).toBeDefined();
    });

    it('shows troubleshooting tips for network errors', () => {
      setup({ status: 'error', error: 'network connection failed' });
      expect(screen.getByText(/Troubleshooting Tips/i)).toBeDefined();
    });

    it('shows troubleshooting tips for VPN errors', () => {
      setup({ status: 'error', error: 'VPN required' });
      expect(screen.getByText(/Troubleshooting Tips/i)).toBeDefined();
    });

    it('shows troubleshooting tips for SSL errors', () => {
      setup({ status: 'error', error: 'SSL certificate error' });
      expect(screen.getByText(/Troubleshooting Tips/i)).toBeDefined();
    });

    it('does not show troubleshooting tips for generic errors', () => {
      setup({ status: 'error', error: 'Some other error' });
      expect(screen.queryByText(/Troubleshooting Tips/i)).toBeNull();
    });

    it('calls onCheckForUpdates on Retry', () => {
      const { props } = setup({ status: 'error', error: 'Failed' });
      fireEvent.click(screen.getByText(/Retry/i));
      expect(props.onCheckForUpdates).toHaveBeenCalled();
    });

    it('calls onClose on Close button', () => {
      const { props } = setup({ status: 'error', error: 'Failed' });
      fireEvent.click(screen.getByText(/^Close$/));
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  describe('status: no-update', () => {
    it('shows up-to-date message', () => {
      setup({ status: 'no-update', updateInfo: { version: '2.0.0' } });
      expect(screen.getByText(/latest version/i)).toBeDefined();
    });

    it('calls onClose when OK clicked', () => {
      const { props } = setup({ status: 'no-update' });
      fireEvent.click(screen.getByText(/^OK$/));
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  describe('checkPhase variations', () => {
    it('renders with updaterReady phase', () => {
      setup({ status: 'checking', checkPhase: 'updaterReady' });
      expect(screen.getByTestId('dialog-content')).toBeDefined();
    });

    it('renders with checkingVersion phase', () => {
      setup({ status: 'checking', checkPhase: 'checkingVersion' });
      expect(screen.getByTestId('dialog-content')).toBeDefined();
    });

    it('renders with idle phase', () => {
      setup({ status: 'checking', checkPhase: 'idle' });
      expect(screen.getByTestId('dialog-content')).toBeDefined();
    });
  });
});
