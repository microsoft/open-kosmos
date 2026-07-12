import { describe, it, expect, vi, beforeEach } from 'vitest';
import Module from 'node:module';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  nutKeyName,
  NutJsInputDriver,
  NoopInputDriver,
  loadInputDriver,
  type InputDriver,
  type NutModule,
} from '../inputDriver';
import type { MouseButton } from '../types';

function makeFakeNut(homeX = 11, homeY = 22) {
  class Point {
    constructor(public x: number, public y: number) {}
  }
  const mouse = {
    getPosition: vi.fn(async () => new Point(homeX, homeY)),
    setPosition: vi.fn(async (_p: { x: number; y: number }) => undefined),
    click: vi.fn(async () => undefined),
    doubleClick: vi.fn(async () => undefined),
    pressButton: vi.fn(async () => undefined),
    releaseButton: vi.fn(async () => undefined),
    scrollDown: vi.fn(async () => undefined),
    scrollUp: vi.fn(async () => undefined),
    scrollLeft: vi.fn(async () => undefined),
    scrollRight: vi.fn(async () => undefined),
  };
  const keyboard = {
    type: vi.fn(async () => undefined),
    pressKey: vi.fn(async () => undefined),
    releaseKey: vi.fn(async () => undefined),
  };
  const mod: NutModule = {
    mouse,
    keyboard,
    Button: { LEFT: 0, MIDDLE: 1, RIGHT: 2 },
    Key: { A: 100, C: 101, Enter: 200, LeftCmd: 300, LeftControl: 301, Tab: 400, F5: 500, Num1: 600 },
    Point: Point as unknown as NutModule['Point'],
  };
  return { mod, mouse, keyboard };
}

type ModuleWithLoad = typeof Module & {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};

function withMockedNativeRequire<T>(mod: NutModule, run: () => T): T {
  const moduleWithLoad = Module as ModuleWithLoad;
  const originalLoad = moduleWithLoad._load;
  moduleWithLoad._load = (request, parent, isMain) => {
    if (request === '@nut-tree-fork/nut-js') {
      return mod;
    }
    return originalLoad.call(moduleWithLoad, request, parent, isMain);
  };
  try {
    return run();
  } finally {
    moduleWithLoad._load = originalLoad;
  }
}

describe('nutKeyName', () => {
  it('maps aliases', () => {
    expect(nutKeyName('enter')).toBe('Enter');
    expect(nutKeyName('return')).toBe('Return');
    // numpad Enter is a gated activation key, so it must resolve to a real nut.js member
    // (nut.js has no NumPadEnter; `Enter` (103) is the numpad-enter member) rather than null.
    expect(nutKeyName('numenter')).toBe('Enter');
    expect(nutKeyName('ESC')).toBe('Escape');
    expect(nutKeyName('space')).toBe('Space');
    expect(nutKeyName('cmd')).toBe('LeftCmd');
    expect(nutKeyName('ctrl')).toBe('LeftControl');
    expect(nutKeyName('option')).toBe('LeftAlt');
    expect(nutKeyName('win')).toBe('LeftSuper');
  });
  it('maps single letters and digits', () => {
    expect(nutKeyName('a')).toBe('A');
    expect(nutKeyName('Z')).toBe('Z');
    expect(nutKeyName('1')).toBe('Num1');
  });
  it('maps function keys', () => {
    expect(nutKeyName('f5')).toBe('F5');
    expect(nutKeyName('F12')).toBe('F12');
    expect(nutKeyName('f24')).toBe('F24');
  });
  it('returns null for unknown / empty', () => {
    expect(nutKeyName('')).toBeNull();
    expect(nutKeyName('   ')).toBeNull();
    expect(nutKeyName('f25')).toBeNull();
    expect(nutKeyName('superkey')).toBeNull();
  });
});

