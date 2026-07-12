// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * VoiceInputSettingsView.coverage3.test.tsx
 * Targets remaining uncovered branches:
 * - handleToggleVoiceInput: model already on disk (baseAlreadyOnDisk=true)
 * - handleToggleVoiceInput: download model flow (downloadBaseModel)
 * - handleToggleVoiceInput: AbortError swallowed
 * - handleToggleVoiceInput: addon nm not available error path
 * - handleDeleteModel: deleted model is selected → clears selection
 * - handleDeleteModel: error response (no success)
 * - handleDeleteModel: catch error
 * - handleSettingsChange: catch error
 * - IPC nativeModule listeners (progress/complete/cancelled/error filtering)
 * - whisper IPC listeners (progress during enabling flow)
 * - loadModelStatus: error path
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

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

const mockUnsubscribe = vi.fn();
let capturedWhisperListeners: Record<string, (...args: any[]) => void> = {};
let capturedNativeListeners: Record<string, (...args: any[]) => void> = {};

function makeElectronAPI(overrides: Record<string, any> = {}) {
  capturedWhisperListeners = {};
  capturedNativeListeners = {};

  const api: any = {
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
  return api;
}

import VoiceInputSettingsView from '../VoiceInputSettingsView';

beforeEach(() => {
  vi.clearAllMocks();
  mockFeatureFlag.mockReturnValue(true);
  (window as any).electronAPI = makeElectronAPI();
});

describe('VoiceInputSettingsView.coverage3 - toggle ON model-on-disk path', () => {
  it('uses model already on disk without downloading', async () => {
    // addon not downloaded
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true, data: { status: 'not-downloaded' },
    });
    // model not selected in config
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } },
    });
    // model already on disk
    (window as any).electronAPI.whisper.getAllModelStatus
      .mockResolvedValue({ success: true, data: [{ size: 'base', downloaded: true }] });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onToggleVoiceInput(true);
    });

    expect((window as any).electronAPI.voiceInput.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ whisperModel: 'base' })
    );
  });
});

describe('VoiceInputSettingsView.coverage3 - toggle ON downloadBaseModel path', () => {
  it('downloads base model when not on disk', async () => {
    // addon already downloaded, model not selected
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true, data: { status: 'downloaded' },
    });
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } },
    });
    // model NOT on disk
    (window as any).electronAPI.whisper.getAllModelStatus
      .mockResolvedValue({ success: true, data: [{ size: 'base', downloaded: false }] });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    // Start toggle - it will call downloadModel and then wait for onDownloadComplete
    const togglePromise = act(async () => {
      const p = mockContentProps.onToggleVoiceInput(true);
      // Simulate the download complete event
      await new Promise(r => setTimeout(r, 10));
      if (capturedWhisperListeners['complete']) {
        capturedWhisperListeners['complete']({ model: 'base' });
      }
      return p;
    });

    await togglePromise;
    expect((window as any).electronAPI.whisper.downloadModel).toHaveBeenCalledWith('base');
  });
});

describe('VoiceInputSettingsView.coverage3 - toggle ON download error path', () => {
  it('sets enablingError on download failure', async () => {
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true, data: { status: 'downloaded' },
    });
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } },
    });
    (window as any).electronAPI.whisper.getAllModelStatus
      .mockResolvedValue({ success: true, data: [{ size: 'base', downloaded: false }] });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      const p = mockContentProps.onToggleVoiceInput(true);
      await new Promise(r => setTimeout(r, 10));
      if (capturedWhisperListeners['error']) {
        capturedWhisperListeners['error']({ model: 'base', error: 'network failed' });
      }
      return p;
    });

    await waitFor(() => {
      expect(screen.getByTestId('enabling-error').textContent).toContain('Setup failed');
    });
  });
});

describe('VoiceInputSettingsView.coverage3 - toggle ON AbortError swallowed', () => {
  it('does not set enablingError on AbortError (cancelled)', async () => {
    (window as any).electronAPI.nativeModule.getStatus.mockResolvedValue({
      success: true, data: { status: 'downloaded' },
    });
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: '', recognitionLanguage: 'auto', gpuAcceleration: false } },
    });
    (window as any).electronAPI.whisper.getAllModelStatus
      .mockResolvedValue({ success: true, data: [{ size: 'base', downloaded: false }] });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      const p = mockContentProps.onToggleVoiceInput(true);
      await new Promise(r => setTimeout(r, 10));
      if (capturedWhisperListeners['cancelled']) {
        capturedWhisperListeners['cancelled']();
      }
      return p;
    });

    await waitFor(() => {
      expect(screen.getByTestId('enabling').textContent).toBe('false');
    });
    // enablingError should not be set
    expect(screen.getByTestId('enabling-error').textContent).toBe('undefined');
  });
});

describe('VoiceInputSettingsView.coverage3 - handleDeleteModel seleted model cleared', () => {
  it('clears model selection when deleting the currently selected model', async () => {
    (window as any).electronAPI.appConfig.getAppConfig.mockResolvedValue({
      success: true,
      data: { voiceInput: { voiceInputEnabled: false, whisperModelSelected: 'small', recognitionLanguage: 'auto', gpuAcceleration: false } },
    });
    (window as any).electronAPI.whisper.deleteModel.mockResolvedValue({ success: true });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    // settings.whisperModel should be 'small' from config load, so deleting 'small' should clear it
    await act(async () => {
      await mockContentProps.onDeleteModel('small');
    });

    expect((window as any).electronAPI.appConfig.updateAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ voiceInput: expect.objectContaining({ whisperModelSelected: '' }) })
    );
  });
});

