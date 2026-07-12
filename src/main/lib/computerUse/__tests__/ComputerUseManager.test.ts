import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  ComputerUseManager,
  getComputerUseManager,
  setComputerUseManagerForTesting,
  type ManagerDeps,
} from '../ComputerUseManager';
import { ActionAudit } from '../actionAudit';
import { toDriverPoint } from '../coordinateMapping';
import type { InputDriver } from '../inputDriverTypes';
import type { DesktopControl, CapturedFrame } from '../desktopControl';
import type { PermissionStatus } from '../types';

function fakeDriver(): InputDriver {
  return {
    moveMouse: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    doubleClick: vi.fn(async () => undefined),
    drag: vi.fn(async () => undefined),
    scroll: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    pressKey: vi.fn(async () => undefined),
    hotkey: vi.fn(async () => undefined),
  };
}

function fakeCursor() {
  return {
    signal: vi.fn(),
    ping: vi.fn(),
    settle: vi.fn(async () => undefined),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

function frame(): CapturedFrame {
  return {
    base64: 'AAAA',
    mimeType: 'image/jpeg',
    width: 1440,
    height: 900,
    displayId: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    scaleFactor: 2,
  };
}

function fakeDesktop(platform: NodeJS.Platform = 'darwin'): DesktopControl {
  return {
    listDisplays: vi.fn(() => [
      { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2, primary: true },
    ]),
    capture: vi.fn(async () => frame()),
    toDriverPoint: vi.fn((point, scaleFactor) => toDriverPoint(point, scaleFactor, platform)),
    listWindows: vi.fn(async () => [{ appId: 'Safari', title: 'Safari', focused: true }]),
    focusWindow: vi.fn(async () => true),
    getFrontmostApp: vi.fn(async () => undefined),
  };
}

const granted: PermissionStatus = { screenRecording: 'granted', accessibility: true };

type ManagerTestOverrides = Partial<ManagerDeps> & { platform?: NodeJS.Platform };

function makeManager(over: ManagerTestOverrides = {}, status: PermissionStatus = granted) {
  const platform = over.platform ?? 'darwin';
  const desktop = over.desktop ?? fakeDesktop(platform);
  const driver = fakeDriver();
  const audit = over.audit ?? new ActionAudit();
  const permissions = over.permissions ?? ((): PermissionStatus => status);
  const loadDriver = over.loadDriver ?? (() => ({ available: true as const, driver }));
  const manager = new ComputerUseManager({
    desktop,
    loadDriver,
    permissions,
    audit,
    cursor: over.cursor,
  });
  return { manager, desktop, driver, audit, cursor: over.cursor };
}

const ctx = { confirmed: true, chatSessionId: 's1' };

beforeEach(() => setComputerUseManagerForTesting(null));

describe('permissions + delegation', () => {
  it('delegates permissions with the prompt flag', () => {
    const permissions = vi.fn(() => granted);
    const { manager } = makeManager({ permissions });
    manager.permissions();
    manager.permissions(true);
    expect(permissions).toHaveBeenNthCalledWith(1, false);
    expect(permissions).toHaveBeenNthCalledWith(2, true);
  });

  it('delegates listDisplays and listWindows', async () => {
    const { manager, desktop } = makeManager();
    expect(manager.listDisplays()).toHaveLength(1);
    expect(await manager.listWindows()).toHaveLength(1);
    expect(desktop.listDisplays).toHaveBeenCalled();
    expect(desktop.listWindows).toHaveBeenCalled();
  });
});

describe('focusWindow', () => {
  it('tracks the foreground app on success', async () => {
    const desktop = fakeDesktop();
    (desktop.getFrontmostApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'Notes',
      candidates: ['Notes'],
    });
    const { manager, audit } = makeManager({ desktop });
    expect(manager.getForegroundApp()).toBeUndefined();
    expect(manager.getForegroundAppCandidates()).toEqual([]);
    expect(await manager.focusWindow({ appId: 'Notes' }, ctx)).toBe(true);
    expect(manager.getForegroundApp('s1')).toBe('Notes');
    expect(manager.getForegroundAppCandidates('s1')).toEqual(['Notes']);
    expect(audit.list()).toMatchObject([
      { chatSessionId: 's1', action: 'focus_window', target: 'Notes', confirmed: true },
    ]);
  });

  it('falls back to title and does not track when focus fails', async () => {
    const desktop = fakeDesktop();
    (desktop.focusWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const { manager, audit } = makeManager({ desktop });
    expect(await manager.focusWindow({ title: 'Mail' }, ctx)).toBe(false);
    expect(manager.getForegroundApp()).toBeUndefined();
    expect(audit.list()).toEqual([]);
  });

  it('uses the OS frontmost app after focus instead of the focus_window target', async () => {
    const desktop = fakeDesktop();
    (desktop.getFrontmostApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'Microsoft Edge',
      candidates: ['Microsoft Edge', 'msedge'],
    });
    const { manager } = makeManager({ desktop });
    await manager.focusWindow({ appId: 'Notes' });
    expect(manager.getForegroundApp()).toBe('Microsoft Edge');
    expect(manager.getForegroundAppCandidates()).toEqual(['Microsoft Edge', 'msedge']);
    const shot = await manager.screenshot();
    expect(shot.foregroundApp).toBe('Microsoft Edge');
    expect(manager.getForegroundApp()).toBe('Microsoft Edge');
    expect(manager.getForegroundAppCandidates()).toEqual(['Microsoft Edge', 'msedge']);
  });

  it('clears the screenshot frontmost when focus_window moves to a different app (no stale allowlist match)', async () => {
    const desktop = fakeDesktop();
    vi.mocked(desktop.getFrontmostApp)
      .mockResolvedValueOnce({
        name: 'Microsoft Edge',
        candidates: ['Microsoft Edge', 'msedge'],
      })
      .mockResolvedValueOnce({
        name: 'Terminal',
        candidates: ['Terminal'],
      });
    const { manager } = makeManager({ desktop });
    // A screenshot captures the (allowlisted) app as the OS frontmost app.
    await manager.screenshot();
    expect(manager.getForegroundAppCandidates()).toEqual(['Microsoft Edge', 'msedge']);
    // The tool then focuses a DIFFERENT, non-allowlisted app. The gate must no longer see
    // the stale screenshot app, or synthetic input would reach Terminal without confirmation.
    await manager.focusWindow({ appId: 'Terminal' });
    expect(manager.getForegroundApp()).toBe('Terminal');
    expect(manager.getForegroundAppCandidates()).toEqual(['Terminal']);
  });

  it('keeps foreground unknown when focus and screenshot cannot resolve the OS frontmost app', async () => {
    const { manager } = makeManager();
    await manager.focusWindow({ appId: 'Notes' });
    const shot = await manager.screenshot();
    expect(shot.foregroundApp).toBeUndefined();
    expect(manager.getForegroundApp()).toBeUndefined();
  });

  it('tolerates the frontmost query rejecting during screenshot', async () => {
    const desktop = fakeDesktop();
    (desktop.getFrontmostApp as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('osascript boom'));
    const { manager } = makeManager({ desktop });
    const shot = await manager.screenshot();
    expect(shot.foregroundApp).toBeUndefined();
  });

  it('keeps screenshot grounding and foreground app state isolated per chat session', async () => {
    const desktop = fakeDesktop();
    vi.mocked(desktop.capture)
      .mockResolvedValueOnce({
        ...frame(),
        displayId: 1,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        width: 100,
        height: 100,
        scaleFactor: 1,
      })
      .mockResolvedValueOnce({
        ...frame(),
        displayId: 2,
        bounds: { x: 1000, y: 0, width: 200, height: 200 },
        width: 200,
        height: 200,
        scaleFactor: 1,
      });
    vi.mocked(desktop.getFrontmostApp)
      .mockResolvedValueOnce({ name: 'Safari', candidates: ['Safari'] })
      .mockResolvedValueOnce({ name: 'Notes', candidates: ['Notes'] });

    const { manager, driver } = makeManager({ desktop });
    const sessionA = { confirmed: true, chatSessionId: 'session-a' };
    const sessionB = { confirmed: true, chatSessionId: 'session-b' };

    await manager.screenshot(undefined, sessionA);
    await manager.screenshot(undefined, sessionB);

    expect(manager.getForegroundApp('session-a')).toBe('Safari');
    expect(manager.getForegroundAppCandidates('session-a')).toEqual(['Safari']);
    expect(manager.getForegroundApp('session-b')).toBe('Notes');
    expect(manager.getForegroundAppCandidates('session-b')).toEqual(['Notes']);

    await manager.click(50, 50, 'left', sessionA);
    await manager.click(100, 100, 'left', sessionB);

    expect(driver.click).toHaveBeenNthCalledWith(1, { x: 50, y: 50 }, 'left');
    expect(driver.click).toHaveBeenNthCalledWith(2, { x: 1100, y: 100 }, 'left');
  });

  it('throws when accessibility is not granted', async () => {
    const { manager } = makeManager({}, { screenRecording: 'granted', accessibility: false });
    await expect(manager.focusWindow({ appId: 'Notes' })).rejects.toThrow('Accessibility');
  });
});

describe('screenshot', () => {
  it('captures, records the frame, and reports the foreground app', async () => {
    const desktop = fakeDesktop();
    vi.mocked(desktop.getFrontmostApp).mockResolvedValue({ name: 'Safari', candidates: ['Safari'] });
    const { manager } = makeManager({ desktop });
    const shot = await manager.screenshot(2);
    expect(desktop.capture).toHaveBeenCalledWith(2);
    expect(shot).toMatchObject({ data: 'AAAA', mimeType: 'image/jpeg', width: 1440, foregroundApp: 'Safari' });
  });

  it('throws when screen recording is denied', async () => {
    const { manager } = makeManager({}, { screenRecording: 'denied', accessibility: true });
    await expect(manager.screenshot()).rejects.toThrow('Screen Recording');
  });

  it('re-shows the AI cursor even when capture throws', async () => {
    const cursor = fakeCursor();
    const desktop = fakeDesktop();
    (desktop.capture as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('capture exploded'));
    const { manager } = makeManager({ desktop, cursor });
    await expect(manager.screenshot()).rejects.toThrow('capture exploded');
    // The overlay is hidden for the capture; a failed capture must still ping it back
    // so the user is never left without the visible AI cursor.
    expect(cursor.hide).toHaveBeenCalledTimes(1);
    expect(cursor.ping).toHaveBeenCalledTimes(1);
  });
});

describe('pointer + keyboard dispatch', () => {
  it('requires a screenshot before pointer actions', async () => {
    const { manager } = makeManager();
    await expect(manager.moveMouse(10, 10, ctx)).rejects.toThrow('Take a screenshot');
  });

  it('maps and dispatches move, click, double-click, scroll', async () => {
    const { manager, driver, audit } = makeManager();
    await manager.screenshot(undefined, ctx);
    await manager.moveMouse(720, 450, ctx);
    expect(driver.moveMouse).toHaveBeenCalledWith({ x: 720, y: 450 });

    await manager.click(0, 0, 'left', ctx);
    expect(driver.click).toHaveBeenCalledWith({ x: 0, y: 0 }, 'left');

    // The exact bottom-right image corner clamps to the display's last valid pixel
    // (1439, 899) rather than spilling one past the edge onto the adjacent display.
    await manager.click(1440, 900, 'right', ctx);
    expect(driver.click).toHaveBeenLastCalledWith({ x: 1439, y: 899 }, 'right');

    await manager.doubleClick(720, 450, ctx);
    expect(driver.doubleClick).toHaveBeenCalled();

    await manager.scroll(720, 450, 3, -4, ctx);
    expect(driver.scroll).toHaveBeenCalledWith({ x: 720, y: 450 }, 3, -4);

    const actions = audit.list().map((e) => e.action);
    expect(actions).toEqual(['move_mouse', 'click', 'right_click', 'double_click', 'scroll']);
  });

  it('clamps oversized and non-finite scroll deltas before dispatching to the driver', async () => {
    const { manager, driver, audit } = makeManager();
    await manager.screenshot(undefined, ctx);

    // A model can emit an arbitrarily large delta; it is bounded to ±MAX_SCROLL_DELTA (100).
    await manager.scroll(720, 450, 50000, -50000, ctx);
    expect(driver.scroll).toHaveBeenLastCalledWith({ x: 720, y: 450 }, 100, -100);

    // Non-finite deltas (NaN / Infinity) collapse to 0 rather than poisoning the driver.
    await manager.scroll(720, 450, Number.NaN, Number.POSITIVE_INFINITY, ctx);
    expect(driver.scroll).toHaveBeenLastCalledWith({ x: 720, y: 450 }, 0, 0);

    // The audit records the clamped values, not the raw request.
    const scrolls = audit.list().filter((e) => e.action === 'scroll');
    expect(scrolls[0].target).toContain('d=100,-100');
    expect(scrolls[1].target).toContain('d=0,0');
  });

  it('maps both endpoints for a drag', async () => {
    const { manager, driver } = makeManager();
    await manager.screenshot(undefined, ctx);
    const result = await manager.drag({ x: 0, y: 0 }, { x: 1440, y: 900 }, ctx);
    // The bottom-right endpoint clamps to the last on-display pixel (1439, 899).
    expect(result).toEqual({ from: { x: 0, y: 0 }, to: { x: 1439, y: 899 } });
    expect(driver.drag).toHaveBeenCalledWith({ x: 0, y: 0 }, { x: 1439, y: 899 });
  });

  it('rejects out-of-range points', async () => {
    const { manager } = makeManager();
    await manager.screenshot(undefined, ctx);
    await expect(manager.click(5000, 10, 'left', ctx)).rejects.toThrow('outside');
  });

  it('dispatches type_text, press_key, hotkey and records them', async () => {
    const { manager, driver, audit } = makeManager();
    await manager.typeText('hello', ctx);
    expect(driver.typeText).toHaveBeenCalledWith('hello');
    await manager.pressKey('enter', ctx);
    expect(driver.pressKey).toHaveBeenCalledWith('enter');
    await manager.hotkey(['cmd', 'c'], ctx);
    expect(driver.hotkey).toHaveBeenCalledWith(['cmd', 'c']);
    const records = audit.list();
    expect(records.find((e) => e.action === 'type_text')?.target).toBe('5 chars');
    expect(records.find((e) => e.action === 'hotkey')?.target).toBe('cmd+c');
  });

  it('blocks keyboard actions when accessibility is denied', async () => {
    const { manager } = makeManager({}, { screenRecording: 'granted', accessibility: false });
    await expect(manager.typeText('x', ctx)).rejects.toThrow('Accessibility');
  });
});

describe('cancellation (abort signal)', () => {
  it('throws aborted and skips the driver when the signal is already aborted', async () => {
    const { manager, driver } = makeManager();
    await manager.screenshot();
    const ac = new AbortController();
    ac.abort();
    await expect(
      manager.click(100, 100, 'left', { confirmed: true, signal: ac.signal }),
    ).rejects.toThrow('aborted');
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('re-checks the signal AFTER the pre-action settle so an abort during the glide stops the click', async () => {
    // The user cancels WHILE the AI cursor is gliding to the target: settle resolves,
    // but the turn is now aborted. Without the post-settle re-check the real click
    // would still land (B3 regression guard).
    const ac = new AbortController();
    const cursor = fakeCursor();
    cursor.settle = vi.fn(async () => {
      ac.abort();
    });
    const { manager, driver } = makeManager({ cursor });
    await manager.screenshot();
    await expect(
      manager.click(100, 100, 'left', { confirmed: true, signal: ac.signal }),
    ).rejects.toThrow('aborted');
    expect(cursor.settle).toHaveBeenCalled();
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('aborts a scroll after the settle without dispatching native input', async () => {
    const ac = new AbortController();
    const cursor = fakeCursor();
    cursor.settle = vi.fn(async () => {
      ac.abort();
    });
    const { manager, driver } = makeManager({ cursor });
    await manager.screenshot();
    await expect(
      manager.scroll(100, 100, 0, 3, { confirmed: true, signal: ac.signal }),
    ).rejects.toThrow('aborted');
    expect(driver.scroll).not.toHaveBeenCalled();
  });

  it('aborts a keyboard action before dispatch when already cancelled', async () => {
    const { manager, driver } = makeManager();
    const ac = new AbortController();
    ac.abort();
    await expect(
      manager.typeText('hello', { confirmed: true, signal: ac.signal }),
    ).rejects.toThrow('aborted');
    expect(driver.typeText).not.toHaveBeenCalled();
  });

  it('dispatches normally when a signal is present but not aborted', async () => {
    const ac = new AbortController();
    const { manager, driver } = makeManager();
    await manager.screenshot();
    await manager.click(100, 100, 'left', { confirmed: true, signal: ac.signal });
    expect(driver.click).toHaveBeenCalledTimes(1);
  });
});

describe('high-DPI driver coordinate scaling', () => {
  it('scales mapped logical points to physical pixels on win32', async () => {
    const { manager, driver } = makeManager({ platform: 'win32' });
    await manager.screenshot(undefined, ctx);
    await manager.moveMouse(720, 450, ctx);
    expect(driver.moveMouse).toHaveBeenCalledWith({ x: 1440, y: 900 });
    // Edge clamp pins the logical point to (1439, 899); x2 scaleFactor => (2878, 1798).
    await manager.click(1440, 900, 'left', ctx);
    expect(driver.click).toHaveBeenLastCalledWith({ x: 2878, y: 1798 }, 'left');
    const drag = await manager.drag({ x: 0, y: 0 }, { x: 720, y: 450 }, ctx);
    expect(drag).toEqual({ from: { x: 0, y: 0 }, to: { x: 1440, y: 900 } });
    expect(driver.drag).toHaveBeenLastCalledWith({ x: 0, y: 0 }, { x: 1440, y: 900 });
  });

  it('delegates driver conversion to the desktop layer for mixed-DPI display origins', async () => {
    const desktop = fakeDesktop('win32');
    vi.mocked(desktop.capture).mockResolvedValue({
      ...frame(),
      displayId: 2,
      bounds: { x: 1440, y: 0, width: 1440, height: 900 },
      scaleFactor: 1.5,
    });
    vi.mocked(desktop.toDriverPoint).mockImplementation((point) => ({
      x: point.x + 360,
      y: point.y + 120,
    }));

    const { manager, driver } = makeManager({ platform: 'win32', desktop });
    await manager.screenshot(undefined, ctx);
    await manager.moveMouse(720, 450, ctx);

    expect(desktop.toDriverPoint).toHaveBeenCalledWith({ x: 2160, y: 450 }, 1.5);
    expect(driver.moveMouse).toHaveBeenCalledWith({ x: 2520, y: 570 });
  });

  it('keeps logical points unchanged on darwin at the same scaleFactor', async () => {
    const { manager, driver } = makeManager({ platform: 'darwin' });
    await manager.screenshot(undefined, ctx);
    await manager.moveMouse(720, 450, ctx);
    expect(driver.moveMouse).toHaveBeenCalledWith({ x: 720, y: 450 });
  });
});

describe('cursor overlay signals', () => {
  it('emits one logical-space signal per pointer action while the driver receives physical points', async () => {
    const cursor = fakeCursor();
    const display = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
    const { manager, driver } = makeManager({ platform: 'win32', cursor });
    await manager.screenshot(undefined, ctx);
    expect(cursor.hide).toHaveBeenCalled(); // keeps the AI cursor out of the captured frame
    expect(cursor.ping).toHaveBeenCalled(); // keeps the AI cursor alive across think-time

    await manager.moveMouse(720, 450, ctx);
    expect(driver.moveMouse).toHaveBeenCalledWith({ x: 1440, y: 900 });
    expect(cursor.signal).toHaveBeenLastCalledWith({ kind: 'move', point: { x: 720, y: 450 }, display });

    await manager.click(1440, 900, 'right', ctx);
    expect(driver.click).toHaveBeenLastCalledWith({ x: 2878, y: 1798 }, 'right');
    expect(cursor.signal).toHaveBeenLastCalledWith({
      kind: 'click',
      point: { x: 1439, y: 899 },
      button: 'right',
      display,
    });

    await manager.doubleClick(0, 0, ctx);
    expect(cursor.signal).toHaveBeenLastCalledWith({ kind: 'double', point: { x: 0, y: 0 }, display });

    await manager.scroll(720, 450, 1, -2, ctx);
    expect(cursor.signal).toHaveBeenLastCalledWith({ kind: 'scroll', point: { x: 720, y: 450 }, display });

    await manager.drag({ x: 0, y: 0 }, { x: 720, y: 450 }, ctx);
    // Drag first glides to the grab point (a move signal) and only then drags, so
    // it emits two signals: the pre-move, then the drag itself (the last call).
    expect(cursor.signal).toHaveBeenNthCalledWith(5, { kind: 'move', point: { x: 0, y: 0 }, display });
    expect(cursor.signal).toHaveBeenLastCalledWith({
      kind: 'drag',
      point: { x: 0, y: 0 },
      to: { x: 720, y: 450 },
      display,
    });

    expect(cursor.signal).toHaveBeenCalledTimes(6);
  });

  it('signals, settles, THEN dispatches the synthetic input (move there, then click)', async () => {
    const cursor = fakeCursor();
    const { manager, driver } = makeManager({ platform: 'win32', cursor });
    await manager.screenshot(undefined, ctx);

    // For a click the cursor must be signaled, then allowed to glide onto the
    // target (settle), and only THEN does the real input land — so the user sees
    // the AI cursor arrive and click, not the app reacting before it shows up.
    await manager.click(100, 100, 'left', ctx);
    const sigOrder = cursor.signal.mock.invocationCallOrder[0];
    const settleOrder = cursor.settle.mock.invocationCallOrder[0];
    const clickOrder = vi.mocked(driver.click).mock.invocationCallOrder[0];
    expect(sigOrder).toBeLessThan(settleOrder);
    expect(settleOrder).toBeLessThan(clickOrder);

    // Drag glides to the grab point and settles BEFORE the synthetic drag runs.
    await manager.drag({ x: 0, y: 0 }, { x: 50, y: 50 }, ctx);
    const preMoveOrder = cursor.signal.mock.invocationCallOrder[1];
    const dragSettleOrder = cursor.settle.mock.invocationCallOrder[1];
    const dragOrder = vi.mocked(driver.drag).mock.invocationCallOrder[0];
    expect(preMoveOrder).toBeLessThan(dragSettleOrder);
    expect(dragSettleOrder).toBeLessThan(dragOrder);
  });

  it('keeps the AI cursor alive on keyboard and focus actions (non-pointer steps)', async () => {
    const cursor = fakeCursor();
    const { manager } = makeManager({ platform: 'win32', cursor });

    await manager.typeText('hi', ctx);
    await manager.pressKey('enter', ctx);
    await manager.hotkey(['ctrl', 'c'], ctx);
    await manager.focusWindow({ appId: 'Notepad' });

    // Keyboard/focus steps emit no positional signal, but must refresh the
    // overlay so it stays visible throughout the operation.
    expect(cursor.signal).not.toHaveBeenCalled();
    expect(cursor.ping).toHaveBeenCalledTimes(4);
  });
});

describe('foreground app identity', () => {
  it('clears stale screenshot foreground after focus when the OS foreground cannot be resolved', async () => {
    const desktop = fakeDesktop();
    vi.mocked(desktop.getFrontmostApp)
      .mockResolvedValueOnce({ name: 'Safari', candidates: ['Safari'] })
      .mockResolvedValueOnce(undefined);
    const { manager } = makeManager({ desktop });

    await manager.screenshot(undefined, { chatSessionId: 'session-1' });
    expect(manager.getForegroundAppCandidates('session-1')).toEqual(['Safari']);

    await manager.focusWindow({ title: 'Safari - Inbox' }, { chatSessionId: 'session-1' });

    expect(manager.getForegroundApp('session-1')).toBeUndefined();
    expect(manager.getForegroundAppCandidates('session-1')).toEqual([]);
  });

  it('uses OS-resolved foreground candidates after focus instead of model-supplied query text', async () => {
    const desktop = fakeDesktop();
    vi.mocked(desktop.getFrontmostApp).mockResolvedValue({
      name: 'Notepad',
      candidates: ['Notepad', 'notepad'],
    });
    const { manager } = makeManager({ desktop });

    await manager.focusWindow({ title: 'Safari' }, { chatSessionId: 'session-1' });

    expect(manager.getForegroundApp('session-1')).toBe('Notepad');
    expect(manager.getForegroundAppCandidates('session-1')).toEqual(['Notepad', 'notepad']);
  });

  it('refreshes foreground candidates from the OS and clears stale state on probe failure', async () => {
    const desktop = fakeDesktop();
    vi.mocked(desktop.getFrontmostApp)
      .mockResolvedValueOnce({ name: 'Safari', candidates: ['Safari'] })
      .mockResolvedValueOnce({ name: 'Terminal', candidates: ['Terminal'] })
      .mockRejectedValueOnce(new Error('frontmost unavailable'));
    const { manager } = makeManager({ desktop });

    await manager.screenshot(undefined, { chatSessionId: 'session-1' });
    expect(manager.getForegroundAppCandidates('session-1')).toEqual(['Safari']);
    await expect(manager.refreshForegroundAppCandidates('session-1')).resolves.toEqual(['Terminal']);
    expect(manager.getForegroundAppCandidates('session-1')).toEqual(['Terminal']);
    await expect(manager.refreshForegroundAppCandidates('session-1')).resolves.toEqual([]);
    expect(manager.getForegroundAppCandidates('session-1')).toEqual([]);
  });
});

describe('driver availability', () => {
  it('throws a reason-bearing error when the driver is unavailable', async () => {
    const { manager } = makeManager({
      loadDriver: () => ({ available: false as const, driver: fakeDriver(), reason: 'no binary' }),
    });
    await manager.screenshot(undefined, ctx);
    await expect(manager.moveMouse(10, 10, ctx)).rejects.toThrow('Input driver unavailable: no binary');
  });

  it('throws a generic error when no reason is given', async () => {
    const { manager } = makeManager({
      loadDriver: () => ({ available: false as const, driver: fakeDriver() }),
    });
    await manager.screenshot(undefined, ctx);
    await expect(manager.moveMouse(10, 10, ctx)).rejects.toThrow('Input driver unavailable.');
  });
});

describe('singleton', () => {
  it('returns a stable instance and supports the test seam', () => {
    const { manager } = makeManager();
    setComputerUseManagerForTesting(manager);
    expect(getComputerUseManager()).toBe(manager);

    setComputerUseManagerForTesting(null);
    const real = getComputerUseManager();
    expect(real).toBeInstanceOf(ComputerUseManager);
    expect(getComputerUseManager()).toBe(real);
  });
});
