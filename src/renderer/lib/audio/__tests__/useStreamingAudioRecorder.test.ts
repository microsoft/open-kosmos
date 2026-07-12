/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStreamingAudioRecorder } from '../useStreamingAudioRecorder';

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── audio node helpers ────────────────────────────────────────────────────────

function makeAnalyser() {
  return {
    frequencyBinCount: 4,
    fftSize: 256,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(64)),
  };
}

function makeScriptProcessor() {
  return {
    onaudioprocess: null as any,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeGainNode() {
  return {
    gain: { value: 0 },
    connect: vi.fn(),
  };
}

function makeMediaStreamSource() {
  return { connect: vi.fn() };
}

function makeAudioContext() {
  const analyser = makeAnalyser();
  const processor = makeScriptProcessor();
  const gain = makeGainNode();
  const source = makeMediaStreamSource();

  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: {},
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => gain),
    close: vi.fn().mockResolvedValue(undefined),
    _analyser: analyser,
    _processor: processor,
    _gain: gain,
    _source: source,
  };
  return ctx;
}

function makeTrack() {
  return { stop: vi.fn(), kind: 'audio' };
}

function makeStream(tracks = [makeTrack()]) {
  return { getTracks: vi.fn(() => tracks) } as unknown as MediaStream;
}

// ── setup / teardown ──────────────────────────────────────────────────────────

let mockAudioCtx: ReturnType<typeof makeAudioContext>;
let mockStream: MediaStream;

beforeEach(() => {
  mockAudioCtx = makeAudioContext();
  mockStream = makeStream();

  vi.stubGlobal('AudioContext', vi.fn(function (this: any) { return mockAudioCtx; }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(function (cb: FrameRequestCallback) { cb(0); return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useStreamingAudioRecorder — initial state', () => {
  it('starts not recording', () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    expect(result.current.isRecording).toBe(false);
  });

  it('starts with no permission', () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    expect(result.current.hasPermission).toBe(false);
  });

  it('starts with zero duration', () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    expect(result.current.duration).toBe(0);
  });

  it('starts with no error', () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    expect(result.current.error).toBeNull();
  });

  it('starts with zero audio level', () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    expect(result.current.audioLevel).toBe(0);
  });
});

describe('useStreamingAudioRecorder — requestPermission', () => {
  it('returns true and sets hasPermission when getUserMedia succeeds', async () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    let ok: boolean;
    await act(async () => {
      ok = await result.current.requestPermission();
    });
    expect(ok!).toBe(true);
    expect(result.current.hasPermission).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns false and sets error when getUserMedia fails', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(new Error('Denied'));
    const { result } = renderHook(() => useStreamingAudioRecorder());
    let ok: boolean;
    await act(async () => {
      ok = await result.current.requestPermission();
    });
    expect(ok!).toBe(false);
    expect(result.current.hasPermission).toBe(false);
    expect(result.current.error).toBe('Microphone permission denied');
  });

  it('releases the permission-check stream immediately', async () => {
    const track = makeTrack();
    const permStream = makeStream([track]);
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValueOnce(permStream);
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.requestPermission(); });
    expect(track.stop).toHaveBeenCalled();
  });
});

describe('useStreamingAudioRecorder — startRecording', () => {
  it('sets isRecording=true after start', async () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.isRecording).toBe(true);
  });

  it('sets hasPermission=true after start', async () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.hasPermission).toBe(true);
  });

  it('sets error when getUserMedia fails', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(new Error('No mic'));
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.error).toBe('No mic');
    expect(result.current.isRecording).toBe(false);
  });

  it('sets generic error message when non-Error thrown', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue('bad');
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.error).toBe('Failed to start recording');
  });

  it('creates AudioContext and sets up nodes', async () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(mockAudioCtx.createAnalyser).toHaveBeenCalled();
    expect(mockAudioCtx.createScriptProcessor).toHaveBeenCalled();
    expect(mockAudioCtx.createGain).toHaveBeenCalled();
  });

  it('accepts custom sampleRate and chunkDuration options', async () => {
    const { result } = renderHook(() =>
      useStreamingAudioRecorder({ sampleRate: 8000, chunkDuration: 200 })
    );
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.isRecording).toBe(true);
  });
});

describe('useStreamingAudioRecorder — stopRecording', () => {
  it('sets isRecording=false', async () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    expect(result.current.isRecording).toBe(false);
  });

  it('resets duration and audioLevel', async () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    expect(result.current.duration).toBe(0);
    expect(result.current.audioLevel).toBe(0);
  });

  it('stops all media tracks', async () => {
    const track = makeTrack();
    const stream = makeStream([track]);
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValueOnce(stream);
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    expect(track.stop).toHaveBeenCalled();
  });

  it('disconnects scriptProcessor', async () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    const processor = mockAudioCtx._processor;
    act(() => { result.current.stopRecording(); });
    expect(processor.disconnect).toHaveBeenCalled();
  });

  it('can be called without having started (no-op)', () => {
    const { result } = renderHook(() => useStreamingAudioRecorder());
    expect(() => { result.current.stopRecording(); }).not.toThrow();
  });
});

