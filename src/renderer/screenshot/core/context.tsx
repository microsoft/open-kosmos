import { createContext, useMemo, useSyncExternalStore, useContext } from 'react';
import type {  FC, PropsWithChildren } from 'react';

type Reduce<T> = (data: T) => T;
type Set<T> = (ch: Reduce<T> | T) => void;

interface State<T, A>  {
  readonly get: () => T;
  readonly set: Set<T>;
  readonly use: () => T;
  readonly listen: (cb: VoidFunction) => VoidFunction;
  readonly actions: A;
  readonly onlyView: boolean;
}
type Use = <T, A>(sub: SubModel<T, A>) => [T, A];
type UseV = <T>(sub: SubModel<T, any>) => T;
type Create<T, A> = (set: Set<T>, get: () => T, model: Model) => A;
type CacheItem<T> = { value: T, set: (v: T) => void };

export const uuid = () => Math.round((Math.random() + 1) * Date.now()).toString(36);

export function generate<T>(val: T) {
  const listener = new Set<VoidFunction>();
  const get = () => val;
  function set(ch: T | ((prev: T) => T)) {
    const next = (typeof ch === 'function') ? (ch as (prev: T) => T)(val) : ch;
    if (Object.is(val, next)) return;
    val = next;
    listener.forEach(call => call());
  }
  const listen = (call: VoidFunction) => {
    listener.add(call);
    return () => listener.delete(call);
  };
  const use = () => useSyncExternalStore(listen, get, get);
  return { get, set, use, listen };
}

class SubModel<T, A> {
  constructor(
    public readonly name: string,
    private make: () => T,
    private create: Create<T, A>,
    private onlyView = false,
  ) {}

  public gen(model: Model): State<T, A> {
    const { make, create, onlyView } = this;
    const { get, set, use, listen } = generate(make());
    const actions = create(set, get, model);
    return { get, set, use, listen, actions, onlyView };
  }

  use(): [T, A] {
    const { query } = useContext(Context);
    const { use, actions } = query(this);
    return [use(), actions];
  }
  useData(): T {
    const { query } = useContext(Context);
    return query(this).use();
  }
  useCreation(): A {
    const { query } = useContext(Context);
    return query(this).actions;
  }
}

type SnapShopt = [name: string, data: any];
class Model {
  private ustack: SnapShopt[][] = [];
  private rstack: SnapShopt[][] = [];
  private transaction = 0;
  private backup = new Map<string, any>();
  private stackListeners = new Set<() => void>();
  public readonly stackState: readonly [boolean, boolean] = [false, false];

  constructor(
    private readonly store: Map<string, State<any, any>>,
    public readonly use: Use,
  ) {}

  public readonly listenStackState = (cb: () => void) => {
    this.stackListeners.add(cb);
    return () => this.stackListeners.delete(cb);
  }

  private triggerStackState() {
    // @ts-expect-error
    this.stackState = [this.canUndo(), this.canRedo()];
    this.stackListeners.forEach(call => call());
  }

  private getStackState = () => this.stackState;
  public useStackState() {
    const get = this.getStackState;
    return useSyncExternalStore(this.listenStackState, get, get);
  }

  public log() {
    console.log('undo stack:', this.ustack);
    console.log('redo stack:', this.rstack);
    const snapshots: Record<string, any> = {};
    this.store.forEach((state, name) => {
      snapshots[name] = state.get();
    });
    console.log('current state:', snapshots);
  }

  public undo() {
    const { ustack, rstack, store } = this;
    const item = ustack.pop();
    if (!item) return;
    const step: SnapShopt[] = [];
    item.forEach(([name, data]) => {
      const { get, set } = store.get(name)!;
      step.push([name, get()]);
      set(data);
    });
    rstack.push(step);
    this.triggerStackState();
  }

