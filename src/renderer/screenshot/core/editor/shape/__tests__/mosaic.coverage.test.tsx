// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// -- hoisted mocks --
const mockHandleDrag = vi.hoisted(() => vi.fn());
const mockMakeInvisibleCanvas = vi.hoisted(() => vi.fn());
const mockBgBlur = vi.hoisted(() => vi.fn(() => {
  // ImageData may not be available at hoisting time, create lazily
  if (typeof ImageData !== 'undefined') {
    return new ImageData(100, 100);
  }
  return { data: new Uint8ClampedArray(100 * 100 * 4), width: 100, height: 100 };
}));

vi.mock('../../../common/utils/drag', () => ({ handleDrag: mockHandleDrag }));
vi.mock('../../../common/utils/dom', () => ({
  makeInvisibleCanvas: mockMakeInvisibleCanvas,
}));

beforeAll(() => {
  SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 } as SVGRect);

  const makeCtx = () => ({
    strokeStyle: '',
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    putImageData: vi.fn(),
    globalCompositeOperation: '',
    clearRect: vi.fn(),
  });

  mockMakeInvisibleCanvas.mockImplementation((w: number, h: number) => {
    return { canvas: { width: w, height: h }, ctx: makeCtx() };
  });

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn(() => makeCtx()),
    configurable: true,
  });

  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class {
      constructor(public d: string) {}
    };
  }
});

import MosaicLayer from '../mosaic';

const area: [number, number, number, number] = [0, 0, 400, 300];
const bgMock = {
  blur: mockBgBlur,
  css: {},
} as any;

afterEach(() => { cleanup(); });

