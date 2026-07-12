import { ipcRenderer } from 'electron';

vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn() },
}));

vi.mock('@shared/ipc/scheduler', () => ({
  renderToMain: {
    provideInvokeForPreload: vi.fn((_ipc: unknown, methods: string[]) => {
      const obj: Record<string, Function> = {};
      for (const m of methods) {
        obj[m] = (...args: unknown[]) => ipcRenderer.invoke(`scheduler:${m}`, ...args);
      }
      return obj;
    }),
  },
}));

describe('preload/scheduler/invoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports an invoke object with expected methods', async () => {
    const mod = await import('../invoke');
    const invoke = mod.default;
    expect(invoke).toBeDefined();
    expect(typeof invoke.listJobs).toBe('function');
    expect(typeof invoke.createJob).toBe('function');
    expect(typeof invoke.deleteJob).toBe('function');
    expect(typeof invoke.toggleJob).toBe('function');
    expect(typeof invoke.updateJob).toBe('function');
    expect(typeof invoke.runJobNow).toBe('function');
    expect(typeof invoke.getJobSessions).toBe('function');
    expect(typeof invoke.cleanupAllSessionHistory).toBe('function');
  });

  it('invoke.cleanupAllSessionHistory calls ipcRenderer.invoke', async () => {
    const mockInvoke = vi.mocked(ipcRenderer.invoke);
    mockInvoke.mockResolvedValueOnce({ success: true, data: { totalDeleted: 5 } });

    const mod = await import('../invoke');
    const result = await mod.default.cleanupAllSessionHistory({ includeOrphans: true, chatId: 'chat_1' });
    expect(mockInvoke).toHaveBeenCalledWith('scheduler:cleanupAllSessionHistory', { includeOrphans: true, chatId: 'chat_1' });
    expect(result).toEqual({ success: true, data: { totalDeleted: 5 } });
  });
});
