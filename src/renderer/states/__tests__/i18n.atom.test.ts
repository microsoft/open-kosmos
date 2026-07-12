import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetConfigRevision = vi.hoisted(() => vi.fn());
const mockSubscribe = vi.hoisted(() => vi.fn());
const mockFetchLatestConfig = vi.hoisted(() => vi.fn());
const mockUpdateConfig = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const subscriptionCallbacks = vi.hoisted(() => [] as Array<(config: any) => void>);

vi.mock('@/lib/userData/appDataManager', () => ({
  appDataManager: {
    getConfig: mockGetConfig,
    getConfigRevision: mockGetConfigRevision,
    subscribe: mockSubscribe,
    fetchLatestConfig: mockFetchLatestConfig,
    updateConfig: mockUpdateConfig,
  },
}));
vi.mock('@/lib/utilities/logger', () => ({
  createLogger: () => ({
    error: mockLoggerError,
  }),
}));

function buildStore() {
  const map: Record<string, any> = {};
  function query(atom: any): any {
    const key: string = atom.key;
    if (map[key]) return map[key];
    const ownSymbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(atom));
    const buildSymbol = ownSymbols.find((s) => s.toString().includes('BUILD'));
    if (!buildSymbol) throw new Error('Cannot find atom build symbol');
    map[key] = (atom as any)[buildSymbol](query);
    return map[key];
  }
  return query;
}

async function loadState(initialConfig: any = {}) {
  vi.resetModules();
  subscriptionCallbacks.length = 0;
  mockGetConfig.mockReturnValue(initialConfig);
  mockSubscribe.mockImplementation((cb: (config: any) => void) => {
    subscriptionCallbacks.push(cb);
    return () => {};
  });
  const { UiLanguageAtom } = await import('../i18n.atom');
  const state = buildStore()(UiLanguageAtom);
  return state;
}

