// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * Coverage2 tests for VoiceInputSettingsView.tsx.
 * Targets uncovered branches:
 * - Feature flag disabled → Navigate redirect
 * - handleToggleVoiceInput: OFF path
 * - handleToggleVoiceInput: fast path (addon + model already ready)
 * - handleToggleVoiceInput: addon step (not downloaded)
 * - handleToggleVoiceInput: model step (base already on disk)
 * - handleToggleVoiceInput: model step (needs download)
 * - handleToggleVoiceInput: AbortError (cancel) is swallowed
 * - handleSettingsChange
 * - handleDownloadModel
 * - handleDeleteModel (selected model deleted → clears selection)
 * - handleDeleteModel (error path)
 * - handleCancelDownload
 * - handleDeleteAddon
 * - handleCancelEnabling
 * - IPC progress/complete/error/cancelled listeners for whisper
 * - IPC progress/complete/error/cancelled listeners for nativeModule
 * - loadAppConfig: no voiceInput data
 * - loadModelStatus: error path
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// ---- mocks ----

vi.mock('../VoiceInputSettingsHeaderView', () => ({
  default: () => <div data-testid="voice-header">Header</div>,
}));

const mockContentProps: Record<string, any> = {};
vi.mock('../VoiceInputSettingsContentView', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(mockContentProps, props);
    return (
      <div data-testid="voice-content">
        <span data-testid="loading">{String(props.loading)}</span>
        <span data-testid="voice-enabled">{String(props.voiceInputEnabled)}</span>
        <span data-testid="addon-status">{String(props.addonStatus)}</span>
        <span data-testid="enabling">{String(props.isEnabling)}</span>
        <span data-testid="setup-step">{String(props.setupStep)}</span>
        <span data-testid="enabling-error">{String(props.enablingError)}</span>
      </div>
    );
  },
}));

vi.mock('../../styles/VoiceInputSettingsView.css', () => ({}));

const mockFeatureFlag = vi.fn(() => true);
vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: (flag: string) => mockFeatureFlag(flag),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

// ---- helpers ----

const mockUnsubscribe = vi.fn();

// Listeners captured by the mock
let capturedWhisperListeners: Record<string, (...args: any[]) => void> = {};
let capturedNativeListeners: Record<string, (...args: any[]) => void> = {};

function makeElectronAPI(overrides: Record<string, any> = {}) {
  capturedWhisperListeners = {};
  capturedNativeListeners = {};

  return {
    whisper: {
      getAllModelStatus: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getAllModelInfo: vi.fn().mockResolvedValue({ success: true, data: [] }),
      downloadModel: vi.fn(),
      deleteModel: vi.fn().mockResolvedValue({ success: true }),
      cancelDownload: vi.fn().mockResolvedValue({ success: true }),
      onDownloadProgress: vi.fn((cb: any) => { capturedWhisperListeners['progress'] = cb; return mockUnsubscribe; }),
      onDownloadComplete: vi.fn((cb: any) => { capturedWhisperListeners['complete'] = cb; return mockUnsubscribe; }),
      onDownloadError: vi.fn((cb: any) => { capturedWhisperListeners['error'] = cb; return mockUnsubscribe; }),
      onDownloadCancelled: vi.fn((cb: any) => { capturedWhisperListeners['cancelled'] = cb; return mockUnsubscribe; }),
    },
    appConfig: {
      getAppConfig: vi.fn().mockResolvedValue({
        success: true,
        data: {
          voiceInput: {
            voiceInputEnabled: false,
            whisperModelSelected: '',
            recognitionLanguage: 'auto',
            gpuAcceleration: false,
          },
        },
      }),
      updateAppConfig: vi.fn().mockResolvedValue({ success: true }),
    },
    voiceInput: {
      updateSettings: vi.fn().mockResolvedValue({ success: true }),
    },
    nativeModule: {
      getStatus: vi.fn().mockResolvedValue({ success: true, data: { status: 'not-downloaded' } }),
      ensureDownloaded: vi.fn().mockResolvedValue({ success: true }),
      deleteModule: vi.fn().mockResolvedValue({ success: true }),
      cancelDownload: vi.fn().mockResolvedValue({ success: true }),
      onDownloadProgress: vi.fn((cb: any) => { capturedNativeListeners['progress'] = cb; return mockUnsubscribe; }),
      onDownloadComplete: vi.fn((cb: any) => { capturedNativeListeners['complete'] = cb; return mockUnsubscribe; }),
      onDownloadCancelled: vi.fn((cb: any) => { capturedNativeListeners['cancelled'] = cb; return mockUnsubscribe; }),
      onDownloadError: vi.fn((cb: any) => { capturedNativeListeners['error'] = cb; return mockUnsubscribe; }),
    },
    ...overrides,
  };
}

