/**
 * Input driver — thin adapter over the native input dependency (`@nut-tree-fork/nut-js`).
 *
 * The rest of the module (and tests) never imports nut.js directly: it talks to
 * the {@link InputDriver} interface. The native module is loaded through an
 * injectable loader so tests drive the real adapter against a fake module, and a
 * {@link NoopInputDriver} models the "optional dependency missing" path without
 * throwing at import time.
 *
 * Cursor ownership: every pointer action that moves the OS cursor is wrapped so
 * the user's real hardware cursor is snapped back to where they left it once the
 * action completes (see {@link NutJsInputDriver.preservingCursor}). Computer Use
 * therefore never hijacks the user's pointer — the visible "AI cursor" overlay
 * (driven by the manager) is the only cursor that follows the agent, so the user
 * sees two independent cursors.
 */

import { createLogger } from '../unifiedLogger';
import type { InputDriver, MouseButton, Point } from './inputDriverTypes';

export type { InputDriver } from './inputDriverTypes';

const logger = createLogger();

/** Minimal shape of the parts of nut.js this adapter uses. */
interface NutPointInstance {
  x: number;
  y: number;
}

export interface NutModule {
  mouse: {
    getPosition(): Promise<NutPointInstance>;
    setPosition(p: NutPointInstance): Promise<unknown>;
    click(button: number): Promise<unknown>;
    doubleClick(button: number): Promise<unknown>;
    pressButton(button: number): Promise<unknown>;
    releaseButton(button: number): Promise<unknown>;
    scrollDown(amount: number): Promise<unknown>;
    scrollUp(amount: number): Promise<unknown>;
    scrollLeft(amount: number): Promise<unknown>;
    scrollRight(amount: number): Promise<unknown>;
  };
  keyboard: {
    type(input: string): Promise<unknown>;
    pressKey(...keys: number[]): Promise<unknown>;
    releaseKey(...keys: number[]): Promise<unknown>;
  };
  Button: { LEFT: number; RIGHT: number; MIDDLE: number };
  Key: Record<string, number>;
  Point: new (x: number, y: number) => NutPointInstance;
}

/**
 * Normalize a friendly key name to a nut.js `Key` member name. Returns the
 * member name (not the numeric code) so the caller can resolve it against the
 * loaded module's `Key` map.
 */
