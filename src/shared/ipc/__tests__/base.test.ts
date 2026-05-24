import { connectRenderToMain, connectMainToRender } from '../base';

describe('connectRenderToMain', () => {
  describe('bindMain', () => {
    it('returns a proxy that registers handlers via ipc.handle', () => {
      const handlers: Record<string, Function> = {};
      const mockIpcMain = {
        handle: (ch: string, fn: Function) => { handlers[ch] = fn; },
        removeHandler: (_ch: string) => {},
      } as any;

      const { bindMain } = connectRenderToMain('test');
      const main = bindMain(mockIpcMain);
      const handler = vi.fn();
      main.someChannel(handler);

      expect(handlers['test:someChannel']).toBe(handler);
    });

    it('removes existing handler before registering new one', () => {
      const removedChannels: string[] = [];
      const mockIpcMain = {
        handle: vi.fn(),
        removeHandler: (ch: string) => { removedChannels.push(ch); },
      } as any;

      const { bindMain } = connectRenderToMain('prefix');
      const main = bindMain(mockIpcMain);
      main.ch1(vi.fn());

      expect(removedChannels).toContain('prefix:ch1');
    });

    it('works without prefix', () => {
      const handlers: Record<string, Function> = {};
      const mockIpcMain = {
        handle: (ch: string, fn: Function) => { handlers[ch] = fn; },
        removeHandler: vi.fn(),
      } as any;

      const { bindMain } = connectRenderToMain();
      const main = bindMain(mockIpcMain);
      const handler = vi.fn();
      main.myChannel(handler);

      expect(handlers['myChannel']).toBe(handler);
    });

    it('returns the same proxy on subsequent calls', () => {
      const mockIpcMain = { handle: vi.fn(), removeHandler: vi.fn() } as any;
      const { bindMain } = connectRenderToMain('x');
      const a = bindMain(mockIpcMain);
      const b = bindMain(mockIpcMain);
      expect(a).toBe(b);
    });

    it('caches channel functions', () => {
      const mockIpcMain = { handle: vi.fn(), removeHandler: vi.fn() } as any;
      const { bindMain } = connectRenderToMain('x');
      const main = bindMain(mockIpcMain);
      const fn1 = main.ch;
      const fn2 = main.ch;
      expect(fn1).toBe(fn2);
    });
  });

  describe('bindRender', () => {
    it('creates a proxy that calls invoke with prefixed channel', async () => {
      const invoke = vi.fn().mockResolvedValue('result');
      const { bindRender } = connectRenderToMain<any>('api');
      const render = bindRender(invoke);

      const result = await render.getData('arg1', 'arg2');
      expect(invoke).toHaveBeenCalledWith('api:getData', 'arg1', 'arg2');
      expect(result).toBe('result');
    });

    it('works without prefix', async () => {
      const invoke = vi.fn().mockResolvedValue(42);
      const { bindRender } = connectRenderToMain<any>();
      const render = bindRender(invoke);

      await render.hello();
      expect(invoke).toHaveBeenCalledWith('hello');
    });

    it('caches channel functions', () => {
      const invoke = vi.fn();
      const { bindRender } = connectRenderToMain<any>('p');
      const render = bindRender(invoke);
      expect(render.x).toBe(render.x);
    });
  });

  describe('provideInvokeForPreload', () => {
    it('allows whitelisted channels with prefix', () => {
      const mockIpc = { invoke: vi.fn().mockResolvedValue('ok') } as any;
      const { provideInvokeForPreload } = connectRenderToMain<any>('ns');
      const invoke = provideInvokeForPreload(mockIpc, ['allowed'] as any);

      invoke('ns:allowed', 'data');
      expect(mockIpc.invoke).toHaveBeenCalledWith('ns:allowed', 'data');
    });

    it('throws for non-whitelisted channels with prefix', () => {
      const mockIpc = { invoke: vi.fn() } as any;
      const { provideInvokeForPreload } = connectRenderToMain<any>('ns');
      const invoke = provideInvokeForPreload(mockIpc, ['allowed'] as any);

      expect(() => invoke('ns:forbidden')).toThrow('Channel "ns:forbidden" is not allowed');
    });

    it('allows whitelisted channels without prefix', () => {
      const mockIpc = { invoke: vi.fn().mockResolvedValue('ok') } as any;
      const { provideInvokeForPreload } = connectRenderToMain<any>();
      const invoke = provideInvokeForPreload(mockIpc, ['myChannel'] as any);

      invoke('myChannel');
      expect(mockIpc.invoke).toHaveBeenCalledWith('myChannel');
    });

    it('throws for non-whitelisted channels without prefix', () => {
      const mockIpc = { invoke: vi.fn() } as any;
      const { provideInvokeForPreload } = connectRenderToMain<any>();
      const invoke = provideInvokeForPreload(mockIpc, ['myChannel'] as any);

      expect(() => invoke('other')).toThrow('Channel "other" is not allowed');
    });
  });
});

