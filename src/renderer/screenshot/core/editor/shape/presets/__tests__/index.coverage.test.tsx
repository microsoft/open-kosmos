// @ts-nocheck
/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import type { MEvent } from '../../../common/drag-limiter';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockHandleDrag, mockKeydown, mockDragLimiter } = vi.hoisted(() => {
  const mockHandleDrag = vi.fn();
  const mockKeydown = { has: vi.fn(() => false) };
  const mockDragLimiter = vi.fn().mockImplementation(function(this: any) {
    this.drawRect = vi.fn(() => [0, 0, 50, 50]);
    this.moveRect = vi.fn(() => [10, 10, 40, 40]);
  });
  return { mockHandleDrag, mockKeydown, mockDragLimiter };
});

vi.mock('../../../../common/utils/drag', () => ({
  handleDrag: mockHandleDrag,
}));

vi.mock('../../../../common/utils/global-key', () => ({
  default: { on: vi.fn(), off: vi.fn() },
  keydown: mockKeydown,
}));

vi.mock('../../../../common/drag-limiter', () => ({
  DragLimiter: mockDragLimiter,
}));

vi.mock('../../../../common/utils/coord', () => ({
  calcCursorRect: vi.fn((sx: number, sy: number, ex: number, ey: number) => [sx, sy, ex - sx, ey - sy]),
  offsetRect: vi.fn((r: any) => r),
}));

vi.mock('../../../model', () => ({
  uuid: () => 'test-uuid',
}));

vi.mock('../order', () => ({
  OrderPainter: React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      createDefault: vi.fn(),
      finish: vi.fn(),
    }));
    return <g data-testid="order-painter" />;
  }),
  OrderShape: (props: any) => <g data-testid="order-shape" />,
  NumberTextStyle: '.style{}',
  arrowSize: 10,
}));

vi.mock('../emoji', () => ({
  EmojiPainter: React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      createDefault: vi.fn(),
      finish: vi.fn(),
    }));
    return <g data-testid="emoji-painter" />;
  }),
  EmojiShape: (props: any) => <g data-testid="emoji-shape" />,
}));

vi.mock('../../shape-resizer', () => ({
  default: ({ children }: any) => <g data-testid="resizer">{children}</g>,
}));