describe('NutJsInputDriver', () => {
  let fake: ReturnType<typeof makeFakeNut>;
  let driver: NutJsInputDriver;

  beforeEach(() => {
    fake = makeFakeNut();
    driver = new NutJsInputDriver(fake.mod);
  });

  it('moves the mouse', async () => {
    await driver.moveMouse({ x: 5, y: 6 });
    expect(fake.mouse.setPosition).toHaveBeenCalledWith({ x: 5, y: 6 });
  });

  it('clicks with default left button', async () => {
    await driver.click({ x: 1, y: 2 });
    expect(fake.mouse.click).toHaveBeenCalledWith(0);
  });

  it('clicks right and middle', async () => {
    await driver.click({ x: 1, y: 2 }, 'right');
    expect(fake.mouse.click).toHaveBeenCalledWith(2);
    await driver.click({ x: 1, y: 2 }, 'middle');
    expect(fake.mouse.click).toHaveBeenCalledWith(1);
  });

  it('rejects unknown mouse buttons instead of defaulting to left', async () => {
    await expect(driver.click({ x: 1, y: 2 }, 'side' as MouseButton)).rejects.toThrow('Unsupported mouse button: side');
    expect(fake.mouse.click).not.toHaveBeenCalled();
  });

  it('double clicks', async () => {
    await driver.doubleClick({ x: 1, y: 2 });
    expect(fake.mouse.doubleClick).toHaveBeenCalledWith(0);
  });

  it('drags press->move->release', async () => {
    await driver.drag({ x: 1, y: 1 }, { x: 9, y: 9 });
    expect(fake.mouse.pressButton).toHaveBeenCalledWith(0);
    expect(fake.mouse.releaseButton).toHaveBeenCalledWith(0);
    // from, to, and the cursor restore.
    expect(fake.mouse.setPosition).toHaveBeenCalledTimes(3);
  });

  it('releases the drag button even when the move to the target throws', async () => {
    // setPosition #1 is the grab point (from); make the #2 call (move to target) throw.
    let calls = 0;
    fake.mouse.setPosition.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) throw new Error('move failed');
      return undefined;
    });
    await expect(driver.drag({ x: 1, y: 1 }, { x: 9, y: 9 })).rejects.toThrow('move failed');
    expect(fake.mouse.pressButton).toHaveBeenCalledWith(0);
    // The button is released despite the throw, so no drag-select leaks onto the desktop.
    expect(fake.mouse.releaseButton).toHaveBeenCalledWith(0);
  });

  it('scrolls in all four directions', async () => {
    await driver.scroll({ x: 0, y: 0 }, 3, 4);
    expect(fake.mouse.scrollDown).toHaveBeenCalledWith(4);
    expect(fake.mouse.scrollRight).toHaveBeenCalledWith(3);
    await driver.scroll({ x: 0, y: 0 }, -3, -4);
    expect(fake.mouse.scrollUp).toHaveBeenCalledWith(4);
    expect(fake.mouse.scrollLeft).toHaveBeenCalledWith(3);
  });

  it('does not scroll when deltas are zero', async () => {
    await driver.scroll({ x: 0, y: 0 }, 0, 0);
    expect(fake.mouse.scrollDown).not.toHaveBeenCalled();
    expect(fake.mouse.scrollUp).not.toHaveBeenCalled();
    expect(fake.mouse.scrollLeft).not.toHaveBeenCalled();
    expect(fake.mouse.scrollRight).not.toHaveBeenCalled();
  });

  it('types text', async () => {
    await driver.typeText('hi');
    expect(fake.keyboard.type).toHaveBeenCalledWith('hi');
  });

  it('presses and releases a key', async () => {
    await driver.pressKey('a');
    expect(fake.keyboard.pressKey).toHaveBeenCalledWith(100);
    expect(fake.keyboard.releaseKey).toHaveBeenCalledWith(100);
  });

  it('dispatches a gated numpad-enter key instead of rejecting it', async () => {
    // Regression: `numenter` is gated as an activation key, so it must resolve through the
    // driver (nut.js `Enter`) rather than throwing "Unsupported key" after the user approves.
    await driver.pressKey('numenter');
    expect(fake.keyboard.pressKey).toHaveBeenCalledWith(200);
    expect(fake.keyboard.releaseKey).toHaveBeenCalledWith(200);
  });

  it('throws on an unknown key name', async () => {
    await expect(driver.pressKey('nope')).rejects.toThrow('Unsupported key');
  });

  it('throws when a key name is not in the module Key map', async () => {
    await expect(driver.pressKey('z')).rejects.toThrow('Unsupported key');
  });

  it('presses a hotkey chord and releases in the SAME order (regression: cmd+space stuck key)', async () => {
    await driver.hotkey(['cmd', 'c']);
    expect(fake.keyboard.pressKey).toHaveBeenCalledWith(300, 101);
    // nut.js reverses internally and treats the last code as the key; press and
    // release MUST use identical order. Releasing reversed made nut.js treat a
    // non-modifier as a modifier flag -> "Invalid key flag specified" -> stuck key.
    expect(fake.keyboard.releaseKey).toHaveBeenCalledWith(300, 101);
  });

  it('rejects an empty hotkey', async () => {
    await expect(driver.hotkey([])).rejects.toThrow('at least one key');
  });

  it('rejects a hotkey with an unknown key', async () => {
    await expect(driver.hotkey(['cmd', 'bogus'])).rejects.toThrow('Unsupported key');
  });

  it('still releases the chord when the press throws (no stuck modifier)', async () => {
    fake.keyboard.pressKey.mockRejectedValueOnce(new Error('[nut.js] - Error: Invalid key flag specified.'));
    await expect(driver.hotkey(['cmd', 'c'])).rejects.toThrow('Invalid key flag');
    expect(fake.keyboard.releaseKey).toHaveBeenCalledWith(300, 101);
  });

  it('falls back to per-key release when the chord release fails', async () => {
    fake.keyboard.releaseKey.mockRejectedValueOnce(new Error('chord release boom'));
    await driver.hotkey(['cmd', 'c']);
    // First the chord release is attempted, then each code individually (key first).
    expect(fake.keyboard.releaseKey).toHaveBeenNthCalledWith(1, 300, 101);
    expect(fake.keyboard.releaseKey).toHaveBeenNthCalledWith(2, 101);
    expect(fake.keyboard.releaseKey).toHaveBeenNthCalledWith(3, 300);
  });

  it('swallows per-key release failures so a chord error never propagates', async () => {
    fake.keyboard.releaseKey.mockRejectedValue(new Error('every release boom'));
    await expect(driver.hotkey(['cmd', 'c'])).resolves.toBeUndefined();
  });

  it('still releases the key when a single press_key press throws', async () => {
    fake.keyboard.pressKey.mockRejectedValueOnce(new Error('press boom'));
    await expect(driver.pressKey('a')).rejects.toThrow('press boom');
    expect(fake.keyboard.releaseKey).toHaveBeenCalledWith(100);
  });
});

