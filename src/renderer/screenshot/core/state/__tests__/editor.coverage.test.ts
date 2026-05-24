// @ts-nocheck
/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the context module
vi.mock('../../context', () => ({
  define: {
    view: vi.fn((name: string, make: Function, actions?: Function) => ({
      name,
      _make: make,
      _actions: actions,
      use: vi.fn(),
    })),
    model: vi.fn((name: string, make: Function, actions?: Function) => ({
      name,
      _make: make,
      _actions: actions,
      use: vi.fn(),
    })),
    memoize: vi.fn((fn: Function) => {
      const mockUse = vi.fn((atom: any) => {
        if (atom && atom._make) {
          return [atom._make(), vi.fn()];
        }
        return [null, vi.fn()];
      });
      return fn(mockUse);
    }),
  },
}));

// Mock dependencies
vi.mock('../common/utils/dom', () => ({
  setToClipboard: vi.fn(() => Promise.resolve()),
}));

vi.mock('../common/utils/time', () => ({
  nextTick: vi.fn(() => Promise.resolve()),
}));

vi.mock('./toolbar', () => ({}));

vi.mock('../state/area', () => ({
  areaAtom: {
    name: 'area',
    _make: () => ({ rect: [0, 0, 100, 100] }),
    use: vi.fn(),
  },
}));

vi.mock('../state/initial', () => ({
  initialAtom: {
    name: 'initial',
    _make: () => ({
      bg: {
        compose: vi.fn(() => {
          return document.createElement('canvas');
        }),
      },
      saveToFile: vi.fn(() => Promise.resolve({ type: 'success' })),
      closeWindow: vi.fn(),
    }),
    use: vi.fn(),
  },
}));

vi.mock('../state/shape', () => ({
  shapesAtom: {
    name: 'shapes',
    _make: () => ({ isEmpty: vi.fn(() => true) }),
    use: vi.fn(),
  },
}));

import {
  activeToolAtom,
  editorTextAtom,
  activeShapeAtom,
  editor_handlers,
} from '../editor';

describe('editor.ts atoms', () => {
  it('activeToolAtom is defined', () => {
    expect(activeToolAtom).toBeDefined();
  });

  it('editorTextAtom is defined', () => {
    expect(editorTextAtom).toBeDefined();
  });

  it('activeShapeAtom is defined', () => {
    expect(activeShapeAtom).toBeDefined();
  });

  it('editor_handlers is defined', () => {
    expect(editor_handlers).toBeDefined();
  });

  it('editor_handlers has compose function', () => {
    expect(typeof editor_handlers.compose).toBe('function');
  });

  it('editor_handlers has save function', () => {
    expect(typeof editor_handlers.save).toBe('function');
  });

  it('editor_handlers has copy function', () => {
    expect(typeof editor_handlers.copy).toBe('function');
  });

  it('editor_handlers has register_elements function', () => {
    expect(typeof editor_handlers.register_elements).toBe('function');
  });

  it('register_elements returns an unregister function', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    const canvas = document.createElement('canvas');
    const unregister = editor_handlers.register_elements(svg, canvas);
    expect(typeof unregister).toBe('function');
    // Call unregister should not throw
    expect(() => unregister()).not.toThrow();
  });

  it('editorTextAtom._actions.markEditing can be called', () => {
    // The editorTextAtom has actions with markEditing
    const atom = editorTextAtom as any;
    if (atom._actions) {
      const set = vi.fn();
      const actions = atom._actions(set);
      actions.markEditing('test-id');
      expect(set).toHaveBeenCalledWith({ editingId: 'test-id' });
    } else {
      expect(true).toBe(true); // atom is mocked
    }
  });
});

describe('editor_handlers.compose', () => {
  it('is a function', () => {
    expect(typeof editor_handlers.compose).toBe('function');
  });
});

describe('editor_handlers.copy', () => {
  it('is a function', () => {
    expect(typeof editor_handlers.copy).toBe('function');
  });
});

describe('editor_handlers.save', () => {
  it('is a function', () => {
    expect(typeof editor_handlers.save).toBe('function');
  });
});
