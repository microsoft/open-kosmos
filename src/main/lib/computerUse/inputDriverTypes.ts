/**
 * Input driver interface — kept separate from the nut.js adapter so the manager
 * and tests can depend on the contract without importing the native module.
 */

import type { MouseButton, Point } from './types';

export type { MouseButton, Point } from './types';

export interface InputDriver {
  moveMouse(p: Point): Promise<void>;
  click(p: Point, button?: MouseButton): Promise<void>;
  doubleClick(p: Point): Promise<void>;
  drag(from: Point, to: Point): Promise<void>;
  scroll(p: Point, dx: number, dy: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  hotkey(keys: string[]): Promise<void>;
}
