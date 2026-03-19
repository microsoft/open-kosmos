import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { FC, PropsWithChildren } from 'react';

const uuid = () => Math.round((Math.random() + 1) * Date.now()).toString(36);
const UNIQ = Symbol('BUILD');

type Listen<T> = (cb: (data: T) => void) => VoidFunction;
type Reduce<T> = (data: T) => T;
type Creator<T, A> = (get: () => T, set: Change<T>, use: UseAtom) => A;
export type Change<T> = (ch: Reduce<T> | T) => void;
interface ReadonlyState<T> {
  get: () => T;
  listen: Listen<T>;
  use: () => T;
}
interface ValueState<T> extends ReadonlyState<T> {
  change: Change<T>;
}
interface ActionState<T, A> extends ReadonlyState<T> {
  actions: A;
}
export type AnyAtom<T = any> = ValueAtom<T> | ActionAtom<T, any> | ComputedAtom<T>;
export interface Query {
  <T>(atom: ComputedAtom<T>): ReadonlyState<T>;
  <T, A>(atom: ActionAtom<T, A>): ActionState<T, A>;
  <T>(atom: ValueAtom<T>): ValueState<T>;
  <T>(atom: AnyAtom<T>): ReadonlyState<T>;
}
export interface UseAtom {
  <T>(atom: ComputedAtom<T>): T;
  <T, A>(atom: ActionAtom<T, A>): [T, A];
  <T>(atom: ValueAtom<T>): [T, Change<T>];
}
export type UseData = <T>(atom: AnyAtom<T>) => T;

function generate<T>(val: T) {
  const listener = new Set<(val: T) => void>();
  const change: Change<T> = (ch) => {
    const next = (typeof ch === 'function') ? (ch as Reduce<T>)(val) : ch;
    if (Object.is(val, next)) return;
    val = next;
    listener.forEach(call => call(next));
  };
  const listen: Listen<T> = (call) => {
    listener.add(call);
    return () => listener.delete(call);
  };
  const get = () => val;
  const use = () => useSyncExternalStore(listen, get, get);
  return { get, change, listen, use };
}

class ValueAtom<T> {
  public readonly type = 'v' as const;
  public readonly key = uuid();
  public proxy?: (get: () => T, set: Change<T>) => Change<T>;
  constructor(private init: T) {}

  public [UNIQ](): ValueState<T> {
    const state = generate(this.init);
    if (this.proxy) {
      state.change = this.proxy(state.get, state.change);
    }
    return state;
  }

  public useDataOnly(): T {
    return useContext(Context)(this).use();
  }

  public useData(): [T, Change<T>] {
    const { use, change } = useContext(Context)(this);
    return [use(), change];
  }

  public useChange(): Change<T> {
    return useContext(Context)(this).change;
  }
}

const _q_2_u_ = new WeakMap<Query, UseAtom>();
function buildUseFromQuery(query: Query): UseAtom {
  if (_q_2_u_.has(query)) return _q_2_u_.get(query)!;
  function use(atom: AnyAtom) {
    switch (atom.type) {
      case 'c': return query(atom).get();
      case 'v': {
        const { get, change } = query(atom);
        return [get(), change];
      }
      case 'a': {
        const { get, actions } = query(atom);
        return [get(), actions];
      }
    }
  }
  return (_q_2_u_.set(query, use), use);
}

class ActionAtom<T, A> {
  public readonly type = 'a' as const;
  public readonly key = uuid();
  constructor(
    private readonly init: T,
    private readonly creator: Creator<T, A>) {}

  public [UNIQ](query: Query): ActionState<T, A> {
    const state = generate(this.init);
    const use = buildUseFromQuery(query);
    const actions = this.creator(state.get, state.change, use);
    Object.assign(state, { actions });
    return state as any;
  }

  public useDataOnly(): T {
    return useContext(Context)(this).use();
  }

  public useData(): [T, A] {
    const { use, actions } = useContext(Context)(this);
    return [use(), actions];
  }

  public useChange(): A {
    return useContext(Context)(this).actions;
  }
}

class ComputedAtom<T> {
  public readonly type = 'c' as const;
  public readonly key = uuid();
  constructor(private readonly calc: (use: UseData) => T) {}

  public [UNIQ](query: Query): ReadonlyState<T> {
    const deps: AnyAtom[] = [];
    let use = (atom: AnyAtom) => (deps.push(atom), query(atom).get());
    const state = generate(this.calc(use));
    if (deps.length > 0) {
      use = (atom: AnyAtom) => query(atom).get();
      const update = () => state.change(this.calc(use));
      deps.forEach((a) => query(a).listen(update));
    }
    return state;
  }

  public useData(): T {
    return useContext(Context)(this).use();
  }
}

export function atom<T>(initial: (use: UseData) => T): ComputedAtom<T>;
export function atom<T, A>(initial: T, creator: Creator<T, A>): ActionAtom<T, A>;
export function atom<T>(initial: T): ValueAtom<T>;
export function atom(a: any, b?: any) {
  if (typeof a === 'function') return new ComputedAtom(a);
  if (b) return new ActionAtom(a, b);
  return new ValueAtom(a);
}

function build(): Query {
  const map: { [k: string]: any } = {};
  return function query(atom: AnyAtom) {
    return map[atom.key] || (map[atom.key] = atom[UNIQ](query));
  }
}
const Context = createContext(build());
const Root = Context.Provider;
export const WithStore: FC<PropsWithChildren> = (p) => <Root value={useMemo(build, [])}>{p.children}</Root>;

export function mutate<T extends Function>(init: (use: UseAtom) => T) {
  const cache = new WeakMap<Query, T>();
  return {
    use(): T {
      const query = useContext(Context);
      if (cache.has(query)) return cache.get(query)!;
      const result = init(buildUseFromQuery(query));
      return (cache.set(query, result), result);
    }
  }
}