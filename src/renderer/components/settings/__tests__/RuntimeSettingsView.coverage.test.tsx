/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockCheckStatus = vi.hoisted(() => vi.fn());
const mockCheckGitVersion = vi.hoisted(() => vi.fn());
const mockSetMode = vi.hoisted(() => vi.fn());
const mockInstall = vi.hoisted(() => vi.fn());
const mockCleanUvCache = vi.hoisted(() => vi.fn());
const mockListPythonVersions = vi.hoisted(() => vi.fn());
const mockInstallPythonVersion = vi.hoisted(() => vi.fn());
const mockUninstallPythonVersion = vi.hoisted(() => vi.fn());
const mockSetPinnedPythonVersion = vi.hoisted(() => vi.fn());

const mockAppDataSubscribe = vi.hoisted(() => vi.fn());
const mockGetRuntimeEnvironment = vi.hoisted(() => vi.fn());

const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());

const mockUseFeatureFlag = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/userData/appDataManager', () => ({
  appDataManager: {
    getRuntimeEnvironment: mockGetRuntimeEnvironment,
    subscribe: mockAppDataSubscribe,
    updateConfig: vi.fn(),
  },
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: mockUseFeatureFlag,
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../styles/RuntimeSettings.css', () => ({}));

vi.mock('../RuntimeSettingsHeaderView', () => ({
  default: ({ onRefresh, isRefreshing }: any) => (
    <div data-testid="runtime-header">
      <button data-testid="refresh-btn" onClick={onRefresh}>Refresh</button>
      {isRefreshing && <span data-testid="refreshing">refreshing</span>}
    </div>
  ),
}));

vi.mock('../RuntimeSettingsContentView', () => ({
  default: (props: any) => (
    <div data-testid="runtime-content">
      <button data-testid="mode-system" onClick={() => props.onModeChange('system')}>System</button>
      <button data-testid="mode-internal" onClick={() => props.onModeChange('internal')}>Internal</button>
      <button data-testid="install-bun" onClick={() => props.onInstall('bun')}>Install Bun</button>
      <button data-testid="install-uv" onClick={() => props.onInstall('uv')}>Install UV</button>
      <button data-testid="clean-cache" onClick={() => props.onCleanUvCache()}>Clean</button>
      <button data-testid="install-python" onClick={() => props.onInstallPython()}>Install Python</button>
      <button data-testid="uninstall-python" onClick={() => props.onUninstallPython('3.11')}>Uninstall Python</button>
      <button data-testid="pin-python" onClick={() => props.onPinPythonVersion('3.11')}>Pin Python</button>
      <button data-testid="version-change" onClick={() => props.onVersionChange('bun', '1.0.0')}>Change Version</button>
    </div>
  ),
}));

vi.mock('../../../lib/runtime/runtimeVersions', () => ({
  DEFAULT_PYTHON_VERSION: '3.11',
}));

// ---------------------------------------------------------------------------
// Window API
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFeatureFlag.mockReturnValue(false);
  mockGetRuntimeEnvironment.mockReturnValue(null);
  mockAppDataSubscribe.mockReturnValue(() => {});

  (window as any).electronAPI = {
    runtime: {
      checkStatus: mockCheckStatus,
      checkGitVersion: mockCheckGitVersion,
      setMode: mockSetMode,
      install: mockInstall,
      cleanUvCache: mockCleanUvCache,
      listPythonVersions: mockListPythonVersions,
      installPythonVersion: mockInstallPythonVersion,
      uninstallPythonVersion: mockUninstallPythonVersion,
      setPinnedPythonVersion: mockSetPinnedPythonVersion,
    },
  };

  mockCheckStatus.mockResolvedValue({ bun: true, uv: true });
  mockCheckGitVersion.mockResolvedValue({ version: '2.40.0' });
  mockListPythonVersions.mockResolvedValue([]);
  mockSetMode.mockResolvedValue({});
  mockInstall.mockResolvedValue({});
  mockCleanUvCache.mockResolvedValue({});
  mockInstallPythonVersion.mockResolvedValue({});
  mockUninstallPythonVersion.mockResolvedValue({});
  mockSetPinnedPythonVersion.mockResolvedValue({});

  // Reset confirm — happy-dom may not have window.confirm defined
  (window as any).confirm = vi.fn().mockReturnValue(true);
});