export function nutKeyName(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (key.length === 0) return null;

  const aliases: Record<string, string> = {
    enter: 'Enter',
    return: 'Return',
    numenter: 'Enter',
    tab: 'Tab',
    esc: 'Escape',
    escape: 'Escape',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    cmd: 'LeftCmd',
    command: 'LeftCmd',
    meta: 'LeftSuper',
    super: 'LeftSuper',
    win: 'LeftSuper',
    ctrl: 'LeftControl',
    control: 'LeftControl',
    alt: 'LeftAlt',
    option: 'LeftAlt',
    shift: 'LeftShift',
  };
  if (aliases[key]) return aliases[key];

  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return `Num${key}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return `F${key.slice(1)}`;
  return null;
}

/** Adapter that maps {@link InputDriver} calls onto a loaded nut.js module. */
export class NutJsInputDriver implements InputDriver {
  constructor(private readonly nut: NutModule) {}

  private button(button: MouseButton): number {
    switch (button) {
      case 'left':
        return this.nut.Button.LEFT;
      case 'right':
        return this.nut.Button.RIGHT;
      case 'middle':
        return this.nut.Button.MIDDLE;
      default:
        throw new Error(`Unsupported mouse button: ${button}`);
    }
  }

  private resolveKey(name: string): number {
    const member = nutKeyName(name);
    const code = member ? this.nut.Key[member] : undefined;
    if (member === null || code === undefined) {
      throw new Error(`Unsupported key: ${name}`);
    }
    return code;
  }

  private point(p: Point): NutPointInstance {
    return new this.nut.Point(p.x, p.y);
  }

  /**
   * Read the OS cursor position, or `null` if the native module can't report it
   * (older nut.js) — in which case the caller leaves the cursor at the target.
   */
  private async readPosition(): Promise<Point | null> {
    try {
      const pos = await this.nut.mouse.getPosition();
      return { x: pos.x, y: pos.y };
    } catch {
      return null;
    }
  }

  /** Best-effort move of the OS cursor; a restore must never throw. */
  private async writePosition(p: Point): Promise<void> {
    try {
      await this.nut.mouse.setPosition(this.point(p));
    } catch {
      // Restoring the user's cursor is cosmetic; never surface a failure.
    }
  }

  /**
   * Run a pointer action that necessarily drives the OS cursor, then snap the
   * cursor back to where the user left it. Computer Use must not hijack the
   * user's real pointer: the on-screen "AI cursor" overlay (driven separately by
   * the manager) is what visualizes the action, while the user's hardware cursor
   * stays put — so the two cursors are visibly independent. The restore runs in a
   * `finally` so the cursor is returned even if the action throws. If the cursor
   * position can't be read, the action still runs (cursor simply stays at target).
   */
  private async preservingCursor(action: () => Promise<void>): Promise<void> {
    const home = await this.readPosition();
    try {
      await action();
    } finally {
      if (home) {
        await this.writePosition(home);
      }
    }
  }

  async moveMouse(p: Point): Promise<void> {
    await this.preservingCursor(async () => {
      await this.nut.mouse.setPosition(this.point(p));
    });
  }

  async click(p: Point, button: MouseButton = 'left'): Promise<void> {
    await this.preservingCursor(async () => {
      await this.nut.mouse.setPosition(this.point(p));
      await this.nut.mouse.click(this.button(button));
    });
  }

  async doubleClick(p: Point): Promise<void> {
    await this.preservingCursor(async () => {
      await this.nut.mouse.setPosition(this.point(p));
      await this.nut.mouse.doubleClick(this.nut.Button.LEFT);
    });
  }

  async drag(from: Point, to: Point): Promise<void> {
    await this.preservingCursor(async () => {
      await this.nut.mouse.setPosition(this.point(from));
      await this.nut.mouse.pressButton(this.nut.Button.LEFT);
      // Always release the button, even if the move-to-target throws: a press
      // without its matching release leaves the OS in a "button held" state, so
      // the next mouse move would drag-select across the user's real desktop.
      try {
        await this.nut.mouse.setPosition(this.point(to));
      } finally {
        await this.nut.mouse.releaseButton(this.nut.Button.LEFT);
      }
    });
  }

  async scroll(p: Point, dx: number, dy: number): Promise<void> {
    await this.preservingCursor(async () => {
      await this.nut.mouse.setPosition(this.point(p));
      if (dy > 0) await this.nut.mouse.scrollDown(dy);
      else if (dy < 0) await this.nut.mouse.scrollUp(-dy);
      if (dx > 0) await this.nut.mouse.scrollRight(dx);
      else if (dx < 0) await this.nut.mouse.scrollLeft(-dx);
    });
  }

  async typeText(text: string): Promise<void> {
    await this.nut.keyboard.type(text);
  }

  /**
   * Best-effort release of a held chord. nut.js `releaseKey(...codes)` reverses
   * internally and treats the LAST code as the key + the rest as modifier flags,
   * so it must be called with the SAME order as the matching `pressKey`. If that
   * chord release fails for any reason, fall back to releasing every code
   * individually (a single-key toggle is always valid) so a modifier — e.g. Cmd —
   * can never remain stuck down and hijack the user's subsequent input.
   */
  private async releaseChord(codes: number[]): Promise<void> {
    try {
      await this.nut.keyboard.releaseKey(...codes);
      return;
    } catch {
      // Fall through to per-key release below.
    }
    for (const code of [...codes].reverse()) {
      await this.nut.keyboard.releaseKey(code).catch(() => undefined);
    }
  }

  async pressKey(key: string): Promise<void> {
    const code = this.resolveKey(key);
    try {
      await this.nut.keyboard.pressKey(code);
    } finally {
      await this.releaseChord([code]);
    }
  }

  async hotkey(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      throw new Error('hotkey requires at least one key.');
    }
    const codes = keys.map((k) => this.resolveKey(k));
    // Release in the SAME order as the press: nut.js reverses internally and
    // treats the last code as the key + the rest as modifier flags. Releasing in
    // reverse made nut.js treat a non-modifier (e.g. Space) as a modifier flag
    // -> "Invalid key flag specified" -> the modifier (e.g. Cmd) was never
    // released and stuck down. The `finally` guarantees release even if the press
    // throws, so a failed chord can never leave a modifier held.
    try {
      await this.nut.keyboard.pressKey(...codes);
    } finally {
      await this.releaseChord(codes);
    }
  }
}

/** Stand-in used when the optional native dependency is unavailable. Never dispatches. */
export class NoopInputDriver implements InputDriver {
  private unavailable(): never {
    throw new Error('Input driver unavailable: @nut-tree-fork/nut-js is not installed.');
  }
  async moveMouse(): Promise<void> {
    this.unavailable();
  }
  async click(): Promise<void> {
    this.unavailable();
  }
  async doubleClick(): Promise<void> {
    this.unavailable();
  }
  async drag(): Promise<void> {
    this.unavailable();
  }
  async scroll(): Promise<void> {
    this.unavailable();
  }
  async typeText(): Promise<void> {
    this.unavailable();
  }
  async pressKey(): Promise<void> {
    this.unavailable();
  }
  async hotkey(): Promise<void> {
    this.unavailable();
  }
}

export type NutLoader = () => NutModule;

export interface InputDriverLoadResult {
  available: boolean;
  driver: InputDriver;
  reason?: string;
}

/** Real loader: requires the optional native module. Isolated so tests inject a fake instead. */
export const requireNutModule: NutLoader = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@nut-tree-fork/nut-js') as unknown as NutModule;

/**
 * Load the input driver. On success returns the nut.js-backed adapter; if the
 * optional dependency is missing (or fails to load) returns a Noop driver and a
 * reason, so the manager can surface a structured "input driver unavailable"
 * error instead of crashing.
 */
export function loadInputDriver(load: NutLoader = requireNutModule): InputDriverLoadResult {
  try {
    const mod = load();
    return { available: true, driver: new NutJsInputDriver(mod) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`[ComputerUse] input driver unavailable: ${reason}`);
    return { available: false, driver: new NoopInputDriver(), reason };
  }
}