describe('MosaicLayer', () => {
  it('renders canvas element', () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    act(() => { ({ container } = render(<MosaicLayer bg={bgMock} area={area} onChange={onChange} />)); });
    expect(container!.querySelector('canvas')).not.toBeNull();
  });

  it('canvas has correct width and height attributes', () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    act(() => { ({ container } = render(<MosaicLayer bg={bgMock} area={area} onChange={onChange} />)); });
    const canvas = container!.querySelector('canvas')!;
    expect(canvas.getAttribute('width')).toBe('400');
    expect(canvas.getAttribute('height')).toBe('300');
  });

  it('aria-label contains width and height', () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    act(() => { ({ container } = render(<MosaicLayer bg={bgMock} area={area} onChange={onChange} />)); });
    const canvas = container!.querySelector('canvas')!;
    expect(canvas.getAttribute('aria-label')).toContain('400px');
    expect(canvas.getAttribute('aria-label')).toContain('300px');
  });

  it('componentDidMount does not throw without model', () => {
    const onChange = vi.fn();
    act(() => { render(<MosaicLayer bg={bgMock} area={area} onChange={onChange} />); });
    // no error means success
  });

  it('componentDidMount with model calls makeInvisibleCanvas', () => {
    const onChange = vi.fn();
    mockMakeInvisibleCanvas.mockClear();
    const model = [{ d: 'M10,10 L20,20', size: 10 }];
    act(() => { render(<MosaicLayer bg={bgMock} area={area} onChange={onChange} model={model} />); });
    expect(mockMakeInvisibleCanvas).toHaveBeenCalled();
  });

  it('componentDidUpdate re-paints when model changes', () => {
    const onChange = vi.fn();
    let rerender: any;
    act(() => { ({ rerender } = render(<MosaicLayer bg={bgMock} area={area} onChange={onChange} />)); });
    mockMakeInvisibleCanvas.mockClear();
    const model = [{ d: 'M10,10 L20,20', size: 10 }];
    act(() => { rerender(<MosaicLayer bg={bgMock} area={area} onChange={onChange} model={model} />); });
    expect(mockMakeInvisibleCanvas).toHaveBeenCalled();
  });

  it('componentDidUpdate skips repaint when model reference unchanged', () => {
    const onChange = vi.fn();
    const model = [{ d: 'M10,10 L20,20', size: 10 }];
    let rerender: any;
    act(() => { ({ rerender } = render(<MosaicLayer bg={bgMock} area={area} onChange={onChange} model={model} />)); });
    mockMakeInvisibleCanvas.mockClear();
    act(() => { rerender(<MosaicLayer bg={bgMock} area={area} onChange={onChange} model={model} />); });
    expect(mockMakeInvisibleCanvas).not.toHaveBeenCalled();
  });

  it('canvas property returns canvas DOM element', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    expect(ref.current!.canvas).not.toBeNull();
    expect(ref.current!.canvas.tagName.toLowerCase()).toBe('canvas');
  });

  it('start() calls handleDrag', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    ref.current!.start(10, { clientX: 50, clientY: 50 } as any);
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('start() onMove updates canvas without error', () => {
    const onChange = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    ref.current!.start(10, { clientX: 50, clientY: 50 } as any);
    act(() => { capturedCbs.onMove({ clientX: 70, clientY: 70 }); });
  });

  it('start() onEnd commits after move (changed=true)', () => {
    const onChange = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    ref.current!.start(10, { clientX: 50, clientY: 50 } as any);
    act(() => { capturedCbs.onMove({ clientX: 70, clientY: 70 }); });
    act(() => { capturedCbs.onEnd(); });
    expect(onChange).toHaveBeenCalled();
  });

  it('start() onEnd does not commit if no move occurred', () => {
    const onChange = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    ref.current!.start(10, { clientX: 50, clientY: 50 } as any);
    act(() => { capturedCbs.onEnd(); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('start() appends to existing model', () => {
    const existing = [{ d: 'M5,5 L10,10', size: 5 }];
    const onChange = vi.fn();
    let capturedCbs: any;
    mockHandleDrag.mockImplementationOnce((cbs: any) => { capturedCbs = cbs; });
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} model={existing} />); });
    ref.current!.start(10, { clientX: 50, clientY: 50 } as any);
    act(() => { capturedCbs.onMove({ clientX: 70, clientY: 70 }); });
    act(() => { capturedCbs.onEnd(); });
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([existing[0]]));
    expect((onChange.mock.calls[0][0] as any).length).toBe(2);
  });

  it('keyStart returns undefined when no enter/space', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    const result = ref.current!.keyStart(
      { point: [50, 50], keys: { enter: false, space: false } } as any, 10
    );
    expect(result).toBeUndefined();
  });

  it('keyStart with space returns hooks', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    const hooks = ref.current!.keyStart(
      { point: [50, 50], keys: { enter: false, space: true } } as any, 10
    );
    expect(hooks).toBeDefined();
    expect(typeof hooks!.keymove).toBe('function');
    expect(typeof hooks!.keyup).toBe('function');
    expect(typeof hooks!.cancel).toBe('function');
  });

  it('keyStart with enter returns hooks', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    const hooks = ref.current!.keyStart(
      { point: [50, 50], keys: { enter: true, space: false } } as any, 10
    );
    expect(hooks).toBeDefined();
  });

  it('keyStart keymove draws without error', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    const hooks = ref.current!.keyStart(
      { point: [50, 50], keys: { enter: true, space: false } } as any, 10
    );
    act(() => { hooks!.keymove([80, 90]); });
  });

  it('keyStart keyup commits after keymove', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    const hooks = ref.current!.keyStart(
      { point: [50, 50], keys: { enter: true, space: false } } as any, 10
    );
    act(() => { hooks!.keymove([80, 90]); });
    act(() => { hooks!.keyup!(); });
    expect(onChange).toHaveBeenCalled();
  });

  it('keyStart cancel calls repaint (no error)', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    const hooks = ref.current!.keyStart(
      { point: [50, 50], keys: { enter: true, space: false } } as any, 10
    );
    act(() => { hooks!.cancel!(); });
  });

  it('repaint clears canvas when model is empty array', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} model={[]} />); });
    // no error
  });

  it('seal uses cached blur on second call', () => {
    const onChange = vi.fn();
    const ref = React.createRef<MosaicLayer>();
    act(() => { render(<MosaicLayer ref={ref} bg={bgMock} area={area} onChange={onChange} />); });
    mockBgBlur.mockClear();
    const instance = ref.current! as any;
    const fakeCanvas = { width: 400, height: 300 };
    instance._blur_ = undefined;
    instance.seal(fakeCanvas);
    instance.seal(fakeCanvas);
    expect(mockBgBlur).toHaveBeenCalledTimes(1);
  });
});