import RuntimeSettingsView from '../RuntimeSettingsView';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuntimeSettingsView', () => {
  it('shows loading state when no runtimeEnv or status', async () => {
    mockCheckStatus.mockReturnValue(new Promise(() => {}));
    render(<RuntimeSettingsView />);
    expect(screen.getByText('Loading runtime status...')).toBeTruthy();
  });

  it('renders header and content when data is ready', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({
      mode: 'internal',
      bunVersion: '1.1.0',
      uvVersion: '0.2.0',
      pinnedPythonVersion: '3.11',
    });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('runtime-header')).toBeTruthy();
      expect(screen.getByTestId('runtime-content')).toBeTruthy();
    });
  });

  it('loads python versions when uv is installed', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    mockCheckStatus.mockResolvedValue({ bun: true, uv: true });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => {
      expect(mockListPythonVersions).toHaveBeenCalled();
    });
  });

  it('does not load python versions when uv is not installed', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    mockCheckStatus.mockResolvedValue({ bun: true, uv: false });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => {
      expect(mockListPythonVersions).not.toHaveBeenCalled();
    });
  });

  it('checks git version when feature flag is enabled', async () => {
    mockUseFeatureFlag.mockReturnValue(true);
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => {
      expect(mockCheckGitVersion).toHaveBeenCalled();
    });
  });

  it('handles refresh button click with success', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('refresh-btn')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('refresh-btn'));
    });
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('Runtime status refreshed');
    });
  });

  it('handles refresh button click with error (loadData swallows, shows success)', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    // loadData catches errors internally, so refresh always shows success
    mockCheckStatus.mockResolvedValue({ bun: false, uv: false });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('refresh-btn')).toBeTruthy();
    });
    // Make checkStatus fail on the refresh call
    mockCheckStatus.mockRejectedValue(new Error('refresh failed'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('refresh-btn'));
    });
    // loadData catches the error internally — handleRefresh sees no throw so showSuccess is called
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('Runtime status refreshed');
    });
  });

  it('handles mode change to system', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('mode-system'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-system'));
    });
    await waitFor(() => {
      expect(mockSetMode).toHaveBeenCalledWith('system');
      expect(mockShowSuccess).toHaveBeenCalledWith('Switched to system mode');
    });
  });

  it('handles mode change failure', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    mockSetMode.mockRejectedValue(new Error('fail'));
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('mode-internal'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-internal'));
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to switch mode');
    });
  });

  it('handles install bun', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '1.1.0', uvVersion: '0.2.0' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('install-bun'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('install-bun'));
    });
    await waitFor(() => {
      expect(mockInstall).toHaveBeenCalledWith('bun', '1.1.0');
      expect(mockShowSuccess).toHaveBeenCalledWith('Installed bun v1.1.0');
    });
  });

  it('handles install failure', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '1.0.0', uvVersion: '0.2.0' });
    mockInstall.mockRejectedValue({ message: 'install error' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('install-uv'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('install-uv'));
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to install uv: install error');
    });
  });

  it('handles clean uv cache', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('clean-cache'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('clean-cache'));
    });
    await waitFor(() => {
      expect(mockCleanUvCache).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalledWith('uv cache cleaned');
    });
  });

  it('handles clean cache failure', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    mockCleanUvCache.mockRejectedValue(new Error('fail'));
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('clean-cache'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('clean-cache'));
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to clean uv cache');
    });
  });

  it('handles install python', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('install-python'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('install-python'));
    });
    await waitFor(() => {
      expect(mockInstallPythonVersion).toHaveBeenCalledWith('3.11');
      expect(mockShowSuccess).toHaveBeenCalledWith('Python 3.11 installed successfully');
    });
  });

  it('handles install python failure', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    mockInstallPythonVersion.mockRejectedValue({ message: 'py error' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('install-python'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('install-python'));
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to install Python 3.11: py error');
    });
  });

  it('handles uninstall python with confirm', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('uninstall-python'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('uninstall-python'));
    });
    await waitFor(() => {
      expect(mockUninstallPythonVersion).toHaveBeenCalledWith('3.11');
      expect(mockShowSuccess).toHaveBeenCalledWith('Uninstalled Python 3.11');
    });
  });

  it('skips uninstall when user cancels confirm', async () => {
    (window as any).confirm = vi.fn().mockReturnValue(false);
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('uninstall-python'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('uninstall-python'));
    });
    expect(mockUninstallPythonVersion).not.toHaveBeenCalled();
  });

  it('handles pin python version', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('pin-python'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('pin-python'));
    });
    await waitFor(() => {
      expect(mockSetPinnedPythonVersion).toHaveBeenCalledWith('3.11');
      expect(mockShowSuccess).toHaveBeenCalledWith('Pinned Python 3.11');
    });
  });

  it('handles pin python failure', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' });
    mockSetPinnedPythonVersion.mockRejectedValue(new Error('fail'));
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('pin-python'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('pin-python'));
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to pin version');
    });
  });

  it('updates when appDataManager subscription fires', async () => {
    let subCallback: (cfg: any) => void = () => {};
    mockAppDataSubscribe.mockImplementation((cb: any) => {
      subCallback = cb;
      return () => {};
    });
    mockGetRuntimeEnvironment.mockReturnValue(null);
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await act(async () => {
      subCallback({
        runtimeEnvironment: { mode: 'system', bunVersion: '1.2.0', uvVersion: '0.3.0' },
      });
    });
    // After subscription fires, renders with data
    await waitFor(() => {
      expect(screen.getByTestId('runtime-header')).toBeTruthy();
    });
  });

  it('handles version change callback', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '1.0.0', uvVersion: '0.1.0' });
    await act(async () => {
      render(<RuntimeSettingsView />);
    });
    await waitFor(() => screen.getByTestId('version-change'));
    // Should not throw
    fireEvent.click(screen.getByTestId('version-change'));
  });
});
