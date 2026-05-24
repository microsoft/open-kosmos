/**
 * Tests for left-nav atoms.
 *
 * The atom system works outside React — atoms expose get/listen/change/actions
 * via a Query function (store). We replicate that here for an isolated store per test.
 *
 * appDataManager and handleDrag are mocked so we can exercise every branch
 * without IPC or DOM side-effects.
 */

import { vi, describe, beforeEach, it, expect } from 'vitest';

// ── module mocks ─────────────────────────────────────────────────────────────
// Factory bodies must not reference outer variables (hoisting); use module-level
// closures inside the factory instead.

vi.mock('@/lib/userData/appDataManager', () => {
  const cbs: Array<(config: any) => void> = [];
  const updateConfig = vi.fn();
  const subscribe = vi.fn((cb: (config: any) => void) => {
    cbs.push(cb);
    return () => {};
  });
  return {
    appDataManager: { subscribe, updateConfig, __cbs: cbs },
    __updateConfig: updateConfig,
  };
});

vi.mock('@/lib/utils/drag', () => {
  let captured: any = null;
  const handleDrag = vi.fn((_event: any, hooks: any) => { captured = hooks; });
  return { handleDrag, __getCaptured: () => captured, __setCaptured: (v: any) => { captured = v; } };
});

// ── imports (after mocks) ─────────────────────────────────────────────────────

import { appDataManager } from '@/lib/userData/appDataManager';
import * as dragModule from '@/lib/utils/drag';
import { LeftNavSizeAtom, LeftNavCollapsedAtom } from '../left-nav.atom';

// ── store builder ─────────────────────────────────────────────────────────────

/**
 * Builds an isolated atom store instance.  The atom classes expose a method
 * keyed by a module-private Symbol('BUILD').  We locate it via
 * Object.getOwnPropertySymbols on the prototype.
 */
function buildStore() {
  const map: Record<string, any> = {};
  function query(atom: any): any {
    const key: string = atom.key;
    if (map[key]) return map[key];
    const ownSymbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(atom));
    const uniqSym = ownSymbols.find((s) => s.toString().includes('BUILD'));
    if (!uniqSym) throw new Error('Cannot find UNIQ symbol on atom');
    map[key] = (atom as any)[uniqSym](query);
    return map[key];
  }
  return query;
}

// Typed helpers so tests access mocked internals cleanly
const mockedDrag = dragModule as any;
const mockedAppData = appDataManager as any;

function getSubscribeCbs(): Array<(config: any) => void> {
  return mockedAppData.__cbs as Array<(config: any) => void>;
}

function pushConfig(config: any) {
  const cbs = getSubscribeCbs();
  cbs[cbs.length - 1](config);
}

// ── LeftNavSizeAtom ───────────────────────────────────────────────────────────

