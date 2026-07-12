/**
 * Window-fallback coverage for src/preload/main.ts
 *
 * The main coverage suite imports main.ts with `process.contextIsolated = true`,
 * so it only ever exercises the `contextBridge.exposeInMainWorld` branch.
 *
 * This file covers the OTHER branch (line 3239): when context isolation is
 * disabled, main.ts assigns the API to `(window as any).electronAPI`. We set
 * `contextIsolated = false` and provide a `window` global BEFORE importing the
 * module under test.
 */

const { mockExposeInMainWorld, fakeWindow } = vi.hoisted(() => {
  // Disable context isolation BEFORE main.ts is evaluated so it takes the
  // window-fallback path instead of the contextBridge path.
  (process as any).contextIsolated = false;
  const fakeWindow: Record<string, unknown> = {};
  (globalThis as any).window = fakeWindow;
  return {
    mockExposeInMainWorld: vi.fn(),
    fakeWindow,
  };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  webUtils: {
    getPathForFile: vi.fn().mockReturnValue('/some/path'),
  },
}));

vi.mock('../screenshot/invoke', () => ({ default: vi.fn() }));
vi.mock('../scheduler/invoke', () => ({ default: vi.fn() }));
vi.mock('../memex/api', () => ({
  createMemexPreloadApi: vi.fn().mockReturnValue({ invoke: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));
vi.mock('../externalAgent/invoke', () => ({ default: vi.fn() }));
vi.mock('../buddy/invoke', () => ({ default: vi.fn() }));
import { electronAPI } from '../main';

describe('preload main.ts – window fallback (contextIsolated=false)', () => {
  it('assigns electronAPI to window when context isolation is disabled (line 3239)', () => {
    // The contextBridge path must NOT have been taken.
    expect(mockExposeInMainWorld).not.toHaveBeenCalled();
    // The window-fallback path assigned the exported API onto window.
    expect((fakeWindow as any).electronAPI).toBe(electronAPI);
  });
});
