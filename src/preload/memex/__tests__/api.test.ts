const mockInvokeMemex = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();

vi.mock('../invoke', async () => ({
  __esModule: true,
  default: mockInvokeMemex,
}));

describe('createMemexPreloadApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always exposes the memex invoke bridge', async () => {
    const { createMemexPreloadApi } = await import('../api');

    const api = createMemexPreloadApi({
      on: mockOn,
      removeListener: mockRemoveListener,
    } as any);

    expect(api.invoke).toBe(mockInvokeMemex);
    expect(typeof api.onPhaseChange).toBe('function');
  });

  it('subscribes and unsubscribes memex phase events through ipcRenderer', async () => {
    const { createMemexPreloadApi } = await import('../api');
    const callback = vi.fn();

    const api = createMemexPreloadApi({
      on: mockOn,
      removeListener: mockRemoveListener,
    } as any);

    const dispose = api.onPhaseChange(callback);

    expect(mockOn).toHaveBeenCalledTimes(1);
    expect(mockOn).toHaveBeenCalledWith('memex:phaseChange', expect.any(Function));

    const listener = mockOn.mock.calls[0][1];
    listener({}, 'configuring');
    expect(callback).toHaveBeenCalledWith('configuring');

    dispose();
    expect(mockRemoveListener).toHaveBeenCalledWith('memex:phaseChange', listener);
  });
});