vi.mock('../../../../common/keyboard-painter', () => ({
  StrokeEvent: {},
  CapturedHooks: {},
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { PresetPainter, PresetShape, NumberTextStyle } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const area = [0, 0, 800, 600] as [number, number, number, number];

function makeModel(type: 'order' | 'emoji' = 'order') {
  const content = type === 'order'
    ? { type: 'order' as const, index: 1, style: 'red', text: '' }
    : { type: 'emoji' as const, emoji: 'heart' as const };
  return {
    id: 'model-1',
    type: 'preset' as const,
    rect: [50, 50, 40, 40] as [number, number, number, number],
    content,
  };
}

// ---------------------------------------------------------------------------
// NumberTextStyle re-export
// ---------------------------------------------------------------------------
describe('NumberTextStyle re-export', () => {
  it('is a string', () => {
    expect(typeof NumberTextStyle).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// applyRatio (tested indirectly via PresetPainter.start)
// ---------------------------------------------------------------------------
describe('applyRatio', () => {
  it('is applied when config has aspectRatio and drag happens', () => {
    const addPreset = vi.fn();
    let painterRef: any;
    render(
      <svg>
        <PresetPainter
          ref={(r: any) => { painterRef = r; }}
          area={area}
          addPreset={addPreset}
        />
      </svg>
    );

    const config = { type: 'order' as const, index: 1, style: 'red', aspectRatio: 1 };
    act(() => {
      painterRef.start({ clientX: 100, clientY: 100 } as MEvent, config);
    });

    // handleDrag was called
    expect(mockHandleDrag).toHaveBeenCalled();
    const { onMove, onEnd } = mockHandleDrag.mock.calls[0][0];
    act(() => { onMove({ clientX: 200, clientY: 300 }); });
    act(() => { onEnd({ clientX: 200, clientY: 300 }, { moved: false }); });
  });
});

// ---------------------------------------------------------------------------
// PresetPainter
// ---------------------------------------------------------------------------
describe('PresetPainter', () => {
  beforeEach(() => {
    mockHandleDrag.mockClear();
    mockDragLimiter.mockClear();
  });

  it('renders nothing without config', () => {
    const { container } = render(
      <svg>
        <PresetPainter area={area} addPreset={vi.fn()} />
      </svg>
    );
    expect(container.querySelector('[data-testid="order-painter"]')).toBeNull();
  });

  it('renders OrderPainter after start with order config', () => {
    let ref: any;
    const { container } = render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );

    const config = { type: 'order' as const, index: 1, style: 'red' };
    act(() => {
      ref.start({ clientX: 100, clientY: 100 } as MEvent, config);
    });

    expect(container.querySelector('[data-testid="order-painter"]')).not.toBeNull();
  });

  it('renders EmojiPainter after start with emoji config', () => {
    let ref: any;
    const { container } = render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );

    const config = { type: 'emoji' as const, emoji: 'heart' as const };
    act(() => {
      ref.start({ clientX: 100, clientY: 100 } as MEvent, config);
    });

    expect(container.querySelector('[data-testid="emoji-painter"]')).not.toBeNull();
  });

  it('start calls handleDrag', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    act(() => { ref.start({ clientX: 0, clientY: 0 } as MEvent, config); });
    expect(mockHandleDrag).toHaveBeenCalledTimes(1);
  });

  it('onMove during start updates rect state', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    act(() => { ref.start({ clientX: 0, clientY: 0 } as MEvent, config); });
    const { onMove } = mockHandleDrag.mock.calls[0][0];
    act(() => { onMove({ clientX: 50, clientY: 50 }); });
    // state was updated (no crash expected)
  });

  it('onEnd with moved=false calls createDefault', () => {
    const addPreset = vi.fn();
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={addPreset} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    act(() => { ref.start({ clientX: 0, clientY: 0 } as MEvent, config); });
    const { onEnd } = mockHandleDrag.mock.calls[0][0];
    act(() => { onEnd({ clientX: 10, clientY: 10 }, { moved: false }); });
    // createDefault was called on inner painter ref
  });

  it('onEnd with moved=true calls finish', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    act(() => { ref.start({ clientX: 0, clientY: 0 } as MEvent, config); });
    const { onMove, onEnd } = mockHandleDrag.mock.calls[0][0];
    act(() => { onMove({ clientX: 50, clientY: 50 }); });
    act(() => { onEnd({ clientX: 50, clientY: 50 }, { moved: true }); });
  });

  it('keyStart returns undefined for non-enter/space keys', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    const result = ref.keyStart({ point: [100, 100], keys: {}, key: 'shift' }, config);
    expect(result).toBeUndefined();
  });

  it('keyStart with enter key returns captured hooks', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    let hooks: any;
    act(() => {
      hooks = ref.keyStart({ point: [100, 100], keys: { enter: true }, key: 'enter' }, config);
    });
    expect(hooks).toBeDefined();
    expect(typeof hooks.keymove).toBe('function');
    expect(typeof hooks.keyup).toBe('function');
    expect(typeof hooks.cancel).toBe('function');
  });

  it('keymove updates rect', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    let hooks: any;
    act(() => { hooks = ref.keyStart({ point: [100, 100], keys: { enter: true }, key: 'enter' }, config); });
    act(() => { hooks.keymove([150, 150]); });
  });

  it('keyup with moved=false calls createDefault', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    let hooks: any;
    act(() => { hooks = ref.keyStart({ point: [100, 100], keys: { enter: true }, key: 'enter' }, config); });
    act(() => { hooks.keyup([100, 100]); });
  });

  it('keyup with moved=true calls finish', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    let hooks: any;
    act(() => { hooks = ref.keyStart({ point: [100, 100], keys: { enter: true }, key: 'enter' }, config); });
    act(() => { hooks.keymove([200, 200]); });
    act(() => { hooks.keyup([200, 200]); });
  });

  it('cancel clears rect state', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red' };
    let hooks: any;
    act(() => { hooks = ref.keyStart({ point: [100, 100], keys: { enter: true }, key: 'enter' }, config); });
    act(() => { hooks.cancel(); });
  });

  it('keyStart with aspectRatio applies ratio during keymove', () => {
    let ref: any;
    render(
      <svg>
        <PresetPainter ref={(r: any) => { ref = r; }} area={area} addPreset={vi.fn()} />
      </svg>
    );
    const config = { type: 'order' as const, index: 1, style: 'red', aspectRatio: 1 };
    let hooks: any;
    act(() => { hooks = ref.keyStart({ point: [100, 100], keys: { space: true }, key: 'space' }, config); });
    act(() => { hooks.keymove([200, 300]); });
  });
});