describe('NutJsInputDriver — nut.js chord semantics (faithful simulation)', () => {
  // Mirror @nut-tree-fork/libnut KeyboardAction: pressKey/releaseKey reverse the
  // args, treat the last as the key + the rest as modifier flags, and reject a
  // modifier whose native string is not a valid flag (length > 1 and unknown).
  function makeNutSim() {
    const native: Record<number, string> = { 300: 'cmd', 101: 'c', 116: 'space', 93: 'n' };
    const VALID_FLAGS = new Set(['cmd', 'command', 'control', 'alt', 'shift', 'meta', 'win', 'fn']);
    const held = new Set<number>();
    function toggle(event: 'down' | 'up', codes: number[]) {
      const reversed = [...codes].reverse();
      const [keyCode, ...modCodes] = reversed;
      for (const m of modCodes) {
        const s = native[m];
        // libnut filters modifiers to length > 1, then validates the flag.
        if (s && s.length > 1 && !VALID_FLAGS.has(s)) {
          throw new Error('[nut.js] - Error: Invalid key flag specified.');
        }
      }
      if (event === 'down') held.add(keyCode);
      else held.delete(keyCode);
    }
    const keyboard = {
      type: vi.fn(async () => undefined),
      pressKey: vi.fn(async (...codes: number[]) => toggle('down', codes)),
      releaseKey: vi.fn(async (...codes: number[]) => toggle('up', codes)),
    };
    const mod: NutModule = {
      mouse: makeFakeNut().mouse,
      keyboard,
      Button: { LEFT: 0, MIDDLE: 1, RIGHT: 2 },
      Key: { A: 100, C: 101, LeftCmd: 300, Space: 116, N: 93 },
      Point: class {
        constructor(public x: number, public y: number) {}
      } as unknown as NutModule['Point'],
    };
    return { driver: new NutJsInputDriver(mod), held, keyboard };
  }

  it('cmd+space no longer throws and leaves no key stuck down', async () => {
    const sim = makeNutSim();
    await expect(sim.driver.hotkey(['cmd', 'space'])).resolves.toBeUndefined();
    expect(sim.held.size).toBe(0);
  });

  it('cmd+c (the previously-lucky case) also leaves nothing stuck', async () => {
    const sim = makeNutSim();
    await sim.driver.hotkey(['cmd', 'c']);
    expect(sim.held.size).toBe(0);
  });
});