describe('LeftNavSizeAtom', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    getSubscribeCbs().length = 0;
    mockedDrag.__setCaptured(null);
    query = buildStore();
  });

  it('initialises with default width 288', () => {
    const state = query(LeftNavSizeAtom);
    expect(state.get()).toEqual({ width: 288 });
  });

  it('updates width when appDataManager pushes leftSidebarWidth', () => {
    const state = query(LeftNavSizeAtom);
    pushConfig({ leftSidebarWidth: 350 });
    expect(state.get()).toEqual({ width: 350 });
  });

  it('ignores config push when leftSidebarWidth is undefined', () => {
    const state = query(LeftNavSizeAtom);
    pushConfig({});
    expect(state.get()).toEqual({ width: 288 });
  });

  it('startResize delegates to handleDrag', () => {
    const state = query(LeftNavSizeAtom);
    const fakeEvent = { clientX: 0, clientY: 0 } as any;
    state.actions.startResize(fakeEvent);
    expect(mockedDrag.handleDrag).toHaveBeenCalledWith(
      fakeEvent,
      expect.objectContaining({ onMove: expect.any(Function), onEnd: expect.any(Function) }),
    );
  });

  it('onMove clamps to MIN_WIDTH=288', () => {
    const state = query(LeftNavSizeAtom);
    state.actions.startResize({} as any);
    const hooks = mockedDrag.__getCaptured();
    hooks.onMove({ offset: { x: -9999 }, first: true });
    expect(state.get()).toEqual({ width: 288, resizing: true });
  });

  it('onMove clamps to MAX_WIDTH=400', () => {
    const state = query(LeftNavSizeAtom);
    state.actions.startResize({} as any);
    const hooks = mockedDrag.__getCaptured();
    hooks.onMove({ offset: { x: 9999 }, first: false });
    expect(state.get()).toEqual({ width: 400, resizing: true });
  });

  it('onMove sets an intermediate width within bounds', () => {
    const state = query(LeftNavSizeAtom);
    // Push 320 as initial width
    pushConfig({ leftSidebarWidth: 320 });
    state.actions.startResize({} as any);
    const hooks = mockedDrag.__getCaptured();
    hooks.onMove({ offset: { x: 30 }, first: true });
    expect(state.get()).toEqual({ width: 350, resizing: true });
  });

  it('onEnd sets resizing=false and persists changed width', () => {
    const state = query(LeftNavSizeAtom);
    // Default width = 288; offset +50 → 338 (within bounds)
    state.actions.startResize({} as any);
    const hooks = mockedDrag.__getCaptured();
    hooks.onEnd({ offset: { x: 50 } });
    expect(state.get()).toEqual({ width: 338, resizing: false });
    expect(mockedAppData.updateConfig).toHaveBeenCalledWith({ leftSidebarWidth: 338 });
  });

  it('onEnd does not persist when width is unchanged (offset 0)', () => {
    const state = query(LeftNavSizeAtom);
    state.actions.startResize({} as any);
    const hooks = mockedDrag.__getCaptured();
    hooks.onEnd({ offset: { x: 0 } });
    expect(state.get()).toEqual({ width: 288, resizing: false });
    expect(mockedAppData.updateConfig).not.toHaveBeenCalled();
  });
});

// ── LeftNavCollapsedAtom ──────────────────────────────────────────────────────

describe('LeftNavCollapsedAtom', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    getSubscribeCbs().length = 0;
    query = buildStore();
  });

  it('initialises as false', () => {
    const state = query(LeftNavCollapsedAtom);
    expect(state.get()).toBe(false);
  });

  it('updates when appDataManager pushes leftSidebarCollapsed=true', () => {
    const state = query(LeftNavCollapsedAtom);
    pushConfig({ leftSidebarCollapsed: true });
    expect(state.get()).toBe(true);
  });

  it('ignores config push when leftSidebarCollapsed is undefined', () => {
    const state = query(LeftNavCollapsedAtom);
    pushConfig({});
    expect(state.get()).toBe(false);
  });

  it('toggle flips false → true and persists', () => {
    const state = query(LeftNavCollapsedAtom);
    state.actions.toggle();
    expect(state.get()).toBe(true);
    expect(mockedAppData.updateConfig).toHaveBeenCalledWith({ leftSidebarCollapsed: true });
  });

  it('toggle flips true → false and persists', () => {
    const state = query(LeftNavCollapsedAtom);
    pushConfig({ leftSidebarCollapsed: true });
    state.actions.toggle();
    expect(state.get()).toBe(false);
    expect(mockedAppData.updateConfig).toHaveBeenCalledWith({ leftSidebarCollapsed: false });
  });

  it('change(true) when already true is a no-op', () => {
    const state = query(LeftNavCollapsedAtom);
    pushConfig({ leftSidebarCollapsed: true });
    state.actions.change(true);
    expect(mockedAppData.updateConfig).not.toHaveBeenCalled();
  });

  it('change(false) when already false is a no-op', () => {
    const state = query(LeftNavCollapsedAtom);
    state.actions.change(false);
    expect(mockedAppData.updateConfig).not.toHaveBeenCalled();
  });

  it('change(true) when false sets state and persists', () => {
    const state = query(LeftNavCollapsedAtom);
    state.actions.change(true);
    expect(state.get()).toBe(true);
    expect(mockedAppData.updateConfig).toHaveBeenCalledWith({ leftSidebarCollapsed: true });
  });

  it('change(false) when true sets state and persists', () => {
    const state = query(LeftNavCollapsedAtom);
    pushConfig({ leftSidebarCollapsed: true });
    state.actions.change(false);
    expect(state.get()).toBe(false);
    expect(mockedAppData.updateConfig).toHaveBeenCalledWith({ leftSidebarCollapsed: false });
  });
});
