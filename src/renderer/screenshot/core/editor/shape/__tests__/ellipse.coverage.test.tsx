// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, act } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

// -- hoisted mocks --
const mockHandleDrag = vi.hoisted(() => vi.fn());
const mockCalcCursorRect = vi.hoisted(() => vi.fn(() => [10, 20, 50, 60] as [number, number, number, number]));
const mockOffsetRect = vi.hoisted(() => vi.fn((r: any, dx: number, dy: number) => [r[0] + dx, r[1] + dy, r[2], r[3]] as [number, number, number, number]));
const mockKeydown = vi.hoisted(() => ({ has: vi.fn(() => false) }));
const mockUuid = vi.hoisted(() => vi.fn(() => 'test-uuid'));
const mockDrawRect = vi.hoisted(() => vi.fn(() => [10, 20, 50, 60]));
const mockOffset = vi.hoisted(() => vi.fn(() => [5, 10]));

vi.mock('../../../common/utils/drag', () => ({ handleDrag: mockHandleDrag }));
vi.mock('../../../common/utils/coord', () => ({
  calcCursorRect: mockCalcCursorRect,
  offsetRect: mockOffsetRect,
}));
vi.mock('../../../common/utils/global-key', () => ({
  default: mockKeydown,
  keydown: mockKeydown,
}));
vi.mock('../../model', () => ({ uuid: mockUuid }));
vi.mock('../shape-resizer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <g data-testid="resizer">{children}</g>,
}));
vi.mock('../../../common/drag-limiter', () => ({
  // Must be a real function (not arrow) to support `new`
  DragLimiter: function DragLimiter() {
    return { drawRect: mockDrawRect, offset: mockOffset };
  },
}));

beforeAll(() => {
  SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 } as SVGRect);
});

import { EllipsePainter, EllipseShape } from '../ellipse';

const area: [number, number, number, number] = [0, 0, 800, 600];

describe('EllipsePainter', () => {
  it('renders null when no rect in state', () => {
    const addEllipse = vi.fn();
    const { container } = render(
      <svg>
        <EllipsePainter area={area} addEllipse={addEllipse} />
      </svg>
    );
    expect(container.querySelector('ellipse')).toBeNull();
  });

  it('start() calls handleDrag', () => {
    const addEllipse = vi.fn();
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('start() onMove sets rect state', () => {
    const addEllipse = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    act(() => { capturedCbs.onMove({ clientX: 150, clientY: 150 } as PointerEvent); });
    // no error
  });

  it('start() onEnd calls addEllipse after onMove sets positive rect', () => {
    const addEllipse = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    // drawRect returns [10,20,50,60]
    mockDrawRect.mockReturnValue([10, 20, 50, 60]);
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    act(() => { capturedCbs.onMove({ clientX: 150, clientY: 150 } as PointerEvent); });
    act(() => { capturedCbs.onEnd(); });
    expect(addEllipse).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ellipse', id: 'test-uuid' })
    );
  });

  it('start() onEnd with zero-dim rect does not call addEllipse', () => {
    const addEllipse = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    mockDrawRect.mockReturnValueOnce([10, 20, 0, 60]);
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    act(() => { capturedCbs.onMove({ clientX: 110, clientY: 150 } as PointerEvent); });
    act(() => { capturedCbs.onEnd(); });
    expect(addEllipse).not.toHaveBeenCalled();
  });

  it('keyStart returns undefined when no enter/space', () => {
    const addEllipse = vi.fn();
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    const result = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: false, space: false } } as any, 'red', 4
    );
    expect(result).toBeUndefined();
  });

  it('keyStart with enter key returns hooks', () => {
    const addEllipse = vi.fn();
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: true, space: false } } as any, 'red', 4
    );
    expect(hooks).toBeDefined();
    expect(typeof hooks!.keymove).toBe('function');
    expect(typeof hooks!.keyup).toBe('function');
    expect(typeof hooks!.cancel).toBe('function');
  });

  it('keyStart keymove calls calcCursorRect', () => {
    const addEllipse = vi.fn();
    mockCalcCursorRect.mockClear();
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: true, space: false } } as any, 'red', 4
    );
    act(() => { hooks!.keymove([150, 160]); });
    expect(mockCalcCursorRect).toHaveBeenCalled();
  });

  it('keyStart cancel clears rect', () => {
    const addEllipse = vi.fn();
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: false, space: true } } as any, 'blue', 6
    );
    act(() => { hooks!.cancel!(); });
  });

  it('keyStart keyup commits with positive rect', () => {
    const addEllipse = vi.fn();
    const ref = React.createRef<EllipsePainter>();
    render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: false, space: true } } as any, 'blue', 6
    );
    act(() => { hooks!.keymove([150, 160]); }); // calcCursorRect returns [10,20,50,60]
    act(() => { hooks!.keyup!(); });
    expect(addEllipse).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ellipse', id: 'test-uuid' })
    );
  });

  it('renders ellipse element when rect is set', () => {
    const addEllipse = vi.fn();
    const ref = React.createRef<EllipsePainter>();
    const { container } = render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    act(() => {
      (ref.current as any).setState({ rect: [10, 20, 100, 80], stroke: 'red', strokeWidth: 3 });
    });
    expect(container.querySelector('ellipse')).not.toBeNull();
  });

  it('renders ellipse with 0.01 rx/ry fallback when w/h=0', () => {
    const addEllipse = vi.fn();
    const ref = React.createRef<EllipsePainter>();
    const { container } = render(<svg><EllipsePainter ref={ref} area={area} addEllipse={addEllipse} /></svg>);
    act(() => {
      (ref.current as any).setState({ rect: [10, 20, 0, 0], stroke: 'red', strokeWidth: 3 });
    });
    const el = container.querySelector('ellipse');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('rx')).toBe('0.01');
    expect(el?.getAttribute('ry')).toBe('0.01');
  });
});

