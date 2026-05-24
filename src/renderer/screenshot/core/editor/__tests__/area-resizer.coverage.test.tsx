/** @vitest-environment happy-dom */
/**
 * Coverage tests for src/renderer/screenshot/core/editor/area-resizer.tsx
 * Covers: applyDelta, points, ResizeScreenshot (via memo), judgeKeyMove, startDrag
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockHandleDrag, mockLimitPointInRect, mockCss } = vi.hoisted(() => ({
  mockHandleDrag: vi.fn(),
  mockLimitPointInRect: vi.fn((rect: any, x: number, y: number) => [x, y]),
  mockCss: vi.fn(() => 'SDrager'),
}));

vi.mock('../../common/utils/drag', () => ({ handleDrag: mockHandleDrag }));
vi.mock('../../common/utils/coord', () => ({
  calcCursorRect: vi.fn((x1: number, y1: number, x2: number, y2: number) => {
    const [x, w] = x1 < x2 ? [x1, x2 - x1] : [x2, x1 - x2];
    const [y, h] = y1 < y2 ? [y1, y2 - y1] : [y2, y1 - y2];
    return [x, y, w, h];
  }),
  limitPointInRect: mockLimitPointInRect,
}));
vi.mock('../../common/styled', () => ({ css: mockCss }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResizeScreenshot, { applyDelta, points } from '../area-resizer';

// ─── applyDelta ───────────────────────────────────────────────────────────────
describe('applyDelta', () => {
  const origin: [number, number, number, number] = [10, 20, 100, 80];

  it('top/left corner: adjusts x and y by delta', () => {
    const result = applyDelta(origin, 'left', 'top', 5, 10);
    // x = 10+5=15, y = 20+10=30, endX = 10+100=110, endY=20+80=100
    // calcCursorRect(15,30,110,100) => [15,30,95,70]
    expect(result[0]).toBe(15);
    expect(result[1]).toBe(30);
  });

  it('bottom/right corner: adjusts endX and endY', () => {
    const result = applyDelta(origin, 'right', 'bottom', 5, 10);
    // endX = 110+5=115, endY=100+10=110
    // calcCursorRect(10,20,115,110) => [10,20,105,90]
    expect(result[2]).toBe(105);
    expect(result[3]).toBe(90);
  });

  it('center/middle: no change to x or endX', () => {
    const result = applyDelta(origin, 'center', 'middle', 99, 99);
    // neither x nor endX changes for center; neither y nor endY for middle
    // so result should equal origin
    expect(result).toEqual([10, 20, 100, 80]);
  });

  it('top/right: adjusts y and endX', () => {
    const result = applyDelta(origin, 'right', 'top', 10, -5);
    // x stays 10, y = 20-5=15, endX=110+10=120, endY=100
    expect(result[1]).toBe(15);
    expect(result[2]).toBe(110);
  });

  it('flips rect when delta pushes past opposite edge', () => {
    // Move left by 200 (past right edge) → calcCursorRect flips
    const result = applyDelta([0, 0, 50, 50], 'left', 'top', 100, 0);
    // x=0+100=100, endX=50 → calcCursorRect(100,0,50,50) → [50,0,50,50]
    expect(result[0]).toBe(50);
    expect(result[2]).toBe(50);
  });
});

// ─── points array ─────────────────────────────────────────────────────────────
describe('points', () => {
  it('has 8 entries', () => {
    expect(points).toHaveLength(8);
  });

  it('each entry is [Horizon, Vertical, string]', () => {
    for (const [h, v, cursor] of points) {
      expect(typeof h).toBe('string');
      expect(typeof v).toBe('string');
      expect(typeof cursor).toBe('string');
    }
  });
});

// ─── ResizeScreenshot component ───────────────────────────────────────────────
describe('ResizeScreenshot', () => {
  const makeHandleChange = () => ({
    init: [0, 0, 100, 100] as [number, number, number, number],
    change: vi.fn(),
    endChange: vi.fn(),
  });

  it('renders 8 resize handles', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    // each point becomes a div
    expect(container.querySelectorAll('div')).toHaveLength(8);
  });

  it('corner handles have tabIndex=1', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const tabIndexed = Array.from(container.querySelectorAll('[tabindex="1"]'));
    // corners: (left,top), (right,top), (right,bottom), (left,bottom) = 4
    expect(tabIndexed.length).toBe(4);
  });

  it('center/middle handles do NOT have tabIndex', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const allDivs = container.querySelectorAll('div');
    // 4 edge handles (center-top, right-middle, center-bottom, left-middle) have no tabIndex
    const noTab = Array.from(allDivs).filter(d => !d.hasAttribute('tabindex'));
    expect(noTab.length).toBe(4);
  });

  it('custom size prop affects style', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot size={12} onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const first = container.querySelectorAll('div')[0] as HTMLElement;
    expect(first.style.height).toBe('12px');
    expect(first.style.width).toBe('12px');
  });

  it('pointerDown on a corner calls onChangeStart and handleDrag', async () => {
    const handleChange = makeHandleChange();
    const onChangeStart = vi.fn(() => handleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const corner = container.querySelectorAll('[tabindex="1"]')[0] as HTMLElement;
    // Use userEvent to trigger a proper pointer interaction
    await userEvent.pointer({ target: corner, keys: '[MouseLeft>]', coords: { clientX: 50, clientY: 50 } });
    expect(onChangeStart).toHaveBeenCalled();
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('keyDown arrow keys call onReduce on corner handles', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const corner = container.querySelectorAll('[tabindex="1"]')[0];
    // Arrow left (keyCode 37)
    fireEvent.keyDown(corner, { keyCode: 37 });
    expect(onReduce).toHaveBeenCalled();
  });

  it('keyDown arrow right calls onReduce', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const corner = container.querySelectorAll('[tabindex="1"]')[0];
    fireEvent.keyDown(corner, { keyCode: 39 });
    expect(onReduce).toHaveBeenCalled();
  });

  it('keyDown arrow up calls onReduce', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const corner = container.querySelectorAll('[tabindex="1"]')[0];
    fireEvent.keyDown(corner, { keyCode: 38 });
    expect(onReduce).toHaveBeenCalled();
  });

  it('keyDown arrow down calls onReduce', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const corner = container.querySelectorAll('[tabindex="1"]')[0];
    fireEvent.keyDown(corner, { keyCode: 40 });
    expect(onReduce).toHaveBeenCalled();
  });

  it('keyDown non-arrow key does not call onReduce', () => {
    const onChangeStart = vi.fn(makeHandleChange);
    const onReduce = vi.fn();
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const corner = container.querySelectorAll('[tabindex="1"]')[0];
    fireEvent.keyDown(corner, { keyCode: 65 }); // 'A'
    expect(onReduce).not.toHaveBeenCalled();
  });

  it('handleDrag onMove calls change with applyDelta result', async () => {
    const handleChange = {
      init: [10, 20, 100, 80] as [number, number, number, number],
      change: vi.fn(),
      endChange: vi.fn(),
    };
    const onChangeStart = vi.fn(() => handleChange);
    const onReduce = vi.fn();
    mockLimitPointInRect.mockReturnValue([60, 70]);
    const { container } = render(
      <ResizeScreenshot onChangeStart={onChangeStart} onReduce={onReduce} />
    );
    const corner = container.querySelectorAll('[tabindex="1"]')[0] as HTMLElement;
    await userEvent.pointer({ target: corner, keys: '[MouseLeft>]', coords: { clientX: 50, clientY: 50 } });

    // Simulate the onMove callback that handleDrag received
    const lastCallIdx = mockHandleDrag.mock.calls.length - 1;
    const { onMove, onEnd } = mockHandleDrag.mock.calls[lastCallIdx][0];
    onMove({ clientX: 60, clientY: 70 });
    expect(handleChange.change).toHaveBeenCalled();

    onEnd();
    expect(handleChange.endChange).toHaveBeenCalled();
  });
});
