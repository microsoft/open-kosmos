/**
 * registerCodingCliIPC unit tests.
 *
 * Captures the handlers bound via renderToMain.bindMain and invokes them directly to cover
 * getSettings / updateSettings / detectAvailability for both the signed-in and no-alias paths.
 */

export {};

const { capturedHandlers, mockProfileCacheManager, mockDetectAllAvailability } = vi.hoisted(() => ({
  capturedHandlers: {} as Record<string, Function>,
  mockProfileCacheManager: {
    getCodingAgentSettings: vi.fn(() => ({ enabled: true, cli: 'codex' })),
    updateCodingAgentSettings: vi.fn(async () => true),
  },
  mockDetectAllAvailability: vi.fn(() => [
    { id: 'claude', displayName: 'Claude Code', binaryName: 'claude', installHint: 'x', docsUrl: 'u', available: true, path: '/bin/claude' },
  ]),
}));

vi.mock('electron', async () => ({
  ipcMain: {},
}));

vi.mock('@shared/ipc/codingCli', async () => ({
  renderToMain: {
    bindMain: vi.fn(() =>
      new Proxy(
        {},
        {
          get(_t, method: string) {
            return (handler: Function) => {
              capturedHandlers[method] = handler;
            };
          },
        },
      ),
    ),
  },
}));

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: mockProfileCacheManager,
}));

vi.mock('../../userDataADO/types/profile', async () => ({
  DEFAULT_CODING_AGENT_SETTINGS: { enabled: false, cli: 'claude' },
}));

vi.mock('../../mcpRuntime/builtinTools/codingCli/registry', async () => ({
  detectAllAvailability: () => mockDetectAllAvailability(),
}));

import { registerCodingCliIPC } from '../codingCliIPC';

let alias: string | null = 'alice';

describe('registerCodingCliIPC', () => {
  beforeAll(() => {
    registerCodingCliIPC({ getAlias: () => alias });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    alias = 'alice';
    mockProfileCacheManager.getCodingAgentSettings.mockReturnValue({ enabled: true, cli: 'codex' });
    mockProfileCacheManager.updateCodingAgentSettings.mockResolvedValue(true);
    mockDetectAllAvailability.mockReturnValue([
      { id: 'claude', displayName: 'Claude Code', binaryName: 'claude', installHint: 'x', docsUrl: 'u', available: true, path: '/bin/claude' },
    ]);
  });

  it('registers all three handlers', () => {
    expect(Object.keys(capturedHandlers).sort()).toEqual(
      ['detectAvailability', 'getSettings', 'updateSettings'].sort(),
    );
  });

  describe('getSettings', () => {
    it('returns the profile setting when signed in', async () => {
      const res = await capturedHandlers['getSettings']();
      expect(mockProfileCacheManager.getCodingAgentSettings).toHaveBeenCalledWith('alice');
      expect(res).toEqual({ success: true, data: { enabled: true, cli: 'codex' } });
    });

    it('returns the default setting when no alias is active', async () => {
      alias = null;
      const res = await capturedHandlers['getSettings']();
      expect(res).toEqual({ success: true, data: { enabled: false, cli: 'claude' } });
      expect(mockProfileCacheManager.getCodingAgentSettings).not.toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('persists the selection when signed in', async () => {
      const res = await capturedHandlers['updateSettings']({}, { cli: 'gemini' });
      expect(mockProfileCacheManager.updateCodingAgentSettings).toHaveBeenCalledWith('alice', { cli: 'gemini' });
      expect(res).toEqual({ success: true });
    });

    it('persists the master switch when signed in', async () => {
      const res = await capturedHandlers['updateSettings']({}, { enabled: true });
      expect(mockProfileCacheManager.updateCodingAgentSettings).toHaveBeenCalledWith('alice', { enabled: true });
      expect(res).toEqual({ success: true });
    });

    it('fails when no alias is active', async () => {
      alias = null;
      const res = await capturedHandlers['updateSettings']({}, { cli: 'gemini' });
      expect(res).toEqual({ success: false, error: 'No active user profile' });
      expect(mockProfileCacheManager.updateCodingAgentSettings).not.toHaveBeenCalled();
    });

    it('reports failure when persistence returns false', async () => {
      mockProfileCacheManager.updateCodingAgentSettings.mockResolvedValue(false);
      const res = await capturedHandlers['updateSettings']({}, { cli: 'gemini' });
      expect(res).toEqual({ success: false, error: 'Failed to persist coding CLI settings' });
    });

    it('rejects non-object settings at the IPC boundary', async () => {
      const res = await capturedHandlers['updateSettings']({}, null);
      expect(res).toEqual({ success: false, error: 'Coding CLI settings must be an object' });
      expect(mockProfileCacheManager.updateCodingAgentSettings).not.toHaveBeenCalled();
    });

    it('rejects invalid enabled values at the IPC boundary', async () => {
      const res = await capturedHandlers['updateSettings']({}, { enabled: 'yes' });
      expect(res).toEqual({ success: false, error: 'enabled must be a boolean' });
      expect(mockProfileCacheManager.updateCodingAgentSettings).not.toHaveBeenCalled();
    });

    it('rejects invalid cli values at the IPC boundary', async () => {
      const res = await capturedHandlers['updateSettings']({}, { cli: 'vim' });
      expect(res).toEqual({ success: false, error: 'cli must be one of: claude, codex, gemini, copilot' });
      expect(mockProfileCacheManager.updateCodingAgentSettings).not.toHaveBeenCalled();
    });

    it('rejects unsupported settings keys at the IPC boundary', async () => {
      const res = await capturedHandlers['updateSettings']({}, { cli: 'gemini', extra: true });
      expect(res).toEqual({ success: false, error: 'Unsupported Coding CLI setting: extra' });
      expect(mockProfileCacheManager.updateCodingAgentSettings).not.toHaveBeenCalled();
    });
  });

  describe('detectAvailability', () => {
    it('returns the availability list', async () => {
      const res = await capturedHandlers['detectAvailability']();
      expect(res.success).toBe(true);
      expect(res.data.clis).toHaveLength(1);
      expect(res.data.clis[0].id).toBe('claude');
    });
  });
});
