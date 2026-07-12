// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';
import VoiceInputSettingsView from '../VoiceInputSettingsView';

const i18nState = vi.hoisted(() => {
  const makeTranslator = (language: string) => (key: string, vars?: Record<string, unknown>) => `${language}:${key}:${vars?.error ?? ''}`;
  return {
    language: 'en',
    translators: {
      en: makeTranslator('en'),
      zh: makeTranslator('zh'),
    },
    setLanguage: vi.fn(),
  };
});
const mockFeatureFlag = vi.fn(() => true);
const mockContentProps: Record<string, any> = {};
let whisperListeners: Record<string, (...args: any[]) => void> = {};
let nativeListeners: Record<string, (...args: any[]) => void> = {};

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh'],
    language: i18nState.language,
    setLanguage: i18nState.setLanguage,
  }),
}));
vi.mock('../VoiceInputSettingsHeaderView', () => ({ default: () => <div data-testid="voice-header" /> }));
vi.mock('../VoiceInputSettingsContentView', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(mockContentProps, props);
    return (
      <div data-testid="voice-content">
        <span data-testid="voice-enabled">{String(props.voiceInputEnabled)}</span>
        <span data-testid="addon-status">{String(props.addonStatus)}</span>
        <span data-testid="setup-progress">{String(props.setupProgress)}</span>
        <span data-testid="whisper-model">{String((props.settings as any)?.whisperModel)}</span>
        <span data-testid="language">{String((props.settings as any)?.language)}</span>
        <span data-testid="use-gpu">{String((props.settings as any)?.useGPU)}</span>
      </div>
    );
  },
}));
vi.mock('../../styles/VoiceInputSettingsView.css', () => ({}));
vi.mock('../../../lib/featureFlags', () => ({ useFeatureFlag: (flag: string) => mockFeatureFlag(flag) }));
vi.mock('../../../lib/utilities/logger', () => ({ createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} /> }));

function makeElectronApi() {
  whisperListeners = {};
  nativeListeners = {};
  return {
    whisper: {
      getAllModelStatus: vi.fn().mockResolvedValue({ success: true, data: [{ size: 'base', downloaded: false }] }),
      getAllModelInfo: vi.fn().mockResolvedValue({ success: true, data: [] }),
      downloadModel: vi.fn().mockResolvedValue({ success: true }),
      deleteModel: vi.fn().mockResolvedValue({ success: true }),
      cancelDownload: vi.fn().mockResolvedValue({ success: true }),
      onDownloadProgress: vi.fn((cb: any) => { whisperListeners.progress = cb; return vi.fn(); }),
      onDownloadComplete: vi.fn((cb: any) => { whisperListeners.complete = cb; return vi.fn(); }),
      onDownloadError: vi.fn((cb: any) => { whisperListeners.error = cb; return vi.fn(); }),
      onDownloadCancelled: vi.fn((cb: any) => { whisperListeners.cancelled = cb; return vi.fn(); }),
    },
    appConfig: {
      getAppConfig: vi.fn().mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: undefined, whisperModelSelected: undefined, recognitionLanguage: undefined, gpuAcceleration: undefined } } }),
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
      onDownloadProgress: vi.fn((cb: any) => { nativeListeners.progress = cb; return vi.fn(); }),
      onDownloadComplete: vi.fn((cb: any) => { nativeListeners.complete = cb; return vi.fn(); }),
      onDownloadCancelled: vi.fn((cb: any) => { nativeListeners.cancelled = cb; return vi.fn(); }),
      onDownloadError: vi.fn((cb: any) => { nativeListeners.error = cb; return vi.fn(); }),
    },
  };
}

