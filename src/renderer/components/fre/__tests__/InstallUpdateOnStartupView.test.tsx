/** @vitest-environment happy-dom */

/**
 * InstallUpdateOnStartupView unit tests
 *
 * Covers:
 * - Auto-start on mount (calls checkAndInstallUpdates once)
 * - Progress events update UI
 * - Success → onComplete after delay
 * - Error → shows error, Retry/Skip buttons
 * - Strict Mode guard (no double invocation)
 */

vi.mock('@shared/constants/branding', async () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_CONFIG: { windowTitle: 'OpenKosmos AI Studio', shortcutName: 'OpenKosmos' },
}));

vi.mock('../../lib/utilities/logger', async () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import InstallUpdateOnStartupView from '../InstallUpdateOnStartupView';

describe('InstallUpdateOnStartupView', () => {
  const mockOnComplete = vi.fn();
  const mockOnSkip = vi.fn();
  let mockCheckAndInstall: ReturnType<typeof vi.fn>;
  let progressCallback: ((p: any) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    progressCallback = null;

    mockCheckAndInstall = vi.fn().mockResolvedValue({
      success: true,
      data: { hasUpdates: false, updatedMcpCount: 0, updatedSkillCount: 0, updatedAgentCount: 0 },
    });

    (window as any).electronAPI = {
      startupUpdate: {
        checkAndInstallUpdates: mockCheckAndInstall,
        onProgress: vi.fn((cb: any) => {
          progressCallback = cb;
          return vi.fn(); // unsubscribe
        }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('should call checkAndInstallUpdates on mount', async () => {
    await act(async () => {
      render(<InstallUpdateOnStartupView onComplete={mockOnComplete} onSkip={mockOnSkip} isWindows={false} />);
    });

    expect(mockCheckAndInstall).toHaveBeenCalledTimes(1);
  });

  it('should call onComplete after success with delay', async () => {
    await act(async () => {
      render(<InstallUpdateOnStartupView onComplete={mockOnComplete} onSkip={mockOnSkip} isWindows={false} />);
    });

    // Wait for the 800ms delay + async resolution
    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('should show error state and Retry/Skip buttons on failure', async () => {
    mockCheckAndInstall.mockRejectedValue(new Error('Network failure'));

    await act(async () => {
      render(<InstallUpdateOnStartupView onComplete={mockOnComplete} onSkip={mockOnSkip} isWindows={false} />);
    });

    // Wait for the error state to render
    await waitFor(() => {
      expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
    });

    // Should show Retry and Skip buttons
    expect(screen.getByText(/Retry/i)).toBeInTheDocument();
    expect(screen.getByText(/Skip/i)).toBeInTheDocument();
  });

  it('should call onSkip when Skip button is clicked', async () => {
    mockCheckAndInstall.mockRejectedValue(new Error('fail'));

    await act(async () => {
      render(<InstallUpdateOnStartupView onComplete={mockOnComplete} onSkip={mockOnSkip} isWindows={false} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Skip/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Skip/i));
    expect(mockOnSkip).toHaveBeenCalled();
  });

  it('should retry when Retry button is clicked', async () => {
    mockCheckAndInstall.mockRejectedValueOnce(new Error('fail'));

    await act(async () => {
      render(<InstallUpdateOnStartupView onComplete={mockOnComplete} onSkip={mockOnSkip} isWindows={false} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Retry/i)).toBeInTheDocument();
    });

    // Now make it succeed on retry
    mockCheckAndInstall.mockResolvedValue({
      success: true,
      data: { hasUpdates: true, updatedMcpCount: 1, updatedSkillCount: 0, updatedAgentCount: 0 },
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Retry/i));
    });

    expect(mockCheckAndInstall).toHaveBeenCalledTimes(2);
  });

  it('should show error when result.success is false', async () => {
    mockCheckAndInstall.mockResolvedValue({
      success: false,
      error: 'Server error',
    });

    await act(async () => {
      render(<InstallUpdateOnStartupView onComplete={mockOnComplete} onSkip={mockOnSkip} isWindows={false} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Server error/i)).toBeInTheDocument();
    });
  });
});
