/** @vitest-environment happy-dom */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHandleDrag = vi.hoisted(() => vi.fn());
const mockUuid = vi.hoisted(() => vi.fn(() => 'test-uuid'));
const MockDragLimiter = vi.hoisted(() =>
  vi.fn().mockImplementation(function() {
    return {
      position: vi.fn(function() { return [100, 100] as [number, number]; }),
      offset: vi.fn(function() { return [5, 5] as [number, number]; }),
    };
  })
);
const mockKeydownOnChange = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockKeydownHas = vi.hoisted(() => vi.fn(() => false));

vi.mock('../../../common/utils/drag', () => ({
  handleDrag: mockHandleDrag,
}));

vi.mock('../../model', () => ({
  uuid: mockUuid,
}));

vi.mock('../../../common/drag-limiter', () => ({
  DragLimiter: MockDragLimiter,
}));

vi.mock('../../../common/utils/global-key', () => ({
  keydown: {
    has: mockKeydownHas,
    onChange: mockKeydownOnChange,
  },
  default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../common/keyboard-painter', () => ({
  keyboardPainter: {},
}));

import { FreeCurvePainter, FreeCurveShape } from '../free-curve';

const defaultArea = [0, 0, 800, 600] as [number, number, number, number];

function makeFreeCurveModel(overrides = {}) {
  return {
    type: 'freeCurve' as const,
    id: 'curve-1',
    stroke: 'blue',
    strokeWidth: 4,
    d: 'M10,10 L50,50',
    offset: [0, 0] as [number, number],
    ...overrides,
  };
}

