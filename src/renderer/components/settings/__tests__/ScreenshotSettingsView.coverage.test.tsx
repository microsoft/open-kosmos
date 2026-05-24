/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for ScreenshotSettingsView.tsx
 */

import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

const { mockGetSettings, mockUpdateSettings, mockSelectSavePath } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpdateSettings: vi.fn(),
  mockSelectSavePath: vi.fn(),
}));

vi.mock('../../../ipc/screenshot-main', () => ({
  screenshotApi: {
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
    selectSavePath: mockSelectSavePath,
  },
}));

vi.mock('../../../styles/ScreenshotSettingsView.css', () => ({}));

const mockOnSettingsChange = vi.fn();
const mockOnShortcutChange = vi.fn();
const mockOnSelectSavePath = vi.fn();
const mockOnResetSavePath = vi.fn();
const mockHeaderViewCapturedProps: Record<string, any> = {};
const mockContentViewCapturedProps: Record<string, any> = {};

vi.mock('../ScreenshotSettingsHeaderView', () => ({
  default: (props: any) => {
    Object.assign(mockHeaderViewCapturedProps, props);
    return <div data-testid="screenshot-header" />;
  },
}));

vi.mock('../ScreenshotSettingsContentView', () => ({
  default: (props: any) => {
    Object.assign(mockContentViewCapturedProps, props);
    return (
      <div data-testid="screenshot-content">
        <span data-testid="error">{props.error ?? ''}</span>
        <span data-testid="enabled">{String(props.settings?.enabled)}</span>
        <button data-testid="change-settings" onClick={() => props.onSettingsChange({ ...props.settings, enabled: false })}>Change</button>
        <button data-testid="change-shortcut" onClick={() => props.onShortcutChange('CommandOrControl+Shift+X')}>Shortcut</button>
        <button data-testid="select-path" onClick={() => props.onSelectSavePath()}>Select Path</button>
        <button data-testid="reset-path" onClick={() => props.onResetSavePath()}>Reset Path</button>
      </div>
    );
  },
}));

import ScreenshotSettingsView from '../ScreenshotSettingsView';

describe('ScreenshotSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        shortcut: 'CommandOrControl+Shift+S',
        shortcutEnabled: false,
        savePath: '',
        freRejected: false,
      },
    });
    mockUpdateSettings.mockResolvedValue({ success: true });
    mockSelectSavePath.mockResolvedValue({ success: true, data: '/new/path' });
  });

  it('renders header and content', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('screenshot-header')).toBeInTheDocument();
      expect(screen.getByTestId('screenshot-content')).toBeInTheDocument();
    });
  });

  it('loads settings on mount', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => {
      expect(mockGetSettings).toHaveBeenCalled();
    });
  });

  it('passes loaded settings to content view', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('enabled').textContent).toBe('true');
    });
  });

  it('shows error when getSettings fails', async () => {
    mockGetSettings.mockResolvedValue({ success: false, error: 'Load failed' });
    render(<ScreenshotSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('Load failed');
    });
  });

  it('shows error when getSettings throws', async () => {
    mockGetSettings.mockRejectedValue(new Error('Network error'));
    render(<ScreenshotSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('Network error');
    });
  });

  it('calls updateSettings when settings change', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('change-settings'));
    });
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });

  it('shows error when updateSettings fails', async () => {
    mockUpdateSettings.mockResolvedValue({ success: false, error: 'Save failed' });
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('change-settings'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('Save failed');
    });
  });

  it('calls updateSettings on shortcut change', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('change-shortcut'));
    });
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });

  it('calls selectSavePath on select path', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-path'));
    });
    await waitFor(() => {
      expect(mockSelectSavePath).toHaveBeenCalled();
    });
  });

  it('handles selectSavePath failure', async () => {
    mockSelectSavePath.mockRejectedValue(new Error('Path error'));
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-path'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('Path error');
    });
  });

  it('calls updateSettings on reset save path', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('reset-path'));
    });
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });

  it('handles getSettings returning no data', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: null });
    render(<ScreenshotSettingsView />);
    await act(async () => {});
    // Should not crash
    expect(screen.getByTestId('screenshot-content')).toBeInTheDocument();
  });
});