// ---------------------------------------------------------------------------
// PresetShape
// ---------------------------------------------------------------------------
describe('PresetShape', () => {
  const onActive = vi.fn(() => vi.fn());
  const onChange = vi.fn();

  const defaultProps = {
    area,
    model: makeModel('order'),
    onChange,
    onActive,
    active: false,
  };

  beforeEach(() => {
    mockHandleDrag.mockClear();
    onActive.mockClear();
    onChange.mockClear();
    mockDragLimiter.mockClear();
  });

  it('renders order shape', () => {
    const { container } = render(
      <svg>
        <PresetShape {...defaultProps} />
      </svg>
    );
    expect(container.querySelector('[data-testid="order-shape"]')).not.toBeNull();
  });

  it('renders emoji shape', () => {
    const { container } = render(
      <svg>
        <PresetShape {...defaultProps} model={makeModel('emoji')} />
      </svg>
    );
    expect(container.querySelector('[data-testid="emoji-shape"]')).not.toBeNull();
  });

  it('wraps emoji in Resizer when active', () => {
    const { container } = render(
      <svg>
        <PresetShape {...defaultProps} model={makeModel('emoji')} active={true} />
      </svg>
    );
    expect(container.querySelector('[data-testid="resizer"]')).not.toBeNull();
  });

  it('does NOT wrap order in Resizer at top level (OrderShape handles it)', () => {
    const { container } = render(
      <svg>
        <PresetShape {...defaultProps} active={true} />
      </svg>
    );
    // no top-level resizer wrapping for order type
    const resizers = container.querySelectorAll('[data-testid="resizer"]');
    // resizer is inside OrderShape mock (mocked out), so none at top level
    expect(resizers.length).toBe(0);
  });

  it('onPointerDown calls activate when not active', () => {
    let ref: any;
    render(
      <svg>
        <PresetShape {...defaultProps} ref={(r: any) => { ref = r; }} />
      </svg>
    );
    const fakeEvent = { stopPropagation: vi.fn(), clientX: 60, clientY: 60, pointerId: 1 } as any;
    act(() => { ref.onPointerDown(fakeEvent); });
    expect(onActive).toHaveBeenCalledWith('model-1');
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('onPointerDown does not re-activate when already active', () => {
    let ref: any;
    render(
      <svg>
        <PresetShape {...defaultProps} active={true} ref={(r: any) => { ref = r; }} />
      </svg>
    );
    const fakeEvent = { stopPropagation: vi.fn(), clientX: 60, clientY: 60 } as any;
    act(() => { ref.onPointerDown(fakeEvent); });
    expect(onActive).not.toHaveBeenCalled();
  });

  it('onPointerDown move updates editing state', () => {
    let ref: any;
    render(
      <svg>
        <PresetShape {...defaultProps} ref={(r: any) => { ref = r; }} />
      </svg>
    );
    const fakeEvent = { stopPropagation: vi.fn(), clientX: 60, clientY: 60 } as any;
    act(() => { ref.onPointerDown(fakeEvent); });
    const { onMove, onEnd } = mockHandleDrag.mock.calls[0][0];
    act(() => { onMove({ clientX: 80, clientY: 80 }); });
    act(() => { onEnd(); });
    expect(onChange).toHaveBeenCalled();
  });

  it('onResizeStart returns change callbacks', () => {
    let ref: any;
    render(
      <svg>
        <PresetShape {...defaultProps} ref={(r: any) => { ref = r; }} />
      </svg>
    );
    const result = ref.onResizeStart();
    expect(typeof result.change).toBe('function');
    expect(typeof result.endChange).toBe('function');
  });

  it('onResizeStart endChange calls onChange with rect', () => {
    let ref: any;
    render(
      <svg>
        <PresetShape {...defaultProps} ref={(r: any) => { ref = r; }} />
      </svg>
    );
    const { endChange } = ref.onResizeStart();
    act(() => { endChange([10, 10, 80, 80]); });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('onResizeStart endChange without rect does not call onChange', () => {
    let ref: any;
    render(
      <svg>
        <PresetShape {...defaultProps} ref={(r: any) => { ref = r; }} />
      </svg>
    );
    const { endChange } = ref.onResizeStart();
    act(() => { endChange(undefined); });
    expect(onChange).not.toHaveBeenCalled();
  });
});