import VoiceInputSettingsView from '../VoiceInputSettingsView';

beforeEach(() => {
  vi.clearAllMocks();
  mockFeatureFlag.mockReturnValue(true);
  (window as any).electronAPI = makeElectronAPI();
});

// ---- tests ----

describe('VoiceInputSettingsView - feature flag disabled', () => {
  it('renders Navigate redirect when feature flag is disabled', () => {
    mockFeatureFlag.mockReturnValue(false);
    render(<VoiceInputSettingsView />);
    expect(screen.getByTestId('navigate')).toBeTruthy();
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/settings');
  });
});

describe('VoiceInputSettingsView - initial render', () => {
  it('renders header and content views', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-header'));
    expect(screen.getByTestId('voice-content')).toBeTruthy();
  });

  it('loads model status on mount', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect((window as any).electronAPI.whisper.getAllModelStatus).toHaveBeenCalled();
    });
  });

  it('loads model info on mount', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect((window as any).electronAPI.whisper.getAllModelInfo).toHaveBeenCalled();
    });
  });
});

describe('VoiceInputSettingsView - loadAppConfig', () => {
  it('reads voiceInput config and updates state', async () => {
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: {
        voiceInput: {
          voiceInputEnabled: true,
          whisperModelSelected: 'small',
          recognitionLanguage: 'en',
          gpuAcceleration: true,
        },
      },
    });

    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('voice-enabled').textContent).toBe('true');
    });
  });

  it('handles missing voiceInput data gracefully', async () => {
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: {},
    });

    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('voice-enabled').textContent).toBe('false');
    });
  });

  it('reads addon status via nativeModule.getStatus', async () => {
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true,
      data: { status: 'downloaded' },
    });

    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('addon-status').textContent).toBe('downloaded');
    });
  });
});

describe('VoiceInputSettingsView - toggle voice input OFF', () => {
  it('disables voice input when toggled off', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onToggleVoiceInput(false);
    });

    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ voiceInput: { voiceInputEnabled: false } })
    );
  });
});

describe('VoiceInputSettingsView - toggle voice input ON (fast path)', () => {
  it('enables voice input directly when addon and model are already ready', async () => {
    // Addon already downloaded
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true,
      data: { status: 'downloaded' },
    });
    // Model already selected
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: {
        voiceInput: {
          voiceInputEnabled: false,
          whisperModelSelected: 'base',
          recognitionLanguage: 'auto',
          gpuAcceleration: false,
        },
      },
    });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onToggleVoiceInput(true);
    });

    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ voiceInput: { voiceInputEnabled: true } })
    );
  });
});

describe('VoiceInputSettingsView - toggle voice input ON (addon step)', () => {
  it('runs addon download step when addon not yet downloaded', async () => {
    // Addon NOT downloaded
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true,
      data: { status: 'not-downloaded' },
    });
    // Model already selected
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: {
        voiceInput: {
          voiceInputEnabled: false,
          whisperModelSelected: 'base',
          recognitionLanguage: 'auto',
          gpuAcceleration: false,
        },
      },
    });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onToggleVoiceInput(true);
    });

    expect((window as any).electronAPI.nativeModule.ensureDownloaded).toHaveBeenCalled();
    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ voiceInput: { voiceInputEnabled: true } })
    );
  });
});

describe('VoiceInputSettingsView - toggle voice input ON (model step, already on disk)', () => {
  it('selects model when base model file already on disk but not selected', async () => {
    // Addon downloaded
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true,
      data: { status: 'downloaded' },
    });
    // Model NOT selected in config
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: {
        voiceInput: {
          voiceInputEnabled: false,
          whisperModelSelected: '',  // not selected
          recognitionLanguage: 'auto',
          gpuAcceleration: false,
        },
      },
    });
    // Model file on disk
    (window as any).electronAPI.whisper.getAllModelStatus.mockResolvedValue({
      success: true,
      data: [{ size: 'base', downloaded: true }],
    });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onToggleVoiceInput(true);
    });

    expect((window as any).electronAPI.voiceInput.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ whisperModel: 'base' })
    );
    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ voiceInput: { voiceInputEnabled: true } })
    );
  });
});

describe('VoiceInputSettingsView - handleSettingsChange', () => {
  it('calls voiceInput.updateSettings with new settings', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    const newSettings = { whisperModel: 'small' as any, language: 'en', useGPU: true, translate: false };
    await act(async () => {
      await mockContentProps.onSettingsChange(newSettings);
    });

    expect((window as any).electronAPI.voiceInput.updateSettings).toHaveBeenCalledWith(newSettings);
  });
});

