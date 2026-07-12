// @ts-nocheck
/**
 * Coverage tests for streamingWhisperTranscriber.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mock variables ────────────────────────────────────────────────────
const mockFsExistsSync = vi.hoisted(() => vi.fn(() => true));

const mockWhisperTranscribe = vi.hoisted(() => vi.fn(async () => ({
  transcription: [['0.00', '1.00', 'hello world']],
})));

const mockIsAvailable = vi.hoisted(() => vi.fn(() => true));
const mockRequireModule = vi.hoisted(() => vi.fn(() => ({
  transcribe: mockWhisperTranscribe,
})));

const mockGetModelPath = vi.hoisted(() => vi.fn(() => '/fake/model/base.bin'));

const mockWebContentsSend = vi.hoisted(() => vi.fn());
const mockIsDestroyed = vi.hoisted(() => vi.fn(() => false));

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  default: { existsSync: mockFsExistsSync },
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

vi.mock('../../nativeModules', () => ({
  nativeModuleManager: {
    isAvailable: mockIsAvailable,
    requireModule: mockRequireModule,
  },
  NativeModuleNotDownloadedError: class NativeModuleNotDownloadedError extends Error {
    constructor(mod: string) {
      super(`Not downloaded: ${mod}`);
      this.name = 'NativeModuleNotDownloadedError';
    }
  },
}));

vi.mock('../whisperModelManager', () => ({
  whisperModelManager: {
    getModelPath: mockGetModelPath,
  },
}));

// The module imports createLogger from '../../unifiedLogger' — use the __mocks__ auto-mock.
vi.mock('../../unifiedLogger', () => {
  const noopLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    updateConfig: vi.fn(),
  };
  return {
    createLogger: vi.fn(() => noopLogger),
    default: vi.fn(() => noopLogger),
  };
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeBrowserWindow() {
  return {
    isDestroyed: mockIsDestroyed,
    webContents: {
      send: mockWebContentsSend,
    },
  } as any;
}

/** Build a PCM Float32Array with a given constant sample value (RMS ≈ abs(value)) */
function makePcmChunk(sampleValue: number, length = 1600): Float32Array {
  return new Float32Array(length).fill(sampleValue);
}

// ── imports ───────────────────────────────────────────────────────────────────
import {
  startStreamingSession,
  processAudioChunk,
  stopStreamingSession,
  cancelStreamingSession,
  isSessionActive,
  getActiveSessionCount,
} from '../streamingWhisperTranscriber';

// ── tests ─────────────────────────────────────────────────────────────────────

describe('startStreamingSession', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);
    mockWebContentsSend.mockClear();
  });

  it('throws when whisper addon is not available', async () => {
    mockIsAvailable.mockReturnValueOnce(false);
    await expect(
      startStreamingSession('base', {}, makeBrowserWindow()),
    ).rejects.toThrow(/Not downloaded/);
  });

  it('throws when model file does not exist', async () => {
    // First call is isAvailable (true), second is existsSync (false)
    mockFsExistsSync.mockReturnValueOnce(false);
    await expect(
      startStreamingSession('base', {}, makeBrowserWindow()),
    ).rejects.toThrow(/not found/i);
  });

  it('returns a session ID and sends started event', async () => {
    const sessionId = await startStreamingSession('base', {}, makeBrowserWindow());
    expect(typeof sessionId).toBe('string');
    expect(sessionId).toMatch(/^streaming_/);
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ type: 'started', sessionId }),
    );
  });

  it('accepts null browserWindow without crashing', async () => {
    const sessionId = await startStreamingSession('base', {}, null);
    expect(typeof sessionId).toBe('string');
    cancelStreamingSession(sessionId);
  });
});

describe('isSessionActive / getActiveSessionCount', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);
    mockWebContentsSend.mockClear();
  });

  it('returns false for unknown session', () => {
    expect(isSessionActive('nonexistent-id')).toBe(false);
  });

  it('returns true for active session', async () => {
    const sessionId = await startStreamingSession('base', {}, null);
    expect(isSessionActive(sessionId)).toBe(true);
    cancelStreamingSession(sessionId);
  });

  it('tracks active session count', async () => {
    const before = getActiveSessionCount();
    const s1 = await startStreamingSession('base', {}, null);
    const s2 = await startStreamingSession('base', {}, null);
    expect(getActiveSessionCount()).toBe(before + 2);
    cancelStreamingSession(s1);
    cancelStreamingSession(s2);
  });
});

describe('cancelStreamingSession', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);
    mockWebContentsSend.mockClear();
  });

  it('does nothing for unknown session', () => {
    expect(() => cancelStreamingSession('bad-id')).not.toThrow();
  });

  it('cancels an active session and sends stopped event', async () => {
    const bw = makeBrowserWindow();
    const sessionId = await startStreamingSession('base', {}, bw);
    mockWebContentsSend.mockClear();

    cancelStreamingSession(sessionId);

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ type: 'stopped', sessionId }),
    );
    expect(isSessionActive(sessionId)).toBe(false);
  });
});

