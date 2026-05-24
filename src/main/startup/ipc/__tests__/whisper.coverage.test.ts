import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockHandle = vi.hoisted(() => vi.fn());

const mockWhisperModelManager = vi.hoisted(() => ({
  getAllModelStatus: vi.fn().mockReturnValue([{ size: 'base', status: 'ready' }]),
  getModelStatus: vi.fn().mockReturnValue({ size: 'base', status: 'ready' }),
  getAllModelInfo: vi.fn().mockReturnValue([{ size: 'base' }]),
  downloadModel: vi.fn().mockResolvedValue(undefined),
  cancelDownload: vi.fn().mockReturnValue(true),
  deleteModel: vi.fn().mockReturnValue(true),
  getModelPath: vi.fn().mockReturnValue('/models/base.bin'),
  isDownloading: vi.fn().mockReturnValue(false),
  getActiveDownloads: vi.fn().mockReturnValue([]),
}));

const mockTranscribePCM = vi.hoisted(() => vi.fn().mockResolvedValue({ text: 'hello' }));
const mockIsWhisperAvailable = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockStartStreamingSession = vi.hoisted(() => vi.fn().mockResolvedValue('session-1'));
const mockProcessAudioChunk = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStopStreamingSession = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCancelStreamingSession = vi.hoisted(() => vi.fn());
const mockIsSessionActive = vi.hoisted(() => vi.fn().mockReturnValue(true));

const mockFromWebContents = vi.hoisted(() => vi.fn().mockReturnValue({ id: 1 }));

const mockAppCacheManager = vi.hoisted(() => ({
  getConfig: vi.fn().mockReturnValue({
    voiceInput: {
      whisperModelSelected: 'base',
      recognitionLanguage: 'en',
      gpuAcceleration: false,
    },
  }),
  updateConfig: vi.fn().mockResolvedValue(undefined),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-app'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    getName: vi.fn().mockReturnValue('test'),
    isPackaged: false,
  },
  ipcMain: { handle: mockHandle },
  BrowserWindow: { fromWebContents: mockFromWebContents },
}));

vi.mock('../../../lib/whisper', () => ({
  whisperModelManager: mockWhisperModelManager,
  transcribePCM: mockTranscribePCM,
  isWhisperAvailable: mockIsWhisperAvailable,
  startStreamingSession: mockStartStreamingSession,
  processAudioChunk: mockProcessAudioChunk,
  stopStreamingSession: mockStopStreamingSession,
  cancelStreamingSession: mockCancelStreamingSession,
  isSessionActive: mockIsSessionActive,
}));

vi.mock('../../lazy', () => ({
  getAppCacheManager: vi.fn().mockResolvedValue(mockAppCacheManager),
  getAdvancedLogger: vi.fn().mockReturnValue(mockLogger),
}));

// ── helpers ────────────────────────────────────────────────────────────────────
function getHandler(channel: string) {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`No handler registered for channel: ${channel}`);
  return call[1] as (...args: any[]) => Promise<any>;
}

function makeEvent(sender?: object) {
  return { sender: sender ?? {} } as any;
}

