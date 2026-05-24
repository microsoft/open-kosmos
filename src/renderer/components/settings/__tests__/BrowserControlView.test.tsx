// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// ---- mocks (must be before imports) ----

let capturedPhaseChange: ((phase: string) => void) | null = null;
let capturedDownloadProgress: ((p: unknown) => void) | null = null;
let capturedUpdatePhaseChange: ((phase: string) => void) | null = null;
let capturedUpdateDownloadProgress: ((p: unknown) => void) | null = null;
let capturedBrowserInstallConfirm: ((data: { requestId: string; browserName: string }) => void) | null = null;
let capturedNativeServerDownloadConfirm: ((data: { requestId: string }) => void) | null = null;
let capturedBrowserRestartConfirm: ((data: { requestId: string; browserName: string }) => void) | null = null;

vi.mock('../BrowserControlHeaderView', () => ({
  default: () => <div data-testid="browser-control-header">Header</div>,
}));

const mockContentViewProps: Record<string, unknown> = {};
vi.mock('../BrowserControlContentView', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(mockContentViewProps, props);
    return (
      <div data-testid="browser-control-content">
        <span data-testid="mode">{String(props.mode)}</span>
        <span data-testid="is-enabled">{String(props.isEnabled)}</span>
        <span data-testid="is-installing">{String(props.isInstalling)}</span>
        <span data-testid="is-loading">{String(props.isLoading)}</span>
        <span data-testid="update-status">{String(props.updateStatus)}</span>
        <span data-testid="cdp-enabled">{String(props.isCdpEnabled)}</span>
        <button data-testid="toggle-btn" onClick={() => (props.onToggle as () => void)()}>Toggle</button>
        <button data-testid="mode-change-extension" onClick={() => (props.onModeChange as (m: string) => void)('extension')}>To Extension</button>
        <button data-testid="mode-change-cdp" onClick={() => (props.onModeChange as (m: string) => void)('cdp')}>To CDP</button>
        <button data-testid="cdp-enable-btn" onClick={() => (props.onCdpEnable as () => void)()}>Enable CDP</button>
        <button data-testid="cdp-disable-btn" onClick={() => (props.onCdpDisable as () => void)()}>Disable CDP</button>
        <button data-testid="update-btn" onClick={() => (props.onUpdate as () => void)()}>Update</button>
        <button data-testid="reinstall-btn" onClick={() => (props.onReinstallExtension as () => void)()}>Reinstall</button>
        <button data-testid="launch-btn" onClick={() => (props.onLaunchBrowser as () => void)()}>Launch</button>
        <button data-testid="browser-change-btn" onClick={() => (props.onBrowserChange as (b: string) => void)('chrome')}>Chrome</button>
      </div>
    );
  },
}));

vi.mock('../../styles/BrowserControlView.css', () => ({}));
vi.mock('../../styles/RuntimeSettings.css', () => ({}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../../ipc/browserControl', () => ({
  browserControlApi: {
    getSettings: vi.fn(),
    getStatus: vi.fn(),
    getInstallStatus: vi.fn(),
    getUpdateStatus: vi.fn(),
    checkNativeServerUpdate: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    reinstallExtension: vi.fn(),
    launchWithSnap: vi.fn(),
    updateNativeServer: vi.fn(),
    updateSettings: vi.fn(),
    respondBrowserInstallConfirm: vi.fn(),
    respondNativeServerDownloadConfirm: vi.fn(),
    respondBrowserRestartConfirm: vi.fn(),
  },
}));

// ---- imports after mocks ----

import BrowserControlView from '../BrowserControlView';
import { browserControlApi } from '../../../ipc/browserControl';

const api = vi.mocked(browserControlApi);

// ---- helpers ----

function setupElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      browserControl: {
        onPhaseChange: (cb: (phase: string) => void) => {
          capturedPhaseChange = cb;
          return vi.fn();
        },
        onDownloadProgress: (cb: (p: unknown) => void) => {
          capturedDownloadProgress = cb;
          return vi.fn();
        },
        onUpdatePhaseChange: (cb: (phase: string) => void) => {
          capturedUpdatePhaseChange = cb;
          return vi.fn();
        },
        onUpdateDownloadProgress: (cb: (p: unknown) => void) => {
          capturedUpdateDownloadProgress = cb;
          return vi.fn();
        },
        onShowBrowserInstallConfirm: (cb: (data: { requestId: string; browserName: string }) => void) => {
          capturedBrowserInstallConfirm = cb;
          return vi.fn();
        },
        onShowNativeServerDownloadConfirm: (cb: (data: { requestId: string }) => void) => {
          capturedNativeServerDownloadConfirm = cb;
          return vi.fn();
        },
        onShowBrowserRestartConfirm: (cb: (data: { requestId: string; browserName: string }) => void) => {
          capturedBrowserRestartConfirm = cb;
          return vi.fn();
        },
      },
      devToolsMcp: {
        getStatus: vi.fn().mockResolvedValue({ success: true, data: { enabled: false } }),
        enable: vi.fn().mockResolvedValue({ success: true }),
        disable: vi.fn().mockResolvedValue({ success: true }),
      },
    },
  });
}

