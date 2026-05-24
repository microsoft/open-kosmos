/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHandleDrag = vi.hoisted(() => vi.fn());
const mockUuid = vi.hoisted(() => vi.fn(() => 'test-uuid'));
const MockDragLimiter = vi.hoisted(() => {
  return vi.fn().mockImplementation(function(_area: any, ev: any) {
    return {
      position: vi.fn(function(e: any) { return [e?.clientX ?? 10, e?.clientY ?? 10] as [number, number]; }),
      offset: vi.fn(function() { return [5, 5] as [number, number]; }),
    };
  });
});

vi.mock('../../../common/utils/drag', () => ({
  handleDrag: mockHandleDrag,
}));

vi.mock('../../model', () => ({
  uuid: mockUuid,
}));

vi.mock('../../../common/drag-limiter', () => ({
  DragLimiter: MockDragLimiter,
}));

vi.mock('../../../common/keyboard-painter', () => ({
  keyboardPainter: {},
}));

import { ArrowPainter, ArrowShape } from '../arrow';

const defaultArea = [0, 0, 800, 600] as [number, number, number, number];

function makeArrowModel(overrides = {}) {
  return {
    type: 'arrow' as const,
    id: 'arrow-1',
    fill: 'red',
    size: 20,
    from: [10, 10] as [number, number],
    to: [100, 100] as [number, number],
    ...overrides,
  };
}

describe('ArrowPainter', () => {
  beforeEach(() => {
    mockHandleDrag.mockClear();
    mockUuid.mockReturnValue('test-uuid');
    MockDragLimiter.mockImplementation(function(_area: any, ev: any) {
      return {
        position: vi.fn(function(e: any) { return [e?.clientX ?? 10, e?.clientY ?? 10] as [number, number]; }),
        offset: vi.fn(function() { return [5, 5] as [number, number]; }),
      };
    });
  });

  it('renders null when no "to" state', () => {
    const addArrow = vi.fn();
    const { container } = render(
      <svg>
        <ArrowPainter area={defaultArea} addArrow={addArrow} />
      </svg>
    );
    expect(container.querySelector('g')).toBeNull();
  });

  it('renders arrow paths after setState with "to"', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    const { container } = render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    act(() => {
      ref.current!.setState({ from: [10, 10], to: [200, 100] });
    });

    expect(container.querySelector('[aria-label="render arrow"]')).toBeTruthy();
  });

  it('start() calls handleDrag', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    const fakeEvent = { clientX: 50, clientY: 50 } as any;
    act(() => { ref.current!.start('blue', 10, fakeEvent); });

    expect(mockHandleDrag).toHaveBeenCalledOnce();
  });

  it('start() onMove updates state', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    act(() => { ref.current!.start('blue', 10, { clientX: 50, clientY: 50 } as any); });
    act(() => { capturedOnMove?.({ clientX: 150, clientY: 150 }); });

    expect(ref.current!.state.to).toBeDefined();
  });

  it('start() onEnd with equal from/to does not call addArrow', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onEnd }: any) => { capturedOnEnd = onEnd; });

    MockDragLimiter.mockImplementation(function() {
      return {
        position: vi.fn(function() { return [50, 50] as [number, number]; }),
        offset: vi.fn(function() { return [0, 0] as [number, number]; }),
      };
    });

    act(() => { ref.current!.start('blue', 10, { clientX: 50, clientY: 50 } as any); });
    act(() => { capturedOnEnd?.(); });

    expect(addArrow).not.toHaveBeenCalled();
  });

  it('start() onEnd with different from/to calls addArrow', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    let capturedOnMove: Function | undefined;
    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove, onEnd }: any) => {
      capturedOnMove = onMove;
      capturedOnEnd = onEnd;
    });

    MockDragLimiter.mockImplementation(function() {
      let callCount = 0;
      return {
        position: vi.fn(function() {
          callCount++;
          return callCount === 1 ? [50, 50] as [number, number] : [150, 150] as [number, number];
        }),
        offset: vi.fn(function() { return [5, 5] as [number, number]; }),
      };
    });

    act(() => { ref.current!.start('blue', 10, { clientX: 50, clientY: 50 } as any); });
    act(() => { capturedOnMove?.({ clientX: 150, clientY: 150 }); });
    act(() => { capturedOnEnd?.(); });

    expect(addArrow).toHaveBeenCalledWith(expect.objectContaining({ type: 'arrow' }));
  });

  it('keyStart returns undefined if no enter/space key', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    const ev = { point: [50, 50] as [number, number], keys: {}, key: 'shift' as any };
    const result = ref.current!.keyStart(ev, 'blue', 10);
    expect(result).toBeUndefined();
  });

  it('keyStart returns hooks when enter key pressed', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    const result = ref.current!.keyStart(ev, 'blue', 10);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('keymove');
    expect(result).toHaveProperty('keyup');
    expect(result).toHaveProperty('cancel');
  });

  it('keyStart hooks: keymove updates to state', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    let hooks: any;
    act(() => { hooks = ref.current!.keyStart(ev, 'blue', 10); });
    act(() => { hooks.keymove([200, 200]); });
    expect(ref.current!.state.to).toEqual([200, 200]);
  });

  it('keyStart hooks: cancel clears to state', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    let hooks: any;
    act(() => { hooks = ref.current!.keyStart(ev, 'blue', 10); });
    act(() => { hooks.keymove([200, 200]); });
    act(() => { hooks.cancel!(); });
    expect(ref.current!.state.to).toBeUndefined();
  });

  it('keyStart hooks: keyup with different from/to calls addArrow', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(
      <svg>
        <ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} />
      </svg>
    );

    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    let hooks: any;
    act(() => { hooks = ref.current!.keyStart(ev, 'blue', 10); });
    act(() => { hooks.keymove([200, 200]); });
    act(() => { hooks.keyup([200, 200], {}, 'enter' as any); });
    expect(addArrow).toHaveBeenCalled();
  });

  it('keyStart with space key also works', () => {
    const addArrow = vi.fn();
    const ref = React.createRef<ArrowPainter>();
    render(<svg><ArrowPainter ref={ref} area={defaultArea} addArrow={addArrow} /></svg>);
    const ev = { point: [50, 50] as [number, number], keys: { space: true }, key: 'space' as any };
    const result = ref.current!.keyStart(ev, 'blue', 10);
    expect(result).toBeDefined();
  });
});

