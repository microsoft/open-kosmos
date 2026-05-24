/**
 * @vitest-environment happy-dom
 *
 * Tests for chat-side.atom.ts — WorkspaceExplorerAtom, ScheduleSidepaneAtom, InlinePreviewAtom
 *
 * Strategy: build an isolated per-test store using the UNIQ BUILD symbol trick.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks (before imports) ────────────────────────────────────────────────────

vi.mock('../InlineFilePreviewPanel', () => ({
  // InlineFileDescriptor is a type-only export, no runtime value needed
}));

// ── imports ────────────────────────────────────────────────────────────────────

import {
  WorkspaceExplorerAtom,
  ScheduleSidepaneAtom,
  InlinePreviewAtom,
} from '../chat-side.atom';

// ── store builder ──────────────────────────────────────────────────────────────
function buildStore() {
  const map: Record<string, any> = {};
  function query(atom: any): any {
    const key: string = atom.key;
    if (map[key]) return map[key];
    const ownSymbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(atom));
    const uniqSym = ownSymbols.find((s) => s.toString().includes('BUILD'));
    if (!uniqSym) throw new Error('Cannot find UNIQ BUILD symbol on atom');
    map[key] = (atom as any)[uniqSym](query);
    return map[key];
  }
  return query;
}

// ── WorkspaceExplorerAtom ──────────────────────────────────────────────────────

describe('WorkspaceExplorerAtom — initial state', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
  });

  it('starts with visible=false', () => {
    const s = query(WorkspaceExplorerAtom);
    expect(s.get().visible).toBe(false);
  });

  it('starts with no reveal', () => {
    const s = query(WorkspaceExplorerAtom);
    expect(s.get().reveal).toBeUndefined();
  });
});

describe('WorkspaceExplorerAtom — setVisible', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('setVisible(true) makes visible=true', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.setVisible(true);
    expect(s.get().visible).toBe(true);
  });

  it('setVisible(false) makes visible=false', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.setVisible(true);
    s.actions.setVisible(false);
    expect(s.get().visible).toBe(false);
  });
});

describe('WorkspaceExplorerAtom — setReveal / cancelReveal', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('setReveal stores the path and a nonce', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.setReveal('/some/path/file.ts');
    const { reveal } = s.get();
    expect(reveal?.path).toBe('/some/path/file.ts');
    expect(typeof reveal?.nonce).toBe('number');
  });

  it('cancelReveal clears the reveal', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.setReveal('/some/path');
    s.actions.cancelReveal();
    expect(s.get().reveal).toBeUndefined();
  });
});

describe('WorkspaceExplorerAtom — effectiveToggle', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('toggles visible from false to true', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.effectiveToggle();
    expect(s.get().visible).toBe(true);
  });

  it('toggles visible from true to false', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.setVisible(true);
    s.actions.effectiveToggle();
    expect(s.get().visible).toBe(false);
  });

  it('cancels InlinePreview and hides ScheduleSidepane when toggling', () => {
    const inline = query(InlinePreviewAtom);
    const schedule = query(ScheduleSidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);

    // Open inline preview and schedule pane first
    inline.actions.open({ name: 'file.txt', url: 'file:///file.txt' });
    schedule.actions.show();

    ws.actions.effectiveToggle();

    expect(inline.get()).toBeNull();
    expect(schedule.get()).toBe(false);
  });
});

describe('WorkspaceExplorerAtom — effectiveReveal', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('sets visible=true and stores path', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.effectiveReveal('/project/src/index.ts');
    expect(s.get().visible).toBe(true);
    expect(s.get().reveal?.path).toBe('/project/src/index.ts');
  });

  it('hides ScheduleSidepane when revealing', () => {
    const schedule = query(ScheduleSidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);

    schedule.actions.show();
    expect(schedule.get()).toBe(true);

    ws.actions.effectiveReveal('/some/file.ts');
    expect(schedule.get()).toBe(false);
  });
});

// ── ScheduleSidepaneAtom ───────────────────────────────────────────────────────

describe('ScheduleSidepaneAtom — basic show/hide', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('starts as false', () => {
    const s = query(ScheduleSidepaneAtom);
    expect(s.get()).toBe(false);
  });

  it('show() sets to true', () => {
    const s = query(ScheduleSidepaneAtom);
    s.actions.show();
    expect(s.get()).toBe(true);
  });

  it('hide() sets to false', () => {
    const s = query(ScheduleSidepaneAtom);
    s.actions.show();
    s.actions.hide();
    expect(s.get()).toBe(false);
  });
});

describe('ScheduleSidepaneAtom — effectiveShow', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('shows schedule pane and hides workspace explorer', () => {
    const ws = query(WorkspaceExplorerAtom);
    const schedule = query(ScheduleSidepaneAtom);

    ws.actions.setVisible(true);
    schedule.actions.effectiveShow();

    expect(schedule.get()).toBe(true);
    expect(ws.get().visible).toBe(false);
  });
});

describe('ScheduleSidepaneAtom — effectiveToggle', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('toggles from false to true', () => {
    const s = query(ScheduleSidepaneAtom);
    s.actions.effectiveToggle();
    expect(s.get()).toBe(true);
  });

  it('toggles from true to false', () => {
    const s = query(ScheduleSidepaneAtom);
    s.actions.show();
    s.actions.effectiveToggle();
    expect(s.get()).toBe(false);
  });

  it('hides workspace explorer and cancels inline preview when toggling', () => {
    const ws = query(WorkspaceExplorerAtom);
    const inline = query(InlinePreviewAtom);
    const schedule = query(ScheduleSidepaneAtom);

    ws.actions.setVisible(true);
    inline.actions.open({ name: 'x.txt', url: 'file:///x.txt' });

    schedule.actions.effectiveToggle();

    expect(ws.get().visible).toBe(false);
    expect(inline.get()).toBeNull();
  });
});

// ── InlinePreviewAtom ─────────────────────────────────────────────────────────

describe('InlinePreviewAtom — initial state', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('starts as null', () => {
    const s = query(InlinePreviewAtom);
    expect(s.get()).toBeNull();
  });
});

describe('InlinePreviewAtom — open', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('open() sets the file and isDirty=false when no current preview', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'file.md', url: 'file:///file.md' });
    expect(s.get()?.file.name).toBe('file.md');
    expect(s.get()?.isDirty).toBe(false);
  });

  it('toggling same file (not dirty) closes the preview', () => {
    const s = query(InlinePreviewAtom);
    const file = { name: 'file.md', url: 'file:///file.md' };
    s.actions.open(file);
    s.actions.open(file); // toggle off
    expect(s.get()).toBeNull();
  });

  it('toggling same dirty file with confirm=true closes it', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => true });
    const s = query(InlinePreviewAtom);
    const file = { name: 'file.md', url: 'file:///file.md' };
    s.actions.open(file);
    s.actions.markDirty(true);
    s.actions.open(file); // try to toggle same dirty file
    expect(s.get()).toBeNull();
  });

  it('toggling same dirty file with confirm=false keeps it open', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => false });
    const s = query(InlinePreviewAtom);
    const file = { name: 'file.md', url: 'file:///file.md' };
    s.actions.open(file);
    s.actions.markDirty(true);
    s.actions.open(file);
    expect(s.get()?.file.name).toBe('file.md');
  });

  it('switching to a different file (not dirty) updates the file', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    s.actions.open({ name: 'b.md', url: 'file:///b.md' });
    expect(s.get()?.file.name).toBe('b.md');
  });

  it('switching to a different file when dirty with confirm=true switches', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => true });
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    s.actions.markDirty(true);
    s.actions.open({ name: 'b.md', url: 'file:///b.md' });
    expect(s.get()?.file.name).toBe('b.md');
    expect(s.get()?.isDirty).toBe(false);
  });

  it('switching to a different file when dirty with confirm=false does not switch', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => false });
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    s.actions.markDirty(true);
    s.actions.open({ name: 'b.md', url: 'file:///b.md' });
    expect(s.get()?.file.name).toBe('a.md');
  });

  it('preserves width when switching files', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    // Simulate a width being set
    s.change({ file: { name: 'a.md', url: 'file:///a.md' }, isDirty: false, width: 500 });
    s.actions.open({ name: 'b.md', url: 'file:///b.md' });
    expect(s.get()?.width).toBe(500);
  });
});

describe('InlinePreviewAtom — cancel', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('cancel() sets state to null', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    s.actions.cancel();
    expect(s.get()).toBeNull();
  });
});

describe('InlinePreviewAtom — markDirty', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('markDirty(true) sets isDirty=true', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    s.actions.markDirty(true);
    expect(s.get()?.isDirty).toBe(true);
  });

  it('markDirty(false) sets isDirty=false', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    s.actions.markDirty(true);
    s.actions.markDirty(false);
    expect(s.get()?.isDirty).toBe(false);
  });

  it('markDirty does nothing when state is null', () => {
    const s = query(InlinePreviewAtom);
    expect(() => s.actions.markDirty(true)).not.toThrow();
    expect(s.get()).toBeNull();
  });

  it('markDirty does nothing when isDirty is already the same value', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });
    // isDirty is already false
    s.actions.markDirty(false);
    expect(s.get()?.isDirty).toBe(false);
  });
});

describe('InlinePreviewAtom — resize', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('resize does nothing when state is null', () => {
    const s = query(InlinePreviewAtom);
    const fakeEvent = {
      preventDefault: vi.fn(),
      currentTarget: document.createElement('div'),
      clientX: 100,
    } as unknown as React.MouseEvent;
    expect(() => s.actions.resize(fakeEvent)).not.toThrow();
  });

  it('resize sets up mouse event listeners when state is open', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });

    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      value: () => ({ width: 1000 }),
    });
    const handle = document.createElement('div');
    Object.defineProperty(handle, 'parentElement', { value: wrapper });

    const addEventSpy = vi.spyOn(document, 'addEventListener');
    const removeEventSpy = vi.spyOn(document, 'removeEventListener');

    const fakeEvent = {
      preventDefault: vi.fn(),
      currentTarget: handle,
      clientX: 400,
    } as unknown as React.MouseEvent;

    s.actions.resize(fakeEvent);

    expect(addEventSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(addEventSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

    // Simulate mousemove
    const moveHandler = addEventSpy.mock.calls.find(c => c[0] === 'mousemove')?.[1] as EventListener;
    moveHandler?.(new MouseEvent('mousemove', { clientX: 350 }));
    expect(s.get()?.width).toBeDefined();

    // Simulate mouseup
    const upHandler = addEventSpy.mock.calls.find(c => c[0] === 'mouseup')?.[1] as EventListener;
    upHandler?.(new MouseEvent('mouseup'));
    expect(removeEventSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it('resize does nothing when parentElement is missing', () => {
    const s = query(InlinePreviewAtom);
    s.actions.open({ name: 'a.md', url: 'file:///a.md' });

    const handle = document.createElement('div');
    // no parentElement (it's not attached to DOM)

    const fakeEvent = {
      preventDefault: vi.fn(),
      currentTarget: handle,
      clientX: 400,
    } as unknown as React.MouseEvent;

    // Should not throw and width should remain undefined
    s.actions.resize(fakeEvent);
    expect(s.get()?.width).toBeUndefined();
  });
});
