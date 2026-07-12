import { useSyncExternalStore } from 'react';

const NOOP = () => {};
const EMPTY = Symbol('EMPTY');

/**
 * useSyncExternalStore requires getSnapshot not to return a fresh object every time.
 * external breaks that constraint by caching the value returned by calc and
 * recomputing it only when sub emits an update.
 * @equal compares old and new values; returning true keeps the old cached value.
 */
export function external(sub: (update: VoidFunction) => VoidFunction) {
  return function <T>(
    calc: () => T,
    equal: ((prev: T, next: T) => boolean) = Object.is,
  ) {
    const listeners = new Set<VoidFunction>();
    let value: T | typeof EMPTY = EMPTY;
    let cleanup = NOOP;

    function get() {
      if (value === EMPTY) value = calc();
      return value;
    }

    function register() {
      const off = sub(() => {
        const next = calc();
        if (equal(get(), next)) return;
        value = next;
        listeners.forEach(l => l());
      });
      cleanup = () => {
        off();
        cleanup = NOOP;
        value = EMPTY;
      };
    }

    function listen(update: VoidFunction) {
      listeners.add(update);
      if (listeners.size === 1) register();
      return () => {
        listeners.delete(update);
        if (listeners.size === 0) cleanup();
      };
    }

    function use() {
      return useSyncExternalStore(listen, get, get);
    }
    return { use };
  }
}
