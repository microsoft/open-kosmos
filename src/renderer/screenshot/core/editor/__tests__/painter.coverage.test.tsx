// @ts-nocheck
/** @vitest-environment happy-dom */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockSetCursor } = vi.hoisted(() => ({
  mockSetCursor: vi.fn(),
}));

vi.mock('../../common/keyboard-painter', () => ({
  keyboardPainter: { setCursor: mockSetCursor },
  StrokeEvent: {},
}));

vi.mock('../../common/cursor', () => ({
  CrossCursor: ({ size }: { size: number }) => `CrossCursor-${size}`,
  PencilCursor: ({ color }: { color: string }) => `PencilCursor-${color}`,
  MosicCursor: ({ size }: { size: number }) => `MosicCursor-${size}`,
  TextCursor: 'TextCursor',
}));

vi.mock('../toolbar', () => ({}));
vi.mock('../../common/drag-limiter', () => ({}));
vi.mock('../shape', () => ({}));

import { isPainterConfig, startDrawByMouse, startDrawByKeyboard, updateCursorForKeyboard } from '../painter';
import type { PainterConfig } from '../toolbar';
import type { Painters } from '../shape';

function makePainter(overrides: Partial<Record<keyof Painters, any>> = {}): Painters {
  const makeRef = (methods: Record<string, vi.Mock> = {}) => ({
    current: { start: vi.fn(), keyStart: vi.fn(), ...methods },
  });
  return {
    square: makeRef(),
    ellipse: makeRef(),
    arrow: makeRef(),
    pencil: makeRef(),
    mosaic: makeRef(),
    text: makeRef(),
    preset: makeRef(),
    ...overrides,
  } as unknown as Painters;
}

const baseEvent = {} as any;
const baseStrokeEvent = {} as any;

describe('isPainterConfig', () => {
  it('returns true for painter types', () => {
    for (const type of ['square', 'ellipse', 'arrow', 'pencil', 'mosaic', 'text', 'preset']) {
      expect(isPainterConfig({ type } as any)).toBe(true);
    }
  });

  it('returns false for non-painter types', () => {
    expect(isPainterConfig({ type: 'select' } as any)).toBe(false);
    expect(isPainterConfig(null)).toBe(false);
    expect(isPainterConfig(undefined)).toBe(false);
  });
});

describe('startDrawByMouse', () => {
  it('calls square.start', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'square', color: 'red', size: 2 } as any;
    startDrawByMouse(p, tool, baseEvent);
    expect(p.square.current!.start).toHaveBeenCalledWith('red', 2, baseEvent);
  });

  it('calls ellipse.start', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'ellipse', color: 'blue', size: 3 } as any;
    startDrawByMouse(p, tool, baseEvent);
    expect(p.ellipse.current!.start).toHaveBeenCalledWith('blue', 3, baseEvent);
  });

  it('calls arrow.start', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'arrow', color: 'green', size: 4 } as any;
    startDrawByMouse(p, tool, baseEvent);
    expect(p.arrow.current!.start).toHaveBeenCalledWith('green', 4, baseEvent);
  });

  it('calls pencil.start', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'pencil', color: 'black', size: 1 } as any;
    startDrawByMouse(p, tool, baseEvent);
    expect(p.pencil.current!.start).toHaveBeenCalledWith('black', 1, baseEvent);
  });

  it('calls mosaic.start', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'mosaic', color: 'black', size: 10 } as any;
    startDrawByMouse(p, tool, baseEvent);
    expect(p.mosaic.current!.start).toHaveBeenCalledWith(10, baseEvent);
  });

  it('calls text.start', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'text', color: 'red', size: 14 } as any;
    startDrawByMouse(p, tool, baseEvent);
    expect(p.text.current!.start).toHaveBeenCalledWith('red', 14, baseEvent);
  });

  it('calls preset.start', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'preset', content: '😀' } as any;
    startDrawByMouse(p, tool, baseEvent);
    expect(p.preset.current!.start).toHaveBeenCalledWith(baseEvent, '😀');
  });
});

describe('startDrawByKeyboard', () => {
  it('calls square.keyStart', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'square', color: 'red', size: 2 } as any;
    startDrawByKeyboard(p, tool, baseStrokeEvent);
    expect(p.square.current!.keyStart).toHaveBeenCalledWith(baseStrokeEvent, 'red', 2);
  });

  it('calls ellipse.keyStart', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'ellipse', color: 'blue', size: 3 } as any;
    startDrawByKeyboard(p, tool, baseStrokeEvent);
    expect(p.ellipse.current!.keyStart).toHaveBeenCalledWith(baseStrokeEvent, 'blue', 3);
  });

  it('calls arrow.keyStart', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'arrow', color: 'green', size: 4 } as any;
    startDrawByKeyboard(p, tool, baseStrokeEvent);
    expect(p.arrow.current!.keyStart).toHaveBeenCalledWith(baseStrokeEvent, 'green', 4);
  });

  it('calls pencil.keyStart', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'pencil', color: 'black', size: 1 } as any;
    startDrawByKeyboard(p, tool, baseStrokeEvent);
    expect(p.pencil.current!.keyStart).toHaveBeenCalledWith(baseStrokeEvent, 'black', 1);
  });

  it('calls mosaic.keyStart', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'mosaic', size: 10 } as any;
    startDrawByKeyboard(p, tool, baseStrokeEvent);
    expect(p.mosaic.current!.keyStart).toHaveBeenCalledWith(baseStrokeEvent, 10);
  });

  it('calls text.keyStart', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'text', color: 'red', size: 14 } as any;
    startDrawByKeyboard(p, tool, baseStrokeEvent);
    expect(p.text.current!.keyStart).toHaveBeenCalledWith(baseStrokeEvent, 'red', 14);
  });

  it('calls preset.keyStart', () => {
    const p = makePainter();
    const tool: PainterConfig = { type: 'preset', content: '😀' } as any;
    startDrawByKeyboard(p, tool, baseStrokeEvent);
    expect(p.preset.current!.keyStart).toHaveBeenCalledWith(baseStrokeEvent, '😀');
  });
});

describe('updateCursorForKeyboard', () => {
  beforeEach(() => {
    mockSetCursor.mockClear();
  });

  it('sets CrossCursor for square', () => {
    updateCursorForKeyboard({ type: 'square', color: 'red', size: 2 } as any);
    expect(mockSetCursor).toHaveBeenCalled();
  });

  it('sets CrossCursor for ellipse', () => {
    updateCursorForKeyboard({ type: 'ellipse', color: 'red', size: 2 } as any);
    expect(mockSetCursor).toHaveBeenCalled();
  });

  it('sets CrossCursor for arrow', () => {
    updateCursorForKeyboard({ type: 'arrow', color: 'red', size: 2 } as any);
    expect(mockSetCursor).toHaveBeenCalled();
  });

  it('sets CrossCursor for preset', () => {
    updateCursorForKeyboard({ type: 'preset', content: 'x' } as any);
    expect(mockSetCursor).toHaveBeenCalled();
  });

  it('sets PencilCursor for pencil', () => {
    updateCursorForKeyboard({ type: 'pencil', color: 'blue', size: 2 } as any);
    expect(mockSetCursor).toHaveBeenCalled();
  });

  it('sets MosicCursor for mosaic', () => {
    updateCursorForKeyboard({ type: 'mosaic', color: 'black', size: 10 } as any);
    expect(mockSetCursor).toHaveBeenCalled();
  });

  it('sets TextCursor for text', () => {
    updateCursorForKeyboard({ type: 'text', color: 'black', size: 14 } as any);
    expect(mockSetCursor).toHaveBeenCalled();
  });
});
