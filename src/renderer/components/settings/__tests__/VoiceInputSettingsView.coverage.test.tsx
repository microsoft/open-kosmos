// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// ---- mocks ----

vi.mock('../VoiceInputSettingsHeaderView', () => ({
  default: () => <div data-testid="voice-header">Header</div>,
}));

const mockContentProps: Record<string, unknown> = {};
vi.mock('../VoiceInputSettingsContentView', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(mockContentProps, props);
    return (
      <div data-testid="voice-content">
        <span data-testid="loading">{String(props.loading)}</span>
        <span data-testid="voice-enabled">{String(props.voiceInputEnabled)}</span>
        <span data-testid="addon-status">{String(props.addonStatus)}</span>
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

function makeElectronAPI(overrides: Record<string, unknown> = {}) {
  return {
    whisper: {
      getAllModelStatus: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getAllModelInfo: vi.fn().mockResolvedValue({ success: true, data: [] }),
      downloadModel: vi.fn().mockResolvedValue({ success: true }),
      deleteModel: vi.fn().mockResolvedValue({ success: true }),
      cancelDownload: vi.fn().mockResolvedValue({ success: true }),
      onDownloadProgress: vi.fn().mockReturnValue(mockUnsubscribe),
      onDownloadComplete: vi.fn().mockReturnValue(mockUnsubscribe),
      onDownloadError: vi.fn().mockReturnValue(mockUnsubscribe),
      onDownloadCancelled: vi.fn().mockReturnValue(mockUnsubscribe),
    },
    appConfig: {
      getAppConfig: vi.fn().mockResolvedValue({
        success: true,
        data: {
          voiceInput: {
            voiceInputEnabled: false,
            whisperModelSelected: 'base',
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
      onDownloadProgress: vi.fn().mockReturnValue(mockUnsubscribe),
      onDownloadComplete: vi.fn().mockReturnValue(mockUnsubscribe),
      onDownloadCancelled: vi.fn().mockReturnValue(mockUnsubscribe),
      onDownloadError: vi.fn().mockReturnValue(mockUnsubscribe),
    },
    ...overrides,
  };
}

function setup(electronOverrides: Record<string, unknown> = {}) {
  (window as any).electronAPI = makeElectronAPI(electronOverrides);
}

// ---- tests ----

import VoiceInputSettingsView from '../VoiceInputSettingsView';

describe('VoiceInputSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureFlag.mockReturnValue(true);
    setup();
  });

  it('renders header and content when feature flag is enabled', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('voice-header')).toBeTruthy();
      expect(screen.getByTestId('voice-content')).toBeTruthy();
    });
  });

  it('redirects to /settings when feature flag is disabled', () => {
    mockFeatureFlag.mockReturnValue(false);
    render(<VoiceInputSettingsView />);
    const nav = screen.getByTestId('navigate');
    expect(nav.getAttribute('data-to')).toBe('/settings');
  });

  it('loads app config, model status and model info on mount', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect((window as any).electronAPI.appConfig.getAppConfig).toHaveBeenCalled();
      expect((window as any).electronAPI.whisper.getAllModelStatus).toHaveBeenCalled();
      expect((window as any).electronAPI.whisper.getAllModelInfo).toHaveBeenCalled();
    });
  });

  it('sets voiceInputEnabled from loaded config', async () => {
    (window as any).electronAPI.appConfig.getAppConfig = vi.fn().mockResolvedValue({
      success: true,
      data: { voiceInput: { voiceInputEnabled: true, whisperModelSelected: 'base', recognitionLanguage: 'auto', gpuAcceleration: false } },
    });
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('voice-enabled').textContent).toBe('true');
    });
  });

  it('sets addonStatus from nativeModule.getStatus', async () => {
    (window as any).electronAPI.nativeModule.getStatus = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'downloaded' },
    });
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('addon-status').textContent).toBe('downloaded');
    });
  });

  it('subscribes to whisper download events and unsubscribes on unmount', async () => {
    const { unmount } = render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect((window as any).electronAPI.whisper.onDownloadProgress).toHaveBeenCalled();
    });
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('subscribes to nativeModule download events and unsubscribes on unmount', async () => {
    const { unmount } = render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect((window as any).electronAPI.nativeModule.onDownloadProgress).toHaveBeenCalled();
    });
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('passes handlers to content view', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(typeof mockContentProps.onToggleVoiceInput).toBe('function');
      expect(typeof mockContentProps.onDownloadModel).toBe('function');
      expect(typeof mockContentProps.onDeleteModel).toBe('function');
      expect(typeof mockContentProps.onCancelDownload).toBe('function');
      expect(typeof mockContentProps.onSettingsChange).toBe('function');
      expect(typeof mockContentProps.onDeleteAddon).toBe('function');
      expect(typeof mockContentProps.onCancelEnabling).toBe('function');
    });
  });

  it('handleToggleVoiceInput(false) disables voice input', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onToggleVoiceInput).toBe('function'));
    await act(async () => {
      await (mockContentProps.onToggleVoiceInput as (v: boolean) => Promise<void>)(false);
    });
    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith({
      voiceInput: { voiceInputEnabled: false },
    });
  });

  it('handleToggleVoiceInput(true) with both already ready enables immediately', async () => {
    (window as any).electronAPI.nativeModule.getStatus = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'downloaded' },
    });
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onToggleVoiceInput).toBe('function'));
    // after mount, addonStatus should be 'downloaded'
    await waitFor(() => expect(screen.getByTestId('addon-status').textContent).toBe('downloaded'));
    await act(async () => {
      await (mockContentProps.onToggleVoiceInput as (v: boolean) => Promise<void>)(true);
    });
    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith({
      voiceInput: { voiceInputEnabled: true },
    });
  });

  it('handleDownloadModel calls whisper.downloadModel', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onDownloadModel).toBe('function'));
    await act(async () => {
      await (mockContentProps.onDownloadModel as (s: string) => Promise<void>)('tiny');
    });
    expect((window as any).electronAPI.whisper.downloadModel).toHaveBeenCalledWith('tiny');
  });

  it('handleDeleteModel calls whisper.deleteModel and reloads status', async () => {
    (window as any).electronAPI.whisper.deleteModel = vi.fn().mockResolvedValue({ success: true });
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onDeleteModel).toBe('function'));
    await act(async () => {
      await (mockContentProps.onDeleteModel as (s: string) => Promise<void>)('tiny');
    });
    expect((window as any).electronAPI.whisper.deleteModel).toHaveBeenCalledWith('tiny');
    expect((window as any).electronAPI.whisper.getAllModelStatus).toHaveBeenCalledTimes(2);
  });

  it('handleCancelDownload calls whisper.cancelDownload', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onCancelDownload).toBe('function'));
    await act(async () => {
      await (mockContentProps.onCancelDownload as (s: string) => Promise<void>)('base');
    });
    expect((window as any).electronAPI.whisper.cancelDownload).toHaveBeenCalledWith('base');
  });

  it('handleSettingsChange calls voiceInput.updateSettings', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onSettingsChange).toBe('function'));
    const newSettings = { whisperModel: 'small' as const, language: 'en', useGPU: true, translate: false };
    await act(async () => {
      await (mockContentProps.onSettingsChange as (s: typeof newSettings) => Promise<void>)(newSettings);
    });
    expect((window as any).electronAPI.voiceInput.updateSettings).toHaveBeenCalledWith(newSettings);
  });

  it('handleDeleteAddon calls nativeModule.deleteModule and disables voice input', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onDeleteAddon).toBe('function'));
    await act(async () => {
      await (mockContentProps.onDeleteAddon as () => Promise<void>)();
    });
    expect((window as any).electronAPI.nativeModule.deleteModule).toHaveBeenCalledWith('whisper-addon');
    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith({
      voiceInput: { voiceInputEnabled: false },
    });
  });

  it('handleCancelEnabling cancels both downloads', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(typeof mockContentProps.onCancelEnabling).toBe('function'));
    await act(async () => {
      await (mockContentProps.onCancelEnabling as () => Promise<void>)();
    });
    expect((window as any).electronAPI.nativeModule.cancelDownload).toHaveBeenCalledWith('whisper-addon');
    expect((window as any).electronAPI.whisper.cancelDownload).toHaveBeenCalledWith('base');
  });

  it('handles missing nativeModule gracefully', async () => {
    (window as any).electronAPI.nativeModule = undefined;
    expect(() => render(<VoiceInputSettingsView />)).not.toThrow();
    await waitFor(() => {
      expect(screen.getByTestId('voice-content')).toBeTruthy();
    });
  });

  it('handles missing whisper API gracefully', async () => {
    (window as any).electronAPI.whisper = undefined;
    expect(() => render(<VoiceInputSettingsView />)).not.toThrow();
  });

  it('loading starts true and becomes false after data load', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });
});