  public redo() {
    const { ustack, rstack, store } = this;
    const item = rstack.pop();
    if (!item) return;
    const step: SnapShopt[] = [];
    item.forEach(([name, data]) => {
      const { get, set } = store.get(name)!;
      step.push([name, get()]);
      set(data);
    });
    ustack.push(step);
    this.triggerStackState();
  }

  public canUndo() {
    return this.ustack.length > 0;
  }

  public canRedo() {
    return this.rstack.length > 0;
  }

  public startTransaction() {
    if (this.transaction === 0) {
      this.backup.clear();
      this.store.forEach((state, name) => {
        if (state.onlyView) return;
        this.backup.set(name, state.get());
      });
    }
    this.transaction += 1;
    return this.endTransaction;
  }

  public endTransaction = () => {
    this.transaction -= 1;
    if (this.transaction === 0) {
      const changes: SnapShopt[] = [];
      this.store.forEach((state, name) => {
        if (state.onlyView) return;
        const before = this.backup.get(name);
        if (Object.is(before, state.get())) return;
        changes.push([name, before]);
      });
      this.backup.clear();
      if (changes.length === 0) return;
      this.ustack.push(changes);
      this.rstack.length = 0;
      this.triggerStackState();
    }
  }
}

function build() {
  const store = new Map<string, State<any, any>>();
  const cache: { [k: string]: CacheItem<any> } = {};
  const mem: Record<string, any> = {};

  function use<T, A>(m: SubModel<T, A>): [T, A] {
    const state = query(m);
    return [state.get(), state.actions];
  }

  const model = new Model(store, use);
  // @ts-ignore
  window.__md__ = model;

  function query<T, A>(m: SubModel<T, A>): State<T, A> {
    const exist = store.get(m.name);
    if (exist) return exist as State<T, A>;
    const created = m.gen(model);
    store.set(m.name, created);
    return created;
  };

  return { query, model, mem, use, cache }
}

const Context = createContext(build());

export function useModel() {
  return useContext(Context).model;
}

export function useCache<T>(key: string, defaultValue: T): CacheItem<T> {
  const { cache } = useContext(Context);
  let item = cache[key];
  if (item === undefined) {
    item = { value: defaultValue, set: (v) => cache[key].value = v };
    cache[key] = item;
  }
  return item;
}

export const ModelProvider: FC<PropsWithChildren> = (p) => (
  <Context.Provider value={useMemo(build, [])}>
    {p.children}
  </Context.Provider>
);

function defineModel<T, A>(name: string, make: () => T, create: Create<T, A>) {
  return new SubModel<T, A>(name, make, create);
}

const defaultCreate: Create<any, Set<any>> = (set) => set;
function defineView<T, A>(name: string, make: () => T, create: Create<T, A>): SubModel<T, A>
function defineView<T>(name: string, make: () => T): SubModel<T, Set<T>>
function defineView<T>(name: string, make: () => T, create?: any): any {
  return new SubModel<T, any>(name, make, create ?? defaultCreate, true);
}

function memoize<T>(init: (use: Use, model: Model) => T) {
  const id = uuid();
  return {
    use(): T {
      const { mem, model, use } = useContext(Context);
      const fn = mem[id] || (mem[id] = init(use, model));
      return fn as T;
    },
  };
}

function compute<T>(calc: (use: UseV) => T) {
  const id = uuid();
  return {
    use(): T {
      const { mem, query } = useContext(Context);
      let state: ReturnType<typeof generate<T>> = mem[id];
      if (state) return state.use();

      const deps = new Set<SubModel<any, any>>();
      let usev = (m: SubModel<any, any>) => (deps.add(m), query(m).get());
      mem[id] = state = generate<T>(calc(usev));
      if (deps.size) {
        usev = m => query(m).get();
        const update = () => state.set(calc(usev));
        deps.forEach(m => query(m).listen(update));
      }
      return state.use();
    },
  }
}

export const define = {
  model: defineModel,
  view: defineView,
  memoize,
  compute,
};
