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
  DragLimiter: function DragLimiter() {
    return { drawRect: mockDrawRect, offset: mockOffset };
  },
}));

beforeAll(() => {
  SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 } as SVGRect);
});

import { SquarePainter, SquareShape } from '../square';

const area: [number, number, number, number] = [0, 0, 800, 600];

describe('SquarePainter', () => {
  it('renders null when no rect in state', () => {
    const addSquare = vi.fn();
    const { container } = render(<svg><SquarePainter area={area} addSquare={addSquare} /></svg>);
    expect(container.querySelector('rect')).toBeNull();
  });

  it('renders rect when rect is set', () => {
    const addSquare = vi.fn();
    const ref = React.createRef<SquarePainter>();
    const { container } = render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    act(() => {
      (ref.current as any).setState({ rect: [10, 20, 100, 80], stroke: 'red', strokeWidth: 3 });
    });
    expect(container.querySelector('rect')).not.toBeNull();
  });

  it('renders rect with 0.01 width/height fallback when w/h=0', () => {
    const addSquare = vi.fn();
    const ref = React.createRef<SquarePainter>();
    const { container } = render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    act(() => {
      (ref.current as any).setState({ rect: [10, 20, 0, 0], stroke: 'red', strokeWidth: 3 });
    });
    const el = container.querySelector('rect')!;
    expect(el.getAttribute('width')).toBe('0.01');
    expect(el.getAttribute('height')).toBe('0.01');
  });

  it('start() calls handleDrag', () => {
    const addSquare = vi.fn();
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('start() onMove calls drawRect', () => {
    const addSquare = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    act(() => { capturedCbs.onMove({ clientX: 150, clientY: 150 } as PointerEvent); });
    // no error
  });

  it('start() onEnd calls addSquare after positive rect', () => {
    const addSquare = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    mockDrawRect.mockReturnValue([10, 20, 50, 60]);
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    act(() => { capturedCbs.onMove({ clientX: 150, clientY: 150 } as PointerEvent); });
    act(() => { capturedCbs.onEnd(); });
    expect(addSquare).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'square', id: 'test-uuid' })
    );
  });

  it('start() onEnd skips addSquare when width=0', () => {
    const addSquare = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    mockDrawRect.mockReturnValueOnce([10, 20, 0, 60]);
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    ref.current!.start('red', 4, { clientX: 100, clientY: 100 } as any);
    act(() => { capturedCbs.onMove({ clientX: 101, clientY: 150 } as PointerEvent); });
    act(() => { capturedCbs.onEnd(); });
    expect(addSquare).not.toHaveBeenCalled();
  });

  it('keyStart returns undefined when no enter/space', () => {
    const addSquare = vi.fn();
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    const result = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: false, space: false } } as any, 'red', 4
    );
    expect(result).toBeUndefined();
  });

  it('keyStart with enter returns hooks', () => {
    const addSquare = vi.fn();
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: true, space: false } } as any, 'red', 4
    );
    expect(hooks).toBeDefined();
    expect(typeof hooks!.keymove).toBe('function');
    expect(typeof hooks!.keyup).toBe('function');
    expect(typeof hooks!.cancel).toBe('function');
  });

  it('keyStart keymove calls calcCursorRect', () => {
    const addSquare = vi.fn();
    mockCalcCursorRect.mockClear();
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: true, space: false } } as any, 'red', 4
    );
    act(() => { hooks!.keymove([150, 160]); });
    expect(mockCalcCursorRect).toHaveBeenCalled();
  });

  it('keyStart cancel clears rect', () => {
    const addSquare = vi.fn();
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: false, space: true } } as any, 'blue', 6
    );
    act(() => { hooks!.cancel!(); });
  });

  it('keyStart keyup commits with positive rect', () => {
    const addSquare = vi.fn();
    const ref = React.createRef<SquarePainter>();
    render(<svg><SquarePainter ref={ref} area={area} addSquare={addSquare} /></svg>);
    const hooks = ref.current!.keyStart(
      { point: [100, 100], keys: { enter: false, space: true } } as any, 'blue', 6
    );
    act(() => { hooks!.keymove([150, 160]); });
    act(() => { hooks!.keyup!(); });
    expect(addSquare).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'square' })
    );
  });
});

describe('SquareShape', () => {
  const model = {
    type: 'square' as const,
    id: 's1',
    stroke: 'blue',
    strokeWidth: 4,
    rect: [50, 50, 100, 80] as [number, number, number, number],
  };

  it('renders rect when inactive', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><SquareShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    expect(container.querySelector('rect')).not.toBeNull();
    expect(container.querySelector('[data-testid="resizer"]')).toBeNull();
  });

  it('renders with Resizer when active', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><SquareShape area={area} model={model} onChange={onChange} onActive={onActive} active={true} /></svg>
    );
    expect(container.querySelector('[data-testid="resizer"]')).not.toBeNull();
  });

  it('onPointerDown activates when not active', () => {
    const onChange = vi.fn();
    const onActiveFn = vi.fn();
    const onActive = vi.fn(() => onActiveFn);
    const { container } = render(
      <svg><SquareShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('rect')!);
    expect(onActive).toHaveBeenCalledWith('s1');
  });

  it('onPointerDown when active does not call onActive', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><SquareShape area={area} model={model} onChange={onChange} onActive={onActive} active={true} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('rect')!);
    expect(onActive).not.toHaveBeenCalled();
  });

  it('onPointerDown drag: move and end calls onChange', () => {
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const { container } = render(
      <svg><SquareShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('rect')!);
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
      <svg><SquareShape area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    fireEvent.pointerDown(container.querySelector('rect')!);
    act(() => { capturedCbs.onEnd(); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('onResizeStart returns correct handlers', () => {
    const onChange = vi.fn();
    const onActive = vi.fn(() => vi.fn());
    const ref = React.createRef<SquareShape>();
    render(
      <svg><SquareShape ref={ref} area={area} model={model} onChange={onChange} onActive={onActive} active={true} /></svg>
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
    const ref = React.createRef<SquareShape>();
    const { container } = render(
      <svg><SquareShape ref={ref} area={area} model={model} onChange={onChange} onActive={onActive} active={false} /></svg>
    );
    act(() => { (ref.current as any).setState({ editing: [5, 5, 200, 100] }); });
    const el = container.querySelector('rect')!;
    expect(el.getAttribute('x')).toBe('5');
    expect(el.getAttribute('y')).toBe('5');
  });
});