describe('FreeCurvePainter', () => {
  beforeEach(() => {
    mockHandleDrag.mockReset();
    mockUuid.mockReturnValue('test-uuid');
    mockKeydownHas.mockReturnValue(false);
    mockKeydownOnChange.mockReturnValue(vi.fn());
    MockDragLimiter.mockImplementation(function() {
      return {
        position: vi.fn(() => [100, 100] as [number, number]),
        offset: vi.fn(() => [5, 5] as [number, number]),
      };
    });
  });

  it('renders a path element', () => {
    const { container } = render(
      <svg><FreeCurvePainter area={defaultArea} addFreeCurve={vi.fn()} /></svg>
    );
    expect(container.querySelector('path')).toBeTruthy();
  });

  it('renders empty d initially', () => {
    const { container } = render(
      <svg><FreeCurvePainter area={defaultArea} addFreeCurve={vi.fn()} /></svg>
    );
    expect(container.querySelector('path')!.getAttribute('d')).toBe('');
  });

  it('start() sets up handleDrag', () => {
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={vi.fn()} /></svg>);
    act(() => { ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any); });
    expect(mockHandleDrag).toHaveBeenCalledOnce();
  });

  it('start() onMove updates d state via repaint', () => {
    const ref = React.createRef<FreeCurvePainter>();
    const { container } = render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={vi.fn()} /></svg>);

    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    act(() => { ref.current!.start('red', 4, { clientX: 50, clientY: 50 } as any); });
    act(() => { capturedOnMove?.({ clientX: 150, clientY: 150 }); });

    expect(container.querySelector('path')!.getAttribute('d')).toContain('L');
  });

  it('start() onEnd with d value calls addFreeCurve', () => {
    const addFreeCurve = vi.fn();
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={addFreeCurve} /></svg>);

    let capturedOnMove: Function | undefined;
    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove, onEnd }: any) => {
      capturedOnMove = onMove;
      capturedOnEnd = onEnd;
    });

    act(() => { ref.current!.start('red', 4, { clientX: 50, clientY: 50 } as any); });
    act(() => { capturedOnMove?.({ clientX: 150, clientY: 150 }); });
    act(() => { capturedOnEnd?.(); });

    expect(addFreeCurve).toHaveBeenCalledWith(expect.objectContaining({ type: 'freeCurve', id: 'test-uuid' }));
  });

  it('start() onEnd without prior moveTo does call addFreeCurve (path has start point)', () => {
    const addFreeCurve = vi.fn();
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={addFreeCurve} /></svg>);

    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onEnd }: any) => { capturedOnEnd = onEnd; });

    act(() => { ref.current!.start('red', 4, { clientX: 50, clientY: 50 } as any); });
    act(() => { capturedOnEnd?.(); });

    // Curve.finish() returns this.d which is 'M50,50' (truthy), so addFreeCurve IS called
    expect(addFreeCurve).toHaveBeenCalled();
  });

  it('keyStart returns undefined when no enter/space', () => {
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={vi.fn()} /></svg>);
    const ev = { point: [50, 50] as [number, number], keys: {}, key: 'shift' as any };
    const result = ref.current!.keyStart(ev, 'blue', 4);
    expect(result).toBeUndefined();
  });

  it('keyStart returns hooks on enter key', () => {
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={vi.fn()} /></svg>);
    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    const result = ref.current!.keyStart(ev, 'blue', 4);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('keymove');
    expect(result).toHaveProperty('keyup');
    expect(result).toHaveProperty('cancel');
  });

  it('keyStart returns hooks on space key', () => {
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={vi.fn()} /></svg>);
    const ev = { point: [50, 50] as [number, number], keys: { space: true }, key: 'space' as any };
    const result = ref.current!.keyStart(ev, 'blue', 4);
    expect(result).toBeDefined();
  });

  it('keyStart hooks: keymove updates path d', () => {
    const ref = React.createRef<FreeCurvePainter>();
    const { container } = render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={vi.fn()} /></svg>);
    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    let hooks: any;
    act(() => { hooks = ref.current!.keyStart(ev, 'blue', 4); });
    act(() => { hooks.keymove([100, 100]); });
    expect(container.querySelector('path')!.getAttribute('d')).toContain('L');
  });

  it('keyStart hooks: keyup calls addFreeCurve', () => {
    const addFreeCurve = vi.fn();
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={addFreeCurve} /></svg>);
    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    let hooks: any;
    act(() => { hooks = ref.current!.keyStart(ev, 'blue', 4); });
    act(() => { hooks.keymove([100, 100]); });
    act(() => { hooks.keyup([100, 100], {}, 'enter' as any); });
    expect(addFreeCurve).toHaveBeenCalled();
  });

  it('keyStart hooks: cancel does not call addFreeCurve', () => {
    const addFreeCurve = vi.fn();
    const ref = React.createRef<FreeCurvePainter>();
    render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={addFreeCurve} /></svg>);
    const ev = { point: [50, 50] as [number, number], keys: { enter: true }, key: 'enter' as any };
    let hooks: any;
    act(() => { hooks = ref.current!.keyStart(ev, 'blue', 4); });
    act(() => { hooks.cancel!(); });
    expect(addFreeCurve).not.toHaveBeenCalled();
  });

  it('Curve respects shift key: archive path used', () => {
    mockKeydownHas.mockReturnValue(true);
    const ref = React.createRef<FreeCurvePainter>();
    const { container } = render(<svg><FreeCurvePainter ref={ref} area={defaultArea} addFreeCurve={vi.fn()} /></svg>);
    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });
    act(() => { ref.current!.start('red', 4, { clientX: 50, clientY: 50 } as any); });
    act(() => { capturedOnMove?.({ clientX: 150, clientY: 150 }); });
    expect(container.querySelector('path')!.getAttribute('d')).toBeTruthy();
  });
});