describe('connectMainToRender', () => {
  describe('bindWebContents', () => {
    it('creates a proxy that sends messages via webContents.send with prefix', () => {
      const mockWc = { send: vi.fn() } as any;
      const { bindWebContents } = connectMainToRender('events');
      const sender = bindWebContents(mockWc);

      sender.update({ data: 123 });
      expect(mockWc.send).toHaveBeenCalledWith('events:update', { data: 123 });
    });

    it('works without prefix', () => {
      const mockWc = { send: vi.fn() } as any;
      const { bindWebContents } = connectMainToRender();
      const sender = bindWebContents(mockWc);

      sender.notify('hello');
      expect(mockWc.send).toHaveBeenCalledWith('notify', 'hello');
    });

    it('caches proxy per WebContents instance', () => {
      const mockWc = { send: vi.fn() } as any;
      const { bindWebContents } = connectMainToRender('x');
      expect(bindWebContents(mockWc)).toBe(bindWebContents(mockWc));
    });

    it('creates different proxies for different WebContents', () => {
      const wc1 = { send: vi.fn() } as any;
      const wc2 = { send: vi.fn() } as any;
      const { bindWebContents } = connectMainToRender('x');
      expect(bindWebContents(wc1)).not.toBe(bindWebContents(wc2));
    });

    it('caches channel functions on the proxy', () => {
      const mockWc = { send: vi.fn() } as any;
      const { bindWebContents } = connectMainToRender('x');
      const sender = bindWebContents(mockWc);
      expect(sender.ch).toBe(sender.ch);
    });
  });

  describe('bindRender', () => {
    it('registers listener via on and returns unsubscribe function', () => {
      const listeners: Record<string, Function> = {};
      const on = vi.fn((ch: string, fn: Function) => { listeners[ch] = fn; });
      const off = vi.fn();

      const { bindRender } = connectMainToRender('evt');
      const handler = bindRender(on as any, off as any);

      const cb = vi.fn();
      const unsub = handler.message(cb);
      expect(on).toHaveBeenCalledWith('evt:message', cb);

      unsub();
      expect(off).toHaveBeenCalledWith('evt:message', cb);
    });

    it('works without prefix', () => {
      const on = vi.fn();
      const off = vi.fn();
      const { bindRender } = connectMainToRender();
      const handler = bindRender(on as any, off as any);

      const cb = vi.fn();
      handler.ping(cb);
      expect(on).toHaveBeenCalledWith('ping', cb);
    });

    it('returns the same proxy on subsequent calls', () => {
      const on = vi.fn();
      const off = vi.fn();
      const { bindRender } = connectMainToRender('e');
      const a = bindRender(on as any, off as any);
      const b = bindRender(on as any, off as any);
      expect(a).toBe(b);
    });

    it('caches channel functions', () => {
      const on = vi.fn();
      const off = vi.fn();
      const { bindRender } = connectMainToRender('e');
      const handler = bindRender(on as any, off as any);
      expect(handler.x).toBe(handler.x);
    });
  });
});
