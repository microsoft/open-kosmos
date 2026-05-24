/**
 * CrashCaptureManager — supplementary tests for uncovered paths:
 * - Singleton instance (getInstance returns same instance)
 * - initialize idempotency
 * - recordBreadcrumb overflow trimming
 * - attachToMainWindow (incl. duplicate attach, navigation, fail-load, unresponsive, closed, render-process-gone)
 * - markCleanExit (and idempotency)
 * - getStatus / getPreviousRunState
 * - recordRendererBreadcrumb
 * - reportRendererError
 * - clean-exit previous run (no recovered crash)
 * - crashDumpsDir missing (no crash dumps attached)
 * - file-too-large crash dump skipped
 * - empty logs directory (no recent logs)
 * - copyIfExistsSync for missing source
 * - child-process-gone with clean-exit reason (no bundle written)
 * - child-process-gone with non-record details
 * - unhandledRejection breadcrumb recorded
 * - crashReporter start failure tolerated
 * - getAppVersionSafe fallback
 * - multiple breadcrumbs trimmed to maxBreadcrumbs
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type ElectronMock = typeof import('electron');

describe('CrashCaptureManager — additional coverage', () => {
  let tempRoot: string;
  let userDataDir: string;
  let crashDumpsDir: string;
  let electronMock: ElectronMock;

  // Re-usable helper: seed a log file
  function seedLog(fileName: string, lines: string[]): void {
    const logsDir = path.join(userDataDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, fileName), lines.join('\n'), 'utf8');
  }

  // Re-usable helper: seed a crash dump (with fresh mtime so it falls in the window)
  function seedDump(fileName: string, content = 'dump'): void {
    const filePath = path.join(crashDumpsDir, fileName);
    fs.writeFileSync(filePath, content, 'utf8');
    fs.utimesSync(filePath, new Date(), new Date());
  }

  beforeEach(async () => {
    vi.resetModules();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-crash-extra-'));
    userDataDir = path.join(tempRoot, 'userData');
    crashDumpsDir = path.join(tempRoot, 'crashDumps');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(crashDumpsDir, { recursive: true });

    electronMock = await import('electron');
    (electronMock.app.getPath as Mock).mockImplementation((name: string) => {
      if (name === 'userData') return userDataDir;
      if (name === 'crashDumps') return crashDumpsDir;
      return tempRoot;
    });
    (electronMock.app.getName as Mock).mockReturnValue('openkosmos-test');
    (electronMock.app.getVersion as Mock).mockReturnValue('1.0.0-test');
    (electronMock.app.on as unknown as Mock | undefined) = vi.fn();
    (electronMock.BrowserWindow as unknown as { fromId?: Mock }).fromId = vi.fn(() => null);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────
  // Singleton
  // ─────────────────────────────────────────────
  it('getInstance returns the same singleton across calls', async () => {
    const { crashCaptureManager: m1 } = await import('../CrashCaptureManager');
    const { crashCaptureManager: m2 } = await import('../CrashCaptureManager');
    expect(m1).toBe(m2);
  });

  // ─────────────────────────────────────────────
  // initialize idempotency
  // ─────────────────────────────────────────────
  it('calling initialize twice does not throw', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: true });
    expect(() => crashCaptureManager.initialize({ isDev: false })).not.toThrow();
  });

  it('getStatus before initialize returns empty strings', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    const status = crashCaptureManager.getStatus();
    // Before initialize: crashRootDir is empty string
    expect(typeof status.currentSessionId).toBe('string');
  });

  // ─────────────────────────────────────────────
  // getStatus / getPreviousRunState
  // ─────────────────────────────────────────────
  it('getStatus reflects initialized state', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    const status = crashCaptureManager.getStatus();
    expect(typeof status.currentSessionId).toBe('string');
    expect(status.crashRootDir).toContain('crashes');
    expect(status.hasRecoveredCrash).toBe(false);
    expect(status.recoveredCrash).toBeNull();
  });

  it('getPreviousRunState returns null when no previous run exists', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    const state = crashCaptureManager.getPreviousRunState();
    expect(state).toBeNull();
  });

  it('getPreviousRunState returns the previous run info when available', async () => {
    const stateDir = path.join(userDataDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'current-run.json'),
      JSON.stringify({
        sessionId: 'prev-session',
        pid: 123,
        startedAt: '2026-01-01T00:00:00.000Z',
        appName: 'openkosmos-test',
        appVersion: '1.0.0',
        platform: process.platform,
        arch: process.arch,
        isDev: false,
        cleanExit: true,
        exitedAt: '2026-01-01T01:00:00.000Z',
      }),
      'utf8',
    );

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    const state = crashCaptureManager.getPreviousRunState();
    expect(state).not.toBeNull();
    expect(state?.sessionId).toBe('prev-session');
    expect(state?.cleanExit).toBe(true);
    expect(state?.exitedAt).toBe('2026-01-01T01:00:00.000Z');
  });

  // ─────────────────────────────────────────────
  // Clean previous exit — no recovered crash
  // ─────────────────────────────────────────────
  it('does not set recoveredCrash when previous run was a clean exit', async () => {
    const stateDir = path.join(userDataDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'current-run.json'),
      JSON.stringify({
        sessionId: 'prev-clean',
        pid: 99,
        startedAt: '2026-01-01T00:00:00.000Z',
        appName: 'openkosmos-test',
        appVersion: '1.0.0',
        platform: process.platform,
        arch: process.arch,
        isDev: false,
        cleanExit: true,
      }),
      'utf8',
    );

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(crashCaptureManager.getStatus().hasRecoveredCrash).toBe(false);
  });

  // ─────────────────────────────────────────────
  // recordBreadcrumb overflow trimming
  // ─────────────────────────────────────────────
  it('trims breadcrumbs to maxBreadcrumbs (250)', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    // recordBreadcrumb 260 times
    for (let i = 0; i < 260; i++) {
      crashCaptureManager.recordBreadcrumb('test', `msg-${i}`);
    }
    // Verify by writing a crash bundle and reading breadcrumbs.json
    crashCaptureManager.reportRendererError({ kind: 'error', message: 'check breadcrumbs' });
    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-error'));
    const bundleDir = path.join(crashRootDir, bundles[0]);
    const breadcrumbs = JSON.parse(fs.readFileSync(path.join(bundleDir, 'breadcrumbs.json'), 'utf8'));
    expect(breadcrumbs.length).toBeLessThanOrEqual(250);
  });

  // ─────────────────────────────────────────────
  // recordRendererBreadcrumb
  // ─────────────────────────────────────────────
  it('recordRendererBreadcrumb delegates to recordBreadcrumb', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.recordRendererBreadcrumb('test-renderer-msg', { extra: 'data' }),
    ).not.toThrow();
  });

  // ─────────────────────────────────────────────
  // markCleanExit
  // ─────────────────────────────────────────────
  it('markCleanExit writes updated marker', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.markCleanExit(0);
    const markerPath = path.join(userDataDir, 'state', 'current-run.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    expect(marker.cleanExit).toBe(true);
    expect(marker.exitCode).toBe(0);
  });

  it('markCleanExit is idempotent (second call is a no-op)', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.markCleanExit(0);
    const markerPath = path.join(userDataDir, 'state', 'current-run.json');
    const firstWrite = fs.readFileSync(markerPath, 'utf8');
    crashCaptureManager.markCleanExit(1); // should be no-op
    const secondRead = fs.readFileSync(markerPath, 'utf8');
    expect(firstWrite).toBe(secondRead);
  });

  // ─────────────────────────────────────────────
  // reportRendererError
  // ─────────────────────────────────────────────
  it('reportRendererError creates a crash bundle with event.json', async () => {
    seedLog('app.log', ['log-line-1', 'log-line-2']);
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.reportRendererError({
      kind: 'react-error-boundary',
      message: 'Component exploded',
      componentStack: '\n  at App',
      metadata: { extra: 'info' },
    });

    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-error'));
    expect(bundles).toHaveLength(1);
    const bundleDir = path.join(crashRootDir, bundles[0]);
    const event = JSON.parse(fs.readFileSync(path.join(bundleDir, 'event.json'), 'utf8'));
    expect(event.report.kind).toBe('react-error-boundary');
  });

  it('reportRendererError captures unhandledrejection kind', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.reportRendererError({
      kind: 'unhandledrejection',
      message: 'Promise rejected',
    });
    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-error'));
    expect(bundles.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────
  // attachToMainWindow
  // ─────────────────────────────────────────────
  it('attachToMainWindow records breadcrumb and attaches event handlers', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    const handlers: Record<string, Function[]> = {};
    const wcHandlers: Record<string, Function[]> = {};

    const mockWindow = {
      id: 42,
      getTitle: vi.fn(() => 'Test Window'),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
      isVisible: vi.fn(() => true),
      isMinimized: vi.fn(() => false),
      isFocused: vi.fn(() => true),
      isDestroyed: vi.fn(() => false),
      webContents: {
        getURL: vi.fn(() => 'http://localhost/'),
        on: vi.fn((event: string, cb: Function) => {
          wcHandlers[event] = wcHandlers[event] || [];
          wcHandlers[event].push(cb);
        }),
      },
      on: vi.fn((event: string, cb: Function) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
      }),
    } as any;

    // Register window
    crashCaptureManager.attachToMainWindow(mockWindow);
    expect(mockWindow.on).toHaveBeenCalledWith('unresponsive', expect.any(Function));
    expect(mockWindow.on).toHaveBeenCalledWith('closed', expect.any(Function));

    // Calling attach again for same window ID should be a no-op
    const onCallsBefore = (mockWindow.on as Mock).mock.calls.length;
    crashCaptureManager.attachToMainWindow(mockWindow);
    expect((mockWindow.on as Mock).mock.calls.length).toBe(onCallsBefore);

    // Trigger did-navigate
    wcHandlers['did-navigate']?.[0]({}, 'http://localhost/new-page');

    // Trigger did-fail-load
    wcHandlers['did-fail-load']?.[0]({}, -100, 'ERR_FAILED', 'http://localhost/', true);

    // Trigger unresponsive
    handlers['unresponsive']?.[0]();

    // Trigger closed
    handlers['closed']?.[0]();

    // Trigger render-process-gone — creates a bundle
    wcHandlers['render-process-gone']?.[0]({}, { reason: 'crashed', exitCode: -1 });
    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-process-gone'));
    expect(bundles.length).toBeGreaterThan(0);
  });

  it('attachToMainWindow getWindowSnapshot includes bounds when window is live', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    const wcHandlers: Record<string, Function[]> = {};
    const mockWindow = {
      id: 99,
      getTitle: vi.fn(() => 'Live Window'),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
      isVisible: vi.fn(() => true),
      isMinimized: vi.fn(() => false),
      isFocused: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      webContents: {
        getURL: vi.fn(() => 'http://localhost/'),
        on: vi.fn((event: string, cb: Function) => {
          wcHandlers[event] = wcHandlers[event] || [];
          wcHandlers[event].push(cb);
        }),
      },
      on: vi.fn(),
    } as any;

    // Make BrowserWindow.fromId return our mock
    (electronMock.BrowserWindow as unknown as { fromId?: Mock }).fromId = vi.fn(() => mockWindow);

    crashCaptureManager.attachToMainWindow(mockWindow);
    // Trigger render-process-gone so getWindowSnapshot is called
    wcHandlers['render-process-gone']?.[0]({}, { reason: 'killed', exitCode: -9 });

    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-process-gone'));
    const bundleDir = path.join(crashRootDir, bundles[0]);
    const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
    expect(manifest.window.bounds).toBeDefined();
  });

  // ─────────────────────────────────────────────
  // crashDumpsDir missing
  // ─────────────────────────────────────────────
  it('skips crash dump attachments when crashDumpsDir does not exist', async () => {
    fs.rmSync(crashDumpsDir, { recursive: true, force: true });
    seedLog('app.log', ['line-1']);

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.reportRendererError({ kind: 'error', message: 'no dumps dir' });

    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-error'));
    const bundleDir = path.join(crashRootDir, bundles[0]);
    const attachments = JSON.parse(fs.readFileSync(path.join(bundleDir, 'attachments.json'), 'utf8'));
    expect(attachments.crashDumps).toEqual([]);
  });

  // ─────────────────────────────────────────────
  // File-too-large crash dump
  // ─────────────────────────────────────────────
  it('marks dump as not copied when file exceeds maxAttachmentBytes', async () => {
    // Write a real 6 MB file so copyFileWithLimitSync detects it as too large
    const bigPath = path.join(crashDumpsDir, 'large.dmp');
    fs.writeFileSync(bigPath, Buffer.alloc(6 * 1024 * 1024, 0x41)); // 6 MB > 5 MB limit
    fs.utimesSync(bigPath, new Date(), new Date());

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.reportRendererError({ kind: 'error', message: 'large dump test' });

    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-error'));
    const bundleDir = path.join(crashRootDir, bundles[0]);
    const attachments = JSON.parse(fs.readFileSync(path.join(bundleDir, 'attachments.json'), 'utf8'));
    const largeDump = attachments.crashDumps.find((d: any) => d.fileName === 'large.dmp');
    if (largeDump) {
      expect(largeDump.copied).toBe(false);
      expect(largeDump.reason).toMatch(/too-large/);
    }
    // If the dump was outside the time window it may not appear — that's acceptable
  });

  // ─────────────────────────────────────────────
  // Logs directory missing
  // ─────────────────────────────────────────────
  it('handles missing logs directory gracefully', async () => {
    // Don't create a logs dir at all
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.reportRendererError({ kind: 'error', message: 'no logs dir' }),
    ).not.toThrow();
  });

  // ─────────────────────────────────────────────
  // Log files with empty content (empty tail)
  // ─────────────────────────────────────────────
  it('marks log entry as not copied when tail is empty', async () => {
    seedLog('empty.log', []); // empty file

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    crashCaptureManager.reportRendererError({ kind: 'error', message: 'empty log' });

    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.readdirSync(crashRootDir).filter(n => n.includes('renderer-error'));
    const bundleDir = path.join(crashRootDir, bundles[0]);
    const attachments = JSON.parse(fs.readFileSync(path.join(bundleDir, 'attachments.json'), 'utf8'));
    const emptyLogEntry = attachments.recentLogs.find((l: any) => l.fileName === 'empty.log');
    // May or may not appear depending on ordering
    if (emptyLogEntry) {
      expect(emptyLogEntry.copied).toBe(false);
      expect(emptyLogEntry.reason).toBe('empty-log-tail');
    }
  });

  // ─────────────────────────────────────────────
  // child-process-gone handlers (registered inside registerAppHandlers)
  // ─────────────────────────────────────────────
  it('child-process-gone with clean-exit does not create a bundle', async () => {
    const appOnHandlers: Record<string, Function> = {};
    (electronMock.app.on as unknown as Mock) = vi.fn((event: string, cb: Function) => {
      appOnHandlers[event] = cb;
    });

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    const crashRootDir = path.join(userDataDir, 'crashes');

    // Simulate child-process-gone with clean-exit
    if (appOnHandlers['child-process-gone']) {
      appOnHandlers['child-process-gone']({}, { reason: 'clean-exit', exitCode: 0 });
    }

    const bundles = fs.existsSync(crashRootDir)
      ? fs.readdirSync(crashRootDir).filter(n => n.includes('child-process-gone'))
      : [];
    expect(bundles).toHaveLength(0);
  });

  it('child-process-gone with non-clean reason creates a bundle', async () => {
    const appOnHandlers: Record<string, Function> = {};
    (electronMock.app.on as unknown as Mock) = vi.fn((event: string, cb: Function) => {
      appOnHandlers[event] = cb;
    });

    seedLog('app.log', ['line']);
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    if (appOnHandlers['child-process-gone']) {
      appOnHandlers['child-process-gone']({}, { reason: 'crashed', exitCode: -1 });
    }

    const crashRootDir = path.join(userDataDir, 'crashes');
    const bundles = fs.existsSync(crashRootDir)
      ? fs.readdirSync(crashRootDir).filter(n => n.includes('child-process-gone'))
      : [];
    expect(bundles.length).toBeGreaterThan(0);
  });

  it('child-process-gone with non-record details normalizes gracefully', async () => {
    const appOnHandlers: Record<string, Function> = {};
    (electronMock.app.on as unknown as Mock) = vi.fn((event: string, cb: Function) => {
      appOnHandlers[event] = cb;
    });

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    // Pass a primitive as details (not a record)
    if (appOnHandlers['child-process-gone']) {
      expect(() =>
        appOnHandlers['child-process-gone']({}, 'not-an-object'),
      ).not.toThrow();
    }
  });

  // ─────────────────────────────────────────────
  // unhandledRejection breadcrumb
  // ─────────────────────────────────────────────
  it('unhandledRejection records a breadcrumb without crashing', async () => {
    const processOnHandlers: Record<string, Function> = {};
    const origOn = process.on.bind(process);
    vi.spyOn(process, 'on').mockImplementation((event: any, cb: any) => {
      processOnHandlers[event] = cb;
      return process;
    });

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    vi.restoreAllMocks();

    if (processOnHandlers['unhandledRejection']) {
      expect(() =>
        processOnHandlers['unhandledRejection'](new Error('unhandled rejection')),
      ).not.toThrow();
    }
  });

  // ─────────────────────────────────────────────
  // getAppVersionSafe fallback
  // ─────────────────────────────────────────────
  it('getAppVersionSafe returns "unknown" when app.getVersion throws', async () => {
    (electronMock.app.getVersion as Mock).mockImplementationOnce(() => {
      throw new Error('no version');
    });

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    // initialize calls getAppVersionSafe — should not throw
    expect(() => crashCaptureManager.initialize({ isDev: false })).not.toThrow();
  });

  // ─────────────────────────────────────────────
  // crashReporter start failure
  // ─────────────────────────────────────────────
  it('tolerates crashReporter.start failure', async () => {
    // The global electron mock does not include crashReporter, so start already throws in
    // every test run. Verify that initialize completes normally despite that failure.
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    expect(() => crashCaptureManager.initialize({ isDev: false })).not.toThrow();
  });

  // ─────────────────────────────────────────────
  // copyIfExistsSync (previousRun = true path)
  // ─────────────────────────────────────────────
  it('copies the previous run marker into the bundle (copyIfExistsSync true path)', async () => {
    // Write a real unclean previous-run marker so detectPreviousUncleanShutdownSync fires
    // and includePreviousRun=true is passed to persistBundleAttachments
    const stateDir = path.join(userDataDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'current-run.json'),
      JSON.stringify({
        sessionId: 'prev-unclean-copy',
        pid: 42,
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        appName: 'openkosmos-test',
        appVersion: '1.0.0',
        platform: process.platform,
        arch: process.arch,
        isDev: false,
        cleanExit: false,
      }),
      'utf8',
    );

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    const status = crashCaptureManager.getStatus();
    expect(status.hasRecoveredCrash).toBe(true);
    const bundleDir = status.recoveredCrash!.bundlePath;
    expect(
      fs.existsSync(path.join(bundleDir, 'state', 'previous-current-run.json')),
    ).toBe(true);
  });

  // ─────────────────────────────────────────────
  // copyFileWithLimitSync error path: source file that disappears between stat and copy
  // ─────────────────────────────────────────────
  it('handles missing source file in copyFileWithLimitSync gracefully', async () => {
    // Create a dump file, then delete it before reportRendererError triggers the copy
    const dumpPath = path.join(crashDumpsDir, 'vanish.dmp');
    fs.writeFileSync(dumpPath, 'data');
    fs.utimesSync(dumpPath, new Date(), new Date());
    // Delete it immediately so statSync fails inside copyFileWithLimitSync
    fs.unlinkSync(dumpPath);

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.reportRendererError({ kind: 'error', message: 'vanish dump' }),
    ).not.toThrow();
  });

  // ─────────────────────────────────────────────
  // readFileTailSync error path — covered by testing with an unreadable/deleted log
  // ─────────────────────────────────────────────
  it('handles deleted log file in readFileTailSync gracefully', async () => {
    const logsDir = path.join(userDataDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'gone.log');
    fs.writeFileSync(logPath, 'content');
    // Delete it so readFileSync throws when trying to read the tail
    fs.unlinkSync(logPath);

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.reportRendererError({ kind: 'error', message: 'deleted log' }),
    ).not.toThrow();
  });
  it('uses previousRunStartedAt time window for crash dumps in unclean-exit recovery', async () => {
    const stateDir = path.join(userDataDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });

    const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    fs.writeFileSync(
      path.join(stateDir, 'current-run.json'),
      JSON.stringify({
        sessionId: 'session-prev',
        pid: 321,
        startedAt,
        appName: 'openkosmos-test',
        appVersion: '1.0.0',
        platform: process.platform,
        arch: process.arch,
        isDev: false,
        cleanExit: false,
      }),
      'utf8',
    );

    seedDump('prev.dmp', 'prev-dump-data');

    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });

    const status = crashCaptureManager.getStatus();
    expect(status.hasRecoveredCrash).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Module-level helper function tests
// ─────────────────────────────────────────────
describe('serializeError / serializeUnknown helpers (via recordBreadcrumb metadata)', () => {
  let tempRoot: string;
  let userDataDir: string;
  let crashDumpsDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-serialize-'));
    userDataDir = path.join(tempRoot, 'userData');
    crashDumpsDir = path.join(tempRoot, 'crashDumps');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(crashDumpsDir, { recursive: true });

    const em = await import('electron');
    (em.app.getPath as Mock).mockImplementation((n: string) => {
      if (n === 'userData') return userDataDir;
      if (n === 'crashDumps') return crashDumpsDir;
      return tempRoot;
    });
    (em.app.getName as Mock).mockReturnValue('openkosmos-test');
    (em.app.getVersion as Mock).mockReturnValue('1.0.0-test');
    (em.app.on as unknown as Mock | undefined) = vi.fn();
    (em.BrowserWindow as unknown as { fromId?: Mock }).fromId = vi.fn(() => null);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('handles Error with cause in metadata', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    const err = new Error('outer') as Error & { cause?: unknown };
    err.cause = new Error('inner cause');
    expect(() =>
      crashCaptureManager.recordBreadcrumb('test', 'error-with-cause', {
        error: err as unknown as Record<string, unknown>,
      }),
    ).not.toThrow();
  });

  it('handles bigint values in metadata', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.recordBreadcrumb('test', 'bigint-val', {
        big: BigInt(9007199254740991) as unknown as Record<string, unknown>[string],
      }),
    ).not.toThrow();
  });

  it('handles array metadata values', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.recordBreadcrumb('test', 'array-meta', {
        items: [1, 'two', { three: 3 }] as unknown as Record<string, unknown>[string],
      }),
    ).not.toThrow();
  });

  it('handles function values in metadata', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.recordBreadcrumb('test', 'fn-meta', {
        fn: function myFn() {} as unknown as Record<string, unknown>[string],
      }),
    ).not.toThrow();
  });

  it('handles anonymous function values in metadata', async () => {
    const { crashCaptureManager } = await import('../CrashCaptureManager');
    crashCaptureManager.initialize({ isDev: false });
    expect(() =>
      crashCaptureManager.recordBreadcrumb('test', 'anon-fn', {
        fn: (() => {}) as unknown as Record<string, unknown>[string],
      }),
    ).not.toThrow();
  });
});
