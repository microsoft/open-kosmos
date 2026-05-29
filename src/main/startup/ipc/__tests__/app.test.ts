import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockHandle = vi.fn();
const mockGetVersion = vi.fn(() => '1.0.0');
const mockGetName = vi.fn(() => 'openkosmos');
const mockGetPath = vi.fn(() => '/tmp/userData');

vi.mock('electron', () => ({
  app: {
    getVersion: (...args: any[]) => (mockGetVersion as any)(...args),
    getName: (...args: any[]) => (mockGetName as any)(...args),
    getPath: (...args: any[]) => (mockGetPath as any)(...args),
  },
  ipcMain: {
    handle: (...args: any[]) => (mockHandle as any)(...args),
  },
}));

const mockGetStatus = vi.fn(() => ({ enabled: true }));
const mockRecordRendererBreadcrumb = vi.fn();
const mockReportRendererError = vi.fn();

vi.mock('../../../lib/crash/CrashCaptureManager', () => ({
  crashCaptureManager: {
    getStatus: (...args: any[]) => (mockGetStatus as any)(...args),
    recordRendererBreadcrumb: (...args: any[]) => (mockRecordRendererBreadcrumb as any)(...args),
    reportRendererError: (...args: any[]) => (mockReportRendererError as any)(...args),
  },
}));

const mockGetConfig = vi.fn(() => ({ theme: 'dark' }));
const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
const mockGetAppCacheManager = vi.fn().mockResolvedValue({
  getConfig: (...args: any[]) => (mockGetConfig as any)(...args),
  updateConfig: (...args: any[]) => (mockUpdateConfig as any)(...args),
});

vi.mock('../../lazy', () => ({
  getAppCacheManager: (...args: any[]) => (mockGetAppCacheManager as any)(...args),
}));

const mockGetOrCreateInstallationDeviceId = vi.fn().mockResolvedValue('device-id-123');

vi.mock('../../../lib/utilities/idFactory', () => ({
  getOrCreateInstallationDeviceId: (...args: any[]) => (mockGetOrCreateInstallationDeviceId as any)(...args),
}));

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for ${channel}`);
  return call[1];
}

const mockCtx = {
  isDev: false,
  isAnalyticsReady: true,
  isAgentChatReady: true,
};

describe('startup/ipc/app', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: registerAppIPC } = await import('../app');
    registerAppIPC(mockCtx as any);
  });

  it('app:getVersion returns app version', async () => {
    const handler = getHandler('app:getVersion');
    const result = await handler();
    expect(result).toBe('1.0.0');
    expect(mockGetVersion).toHaveBeenCalled();
  });

  it('app:getName returns app name', async () => {
    const handler = getHandler('app:getName');
    const result = await handler();
    expect(result).toBe('openkosmos');
  });

  it('app:isDev returns ctx.isDev', async () => {
    const handler = getHandler('app:isDev');
    const result = await handler();
    expect(result).toBe(false);
  });

  it('app:isReady returns combined readiness state', async () => {
    const handler = getHandler('app:isReady');
    const result = await handler();
    expect(result).toEqual({ success: true, data: true });
  });

  it('app:isReady returns false when agentChat not ready', async () => {
    const ctx = { isDev: false, isAnalyticsReady: true, isAgentChatReady: false };
    vi.resetModules();
    vi.clearAllMocks();
    const { default: registerAppIPC } = await import('../app');
    registerAppIPC(ctx as any);
    const handler = getHandler('app:isReady');
    const result = await handler();
    expect(result).toEqual({ success: true, data: false });
  });

  it('app:getPlatformInfo returns platform info', async () => {
    const handler = getHandler('app:getPlatformInfo');
    const result = await handler();
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('arch');
    expect(result).toHaveProperty('isWindowsArm');
    expect(result).toHaveProperty('memoryEnabled');
    expect(typeof result.isWindowsArm).toBe('boolean');
  });

  it('app:getPlatformInfo sets memoryEnabled=false on Windows ARM', async () => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });

    vi.clearAllMocks();
    vi.resetModules();
    const { default: registerAppIPC } = await import('../app');
    registerAppIPC(mockCtx as any);
    const handler = getHandler('app:getPlatformInfo');
    const result = await handler();

    expect(result.isWindowsArm).toBe(true);
    expect(result.memoryEnabled).toBe(false);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });

  it('app:getUserDataPath returns userData path', async () => {
    const handler = getHandler('app:getUserDataPath');
    const result = await handler();
    expect(result).toBe('/tmp/userData');
    expect(mockGetPath).toHaveBeenCalledWith('userData');
  });

  it('app:getInstallationDeviceId returns device id', async () => {
    const handler = getHandler('app:getInstallationDeviceId');
    const result = await handler();
    expect(result).toBe('device-id-123');
  });

  it('app:getCrashCaptureStatus returns crash status', async () => {
    const handler = getHandler('app:getCrashCaptureStatus');
    const result = await handler();
    expect(result).toEqual({ enabled: true });
    expect(mockGetStatus).toHaveBeenCalled();
  });

  it('app:recordCrashBreadcrumb calls crashCaptureManager', async () => {
    const handler = getHandler('app:recordCrashBreadcrumb');
    await handler({}, 'test-message', { key: 'val' });
    expect(mockRecordRendererBreadcrumb).toHaveBeenCalledWith('test-message', { key: 'val' });
  });

  it('app:reportRendererError calls crashCaptureManager', async () => {
    const handler = getHandler('app:reportRendererError');
    const report = { message: 'crash', stack: 'at...' };
    await handler({}, report);
    expect(mockReportRendererError).toHaveBeenCalledWith(report);
  });

  it('app:getAppConfig returns config on success', async () => {
    const handler = getHandler('app:getAppConfig');
    const result = await handler();
    expect(result).toEqual({ success: true, data: { theme: 'dark' } });
  });

  it('app:getAppConfig returns error on failure', async () => {
    mockGetAppCacheManager.mockRejectedValueOnce(new Error('cache fail'));
    const handler = getHandler('app:getAppConfig');
    const result = await handler();
    expect(result).toEqual({ success: false, error: 'cache fail' });
  });

  it('app:updateAppConfig updates and returns success', async () => {
    const handler = getHandler('app:updateAppConfig');
    const result = await handler({}, { theme: 'light' });
    expect(result).toEqual({ success: true });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('app:updateAppConfig returns error on failure', async () => {
    mockGetAppCacheManager.mockRejectedValueOnce(new Error('update fail'));
    const handler = getHandler('app:updateAppConfig');
    const result = await handler({}, { theme: 'light' });
    expect(result).toEqual({ success: false, error: 'update fail' });
  });
});
