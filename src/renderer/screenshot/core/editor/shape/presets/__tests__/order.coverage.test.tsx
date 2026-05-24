/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockMarkEditing, mockUseCreation, mockMeasureDomRect, mockCloneDeep } = vi.hoisted(() => {
  const mockMarkEditing = vi.fn();
  const mockUseCreation = vi.fn(() => ({ markEditing: mockMarkEditing }));
  const mockMeasureDomRect = vi.fn(() => [100, 30]);
  const mockCloneDeep = vi.fn((v: any) => JSON.parse(JSON.stringify(v)));
  return { mockMarkEditing, mockUseCreation, mockMeasureDomRect, mockCloneDeep };
});

vi.mock('../../../../state', () => ({
  editorTextAtom: { useCreation: mockUseCreation },
}));

vi.mock('../../../model', () => ({
  uuid: () => 'test-uuid',
  PresetOrder: {},
}));

vi.mock('../assets', () => ({
  Number: (props: any) => <g data-testid="number-asset" data-index={props.index} />,
}));

vi.mock('../../../toolbar/tools/preset/list', () => ({
  NumberColor: { red: '#f00', blue: '#00f', green: '#0f0' },
}));

vi.mock('../../../../common/utils/global-key', () => ({
  default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../shape-resizer', () => ({
  default: ({ children }: any) => <g data-testid="resizer">{children}</g>,
}));

vi.mock('lodash/cloneDeep', () => ({ default: mockCloneDeep }));