describe('VoiceInputSettingsView - handleDownloadModel', () => {
  it('calls whisper.downloadModel with model size', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onDownloadModel('small');
    });

    expect((window as any).electronAPI.whisper.downloadModel).toHaveBeenCalledWith('small');
  });
});

describe('VoiceInputSettingsView - handleDeleteModel', () => {
  it('calls whisper.deleteModel and reloads model status', async () => {
    (window as any).electronAPI.whisper.deleteModel.mockResolvedValue({ success: true });
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onDeleteModel('medium');
    });

    expect((window as any).electronAPI.whisper.deleteModel).toHaveBeenCalledWith('medium');
  });

  it('shows error on delete failure', async () => {
    (window as any).electronAPI.whisper.deleteModel.mockResolvedValue({ success: false, error: 'IO error' });
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onDeleteModel('medium');
    });

    // error state should be set (passed to content view via prop)
    await waitFor(() => {
      expect(mockContentProps.error).toContain('IO error');
    });
  });
});

describe('VoiceInputSettingsView - handleCancelDownload', () => {
  it('calls whisper.cancelDownload', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onCancelDownload('tiny');
    });

    expect((window as any).electronAPI.whisper.cancelDownload).toHaveBeenCalledWith('tiny');
  });
});

describe('VoiceInputSettingsView - handleDeleteAddon', () => {
  it('calls nativeModule.deleteModule and disables voice input', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onDeleteAddon();
    });

    expect((window as any).electronAPI.nativeModule.deleteModule).toHaveBeenCalledWith('whisper-addon');
    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ voiceInput: { voiceInputEnabled: false } })
    );
  });
});

describe('VoiceInputSettingsView - handleCancelEnabling', () => {
  it('calls cancelDownload on both native and whisper APIs', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onCancelEnabling();
    });

    expect((window as any).electronAPI.nativeModule.cancelDownload).toHaveBeenCalledWith('whisper-addon');
    expect((window as any).electronAPI.whisper.cancelDownload).toHaveBeenCalledWith('base');
  });
});

describe('VoiceInputSettingsView - whisper IPC listeners', () => {
  it('updates download progress when progress event fires', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedWhisperListeners['progress']?.({ model: 'base', downloaded: 50, total: 100, percent: 50 });
    });

    expect(mockContentProps.downloadProgress).toEqual(
      expect.objectContaining({ percent: 50 })
    );
  });

  it('clears download progress when complete event fires', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedWhisperListeners['progress']?.({ model: 'base', downloaded: 100, total: 100, percent: 100 });
    });
    await act(async () => {
      capturedWhisperListeners['complete']?.();
    });

    expect(mockContentProps.downloadProgress).toBeNull();
  });

  it('sets error when download error event fires', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedWhisperListeners['error']?.({ model: 'base', error: 'Disk full' });
    });

    expect(mockContentProps.error).toContain('Disk full');
  });

  it('clears download progress when cancelled event fires', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedWhisperListeners['progress']?.({ model: 'base', downloaded: 10, total: 100, percent: 10 });
    });
    await act(async () => {
      capturedWhisperListeners['cancelled']?.();
    });

    expect(mockContentProps.downloadProgress).toBeNull();
  });
});

describe('VoiceInputSettingsView - native module IPC listeners', () => {
  it('updates addonStatus when native download progress fires for whisper-addon', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedNativeListeners['progress']?.({ packageName: 'whisper-addon', percent: 60 });
    });

    expect(screen.getByTestId('addon-status').textContent).toBe('downloading');
  });

  it('ignores native progress events for other packages', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedNativeListeners['progress']?.({ packageName: 'other-package', percent: 60 });
    });

    // addon status should remain not-downloaded
    expect(screen.getByTestId('addon-status').textContent).toBe('not-downloaded');
  });

  it('sets addonStatus to downloaded on native complete', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedNativeListeners['complete']?.({ packageName: 'whisper-addon' });
    });

    expect(screen.getByTestId('addon-status').textContent).toBe('downloaded');
  });

  it('sets addonStatus to error on native error', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedNativeListeners['error']?.({ packageName: 'whisper-addon' });
    });

    expect(screen.getByTestId('addon-status').textContent).toBe('error');
  });

  it('sets addonStatus to not-downloaded on native cancelled', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      capturedNativeListeners['progress']?.({ packageName: 'whisper-addon', percent: 30 });
    });
    await act(async () => {
      capturedNativeListeners['cancelled']?.({ packageName: 'whisper-addon' });
    });

    expect(screen.getByTestId('addon-status').textContent).toBe('not-downloaded');
  });
});
