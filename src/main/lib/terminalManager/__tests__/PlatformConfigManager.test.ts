/**
 * @vitest-environment node
 */

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:\\test\\userData'),
  },
}));

vi.mock('../../runtime/RuntimeManager', async () => ({
  RuntimeManager: vi.fn(),
}));

describe('PlatformConfigManager shell fallback', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('falls back to the default shell when bash.exe is unavailable on Windows', async () => {
    const module = await import('../PlatformConfigManager');
    const manager = module.PlatformConfigManager.getInstance();

    const availabilitySpy = vi.spyOn(manager, 'isShellCommandAvailable');
    availabilitySpy.mockImplementation(async (command: string) => command !== 'bash.exe');

    const result = await manager.getRunnableShellProfile('bash');

    expect(result.shellType).toBe('powershell');
    expect(result.profile.command).toBe('powershell.exe');
    expect(result.fallbackReason).toContain("falling back to 'powershell'");

    availabilitySpy.mockRestore();
  });

  it('reports unavailable commands as unavailable on non-Windows platforms', async () => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const module = await import('../PlatformConfigManager');
    const manager = module.PlatformConfigManager.getInstance();

    const resolveSpy = vi.spyOn(manager, 'resolveCommandPath').mockResolvedValue('missing-shell');

    await expect(manager.isShellCommandAvailable('missing-shell')).resolves.toBe(false);

    resolveSpy.mockRestore();
  });
});

describe('PlatformConfigManager.getEnhancedEnvironment - npm_config_prefix sanitization', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env['npm_config_prefix'] = '/opt/homebrew/Cellar/node/25.9.0_2';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('strips npm_config_prefix in internal mode (includeBinPath=true)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const module = await import('../PlatformConfigManager');
    const manager = module.PlatformConfigManager.getInstance();

    const env = manager.getEnhancedEnvironment(true);
    expect(env['npm_config_prefix']).toBeUndefined();
  });

  it('preserves npm_config_prefix in system mode (includeBinPath=false)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const module = await import('../PlatformConfigManager');
    const manager = module.PlatformConfigManager.getInstance();

    const env = manager.getEnhancedEnvironment(false);
    expect(env['npm_config_prefix']).toBe('/opt/homebrew/Cellar/node/25.9.0_2');
  });
});