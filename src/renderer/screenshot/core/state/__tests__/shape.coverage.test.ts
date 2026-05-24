/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockSet = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockStartTransaction = vi.hoisted(() => vi.fn());
const mockEndTransaction = vi.hoisted(() => vi.fn());
const mockMeasureWidth = vi.hoisted(() => vi.fn(() => 100));
const mockRequestAnimationFrame = vi.hoisted(() => vi.fn((cb: FrameRequestCallback) => { cb(0); return 0; }));

vi.mock('../../context', () => ({
  define: {
    model: (name: string, make: () => any, create: (set: any, get: any, model: any) => any) => {
      const model = {
        startTransaction: mockStartTransaction,
        endTransaction: mockEndTransaction,
      };
      const actions = create(mockSet, mockGet, model);
      return { actions, name };
    },
  },
  uuid: vi.fn(() => 'test-uuid'),
}));

vi.mock('../../common/utils/dom', () => ({
  measureWidth: mockMeasureWidth,
}));

vi.mock('../../editor/toolbar', () => ({}));

// ─── Subject under test ──────────────────────────────────────────────────────

import { shapesAtom } from '../shape';

// Helper: get actions from the atom
function getActions() {
  return (shapesAtom as any).actions;
}

// Helper: setup get() to return specific state
function setupState(state: any) {
  mockGet.mockReturnValue(state);
}

// Helper: capture the immer producer and apply it to initial state
function applySet(initialState: any): any {
  const lastCall = mockSet.mock.calls[mockSet.mock.calls.length - 1];
  const producer = lastCall?.[0];
  if (typeof producer === 'function') {
    // It's an immer curried producer - call it with the initial state
    return producer(initialState);
  }
  return producer;
}

