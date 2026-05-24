import { useSyncExternalStore } from 'react';

const NOOP = () => {};
const EMPTY = Symbol('EMPTY');

/**
 * useSyncExternalStore 的 getSnapshot 要求: 绝对不能每次都返回新对象，external 方法是为了打破这个限制而设计的
 * @calc 函数可以返回任意对象，external 会缓存这个对象，并且只有当 sub 触发更新时才会重新计算这个对象
 * @equal 函数可以用来比较新旧对象，如果返回 true，则使用旧对象，否则使用新对象
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