// ── tests ──────────────────────────────────────────────────────────────────────
describe('whisper IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-register handlers by importing the module fresh
    vi.resetModules();
  });

  // We load the module once and rely on all handlers being registered
  it('registers all whisper IPC handlers', async () => {
    const { default: registerWhisper } = await import('../whisper');
    registerWhisper({} as any);

    const channels = mockHandle.mock.calls.map(([ch]) => ch);
    expect(channels).toContain('whisper:getAllModelStatus');
    expect(channels).toContain('whisper:getModelStatus');
    expect(channels).toContain('whisper:getAllModelInfo');
    expect(channels).toContain('whisper:downloadModel');
    expect(channels).toContain('whisper:cancelDownload');
    expect(channels).toContain('whisper:deleteModel');
    expect(channels).toContain('whisper:getModelPath');
    expect(channels).toContain('whisper:isDownloading');
    expect(channels).toContain('whisper:transcribe');
    expect(channels).toContain('whisper:isAvailable');
    expect(channels).toContain('whisper:startStreaming');
    expect(channels).toContain('whisper:processChunk');
    expect(channels).toContain('whisper:stopStreaming');
    expect(channels).toContain('whisper:cancelStreaming');
    expect(channels).toContain('whisper:isStreamingActive');
    expect(channels).toContain('voiceInput:getSettings');
    expect(channels).toContain('voiceInput:updateSettings');
  });

  describe('whisper:getAllModelStatus', () => {
    it('returns all model statuses on success', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getAllModelStatus');
      const result = await handler();
      expect(result).toEqual({ success: true, data: [{ size: 'base', status: 'ready' }] });
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.getAllModelStatus.mockImplementationOnce(() => {
        throw new Error('fail');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getAllModelStatus');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'fail' });
    });
  });

  describe('whisper:getModelStatus', () => {
    it('returns model status', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getModelStatus');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: true, data: { size: 'base', status: 'ready' } });
      expect(mockWhisperModelManager.getModelStatus).toHaveBeenCalledWith('base');
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.getModelStatus.mockImplementationOnce(() => {
        throw new Error('status err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getModelStatus');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: false, error: 'status err' });
    });
  });

  describe('whisper:getAllModelInfo', () => {
    it('returns all model info', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getAllModelInfo');
      const result = await handler();
      expect(result).toEqual({ success: true, data: [{ size: 'base' }] });
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.getAllModelInfo.mockImplementationOnce(() => {
        throw new Error('info err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getAllModelInfo');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'info err' });
    });
  });

  describe('whisper:downloadModel', () => {
    it('downloads model and returns success', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:downloadModel');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: true });
      expect(mockWhisperModelManager.downloadModel).toHaveBeenCalledWith('base', undefined, { id: 1 });
    });

    it('passes undefined window when fromWebContents returns null', async () => {
      mockFromWebContents.mockReturnValueOnce(null);
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:downloadModel');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: true });
      expect(mockWhisperModelManager.downloadModel).toHaveBeenCalledWith('base', undefined, undefined);
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.downloadModel.mockRejectedValueOnce(new Error('dl err'));
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:downloadModel');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: false, error: 'dl err' });
    });
  });

  describe('whisper:cancelDownload', () => {
    it('cancels download', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:cancelDownload');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: true, data: true });
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.cancelDownload.mockImplementationOnce(() => {
        throw new Error('cancel err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:cancelDownload');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: false, error: 'cancel err' });
    });
  });

  describe('whisper:deleteModel', () => {
    it('deletes model', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:deleteModel');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: true, data: true });
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.deleteModel.mockImplementationOnce(() => {
        throw new Error('del err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:deleteModel');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: false, error: 'del err' });
    });
  });

  describe('whisper:getModelPath', () => {
    it('returns model path', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getModelPath');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: true, data: '/models/base.bin' });
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.getModelPath.mockImplementationOnce(() => {
        throw new Error('path err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:getModelPath');
      const result = await handler(makeEvent(), 'base');
      expect(result).toEqual({ success: false, error: 'path err' });
    });
  });

  describe('whisper:isDownloading', () => {
    it('returns downloading status', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:isDownloading');
      const result = await handler();
      expect(result).toEqual({ success: true, data: { isDownloading: false, activeDownloads: [] } });
    });

    it('returns error on failure', async () => {
      mockWhisperModelManager.isDownloading.mockImplementationOnce(() => {
        throw new Error('dl status err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:isDownloading');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'dl status err' });
    });
  });

  describe('whisper:transcribe', () => {
    it('transcribes PCM data', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:transcribe');
      const result = await handler(makeEvent(), {
        pcmData: [0.1, 0.2, 0.3],
        modelSize: 'base',
        options: { language: 'en', useGPU: true, enableVAD: true, threads: 8, translate: true },
      });
      expect(result).toEqual({ success: true, data: { text: 'hello' } });
      expect(mockTranscribePCM).toHaveBeenCalledWith(
        expect.any(Float32Array),
        'base',
        { language: 'en', useGPU: true, enableVAD: true, threads: 8, translate: true }
      );
    });

    it('uses defaults when options are omitted', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:transcribe');
      await handler(makeEvent(), { pcmData: [0.1], modelSize: 'base' });
      expect(mockTranscribePCM).toHaveBeenCalledWith(
        expect.any(Float32Array),
        'base',
        { language: undefined, useGPU: false, enableVAD: false, threads: 4, translate: false }
      );
    });

    it('returns error on failure', async () => {
      mockTranscribePCM.mockRejectedValueOnce(new Error('transcribe err'));
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:transcribe');
      const result = await handler(makeEvent(), { pcmData: [], modelSize: 'base' });
      expect(result).toEqual({ success: false, error: 'transcribe err' });
    });
  });

  describe('whisper:isAvailable', () => {
    it('returns availability', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:isAvailable');
      const result = await handler();
      expect(result).toEqual({ success: true, data: true });
    });

    it('returns error on failure', async () => {
      mockIsWhisperAvailable.mockRejectedValueOnce(new Error('avail err'));
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:isAvailable');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'avail err' });
    });
  });

  describe('whisper:startStreaming', () => {
    it('starts streaming session', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:startStreaming');
      const result = await handler(makeEvent(), { modelSize: 'base', options: { language: 'en' } });
      expect(result).toEqual({ success: true, data: { sessionId: 'session-1' } });
    });

    it('uses empty options when not provided', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:startStreaming');
      await handler(makeEvent(), { modelSize: 'base' });
      expect(mockStartStreamingSession).toHaveBeenCalledWith('base', {}, expect.anything());
    });

    it('returns error on failure', async () => {
      mockStartStreamingSession.mockRejectedValueOnce(new Error('stream err'));
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:startStreaming');
      const result = await handler(makeEvent(), { modelSize: 'base' });
      expect(result).toEqual({ success: false, error: 'stream err' });
    });
  });

  describe('whisper:processChunk', () => {
    it('processes audio chunk', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:processChunk');
      const result = await handler(makeEvent(), { sessionId: 'session-1', pcmData: [0.1, 0.2] });
      expect(result).toEqual({ success: true });
      expect(mockProcessAudioChunk).toHaveBeenCalledWith('session-1', expect.any(Float32Array));
    });

    it('returns error on failure', async () => {
      mockProcessAudioChunk.mockRejectedValueOnce(new Error('chunk err'));
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:processChunk');
      const result = await handler(makeEvent(), { sessionId: 's1', pcmData: [] });
      expect(result).toEqual({ success: false, error: 'chunk err' });
    });
  });

  describe('whisper:stopStreaming', () => {
    it('stops streaming session', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:stopStreaming');
      const result = await handler(makeEvent(), 'session-1');
      expect(result).toEqual({ success: true });
      expect(mockStopStreamingSession).toHaveBeenCalledWith('session-1');
    });

    it('returns error on failure', async () => {
      mockStopStreamingSession.mockRejectedValueOnce(new Error('stop err'));
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:stopStreaming');
      const result = await handler(makeEvent(), 's1');
      expect(result).toEqual({ success: false, error: 'stop err' });
    });
  });

  describe('whisper:cancelStreaming', () => {
    it('cancels streaming session', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:cancelStreaming');
      const result = await handler(makeEvent(), 'session-1');
      expect(result).toEqual({ success: true });
      expect(mockCancelStreamingSession).toHaveBeenCalledWith('session-1');
    });

    it('returns error on failure', async () => {
      mockCancelStreamingSession.mockImplementationOnce(() => {
        throw new Error('cancel stream err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:cancelStreaming');
      const result = await handler(makeEvent(), 's1');
      expect(result).toEqual({ success: false, error: 'cancel stream err' });
    });
  });

  describe('whisper:isStreamingActive', () => {
    it('returns session active status', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:isStreamingActive');
      const result = await handler(makeEvent(), 'session-1');
      expect(result).toEqual({ success: true, data: true });
    });

    it('returns error on failure', async () => {
      mockIsSessionActive.mockImplementationOnce(() => {
        throw new Error('active err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('whisper:isStreamingActive');
      const result = await handler(makeEvent(), 's1');
      expect(result).toEqual({ success: false, error: 'active err' });
    });
  });

  describe('voiceInput:getSettings', () => {
    it('returns mapped voice input settings', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('voiceInput:getSettings');
      const result = await handler();
      expect(result).toEqual({
        success: true,
        data: {
          whisperModel: 'base',
          language: 'en',
          useGPU: false,
          translate: false,
        },
      });
    });

    it('uses defaults when voiceInput config is missing', async () => {
      mockAppCacheManager.getConfig.mockReturnValueOnce({ voiceInput: undefined });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('voiceInput:getSettings');
      const result = await handler();
      expect(result).toEqual({
        success: true,
        data: {
          whisperModel: 'base',
          language: 'auto',
          useGPU: false,
          translate: false,
        },
      });
    });

    it('returns error on failure', async () => {
      mockAppCacheManager.getConfig.mockImplementationOnce(() => {
        throw new Error('config err');
      });
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('voiceInput:getSettings');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'config err' });
    });
  });

  describe('voiceInput:updateSettings', () => {
    it('updates voice input settings', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('voiceInput:updateSettings');
      const result = await handler(makeEvent(), {
        whisperModel: 'large',
        language: 'zh',
        useGPU: true,
      });
      expect(result).toEqual({ success: true });
      expect(mockAppCacheManager.updateConfig).toHaveBeenCalledWith({
        voiceInput: {
          whisperModelSelected: 'large',
          recognitionLanguage: 'zh',
          gpuAcceleration: true,
        },
      });
    });

    it('omits undefined fields from update', async () => {
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('voiceInput:updateSettings');
      await handler(makeEvent(), { whisperModel: 'small' });
      expect(mockAppCacheManager.updateConfig).toHaveBeenCalledWith({
        voiceInput: { whisperModelSelected: 'small' },
      });
    });

    it('returns error on failure', async () => {
      mockAppCacheManager.updateConfig.mockRejectedValueOnce(new Error('update err'));
      const { default: registerWhisper } = await import('../whisper');
      registerWhisper({} as any);
      const handler = getHandler('voiceInput:updateSettings');
      const result = await handler(makeEvent(), {});
      expect(result).toEqual({ success: false, error: 'update err' });
    });
  });
});
