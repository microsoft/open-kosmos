import { describe, it, expect } from 'vitest';
import { deltaE, isBlack, isDark, mosaicBlur } from '../color';

describe('deltaE', () => {
  it('returns 0 for identical colors', () => {
    expect(deltaE([128, 64, 32], [128, 64, 32])).toBeCloseTo(0);
  });

  it('returns a positive number for different colors', () => {
    expect(deltaE([255, 0, 0], [0, 0, 255])).toBeGreaterThan(0);
  });

  it('accepts RGBA tuples (alpha channel ignored in formula)', () => {
    const d = deltaE([128, 128, 128, 1], [128, 128, 128, 0.5]);
    expect(d).toBeCloseTo(0);
  });

  it('black vs white has large delta', () => {
    expect(deltaE([0, 0, 0], [255, 255, 255])).toBeGreaterThan(50);
  });
});

describe('isBlack', () => {
  it('returns false for actual black', () => {
    // deltaE([0,0,0], [0,0,0]) == 0, not > 50
    expect(isBlack([0, 0, 0])).toBe(false);
  });

  it('returns true for a light color', () => {
    expect(isBlack([255, 255, 255])).toBe(true);
  });

  it('returns true for a mid-range color far from black', () => {
    expect(isBlack([200, 100, 50])).toBe(true);
  });
});

describe('isDark', () => {
  it('returns false for the reference blue', () => {
    // deltaE([0,120,212], [0,120,212]) == 0
    expect(isDark([0, 120, 212])).toBe(false);
  });

  it('returns true for white', () => {
    expect(isDark([255, 255, 255])).toBe(true);
  });

  it('returns true for black', () => {
    expect(isDark([0, 0, 0])).toBe(true);
  });
});

describe('mosaicBlur', () => {
  it('averages pixels in each mosaic block', () => {
    // 4×4 image, all black except 2 pixels in top-left 2×2 block
    const width = 4;
    const data = new Uint8ClampedArray(width * 4 * 4); // 4 rows, 4 cols, 4 channels
    const imgData = { data } as ImageData;

    // Set the 4 pixels in the top-left 2×2 block
    // pixel (0,0): R=200, G=0, B=0, A=255
    data[0] = 200; data[1] = 0; data[2] = 0; data[3] = 255;
    // pixel (1,0): R=0, G=0, B=0, A=255
    data[4] = 0; data[5] = 0; data[6] = 0; data[7] = 255;
    // pixel (0,1): R=0, G=0, B=0, A=255
    data[16] = 0; data[17] = 0; data[18] = 0; data[19] = 255;
    // pixel (1,1): R=200, G=0, B=0, A=255
    data[20] = 200; data[21] = 0; data[22] = 0; data[23] = 255;

    mosaicBlur(imgData, width, 2, 2, 1); // radius=1, step=2

    // Average R = (200+0+0+200)/4 = 100
    expect(data[0]).toBe(100);
    expect(data[4]).toBe(100);
    expect(data[16]).toBe(100);
    expect(data[20]).toBe(100);
  });

  it('handles a single pixel block', () => {
    const data = new Uint8ClampedArray(4);
    data[0] = 50; data[1] = 100; data[2] = 150; data[3] = 255;
    const imgData = { data } as ImageData;
    mosaicBlur(imgData, 1, 1, 1, 1);
    expect(data[0]).toBe(50);
    expect(data[1]).toBe(100);
    expect(data[2]).toBe(150);
  });

  it('does not touch pixels outside maxX/maxY', () => {
    const width = 4;
    const data = new Uint8ClampedArray(width * 4 * 4);
    // Set a pixel outside the max area
    data[4 * 3] = 99; // pixel at x=3, y=0 — outside maxX=2
    const imgData = { data } as ImageData;

    mosaicBlur(imgData, width, 2, 2, 1);

    expect(data[4 * 3]).toBe(99); // untouched
  });
});
