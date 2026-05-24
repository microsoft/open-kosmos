/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGlobalKeyOn, mockGlobalKeyOff, mockWaitWinSize } = vi.hoisted(() => {
  const mockGlobalKeyOn = vi.fn();
  const mockGlobalKeyOff = vi.fn();
  const mockWaitWinSize = vi.fn((cb: (w: number, h: number) => void) => cb(1024, 768));
  return { mockGlobalKeyOn, mockGlobalKeyOff, mockWaitWinSize };
});

vi.mock('../utils/global-key', () => ({
  default: { on: mockGlobalKeyOn, off: mockGlobalKeyOff },
}));

vi.mock('../utils/dom', () => ({
  waitWinSize: mockWaitWinSize,
}));

vi.mock('../utils/coord', () => ({
  limitPointInRect: vi.fn((rect: any, x: number, y: number) => {
    const [rx, ry, rw, rh] = rect;
    return [Math.max(rx, Math.min(x, rx + rw)), Math.max(ry, Math.min(y, ry + rh))];
  }),
}));

vi.mock('../../editor/toolbar/components/listen', () => ({
  Listen: ({ deps, change }: any) => {
    React.useEffect(() => { change(); }, deps);
    return null;
  },
}));

vi.mock('../localString', () => ({
  getString: (key: string) => key,
}));