// ---- tests ----

describe('BrowserControlView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPhaseChange = null;
    capturedDownloadProgress = null;
    capturedUpdatePhaseChange = null;
    capturedUpdateDownloadProgress = null;
    capturedBrowserInstallConfirm = null;
    capturedNativeServerDownloadConfirm = null;
    capturedBrowserRestartConfirm = null;

    api.getSettings.mockResolvedValue({ success: true, data: { browser: 'edge', mode: 'extension' } });
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: false } });
    api.getInstallStatus.mockResolvedValue({ success: true, data: { isInstalling: false, phase: 'idle', progress: 0 } });
    api.getUpdateStatus.mockResolvedValue({ success: true, data: { isUpdating: false, phase: 'idle', progress: 0, localVersion: '1.0.0', remoteVersion: null } });
    api.checkNativeServerUpdate.mockResolvedValue({ success: true, data: { needsUpdate: false, localVersion: '1.0.0', remoteVersion: '1.0.0' } });
    api.enable.mockResolvedValue({ success: true });
    api.disable.mockResolvedValue({ success: true });
    api.reinstallExtension.mockResolvedValue({ success: true });
    api.launchWithSnap.mockResolvedValue({ success: true });
    api.updateNativeServer.mockResolvedValue({ success: true });
    api.updateSettings.mockResolvedValue({ success: true });
    api.respondBrowserInstallConfirm.mockResolvedValue({ success: true });
    api.respondNativeServerDownloadConfirm.mockResolvedValue({ success: true });
    api.respondBrowserRestartConfirm.mockResolvedValue({ success: true });

    setupElectronApi();
  });

  it('renders header and content sub-components', async () => {
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(screen.getByTestId('browser-control-header')).toBeInTheDocument();
      expect(screen.getByTestId('browser-control-content')).toBeInTheDocument();
    });
  });

  it('calls getSettings, getStatus, getInstallStatus on mount', async () => {
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(api.getSettings).toHaveBeenCalled();
      expect(api.getStatus).toHaveBeenCalled();
      expect(api.getInstallStatus).toHaveBeenCalled();
    });
  });

  it('passes default mode=extension and isEnabled=false to content', async () => {
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(screen.getByTestId('mode').textContent).toBe('extension');
      expect(screen.getByTestId('is-enabled').textContent).toBe('false');
    });
  });

  it('sets isEnabled=true when getStatus returns enabled=true', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(screen.getByTestId('is-enabled').textContent).toBe('true');
    });
  });

  it('restores installing state from getInstallStatus', async () => {
    api.getInstallStatus.mockResolvedValue({
      success: true,
      data: { isInstalling: true, phase: 'downloading', progress: 50 },
    });
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(screen.getByTestId('is-installing').textContent).toBe('true');
    });
  });

  it('restores updating state from getUpdateStatus', async () => {
    api.getUpdateStatus.mockResolvedValue({
      success: true,
      data: { isUpdating: true, phase: 'downloading', progress: 30, localVersion: '1.0', remoteVersion: '2.0' },
    });
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(screen.getByTestId('update-status').textContent).toBe('updating');
    });
  });

  it('sets isCdpEnabled=true when devToolsMcp.getStatus returns enabled=true', async () => {
    (window as any).electronAPI.devToolsMcp.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(screen.getByTestId('cdp-enabled').textContent).toBe('true');
    });
  });

  it('handles toggle to enable', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-btn')); });
    expect(api.enable).toHaveBeenCalled();
  });

  it('handles toggle to disable', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-enabled').textContent).toBe('true'));
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-btn')); });
    expect(api.disable).toHaveBeenCalled();
  });

  it('handles phase change "completed" - sets isEnabled and clears installing', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedPhaseChange).not.toBeNull());
    await act(async () => { capturedPhaseChange!('completed'); });
    await waitFor(() => expect(screen.getByTestId('is-enabled').textContent).toBe('true'));
  });

  it('handles phase change "downloading"', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedPhaseChange).not.toBeNull());
    await act(async () => { capturedPhaseChange!('downloading'); });
    // no crash
  });

  it('handles phase change "error" - clears installing', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedPhaseChange).not.toBeNull());
    await act(async () => { capturedPhaseChange!('error'); });
    await waitFor(() => expect(screen.getByTestId('is-installing').textContent).toBe('false'));
  });

  it('handles download progress event', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedDownloadProgress).not.toBeNull());
    await act(async () => { capturedDownloadProgress!({ percent: 75, transferred: '75MB', total: '100MB' }); });
    // no crash
  });

  it('handles update phase change "completed"', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedUpdatePhaseChange).not.toBeNull());
    await act(async () => { capturedUpdatePhaseChange!('completed'); });
    await waitFor(() => expect(screen.getByTestId('update-status').textContent).toBe('up-to-date'));
  });

  it('handles update phase change "error"', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedUpdatePhaseChange).not.toBeNull());
    await act(async () => { capturedUpdatePhaseChange!('error'); });
    await waitFor(() => expect(screen.getByTestId('update-status').textContent).toBe('available'));
  });

  it('handles update download progress event', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedUpdateDownloadProgress).not.toBeNull());
    await act(async () => { capturedUpdateDownloadProgress!({ percent: 50, transferred: '50MB', total: '100MB' }); });
    // no crash
  });

  it('opens browser install confirm dialog and accepts', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedBrowserInstallConfirm).not.toBeNull());
    await act(async () => {
      capturedBrowserInstallConfirm!({ requestId: 'req-1', browserName: 'Microsoft Edge' });
    });

    expect(screen.getByText('Browser Not Installed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(api.respondBrowserInstallConfirm).toHaveBeenCalledWith('req-1', true);
    });
  });

  it('opens browser install confirm dialog and cancels', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedBrowserInstallConfirm).not.toBeNull());
    await act(async () => {
      capturedBrowserInstallConfirm!({ requestId: 'req-1', browserName: 'Google Chrome' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(api.respondBrowserInstallConfirm).toHaveBeenCalledWith('req-1', false);
    });
  });

  it('opens native server download confirm dialog and accepts', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedNativeServerDownloadConfirm).not.toBeNull());
    await act(async () => {
      capturedNativeServerDownloadConfirm!({ requestId: 'req-ns-1' });
    });

    expect(screen.getByText('Native Server Required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(api.respondNativeServerDownloadConfirm).toHaveBeenCalledWith('req-ns-1', true);
    });
  });

  it('opens native server download confirm dialog and cancels', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedNativeServerDownloadConfirm).not.toBeNull());
    await act(async () => {
      capturedNativeServerDownloadConfirm!({ requestId: 'req-ns-2' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(api.respondNativeServerDownloadConfirm).toHaveBeenCalledWith('req-ns-2', false);
    });
  });

  it('opens browser restart confirm dialog and accepts', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedBrowserRestartConfirm).not.toBeNull());
    await act(async () => {
      capturedBrowserRestartConfirm!({ requestId: 'req-restart-1', browserName: 'Microsoft Edge' });
    });

    expect(screen.getByText('Browser Restart Required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

    await waitFor(() => {
      expect(api.respondBrowserRestartConfirm).toHaveBeenCalledWith('req-restart-1', true);
    });
  });

  it('opens browser restart confirm dialog and skips', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedBrowserRestartConfirm).not.toBeNull());
    await act(async () => {
      capturedBrowserRestartConfirm!({ requestId: 'req-restart-2', browserName: 'Microsoft Edge' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(api.respondBrowserRestartConfirm).toHaveBeenCalledWith('req-restart-2', false);
    });
  });

  it('triggers update handler', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('update-btn')); });
    expect(api.updateNativeServer).toHaveBeenCalled();
  });

  it('triggers reinstall extension handler', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('reinstall-btn')); });
    expect(api.reinstallExtension).toHaveBeenCalled();
  });

  it('triggers launch browser handler', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('launch-btn')); });
    expect(api.launchWithSnap).toHaveBeenCalled();
  });

  it('changes browser selection', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('browser-change-btn')); });
    expect(api.updateSettings).toHaveBeenCalledWith({ browser: 'chrome' });
  });

  it('blocks mode switch when extension mode is active (enabled)', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-enabled').textContent).toBe('true'));
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-cdp')); });
    // Should show blocked dialog
    await waitFor(() => expect(screen.getByText('Cannot Switch Mode')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByText('Cannot Switch Mode')).not.toBeInTheDocument());
  });

  it('allows mode switch when extension mode is inactive', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-cdp')); });
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('cdp'));
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it('same mode switch does nothing', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-extension')); });
    // mode is already extension, should not change
    expect(screen.getByTestId('mode').textContent).toBe('extension');
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  it('opens CDP enable dialog and confirms', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));

    // Switch to CDP mode first
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-cdp')); });
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('cdp'));

    await act(async () => { fireEvent.click(screen.getByTestId('cdp-enable-btn')); });
    await waitFor(() => expect(screen.getByText('Enable Remote Debugging')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect((window as any).electronAPI.devToolsMcp.enable).toHaveBeenCalled();
      expect(screen.getByTestId('cdp-enabled').textContent).toBe('true');
    });
  });

  it('opens CDP enable dialog and cancels', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-cdp')); });

    await act(async () => { fireEvent.click(screen.getByTestId('cdp-enable-btn')); });
    await waitFor(() => expect(screen.getByText('Enable Remote Debugging')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Enable Remote Debugging')).not.toBeInTheDocument());
    expect((window as any).electronAPI.devToolsMcp.enable).not.toHaveBeenCalled();
  });

  it('copies CDP URL when copy button is clicked', async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => ({ writeText: clipboardWriteText }),
    });

    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-cdp')); });
    await act(async () => { fireEvent.click(screen.getByTestId('cdp-enable-btn')); });
    await waitFor(() => expect(screen.getByText('Enable Remote Debugging')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith('chrome://inspect/#remote-debugging'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument());
  });

  it('opens CDP disable dialog and confirms', async () => {
    (window as any).electronAPI.devToolsMcp.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('true'));

    await act(async () => { fireEvent.click(screen.getByTestId('cdp-disable-btn')); });
    await waitFor(() => expect(screen.getByText('Disable Remote Debugging')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect((window as any).electronAPI.devToolsMcp.disable).toHaveBeenCalled();
      expect(screen.getByTestId('cdp-enabled').textContent).toBe('false');
    });
  });

  it('opens CDP disable dialog and cancels', async () => {
    (window as any).electronAPI.devToolsMcp.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('true'));

    await act(async () => { fireEvent.click(screen.getByTestId('cdp-disable-btn')); });
    await waitFor(() => expect(screen.getByText('Disable Remote Debugging')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Disable Remote Debugging')).not.toBeInTheDocument());
    expect((window as any).electronAPI.devToolsMcp.disable).not.toHaveBeenCalled();
  });

  it('checks for native server update when enabled', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.checkNativeServerUpdate.mockResolvedValue({
      success: true,
      data: { needsUpdate: true, localVersion: '1.0.0', remoteVersion: '2.0.0' },
    });
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(api.checkNativeServerUpdate).toHaveBeenCalled();
      expect(screen.getByTestId('update-status').textContent).toBe('available');
    });
  });

  it('handles checkNativeServerUpdate failure gracefully', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.checkNativeServerUpdate.mockRejectedValue(new Error('Network error'));
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(screen.getByTestId('update-status').textContent).toBe('up-to-date');
    });
  });

  it('handles toggle enable failure gracefully', async () => {
    api.enable.mockRejectedValue(new Error('Permission denied'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-btn')); });
    // Should not crash
    expect(api.enable).toHaveBeenCalled();
  });

  it('handles reinstall failure gracefully', async () => {
    api.reinstallExtension.mockRejectedValue(new Error('Reinstall failed'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('reinstall-btn')); });
    expect(api.reinstallExtension).toHaveBeenCalled();
  });

  it('handles CDP enable failure', async () => {
    (window as any).electronAPI.devToolsMcp.enable.mockResolvedValue({ success: false, error: 'Permission denied' });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-cdp')); });
    await act(async () => { fireEvent.click(screen.getByTestId('cdp-enable-btn')); });
    await waitFor(() => expect(screen.getByText('Enable Remote Debugging')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    // No crash, cdp stays disabled
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('false'));
  });

  it('handles CDP disable failure', async () => {
    (window as any).electronAPI.devToolsMcp.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    (window as any).electronAPI.devToolsMcp.disable.mockResolvedValue({ success: false, error: 'Cannot disable' });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('true'));
    await act(async () => { fireEvent.click(screen.getByTestId('cdp-disable-btn')); });
    await waitFor(() => expect(screen.getByText('Disable Remote Debugging')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    // Should show error in status message, cdp stays enabled
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('true'));
  });

  it('blocks mode switch from cdp when CDP is enabled', async () => {
    (window as any).electronAPI.devToolsMcp.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.getSettings.mockResolvedValue({ success: true, data: { browser: 'edge', mode: 'cdp' } });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('cdp'));

    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-extension')); });
    await waitFor(() => expect(screen.getByText('Cannot Switch Mode')).toBeInTheDocument());
  });

  it('handles status check failure gracefully', async () => {
    api.getSettings.mockRejectedValue(new Error('Network error'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    // Should render without crash
    expect(screen.getByTestId('browser-control-content')).toBeInTheDocument();
  });

  it('handles checkNativeServerUpdate returning no data', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.checkNativeServerUpdate.mockResolvedValue({ success: true, data: null });
    render(<BrowserControlView />);
    await waitFor(() => {
      expect(api.checkNativeServerUpdate).toHaveBeenCalled();
      expect(screen.getByTestId('update-status').textContent).toBe('up-to-date');
    });
  });

  it('handles update phase change "downloading"', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedUpdatePhaseChange).not.toBeNull());
    await act(async () => { capturedUpdatePhaseChange!('downloading'); });
    // No crash - sets update progress
  });

  it('handles toggle enable returning success=false', async () => {
    api.enable.mockResolvedValue({ success: false, error: 'Permission denied' });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-btn')); });
    expect(api.enable).toHaveBeenCalled();
  });

  it('handles toggle disable returning failure', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.disable.mockResolvedValue({ success: false, error: 'Cannot disable' });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-enabled').textContent).toBe('true'));
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-btn')); });
    expect(api.disable).toHaveBeenCalled();
  });

  it('handles reinstall returning success=false', async () => {
    api.reinstallExtension.mockResolvedValue({ success: false, error: 'Failed' });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('reinstall-btn')); });
    expect(api.reinstallExtension).toHaveBeenCalled();
  });

  it('handles launch browser failure', async () => {
    api.launchWithSnap.mockRejectedValue(new Error('Launch failed'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('launch-btn')); });
    expect(api.launchWithSnap).toHaveBeenCalled();
  });

  it('handles launch browser returning failure', async () => {
    api.launchWithSnap.mockResolvedValue({ success: false, error: 'Failed' });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('launch-btn')); });
    expect(api.launchWithSnap).toHaveBeenCalled();
  });

  it('handles handleUpdate failure via rejection', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.updateNativeServer.mockRejectedValue(new Error('Update failed'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('update-btn')); });
    expect(api.updateNativeServer).toHaveBeenCalled();
  });

  it('handles handleUpdate returning no success', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.updateNativeServer.mockResolvedValue({ success: false, error: 'Server error' });
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('update-btn')); });
    expect(api.updateNativeServer).toHaveBeenCalled();
  });

  it('handles browser change failure', async () => {
    api.updateSettings.mockRejectedValue(new Error('Settings save failed'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('browser-change-btn')); });
    expect(api.updateSettings).toHaveBeenCalled();
  });

  it('handles CDP enable exception', async () => {
    (window as any).electronAPI.devToolsMcp.enable.mockRejectedValue(new Error('CDP error'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
    await act(async () => { fireEvent.click(screen.getByTestId('mode-change-cdp')); });
    await act(async () => { fireEvent.click(screen.getByTestId('cdp-enable-btn')); });
    await waitFor(() => expect(screen.getByText('Enable Remote Debugging')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    // Should handle error gracefully
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('false'));
  });

  it('handles CDP disable exception', async () => {
    (window as any).electronAPI.devToolsMcp.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    (window as any).electronAPI.devToolsMcp.disable.mockRejectedValue(new Error('CDP disable error'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('true'));
    await act(async () => { fireEvent.click(screen.getByTestId('cdp-disable-btn')); });
    await waitFor(() => expect(screen.getByText('Disable Remote Debugging')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    // Should handle error gracefully
    await waitFor(() => expect(screen.getByTestId('cdp-enabled').textContent).toBe('true'));
  });

  it('closes install confirm dialog via onOpenChange', async () => {
    render(<BrowserControlView />);
    await waitFor(() => expect(capturedBrowserInstallConfirm).not.toBeNull());
    await act(async () => {
      capturedBrowserInstallConfirm!({ requestId: 'req-oc', browserName: 'Chrome' });
    });
    expect(screen.getByText('Browser Not Installed')).toBeInTheDocument();
    // Cancel to close dialog (simulates onOpenChange)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Browser Not Installed')).not.toBeInTheDocument());
  });

  it('handles toggle disable catch (api.disable throws)', async () => {
    api.getStatus.mockResolvedValue({ success: true, data: { enabled: true } });
    api.disable.mockRejectedValue(new Error('Disable exception'));
    render(<BrowserControlView />);
    await waitFor(() => expect(screen.getByTestId('is-enabled').textContent).toBe('true'));
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-btn')); });
    expect(api.disable).toHaveBeenCalled();
    // Should not crash - component still renders
    expect(screen.getByTestId('browser-control-content')).toBeInTheDocument();
  });
});

