import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so these mocks are available inside vi.mock factory closures
const { mockStart, mockGetInstance } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockGetInstance: vi.fn(),
}));

vi.mock('../externalAgentService', () => ({
  ExternalAgentService: {
    getInstance: mockGetInstance,
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { initExternalAgentModule, ExternalAgentService } from '../index';

describe('initExternalAgentModule', () => {
  const mockService = { start: mockStart } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstance.mockReturnValue(mockService);
  });

  it('returns the singleton ExternalAgentService', async () => {
    mockStart.mockResolvedValue(undefined);
    const result = await initExternalAgentModule('testAlias');
    expect(result).toBe(mockService);
  });

  it('calls service.start with the alias and default port 51927', async () => {
    mockStart.mockResolvedValue(undefined);
    await initExternalAgentModule('myAlias');
    expect(mockStart).toHaveBeenCalledWith('myAlias', 51927);
  });

  it('swallows start errors and still returns the service', async () => {
    mockStart.mockRejectedValue(new Error('port in use'));
    const result = await initExternalAgentModule('testAlias');
    expect(result).toBe(mockService);
  });

  it('calls ExternalAgentService.getInstance()', async () => {
    mockStart.mockResolvedValue(undefined);
    await initExternalAgentModule('anyAlias');
    expect(mockGetInstance).toHaveBeenCalledOnce();
  });
});

describe('re-exports', () => {
  it('re-exports ExternalAgentService', () => {
    // The named export should be the class (with getInstance static method)
    expect(ExternalAgentService).toBeDefined();
    expect(typeof ExternalAgentService.getInstance).toBe('function');
  });
});