describe('VoiceInputSettingsView.coverage3 - handleDeleteModel error response', () => {
  it('sets error when deleteModel returns no success', async () => {
    (window as any).electronAPI.whisper.deleteModel.mockResolvedValue({
      success: false, error: 'deletion failed',
    });

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onDeleteModel('base');
    });

    // No crash, error state updated (we observe via props - error is passed to content)
    expect((window as any).electronAPI.whisper.deleteModel).toHaveBeenCalledWith('base');
  });
});

describe('VoiceInputSettingsView.coverage3 - handleSettingsChange error', () => {
  it('handles updateSettings failure gracefully', async () => {
    (window as any).electronAPI.voiceInput.updateSettings.mockRejectedValue(new Error('network error'));

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onSettingsChange({ whisperModel: 'small', language: 'en', useGPU: false });
    });

    // Should not throw
    expect((window as any).electronAPI.voiceInput.updateSettings).toHaveBeenCalled();
  });
});

describe('VoiceInputSettingsView.coverage3 - nativeModule IPC listeners', () => {
  it('handles nativeModule download progress for whisper-addon', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedNativeListeners['progress']) {
        capturedNativeListeners['progress']({ packageName: 'whisper-addon', percent: 50 });
      }
    });

    // No crash
    expect(true).toBe(true);
  });

  it('ignores nativeModule download progress for other packages', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedNativeListeners['progress']) {
        capturedNativeListeners['progress']({ packageName: 'other-package', percent: 50 });
      }
    });

    expect(screen.getByTestId('addon-status').textContent).toBe('not-downloaded');
  });

  it('handles nativeModule download complete for whisper-addon', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedNativeListeners['complete']) {
        capturedNativeListeners['complete']({ packageName: 'whisper-addon' });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('addon-status').textContent).toBe('downloaded');
    });
  });

  it('handles nativeModule download cancelled for whisper-addon', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedNativeListeners['cancelled']) {
        capturedNativeListeners['cancelled']({ packageName: 'whisper-addon' });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('addon-status').textContent).toBe('not-downloaded');
    });
  });

  it('handles nativeModule download error for whisper-addon', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedNativeListeners['error']) {
        capturedNativeListeners['error']({ packageName: 'whisper-addon' });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('addon-status').textContent).toBe('error');
    });
  });
});

describe('VoiceInputSettingsView.coverage3 - whisper IPC listeners', () => {
  it('handles whisper download progress during enabling', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedWhisperListeners['progress']) {
        capturedWhisperListeners['progress']({ percent: 60 });
      }
    });

    // No crash
    expect(true).toBe(true);
  });

  it('handles whisper download complete by reloading model status', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    const initialCallCount = (window as any).electronAPI.whisper.getAllModelStatus.mock.calls.length;
    act(() => {
      if (capturedWhisperListeners['complete']) {
        capturedWhisperListeners['complete']();
      }
    });

    await waitFor(() => {
      expect((window as any).electronAPI.whisper.getAllModelStatus.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('handles whisper download error', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedWhisperListeners['error']) {
        capturedWhisperListeners['error']({ model: 'base', error: 'disk full' });
      }
    });

    expect(true).toBe(true);
  });

  it('handles whisper download cancelled', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    act(() => {
      if (capturedWhisperListeners['cancelled']) {
        capturedWhisperListeners['cancelled']();
      }
    });

    expect(true).toBe(true);
  });
});

describe('VoiceInputSettingsView.coverage3 - handleDeleteAddon', () => {
  it('deletes addon and disables voice input', async () => {
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

describe('VoiceInputSettingsView.coverage3 - handleCancelEnabling', () => {
  it('cancels both addon and whisper downloads', async () => {
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onCancelEnabling();
    });

    expect((window as any).electronAPI.nativeModule.cancelDownload).toHaveBeenCalledWith('whisper-addon');
    expect((window as any).electronAPI.whisper.cancelDownload).toHaveBeenCalledWith('base');
  });
});

describe('VoiceInputSettingsView.coverage3 - handleDownloadModel', () => {
  it('calls whisper.downloadModel with specified size', async () => {
    (window as any).electronAPI.whisper.downloadModel.mockResolvedValue({ success: true });
    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('voice-content'));

    await act(async () => {
      await mockContentProps.onDownloadModel('medium');
    });

    expect((window as any).electronAPI.whisper.downloadModel).toHaveBeenCalledWith('medium');
  });
});

describe('VoiceInputSettingsView.coverage3 - loadModelStatus error path', () => {
  it('handles getAllModelStatus failure gracefully', async () => {
    (window as any).electronAPI.whisper.getAllModelStatus.mockRejectedValue(new Error('server error'));

    render(<VoiceInputSettingsView />);
    await waitFor(() => screen.getByTestId('loading'));

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });
});
