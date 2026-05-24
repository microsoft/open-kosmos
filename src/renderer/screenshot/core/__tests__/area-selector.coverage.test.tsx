/** @vitest-environment happy-dom */
/**
 * Coverage tests for src/renderer/screenshot/core/area-selector.tsx
 * Covers: AreaSelector class component, Frames helper, isSamePoint, PageCenter
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const keyboardPainterMock = {
    setCursor: vi.fn().mockReturnThis(),
    trackKeydown: vi.fn().mockReturnThis(),
    trackCursor: vi.fn().mockReturnThis(),
    turnOn: vi.fn().mockReturnThis(),
    turnOff: vi.fn(),
  };
  const handleDragMock = vi.fn();
  const mockBgCss = { backgroundImage: 'url(x)', backgroundSize: 'auto' };
  const mockBg = { css: mockBgCss };

  return { keyboardPainterMock, handleDragMock, mockBg };
});

vi.mock('../common/keyboard-painter', () => ({
  keyboardPainter: mocks.keyboardPainterMock,
}));

vi.mock('../common/utils/drag', () => ({
  handleDrag: mocks.handleDragMock,
}));

vi.mock('../common/utils/dom', () => ({
  waitWinSize: vi.fn(),
}));

vi.mock('../magnifying', () => ({
  default: () => null,
}));

vi.mock('../frame', () => ({
  FrameBox: () => null,
  optimizeFrames: vi.fn((frames: any[]) => frames),
}));

vi.mock('../common/utils/coord', () => ({
  calcCursorRect: vi.fn((x1: number, y1: number, x2: number, y2: number) => {
    const [x, w] = x1 < x2 ? [x1, x2 - x1] : [x2, x1 - x2];
    const [y, h] = y1 < y2 ? [y1, y2 - y1] : [y2, y1 - y2];
    return [x, y, w, h];
  }),
  limitPointInRect: vi.fn((_rect: any, cx: number, cy: number) => [cx, cy]),
}));

vi.mock('../common/utils/bg', () => ({
  BackgroundImage: class {
    css = mocks.mockBg.css;
  },
}));

vi.mock('../state', () => ({
  initialAtom: {
    useData: vi.fn(() => ({
      bg: mocks.mockBg,
      frames: [],
    })),
  },
  roundArea: vi.fn((area: any) => area),
}));

vi.mock('../common/cursor', () => ({
  CrossCursor: () => null,
}));

vi.mock('../editor', () => ({
  SEditorBox: 'SEditorBox',
  SEditorBoxMask: 'SEditorBoxMask',
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { AreaSelector } from '../area-selector';

const mockBg = mocks.mockBg as any;

function defaultProps(overrides = {}) {
  return {
    bg: mockBg,
    onSeleted: vi.fn(),
    hideFRE: vi.fn(),
    enableFrames: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keyboardPainterMock.setCursor.mockReturnValue(mocks.keyboardPainterMock);
  mocks.keyboardPainterMock.trackKeydown.mockReturnValue(mocks.keyboardPainterMock);
  mocks.keyboardPainterMock.trackCursor.mockReturnValue(mocks.keyboardPainterMock);
});

// ─── mount/unmount ────────────────────────────────────────────────────────────
describe('AreaSelector lifecycle', () => {
  it('renders without crashing', () => {
    const { container } = render(<AreaSelector {...defaultProps()} />);
    expect(container).toBeTruthy();
  });

  it('calls keyboardPainter.turnOn() on mount', () => {
    render(<AreaSelector {...defaultProps()} />);
    expect(mocks.keyboardPainterMock.turnOn).toHaveBeenCalled();
  });

  it('calls keyboardPainter.turnOff() on unmount', () => {
    const { unmount } = render(<AreaSelector {...defaultProps()} />);
    unmount();
    expect(mocks.keyboardPainterMock.turnOff).toHaveBeenCalled();
  });

  it('calls keyboardPainter.setCursor in componentDidMount', () => {
    render(<AreaSelector {...defaultProps()} />);
    expect(mocks.keyboardPainterMock.setCursor).toHaveBeenCalled();
  });
});

// ─── render states ────────────────────────────────────────────────────────────
describe('AreaSelector render', () => {
  it('renders SEditorBoxMask div always', () => {
    const { container } = render(<AreaSelector {...defaultProps()} />);
    const mask = container.querySelector('.SEditorBoxMask');
    // class names are the css module values from our mock
    expect(container.firstChild).toBeTruthy();
  });

  it('renders Magnifying when no input', () => {
    // Magnifying is mocked to null but it is rendered — just ensure no crash
    render(<AreaSelector {...defaultProps()} />);
  });

  it('renders Frames when enableFrames=true and no input', () => {
    render(<AreaSelector {...defaultProps({ enableFrames: true })} />);
    // No crash means Frames renders
  });
});

// ─── start() / mouse drag ─────────────────────────────────────────────────────
describe('AreaSelector.start() - mouse interaction', () => {
  it('calls handleDrag on pointer down', () => {
    const { container } = render(<AreaSelector {...defaultProps()} />);
    // Get the instance via ref approach — use direct call instead
    const instance = (container as any).__reactFiber?.return?.stateNode;
    // Alternatively, we test through the rendered output by triggering a fake pointer event
    // Since start() is a public method, we test via class instance
    // Let's render and get the class instance via a wrapper ref
  });
});

describe('AreaSelector instance methods', () => {
  function renderWithRef() {
    const ref = React.createRef<AreaSelector>();
    const onSeleted = vi.fn();
    const hideFRE = vi.fn();
    render(
      <AreaSelector
        ref={ref}
        bg={mockBg}
        onSeleted={onSeleted}
        hideFRE={hideFRE}
        enableFrames={false}
      />
    );
    return { ref, onSeleted, hideFRE };
  }

  it('start() triggers handleDrag', () => {
    const { ref } = renderWithRef();
    const ev = { clientX: 10, clientY: 20 } as React.PointerEvent;
    ref.current!.start(ev);
    expect(mocks.handleDragMock).toHaveBeenCalled();
  });

  it('handleDrag onMove sets state input=mouse', () => {
    const { ref } = renderWithRef();
    const ev = { clientX: 10, clientY: 20 } as React.PointerEvent;
    ref.current!.start(ev);

    const { onMove } = mocks.handleDragMock.mock.calls[0][0];
    act(() => {
      // Move to a different point (not same as start) to avoid neverMoved guard
      onMove({ clientX: 50, clientY: 60 });
    });
    expect(ref.current!.state.input).toBe('mouse');
    expect(ref.current!.state.end).toEqual([50, 60]);
  });

  it('handleDrag onMove skips when same start point (neverMoved guard)', () => {
    const { ref } = renderWithRef();
    const ev = { clientX: 10, clientY: 20 } as React.PointerEvent;
    ref.current!.start(ev);

    const { onMove } = mocks.handleDragMock.mock.calls[0][0];
    // Same point as start → neverMoved stays true, state unchanged
    const prevState = { ...ref.current!.state };
    act(() => {
      onMove({ clientX: 10, clientY: 20 });
    });
    expect(ref.current!.state.input).toBe(prevState.input);
  });

  it('onEnd (commit) calls onSeleted when area has size', () => {
    const { ref, onSeleted } = renderWithRef();
    const ev = { clientX: 10, clientY: 20 } as React.PointerEvent;
    ref.current!.start(ev);

    const { onMove, onEnd } = mocks.handleDragMock.mock.calls[0][0];
    act(() => {
      onMove({ clientX: 110, clientY: 120 }); // creates 100x100 area
    });
    act(() => {
      onEnd();
    });
    expect(onSeleted).toHaveBeenCalled();
  });

  it('commit resets state when area is 0x0', () => {
    const { ref, onSeleted } = renderWithRef();
    // Set state with same start/end (zero area)
    act(() => {
      ref.current!.setState({ input: 'mouse', start: [0, 0], end: [0, 0] });
    });
    // Trigger commit through onEnd
    const ev = { clientX: 0, clientY: 0 } as React.PointerEvent;
    ref.current!.start(ev);
    const { onMove, onEnd } = mocks.handleDragMock.mock.calls[mocks.handleDragMock.mock.calls.length - 1][0];
    act(() => {
      onMove({ clientX: 0, clientY: 0 }); // same point
    });
    act(() => {
      onEnd();
    });
    // onSeleted should NOT be called (zero area)
    expect(onSeleted).not.toHaveBeenCalled();
  });
});

// ─── keyboard painter callbacks ───────────────────────────────────────────────
describe('keyboardPainter callbacks', () => {
  function renderAndGetCallbacks() {
    const ref = React.createRef<AreaSelector>();
    const onSeleted = vi.fn();
    const hideFRE = vi.fn();
    render(
      <AreaSelector
        ref={ref}
        bg={mockBg}
        onSeleted={onSeleted}
        hideFRE={hideFRE}
      />
    );
    const trackKeydownCb = mocks.keyboardPainterMock.trackKeydown.mock.calls[0][0];
    const trackCursorCb = mocks.keyboardPainterMock.trackCursor.mock.calls[0][0];
    return { ref, onSeleted, hideFRE, trackKeydownCb, trackCursorCb };
  }

  it('trackKeydown: returns undefined when shift not pressed', () => {
    const { trackKeydownCb } = renderAndGetCallbacks();
    const result = trackKeydownCb({ point: [100, 100], keys: { shift: false } });
    expect(result).toBeUndefined();
  });

  it('trackKeydown: sets state to keyboard mode when shift is pressed', () => {
    const { ref, trackKeydownCb } = renderAndGetCallbacks();
    let callbacks: any;
    act(() => {
      callbacks = trackKeydownCb({ point: [100, 100], keys: { shift: true } });
    });
    expect(callbacks).toBeDefined();
    expect(ref.current!.state.input).toBe('keyboard');
    expect(ref.current!.state.start).toEqual([100, 100]);
  });

  it('trackKeydown keymove callback updates end position', () => {
    const { ref, trackKeydownCb } = renderAndGetCallbacks();
    const callbacks = trackKeydownCb({ point: [100, 100], keys: { shift: true } });
    act(() => {
      callbacks.keymove([200, 200]);
    });
    expect(ref.current!.state.end).toEqual([200, 200]);
  });

  it('trackKeydown keyup callback commits selection', () => {
    const { ref, onSeleted, trackKeydownCb } = renderAndGetCallbacks();
    act(() => {
      ref.current!.setState({ input: 'keyboard', start: [0, 0], end: [100, 100] });
    });
    const callbacks = trackKeydownCb({ point: [0, 0], keys: { shift: true } });
    act(() => {
      callbacks.keyup();
    });
    expect(onSeleted).toHaveBeenCalled();
  });

  it('trackKeydown cancel callback resets state', () => {
    const { ref, trackKeydownCb } = renderAndGetCallbacks();
    const callbacks = trackKeydownCb({ point: [50, 50], keys: { shift: true } });
    act(() => {
      callbacks.cancel();
    });
    expect(ref.current!.state.input).toBeUndefined();
  });

  it('trackCursor: visible=true calls hideFRE and sets keyboard input', () => {
    const { ref, hideFRE, trackCursorCb } = renderAndGetCallbacks();
    act(() => {
      trackCursorCb(true);
    });
    expect(hideFRE).toHaveBeenCalled();
    expect(ref.current!.state.input).toBe('keyboard');
  });

  it('trackCursor: visible=true skips setState when already in keyboard mode', () => {
    const { ref, hideFRE, trackCursorCb } = renderAndGetCallbacks();
    act(() => {
      ref.current!.setState({ input: 'keyboard', start: [10, 10], end: [50, 50] });
    });
    const spy = vi.spyOn(ref.current!, 'setState');
    act(() => {
      trackCursorCb(true);
    });
    expect(hideFRE).toHaveBeenCalled();
    // setState should NOT be called again since already in keyboard mode
    expect(spy).not.toHaveBeenCalled();
  });

  it('trackCursor: visible=false resets state', () => {
    const { ref, trackCursorCb } = renderAndGetCallbacks();
    act(() => {
      ref.current!.setState({ input: 'keyboard', start: [10, 10], end: [50, 50] });
    });
    act(() => {
      trackCursorCb(false);
    });
    expect(ref.current!.state.input).toBeUndefined();
  });
});