describe('useStreamingAudioRecorder — onaudioprocess callback', () => {
  it('calls onAudioChunk when enough samples accumulated', async () => {
    const onAudioChunk = vi.fn();
    // Use small sampleRate and chunkDuration so processor threshold is low
    const { result } = renderHook(() =>
      useStreamingAudioRecorder({ sampleRate: 100, chunkDuration: 100, onAudioChunk })
    );
    await act(async () => { await result.current.startRecording(); });

    const processor = mockAudioCtx._processor;
    // samplesPerChunk = ceil(100 * (100/1000)) = 10
    // Fire onaudioprocess with 15 samples to exceed the threshold
    const inputBuffer = {
      getChannelData: vi.fn(() => new Float32Array(15).fill(0.1)),
    };
    act(() => {
      processor.onaudioprocess?.({ inputBuffer } as any);
    });

    expect(onAudioChunk).toHaveBeenCalledWith(expect.any(Float32Array));
    expect((onAudioChunk.mock.calls[0][0] as Float32Array).length).toBe(15);
  });

  it('does not call onAudioChunk if not enough samples yet', async () => {
    const onAudioChunk = vi.fn();
    const { result } = renderHook(() =>
      useStreamingAudioRecorder({ sampleRate: 16000, chunkDuration: 100, onAudioChunk })
    );
    await act(async () => { await result.current.startRecording(); });

    const processor = mockAudioCtx._processor;
    // samplesPerChunk = 1600; send only 4 samples
    const inputBuffer = {
      getChannelData: vi.fn(() => new Float32Array(4).fill(0.1)),
    };
    act(() => {
      processor.onaudioprocess?.({ inputBuffer } as any);
    });

    expect(onAudioChunk).not.toHaveBeenCalled();
  });

  it('skips processing when not recording', async () => {
    const onAudioChunk = vi.fn();
    const { result } = renderHook(() =>
      useStreamingAudioRecorder({ sampleRate: 100, chunkDuration: 100, onAudioChunk })
    );
    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    const processor = mockAudioCtx._processor;
    const inputBuffer = { getChannelData: vi.fn(() => new Float32Array(15).fill(0.1)) };
    act(() => { processor.onaudioprocess?.({ inputBuffer } as any); });

    expect(onAudioChunk).not.toHaveBeenCalled();
  });

  it('accumulates across multiple events before flushing', async () => {
    const onAudioChunk = vi.fn();
    const { result } = renderHook(() =>
      useStreamingAudioRecorder({ sampleRate: 100, chunkDuration: 100, onAudioChunk })
    );
    await act(async () => { await result.current.startRecording(); });

    const processor = mockAudioCtx._processor;
    const inputBuffer = { getChannelData: vi.fn(() => new Float32Array(6).fill(0.1)) };
    // First call: 6 samples, threshold=10 — not flushed yet
    act(() => { processor.onaudioprocess?.({ inputBuffer } as any); });
    expect(onAudioChunk).not.toHaveBeenCalled();
    // Second call: 12 total — flush
    act(() => { processor.onaudioprocess?.({ inputBuffer } as any); });
    expect(onAudioChunk).toHaveBeenCalledTimes(1);
  });
});

describe('useStreamingAudioRecorder — onAudioChunk ref update', () => {
  it('uses the latest callback ref without re-creating processor', async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const { result, rerender } = renderHook(
      ({ cb }: { cb: (d: Float32Array) => void }) =>
        useStreamingAudioRecorder({ sampleRate: 100, chunkDuration: 100, onAudioChunk: cb }),
      { initialProps: { cb: cb1 } }
    );

    await act(async () => { await result.current.startRecording(); });

    // Switch callback via rerender
    rerender({ cb: cb2 });

    const processor = mockAudioCtx._processor;
    const inputBuffer = { getChannelData: vi.fn(() => new Float32Array(15).fill(0.1)) };
    act(() => { processor.onaudioprocess?.({ inputBuffer } as any); });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });
});

describe('useStreamingAudioRecorder — audio level visualization', () => {
  it('calls onAudioLevel callback', async () => {
    const onAudioLevel = vi.fn();
    const { result } = renderHook(() =>
      useStreamingAudioRecorder({ onAudioLevel })
    );
    await act(async () => { await result.current.startRecording(); });
    // requestAnimationFrame is stubbed to call the callback immediately once
    expect(onAudioLevel).toHaveBeenCalled();
    const level = onAudioLevel.mock.calls[0][0] as number;
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(1);
  });
});

describe('useStreamingAudioRecorder — duration counter', () => {
  it('starts an interval timer on startRecording', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    setIntervalSpy.mockRestore();
  });

  it('clears the interval on stopRecording', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

describe('useStreamingAudioRecorder — cleanup on unmount', () => {
  it('unmounts without errors', async () => {
    const { unmount, result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(() => unmount()).not.toThrow();
  });

  it('stops media tracks on unmount', async () => {
    const track = makeTrack();
    const stream = makeStream([track]);
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValueOnce(stream);
    const { unmount, result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('skips close on already-closed AudioContext', async () => {
    // Simulate a closed context to cover the state !== 'closed' guard
    (mockAudioCtx as any).state = 'closed';
    const { result } = renderHook(() => useStreamingAudioRecorder());
    await act(async () => { await result.current.startRecording(); });
    // stopRecording should not throw even if context is closed
    expect(() => { result.current.stopRecording(); }).not.toThrow();
  });
});