describe('NutJsInputDriver — cursor preservation', () => {
  let fake: ReturnType<typeof makeFakeNut>;
  let driver: NutJsInputDriver;

  beforeEach(() => {
    fake = makeFakeNut(11, 22); // the user's real cursor "home"
    driver = new NutJsInputDriver(fake.mod);
  });

  function lastSetPosition() {
    const calls = fake.mouse.setPosition.mock.calls;
    return calls[calls.length - 1][0];
  }

  it('snaps the cursor back to the user position after a move', async () => {
    await driver.moveMouse({ x: 5, y: 6 });
    expect(fake.mouse.getPosition).toHaveBeenCalledTimes(1);
    expect(fake.mouse.setPosition).toHaveBeenNthCalledWith(1, { x: 5, y: 6 });
    expect(lastSetPosition()).toEqual({ x: 11, y: 22 });
  });

  it('clicks at the target first, then restores the user cursor', async () => {
    await driver.click({ x: 1, y: 2 }, 'right');
    expect(fake.mouse.setPosition).toHaveBeenNthCalledWith(1, { x: 1, y: 2 });
    expect(fake.mouse.click).toHaveBeenCalledWith(2);
    expect(lastSetPosition()).toEqual({ x: 11, y: 22 });
  });

  it('restores the user cursor after a double click', async () => {
    await driver.doubleClick({ x: 3, y: 4 });
    expect(fake.mouse.setPosition).toHaveBeenNthCalledWith(1, { x: 3, y: 4 });
    expect(lastSetPosition()).toEqual({ x: 11, y: 22 });
  });

  it('restores the user cursor after a scroll', async () => {
    await driver.scroll({ x: 7, y: 8 }, 1, 1);
    expect(fake.mouse.setPosition).toHaveBeenNthCalledWith(1, { x: 7, y: 8 });
    expect(lastSetPosition()).toEqual({ x: 11, y: 22 });
  });

  it('restores the user cursor to its start after a drag (from -> to -> home)', async () => {
    await driver.drag({ x: 1, y: 1 }, { x: 9, y: 9 });
    expect(fake.mouse.setPosition).toHaveBeenNthCalledWith(1, { x: 1, y: 1 });
    expect(fake.mouse.setPosition).toHaveBeenNthCalledWith(2, { x: 9, y: 9 });
    expect(lastSetPosition()).toEqual({ x: 11, y: 22 });
  });

  it('still restores the cursor when the action itself fails', async () => {
    fake.mouse.click.mockRejectedValueOnce(new Error('click boom'));
    await expect(driver.click({ x: 1, y: 2 })).rejects.toThrow('click boom');
    expect(lastSetPosition()).toEqual({ x: 11, y: 22 }); // restored in finally
  });

  it('leaves the cursor at the target when the position cannot be read', async () => {
    fake.mouse.getPosition.mockRejectedValueOnce(new Error('no getPosition'));
    await driver.click({ x: 1, y: 2 });
    expect(fake.mouse.setPosition).toHaveBeenCalledTimes(1); // target only, no restore
    expect(fake.mouse.setPosition).toHaveBeenCalledWith({ x: 1, y: 2 });
  });

  it('never throws when the restore itself fails', async () => {
    fake.mouse.setPosition
      .mockResolvedValueOnce(undefined) // target move succeeds
      .mockRejectedValueOnce(new Error('restore boom')); // restore fails
    await expect(driver.click({ x: 1, y: 2 })).resolves.toBeUndefined();
  });
});

describe('NoopInputDriver', () => {
  const noop: InputDriver = new NoopInputDriver();
  it('throws for every method', async () => {
    await expect(noop.moveMouse({ x: 0, y: 0 })).rejects.toThrow('unavailable');
    await expect(noop.click({ x: 0, y: 0 })).rejects.toThrow('unavailable');
    await expect(noop.doubleClick({ x: 0, y: 0 })).rejects.toThrow('unavailable');
    await expect(noop.drag({ x: 0, y: 0 }, { x: 1, y: 1 })).rejects.toThrow('unavailable');
    await expect(noop.scroll({ x: 0, y: 0 }, 1, 1)).rejects.toThrow('unavailable');
    await expect(noop.typeText('x')).rejects.toThrow('unavailable');
    await expect(noop.pressKey('a')).rejects.toThrow('unavailable');
    await expect(noop.hotkey(['a'])).rejects.toThrow('unavailable');
  });
});

describe('loadInputDriver', () => {
  it('returns an available nut-backed driver with an injected loader', () => {
    const { mod } = makeFakeNut();
    const result = loadInputDriver(() => mod);
    expect(result.available).toBe(true);
    expect(result.driver).toBeInstanceOf(NutJsInputDriver);
  });

  it('falls back to Noop when the loader throws', () => {
    const result = loadInputDriver(() => {
      throw new Error('binary missing');
    });
    expect(result.available).toBe(false);
    expect(result.driver).toBeInstanceOf(NoopInputDriver);
    expect(result.reason).toBe('binary missing');
  });

  it('stringifies a non-Error loader failure', () => {
    const result = loadInputDriver(() => {
      throw 'boom';
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('boom');
  });

  it('loads the real (mocked) module through the default loader', async () => {
    const { mod } = makeFakeNut();
    const result = withMockedNativeRequire(mod, () => loadInputDriver());
    expect(result.available).toBe(true);
    expect(result.driver).toBeInstanceOf(NutJsInputDriver);
    // Exercise it to confirm the default-loaded module is wired.
    await expect(result.driver.moveMouse({ x: 1, y: 1 })).resolves.toBeUndefined();
  });
});