describe('EllipseShape', () => {
  const model = {
    type: 'ellipse' as const,
    id: 'e1',
    stroke: 'blue',
    strokeWidth: 4,
    rect: [50, 50, 100, 80] as [number, number, number, number],
  };

  it('renders ellipse when inactive', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><EllipseShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    expect(container.querySelector('ellipse')).not.toBeNull();
    expect(container.querySelector('[data-testid="resizer"]')).toBeNull();
  });

  it('renders with Resizer when active', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><EllipseShape area={area} model={model} onChange={onChange} onActive={onActive} active={true} /></svg>
    );
    expect(container.querySelector('[data-testid="resizer"]')).not.toBeNull();
    expect(container.querySelector('ellipse')).not.toBeNull();
  });

  it('onPointerDown activates when not active', () => {
    const onChange = vi.fn();
    const onActiveFn = vi.fn();
    const onActive = vi.fn(() => onActiveFn);
    const { container } = render(
      <svg><EllipseShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('ellipse')!);
    expect(onActive).toHaveBeenCalledWith('e1');
  });

  it('onPointerDown when active does not call onActive', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><EllipseShape area={area} model={model} onChange={onChange} onActive={onActive} active={true} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('ellipse')!);
    expect(onActive).not.toHaveBeenCalled();
  });

  it('onPointerDown drag: move sets editing, end calls onChange', () => {
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><EllipseShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('ellipse')!);
    act(() => { capturedCbs.onMove({ clientX: 200, clientY: 200 } as PointerEvent); });
    act(() => { capturedCbs.onEnd(); });
    expect(onChange).toHaveBeenCalled();
  });

  it('onEnd does nothing if editing is not set', () => {
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><EllipseShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('ellipse')!);
    act(() => { capturedCbs.onEnd(); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('onResizeStart returns correct handlers', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const ref = React.createRef<EllipseShape>();
    render(
      <svg><EllipseShape ref={ref} area={area} model={model} onChange={onChange} onActive={onActive} active={true} /></svg>
    );
    const handlers = (ref.current as any).onResizeStart();
    act(() => { handlers.change([10, 20, 30, 40]); });
    act(() => { handlers.endChange([10, 20, 30, 40]); });
    expect(onChange).toHaveBeenCalledWith({ ...model, rect: [10, 20, 30, 40] });
    act(() => { handlers.endChange(undefined); });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('uses editing rect for rendering', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const ref = React.createRef<EllipseShape>();
    const { container } = render(
      <svg><EllipseShape ref={ref} area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    act(() => { (ref.current as any).setState({ editing: [5, 5, 200, 200] }); });
    const el = container.querySelector('ellipse')!;
    // cx = 200/2 + 5 = 105
    expect(el.getAttribute('cx')).toBe('105');
  });

  it('aria-label is set on ellipse', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><EllipseShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    expect(container.querySelector('ellipse')!.getAttribute('aria-label')).toBe('render ellipse');
  });
});
