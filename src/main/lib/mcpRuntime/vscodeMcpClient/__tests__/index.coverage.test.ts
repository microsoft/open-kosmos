import { beforeEach, describe, expect, it, vi } from 'vitest';

const quickConfigDetectionMock = vi.fn();
const createDefaultConfigAdapterMock = vi.fn((..._args: unknown[]) => ({ adapter: 'default' }));
const clientConstructorMock = vi.fn();

vi.mock('../config', () => ({
  quickConfigDetection: (...args: any[]) => quickConfigDetectionMock(...args),
  createDefaultConfigAdapter: (...args: any[]) => createDefaultConfigAdapterMock(...args),
  ConfigAdapter: class {},
  createConfigAdapter: vi.fn(),
  defaultConfigAdapter: {},
}));

vi.mock('../VscodeMcpClient', () => ({
  VscodeMcpClient: class MockVscodeMcpClient {
    constructor(config: any) {
      clientConstructorMock(config);
    }
  },
}));

vi.mock('../../auth/McpAuthService', () => ({
  McpAuthService: {
    onInteraction: vi.fn(() => () => undefined),
    getInstance: vi.fn(),
  },
}));

import {
  createAutoConfiguredMcpClient,
  MODULE_INFO,
  VSCODE_MCP_CLIENT_NAME,
  VSCODE_MCP_CLIENT_VERSION,
} from '../index';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vscodeMcpClient/index coverage', () => {
  it('creates an auto-configured client when detection succeeds with parsed config', async () => {
    quickConfigDetectionMock.mockResolvedValue({
      success: true,
      parsedConfig: { servers: { alpha: {} } },
      bestConfigPath: '/configs/mcp.json',
    });

    const result = await createAutoConfiguredMcpClient();

    expect(createDefaultConfigAdapterMock).toHaveBeenCalledTimes(1);
    expect(clientConstructorMock).toHaveBeenCalledWith({ name: 'auto-detected-server', type: 'stdio' });
    expect(result).toMatchObject({
      configAdapter: { adapter: 'default' },
      detectedConfig: { servers: { alpha: {} } },
      configPath: '/configs/mcp.json',
    });
  });

  it('falls back to the default client when detection succeeds without parsed config', async () => {
    quickConfigDetectionMock.mockResolvedValue({
      success: true,
      parsedConfig: null,
      bestConfigPath: '/configs/mcp.json',
    });

    const result = await createAutoConfiguredMcpClient();

    expect(clientConstructorMock).toHaveBeenCalledWith({ name: 'default-server', type: 'stdio' });
    expect(result).toMatchObject({
      configAdapter: { adapter: 'default' },
      detectedConfig: null,
      configPath: null,
    });
  });

  it('exports stable module metadata', () => {
    expect(VSCODE_MCP_CLIENT_NAME).toBe('VSCode MCP Client');
    expect(VSCODE_MCP_CLIENT_VERSION).toBe('1.0.0');
    expect(MODULE_INFO).toMatchObject({
      name: 'VSCode MCP Client',
      version: '1.0.0',
      configSupport: {
        autoDetection: true,
      },
    });
  });
});
