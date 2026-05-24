// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder, convertToWav } from '../useAudioRecorder';

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── MediaDevices mock ─────────────────────────────────────────────────────────

function makeTrack() {
  return { stop: vi.fn(), kind: 'audio' };
}

function makeStream(tracks = [makeTrack()]) {
  return {
    getTracks: vi.fn(() => tracks),
    _tracks: tracks,
  } as unknown as MediaStream;
}

function makeMediaRecorder() {
  let _ondataavailable: ((e: any) => void) | null = null;
  let _onstop: (() => void) | null = null;
  let _onerror: ((e: any) => void) | null = null;
  const mr = {
    start: vi.fn(),
    stop: vi.fn(() => { _onstop?.(); }),
    mimeType: 'audio/webm',
    set ondataavailable(fn: (e: any) => void) { _ondataavailable = fn; },
    get ondataavailable() { return _ondataavailable; },
    set onstop(fn: () => void) { _onstop = fn; },
    get onstop() { return _onstop; },
    set onerror(fn: (e: any) => void) { _onerror = fn; },
    get onerror() { return _onerror; },
    _trigger: {
      data: (blob: Blob) => _ondataavailable?.({ data: blob }),
      stop: () => _onstop?.(),
      error: (e: any) => _onerror?.(e),
    },
  };
  return mr;
}

type MockMediaRecorder = ReturnType<typeof makeMediaRecorder>;
let mockMR: MockMediaRecorder;

function makeAnalyser() {
  return {
    frequencyBinCount: 4,
    fftSize: 256,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(64)),
  };
}

function makeAudioContext(sampleRate = 16000) {
  return {
    sampleRate,
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    createAnalyser: vi.fn(() => makeAnalyser()),
    close: vi.fn().mockResolvedValue(undefined),
    decodeAudioData: vi.fn((buf: ArrayBuffer) =>
      Promise.resolve({
        duration: 1,
        numberOfChannels: 1,
        getChannelData: vi.fn(() => new Float32Array([0.5, -0.5])),
      } as unknown as AudioBuffer)
    ),
  };
}

function makeOfflineAudioContext() {
  const source = { buffer: null as any, connect: vi.fn(), start: vi.fn() };
  return {
    createBufferSource: vi.fn(() => source),
    destination: {},
    startRendering: vi.fn().mockResolvedValue({
      getChannelData: vi.fn(() => new Float32Array([0.5, -0.5])),
    }),
    _source: source,
  };
}

// ── setup / teardown ──────────────────────────────────────────────────────────

let mockStream: MediaStream;

beforeEach(() => {
  mockMR = makeMediaRecorder();
  mockStream = makeStream();

  // Must use function (not arrow) so vitest treats it as a constructor
  const MediaRecorderCtor = vi.fn(function (this: any) { Object.assign(this, mockMR); return mockMR; }) as any;
  MediaRecorderCtor.isTypeSupported = vi.fn(() => false);
  vi.stubGlobal('MediaRecorder', MediaRecorderCtor);

  const audioCtxInstance = makeAudioContext();
  vi.stubGlobal('AudioContext', vi.fn(function (this: any) { return audioCtxInstance; }));

  const offlineCtxInstance = makeOfflineAudioContext();
  vi.stubGlobal('OfflineAudioContext', vi.fn(function (this: any) { return offlineCtxInstance; }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── useAudioRecorder tests ────────────────────────────────────────────────────

describe('useAudioRecorder — initial state', () => {
  it('starts not recording', () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.isRecording).toBe(false);
  });

  it('starts with no permission', () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.hasPermission).toBe(false);
  });

  it('starts with zero duration', () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.duration).toBe(0);
  });

  it('starts with no error', () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.error).toBeNull();
  });

  it('starts with zero audio level', () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.audioLevel).toBe(0);
  });
});

describe('useAudioRecorder — requestPermission', () => {
  it('returns true and sets hasPermission when getUserMedia succeeds', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    let ok: boolean;
    await act(async () => {
      ok = await result.current.requestPermission();
    });

    expect(ok!).toBe(true);
    expect(result.current.hasPermission).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns false and sets error when getUserMedia fails', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(
      new Error('Permission denied')
    );
    const { result } = renderHook(() => useAudioRecorder());

    let ok: boolean;
    await act(async () => {
      ok = await result.current.requestPermission();
    });

    expect(ok!).toBe(false);
    expect(result.current.hasPermission).toBe(false);
    expect(result.current.error).toBe('Microphone permission denied');
  });
});

describe('useAudioRecorder — startRecording', () => {
  it('sets isRecording=true after starting', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
  });

  it('calls MediaRecorder.start', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockMR.start).toHaveBeenCalledWith(100);
  });

  it('sets error when getUserMedia fails', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(
      new Error('No mic found')
    );
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('No mic found');
    expect(result.current.isRecording).toBe(false);
  });

  it('sets hasPermission=true after successfully starting', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.hasPermission).toBe(true);
  });
});

describe('useAudioRecorder — cancelRecording', () => {
  it('sets isRecording=false after cancel', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      result.current.cancelRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });

  it('resets duration and audioLevel to 0 after cancel', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      result.current.cancelRecording();
    });

    expect(result.current.duration).toBe(0);
    expect(result.current.audioLevel).toBe(0);
  });
});

describe('useAudioRecorder — stopRecording', () => {
  it('resolves with a Blob when recording was active', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stopRecording();
    });

    expect(blob).toBeInstanceOf(Blob);
  });

  it('resolves with null when not recording', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    let blob: Blob | null = 'sentinel' as any;
    await act(async () => {
      blob = await result.current.stopRecording();
    });

    expect(blob).toBeNull();
  });
});

describe('useAudioRecorder — unmount cleanup', () => {
  it('unmounts without errors', async () => {
    const { unmount, result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(() => unmount()).not.toThrow();
  });
});

// ── convertToWav tests ────────────────────────────────────────────────────────

describe('convertToWav', () => {
  it('returns an ArrayBuffer', async () => {
    const blob = new Blob([new Uint8Array(16)], { type: 'audio/webm' });
    const result = await convertToWav(blob);
    expect(result).toBeInstanceOf(ArrayBuffer);
  });

  it('returned buffer starts with RIFF header', async () => {
    const blob = new Blob([new Uint8Array(16)], { type: 'audio/webm' });
    const buf = await convertToWav(blob);
    const view = new DataView(buf);
    // WAV RIFF magic: 0x52494646
    expect(view.getUint8(0)).toBe(0x52); // R
    expect(view.getUint8(1)).toBe(0x49); // I
    expect(view.getUint8(2)).toBe(0x46); // F
    expect(view.getUint8(3)).toBe(0x46); // F
  });

  it('returned buffer has WAVE identifier at offset 8', async () => {
    const blob = new Blob([new Uint8Array(16)], { type: 'audio/webm' });
    const buf = await convertToWav(blob);
    const view = new DataView(buf);
    expect(view.getUint8(8)).toBe(0x57);  // W
    expect(view.getUint8(9)).toBe(0x41);  // A
    expect(view.getUint8(10)).toBe(0x56); // V
    expect(view.getUint8(11)).toBe(0x45); // E
  });
});
