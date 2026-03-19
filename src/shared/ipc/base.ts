import { type IpcMain, type IpcRenderer, type WebContents, type IpcMainInvokeEvent, type IpcRendererEvent } from 'electron';

/** Generic invoke signature, can come from ipcRenderer.invoke or preload-exposed bridge functions */
export type InvokeFn = (channel: string, ...args: any[]) => Promise<any>;
export type OnOff = (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => void;

/**
 * ----------------------------------------------------------------------------------------------------
 * Type utilities: Define call interface from renderer process to main process
 * ----------------------------------------------------------------------------------------------------
 */
interface Invoke<In extends any[], Out = void> {
  call: In;
  return: Out;
}
type RenderToMain = Record<string, Invoke<any[], any>>;
type MainListener<I extends any[], O> = (event: IpcMainInvokeEvent, ...args: I) => O | Promise<O>;

export type MapMainHandle<T extends RenderToMain> = {
  [K in keyof T]: (fn: MainListener<T[K]['call'], T[K]['return']>) => void;
};
export type MapRenderInvoke<T extends RenderToMain> = {
  [K in keyof T]: (...args: T[K]['call']) => Promise<T[K]['return']>;
};

export function connectRenderToMain<RM extends RenderToMain>(prefix?: string) {
  let main_handle: MapMainHandle<RM> | undefined;
  /**
   * call this in main process to provide ipc handlers
   */
  function bindMain(ipc: IpcMain) {
    if (!main_handle) {
      main_handle = new Proxy({} as MapMainHandle<RM>, {
        get(target: any, ch: string) {
          const key = prefix ? `${prefix}:${String(ch)}` : String(ch);
          const val = target[ch];
          return val || (target[ch] = (fn: MainListener<any[], any>) => {
            ipc.removeHandler(key); // Remove existing handler to prevent duplicate registration
            ipc.handle(key, fn)
          });
        },
      });
    }
    return main_handle!;
  }

  /**
   * call this in render process to provide api to invoke main handlers
   */
  function bindRender(invoke: InvokeFn) {
    const proxy = new Proxy({}, {
      get(target: any, ch: string) {
        const key = prefix ? `${prefix}:${String(ch)}` : String(ch);
        const val = target[ch];
        return val || (target[ch] = (...args: any[]) => invoke(key, ...args));
      }
    });
    return proxy as MapRenderInvoke<RM>;
  }

  type Keys = keyof RM;
  /**
   * call this in preload process to provide a safe invoke function with whitelist
   */
  function provideInvokeForPreload<T extends Keys[]>(
    ipc: IpcRenderer,
    args: [Keys] extends [T[number]]
      ? T
      : ["Missing key, you should provide all keys", Exclude<Keys, T[number]>]
  ) {
    const set = new Set(args);
    let allow = (ch: string) => set.has(ch);
    if (prefix) {
      allow = (ch: string) => {
        const keys = ch.split(':');
        return keys[0] === prefix && set.has(keys[1]);
      };
    }
    const invoke: InvokeFn = (channel: string, ...args: any[]) => {
      if (!allow(channel)) {
        throw new Error(`Channel "${channel}" is not allowed`);
      }
      return ipc.invoke(channel, ...args);
    };
    return invoke;
  }

  return { bindMain, bindRender, provideInvokeForPreload };
}


/**
 * ----------------------------------------------------------------------------------------------------
 * Type utilities: Define call interface from main process to renderer process
 * ----------------------------------------------------------------------------------------------------
 */
type MainToRender = Record<string, any>;
type RenderListener<P> = (event: IpcRendererEvent, payload: P) => void;
export type MapMainInvoke<T> = {
  [K in keyof T]: (payload: T[K]) => void;
};
export type MapRenderHandle<T extends MainToRender> = {
  [K in keyof T]: (fn: RenderListener<T[K]>) => Function;
};

export function connectMainToRender<MR extends MainToRender = MainToRender>(prefix?: string) {
  const wc_cache = new WeakMap<WebContents, MapMainInvoke<MR>>();
  /**
   * call this in main process to send messages to render process
   */
  function bindWebContents(wc: WebContents): MapMainInvoke<MR> {
    if (!wc_cache.has(wc)) {
      const proxy = new Proxy({}, {
        get(target: any, ch: string) {
          const key = prefix ? `${prefix}:${String(ch)}` : String(ch);
          const val = target[ch];
          return val || (target[ch] = (payload: any) => wc.send(key, payload));
        },
      });
      wc_cache.set(wc, proxy);
    }
    return wc_cache.get(wc)!;
  }

  let render_handler: MapRenderHandle<MR> | undefined;
  /**
   * call this in render process to handle messages from main process
   */
  function bindRender(on: OnOff, off: OnOff) {
    if (!render_handler) {
      render_handler = new Proxy({} as MapRenderHandle<MR>, {
        get(target: any, ch: string) {
          const key = prefix ? `${prefix}:${String(ch)}` : String(ch);
          const val = target[ch];
          return val || (target[ch] = (fn: RenderListener<any>) => {
            on(key, fn);
            return () => off(key, fn);
          });
        },
      });
    }
    return render_handler!;
  }

  return { bindWebContents, bindRender };
}