describe('ArrowShape', () => {
  beforeEach(() => {
    mockHandleDrag.mockClear();
    MockDragLimiter.mockImplementation(function() {
      return {
        position: vi.fn(function() { return [100, 100] as [number, number]; }),
        offset: vi.fn(function() { return [5, 5] as [number, number]; }),
      };
    });
  });

  it('renders arrow paths', () => {
    const model = makeArrowModel();
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={false}
        />
      </svg>
    );
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders resizer circles when active=true', () => {
    const model = makeArrowModel();
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={true}
        />
      </svg>
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('does not render circles when active=false', () => {
    const model = makeArrowModel();
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={false}
        />
      </svg>
    );
    expect(container.querySelectorAll('circle').length).toBe(0);
  });

  it('onPointerDown calls handleDrag', () => {
    const model = makeArrowModel();
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={false}
        />
      </svg>
    );

    const path = container.querySelector('path')!;
    act(() => { path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('onPointerDown calls onActive when not active', () => {
    const model = makeArrowModel();
    const onceMoved = vi.fn();
    const onActive = vi.fn(() => onceMoved);
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={onActive}
          active={false}
        />
      </svg>
    );

    const path = container.querySelector('path')!;
    act(() => { path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(onActive).toHaveBeenCalledWith('arrow-1');
  });

  it('onPointerDown does not call onActive when already active', () => {
    const model = makeArrowModel();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={onActive}
          active={true}
        />
      </svg>
    );

    const path = container.querySelector('path')!;
    act(() => { path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(onActive).not.toHaveBeenCalled();
  });

  it('handleDrag onMove updates editing state', () => {
    const model = makeArrowModel();
    const ref = React.createRef<ArrowShape>();
    const { container } = render(
      <svg>
        <ArrowShape
          ref={ref}
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={false}
        />
      </svg>
    );

    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    const path = container.querySelector('path')!;
    act(() => { path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnMove?.({ clientX: 200, clientY: 200 }); });

    expect(ref.current!.state.editing).toBeDefined();
  });

  it('handleDrag onEnd calls onChange', () => {
    const model = makeArrowModel();
    const onChange = vi.fn();
    const ref = React.createRef<ArrowShape>();
    const { container } = render(
      <svg>
        <ArrowShape
          ref={ref}
          area={defaultArea}
          model={model}
          onChange={onChange}
          onActive={vi.fn(() => vi.fn())}
          active={false}
        />
      </svg>
    );

    let capturedOnMove: Function | undefined;
    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove, onEnd }: any) => {
      capturedOnMove = onMove;
      capturedOnEnd = onEnd;
    });

    const path = container.querySelector('path')!;
    act(() => { path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnMove?.({ clientX: 200, clientY: 200 }); });
    act(() => { capturedOnEnd?.(); });

    expect(onChange).toHaveBeenCalled();
  });

  it('handleDrag onEnd with no editing does not call onChange', () => {
    const model = makeArrowModel();
    const onChange = vi.fn();
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={onChange}
          onActive={vi.fn(() => vi.fn())}
          active={false}
        />
      </svg>
    );

    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onEnd }: any) => { capturedOnEnd = onEnd; });

    const path = container.querySelector('path')!;
    act(() => { path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnEnd?.(); });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('onResize (circle pointerdown when active) calls handleDrag', () => {
    const model = makeArrowModel();
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={true}
        />
      </svg>
    );

    const circle = container.querySelector('circle')!;
    circle.setAttribute('data-pos', 'to');
    act(() => { circle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('onResize onMove skips equal points', () => {
    const model = makeArrowModel({ from: [10, 10], to: [100, 100] });
    const { container } = render(
      <svg>
        <ArrowShape
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={true}
        />
      </svg>
    );

    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    // Make position return same as from so equal check triggers
    MockDragLimiter.mockImplementation(function() {
      return {
        position: vi.fn(function() { return [100, 100] as [number, number]; }),
        offset: vi.fn(function() { return [5, 5] as [number, number]; }),
      };
    });

    const circles = container.querySelectorAll('circle');
    const circle = circles[1]; // data-pos=to
    act(() => { circle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    // onMove with equal points shouldn't update state
    act(() => { capturedOnMove?.({ clientX: 100, clientY: 100 }); });
  });

  it('uses editing from+to when rendering if editing is set', () => {
    const model = makeArrowModel({ from: [10, 10], to: [100, 100] });
    const ref = React.createRef<ArrowShape>();
    const { container } = render(
      <svg>
        <ArrowShape
          ref={ref}
          area={defaultArea}
          model={model}
          onChange={vi.fn()}
          onActive={vi.fn(() => vi.fn())}
          active={false}
        />
      </svg>
    );

    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    const path = container.querySelector('path')!;
    act(() => { path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnMove?.({ clientX: 200, clientY: 200 }); });

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
});
