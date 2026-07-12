/**
 * @vitest-environment happy-dom
 *
 * Tests for embeddedBrowser.atom.ts — the per-session browser panel state
 * machine (EmbeddedBrowserAtom) and the isBrowserOpenFor read helper.
 *
 * Strategy: build an isolated per-test store using the UNIQ BUILD symbol trick
 * (same as chat-side.atom.test.ts). The atom calls into embeddedBrowserApi
 * (mocked) and, for mutual-exclusion, into the three singleton sidepane atoms
 * from chat-side.atom (resolved live through the same store).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks (before imports) ────────────────────────────────────────────────────

// The atom drives the native view through this IPC facade; stub every method.
// vi.hoisted lets the vi.mock factory (hoisted to top) reference this object.
const apiMock = vi.hoisted(() => ({
  open: vi.fn(),
  navigate: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  setBounds: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  destroyAll: vi.fn(),
}));
vi.mock('@/ipc/embeddedBrowser', () => ({
  embeddedBrowserApi: apiMock,
  embeddedBrowserEvents: { navStateChanged: vi.fn(), panelOpenRequested: vi.fn() },
}));

// chat-side.atom imports InlineFileDescriptor (type-only) from this panel; the
// runtime value is never used, so an empty module is enough.
vi.mock('../../chat/InlineFilePreviewPanel', () => ({}));

// ── imports ────────────────────────────────────────────────────────────────────

import { EmbeddedBrowserAtom, isBrowserOpenFor } from '../embeddedBrowser.atom';
import type { EmbeddedBrowserState } from '../embeddedBrowser.atom';
import {
  WorkspaceExplorerAtom,
  ScheduleSidepaneAtom,
  SubAgentTasksSidepaneAtom,
} from '../../chat/chat-side.atom';

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

const SID = 's1';
const URL_A = 'https://a.test';
const URL_B = 'https://b.test';

// ── isBrowserOpenFor read helper ─────────────────────────────────────────────────

describe('isBrowserOpenFor', () => {
  const base: EmbeddedBrowserState = {
    sessions: { open1: { isOpen: true, url: URL_A, title: '', canGoBack: false, canGoForward: false, isLoading: false } },
    width: undefined,
    resizing: false,
  };

  it('returns false when sessionId is null/undefined', () => {
    expect(isBrowserOpenFor(base, null)).toBe(false);
    expect(isBrowserOpenFor(base, undefined)).toBe(false);
  });

  it('returns false when the session has no entry', () => {
    expect(isBrowserOpenFor(base, 'missing')).toBe(false);
  });

  it('returns true when the session entry is open', () => {
    expect(isBrowserOpenFor(base, 'open1')).toBe(true);
  });

  it('returns false when the session entry exists but is closed', () => {
    const closed: EmbeddedBrowserState = {
      ...base,
      sessions: { c: { ...base.sessions.open1, isOpen: false } },
    };
    expect(isBrowserOpenFor(closed, 'c')).toBe(false);
  });
});

// ── open / navigate / close ──────────────────────────────────────────────────────

describe('EmbeddedBrowserAtom — open / navigate / close', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
  });

  it('open marks the session open+loading and calls the IPC open', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);
    const session = s.get().sessions[SID];
    expect(session.isOpen).toBe(true);
    expect(session.url).toBe(URL_A);
    expect(session.isLoading).toBe(true);
    expect(apiMock.open).toHaveBeenCalledWith(SID, URL_A);
  });

  it('closeAllAndDestroy clears all sessions and destroys main-process views', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);
    s.actions.open('s2', URL_B);

    s.actions.closeAllAndDestroy();

    expect(s.get().sessions).toEqual({});
    expect(s.get().resizing).toBe(false);
    expect(apiMock.destroyAll).toHaveBeenCalledTimes(1);
  });

  it('open closes the three singleton sidepanes (mutual exclusion)', () => {
    const ws = query(WorkspaceExplorerAtom);
    const schedule = query(ScheduleSidepaneAtom);
    const subAgent = query(SubAgentTasksSidepaneAtom);
    ws.actions.setVisible(true);
    schedule.actions.show();
    subAgent.actions.show();

    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);

    expect(ws.get().visible).toBe(false);
    expect(schedule.get()).toBe(false);
    expect(subAgent.get().visible).toBe(false);
  });

  it('navigate updates the url+loading and calls the IPC navigate', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);
    s.actions.navigate(SID, URL_B);
    expect(s.get().sessions[SID].url).toBe(URL_B);
    expect(s.get().sessions[SID].isLoading).toBe(true);
    expect(apiMock.navigate).toHaveBeenCalledWith(SID, URL_B);
  });

  it('navigate on an unseen session creates the entry from the zero session', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.navigate('fresh', URL_B);
    expect(s.get().sessions.fresh.url).toBe(URL_B);
    expect(s.get().sessions.fresh.title).toBe('');
  });

  it('close marks the session closed without touching IPC', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);
    s.actions.close(SID);
    expect(s.get().sessions[SID].isOpen).toBe(false);
  });
});

// ── toggle (three paths) ─────────────────────────────────────────────────────────

describe('EmbeddedBrowserAtom — toggle', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
  });

  it('toggling an open session closes it', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);
    s.actions.toggle(SID);
    expect(s.get().sessions[SID].isOpen).toBe(false);
    // close() path must NOT re-open via IPC
    expect(apiMock.open).toHaveBeenCalledTimes(1); // only the initial open
  });

  it('toggling a session with a remembered url just re-shows it (no re-navigate)', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);
    s.actions.close(SID);
    apiMock.open.mockClear();
    s.actions.toggle(SID);
    expect(s.get().sessions[SID].isOpen).toBe(true);
    expect(apiMock.open).not.toHaveBeenCalled(); // reused, not re-opened
  });

  it('toggling a never-browsed session loads the default homepage', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.toggle('brandNew');
    expect(s.get().sessions.brandNew.isOpen).toBe(true);
    expect(apiMock.open).toHaveBeenCalledWith('brandNew', 'https://www.bing.com');
  });

  it('toggling open closes the singleton sidepanes', () => {
    const schedule = query(ScheduleSidepaneAtom);
    schedule.actions.show();
    const s = query(EmbeddedBrowserAtom);
    s.actions.toggle('brandNew');
    expect(schedule.get()).toBe(false);
  });
});

// ── nav buttons ──────────────────────────────────────────────────────────────────

describe('EmbeddedBrowserAtom — nav buttons', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
  });

  it('goBack / goForward forward straight to IPC', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.goBack(SID);
    s.actions.goForward(SID);
    expect(apiMock.goBack).toHaveBeenCalledWith(SID);
    expect(apiMock.goForward).toHaveBeenCalledWith(SID);
  });

  it('reload optimistically sets loading and calls IPC reload', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.reload(SID);
    expect(s.get().sessions[SID].isLoading).toBe(true);
    expect(apiMock.reload).toHaveBeenCalledWith(SID);
  });

  it('stop optimistically clears loading and calls IPC stop', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A); // sets loading true
    s.actions.stop(SID);
    expect(s.get().sessions[SID].isLoading).toBe(false);
    expect(apiMock.stop).toHaveBeenCalledWith(SID);
  });
});

// ── applyNavState ────────────────────────────────────────────────────────────────

describe('EmbeddedBrowserAtom — applyNavState', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
  });

  it('merges nav state into an existing session', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.open(SID, URL_A);
    s.actions.applyNavState(SID, { title: 'Hello', canGoBack: true, isLoading: false });
    expect(s.get().sessions[SID].title).toBe('Hello');
    expect(s.get().sessions[SID].canGoBack).toBe(true);
    expect(s.get().sessions[SID].isLoading).toBe(false);
  });

  it('ignores nav state for a session with no entry', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.applyNavState('ghost', { title: 'X' });
    expect(s.get().sessions.ghost).toBeUndefined();
  });
});

// ── revealForAutomation ──────────────────────────────────────────────────────────

describe('EmbeddedBrowserAtom — revealForAutomation', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
  });

  it('reveals the panel and mirrors the url WITHOUT calling IPC open', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.revealForAutomation(SID, URL_A);
    expect(s.get().sessions[SID].isOpen).toBe(true);
    expect(s.get().sessions[SID].url).toBe(URL_A);
    expect(apiMock.open).not.toHaveBeenCalled();
  });

  it('no-ops when already open at the same url', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.revealForAutomation(SID, URL_A);
    const before = s.get().sessions[SID];
    s.actions.revealForAutomation(SID, URL_A); // same url, already open → early return
    expect(s.get().sessions[SID]).toBe(before); // unchanged reference
  });

  it('reveals without a url (keeps any prior url) when url is empty', () => {
    const s = query(EmbeddedBrowserAtom);
    s.actions.revealForAutomation(SID, '');
    expect(s.get().sessions[SID].isOpen).toBe(true);
    expect(s.get().sessions[SID].url).toBe('');
  });

  it('closes the singleton sidepanes when revealing', () => {
    const ws = query(WorkspaceExplorerAtom);
    ws.actions.setVisible(true);
    const s = query(EmbeddedBrowserAtom);
    s.actions.revealForAutomation(SID, URL_A);
    expect(ws.get().visible).toBe(false);
  });
});

// ── startResize ──────────────────────────────────────────────────────────────────

describe('EmbeddedBrowserAtom — startResize', () => {
  let query: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
  });

  it('does nothing when the divider has no parent element', () => {
    const s = query(EmbeddedBrowserAtom);
    const handle = document.createElement('div');
    const ev = { preventDefault: vi.fn(), currentTarget: handle, clientX: 100 } as unknown as React.MouseEvent;
    s.actions.startResize(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(s.get().resizing).toBe(false);
  });

  it('clamps width on drag and clears resizing on mouseup', () => {
    const s = query(EmbeddedBrowserAtom);

    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'getBoundingClientRect', { value: () => ({ width: 1000 }) });
    const handle = document.createElement('div');
    Object.defineProperty(handle, 'parentElement', { value: wrapper });

    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const ev = { preventDefault: vi.fn(), currentTarget: handle, clientX: 600 } as unknown as React.MouseEvent;
    s.actions.startResize(ev);
    expect(document.body.style.cursor).toBe('col-resize');

    // Drag far LEFT → width grows but clamps to MAX (60% of 1000 = 600).
    const move = addSpy.mock.calls.find((c) => c[0] === 'mousemove')?.[1] as EventListener;
    move?.(new MouseEvent('mousemove', { clientX: 0 }));
    expect(s.get().resizing).toBe(true);
    expect(s.get().width).toBe(600);

    // Drag far RIGHT → width clamps to MIN (30% of 1000 = 300).
    move?.(new MouseEvent('mousemove', { clientX: 5000 }));
    expect(s.get().width).toBe(300);

    const up = addSpy.mock.calls.find((c) => c[0] === 'mouseup')?.[1] as EventListener;
    up?.(new MouseEvent('mouseup'));
    expect(s.get().resizing).toBe(false);
    expect(document.body.style.cursor).toBe('');
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('uses the existing width as the drag start when one is already set', () => {
    const s = query(EmbeddedBrowserAtom);
    s.change?.({ ...s.get(), width: 450 });

    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'getBoundingClientRect', { value: () => ({ width: 1000 }) });
    const handle = document.createElement('div');
    Object.defineProperty(handle, 'parentElement', { value: wrapper });
    const addSpy = vi.spyOn(document, 'addEventListener');

    const ev = { preventDefault: vi.fn(), currentTarget: handle, clientX: 500 } as unknown as React.MouseEvent;
    s.actions.startResize(ev);

    const move = addSpy.mock.calls.find((c) => c[0] === 'mousemove')?.[1] as EventListener;
    // Small drag of +50 from startWidth 450 → 500 (within the 300..600 clamp).
    move?.(new MouseEvent('mousemove', { clientX: 450 }));
    expect(s.get().width).toBe(500);

    const up = addSpy.mock.calls.find((c) => c[0] === 'mouseup')?.[1] as EventListener;
    up?.(new MouseEvent('mouseup'));
    addSpy.mockRestore();
  });
});
