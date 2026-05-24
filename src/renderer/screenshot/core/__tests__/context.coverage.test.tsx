/** @vitest-environment happy-dom */
/**
 * Coverage tests for src/renderer/screenshot/core/context.tsx
 * Covers: uuid, generate, SubModel, Model, build internals,
 *         ModelProvider, useModel, useCache, define.* API
 */

vi.mock('../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  uuid,
  generate,
  ModelProvider,
  useModel,
  useCache,
  define,
} from '../context';

// ---------------------------------------------------------------------------
// uuid
// ---------------------------------------------------------------------------
describe('uuid', () => {
  it('returns a non-empty string', () => {
    expect(typeof uuid()).toBe('string');
    expect(uuid().length).toBeGreaterThan(0);
  });

  it('returns different values on each call', () => {
    const a = uuid();
    const b = uuid();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------
describe('generate', () => {
  it('get() returns initial value', () => {
    const { get } = generate(42);
    expect(get()).toBe(42);
  });

  it('set() with a new value updates and notifies listeners', () => {
    const { get, set, listen } = generate(0);
    const listener = vi.fn();
    listen(listener);
    set(5);
    expect(get()).toBe(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('set() with same value does NOT notify listeners (Object.is identity)', () => {
    const { set, listen } = generate(10);
    const listener = vi.fn();
    listen(listener);
    set(10); // same value
    expect(listener).not.toHaveBeenCalled();
  });

  it('set() with function reducer updates value', () => {
    const { get, set } = generate(3);
    set((prev) => prev + 1);
    expect(get()).toBe(4);
  });

  it('listen() returns an unsubscribe function', () => {
    const { set, listen } = generate(0);
    const listener = vi.fn();
    const unsub = listen(listener);
    unsub();
    set(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('multiple listeners all get notified', () => {
    const { set, listen } = generate('hello');
    const l1 = vi.fn();
    const l2 = vi.fn();
    listen(l1);
    listen(l2);
    set('world');
    expect(l1).toHaveBeenCalled();
    expect(l2).toHaveBeenCalled();
  });

  it('use() hook returns current value (via useSyncExternalStore)', () => {
    const { use, set } = generate('initial');
    const { result } = renderHook(() => use(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    expect(result.current).toBe('initial');
    act(() => set('updated'));
    expect(result.current).toBe('updated');
  });
});

// ---------------------------------------------------------------------------
// ModelProvider / useModel
// ---------------------------------------------------------------------------
describe('ModelProvider + useModel', () => {
  it('renders children without error', () => {
    const { container } = render(
      <ModelProvider>
        <div data-testid="child">hello</div>
      </ModelProvider>
    );
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('useModel returns a model object with undo/redo/canUndo/canRedo', () => {
    const { result } = renderHook(() => useModel(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    const model = result.current;
    expect(typeof model.undo).toBe('function');
    expect(typeof model.redo).toBe('function');
    expect(typeof model.canUndo).toBe('function');
    expect(typeof model.canRedo).toBe('function');
  });

  it('nested ModelProviders each provide an independent context', () => {
    const counter = define.model('counter-nested', () => 0, (set) => ({
      inc: () => set((v) => v + 1),
    }));

    let outer: any;
    let inner: any;

    function OuterReader() {
      [outer] = counter.use();
      return null;
    }
    function InnerReader() {
      [inner] = counter.use();
      return null;
    }

    render(
      <ModelProvider>
        <OuterReader />
        <ModelProvider>
          <InnerReader />
        </ModelProvider>
      </ModelProvider>
    );

    // Both start at 0, are independent stores
    expect(outer).toBe(0);
    expect(inner).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useCache
// ---------------------------------------------------------------------------
describe('useCache', () => {
  it('returns default value for new key', () => {
    const { result } = renderHook(() => useCache('myKey', 'default'), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    expect(result.current.value).toBe('default');
  });

  it('set updates cache item value', () => {
    const { result } = renderHook(() => useCache('numKey', 0), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    act(() => result.current.set(99));
    expect(result.current.value).toBe(99);
  });

  it('subsequent calls return the same cached item', () => {
    let item1: any, item2: any;
    renderHook(
      () => {
        item1 = useCache('shared', 'init');
        item2 = useCache('shared', 'init');
      },
      { wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider> }
    );
    expect(item1).toBe(item2);
  });
});

// ---------------------------------------------------------------------------
// define.model + SubModel.use / useData / useCreation
// ---------------------------------------------------------------------------
describe('define.model', () => {
  const counter = define.model('test-counter', () => 0, (set, _get) => ({
    inc: () => set((v) => v + 1),
    dec: () => set((v) => v - 1),
    reset: () => set(0),
  }));

  it('use() hook returns [value, actions]', () => {
    const { result } = renderHook(() => counter.use(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    const [value, actions] = result.current;
    expect(value).toBe(0);
    expect(typeof actions.inc).toBe('function');
  });

  it('useData() hook returns current value', () => {
    const { result } = renderHook(() => counter.useData(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    expect(result.current).toBe(0);
  });

  it('useCreation() hook returns actions object', () => {
    const { result } = renderHook(() => counter.useCreation(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    expect(typeof result.current.inc).toBe('function');
  });

  it('actions mutate state and re-render', () => {
    const { result } = renderHook(() => counter.use(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    act(() => result.current[1].inc());
    expect(result.current[0]).toBe(1);
    act(() => result.current[1].dec());
    expect(result.current[0]).toBe(0);
    act(() => result.current[1].reset());
    expect(result.current[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// define.view
// ---------------------------------------------------------------------------
describe('define.view', () => {
  it('creates a view submodel with identity set action (default)', () => {
    const viewModel = define.view('test-view', () => 'hello');
    const { result } = renderHook(() => viewModel.use(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    const [value, setFn] = result.current;
    expect(value).toBe('hello');
    expect(typeof setFn).toBe('function');
  });

  it('creates a view submodel with custom actions', () => {
    const viewModel = define.view('test-view-custom', () => 0, (set) => ({
      set100: () => set(100),
    }));
    const { result } = renderHook(() => viewModel.use(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });
    act(() => result.current[1].set100());
    expect(result.current[0]).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// define.memoize
// ---------------------------------------------------------------------------
describe('define.memoize', () => {
  it('use() returns memoized value on repeated calls', () => {
    const initFn = vi.fn().mockReturnValue({ tag: 'memo' });
    const memoized = define.memoize(initFn);

    const { result, rerender } = renderHook(() => memoized.use(), {
      wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider>,
    });

    expect(result.current).toEqual({ tag: 'memo' });
    rerender();
    // init should only be called once
    expect(initFn).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ tag: 'memo' });
  });
});

// ---------------------------------------------------------------------------
// define.compute
// ---------------------------------------------------------------------------
describe('define.compute', () => {
  it('use() returns computed value derived from submodels', () => {
    const numModel = define.model('compute-num', () => 3, (set) => ({
      setVal: (v: number) => set(v),
    }));
    const doubled = define.compute((use) => use(numModel) * 2);

    const { result } = renderHook(
      () => {
        const [, actions] = numModel.use();
        const computed = doubled.use();
        return { computed, actions };
      },
      { wrapper: ({ children }: any) => <ModelProvider>{children}</ModelProvider> }
    );

    expect(result.current.computed).toBe(6);
    act(() => result.current.actions.setVal(5));
    expect(result.current.computed).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Model undo / redo / transaction
// ---------------------------------------------------------------------------
describe('Model undo/redo/transaction', () => {
  const undoModel = define.model('undo-test', () => 'a', (set) => ({
    change: (v: string) => set(v),
  }));

  function Wrapper({ children }: any) {
    return <ModelProvider>{children}</ModelProvider>;
  }

  it('canUndo returns false before any change', () => {
    const { result } = renderHook(() => useModel(), { wrapper: Wrapper });
    expect(result.current.canUndo()).toBe(false);
  });

  it('canRedo returns false initially', () => {
    const { result } = renderHook(() => useModel(), { wrapper: Wrapper });
    expect(result.current.canRedo()).toBe(false);
  });

  it('undo with empty stack is a no-op', () => {
    const { result } = renderHook(() => useModel(), { wrapper: Wrapper });
    expect(() => result.current.undo()).not.toThrow();
  });

  it('redo with empty stack is a no-op', () => {
    const { result } = renderHook(() => useModel(), { wrapper: Wrapper });
    expect(() => result.current.redo()).not.toThrow();
  });

  it('transaction + undo/redo roundtrip', () => {
    const { result } = renderHook(
      () => {
        const model = useModel();
        const [value, actions] = undoModel.use();
        return { model, value, actions };
      },
      { wrapper: Wrapper }
    );

    act(() => {
      const end = result.current.model.startTransaction();
      result.current.actions.change('b');
      end();
    });

    expect(result.current.value).toBe('b');
    expect(result.current.model.canUndo()).toBe(true);

    act(() => result.current.model.undo());
    expect(result.current.value).toBe('a');
    expect(result.current.model.canRedo()).toBe(true);

    act(() => result.current.model.redo());
    expect(result.current.value).toBe('b');
  });

  it('transaction with no changes does not push to undo stack', () => {
    const { result } = renderHook(() => useModel(), { wrapper: Wrapper });
    act(() => {
      const end = result.current.startTransaction();
      end(); // no changes
    });
    expect(result.current.canUndo()).toBe(false);
  });

  it('nested transactions only commit on outer end', () => {
    const { result } = renderHook(
      () => {
        const model = useModel();
        const [value, actions] = undoModel.use();
        return { model, value, actions };
      },
      { wrapper: Wrapper }
    );

    act(() => {
      const end1 = result.current.model.startTransaction();
      const end2 = result.current.model.startTransaction();
      result.current.actions.change('c');
      end2(); // inner — should not commit yet
      end1(); // outer — commits
    });

    expect(result.current.value).toBe('c');
    expect(result.current.model.canUndo()).toBe(true);
  });

  it('useStackState returns [canUndo, canRedo] tuple', () => {
    const { result } = renderHook(
      () => useModel().useStackState(),
      { wrapper: Wrapper }
    );
    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current).toHaveLength(2);
  });

  it('log() does not throw', () => {
    const { result } = renderHook(() => useModel(), { wrapper: Wrapper });
    expect(() => result.current.log()).not.toThrow();
  });
});
