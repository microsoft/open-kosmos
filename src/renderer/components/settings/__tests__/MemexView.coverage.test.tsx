/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for MemexView.tsx
 */

import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

const { mockGetStatus, mockEnable, mockDisable, mockShowSuccess, mockShowError } = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockEnable: vi.fn(),
  mockDisable: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowError: vi.fn(),
}));

vi.mock('../../../ipc/memex', () => ({
  memexApi: {
    getStatus: mockGetStatus,
    enable: mockEnable,
    disable: mockDisable,
  },
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

vi.mock('../../../styles/BrowserControlView.css', () => ({}));
vi.mock('../../../styles/RuntimeSettings.css', () => ({}));

let capturedPhaseChange: ((phase: string) => void) | null = null;

function setupElectronAPI() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      memex: {
        onPhaseChange: (cb: (phase: string) => void) => {
          capturedPhaseChange = cb;
          return () => {};
        },
      },
    },
  });
}

import MemexView from '../MemexView';

describe('MemexView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPhaseChange = null;
    mockGetStatus.mockResolvedValue({ success: true, data: { enabled: false } });
    mockEnable.mockResolvedValue({ success: true });
    mockDisable.mockResolvedValue({ success: true });
    setupElectronAPI();
  });

  it('shows loading initially', () => {
    mockGetStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MemexView />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders main view after loading', async () => {
    render(<MemexView />);
    await waitFor(() => {
      expect(screen.getByText('Memex Memory')).toBeInTheDocument();
    });
  });

  it('shows toggle checkbox', async () => {
    render(<MemexView />);
    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });
  });

  it('checkbox is unchecked when disabled', async () => {
    render(<MemexView />);
    await waitFor(() => {
      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });
  });

  it('checkbox is checked when enabled', async () => {
    mockGetStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<MemexView />);
    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeChecked();
    });
  });

  it('enables memex when toggled from disabled', async () => {
    render(<MemexView />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    await waitFor(() => {
      expect(mockEnable).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalled();
    });
  });

  it('disables memex when toggled from enabled', async () => {
    mockGetStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<MemexView />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    await waitFor(() => {
      expect(mockDisable).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalled();
    });
  });

  it('shows error on enable failure', async () => {
    mockEnable.mockResolvedValue({ success: false, error: 'Enable failed' });
    render(<MemexView />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Enable failed');
    });
  });

  it('shows error on enable exception', async () => {
    mockEnable.mockRejectedValue(new Error('Network error'));
    render(<MemexView />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Network error');
    });
  });

  it('handles phase change', async () => {
    render(<MemexView />);
    await waitFor(() => expect(capturedPhaseChange).not.toBeNull());
    await act(async () => {
      capturedPhaseChange!('installing');
    });
    // No crash
  });

  it('handles completed phase change (resets to idle after delay)', async () => {
    render(<MemexView />);
    await waitFor(() => expect(capturedPhaseChange).not.toBeNull());
    await act(async () => {
      capturedPhaseChange!('completed');
    });
    // Wait for the 800ms timeout
    await new Promise((r) => setTimeout(r, 900));
    // No crash
  });

  it('handles error phase change', async () => {
    render(<MemexView />);
    await waitFor(() => expect(capturedPhaseChange).not.toBeNull());
    await act(async () => {
      capturedPhaseChange!('error');
    });
    // No crash
  });

  it('handles getStatus failure gracefully', async () => {
    mockGetStatus.mockRejectedValue(new Error('Status error'));
    render(<MemexView />);
    await waitFor(() => {
      // Should finish loading and render main view
      expect(screen.getByText('Memex Memory')).toBeInTheDocument();
    });
  });
});
