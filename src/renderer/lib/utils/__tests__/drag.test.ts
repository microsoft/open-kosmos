/**
 * @vitest-environment happy-dom
 */
import { handleDrag } from '../drag';

describe('handleDrag', () => {
  it('calls onMove with first=true on first mousemove', () => {
    const onMove = vi.fn();
    const startEvent = { clientX: 100, clientY: 200 } as any;

    handleDrag(startEvent, { onMove });

    // Simulate mousemove
    const moveEvent = new MouseEvent('mousemove', { clientX: 110, clientY: 220 });
    Object.defineProperty(moveEvent, 'x', { value: 110 });
    Object.defineProperty(moveEvent, 'y', { value: 220 });
    document.dispatchEvent(moveEvent);

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].first).toBe(true);
    expect(onMove.mock.calls[0][0].offset.x).toBe(10);
    expect(onMove.mock.calls[0][0].offset.y).toBe(20);
  });

  it('calls onMove with first=false on subsequent moves', () => {
    const onMove = vi.fn();
    const startEvent = { clientX: 0, clientY: 0 } as any;

    handleDrag(startEvent, { onMove });

    const move1 = new MouseEvent('mousemove', { clientX: 5, clientY: 5 });
    Object.defineProperty(move1, 'x', { value: 5 });
    Object.defineProperty(move1, 'y', { value: 5 });
    document.dispatchEvent(move1);

    const move2 = new MouseEvent('mousemove', { clientX: 10, clientY: 10 });
    Object.defineProperty(move2, 'x', { value: 10 });
    Object.defineProperty(move2, 'y', { value: 10 });
    document.dispatchEvent(move2);

    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onMove.mock.calls[1][0].first).toBe(false);
  });

  it('calls onEnd with offset and duration on mouseup after move', () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const startEvent = { clientX: 0, clientY: 0 } as any;

    handleDrag(startEvent, { onMove, onEnd });

    const moveEvent = new MouseEvent('mousemove', { clientX: 10, clientY: 10 });
    Object.defineProperty(moveEvent, 'x', { value: 10 });
    Object.defineProperty(moveEvent, 'y', { value: 10 });
    document.dispatchEvent(moveEvent);

    const upEvent = new MouseEvent('mouseup');
    document.dispatchEvent(upEvent);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0][0].offset.x).toBe(10);
    expect(onEnd.mock.calls[0][0].offset.y).toBe(10);
    expect(typeof onEnd.mock.calls[0][0].duration).toBe('number');
  });

  it('does not call onEnd if mouseup without prior move', () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const startEvent = { clientX: 0, clientY: 0 } as any;

    handleDrag(startEvent, { onMove, onEnd });

    const upEvent = new MouseEvent('mouseup');
    document.dispatchEvent(upEvent);

    expect(onEnd).not.toHaveBeenCalled();
  });

  it('removes event listeners after mouseup', () => {
    const onMove = vi.fn();
    const startEvent = { clientX: 0, clientY: 0 } as any;

    handleDrag(startEvent, { onMove });

    // Move then up
    const moveEvent = new MouseEvent('mousemove', { clientX: 5, clientY: 5 });
    Object.defineProperty(moveEvent, 'x', { value: 5 });
    Object.defineProperty(moveEvent, 'y', { value: 5 });
    document.dispatchEvent(moveEvent);
    document.dispatchEvent(new MouseEvent('mouseup'));

    // Further move should not trigger
    const move2 = new MouseEvent('mousemove', { clientX: 20, clientY: 20 });
    Object.defineProperty(move2, 'x', { value: 20 });
    Object.defineProperty(move2, 'y', { value: 20 });
    document.dispatchEvent(move2);

    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('works without onEnd callback', () => {
    const onMove = vi.fn();
    const startEvent = { clientX: 0, clientY: 0 } as any;

    handleDrag(startEvent, { onMove });

    const moveEvent = new MouseEvent('mousemove', { clientX: 5, clientY: 5 });
    Object.defineProperty(moveEvent, 'x', { value: 5 });
    Object.defineProperty(moveEvent, 'y', { value: 5 });
    document.dispatchEvent(moveEvent);
    document.dispatchEvent(new MouseEvent('mouseup'));

    // No crash
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
