/**
 * whisperTranscriptionService.ts coverage tests
 */

// ─── mock variables ───────────────────────────────────────────────────────────

const mockIsAvailable = vi.fn();
const mockRequireModule = vi.fn();
const mockEnsureDownloaded = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../nativeModules', async () => {
  class NativeModuleNotDownloadedError extends Error {
    constructor(module: string) {
      super(`Native module "${module}" is not downloaded. Call nativeModuleManager.ensureDownloaded("${module}") first.`);
      this.name = 'NativeModuleNotDownloadedError';
    }
  }
  return {
    nativeModuleManager: {
      isAvailable: (...args: any[]) => mockIsAvailable(...args),
      requireModule: (...args: any[]) => mockRequireModule(...args),
      ensureDownloaded: (...args: any[]) => mockEnsureDownloaded(...args),
    },
    NativeModuleNotDownloadedError,
  };
});

const mockGetModelPath = vi.fn().mockReturnValue('/mock/models/base.bin');

vi.mock('../whisperModelManager', () => ({
  whisperModelManager: {
    getModelPath: (...args: any[]) => mockGetModelPath(...args),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('fs');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTranscribeResult(segments: any[]) {
  return { transcription: segments };
}

async function getModule() {
  return await import('../whisperTranscriptionService');
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('whisperTranscriptionService coverage tests', () => {
  afterEach(() => vi.resetModules());

  // ── isWhisperAvailable ──────────────────────────────────────────────────────

  describe('isWhisperAvailable', () => {
    it('returns true when native module is available', async () => {
      mockIsAvailable.mockReturnValue(true);
      const { isWhisperAvailable } = await getModule();
      const result = await isWhisperAvailable();
      expect(result).toBe(true);
    });

    it('returns false when native module is not available', async () => {
      mockIsAvailable.mockReturnValue(false);
      const { isWhisperAvailable } = await getModule();
      const result = await isWhisperAvailable();
      expect(result).toBe(false);
    });
  });

  // ── downloadWhisperAddon ────────────────────────────────────────────────────

  describe('downloadWhisperAddon', () => {
    it('calls ensureDownloaded and clears addon cache', async () => {
      mockEnsureDownloaded.mockResolvedValue(undefined);
      const { downloadWhisperAddon } = await getModule();
      await downloadWhisperAddon();
      expect(mockEnsureDownloaded).toHaveBeenCalledWith('whisper-addon', expect.any(Function));
    });

    it('calls onProgress callback when provided', async () => {
      mockEnsureDownloaded.mockImplementationOnce(async (_name: string, cb: Function) => {
        cb({ bytesDownloaded: 100, bytesTotal: 1000, percent: 10 });
      });
      const onProgress = vi.fn();
      const { downloadWhisperAddon } = await getModule();
      await downloadWhisperAddon(onProgress);
      expect(onProgress).toHaveBeenCalledWith({ bytesDownloaded: 100, bytesTotal: 1000, percent: 10 });
    });
  });

  // ── transcribePCM ───────────────────────────────────────────────────────────

  describe('transcribePCM', () => {
    function setupAddon(transcribeResult: any) {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: vi.fn().mockResolvedValue(transcribeResult) });
    }

    it('throws NativeModuleNotDownloadedError when addon not available', async () => {
      mockIsAvailable.mockReturnValue(false);
      const { transcribePCM } = await getModule();
      await expect(transcribePCM(new Float32Array([0]), 'base')).rejects.toThrow('not downloaded');
    });

    it('throws when model file does not exist', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: vi.fn() });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(false);
      const { transcribePCM } = await getModule();
      await expect(transcribePCM(new Float32Array([0]), 'base')).rejects.toThrow('model not found');
    });

    it('transcribes with array-of-arrays format', async () => {
      setupAddon(makeTranscribeResult([[0, 1, 'Hello'], [1, 2, 'World']]));
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      const result = await transcribePCM(new Float32Array([0, 1, 2]), 'base');
      expect(result.text).toBe('Hello World');
      expect(result.segments).toHaveLength(2);
      expect(result.segments![0]).toMatchObject({ start: '0', end: '1', text: 'Hello' });
    });

    it('transcribes with array-of-strings format', async () => {
      setupAddon(makeTranscribeResult(['Hello ', ' World']));
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      const result = await transcribePCM(new Float32Array([0]), 'base');
      expect(result.text).toBe('Hello World');
      expect(result.segments).toHaveLength(0);
    });

    it('returns empty text when transcription is empty array', async () => {
      setupAddon(makeTranscribeResult([]));
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      const result = await transcribePCM(new Float32Array([0]), 'base');
      expect(result.text).toBe('');
    });

    it('returns empty text when transcription is not an array', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: vi.fn().mockResolvedValue({ transcription: null }) });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      const result = await transcribePCM(new Float32Array([0]), 'base');
      expect(result.text).toBe('');
    });

    it('uses zh language for simplified Chinese', async () => {
      const mockTranscribe = vi.fn().mockResolvedValue(makeTranscribeResult([]));
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: mockTranscribe });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      await transcribePCM(new Float32Array([0]), 'base', { language: 'zh' });
      expect(mockTranscribe).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'zh', prompt: expect.stringContaining('普通话') })
      );
    });

    it('uses zh language for traditional Chinese', async () => {
      const mockTranscribe = vi.fn().mockResolvedValue(makeTranscribeResult([]));
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: mockTranscribe });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      await transcribePCM(new Float32Array([0]), 'base', { language: 'zh-Hant' });
      expect(mockTranscribe).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'zh' })
      );
      // Should NOT have the simplified Chinese prompt
      const opts = mockTranscribe.mock.calls[0][0];
      expect(opts.prompt).toBeUndefined();
    });

    it('omits language when set to auto', async () => {
      const mockTranscribe = vi.fn().mockResolvedValue(makeTranscribeResult([]));
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: mockTranscribe });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      await transcribePCM(new Float32Array([0]), 'base', { language: 'auto' });
      const opts = mockTranscribe.mock.calls[0][0];
      expect(opts.language).toBeUndefined();
    });

    it('passes GPU, VAD, threads, translate options', async () => {
      const mockTranscribe = vi.fn().mockResolvedValue(makeTranscribeResult([]));
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: mockTranscribe });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      await transcribePCM(new Float32Array([0]), 'base', {
        useGPU: true, enableVAD: true, threads: 8, translate: true,
      });
      const opts = mockTranscribe.mock.calls[0][0];
      expect(opts.use_gpu).toBe(true);
      expect(opts.vad).toBe(true);
      expect(opts.n_threads).toBe(8);
      expect(opts.translate).toBe(true);
    });

    it('throws and rethrows when transcribe fails', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({
        transcribe: vi.fn().mockRejectedValueOnce(new Error('Transcription error')),
      });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      await expect(transcribePCM(new Float32Array([0]), 'base')).rejects.toThrow('Transcription error');
    });

    it('falls through to NativeModuleNotDownloadedError when requireModule fails', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockImplementationOnce(() => { throw new Error('Load failed'); });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      await expect(transcribePCM(new Float32Array([0]), 'base')).rejects.toThrow();
    });

    it('skips short segments (less than 3 elements)', async () => {
      // [0, 1] has only 2 elements -> skipped as array; 'valid string' is a plain string -> appended
      setupAddon(makeTranscribeResult([[0, 1], 'valid string']));
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribePCM } = await getModule();
      const result = await transcribePCM(new Float32Array([0]), 'base');
      expect(result.text).toBe('valid string');
      expect(result.segments).toHaveLength(0);
    });
  });

  // ── transcribeFile ──────────────────────────────────────────────────────────

  describe('transcribeFile', () => {
    it('throws NativeModuleNotDownloadedError when addon not available', async () => {
      mockIsAvailable.mockReturnValue(false);
      const { transcribeFile } = await getModule();
      await expect(transcribeFile('/audio.wav', 'base')).rejects.toThrow('not downloaded');
    });

    it('throws when model file does not exist', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: vi.fn() });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(false);
      const { transcribeFile } = await getModule();
      await expect(transcribeFile('/audio.wav', 'base')).rejects.toThrow('model not found');
    });

    it('throws when audio file does not exist', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: vi.fn() });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn()
        .mockReturnValueOnce(true)   // model exists
        .mockReturnValueOnce(false); // audio file not found
      const { transcribeFile } = await getModule();
      await expect(transcribeFile('/audio.wav', 'base')).rejects.toThrow('Audio file not found');
    });

    it('transcribes file successfully with array-of-arrays format', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({
        transcribe: vi.fn().mockResolvedValue(makeTranscribeResult([[0, 2, 'Hello world']])),
      });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribeFile } = await getModule();
      const result = await transcribeFile('/audio.wav', 'base');
      expect(result.text).toBe('Hello world');
      expect(result.segments).toHaveLength(1);
    });

    it('transcribes file with string segments', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({
        transcribe: vi.fn().mockResolvedValue(makeTranscribeResult(['Hello', 'world'])),
      });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribeFile } = await getModule();
      const result = await transcribeFile('/audio.wav', 'base');
      expect(result.text).toBe('Hello world');
    });

    it('uses simplified Chinese prompt for zh language', async () => {
      const mockTranscribe = vi.fn().mockResolvedValue(makeTranscribeResult([]));
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: mockTranscribe });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribeFile } = await getModule();
      await transcribeFile('/audio.wav', 'base', { language: 'zh' });
      const opts = mockTranscribe.mock.calls[0][0];
      expect(opts.language).toBe('zh');
      expect(opts.prompt).toContain('普通话');
    });

    it('omits language when set to auto', async () => {
      const mockTranscribe = vi.fn().mockResolvedValue(makeTranscribeResult([]));
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({ transcribe: mockTranscribe });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribeFile } = await getModule();
      await transcribeFile('/audio.wav', 'base', { language: 'auto' });
      const opts = mockTranscribe.mock.calls[0][0];
      expect(opts.language).toBeUndefined();
    });

    it('rethrows on transcribe failure', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockRequireModule.mockReturnValue({
        transcribe: vi.fn().mockRejectedValueOnce(new Error('File transcription error')),
      });
      const fs = await import('fs');
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const { transcribeFile } = await getModule();
      await expect(transcribeFile('/audio.wav', 'base')).rejects.toThrow('File transcription error');
    });
  });
});