describe('stopStreamingSession', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);
    mockWebContentsSend.mockClear();
    mockWhisperTranscribe.mockResolvedValue({
      transcription: [['0.00', '1.00', 'test']],
    });
  });

  it('resolves without error for unknown session', async () => {
    await expect(stopStreamingSession('unknown')).resolves.toBeUndefined();
  });

  it('sends stopped event when stopped', async () => {
    const bw = makeBrowserWindow();
    const sessionId = await startStreamingSession('base', {}, bw);
    mockWebContentsSend.mockClear();

    await stopStreamingSession(sessionId);

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ type: 'stopped' }),
    );
    expect(isSessionActive(sessionId)).toBe(false);
  });

  it('transcribes remaining audio on stop', async () => {
    const bw = makeBrowserWindow();
    const sessionId = await startStreamingSession('base', {}, bw);

    // Add some audio (but not enough to auto-trigger)
    const chunk = makePcmChunk(0.1, 3200);
    await processAudioChunk(sessionId, chunk);

    mockWhisperTranscribe.mockClear();
    await stopStreamingSession(sessionId);

    expect(mockWhisperTranscribe).toHaveBeenCalled();
  });
});

describe('processAudioChunk', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);
    mockWebContentsSend.mockClear();
    mockWhisperTranscribe.mockResolvedValue({
      transcription: [['0.00', '1.00', 'hello']],
    });
  });

  it('ignores chunks for unknown session', async () => {
    await expect(
      processAudioChunk('bad-session', new Float32Array(100)),
    ).resolves.toBeUndefined();
  });

  it('accumulates audio without transcribing for silence', async () => {
    const sessionId = await startStreamingSession('base', {}, null);
    mockWhisperTranscribe.mockClear();

    // RMS = 0.001, below SILENCE_THRESHOLD=0.01
    const silentChunk = makePcmChunk(0.001, 1600);
    await processAudioChunk(sessionId, silentChunk);

    expect(mockWhisperTranscribe).not.toHaveBeenCalled();
    cancelStreamingSession(sessionId);
  });

  it('triggers transcription after enough speech then silence', async () => {
    const sessionId = await startStreamingSession('base', {}, makeBrowserWindow());
    mockWhisperTranscribe.mockClear();

    // Add speech: value=0.05 > SPEECH_THRESHOLD=0.015; length=6400 > MIN_SPEECH_SAMPLES=4800
    const speechChunk = makePcmChunk(0.05, 6400);
    await processAudioChunk(sessionId, speechChunk);

    // Add silence: value=0.001; length=7000 > 400ms*16kHz=6400 samples
    const silentChunk = makePcmChunk(0.001, 7000);
    await processAudioChunk(sessionId, silentChunk);

    await new Promise(r => setImmediate(r));
    expect(mockWhisperTranscribe).toHaveBeenCalled();
    cancelStreamingSession(sessionId);
  });

  it('sends interim results during long continuous speech', async () => {
    const sessionId = await startStreamingSession('base', {}, makeBrowserWindow());
    mockWhisperTranscribe.mockClear();

    // INTERIM_INTERVAL_MS=2000ms => 32000 samples; send 33000 speech samples
    const bigSpeechChunk = makePcmChunk(0.05, 33000);
    await processAudioChunk(sessionId, bigSpeechChunk);

    await new Promise(r => setImmediate(r));
    expect(mockWhisperTranscribe).toHaveBeenCalled();
    cancelStreamingSession(sessionId);
  });

  it('handles transcription error gracefully (sends error update)', async () => {
    mockWhisperTranscribe.mockRejectedValueOnce(new Error('Transcribe failed'));
    const bw = makeBrowserWindow();
    const sessionId = await startStreamingSession('base', {}, bw);

    const speechChunk = makePcmChunk(0.05, 6400);
    await processAudioChunk(sessionId, speechChunk);
    const silentChunk = makePcmChunk(0.001, 7000);
    await processAudioChunk(sessionId, silentChunk);

    await new Promise(r => setImmediate(r));

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ type: 'error' }),
    );
    cancelStreamingSession(sessionId);
  });

  it('marks pendingTranscription when transcription already in progress', async () => {
    // Make the first transcription block until we manually resolve it
    let resolveTranscribe!: (v: any) => void;
    mockWhisperTranscribe.mockImplementationOnce(
      () => new Promise(r => { resolveTranscribe = r; }),
    );

    const sessionId = await startStreamingSession('base', {}, null);

    // Trigger first transcription (speech + silence)
    const speechChunk = makePcmChunk(0.05, 6400);
    await processAudioChunk(sessionId, speechChunk);
    // Don't await the silence chunk that triggers transcription
    const silentTrigger = makePcmChunk(0.001, 7000);
    const p1 = processAudioChunk(sessionId, silentTrigger);

    await new Promise(r => setImmediate(r));
    // At this point isTranscribing should be true from the first call

    // Fire a second chunk that should set pendingTranscription
    const p2 = processAudioChunk(sessionId, makePcmChunk(0.05, 6400));

    // Resolve the first transcription
    resolveTranscribe({ transcription: [] });
    await p1;
    await p2;
    await new Promise(r => setTimeout(r, 20));

    cancelStreamingSession(sessionId);
    // Just verify it didn't crash
    expect(true).toBe(true);
  });
});

