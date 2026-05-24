import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type ElectronMock = typeof import('electron');

describe('CrashCaptureManager', () => {
  let tempRoot: string;
  let userDataDir: string;
  let crashDumpsDir: string;
  let electronMock: ElectronMock;

  beforeEach(async () => {
    vi.resetModules();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-crash-capture-'));
    userDataDir = path.join(tempRoot, 'userData');
    crashDumpsDir = path.join(tempRoot, 'crashDumps');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(crashDumpsDir, { recursive: true });

    electronMock = await import('electron');
    (electronMock.app.getPath as Mock).mockImplementation((name: string) => {
      if (name === 'userData') {
        return userDataDir;
      }

      if (name === 'crashDumps') {
        return crashDumpsDir;
      }

      return tempRoot;
    });
    (electronMock.app.getName as Mock).mockReturnValue('openkosmos-test');
    (electronMock.app.getVersion as Mock).mockReturnValue('9.9.9-test');
    (electronMock.app.on as unknown as Mock | undefined) = vi.fn();
    (electronMock.BrowserWindow as unknown as { fromId?: Mock }).fromId = vi.fn(() => null);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('captures recent logs, current run marker, and crash dumps in renderer-error bundles', async () => {
    seedLogFile(userDataDir, 'openkosmos-2026-04-07.log', ['line-1', 'line-2']);
    seedLogFile(userDataDir, 'renderer.log', ['renderer-line']);
    seedCrashDump(crashDumpsDir, 'renderer.dmp', 'dump-data');

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.reportRendererError({
      kind: 'error',
      message: 'renderer exploded',
      url: 'http://localhost/app',
    });

    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundleName = fs.readdirSync(crashRootDir)[0];
    const bundleDir = path.join(crashRootDir, bundleName);

    const attachments = JSON.parse(fs.readFileSync(path.join(bundleDir, 'attachments.json'), 'utf8'));

    expect(attachments.currentRun).toBe(true);
    expect(attachments.previousRun).toBe(false);
    expect(attachments.recentLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'openkosmos-2026-04-07.log', copied: true }),
        expect.objectContaining({ fileName: 'renderer.log', copied: true }),
      ]),
    );
    expect(attachments.crashDumps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'renderer.dmp', copied: true }),
      ]),
    );
    expect(fs.existsSync(path.join(bundleDir, 'state', 'current-run.json'))).toBe(true);
    expect(fs.existsSync(path.join(bundleDir, 'recent-logs', 'openkosmos-2026-04-07.tail.log'))).toBe(true);
    expect(fs.existsSync(path.join(bundleDir, 'crash-dumps', 'renderer.dmp'))).toBe(true);
    expect(fs.readFileSync(path.join(bundleDir, 'README.txt'), 'utf8')).toContain('crash-dumps/');
  });

  it('captures previous run marker and recent crash dumps for recovered unclean exits', async () => {
    const stateDir = path.join(userDataDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'current-run.json'),
      JSON.stringify({
        sessionId: 'session-prev',
        pid: 321,
        startedAt: '2026-04-07T01:00:00.000Z',
        appName: 'openkosmos-test',
        appVersion: '1.2.3',
        platform: process.platform,
        arch: process.arch,
        isDev: false,
        cleanExit: false,
      }),
      'utf8',
    );
    seedLogFile(userDataDir, 'openkosmos-2026-04-07.log', ['main-line']);
    seedCrashDump(crashDumpsDir, 'main.dmp', 'main-dump');

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    const status = crashCaptureManager.getStatus();
    expect(status.hasRecoveredCrash).toBe(true);
    expect(status.recoveredCrash?.eventType).toBe('recovered-unclean-exit');

    const bundleDir = status.recoveredCrash?.bundlePath as string;
    const attachments = JSON.parse(fs.readFileSync(path.join(bundleDir, 'attachments.json'), 'utf8'));

    expect(attachments.currentRun).toBe(true);
    expect(attachments.previousRun).toBe(true);
    expect(fs.existsSync(path.join(bundleDir, 'state', 'previous-current-run.json'))).toBe(true);
    expect(attachments.crashDumps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'main.dmp', copied: true }),
      ]),
    );
    expect(fs.readFileSync(path.join(bundleDir, 'README.txt'), 'utf8')).toContain('recovered-crash.json');
  });
});

function seedLogFile(userDataDir: string, fileName: string, lines: string[]): void {
  const logsDir = path.join(userDataDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, fileName), `${lines.join('\n')}\n`, 'utf8');
}

function seedCrashDump(crashDumpsDir: string, fileName: string, content: string): void {
  const filePath = path.join(crashDumpsDir, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  fs.utimesSync(filePath, new Date(), new Date());
}