describe('shapesAtom', () => {
  beforeEach(() => {
    mockSet.mockClear();
    mockGet.mockClear();
    mockStartTransaction.mockClear();
    mockEndTransaction.mockClear();
    global.requestAnimationFrame = mockRequestAnimationFrame as any;
  });

  // ── reset ──
  it('reset() calls set with default shapes', () => {
    getActions().reset();
    expect(mockSet).toHaveBeenCalledOnce();
    const arg = mockSet.mock.calls[0][0];
    expect(arg).toMatchObject({ layers: [], elements: {} });
  });

  // ── addLayer ──
  it('addLayer() calls startTransaction and set', () => {
    const layer = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
    setupState({ layers: [], elements: {} });
    getActions().addLayer(layer);
    expect(mockStartTransaction).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalled();
  });

  it('addLayer() adds layer id to layers array and elements', () => {
    const layer = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
    const state = { layers: [], elements: {} };
    setupState(state);
    getActions().addLayer(layer);
    const result = applySet(state);
    expect(result.layers).toContain('a1');
    expect(result.elements['a1']).toEqual(layer);
  });

  // ── updateLayer ──
  it('updateLayer() skips when layer reference is the same', () => {
    const layer = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
    setupState({ layers: ['a1'], elements: { a1: layer } });
    getActions().updateLayer(layer);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('updateLayer() calls set when layer is different', () => {
    const layer = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
    const updated = { ...layer, fill: 'blue' };
    setupState({ layers: ['a1'], elements: { a1: layer } });
    getActions().updateLayer(updated);
    expect(mockSet).toHaveBeenCalled();
  });

  it('updateLayer() updates element in state', () => {
    const layer = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
    const updated = { ...layer, fill: 'blue' };
    const state = { layers: ['a1'], elements: { a1: layer } };
    setupState(state);
    getActions().updateLayer(updated);
    const result = applySet(state);
    expect(result.elements['a1'].fill).toBe('blue');
  });

  // ── deleteLayer ──
  it('deleteLayer() skips when element does not exist', () => {
    setupState({ layers: [], elements: {} });
    getActions().deleteLayer('nonexistent');
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('deleteLayer() removes element and layer id', () => {
    const layer = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
    const state = { layers: ['a1', 'b2'], elements: { a1: layer } };
    setupState(state);
    getActions().deleteLayer('a1');
    const result = applySet(state);
    expect(result.elements['a1']).toBeUndefined();
    expect(result.layers).not.toContain('a1');
  });

  // ── getLayer ──
  it('getLayer() returns layer by id', () => {
    const layer = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
    setupState({ layers: ['a1'], elements: { a1: layer } });
    const result = getActions().getLayer('a1');
    expect(result).toEqual(layer);
  });

  it('getLayer() returns undefined for missing id', () => {
    setupState({ layers: [], elements: {} });
    const result = getActions().getLayer('missing');
    expect(result).toBeUndefined();
  });

  // ── isEmpty ──
  it('isEmpty() returns true when no layers and no mosaic', () => {
    setupState({ layers: [], elements: {} });
    expect(getActions().isEmpty()).toBe(true);
  });

  it('isEmpty() returns false when there are layers', () => {
    setupState({ layers: ['a1'], elements: {} });
    expect(getActions().isEmpty()).toBe(false);
  });

  it('isEmpty() returns false when mosaic is defined', () => {
    setupState({ layers: [], elements: {}, mosaic: [{ d: 'M0', size: 10 }] });
    expect(getActions().isEmpty()).toBe(false);
  });

  // ── changeMosaic ──
  it('changeMosaic() skips when same value', () => {
    const mosaic = [{ d: 'M0', size: 10 }];
    setupState({ layers: [], elements: {}, mosaic });
    getActions().changeMosaic(mosaic);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('changeMosaic() updates mosaic when different', () => {
    const mosaic = [{ d: 'M0', size: 10 }];
    const state = { layers: [], elements: {}, mosaic: undefined };
    setupState(state);
    getActions().changeMosaic(mosaic);
    expect(mockSet).toHaveBeenCalled();
  });

  // ── typed add/update wrappers ──
  it('addSquare delegates to addLayer', () => {
    const square = { type: 'square' as const, id: 's1', stroke: 'red', strokeWidth: 2, rect: [0, 0, 10, 10] as [number, number, number, number] };
    const state = { layers: [], elements: {} };
    setupState(state);
    getActions().addSquare(square);
    expect(mockSet).toHaveBeenCalled();
  });

  it('addEllipse delegates to addLayer', () => {
    const ellipse = { type: 'ellipse' as const, id: 'e1', stroke: 'blue', strokeWidth: 2, rect: [0, 0, 10, 10] as [number, number, number, number] };
    const state = { layers: [], elements: {} };
    setupState(state);
    getActions().addEllipse(ellipse);
    expect(mockSet).toHaveBeenCalled();
  });

  it('addArrow delegates to addLayer', () => {
    const arrow = { type: 'arrow' as const, id: 'ar1', fill: 'green', size: 15, from: [0, 0] as [number, number], to: [50, 50] as [number, number] };
    const state = { layers: [], elements: {} };
    setupState(state);
    getActions().addArrow(arrow);
    expect(mockSet).toHaveBeenCalled();
  });

  it('addFreeCurve delegates to addLayer', () => {
    const curve = { type: 'freeCurve' as const, id: 'fc1', stroke: 'red', strokeWidth: 3, d: 'M0,0', offset: [0, 0] as [number, number] };
    const state = { layers: [], elements: {} };
    setupState(state);
    getActions().addFreeCurve(curve);
    expect(mockSet).toHaveBeenCalled();
  });

  it('updateSquare calls startTransaction when different', () => {
    const square = { type: 'square' as const, id: 's1', stroke: 'red', strokeWidth: 2, rect: [0, 0, 10, 10] as [number, number, number, number] };
    const updated = { ...square, stroke: 'blue' };
    setupState({ layers: ['s1'], elements: { s1: square } });
    getActions().updateSquare(updated);
    expect(mockStartTransaction).toHaveBeenCalled();
  });

  it('updateArrow calls startTransaction when different', () => {
    const arrow = { type: 'arrow' as const, id: 'ar1', fill: 'green', size: 15, from: [0, 0] as [number, number], to: [50, 50] as [number, number] };
    const updated = { ...arrow, fill: 'blue' };
    setupState({ layers: ['ar1'], elements: { ar1: arrow } });
    getActions().updateArrow(updated);
    expect(mockStartTransaction).toHaveBeenCalled();
  });

  // ── changeByConfig ──
  describe('changeByConfig', () => {
    it('does nothing for unknown type', () => {
      setupState({ layers: [], elements: {} });
      getActions().changeByConfig('x', { type: 'unknown' as any, color: 'red', size: 5 });
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('square: skips when shape not found', () => {
      setupState({ layers: [], elements: {} });
      getActions().changeByConfig('missing', { type: 'square', color: 'red', size: 4 });
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('square: skips when shape type mismatch', () => {
      const arrow = { type: 'arrow' as const, id: 'a1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [10, 10] as [number, number] };
      setupState({ layers: ['a1'], elements: { a1: arrow } });
      getActions().changeByConfig('a1', { type: 'square', color: 'blue', size: 4 });
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('square: updates stroke and strokeWidth', () => {
      const square = { type: 'square' as const, id: 's1', stroke: 'red', strokeWidth: 2, rect: [0, 0, 10, 10] as [number, number, number, number] };
      const state = { layers: ['s1'], elements: { s1: square } };
      mockGet
        .mockReturnValueOnce(state) // for getLayer inside changeByConfig
        .mockReturnValueOnce(state) // for updateLayer's same-ref check
        .mockReturnValue(state);
      getActions().changeByConfig('s1', { type: 'square', color: 'blue', size: 5 });
      expect(mockSet).toHaveBeenCalled();
    });

    it('ellipse: updates stroke and strokeWidth', () => {
      const ellipse = { type: 'ellipse' as const, id: 'e1', stroke: 'red', strokeWidth: 2, rect: [0, 0, 10, 10] as [number, number, number, number] };
      const state = { layers: ['e1'], elements: { e1: ellipse } };
      mockGet
        .mockReturnValueOnce(state)
        .mockReturnValueOnce(state)
        .mockReturnValue(state);
      getActions().changeByConfig('e1', { type: 'ellipse', color: 'blue', size: 5 });
      expect(mockSet).toHaveBeenCalled();
    });

    it('arrow: updates fill and size', () => {
      const arrow = { type: 'arrow' as const, id: 'ar1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [50, 50] as [number, number] };
      const state = { layers: ['ar1'], elements: { ar1: arrow } };
      mockGet
        .mockReturnValueOnce(state)
        .mockReturnValueOnce(state)
        .mockReturnValue(state);
      getActions().changeByConfig('ar1', { type: 'arrow', color: 'blue', size: 20 });
      expect(mockSet).toHaveBeenCalled();
    });

    it('pencil: updates stroke and strokeWidth for freeCurve', () => {
      const curve = { type: 'freeCurve' as const, id: 'fc1', stroke: 'red', strokeWidth: 3, d: 'M0,0', offset: [0, 0] as [number, number] };
      const state = { layers: ['fc1'], elements: { fc1: curve } };
      mockGet
        .mockReturnValueOnce(state)
        .mockReturnValueOnce(state)
        .mockReturnValue(state);
      getActions().changeByConfig('fc1', { type: 'pencil', color: 'green', size: 6 });
      expect(mockSet).toHaveBeenCalled();
    });

    it('pencil: skips when shape type is not freeCurve', () => {
      const arrow = { type: 'arrow' as const, id: 'ar1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [50, 50] as [number, number] };
      setupState({ layers: ['ar1'], elements: { ar1: arrow } });
      getActions().changeByConfig('ar1', { type: 'pencil', color: 'green', size: 6 });
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('text: updates color and fontSize', () => {
      const text = { type: 'text' as const, id: 't1', color: 'black', fontSize: 20, position: [0, 0] as [number, number], content: 'hello', width: 50 };
      const state = { layers: ['t1'], elements: { t1: text } };
      // same fontSize so no DOM manipulation needed
      mockGet
        .mockReturnValueOnce(state)
        .mockReturnValueOnce(state)
        .mockReturnValue(state);
      getActions().changeByConfig('t1', { type: 'text', color: 'blue', size: 20 });
      expect(mockSet).toHaveBeenCalled();
    });

    it('text: updates width when fontSize changes', () => {
      const text = { type: 'text' as const, id: 't1', color: 'black', fontSize: 20, position: [0, 0] as [number, number], content: 'hello', width: 50 };
      const state = { layers: ['t1'], elements: { t1: text } };

      // Create a fake DOM element with id shape-text-t1
      const el = document.createElement('span');
      el.id = 'shape-text-t1';
      document.body.appendChild(el);

      mockGet
        .mockReturnValueOnce(state)
        .mockReturnValueOnce(state)
        .mockReturnValue(state);

      getActions().changeByConfig('t1', { type: 'text', color: 'blue', size: 30 });
      expect(mockMeasureWidth).toHaveBeenCalled();

      document.body.removeChild(el);
    });

    it('text: skips when shape type is not text', () => {
      const arrow = { type: 'arrow' as const, id: 'ar1', fill: 'red', size: 10, from: [0, 0] as [number, number], to: [50, 50] as [number, number] };
      setupState({ layers: ['ar1'], elements: { ar1: arrow } });
      getActions().changeByConfig('ar1', { type: 'text', color: 'blue', size: 20 });
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('text: skips when shape not found', () => {
      setupState({ layers: [], elements: {} });
      getActions().changeByConfig('missing', { type: 'text', color: 'blue', size: 20 });
      expect(mockSet).not.toHaveBeenCalled();
    });
  });
});