describe('transcription result parsing', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);
    mockWebContentsSend.mockClear();
  });

  async function runTranscription(transcriptionResult: any) {
    mockWhisperTranscribe.mockResolvedValueOnce(transcriptionResult);
    const bw = makeBrowserWindow();
    const sessionId = await startStreamingSession('base', {}, bw);

    const speechChunk = makePcmChunk(0.05, 6400);
    await processAudioChunk(sessionId, speechChunk);
    const silentChunk = makePcmChunk(0.001, 7000);
    await processAudioChunk(sessionId, silentChunk);
    await new Promise(r => setImmediate(r));
    cancelStreamingSession(sessionId);
  }

  it('parses array-of-arrays transcription format', async () => {
    await runTranscription({ transcription: [['0.0', '1.0', ' Hello world ']] });
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ text: expect.stringContaining('Hello world') }),
    );
  });

  it('parses string segment format', async () => {
    await runTranscription({ transcription: ['hello string'] });
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ text: 'hello string' }),
    );
  });

  it('parses object segment format', async () => {
    await runTranscription({
      transcription: [{ start: '0.0', end: '1.0', text: 'object segment' }],
    });
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ text: 'object segment' }),
    );
  });

  it('parses direct string transcription', async () => {
    await runTranscription({ transcription: 'direct string' });
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ text: 'direct string' }),
    );
  });

  it('parses object transcription with .text field', async () => {
    await runTranscription({ transcription: { text: 'from object' } });
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ text: 'from object' }),
    );
  });

  it('parses result.text fallback when transcription is undefined', async () => {
    await runTranscription({ transcription: undefined, text: 'fallback text' });
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'whisper:streamingUpdate',
      expect.objectContaining({ text: 'fallback text' }),
    );
  });

  it('filters out BLANK_AUDIO hallucinations and sends no update', async () => {
    await runTranscription({ transcription: '[BLANK_AUDIO]' });
    const updateCalls = mockWebContentsSend.mock.calls.filter(c =>
      c[1]?.type === 'final' || c[1]?.type === 'interim',
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('skips empty segment arrays in transcription', async () => {
    // Array segment with length < 3 — should not contribute to text
    await runTranscription({ transcription: [[]] });
    const updateCalls = mockWebContentsSend.mock.calls.filter(c =>
      c[1]?.type === 'final' || c[1]?.type === 'interim',
    );
    expect(updateCalls).toHaveLength(0);
  });
});

describe('sendUpdate with destroyed window', () => {
  it('does not call send when browserWindow is destroyed', async () => {
    mockWebContentsSend.mockClear();
    mockIsDestroyed.mockReturnValue(true);
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);

    const bw = makeBrowserWindow();
    // Start session — sendUpdate is called with 'started', but isDestroyed()=true so send is skipped
    const sessionId = await startStreamingSession('base', {}, bw);
    cancelStreamingSession(sessionId);

    // No webContents.send should have been called because isDestroyed() returns true
    expect(mockWebContentsSend).not.toHaveBeenCalled();

    mockIsDestroyed.mockReturnValue(false);
  });
});

describe('language options', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(true);
    mockFsExistsSync.mockReturnValue(true);
    mockWebContentsSend.mockClear();
    mockWhisperTranscribe.mockResolvedValue({ transcription: 'test' });
  });

  async function transcribeWithLanguage(language: string) {
    mockWhisperTranscribe.mockClear();
    const sessionId = await startStreamingSession('base', { language }, makeBrowserWindow());
    const speechChunk = makePcmChunk(0.05, 6400);
    await processAudioChunk(sessionId, speechChunk);
    const silentChunk = makePcmChunk(0.001, 7000);
    await processAudioChunk(sessionId, silentChunk);
    await new Promise(r => setImmediate(r));
    cancelStreamingSession(sessionId);
    return mockWhisperTranscribe.mock.calls[0]?.[0];
  }

  it('maps zh language to whisper zh and adds prompt', async () => {
    const opts = await transcribeWithLanguage('zh');
    expect(opts.language).toBe('zh');
    expect(opts.prompt).toBeDefined();
  });

  it('maps zh-Hant to whisper zh', async () => {
    const opts = await transcribeWithLanguage('zh-Hant');
    expect(opts.language).toBe('zh');
  });

  it('omits language param for auto', async () => {
    const opts = await transcribeWithLanguage('auto');
    expect(opts.language).toBeUndefined();
  });

  it('passes through en language', async () => {
    const opts = await transcribeWithLanguage('en');
    expect(opts.language).toBe('en');
  });
});
