/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock dependencies
vi.mock('../../../common/utils/coord', () => ({
  isRectEqual: vi.fn((a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)),
}));

vi.mock('../../area-resizer', () => ({
  points: [
    ['left', 'top', 'nw-resize'],
    ['center', 'top', 'n-resize'],
    ['right', 'top', 'ne-resize'],
    ['left', 'middle', 'w-resize'],
    ['right', 'middle', 'e-resize'],
    ['left', 'bottom', 'sw-resize'],
    ['center', 'bottom', 's-resize'],
    ['right', 'bottom', 'se-resize'],
  ],
  applyDelta: vi.fn((prev: any, h: any, v: any, dx: number, dy: number) => prev),
}));

vi.mock('../../../common/drag-limiter', () => ({
  DragLimiter: class DragLimiter {
    offset = vi.fn(() => [0, 0]);
    constructor() {}
  },
}));

vi.mock('../../../common/utils/drag', () => ({
  handleDrag: vi.fn(),
}));

import Resizer from '../shape-resizer';
import { handleDrag } from '../../../common/utils/drag';

describe('shape-resizer Resizer', () => {
  const limit: [number, number, number, number] = [0, 0, 500, 500];
  const rect: [number, number, number, number] = [50, 50, 200, 150];
  const onChangeStart = vi.fn(() => ({
    change: vi.fn(),
    endChange: vi.fn(),
    onceMoved: vi.fn(),
  }));

  it('renders SVG rect border', () => {
    const { container } = render(
      <svg>
        <Resizer limit={limit} rect={rect} onChangeStart={onChangeStart} />
      </svg>
    );
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(0);
  });

  it('renders 8 resize handle circles by default', () => {
    const { container } = render(
      <svg>
        <Resizer limit={limit} rect={rect} onChangeStart={onChangeStart} />
      </svg>
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(8);
  });

  it('renders children', () => {
    const { container } = render(
      <svg>
        <Resizer limit={limit} rect={rect} onChangeStart={onChangeStart}>
          <circle cx={100} cy={100} r={5} data-testid="child-circle" />
        </Resizer>
      </svg>
    );
    expect(container.querySelector('[data-testid="child-circle"]')).toBeTruthy();
  });

  it('skips center/middle handles when aspectRatio is set', () => {
    const { container } = render(
      <svg>
        <Resizer limit={limit} rect={rect} onChangeStart={onChangeStart} aspectRatio={1.5} />
      </svg>
    );
    // With aspectRatio, center column and middle row are skipped (center-top, center-bottom, left-middle, right-middle)
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(4); // only corners
  });

  it('renders border rect with correct stroke color', () => {
    const { container } = render(
      <svg>
        <Resizer limit={limit} rect={rect} onChangeStart={onChangeStart} />
      </svg>
    );
    const borderRect = container.querySelector('rect');
    expect(borderRect?.getAttribute('stroke')).toBe('#0078D7');
  });

  it('handles pointerDown on a circle', () => {
    const { container } = render(
      <svg>
        <Resizer limit={limit} rect={rect} onChangeStart={onChangeStart} />
      </svg>
    );
    const circle = container.querySelector('circle')!;
    // Trigger pointerDown — should not throw
    const event = new PointerEvent('pointerdown', { bubbles: true });
    vi.spyOn(event, 'stopPropagation');
    circle.dispatchEvent(event);
    // handleDrag should have been called
    expect(handleDrag).toHaveBeenCalled();
  });
});
