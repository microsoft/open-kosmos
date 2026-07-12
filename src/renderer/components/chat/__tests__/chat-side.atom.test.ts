/**
 * @vitest-environment happy-dom
 *
 * Tests for chat-side.atom.ts — WorkspaceExplorerAtom (explorer + preview modes),
 * ScheduleSidepaneAtom, SubAgentTasksSidepaneAtom.
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
  SubAgentTasksSidepaneAtom,
  MemexMemorySidepaneAtom,
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

const fileA = { name: 'a.md', url: 'file:///a.md' };
const fileB = { name: 'b.md', url: 'file:///b.md' };

// ── WorkspaceExplorerAtom — basic state ──────────────────────────────────────────

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

  it('starts in explorer mode with no preview', () => {
    const s = query(WorkspaceExplorerAtom);
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
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

  it('setVisible(false) makes visible=false and resets to explorer mode', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.setVisible(false);
    expect(s.get().visible).toBe(false);
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
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

  it('always lands in explorer mode and clears any preview', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat'); // visible + preview mode
    s.actions.effectiveToggle();          // → visible=false, explorer
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
  });

  it('hides ScheduleSidepane and SubAgentTasks when toggling', () => {
    const schedule = query(ScheduleSidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);

    schedule.actions.show();
    subAgent.actions.show();

    ws.actions.effectiveToggle();

    expect(schedule.get()).toBe(false);
    expect(subAgent.get().visible).toBe(false);
  });
});

describe('WorkspaceExplorerAtom — effectiveReveal', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('sets visible=true, explorer mode, and stores path', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.effectiveReveal('/project/src/index.ts');
    expect(s.get().visible).toBe(true);
    expect(s.get().mode).toBe('explorer');
    expect(s.get().reveal?.path).toBe('/project/src/index.ts');
  });

  it('clears any active preview when revealing', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.effectiveReveal('/some/file.ts');
    expect(s.get().preview).toBeUndefined();
    expect(s.get().mode).toBe('explorer');
  });

  it('hides ScheduleSidepane, SubAgentTasks, and Memex when revealing', () => {
    const schedule = query(ScheduleSidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);
    const memex = query(MemexMemorySidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);

    // Seed the siblings open directly: their show() actions mutually exclude each
    // other, so chaining show() calls here would pre-close some of them.
    schedule.change(true);
    subAgent.change({ visible: true, selectedTaskId: null });
    memex.change({ visible: true, selectedSlug: null });
    expect(schedule.get()).toBe(true);

    ws.actions.effectiveReveal('/some/file.ts');
    expect(schedule.get()).toBe(false);
    expect(subAgent.get().visible).toBe(false);
    expect(memex.get().visible).toBe(false);
  });
});

// ── WorkspaceExplorerAtom — preview mode ─────────────────────────────────────────

describe('WorkspaceExplorerAtom — openPreview', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('opens a file in preview mode and makes the sidepane visible', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'tree');
    expect(s.get().visible).toBe(true);
    expect(s.get().mode).toBe('preview');
    expect(s.get().preview?.file.name).toBe('a.md');
    expect(s.get().preview?.origin).toBe('tree');
    expect(s.get().preview?.isDirty).toBe(false);
  });

  it('re-opening the same tree-origin file toggles back to explorer', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'tree');
    s.actions.openPreview(fileA, 'tree');
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
    expect(s.get().visible).toBe(true); // tree-origin keeps the sidepane open
  });

  it('re-opening the same chat-origin file closes the sidepane', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.openPreview(fileA, 'chat');
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
    expect(s.get().visible).toBe(false); // chat-origin destroys the sidepane
  });

  it('re-opening the same dirty file with confirm=false keeps the preview (discard guard)', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => false });
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'tree');
    s.actions.markPreviewDirty(true);
    s.actions.openPreview(fileA, 'tree'); // same file, dirty, confirm denied → early return
    expect(s.get().mode).toBe('preview');
    expect(s.get().preview?.file.name).toBe('a.md');
  });

  it('re-opening the same dirty file with confirm=true toggles it off', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => true });
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'tree');
    s.actions.markPreviewDirty(true);
    s.actions.openPreview(fileA, 'tree'); // same file, dirty, confirm granted → toggle off
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
  });

  it('switching to a different file (not dirty) updates the file', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.openPreview(fileB, 'chat');
    expect(s.get().preview?.file.name).toBe('b.md');
  });

  it('switching to a different file when dirty with confirm=true switches', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => true });
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.markPreviewDirty(true);
    s.actions.openPreview(fileB, 'chat');
    expect(s.get().preview?.file.name).toBe('b.md');
    expect(s.get().preview?.isDirty).toBe(false);
  });

  it('switching to a different file when dirty with confirm=false does not switch', () => {
    Object.defineProperty(window, 'confirm', { writable: true, configurable: true, value: () => false });
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.markPreviewDirty(true);
    s.actions.openPreview(fileB, 'chat');
    expect(s.get().preview?.file.name).toBe('a.md');
  });

  it('preserves width when switching files', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.change({ visible: true, mode: 'preview', preview: { file: fileA, origin: 'chat', isDirty: false, width: 500 } });
    s.actions.openPreview(fileB, 'chat');
    expect(s.get().preview?.width).toBe(500);
  });

  it('hides ScheduleSidepane and SubAgentTasks when opening a preview', () => {
    const schedule = query(ScheduleSidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);

    schedule.actions.show();
    subAgent.actions.show();

    ws.actions.openPreview(fileA, 'chat');

    expect(schedule.get()).toBe(false);
    expect(subAgent.get().visible).toBe(false);
  });
});

describe('WorkspaceExplorerAtom — backToExplorer', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('returns to explorer mode and clears preview, keeping the sidepane open', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'tree');
    s.actions.backToExplorer();
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
    expect(s.get().visible).toBe(true);
  });
});

describe('WorkspaceExplorerAtom — markPreviewDirty', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('markPreviewDirty(true) sets preview.isDirty=true', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.markPreviewDirty(true);
    expect(s.get().preview?.isDirty).toBe(true);
  });

  it('markPreviewDirty does nothing when there is no preview', () => {
    const s = query(WorkspaceExplorerAtom);
    expect(() => s.actions.markPreviewDirty(true)).not.toThrow();
    expect(s.get().preview).toBeUndefined();
  });

  it('markPreviewDirty is a no-op when value is unchanged', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.markPreviewDirty(false);
    expect(s.get().preview?.isDirty).toBe(false);
  });
});

describe('WorkspaceExplorerAtom — resizePreview', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('does nothing when there is no preview', () => {
    const s = query(WorkspaceExplorerAtom);
    const fakeEvent = {
      preventDefault: vi.fn(),
      currentTarget: document.createElement('div'),
      clientX: 100,
    } as unknown as React.MouseEvent;
    expect(() => s.actions.resizePreview(fakeEvent)).not.toThrow();
  });

  it('sets up mouse listeners and updates preview.width while dragging', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');

    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'getBoundingClientRect', { value: () => ({ width: 1000 }) });
    const handle = document.createElement('div');
    Object.defineProperty(handle, 'parentElement', { value: wrapper });

    const addEventSpy = vi.spyOn(document, 'addEventListener');
    const removeEventSpy = vi.spyOn(document, 'removeEventListener');

    const fakeEvent = {
      preventDefault: vi.fn(),
      currentTarget: handle,
      clientX: 400,
    } as unknown as React.MouseEvent;

    s.actions.resizePreview(fakeEvent);

    expect(addEventSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(addEventSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

    const moveHandler = addEventSpy.mock.calls.find(c => c[0] === 'mousemove')?.[1] as EventListener;
    moveHandler?.(new MouseEvent('mousemove', { clientX: 350 }));
    expect(s.get().preview?.width).toBeDefined();

    const upHandler = addEventSpy.mock.calls.find(c => c[0] === 'mouseup')?.[1] as EventListener;
    upHandler?.(new MouseEvent('mouseup'));
    expect(removeEventSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it('does nothing when parentElement is missing', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');

    const handle = document.createElement('div');
    const fakeEvent = {
      preventDefault: vi.fn(),
      currentTarget: handle,
      clientX: 400,
    } as unknown as React.MouseEvent;

    s.actions.resizePreview(fakeEvent);
    expect(s.get().preview?.width).toBeUndefined();
  });

  it('mousemove after the preview is destroyed mid-drag is a no-op', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');

    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'getBoundingClientRect', { value: () => ({ width: 1000 }) });
    const handle = document.createElement('div');
    Object.defineProperty(handle, 'parentElement', { value: wrapper });

    const addEventSpy = vi.spyOn(document, 'addEventListener');
    const fakeEvent = {
      preventDefault: vi.fn(),
      currentTarget: handle,
      clientX: 400,
    } as unknown as React.MouseEvent;

    s.actions.resizePreview(fakeEvent);
    const moveHandler = addEventSpy.mock.calls.find(c => c[0] === 'mousemove')?.[1] as EventListener;

    // Destroy the preview between mousedown and mousemove → onMouseMove hits the
    // `!cur.preview` guard and returns without writing width.
    s.actions.setVisible(false);
    expect(() => moveHandler?.(new MouseEvent('mousemove', { clientX: 350 }))).not.toThrow();
    expect(s.get().preview).toBeUndefined();

    addEventSpy.mockRestore();
  });
});

describe('WorkspaceExplorerAtom — onSessionSwitch', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('is a no-op in explorer mode', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.setVisible(true);
    s.actions.onSessionSwitch();
    expect(s.get().visible).toBe(true);
    expect(s.get().mode).toBe('explorer');
  });

  it('tree-origin preview falls back to explorer (sidepane stays open)', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'tree');
    s.actions.onSessionSwitch();
    expect(s.get().mode).toBe('explorer');
    expect(s.get().preview).toBeUndefined();
    expect(s.get().visible).toBe(true);
  });

  it('chat-origin preview closes the sidepane', () => {
    const s = query(WorkspaceExplorerAtom);
    s.actions.openPreview(fileA, 'chat');
    s.actions.onSessionSwitch();
    expect(s.get().visible).toBe(false);
    expect(s.get().preview).toBeUndefined();
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

  it('shows schedule pane and hides workspace explorer, SubAgentTasks, and Memex', () => {
    const ws = query(WorkspaceExplorerAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);
    const memex = query(MemexMemorySidepaneAtom);
    const schedule = query(ScheduleSidepaneAtom);

    // Seed the other singletons open directly (their show() would mutually
    // exclude each other), then assert effectiveShow closes all of them.
    ws.actions.setVisible(true);
    subAgent.change({ visible: true, selectedTaskId: null });
    memex.change({ visible: true, selectedSlug: null });

    schedule.actions.effectiveShow();

    expect(schedule.get()).toBe(true);
    expect(ws.get().visible).toBe(false);
    expect(subAgent.get().visible).toBe(false);
    expect(memex.get().visible).toBe(false);
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

  it('hides workspace explorer (including any preview) when toggling', () => {
    const ws = query(WorkspaceExplorerAtom);
    const schedule = query(ScheduleSidepaneAtom);

    ws.actions.openPreview(fileA, 'chat');

    schedule.actions.effectiveToggle();

    expect(ws.get().visible).toBe(false);
    expect(ws.get().preview).toBeUndefined();
  });
});

// ── SubAgentTasksSidepaneAtom ───────────────────────────────────────────────────

describe('SubAgentTasksSidepaneAtom — effectiveToggle', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('hides workspace explorer (including any preview) and schedule when toggling on', () => {
    const ws = query(WorkspaceExplorerAtom);
    const schedule = query(ScheduleSidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);

    ws.actions.openPreview(fileA, 'tree');
    schedule.actions.show();

    subAgent.actions.effectiveToggle();

    expect(subAgent.get().visible).toBe(true);
    expect(ws.get().visible).toBe(false);
    expect(ws.get().preview).toBeUndefined();
    expect(schedule.get()).toBe(false);
  });

  it('selectTask records the selected id; backToList clears it', () => {
    const subAgent = query(SubAgentTasksSidepaneAtom);
    subAgent.actions.selectTask('task-42');
    expect(subAgent.get().selectedTaskId).toBe('task-42');
    subAgent.actions.backToList();
    expect(subAgent.get().selectedTaskId).toBeNull();
  });
});

describe('SubAgentTasksSidepaneAtom — show (mutual exclusion)', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('hides workspace explorer (including any preview), schedule, and memex when shown', () => {
    const ws = query(WorkspaceExplorerAtom);
    const schedule = query(ScheduleSidepaneAtom);
    const memex = query(MemexMemorySidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);

    // Seed the other singletons open (these show()/openPreview calls do not
    // cross-close each other in this order), then assert show() closes them all.
    ws.actions.openPreview(fileA, 'tree');
    schedule.actions.show();
    memex.actions.show();

    subAgent.actions.show();

    expect(subAgent.get().visible).toBe(true);
    expect(ws.get().visible).toBe(false);
    expect(ws.get().preview).toBeUndefined();
    expect(schedule.get()).toBe(false);
    expect(memex.get().visible).toBe(false);
  });
});

// ── MemexMemorySidepaneAtom ────────────────────────────────────────────────────

describe('MemexMemorySidepaneAtom — initial state', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('starts with visible=false', () => {
    const s = query(MemexMemorySidepaneAtom);
    expect(s.get().visible).toBe(false);
  });

  it('starts with selectedSlug=null', () => {
    const s = query(MemexMemorySidepaneAtom);
    expect(s.get().selectedSlug).toBeNull();
  });
});

describe('MemexMemorySidepaneAtom — show / hide', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('show() sets visible=true', () => {
    const s = query(MemexMemorySidepaneAtom);
    s.actions.show();
    expect(s.get().visible).toBe(true);
  });

  it('show() hides Workspace Explorer, Schedule, and SubAgentTasks', () => {
    const memex = query(MemexMemorySidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);
    const schedule = query(ScheduleSidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);

    ws.actions.openPreview(fileA, 'tree');
    schedule.change(true);
    subAgent.change({ visible: true, selectedTaskId: 'task-1' });

    memex.actions.show();

    expect(memex.get().visible).toBe(true);
    expect(ws.get().visible).toBe(false);
    expect(ws.get().mode).toBe('explorer');
    expect(ws.get().preview).toBeUndefined();
    expect(schedule.get()).toBe(false);
    expect(subAgent.get().visible).toBe(false);
    expect(subAgent.get().selectedTaskId).toBeNull();
  });

  it('hide() resets visible=false and clears the selected slug', () => {
    const s = query(MemexMemorySidepaneAtom);
    s.actions.show();
    s.actions.selectCard('alpha-note');
    s.actions.hide();
    expect(s.get().visible).toBe(false);
    expect(s.get().selectedSlug).toBeNull();
  });
});

describe('MemexMemorySidepaneAtom — selectCard / backToList', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('selectCard stores the slug without changing visibility', () => {
    const s = query(MemexMemorySidepaneAtom);
    s.actions.show();
    s.actions.selectCard('beta-card');
    expect(s.get().selectedSlug).toBe('beta-card');
    expect(s.get().visible).toBe(true);
  });

  it('backToList clears the selected slug but keeps the pane open', () => {
    const s = query(MemexMemorySidepaneAtom);
    s.actions.show();
    s.actions.selectCard('beta-card');
    s.actions.backToList();
    expect(s.get().selectedSlug).toBeNull();
    expect(s.get().visible).toBe(true);
  });
});

describe('MemexMemorySidepaneAtom — effectiveToggle', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('toggles visible from false to true', () => {
    const s = query(MemexMemorySidepaneAtom);
    s.actions.effectiveToggle();
    expect(s.get().visible).toBe(true);
  });

  it('toggles visible from true to false and clears the slug', () => {
    const s = query(MemexMemorySidepaneAtom);
    s.actions.show();
    s.actions.selectCard('alpha-note');
    s.actions.effectiveToggle();
    expect(s.get().visible).toBe(false);
    expect(s.get().selectedSlug).toBeNull();
  });

  it('preserves the selected slug when toggling open', () => {
    const s = query(MemexMemorySidepaneAtom);
    // Pre-seed a slug while the pane is closed
    s.actions.selectCard('preserved');
    s.actions.effectiveToggle();
    expect(s.get().visible).toBe(true);
    expect(s.get().selectedSlug).toBe('preserved');
  });

  it('tears down the workspace preview, hides Schedule, WorkspaceExplorer, and SubAgentTasks', () => {
    const memex = query(MemexMemorySidepaneAtom);
    const schedule = query(ScheduleSidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);

    // Open a file preview inside the Workspace Explorer (the former InlinePreview,
    // now a 'preview' mode of the workspace sidepane).
    ws.actions.openPreview({ name: 'x.txt', url: 'file:///x.txt' }, 'chat');
    schedule.actions.show();
    subAgent.actions.show();

    memex.actions.effectiveToggle();

    expect(memex.get().visible).toBe(true);
    expect(ws.get().visible).toBe(false);
    expect(ws.get().mode).toBe('explorer');
    expect(ws.get().preview).toBeUndefined();
    expect(schedule.get()).toBe(false);
    expect(subAgent.get().visible).toBe(false);
  });
});

describe('MemexMemorySidepaneAtom — siblings hide it on their effectiveToggle', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    query = buildStore();
  });

  it('WorkspaceExplorer.effectiveToggle hides the memex pane', () => {
    const memex = query(MemexMemorySidepaneAtom);
    const ws = query(WorkspaceExplorerAtom);

    memex.actions.show();
    memex.actions.selectCard('alpha-note');
    ws.actions.effectiveToggle();

    expect(memex.get().visible).toBe(false);
    expect(memex.get().selectedSlug).toBeNull();
  });

  it('ScheduleSidepane.effectiveToggle hides the memex pane', () => {
    const memex = query(MemexMemorySidepaneAtom);
    const schedule = query(ScheduleSidepaneAtom);

    memex.actions.show();
    schedule.actions.effectiveToggle();

    expect(memex.get().visible).toBe(false);
  });

  it('SubAgentTasks.effectiveToggle hides the memex pane', () => {
    const memex = query(MemexMemorySidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);

    memex.actions.show();
    subAgent.actions.effectiveToggle();

    expect(memex.get().visible).toBe(false);
  });
});