describe('FreeCurveShape', () => {
  beforeEach(() => {
    mockHandleDrag.mockReset();
    MockDragLimiter.mockImplementation(function() {
      return {
        position: vi.fn(() => [100, 100] as [number, number]),
        offset: vi.fn(() => [5, 5] as [number, number]),
      };
    });
    // happy-dom SVG elements lack getBBox; provide a stub
    if (!(SVGElement.prototype as any).getBBox) {
      (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 100, height: 50 });
    }
  });

  it('renders a path element', () => {
    const model = makeFreeCurveModel();
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );
    expect(container.querySelector('path')).toBeTruthy();
  });

  it('renders translate transform from model offset', () => {
    const model = makeFreeCurveModel({ offset: [10, 20] });
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );
    expect(container.querySelector('path')!.getAttribute('transform')).toBe('translate(10,20)');
  });

  it('renders g wrapper when active=true', () => {
    const model = makeFreeCurveModel();
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={true} /></svg>
    );
    expect(container.querySelector('g')).toBeTruthy();
  });

  it('returns shape directly without g wrapper when active=false', () => {
    const model = makeFreeCurveModel();
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );
    expect(container.querySelector('g')).toBeNull();
    expect(container.querySelector('path')).toBeTruthy();
  });

  it('onPointerDown calls handleDrag', () => {
    const model = makeFreeCurveModel();
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );
    act(() => { container.querySelector('path')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('onPointerDown calls onActive when not active', () => {
    const model = makeFreeCurveModel();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={vi.fn()} onActive={onActive} active={false} /></svg>
    );
    act(() => { container.querySelector('path')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(onActive).toHaveBeenCalledWith('curve-1');
  });

  it('onPointerDown does not call onActive when already active', () => {
    const model = makeFreeCurveModel();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={vi.fn()} onActive={onActive} active={true} /></svg>
    );
    act(() => { container.querySelector('path')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(onActive).not.toHaveBeenCalled();
  });

  it('handleDrag onMove updates editing state', () => {
    const model = makeFreeCurveModel();
    const ref = React.createRef<FreeCurveShape>();
    const { container } = render(
      <svg><FreeCurveShape ref={ref} area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );

    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    act(() => { container.querySelector('path')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnMove?.({ clientX: 200, clientY: 200 }); });

    expect(ref.current!.state.editing).toBeDefined();
  });

  it('handleDrag onEnd with editing calls onChange', () => {
    const model = makeFreeCurveModel();
    const onChange = vi.fn();
    const ref = React.createRef<FreeCurveShape>();
    const { container } = render(
      <svg><FreeCurveShape ref={ref} area={defaultArea} model={model} onChange={onChange} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );

    let capturedOnMove: Function | undefined;
    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove, onEnd }: any) => {
      capturedOnMove = onMove;
      capturedOnEnd = onEnd;
    });

    act(() => { container.querySelector('path')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnMove?.({ clientX: 200, clientY: 200 }); });
    act(() => { capturedOnEnd?.(); });

    expect(onChange).toHaveBeenCalled();
  });

  it('handleDrag onEnd without editing does not call onChange', () => {
    const model = makeFreeCurveModel();
    const onChange = vi.fn();
    const { container } = render(
      <svg><FreeCurveShape area={defaultArea} model={model} onChange={onChange} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );

    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onEnd }: any) => { capturedOnEnd = onEnd; });

    act(() => { container.querySelector('path')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnEnd?.(); });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('editing offset is reflected in transform', () => {
    const model = makeFreeCurveModel({ offset: [0, 0] });
    const ref = React.createRef<FreeCurveShape>();
    const { container } = render(
      <svg><FreeCurveShape ref={ref} area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={false} /></svg>
    );

    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    act(() => { container.querySelector('path')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    act(() => { capturedOnMove?.({ clientX: 200, clientY: 200 }); });

    // After move, editing should be [0+5, 0+5] = [5, 5]
    expect(container.querySelector('path')!.getAttribute('transform')).toBe('translate(5,5)');
  });

  it('renderOutline returns null when no outline', () => {
    // When no pointer down, outline is undefined => no rect
    const model = makeFreeCurveModel();
    const ref = React.createRef<FreeCurveShape>();
    const { container } = render(
      <svg><FreeCurveShape ref={ref} area={defaultArea} model={model} onChange={vi.fn()} onActive={vi.fn(() => vi.fn())} active={true} /></svg>
    );
    // outline is initially undefined, so no rect rendered even when active
    expect(container.querySelector('rect')).toBeNull();
  });
});
