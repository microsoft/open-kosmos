/**
 * Coding CLI registry unit tests: adapter resolution and PATH-based availability detection.
 */

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock('child_process', async () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

import {
  DEFAULT_CODING_CLI_ID,
  CODING_CLI_ADAPTERS,
  CODING_CLI_ORDER,
  getAdapter,
  detectCliPath,
  detectAvailability,
  detectAllAvailability,
} from '../registry';

const originalPlatform = process.platform;

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function mockPathLookup(stdout: string) {
  mockExecFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, stdout, '');
  });
}

function mockPathLookupError(error: Error = new Error('not found')) {
  mockExecFile.mockImplementation((_command, _args, _options, callback) => {
    callback(error, '', '');
  });
}

describe('registry constants', () => {
  it('defaults to claude', () => {
    expect(DEFAULT_CODING_CLI_ID).toBe('claude');
  });

  it('maps every id in display order to an adapter', () => {
    expect(CODING_CLI_ORDER).toEqual(['claude', 'codex', 'gemini', 'copilot']);
    for (const id of CODING_CLI_ORDER) {
      expect(CODING_CLI_ADAPTERS[id].id).toBe(id);
    }
  });
});

describe('getAdapter', () => {
  it('resolves a known id', () => {
    expect(getAdapter('gemini').id).toBe('gemini');
  });

  it('falls back to the default for an unknown id', () => {
    expect(getAdapter('bogus' as any).id).toBe('claude');
  });

  it('falls back to the default for undefined', () => {
    expect(getAdapter(undefined).id).toBe('claude');
  });
});

describe('detectCliPath', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.clearAllMocks();
  });

  it('uses `which` on unix and returns the resolved path', async () => {
    setPlatform('darwin');
    mockPathLookup('/usr/local/bin/claude\n');
    await expect(detectCliPath('claude')).resolves.toBe('/usr/local/bin/claude');
    expect(mockExecFile).toHaveBeenCalledWith(
      'which',
      ['claude'],
      expect.objectContaining({ encoding: 'utf-8', timeout: 2000, windowsHide: true }),
      expect.any(Function),
    );
  });

  it('uses `where` on win32 and keeps PATH order among equally-ranked launchable matches', async () => {
    setPlatform('win32');
    mockPathLookup('C:\\bin\\codex.cmd\r\nC:\\other\\codex.exe');
    await expect(detectCliPath('codex')).resolves.toBe('C:\\bin\\codex.cmd');
    expect(mockExecFile).toHaveBeenCalledWith(
      'where',
      ['codex'],
      expect.objectContaining({ timeout: 2000 }),
      expect.any(Function),
    );
  });

  it('prefers a launchable shim over an extension-less first match on win32', async () => {
    setPlatform('win32');
    // `where` lists the non-spawnable bare wrapper first; the .cmd shim must still win.
    mockPathLookup('C:\\bin\\copilot\r\nC:\\bin\\copilot.cmd');
    await expect(detectCliPath('copilot')).resolves.toBe('C:\\bin\\copilot.cmd');
  });

  it('ignores the editor-bundled copy entirely and selects the standalone launchable shim (real-world copilot PATH)', async () => {
    setPlatform('win32');
    // The editor-bundled .bat appears BEFORE the standalone .cmd in PATH order; it must still be
    // skipped because globalStorage copies are private to the VS Code extension and never usable.
    mockPathLookup(
      [
        'c:\\Users\\x\\AppData\\Roaming\\Code\\User\\globalStorage\\github.copilot-chat\\copilotCli\\copilot',
        'c:\\Users\\x\\AppData\\Roaming\\Code\\User\\globalStorage\\github.copilot-chat\\copilotCli\\copilot.bat',
        'Q:\\.tools\\.npm-global\\copilot',
        'Q:\\.tools\\.npm-global\\copilot.cmd',
      ].join('\r\n'),
    );
    await expect(detectCliPath('copilot')).resolves.toBe('Q:\\.tools\\.npm-global\\copilot.cmd');
  });

  it('returns null when the only launchable match is an editor-bundled copy', async () => {
    setPlatform('win32');
    // No standalone install present; only the VS Code extension's bundled .bat is launchable. It
    // must be ignored, so detection reports unavailable and the install hint is surfaced instead.
    mockPathLookup(
      'c:\\Code\\User\\globalStorage\\github.copilot-chat\\copilotCli\\copilot\r\nc:\\Code\\User\\globalStorage\\github.copilot-chat\\copilotCli\\copilot.bat',
    );
    await expect(detectCliPath('copilot')).resolves.toBeNull();
  });

  it('returns null on win32 when no candidate is launchable (bare POSIX wrappers only)', async () => {
    setPlatform('win32');
    // `where` surfaces only extension-less wrappers (editor-bundled + standalone); neither can be
    // spawned on Windows, so detection must report unavailable instead of returning a path that
    // would later fail with a cryptic "The system cannot find the file specified." ENOENT.
    mockPathLookup(
      'c:\\Code\\User\\globalStorage\\github.copilot-chat\\copilotCli\\copilot\r\nQ:\\.tools\\.npm-global\\copilot',
    );
    await expect(detectCliPath('copilot')).resolves.toBeNull();
  });

  it('passes binary names as argv instead of shell-interpolating them', async () => {
    setPlatform('linux');
    mockPathLookup('/usr/local/bin/custom\n');
    await expect(detectCliPath('custom; rm -rf /')).resolves.toBe('/usr/local/bin/custom');
    expect(mockExecFile).toHaveBeenCalledWith(
      'which',
      ['custom; rm -rf /'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns null when the lookup reports an error', async () => {
    setPlatform('linux');
    mockPathLookupError();
    await expect(detectCliPath('gemini')).resolves.toBeNull();
  });

  it('returns null when the lookup yields empty output', async () => {
    setPlatform('linux');
    mockPathLookup('   \n');
    await expect(detectCliPath('copilot')).resolves.toBeNull();
  });
});

describe('detectAvailability', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.clearAllMocks();
  });

  it('reports available with a path when the binary resolves', async () => {
    setPlatform('darwin');
    mockPathLookup('/usr/local/bin/claude');
    const result = await detectAvailability('claude');
    expect(result).toMatchObject({
      id: 'claude',
      displayName: 'Claude Code',
      binaryName: 'claude',
      available: true,
      path: '/usr/local/bin/claude',
    });
  });

  it('reports unavailable with a null path when the binary is missing', async () => {
    setPlatform('darwin');
    mockPathLookupError(new Error('nope'));
    const result = await detectAvailability('codex');
    expect(result.available).toBe(false);
    expect(result.path).toBeNull();
    expect(result.installHint).toContain('@openai/codex');
  });
});

describe('detectAllAvailability', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.clearAllMocks();
  });

  it('returns availability for every CLI in display order', async () => {
    setPlatform('darwin');
    mockExecFile.mockImplementation((_command, args, _options, callback) => {
      callback(null, `/path/${args[0]}`, '');
    });
    const all = await detectAllAvailability();
    expect(all.map((a) => a.id)).toEqual(['claude', 'codex', 'gemini', 'copilot']);
    expect(all.every((a) => a.available)).toBe(true);
  });
});
