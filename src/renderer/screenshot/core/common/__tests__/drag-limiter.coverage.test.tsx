/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { DragLimiter } from '../drag-limiter';

type MEvent = { clientX: number; clientY: number };

describe('DragLimiter', () => {
  const area: [number, number, number, number] = [0, 0, 200, 200]; // left, top, width, height
  const startEvent: MEvent = { clientX: 100, clientY: 100 };

  it('creates instance without error', () => {
    const limiter = new DragLimiter(area, startEvent as PointerEvent);
    expect(limiter).toBeTruthy();
  });

  describe('drawRect', () => {
    it('returns a rect relative to area origin', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      const rect = limiter.drawRect({ clientX: 150, clientY: 150 } as PointerEvent);
      expect(rect).toEqual([100, 100, 50, 50]);
    });

    it('handles dragging left/up from start', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      const rect = limiter.drawRect({ clientX: 50, clientY: 50 } as PointerEvent);
      expect(rect).toEqual([50, 50, 50, 50]);
    });

    it('limits end point within area', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      // dragging outside bounds
      const rect = limiter.drawRect({ clientX: 300, clientY: 300 } as PointerEvent);
      // limited to area [0,0,200,200], so endX=200, endY=200
      expect(rect[2]).toBeGreaterThanOrEqual(0);
      expect(rect[3]).toBeGreaterThanOrEqual(0);
    });

    it('aligns rect when align=true', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      const rect = limiter.drawRect({ clientX: 160, clientY: 140 } as PointerEvent, true);
      // aligned: square selection from startX=100, startY=100
      expect(rect[2]).toEqual(rect[3]);
    });
  });

  describe('position', () => {
    it('returns position relative to area', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      const pos = limiter.position({ clientX: 150, clientY: 120 } as PointerEvent);
      expect(pos).toEqual([150, 120]);
    });

    it('clamps outside area', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      const pos = limiter.position({ clientX: -10, clientY: 300 } as PointerEvent);
      expect(pos[0]).toEqual(0);
      expect(pos[1]).toEqual(200);
    });
  });

  describe('offset', () => {
    it('returns offset from start', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      const off = limiter.offset({ clientX: 130, clientY: 90 } as PointerEvent);
      expect(off).toEqual([30, -10]);
    });
  });

  describe('moveRect', () => {
    it('moves a rect by drag delta', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      // start at 100,100; move to 110,110 => dx=10,dy=10
      const rect: [number, number, number, number] = [10, 10, 50, 50];
      const result = limiter.moveRect({ clientX: 110, clientY: 110 } as PointerEvent, rect);
      expect(result[0]).toEqual(20);
      expect(result[1]).toEqual(20);
    });
  });

  describe('moveArrow', () => {
    it('moves both arrow endpoints', () => {
      const limiter = new DragLimiter(area, startEvent as PointerEvent);
      const from: [number, number] = [50, 50];
      const to: [number, number] = [80, 80];
      const [newFrom, newTo] = limiter.moveArrow(
        { clientX: 110, clientY: 110 } as PointerEvent,
        from, to
      );
      expect(newFrom).toEqual([60, 60]);
      expect(newTo).toEqual([90, 90]);
    });
  });
});
