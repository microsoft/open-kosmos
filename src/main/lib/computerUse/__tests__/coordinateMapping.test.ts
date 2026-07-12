import { describe, it, expect } from 'vitest';
import { mapImagePointToScreen, toDriverPoint } from '../coordinateMapping';

describe('mapImagePointToScreen', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 800 };

  it('maps center of a 1x display', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: 500, y: 400 }, imageDims: { width: 1000, height: 800 }, bounds });
    expect(res).toEqual({ ok: true, point: { x: 500, y: 400 } });
  });

  it('scales image-space to logical bounds (HiDPI capture larger than bounds)', () => {
    const res = mapImagePointToScreen({
      imagePoint: { x: 1000, y: 800 },
      imageDims: { width: 2000, height: 1600 },
      bounds: { x: 0, y: 0, width: 1000, height: 800 },
    });
    expect(res).toEqual({ ok: true, point: { x: 500, y: 400 } });
  });

  it('adds the origin of a secondary display', () => {
    const res = mapImagePointToScreen({
      imagePoint: { x: 100, y: 100 },
      imageDims: { width: 1000, height: 1000 },
      bounds: { x: 1920, y: -200, width: 1000, height: 1000 },
    });
    expect(res).toEqual({ ok: true, point: { x: 2020, y: -100 } });
  });

  it('rounds fractional results', () => {
    const res = mapImagePointToScreen({
      imagePoint: { x: 1, y: 1 },
      imageDims: { width: 3, height: 3 },
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(res).toEqual({ ok: true, point: { x: 3, y: 3 } });
  });

  it('rejects zero width image dims', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: 0, y: 0 }, imageDims: { width: 0, height: 10 }, bounds });
    expect(res.ok).toBe(false);
  });

  it('rejects zero height image dims', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: 0, y: 0 }, imageDims: { width: 10, height: 0 }, bounds });
    expect(res.ok).toBe(false);
  });

  it('rejects negative x', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: -1, y: 5 }, imageDims: { width: 10, height: 10 }, bounds });
    expect(res.ok).toBe(false);
  });

  it('rejects negative y', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: 5, y: -1 }, imageDims: { width: 10, height: 10 }, bounds });
    expect(res.ok).toBe(false);
  });

  it('rejects x beyond width', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: 11, y: 5 }, imageDims: { width: 10, height: 10 }, bounds });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('outside');
  });

  it('rejects y beyond height', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: 5, y: 11 }, imageDims: { width: 10, height: 10 }, bounds });
    expect(res.ok).toBe(false);
  });

  it('clamps the exact edge point to the display last valid pixel', () => {
    const res = mapImagePointToScreen({ imagePoint: { x: 10, y: 10 }, imageDims: { width: 10, height: 10 }, bounds: { x: 0, y: 0, width: 100, height: 100 } });
    // The bottom-right image corner (fraction === 1) would map to (100, 100) — the
    // FIRST pixel of the adjacent display — so it is pinned to the last on-display pixel.
    expect(res).toEqual({ ok: true, point: { x: 99, y: 99 } });
  });

  it('clamps the edge against a non-zero display origin', () => {
    const res = mapImagePointToScreen({
      imagePoint: { x: 4, y: 2 },
      imageDims: { width: 4, height: 2 },
      bounds: { x: 1920, y: -200, width: 1000, height: 500 },
    });
    expect(res).toEqual({ ok: true, point: { x: 1920 + 1000 - 1, y: -200 + 500 - 1 } });
  });

  it('clamps a near-edge point that rounds up onto the boundary', () => {
    // 199/200 of a 100px display => 99.5 => Math.round => 100, one past the last
    // valid pixel (99), so it must be clamped back onto the captured display.
    const res = mapImagePointToScreen({
      imagePoint: { x: 199, y: 199 },
      imageDims: { width: 200, height: 200 },
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(res).toEqual({ ok: true, point: { x: 99, y: 99 } });
  });
});

describe('toDriverPoint', () => {
  it('passes logical points through unchanged on darwin even at scaleFactor 2', () => {
    expect(toDriverPoint({ x: 720, y: 450 }, 2, 'darwin')).toEqual({ x: 720, y: 450 });
  });

  it('scales logical points to physical pixels on win32', () => {
    expect(toDriverPoint({ x: 720, y: 450 }, 1.5, 'win32')).toEqual({ x: 1080, y: 675 });
  });

  it('scales on linux as well', () => {
    expect(toDriverPoint({ x: 100, y: 200 }, 2, 'linux')).toEqual({ x: 200, y: 400 });
  });

  it('is a no-op when scaleFactor is 1', () => {
    expect(toDriverPoint({ x: 10, y: 20 }, 1, 'win32')).toEqual({ x: 10, y: 20 });
  });

  it('rounds fractional physical coordinates', () => {
    expect(toDriverPoint({ x: 3, y: 3 }, 1.5, 'win32')).toEqual({ x: 5, y: 5 });
  });
});
