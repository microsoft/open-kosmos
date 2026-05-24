/**
 * @vitest-environment happy-dom
 *
 * Tests for useSpeechRecognition hook.
 *
 * Because the Web Speech API is not available in happy-dom we install a
 * fake SpeechRecognition class on window so the hook's isSupported path
 * is exercised.  Tests that need recognition events manually fire the
 * handler callbacks registered on the instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from '../useSpeechRecognition';

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── fake SpeechRecognition ────────────────────────────────────────────────────

type EventHandlerKey =
  | 'onstart' | 'onend' | 'onresult' | 'onerror'
  | 'onspeechend' | 'onsoundstart' | 'onsoundend'
  | 'onaudiostart' | 'onaudioend' | 'onnomatch' | 'onspeechstart';

interface FakeSR {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  [key: string]: any;
}

let fakeSRInstance: FakeSR;

function makeFakeSRClass() {
  return vi.fn(function (this: FakeSR) {
    this.continuous = false;
    this.interimResults = true;
    this.lang = '';
    this.maxAlternatives = 1;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.abort = vi.fn();
    fakeSRInstance = this;
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fireSREvent(handler: EventHandlerKey, eventData: any = {}) {
  const fn = fakeSRInstance?.[handler];
  if (typeof fn === 'function') fn(eventData);
}

function makeSpeechEvent(results: Array<{ transcript: string; isFinal: boolean }>) {
  const srResults = results.map(({ transcript, isFinal }) => ({
    isFinal,
    length: 1,
    0: { transcript, confidence: 1 },
    item: (i: number) => (i === 0 ? { transcript, confidence: 1 } : null),
  }));

  return {
    resultIndex: 0,
    results: {
      length: srResults.length,
      item: (i: number) => srResults[i],
      ...Object.fromEntries(srResults.map((r, i) => [i, r])),
    },
  };
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  const FakeSR = makeFakeSRClass();
  (window as any).SpeechRecognition = FakeSR;
  delete (window as any).webkitSpeechRecognition;
});

afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
  vi.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useSpeechRecognition — support detection', () => {
  it('reports isSupported=true when SpeechRecognition is on window', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(true);
  });

  it('reports isSupported=false when neither API variant is present', () => {
    delete (window as any).SpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(false);
  });

  it('falls back to webkitSpeechRecognition', () => {
    delete (window as any).SpeechRecognition;
    const FakeSR = makeFakeSRClass();
    (window as any).webkitSpeechRecognition = FakeSR;
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(true);
  });
});

describe('useSpeechRecognition — initial state', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.status).toBe('idle');
  });

  it('starts not listening', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isListening).toBe(false);
  });

  it('starts with empty transcript', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.transcript).toBe('');
  });

  it('starts with empty finalTranscript', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.finalTranscript).toBe('');
  });

  it('starts with no error', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.error).toBeNull();
  });

  it('sets status=not-supported when API is absent', () => {
    delete (window as any).SpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.status).toBe('not-supported');
  });
});

describe('useSpeechRecognition — startListening / stopListening', () => {
  it('calls recognition.start() when startListening is called', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => { result.current.startListening(); });

    expect(fakeSRInstance.start).toHaveBeenCalledOnce();
  });

  it('sets status=listening after onstart fires', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    expect(result.current.status).toBe('listening');
    expect(result.current.isListening).toBe(true);
  });

  it('calls recognition.stop() when stopListening is called while listening', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => { result.current.stopListening(); });

    expect(fakeSRInstance.stop).toHaveBeenCalledOnce();
  });

  it('does not call stop when not listening', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => { result.current.stopListening(); });
    expect(fakeSRInstance.stop).not.toHaveBeenCalled();
  });
});

describe('useSpeechRecognition — toggleListening', () => {
  it('starts listening when idle', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => { result.current.toggleListening(); });

    expect(fakeSRInstance.start).toHaveBeenCalledOnce();
  });

  it('stops listening when already listening', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => { result.current.toggleListening(); });

    expect(fakeSRInstance.stop).toHaveBeenCalledOnce();
  });
});

describe('useSpeechRecognition — speech events', () => {
  it('updates transcript with interim result', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => {
      fireSREvent('onresult', makeSpeechEvent([{ transcript: 'hello', isFinal: false }]));
    });

    expect(result.current.transcript).toBe('hello');
  });

  it('updates finalTranscript with final result', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => {
      fireSREvent('onresult', makeSpeechEvent([{ transcript: 'world', isFinal: true }]));
    });

    expect(result.current.finalTranscript).toBe('world');
  });

  it('calls onTranscript callback with final=true for final results', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useSpeechRecognition({ onTranscript })
    );

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => {
      fireSREvent('onresult', makeSpeechEvent([{ transcript: 'done', isFinal: true }]));
    });

    expect(onTranscript).toHaveBeenCalledWith('done', true);
  });

  it('sets status=processing on onspeechend', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => { fireSREvent('onspeechend', {}); });

    expect(result.current.status).toBe('processing');
  });

  it('sets status=idle on recognition end', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => { fireSREvent('onend', {}); });

    expect(result.current.status).toBe('idle');
  });
});

describe('useSpeechRecognition — error handling', () => {
  it('sets status=error on onerror event', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => {
      fireSREvent('onerror', { error: 'no-speech', message: '' });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.code).toBe('no-speech');
  });

  it('calls onError callback when error fires', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => {
      fireSREvent('onerror', { error: 'not-allowed', message: '' });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'not-allowed' })
    );
  });
});

describe('useSpeechRecognition — clearTranscript', () => {
  it('resets transcript and finalTranscript to empty strings', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => {
      fireSREvent('onresult', makeSpeechEvent([{ transcript: 'hello', isFinal: true }]));
    });

    act(() => { result.current.clearTranscript(); });

    expect(result.current.transcript).toBe('');
    expect(result.current.finalTranscript).toBe('');
  });
});

describe('useSpeechRecognition — options', () => {
  it('passes lang option to recognition instance', () => {
    renderHook(() => useSpeechRecognition({ lang: 'zh-CN' }));
    expect(fakeSRInstance.lang).toBe('zh-CN');
  });

  it('passes continuous option to recognition instance', () => {
    renderHook(() => useSpeechRecognition({ continuous: true }));
    expect(fakeSRInstance.continuous).toBe(true);
  });

  it('passes interimResults option to recognition instance', () => {
    renderHook(() => useSpeechRecognition({ interimResults: false }));
    expect(fakeSRInstance.interimResults).toBe(false);
  });

  it('calls onStart callback when recognition starts', () => {
    const onStart = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onStart }));

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    expect(onStart).toHaveBeenCalledOnce();
  });

  it('calls onEnd callback when recognition ends', () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onEnd }));

    act(() => {
      result.current.startListening();
      fireSREvent('onstart', {});
    });

    act(() => { fireSREvent('onend', {}); });

    expect(onEnd).toHaveBeenCalledOnce();
  });
});

describe('useSpeechRecognition — unmount cleanup', () => {
  it('calls recognition.abort() on unmount', () => {
    const { unmount } = renderHook(() => useSpeechRecognition());
    unmount();
    expect(fakeSRInstance.abort).toHaveBeenCalledOnce();
  });
});
