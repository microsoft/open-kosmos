/**
 * Tests for MCP transport shim-ready wait in TerminalInstance.prepareEnvironment()
 */

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:\\test\\userData'),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const { mockWaitForShimsReady, mockGetRunTimeConfig } = vi.hoisted(() => ({
  mockWaitForShimsReady: vi.fn().mockResolvedValue(undefined),
  mockGetRunTimeConfig: vi.fn(),
}));

vi.mock('../../runtime/RuntimeManager', async () => ({
  RuntimeManager: {
    getInstance: vi.fn().mockReturnValue({
      getRunTimeConfig: mockGetRunTimeConfig,
      getBinPath: vi.fn().mockReturnValue('C:\\test\\bin'),
      waitForShimsReady: mockWaitForShimsReady,
    }),
  },
}));

vi.mock('../PlatformConfigManager', async () => ({
  PlatformConfigManager: {
    getInstance: () => ({
      getRunnableShellProfile: async () => ({
        shellType: 'powershell',
        profile: {
          command: 'powershell.exe',
          args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
          supportsPersistent: true,
        },
      }),
      getShellProfile: () => ({
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
        supportsPersistent: true,
      }),
      getEnhancedEnvironment: vi.fn().mockReturnValue({ Path: 'C:\\test\\bin;C:\\Windows' }),
      parseEnvFile: vi.fn().mockReturnValue([]),
      getConfig: () => ({ pathSeparator: ';', executableExtensions: ['.exe', '.cmd'] }),
    }),
  },
}));

import { TerminalInstance } from '../TerminalInstance';
import { TerminalConfig } from '../types';

function createMcpConfig(): TerminalConfig {
  return {
    command: 'uvx',
    args: ['some-mcp-package'],
    cwd: 'C:\\Users\\test',
    type: 'mcp_transport',
    persistent: true,
  };
}

function createCommandConfig(): TerminalConfig {
  return {
    command: 'echo hello',
    args: [],
    cwd: 'C:\\Users\\test',
    type: 'command',
    shell: 'powershell',
  };
}

describe('TerminalInstance prepareEnvironment shim-ready gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for shims when internal mode + mcp_transport', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });
    const instance = new TerminalInstance(createMcpConfig());
    // Call prepareEnvironment via the private method
    const env = await (instance as any).prepareEnvironment();

    expect(mockWaitForShimsReady).toHaveBeenCalled();
    expect(env).toBeDefined();
  });

  it('does NOT wait for shims when internal mode + command type', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });
    const instance = new TerminalInstance(createCommandConfig());
    await (instance as any).prepareEnvironment();

    expect(mockWaitForShimsReady).not.toHaveBeenCalled();
  });

  it('does NOT wait for shims when system mode + mcp_transport', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'system' });
    const instance = new TerminalInstance(createMcpConfig());
    await (instance as any).prepareEnvironment();

    expect(mockWaitForShimsReady).not.toHaveBeenCalled();
  });

  it('proceeds when waitForShimsReady times out', async () => {
    mockGetRunTimeConfig.mockReturnValue({ mode: 'internal' });
    mockWaitForShimsReady.mockRejectedValueOnce(new Error('timeout'));
    const instance = new TerminalInstance(createMcpConfig());

    // Should not throw — the catch in prepareEnvironment swallows the error
    const env = await (instance as any).prepareEnvironment();
    expect(env).toBeDefined();
  });

  it('proceeds when RuntimeManager.getInstance() throws', async () => {
    mockGetRunTimeConfig.mockImplementation(() => { throw new Error('not initialized'); });
    const instance = new TerminalInstance(createMcpConfig());

    // isInternalMode() returns false → no wait
    const env = await (instance as any).prepareEnvironment();
    expect(mockWaitForShimsReady).not.toHaveBeenCalled();
    expect(env).toBeDefined();
  });
});