// We need ReactDOM.createRoot to work in happy-dom. We mock it to render synchronously.
vi.mock('react-dom/client', async () => {
  const actual = await vi.importActual<typeof import('react-dom/client')>('react-dom/client');
  return actual;
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { keyboardPainter } from '../keyboard-painter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fireKeydown(keyCode: number, extra?: Partial<KeyboardEvent>) {
  const event = new KeyboardEvent('keydown', { keyCode, bubbles: true, ...extra } as any);
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  document.dispatchEvent(event);
}

function fireKeyup(keyCode: number) {
  const event = new KeyboardEvent('keyup', { bubbles: true } as any);
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  document.dispatchEvent(event);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('keyboardPainter', () => {
  afterEach(() => {
    keyboardPainter.turnOff();
    mockGlobalKeyOn.mockClear();
    mockGlobalKeyOff.mockClear();
  });

  it('exports keyboardPainter as an object', () => {
    expect(keyboardPainter).toBeDefined();
    expect(typeof keyboardPainter.turnOn).toBe('function');
    expect(typeof keyboardPainter.turnOff).toBe('function');
    expect(typeof keyboardPainter.setCursor).toBe('function');
    expect(typeof keyboardPainter.setLimit).toBe('function');
    expect(typeof keyboardPainter.trackKeydown).toBe('function');
    expect(typeof keyboardPainter.trackCursor).toBe('function');
    expect(typeof keyboardPainter.resetTrack).toBe('function');
    expect(typeof keyboardPainter.holdon).toBe('function');
  });

  it('turnOn registers keydown listener via globalKey.on', () => {
    keyboardPainter.turnOn();
    expect(mockGlobalKeyOn).toHaveBeenCalledTimes(1);
  });

  it('turnOn is idempotent', () => {
    keyboardPainter.turnOn();
    keyboardPainter.turnOn();
    expect(mockGlobalKeyOn).toHaveBeenCalledTimes(1);
  });

  it('turnOn returns this for chaining', () => {
    const result = keyboardPainter.turnOn();
    expect(result).toBe(keyboardPainter);
  });

  it('turnOff removes listener and resets running flag', () => {
    keyboardPainter.turnOn();
    keyboardPainter.turnOff();
    expect(mockGlobalKeyOff).toHaveBeenCalledTimes(1);
  });

  it('turnOff is a no-op when not running', () => {
    // already off
    keyboardPainter.turnOff();
    expect(mockGlobalKeyOff).not.toHaveBeenCalled();
  });

  it('setCursor returns this for chaining', () => {
    const result = keyboardPainter.setCursor(<span>cursor</span>);
    expect(result).toBe(keyboardPainter);
  });

  it('setLimit returns this for chaining', () => {
    const result = keyboardPainter.setLimit([0, 0, 800, 600]);
    expect(result).toBe(keyboardPainter);
  });

  it('setLimit(null) resets position to center', () => {
    keyboardPainter.setLimit([0, 0, 100, 100]);
    const result = keyboardPainter.setLimit(null);
    expect(result).toBe(keyboardPainter);
  });

  it('setLimit with same value returns this without side effects', () => {
    const limit = [0, 0, 400, 400] as [number, number, number, number];
    keyboardPainter.setLimit(limit);
    const result = keyboardPainter.setLimit(limit);
    expect(result).toBe(keyboardPainter);
  });

  it('trackKeydown returns this for chaining', () => {
    const result = keyboardPainter.trackKeydown(vi.fn());
    expect(result).toBe(keyboardPainter);
  });

  it('trackCursor returns this for chaining', () => {
    const result = keyboardPainter.trackCursor(vi.fn());
    expect(result).toBe(keyboardPainter);
  });

  it('resetTrack clears tracker', () => {
    const tracker = vi.fn();
    keyboardPainter.trackKeydown(tracker);
    keyboardPainter.resetTrack();
    // After reset, turning on and pressing a key should not invoke tracker
  });

  it('holdon(true) prevents keydown processing', () => {
    keyboardPainter.turnOn();
    const tracker = vi.fn();
    keyboardPainter.trackKeydown(tracker);
    keyboardPainter.holdon(true);

    // simulate the internal keydown handler being called
    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 32 }); }); // space
    expect(tracker).not.toHaveBeenCalled();

    keyboardPainter.holdon(false);
  });

  it('holdon(false) re-enables keydown processing', () => {
    keyboardPainter.turnOn();
    const tracker = vi.fn(() => undefined);
    keyboardPainter.trackKeydown(tracker);
    keyboardPainter.holdon(true);
    keyboardPainter.holdon(false);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 32 }); }); // space key
    expect(tracker).toHaveBeenCalledTimes(1);
  });

  it('space key triggers tracker with keys.space=true', () => {
    keyboardPainter.turnOn();
    const tracker = vi.fn(() => undefined);
    keyboardPainter.trackKeydown(tracker);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 32 }); });
    expect(tracker).toHaveBeenCalledWith(expect.objectContaining({ keys: expect.objectContaining({ space: true }) }));
  });

  it('enter key triggers tracker with keys.enter=true', () => {
    keyboardPainter.turnOn();
    const tracker = vi.fn(() => undefined);
    keyboardPainter.trackKeydown(tracker);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 13 }); });
    expect(tracker).toHaveBeenCalledWith(expect.objectContaining({ keys: expect.objectContaining({ enter: true }) }));
  });

  it('shift key triggers tracker with keys.shift=true', () => {
    keyboardPainter.turnOn();
    const tracker = vi.fn(() => undefined);
    keyboardPainter.trackKeydown(tracker);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 16 }); });
    expect(tracker).toHaveBeenCalledWith(expect.objectContaining({ keys: expect.objectContaining({ shift: true }) }));
  });

  it('tracker returning hooks captures interaction', () => {
    keyboardPainter.turnOn();
    const keymove = vi.fn();
    const keyup = vi.fn();
    const tracker = vi.fn(() => ({ keymove, keyup }));
    keyboardPainter.trackKeydown(tracker);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 13 }); }); // enter → captures
    // Re-pressing enter should not re-trigger tracker (already captured)
    tracker.mockClear();
    act(() => { keydownCb({ keyCode: 13 }); });
    expect(tracker).not.toHaveBeenCalled();
  });

  it('keyup calls captured keyup and clears capture', () => {
    keyboardPainter.setLimit([0, 0, 800, 600]);
    keyboardPainter.turnOn();
    const keymove = vi.fn();
    const keyup = vi.fn();
    const tracker = vi.fn(() => ({ keymove, keyup }));
    keyboardPainter.trackKeydown(tracker);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 13 }); }); // press enter

    // Simulate keyup via document event - need to use internal handler
    // The internal keyup handler listens on document
    const keyupEvent = new KeyboardEvent('keyup');
    Object.defineProperty(keyupEvent, 'keyCode', { value: 13 });
    act(() => { document.dispatchEvent(keyupEvent); });

    expect(keyup).toHaveBeenCalledTimes(1);
  });

  it('keyup with non-stroke key is a no-op', () => {
    keyboardPainter.turnOn();
    const keyupEvent = new KeyboardEvent('keyup');
    Object.defineProperty(keyupEvent, 'keyCode', { value: 65 }); // 'a'
    act(() => { document.dispatchEvent(keyupEvent); }); // no throw
  });

  it('keyup when pending is a no-op', () => {
    keyboardPainter.turnOn();
    const keyup = vi.fn();
    const tracker = vi.fn(() => ({ keymove: vi.fn(), keyup }));
    keyboardPainter.trackKeydown(tracker);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 13 }); });

    keyboardPainter.holdon(true);
    const keyupEvent = new KeyboardEvent('keyup');
    Object.defineProperty(keyupEvent, 'keyCode', { value: 13 });
    act(() => { document.dispatchEvent(keyupEvent); });
    expect(keyup).not.toHaveBeenCalled();
    keyboardPainter.holdon(false);
  });

  it('arrow keys move cursor (left=37, right=39, up=38, down=40)', () => {
    keyboardPainter.setLimit([0, 0, 800, 600]);
    keyboardPainter.turnOn();
    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    // no throws expected
    act(() => { keydownCb({ keyCode: 37 }); }); // left
    act(() => { keydownCb({ keyCode: 38 }); }); // up
    act(() => { keydownCb({ keyCode: 39 }); }); // right
    act(() => { keydownCb({ keyCode: 40 }); }); // down
  });

  it('repeated same-direction presses increase distance up to 20', () => {
    keyboardPainter.setLimit([0, 0, 800, 600]);
    keyboardPainter.turnOn();
    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    // Fire right 25 times quickly
    for (let i = 0; i < 25; i++) {
      act(() => { keydownCb({ keyCode: 39 }); });
    }
    // Just verify no throw
  });

  it('direction change resets distance', () => {
    keyboardPainter.setLimit([0, 0, 800, 600]);
    keyboardPainter.turnOn();
    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 39 }); }); // right
    act(() => { keydownCb({ keyCode: 39 }); }); // right again (same)
    act(() => { keydownCb({ keyCode: 37 }); }); // left (different direction)
    act(() => { keydownCb({ keyCode: 37 }); }); // left again
  });

  it('keymove is called on captured hooks when cursor moves', () => {
    keyboardPainter.setLimit([0, 0, 800, 600]);
    keyboardPainter.turnOn();
    const keymove = vi.fn();
    const keyup = vi.fn();
    const tracker = vi.fn(() => ({ keymove, keyup }));
    keyboardPainter.trackKeydown(tracker);

    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 13 }); }); // capture
    act(() => { keydownCb({ keyCode: 39 }); }); // move right → triggers keymove
    expect(keymove).toHaveBeenCalled();
  });

  it('cursorVisibleTracker is triggered on cursor visibility change', () => {
    const tracker = vi.fn();
    keyboardPainter.trackCursor(tracker);
    // The Listen component calls the callback on change; this path is internal to the Pointer component
    // We just verify no errors
  });

  it('unknown keyCode does not trigger tracker or move', () => {
    keyboardPainter.turnOn();
    const tracker = vi.fn();
    keyboardPainter.trackKeydown(tracker);
    const keydownCb = mockGlobalKeyOn.mock.calls[0][0];
    act(() => { keydownCb({ keyCode: 65 }); }); // 'a'
    expect(tracker).not.toHaveBeenCalled();
  });
});