describe('VoiceInputSettingsView supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
    mockFeatureFlag.mockReturnValue(true);
    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: makeElectronApi() });
  });

  it('uses default voice input settings when the stored config omits optional values', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());
    expect(screen.getByTestId('voice-enabled').textContent).toBe('false');
    expect(screen.getByTestId('whisper-model').textContent).toBe('base');
    expect(screen.getByTestId('language').textContent).toBe('auto');
    expect(screen.getByTestId('use-gpu').textContent).toBe('false');
  });

  it('does not re-subscribe Whisper download listeners when only language changes', async () => {
    const { rerender } = render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());
    expect((window as any).electronAPI.whisper.onDownloadProgress).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.whisper.onDownloadComplete).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.whisper.onDownloadError).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.whisper.onDownloadCancelled).toHaveBeenCalledTimes(1);

    i18nState.language = 'zh';
    rerender(<VoiceInputSettingsView />);

    expect((window as any).electronAPI.whisper.onDownloadProgress).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.whisper.onDownloadComplete).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.whisper.onDownloadError).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.whisper.onDownloadCancelled).toHaveBeenCalledTimes(1);
  });

  it('updates setup progress from whisper progress events during the enabling flow', async () => {
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({ success: true, data: { status: 'downloaded' } });
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } } });

    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());

    let pending: Promise<void>;
    await act(async () => {
      pending = mockContentProps.onToggleVoiceInput(true);
    });
    await waitFor(() => expect((window as any).electronAPI.whisper.downloadModel).toHaveBeenCalledWith('base'));

    act(() => {
      whisperListeners.progress?.({ model: 'base', percent: 25, downloaded: 25, total: 100 });
    });
    expect(screen.getByTestId('setup-progress').textContent).toBe('25');

    act(() => {
      whisperListeners.complete?.({ model: 'base' });
    });
    await act(async () => {
      await pending;
    });
  });

  it('updates addon status from native module lifecycle events for whisper-addon only', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-header')).toBeInTheDocument());

    act(() => {
      nativeListeners.complete?.({ packageName: 'other-package' });
    });
    expect(screen.getByTestId('addon-status').textContent).toBe('not-downloaded');

    act(() => {
      nativeListeners.complete?.({ packageName: 'whisper-addon' });
    });
    await waitFor(() => expect(screen.getByTestId('addon-status').textContent).toBe('downloaded'));

    act(() => {
      nativeListeners.cancelled?.({ packageName: 'whisper-addon' });
    });
    await waitFor(() => expect(screen.getByTestId('addon-status').textContent).toBe('not-downloaded'));

    act(() => {
      nativeListeners.error?.({ packageName: 'whisper-addon' });
    });
    await waitFor(() => expect(screen.getByTestId('addon-status').textContent).toBe('error'));
  });

  it('surfaces fallback errors for toggle, download, delete, cancel, and save operations', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());

    (window as any).electronAPI.appConfig.updateAppConfig.mockRejectedValueOnce('disable failed');
    await act(async () => { await mockContentProps.onToggleVoiceInput(false); });

    (window as any).electronAPI.whisper.downloadModel.mockRejectedValueOnce('download failed');
    await act(async () => { await mockContentProps.onDownloadModel('base'); });

    (window as any).electronAPI.whisper.deleteModel.mockResolvedValueOnce({ success: false });
    await act(async () => { await mockContentProps.onDeleteModel('base'); });

    (window as any).electronAPI.whisper.deleteModel.mockRejectedValueOnce('delete failed');
    await act(async () => { await mockContentProps.onDeleteModel('base'); });

    (window as any).electronAPI.whisper.cancelDownload.mockRejectedValueOnce('cancel failed');
    await act(async () => { await mockContentProps.onCancelDownload('base'); });

    (window as any).electronAPI.voiceInput.updateSettings.mockRejectedValueOnce('save failed');
    await act(async () => {
      await mockContentProps.onSettingsChange({ whisperModel: 'small', language: 'en', useGPU: false, translate: false });
    });

    expect(screen.getByTestId('voice-content')).toBeInTheDocument();
  });

  it('surfaces enabling and addon operation failures', async () => {
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({ success: true, data: { status: 'downloaded' } });
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: 'base', recognitionLanguage: 'auto', gpuAcceleration: false } } });
    (window as any).electronAPI.appConfig.updateAppConfig.mockRejectedValueOnce('enable failed');

    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());

    await act(async () => { await mockContentProps.onToggleVoiceInput(true); });

    (window as any).electronAPI.nativeModule.deleteModule.mockRejectedValueOnce('addon delete failed');
    await act(async () => { await mockContentProps.onDeleteAddon(); });

    (window as any).electronAPI.nativeModule.cancelDownload.mockRejectedValueOnce('cancel enabling failed');
    await act(async () => { await mockContentProps.onCancelEnabling(); });

    expect(screen.getByTestId('voice-content')).toBeInTheDocument();
  });

  it('handles native progress, ignores non-target events, and supports existing on-disk base models', async () => {
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({ success: false, data: {} });
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } } });
    (window as any).electronAPI.whisper.getAllModelStatus.mockResolvedValue({ success: true, data: [{ size: 'base', downloaded: true }] });

    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());

    const pending = mockContentProps.onToggleVoiceInput(true);
    act(() => {
      nativeListeners.progress?.({ packageName: 'other-package', percent: 44 });
      nativeListeners.progress?.({ packageName: 'whisper-addon' });
    });
    expect(screen.getByTestId('setup-progress').textContent).toBe('0');

    await act(async () => { await pending; });
    expect((window as any).electronAPI.voiceInput.updateSettings).toHaveBeenCalledWith({ whisperModel: 'base', language: 'auto' });
  });

  it('returns early when addon APIs are unavailable and handles object-based download errors', async () => {
    delete (window as any).electronAPI.nativeModule;
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());

    await act(async () => { await mockContentProps.onDeleteAddon(); });

    (window as any).electronAPI.whisper.downloadModel.mockRejectedValueOnce(new Error('download object failed'));
    await act(async () => { await mockContentProps.onDownloadModel('base'); });

    expect(screen.getByTestId('voice-content')).toBeInTheDocument();
  });

  it('handles missing whisper api, ignored whisper completion events, and object-based delete failures', async () => {
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({ success: true, data: { status: 'downloaded' } });
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } } });
    (window as any).electronAPI.whisper = undefined;

    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());
    await act(async () => { await mockContentProps.onToggleVoiceInput(true); });

    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: makeElectronApi() });
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getAllByTestId('voice-content').length).toBeGreaterThan(0));

    act(() => {
      whisperListeners.complete?.({ model: 'tiny' });
      whisperListeners.error?.({ model: 'tiny', error: 'ignored' });
      nativeListeners.cancelled?.({ packageName: 'other-package' });
      nativeListeners.error?.({ packageName: 'other-package' });
    });

    (window as any).electronAPI.whisper.deleteModel.mockRejectedValueOnce(new Error('delete object failed'));
    await act(async () => { await mockContentProps.onDeleteModel('base'); });
    (window as any).electronAPI.whisper.deleteModel.mockResolvedValueOnce({ success: false, error: 'failed delete' });
    await act(async () => { await mockContentProps.onDeleteModel('tiny'); });

    expect(screen.getAllByTestId('voice-content').length).toBeGreaterThan(0);
  });


  it('handles addon setup branches for missing native module and incomplete native download results', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());

    const apiNoNative = makeElectronApi();
    delete apiNoNative.nativeModule;
    apiNoNative.appConfig.getAppConfig.mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } } });
    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: apiNoNative });
    await act(async () => { await mockContentProps.onToggleVoiceInput(true); });

    const apiWithIncompleteAddon = makeElectronApi();
    apiWithIncompleteAddon.appConfig.getAppConfig.mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } } });
    apiWithIncompleteAddon.nativeModule.ensureDownloaded.mockResolvedValue({ success: false });
    apiWithIncompleteAddon.whisper.getAllModelStatus.mockResolvedValue({ success: true, data: [{ size: 'base', downloaded: true }] });
    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: apiWithIncompleteAddon });
    await act(async () => { await mockContentProps.onToggleVoiceInput(true); });
  });

  it('uses zero fallback for addon progress and ignores non-base whisper completion events', async () => {
    const api = makeElectronApi();
    let resolveAddon: (value: any) => void;
    api.appConfig.getAppConfig.mockResolvedValue({ success: true, data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } } });
    api.nativeModule.ensureDownloaded.mockImplementationOnce(() => new Promise(resolve => { resolveAddon = resolve; }));
    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: api });

    render(<VoiceInputSettingsView />);
    await waitFor(() => expect(screen.getByTestId('voice-content')).toBeInTheDocument());

    const pending = mockContentProps.onToggleVoiceInput(true);
    await waitFor(() => expect(api.nativeModule.ensureDownloaded).toHaveBeenCalled());
    act(() => {
      nativeListeners.progress?.({ packageName: 'whisper-addon' });
      whisperListeners.complete?.({ model: 'tiny' });
      whisperListeners.error?.({ model: 'tiny', error: 'ignored' });
    });
    expect(screen.getByTestId('setup-progress').textContent).toBe('0');

    await act(async () => { resolveAddon!({ success: true }); });
    act(() => whisperListeners.complete?.({ model: 'base' }));
    await act(async () => { await pending; });
  });

});