vi.mock('../../../../common/utils/dom', () => ({
  measureDomRect: mockMeasureDomRect,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { OrderPainter, OrderShape, NumberTextStyle, arrowSize } from '../order';
import { TextSide } from '../common';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const area = [0, 0, 800, 600] as [number, number, number, number];

function makeOrderModel(overrides = {}) {
  return {
    id: 'shape-1',
    type: 'preset' as const,
    rect: [50, 50, 40, 40] as [number, number, number, number],
    content: {
      type: 'order' as const,
      index: 1,
      style: 'red',
      text: 'hello',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
describe('exports', () => {
  it('exports NumberTextStyle as a string', () => {
    expect(typeof NumberTextStyle).toBe('string');
    expect(NumberTextStyle.length).toBeGreaterThan(0);
  });

  it('exports arrowSize as a number', () => {
    expect(typeof arrowSize).toBe('number');
    expect(arrowSize).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OrderPainter
// ---------------------------------------------------------------------------
describe('OrderPainter', () => {
  it('renders null when no rect provided', () => {
    const addPreset = vi.fn();
    const { container } = render(
      <svg>
        <OrderPainter
          area={area}
          rect={undefined}
          config={{ type: 'order', index: 1, style: 'red' }}
          addPreset={addPreset}
        />
      </svg>
    );
    expect(container.querySelector('[data-testid="number-asset"]')).toBeNull();
  });

  it('renders Graph when rect provided', () => {
    const addPreset = vi.fn();
    const { container } = render(
      <svg>
        <OrderPainter
          area={area}
          rect={[10, 10, 40, 40]}
          config={{ type: 'order', index: 2, style: 'blue' }}
          addPreset={addPreset}
        />
      </svg>
    );
    expect(container.querySelector('[data-testid="number-asset"]')).not.toBeNull();
  });

  it('createDefault calls addPreset with correct preset', () => {
    const addPreset = vi.fn();
    let painterRef: any;
    const { container } = render(
      <svg>
        <OrderPainter
          ref={(r) => { painterRef = r; }}
          area={area}
          config={{ type: 'order', index: 1, style: 'red' }}
          addPreset={addPreset}
        />
      </svg>
    );
    act(() => {
      painterRef.createDefault([100, 100]);
    });
    expect(addPreset).toHaveBeenCalledTimes(1);
    const preset = addPreset.mock.calls[0][0];
    expect(preset.type).toBe('preset');
    expect(preset.content.type).toBe('order');
  });

  it('createDefault clamps position to area bounds', () => {
    const addPreset = vi.fn();
    let painterRef: any;
    render(
      <svg>
        <OrderPainter
          ref={(r) => { painterRef = r; }}
          area={area}
          config={{ type: 'order', index: 1, style: 'red' }}
          addPreset={addPreset}
        />
      </svg>
    );
    act(() => {
      painterRef.createDefault([-100, -100]);
    });
    const preset = addPreset.mock.calls[0][0];
    // clamped to half = 10
    expect(preset.rect[0]).toBeGreaterThanOrEqual(0);
    expect(preset.rect[1]).toBeGreaterThanOrEqual(0);
  });

  it('finish does nothing when no rect', () => {
    const addPreset = vi.fn();
    let painterRef: any;
    render(
      <svg>
        <OrderPainter
          ref={(r) => { painterRef = r; }}
          area={area}
          config={{ type: 'order', index: 1, style: 'red' }}
          addPreset={addPreset}
        />
      </svg>
    );
    act(() => {
      painterRef.finish();
    });
    expect(addPreset).not.toHaveBeenCalled();
  });

  it('finish calls addPreset when rect is provided', () => {
    const addPreset = vi.fn();
    let painterRef: any;
    render(
      <svg>
        <OrderPainter
          ref={(r) => { painterRef = r; }}
          area={area}
          rect={[10, 10, 30, 30]}
          config={{ type: 'order', index: 1, style: 'red' }}
          addPreset={addPreset}
        />
      </svg>
    );
    act(() => {
      painterRef.finish();
    });
    expect(addPreset).toHaveBeenCalledTimes(1);
  });

  it('resets index when style config changes', () => {
    const addPreset = vi.fn();
    let painterRef: any;
    const { rerender } = render(
      <svg>
        <OrderPainter
          ref={(r) => { painterRef = r; }}
          area={area}
          config={{ type: 'order', index: 1, style: 'red' }}
          addPreset={addPreset}
        />
      </svg>
    );
    act(() => { painterRef.createDefault([100, 100]); }); // index becomes 2
    rerender(
      <svg>
        <OrderPainter
          ref={(r) => { painterRef = r; }}
          area={area}
          config={{ type: 'order', index: 1, style: 'blue' }}
          addPreset={addPreset}
        />
      </svg>
    );
    // After style change, index should reset to 1
    act(() => { painterRef.createDefault([100, 100]); });
    const lastCall = addPreset.mock.calls[addPreset.mock.calls.length - 1][0];
    expect(lastCall.content.index).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// OrderShape
// ---------------------------------------------------------------------------
describe('OrderShape', () => {
  const baseProps = {
    rect: [50, 50, 40, 40] as [number, number, number, number],
    area,
    content: { type: 'order' as const, index: 1, style: 'red', text: 'hi' },
    model: makeOrderModel(),
    active: false,
    dragging: false,
    onResizeStart: vi.fn(() => ({ onceMoved: vi.fn(), change: vi.fn(), endChange: vi.fn() })),
    onChange: vi.fn(),
    onPointerDown: vi.fn(),
  };

  it('renders Graph and Inputer when textDisplay=true', () => {
    const { container } = render(
      <svg>
        <OrderShape {...baseProps} />
      </svg>
    );
    expect(container.querySelector('[data-testid="number-asset"]')).not.toBeNull();
    // foreignObject for Inputer
    expect(container.querySelector('foreignObject')).not.toBeNull();
  });

  it('wraps in Resizer when active=true', () => {
    const { container } = render(
      <svg>
        <OrderShape {...baseProps} active={true} />
      </svg>
    );
    expect(container.querySelector('[data-testid="resizer"]')).not.toBeNull();
  });

  it('does not wrap in Resizer when active=false', () => {
    const { container } = render(
      <svg>
        <OrderShape {...baseProps} active={false} />
      </svg>
    );
    expect(container.querySelector('[data-testid="resizer"]')).toBeNull();
  });

  it('hides text when content.text is empty (after onEndEdit)', () => {
    let shapeRef: any;
    const { container } = render(
      <svg>
        <OrderShape
          {...baseProps}
          ref={(r: any) => { shapeRef = r; }}
          content={{ type: 'order', index: 1, style: 'red', text: '' }}
        />
      </svg>
    );
    act(() => {
      shapeRef.onEndEdit?.('');
    });
    // textDisplay should be false now
    expect(container.querySelector('foreignObject')).toBeNull();
  });

  it('calls onChange after onEndEdit with non-empty text', () => {
    const onChange = vi.fn();
    let shapeRef: any;
    render(
      <svg>
        <OrderShape
          {...baseProps}
          onChange={onChange}
          ref={(r: any) => { shapeRef = r; }}
        />
      </svg>
    );
    act(() => {
      shapeRef.onEndEdit?.('new content');
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('positions text on the right side when there is space', () => {
    // rect at x=10, so right side has lots of space
    const { container } = render(
      <svg>
        <OrderShape
          {...baseProps}
          rect={[10, 10, 40, 40]}
        />
      </svg>
    );
    const fo = container.querySelector('foreignObject');
    expect(fo).not.toBeNull();
    // x attribute should be > 10 (right side)
    const x = parseFloat(fo!.getAttribute('x') || '0');
    expect(x).toBeGreaterThan(10);
  });

  it('positions text on the left side when not enough right space', () => {
    // rect near right edge
    const { container } = render(
      <svg>
        <OrderShape
          {...baseProps}
          rect={[780, 10, 20, 20]}
          area={[0, 0, 800, 600]}
        />
      </svg>
    );
    const fo = container.querySelector('foreignObject');
    expect(fo).not.toBeNull();
    // x should be 0 (left side)
    const x = parseFloat(fo!.getAttribute('x') || '0');
    expect(x).toBe(0);
  });
});
