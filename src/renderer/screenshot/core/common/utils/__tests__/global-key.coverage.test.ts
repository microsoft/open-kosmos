/** @vitest-environment happy-dom */
/**
 * Coverage tests for src/renderer/screenshot/core/common/utils/global-key.ts
 * Covers: DownKey, Manager (globalKey default export), keydown named export
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalKey, { keydown } from '../global-key';

// Reset modifier-key state between tests by firing a blur event
beforeEach(() => {
  window.dispatchEvent(new Event('blur'));
});

// ─── DownKey ─────────────────────────────────────────────────────────────────
describe('DownKey (keydown singleton)', () => {
  it('has() returns false when no key is pressed', () => {
    expect(keydown.has('Shift')).toBe(false);
    expect(keydown.has('Ctrl')).toBe(false);
    expect(keydown.has('Alt')).toBe(false);
    expect(keydown.has('Meta')).toBe(false);
  });

  it('has("Shift") returns true after shiftKey keydown', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { shiftKey: true }));
    expect(keydown.has('Shift')).toBe(true);
  });

  it('has("Ctrl") returns true after ctrlKey keydown', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
    expect(keydown.has('Ctrl')).toBe(true);
  });

  it('has("Alt") returns true after altKey keydown', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    expect(keydown.has('Alt')).toBe(true);
  });

  it('has("Meta") returns true after metaKey keydown', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true }));
    expect(keydown.has('Meta')).toBe(true);
  });

  it('has("Shift") returns false after key is released (keyup with shiftKey=false)', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { shiftKey: true }));
    expect(keydown.has('Shift')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { shiftKey: false }));
    expect(keydown.has('Shift')).toBe(false);
  });

  it('onChange callback fires when modifier state changes', () => {
    const listener = vi.fn();
    const unsub = keydown.onChange(listener);
    document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it('onChange callback does NOT fire when state is unchanged', () => {
    // Start with ctrl pressed
    document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
    const listener = vi.fn();
    const unsub = keydown.onChange(listener);
    // Fire same state again — no change
    document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it('unsub from onChange stops receiving updates', () => {
    const listener = vi.fn();
    const unsub = keydown.onChange(listener);
    unsub();
    document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    expect(listener).not.toHaveBeenCalled();
  });

  it('window blur resets state to 0000', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { shiftKey: true }));
    expect(keydown.has('Shift')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(keydown.has('Shift')).toBe(false);
  });

  it('multiple onChange listeners all fire', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    const u1 = keydown.onChange(l1);
    const u2 = keydown.onChange(l2);
    document.dispatchEvent(new KeyboardEvent('keydown', { shiftKey: true }));
    expect(l1).toHaveBeenCalled();
    expect(l2).toHaveBeenCalled();
    u1();
    u2();
  });
});

// ─── Manager (globalKey default export) ──────────────────────────────────────
describe('Manager / globalKey', () => {
  it('on() registers a listener that receives (event, is) on keydown', () => {
    const cb = vi.fn();
    const off = globalKey.on(cb);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cb).toHaveBeenCalled();
    const [, is] = cb.mock.calls[0];
    expect(is).toMatchObject({ Escape: true });
    off();
  });

  it('is object maps the pressed key to true', () => {
    const cb = vi.fn();
    const off = globalKey.on(cb);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(cb.mock.calls[0][1]).toMatchObject({ Enter: true });
    off();
  });

  it('off() removes the listener so it no longer fires', () => {
    const cb = vi.fn();
    const off = globalKey.on(cb);
    off();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('higher-priority listener runs first', () => {
    const order: number[] = [];
    const cb1 = vi.fn(() => order.push(1));
    const cb2 = vi.fn(() => order.push(2));
    const off1 = globalKey.on(cb1, 1);   // default priority
    const off2 = globalKey.on(cb2, 10);  // higher priority — runs first
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(order[0]).toBe(2);
    expect(order[1]).toBe(1);
    off1();
    off2();
  });

  it('stopPropagation() inside a listener prevents later listeners from firing', () => {
    const cb1 = vi.fn((event: KeyboardEvent) => { event.stopPropagation(); });
    const cb2 = vi.fn();
    const off1 = globalKey.on(cb1, 10); // higher priority
    const off2 = globalKey.on(cb2, 1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
    expect(cb1).toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    off1();
    off2();
  });

  it('on() returns an off function that unregisters via off()', () => {
    const cb = vi.fn();
    const off = globalKey.on(cb);
    expect(typeof off).toBe('function');
    off();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple on() calls with same priority ordered by registration time', () => {
    const order: string[] = [];
    const cbA = vi.fn(() => order.push('A'));
    const cbB = vi.fn(() => order.push('B'));
    const offA = globalKey.on(cbA, 5);
    const offB = globalKey.on(cbB, 5);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    // Same priority → earlier registration runs first
    expect(order[0]).toBe('A');
    offA();
    offB();
  });
});
