/** @vitest-environment happy-dom */
/**
 * Coverage tests for src/renderer/screenshot/core/frame.tsx
 * Covers: FrameBox component, optimizeFrames, scaleFrames, isContain, isCover
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCss } = vi.hoisted(() => ({ mockCss: vi.fn((s: TemplateStringsArray) => 'SFrameBox') }));

vi.mock('../common/styled', () => ({ css: mockCss }));
vi.mock('../common/screenshot', () => ({}));
vi.mock('../type', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { FrameBox, optimizeFrames, scaleFrames } from '../frame';
import type { InnerFrame } from '../common/screenshot';

// ─── helpers ─────────────────────────────────────────────────────────────────
function frame(id: number, x: number, y: number, w: number, h: number): InnerFrame {
  return { id, x, y, width: w, height: h };
}

function setWindow(dpr = 1, w = 1920, h = 1080) {
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

beforeEach(() => setWindow());

// ─── FrameBox ─────────────────────────────────────────────────────────────────
describe('FrameBox', () => {
  it('renders a div with correct position styles', () => {
    const onSelect = vi.fn();
    const bgCss = { backgroundImage: 'url(x)', backgroundSize: '100% 100%' };
    const { container } = render(
      <FrameBox
        onSelect={onSelect}
        data={frame(1, 10, 20, 300, 200)}
        bgCss={bgCss}
      />
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div).toBeTruthy();
    expect(div.style.left).toBe('10px');
    expect(div.style.top).toBe('20px');
    expect(div.style.width).toBe('300px');
    expect(div.style.height).toBe('200px');
  });

  it('calls onSelect with [x, y, width, height] when clicked', () => {
    const onSelect = vi.fn();
    const bgCss = { backgroundImage: 'url(x)', backgroundSize: 'auto' };
    const { container } = render(
      <FrameBox
        onSelect={onSelect}
        data={frame(1, 5, 10, 100, 80)}
        bgCss={bgCss}
      />
    );
    fireEvent.click(container.firstElementChild!);
    expect(onSelect).toHaveBeenCalledWith([5, 10, 100, 80]);
  });
});

// ─── scaleFrames ─────────────────────────────────────────────────────────────
describe('scaleFrames', () => {
  it('divides coordinates by devicePixelRatio', () => {
    setWindow(2, 1920, 1080);
    const result = scaleFrames([frame(1, 200, 100, 400, 200)]);
    expect(result[0]).toMatchObject({ x: 100, y: 50, width: 200, height: 100 });
  });

  it('clips frame to viewport boundaries (right/bottom)', () => {
    setWindow(1, 500, 400);
    const result = scaleFrames([frame(1, 400, 300, 300, 300)]);
    // x=400, width=300 → endX min(700,500)=500 → width=100
    expect(result[0].width).toBe(100);
    expect(result[0].height).toBe(100);
  });

  it('clamps negative x/y to 0', () => {
    setWindow(1, 1920, 1080);
    const result = scaleFrames([frame(1, -20, -10, 100, 80)]);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    // width/height adjusted: endX = -20+100=80, endY=-10+80=70
    expect(result[0].width).toBe(80);
    expect(result[0].height).toBe(70);
  });

  it('returns empty array for empty input', () => {
    expect(scaleFrames([])).toEqual([]);
  });

  it('preserves other properties (id, etc)', () => {
    setWindow(1);
    const result = scaleFrames([frame(42, 0, 0, 100, 100)]);
    expect(result[0].id).toBe(42);
  });
});

// ─── optimizeFrames ───────────────────────────────────────────────────────────
describe('optimizeFrames', () => {
  it('always appends a full-viewport frame at the end', () => {
    setWindow(1, 800, 600);
    const result = optimizeFrames([]);
    expect(result[result.length - 1]).toMatchObject({ x: 0, y: 0, width: 800, height: 600, id: -1 });
  });

  it('keeps non-contained frames', () => {
    setWindow(1, 1920, 1080);
    const inputs = [
      frame(1, 0, 0, 100, 100),
      frame(2, 500, 500, 100, 100),
    ];
    const result = optimizeFrames(inputs);
    // Both survive (neither contains the other), plus the screen frame
    expect(result.some(f => f.id === 1)).toBe(true);
    expect(result.some(f => f.id === 2)).toBe(true);
  });

  it('removes frames contained inside the first frame', () => {
    setWindow(1, 1920, 1080);
    // frame 1 fully contains frame 2
    const inputs = [
      frame(1, 0, 0, 500, 500),
      frame(2, 10, 10, 100, 100),
    ];
    const result = optimizeFrames(inputs);
    expect(result.some(f => f.id === 2)).toBe(false);
    expect(result.some(f => f.id === 1)).toBe(true);
  });

  it('handles a single frame input', () => {
    setWindow(1, 1920, 1080);
    const result = optimizeFrames([frame(5, 50, 50, 200, 200)]);
    expect(result[0].id).toBe(5);
  });
});