describe('UiLanguageAtom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateConfig.mockResolvedValue({ success: true });
    mockFetchLatestConfig.mockResolvedValue(null);
    mockGetConfigRevision.mockReturnValue(0);
  });

  it('initializes from app config and subscribes to config updates', async () => {
    const state = await loadState({ uiLanguage: 'zh-CN' });

    expect(state.get()).toBe('zh-CN');
    expect(mockSubscribe).toHaveBeenCalledWith(expect.any(Function));
  });

  it('defaults to English for unsupported config values', async () => {
    const state = await loadState({ uiLanguage: 'fr' });

    expect(state.get()).toBe('en');
  });

  it('updates from app config subscriptions and ignores duplicate language pushes', async () => {
    const state = await loadState({ uiLanguage: 'en' });
    const callback = subscriptionCallbacks[0];

    callback({ uiLanguage: 'zh-CN' });
    expect(state.get()).toBe('zh-CN');

    callback({ uiLanguage: 'zh-CN' });
    expect(state.get()).toBe('zh-CN');
  });

  it('hydrates from an immediate latest-config fetch when the initial cache is stale', async () => {
    let resolveFetch: (config: any) => void = () => {};
    mockFetchLatestConfig.mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve; }));
    const state = await loadState({});

    expect(state.get()).toBe('en');
    resolveFetch({ uiLanguage: 'zh-CN' });
    await Promise.resolve();

    expect(mockFetchLatestConfig).toHaveBeenCalledWith({ cache: false });
    expect(state.get()).toBe('zh-CN');
  });

  it('does not let a stale startup fetch override a manual language change', async () => {
    let resolveFetch: (config: any) => void = () => {};
    mockFetchLatestConfig.mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve; }));
    const state = await loadState({});

    await state.actions.setLanguage('zh-CN');
    resolveFetch({ uiLanguage: 'en' });
    await Promise.resolve();

    expect(state.get()).toBe('zh-CN');
  });

  it('does not let a stale startup fetch override a newer subscription update', async () => {
    let resolveFetch: (config: any) => void = () => {};
    mockFetchLatestConfig.mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve; }));
    const state = await loadState({ uiLanguage: 'en' });
    const callback = subscriptionCallbacks[0];

    callback({ uiLanguage: 'zh-CN' });
    expect(state.get()).toBe('zh-CN');

    resolveFetch({ uiLanguage: 'en' });
    await Promise.resolve();

    expect(state.get()).toBe('zh-CN');
  });

  it('ignores stale subscription updates while a manual language change is pending', async () => {
    let resolveUpdate: (result: { success: boolean }) => void = () => {};
    mockUpdateConfig.mockReturnValueOnce(new Promise(resolve => { resolveUpdate = resolve; }));
    const state = await loadState({ uiLanguage: 'en' });
    const callback = subscriptionCallbacks[0];

    const pendingUpdate = state.actions.setLanguage('zh-CN');
    expect(state.get()).toBe('zh-CN');

    callback({ uiLanguage: 'en' });
    expect(state.get()).toBe('zh-CN');

    resolveUpdate({ success: true });
    await pendingUpdate;

    callback({ uiLanguage: 'en' });
    expect(state.get()).toBe('zh-CN');

    callback({ uiLanguage: 'zh-CN' });
    expect(state.get()).toBe('zh-CN');

    callback({ uiLanguage: 'en' });
    expect(state.get()).toBe('en');
  });

  it('applies a newer coalesced subscription that differs from a pending manual language', async () => {
    let resolveUpdate: (result: { success: boolean; revision: number }) => void = () => {};
    mockUpdateConfig.mockReturnValueOnce(new Promise(resolve => { resolveUpdate = resolve; }));
    const state = await loadState({ uiLanguage: 'en' });
    const callback = subscriptionCallbacks[0];

    const pendingUpdate = state.actions.setLanguage('zh-CN');
    expect(state.get()).toBe('zh-CN');

    mockGetConfigRevision.mockReturnValue(2);
    callback({ uiLanguage: 'en' });
    expect(state.get()).toBe('zh-CN');

    resolveUpdate({ success: true, revision: 1 });
    await pendingUpdate;

    expect(state.get()).toBe('en');
  });

  it('applies a newer subscription after a manual language save completes', async () => {
    mockUpdateConfig.mockResolvedValueOnce({ success: true, revision: 1 });
    const state = await loadState({ uiLanguage: 'en' });
    const callback = subscriptionCallbacks[0];

    await state.actions.setLanguage('zh-CN');
    expect(state.get()).toBe('zh-CN');

    mockGetConfigRevision.mockReturnValue(2);
    callback({ uiLanguage: 'en' });

    expect(state.get()).toBe('en');
  });

  it('ignores stale setLanguage completion after a newer language request', async () => {
    let resolveFirst: (result: { success: boolean; error?: string }) => void = () => {};
    let resolveSecond: (result: { success: boolean; error?: string }) => void = () => {};
    mockUpdateConfig
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));
    const state = await loadState({ uiLanguage: 'en' });

    const firstUpdate = state.actions.setLanguage('zh-CN');
    const secondUpdate = state.actions.setLanguage('en');

    resolveFirst({ success: false, error: 'stale failure' });
    await firstUpdate;
    expect(state.get()).toBe('en');

    resolveSecond({ success: true });
    await secondUpdate;
    expect(state.get()).toBe('en');
  });

  it('logs startup latest-config fetch failures without changing language', async () => {
    const error = new Error('fetch failed');
    mockFetchLatestConfig.mockRejectedValueOnce(error);
    const state = await loadState({});

    await Promise.resolve();

    expect(mockLoggerError).toHaveBeenCalledWith('fetchLatestConfig failed', error);
    expect(state.get()).toBe('en');
  });

  it('saves supported languages optimistically', async () => {
    mockUpdateConfig.mockResolvedValueOnce({ success: true, revision: 1 });
    const state = await loadState({ uiLanguage: 'en' });

    await expect(state.actions.setLanguage('zh-CN')).resolves.toEqual({ success: true, revision: 1 });

    expect(state.get()).toBe('zh-CN');
    expect(mockUpdateConfig).toHaveBeenCalledWith({ uiLanguage: 'zh-CN' });
  });

  it('rejects unsupported languages without saving', async () => {
    const state = await loadState({ uiLanguage: 'en' });

    await expect(state.actions.setLanguage('fr')).resolves.toEqual({
      success: false,
      error: 'Unsupported UI language',
    });

    expect(state.get()).toBe('en');
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('rolls back optimistic updates when persistence fails', async () => {
    mockUpdateConfig.mockResolvedValue({ success: false, error: 'disk full' });
    const state = await loadState({ uiLanguage: 'en' });

    await expect(state.actions.setLanguage('zh-CN')).resolves.toEqual({ success: false, error: 'disk full' });

    expect(state.get()).toBe('en');
  });
});
