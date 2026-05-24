/** @vitest-environment happy-dom */
/**
 * Coverage tests for src/renderer/screenshot/core/common/utils/pop-win.ts
 * Covers: popup, formPost, makeWinFeature
 */

// Mock the context uuid so POP_WIN_NAME is deterministic
const { mockUuid } = vi.hoisted(() => ({ mockUuid: vi.fn(() => 'test-pop-win') }));
vi.mock('../../context', () => ({ uuid: mockUuid }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { popup, formPost, makeWinFeature, POP_WIN_NAME } from '../pop-win';

describe('POP_WIN_NAME', () => {
  it('is a non-empty string', () => {
    expect(typeof POP_WIN_NAME).toBe('string');
    expect(POP_WIN_NAME.length).toBeGreaterThan(0);
  });
});

describe('popup()', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy);
  });

  it('calls window.open with url, POP_WIN_NAME and feature string', () => {
    popup('https://example.com', 'width=400,height=600');
    expect(window.open).toHaveBeenCalledWith('https://example.com', POP_WIN_NAME, 'width=400,height=600');
  });
});

describe('makeWinFeature()', () => {
  it('returns a string containing width and height', () => {
    const result = makeWinFeature([0, 0, 100, 100]);
    expect(result).toContain('width=375');
    expect(result).toContain('height=750');
  });

  it('left is clamped to 0 when window is narrow', () => {
    // happy-dom innerWidth defaults to 1024; set it tiny
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 10 });
    const result = makeWinFeature([0, 0, 100, 100]);
    expect(result).toContain('left=0');
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
  });

  it('top is clamped to 0 when window is short', () => {
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 10 });
    const result = makeWinFeature([0, 0, 100, 100]);
    expect(result).toContain('top=0');
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 768 });
  });

  it('left is positive when window is wide enough', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
    const result = makeWinFeature([0, 0, 100, 100]);
    // left = 1200 - 375 - 20 = 805
    expect(result).toContain('left=805');
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
  });
});

describe('formPost()', () => {
  let mockWindowProxy: any;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let submitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWindowProxy = { closed: false };
    vi.spyOn(window, 'open').mockReturnValue(mockWindowProxy);

    // We need to track form submit calls
    // Patch HTMLFormElement.prototype.submit
    submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a form and appends string fields', async () => {
    const promise = formPost('https://upload.example.com', 'width=400', [
      { type: 'string', name: 'token', value: 'abc123' },
    ]);
    // Advance timers to cover the sleep(500) path if needed
    await vi.runAllTimersAsync();
    await promise;
    expect(submitSpy).toHaveBeenCalled();
  });

  it('submits even when singleton window is already open', async () => {
    // Simulate the singleton is already open by calling popup() first
    popup('about:blank', '');
    const promise = formPost('https://upload.example.com', 'width=400', [
      { type: 'string', name: 'x', value: 'y' },
    ]);
    await vi.runAllTimersAsync();
    await promise;
    expect(submitSpy).toHaveBeenCalled();
  });

  it('opens about:blank when singleton is closed and waits 500ms', async () => {
    // Reset singleton to null by calling popup with a closed proxy first,
    // then spy on open for the formPost call.
    // The singleton starts null in a fresh module; since tests share module state,
    // we use the fact that formPost calls window.open when !singleton || singleton.closed.
    // We set a closed proxy as the return value so the re-open path is taken.
    const closedProxy = { closed: true } as WindowProxy;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(closedProxy);

    // Reset the module-level singleton by calling popup with the closed proxy
    // (popup() sets singleton = window.open(...) → closedProxy which is closed)
    popup('about:blank', '');
    openSpy.mockClear(); // clear the popup call

    // Now formPost should see singleton.closed=true and open a new window
    const promise = formPost('https://x.com', 'w=100', []);
    await vi.runAllTimersAsync();
    await promise;
    expect(openSpy).toHaveBeenCalledWith('about:blank', POP_WIN_NAME, 'w=100');
  });

  it('handles file fields by using DataTransfer', async () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const promise = formPost('https://upload.example.com', 'width=400', [
      { type: 'file', name: 'upload', value: file },
    ]);
    await vi.runAllTimersAsync();
    await promise;
    expect(submitSpy).toHaveBeenCalled();
  });

  it('removes the form after 100ms', async () => {
    const removeSpy = vi.spyOn(HTMLFormElement.prototype, 'remove').mockImplementation(() => {});
    const promise = formPost('https://x.com', '', []);
    await vi.runAllTimersAsync();
    await promise;
    expect(removeSpy).toHaveBeenCalled();
  });
});
