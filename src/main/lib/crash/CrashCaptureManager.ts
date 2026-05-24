import { app, BrowserWindow, crashReporter } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeConsole } from '../utilities/safeConsole';

interface CrashBreadcrumb {
  timestamp: string;
  category: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface RunMarker {
  sessionId: string;
  pid: number;
  startedAt: string;
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  isDev: boolean;
  cleanExit: boolean;
  exitCode?: number;
  exitedAt?: string;
}

export interface PreviousRunState {
  sessionId: string;
  startedAt: string;
  cleanExit: boolean;
  exitedAt?: string;
}

type CrashEventType =
  | 'main-uncaught-exception'
  | 'renderer-error'
  | 'renderer-process-gone'
  | 'child-process-gone'
  | 'recovered-unclean-exit';

interface CrashBundleManifest {
  eventType: CrashEventType;
  sessionId: string;
  capturedAt: string;
  appName: string;
  appVersion: string;
  pid: number;
  platform: NodeJS.Platform;
  arch: string;
  isDev: boolean;
  window?: Record<string, unknown>;
}

interface CrashAttachmentEntry {
  fileName: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  sourcePath: string;
  copied: boolean;
  reason?: string;
}

interface CrashBundleAttachments {
  currentRun: boolean;
  previousRun: boolean;
  recentLogs: CrashAttachmentEntry[];
  crashDumps: CrashAttachmentEntry[];
}

export interface RecoveredCrashInfo {
  eventType: 'recovered-unclean-exit';
  sessionId: string;
  previousSessionId: string;
  detectedAt: string;
  startedAt: string;
  pid: number;
  appVersion: string;
  bundlePath: string;
}

export interface CrashCaptureStatus {
  currentSessionId: string;
  crashRootDir: string;
  crashDumpsDir: string;
  hasRecoveredCrash: boolean;
  recoveredCrash: RecoveredCrashInfo | null;
}

export interface RendererCrashReport {
  kind: 'error' | 'unhandledrejection' | 'react-error-boundary';
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  url?: string;
  componentStack?: string;
  metadata?: Record<string, unknown>;
}

function createSessionId(): string {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTimestampToken(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${millis}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: errorWithCause.cause ? serializeUnknown(errorWithCause.cause) : undefined,
    };
  }

  return { value: serializeUnknown(error) };
}

function serializeUnknown(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeUnknown(item));
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = serializeUnknown(nestedValue);
    }
    return result;
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  return value;
}

class CrashCaptureManager {
  private static instance: CrashCaptureManager | null = null;

  private initialized = false;
  private crashReporterStarted = false;
  private sessionId = createSessionId();
  private isDev = false;
  private currentRunMarkerPath = '';
  private crashRootDir = '';
  private stateDir = '';
  private crashDumpsDir = '';
  private recoveredCrash: RecoveredCrashInfo | null = null;
  private previousRunMarker: RunMarker | null = null;
  private readonly breadcrumbs: CrashBreadcrumb[] = [];
  private readonly maxBreadcrumbs = 250;
  private readonly maxRecentLogFiles = 3;
  private readonly maxCrashDumpFiles = 3;
  private readonly maxRecentLogLines = 400;
  private readonly maxAttachmentBytes = 5 * 1024 * 1024;
  private attachedMainWindowId: number | null = null;
  private lastKnownMainWindowUrl = '';
  private hasMarkedCleanExit = false;

  public static getInstance(): CrashCaptureManager {
    if (!CrashCaptureManager.instance) {
      CrashCaptureManager.instance = new CrashCaptureManager();
    }

    return CrashCaptureManager.instance;
  }

  public initialize(options: { isDev: boolean }): void {
    if (this.initialized) {
      return;
    }

    this.isDev = options.isDev;
    this.crashRootDir = path.join(app.getPath('userData'), 'crashes');
    this.stateDir = path.join(app.getPath('userData'), 'state');
    this.crashDumpsDir = app.getPath('crashDumps');
    this.currentRunMarkerPath = path.join(this.stateDir, 'current-run.json');

    this.ensureDirectoriesSync();
    this.previousRunMarker = this.readJsonSync<RunMarker>(this.currentRunMarkerPath);
    this.recoveredCrash = this.detectPreviousUncleanShutdownSync(this.previousRunMarker);
    this.writeCurrentRunMarkerSync();
    this.startCrashReporter();
    this.registerProcessHandlers();
    this.registerAppHandlers();
    this.recordBreadcrumb('lifecycle', 'crash-capture-initialized', {
      sessionId: this.sessionId,
      isDev: this.isDev,
    });
    this.initialized = true;
  }

  public recordBreadcrumb(category: string, message: string, metadata?: Record<string, unknown>): void {
    const breadcrumb: CrashBreadcrumb = {
      timestamp: new Date().toISOString(),
      category,
      message,
      metadata: metadata ? serializeUnknown(metadata) as Record<string, unknown> : undefined,
    };

    this.breadcrumbs.push(breadcrumb);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.splice(0, this.breadcrumbs.length - this.maxBreadcrumbs);
    }
  }

  public attachToMainWindow(window: BrowserWindow): void {
    if (this.attachedMainWindowId === window.id) {
      return;
    }

    this.attachedMainWindowId = window.id;
    this.lastKnownMainWindowUrl = window.webContents.getURL();

    this.recordBreadcrumb('window', 'main-window-attached', {
      windowId: window.id,
      title: window.getTitle(),
    });

    window.webContents.on('did-navigate', (_event, url) => {
      this.lastKnownMainWindowUrl = url;
      this.recordBreadcrumb('window', 'main-window-navigate', { url });
    });

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.recordBreadcrumb('window', 'main-window-did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    });

    window.on('unresponsive', () => {
      this.recordBreadcrumb('window', 'main-window-unresponsive', {
        windowId: window.id,
      });
    });

    window.on('closed', () => {
      this.recordBreadcrumb('window', 'main-window-closed', {
        windowId: window.id,
      });

      if (this.attachedMainWindowId === window.id) {
        this.attachedMainWindowId = null;
      }
    });

    window.webContents.on('render-process-gone', (_event, details) => {
      this.captureCrashBundleSync('renderer-process-gone', {
        details: {
          reason: details.reason,
          exitCode: details.exitCode,
        },
      });
    });
  }

  public markCleanExit(exitCode: number): void {
    if (!this.currentRunMarkerPath || this.hasMarkedCleanExit) {
      return;
    }

    const marker: RunMarker = {
      sessionId: this.sessionId,
      pid: process.pid,
      startedAt: this.getProcessStartTimeIso(),
      appName: app.getName(),
      appVersion: this.getAppVersionSafe(),
      platform: process.platform,
      arch: process.arch,
      isDev: this.isDev,
      cleanExit: true,
      exitCode,
      exitedAt: new Date().toISOString(),
    };

    this.writeJsonSync(this.currentRunMarkerPath, marker);
    this.hasMarkedCleanExit = true;
    this.recordBreadcrumb('lifecycle', 'clean-exit-marked', { exitCode });
  }

  public getStatus(): CrashCaptureStatus {
    return {
      currentSessionId: this.sessionId,
      crashRootDir: this.crashRootDir,
      crashDumpsDir: this.crashDumpsDir,
      hasRecoveredCrash: this.recoveredCrash !== null,
      recoveredCrash: this.recoveredCrash,
    };
  }

  public getPreviousRunState(): PreviousRunState | null {
    if (!this.previousRunMarker) {
      return null;
    }

    return {
      sessionId: this.previousRunMarker.sessionId,
      startedAt: this.previousRunMarker.startedAt,
      cleanExit: this.previousRunMarker.cleanExit,
      exitedAt: this.previousRunMarker.exitedAt,
    };
  }

  public recordRendererBreadcrumb(message: string, metadata?: Record<string, unknown>): void {
    this.recordBreadcrumb('renderer', message, metadata);
  }

  public reportRendererError(report: RendererCrashReport): void {
    this.recordBreadcrumb('renderer', `renderer-${report.kind}`, {
      message: report.message,
      url: report.url,
      source: report.source,
    });

    this.captureCrashBundleSync('renderer-error', {
      report: serializeUnknown(report),
    });
  }

  private registerProcessHandlers(): void {
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      this.captureCrashBundleSync('main-uncaught-exception', {
        origin,
        error: serializeError(error),
      });
    });

    process.on('unhandledRejection', (reason) => {
      this.recordBreadcrumb('process', 'unhandled-rejection', {
        reason: serializeUnknown(reason),
      });
    });
  }

  private registerAppHandlers(): void {
    app.on('child-process-gone', (_event, details: unknown) => {
      const normalizedDetails = this.normalizeChildProcessDetails(details);
      if (normalizedDetails.reason === 'clean-exit') {
        return;
      }

      this.captureCrashBundleSync('child-process-gone', {
        details: normalizedDetails,
      });
    });
  }

  private startCrashReporter(): void {
    if (this.crashReporterStarted) {
      return;
    }

    try {
      crashReporter.start({
        productName: app.getName(),
        uploadToServer: false,
        compress: false,
      });
      crashReporter.addExtraParameter('sid', this.sessionId.slice(0, 120));
      crashReporter.addExtraParameter('ver', this.getAppVersionSafe().slice(0, 120));
      this.crashReporterStarted = true;
    } catch (error) {
      safeConsole.warn('[CrashCapture] Failed to start crashReporter:', error);
    }
  }

  private detectPreviousUncleanShutdownSync(previousRun: RunMarker | null): RecoveredCrashInfo | null {
    if (!previousRun || previousRun.cleanExit) {
      return null;
    }

    const bundleDir = this.createBundleDirectorySync('recovered-unclean-exit');
    const recoveredCrash: RecoveredCrashInfo = {
      eventType: 'recovered-unclean-exit',
      sessionId: this.sessionId,
      previousSessionId: previousRun.sessionId,
      detectedAt: new Date().toISOString(),
      startedAt: previousRun.startedAt,
      pid: previousRun.pid,
      appVersion: previousRun.appVersion,
      bundlePath: bundleDir,
    };

    const manifest: CrashBundleManifest = {
      eventType: 'recovered-unclean-exit',
      sessionId: this.sessionId,
      capturedAt: recoveredCrash.detectedAt,
      appName: app.getName(),
      appVersion: this.getAppVersionSafe(),
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      isDev: this.isDev,
    };

    this.writeJsonSync(path.join(bundleDir, 'manifest.json'), manifest);
    this.writeJsonSync(path.join(bundleDir, 'previous-run.json'), previousRun);
    this.writeJsonSync(path.join(bundleDir, 'recovered-crash.json'), recoveredCrash);
    this.writeJsonSync(path.join(bundleDir, 'system.json'), this.buildSystemSnapshot());
    this.writeJsonSync(
      path.join(bundleDir, 'attachments.json'),
      this.persistBundleAttachments(bundleDir, {
        includePreviousRun: true,
        referenceTimeIso: recoveredCrash.detectedAt,
        previousRunStartedAtIso: previousRun.startedAt,
      }),
    );
    fs.writeFileSync(path.join(bundleDir, 'README.txt'), this.buildBundleReadme('recovered-unclean-exit'), 'utf8');

    const recentLogTail = this.getRecentMainLogTailSync();
    if (recentLogTail) {
      fs.writeFileSync(path.join(bundleDir, 'recent-main.log'), recentLogTail, 'utf8');
    }

    return recoveredCrash;
  }

  private captureCrashBundleSync(eventType: Exclude<CrashEventType, 'recovered-unclean-exit'>, payload: Record<string, unknown>): void {
    try {
      const bundleDir = this.createBundleDirectorySync(eventType);
      const manifest: CrashBundleManifest = {
        eventType,
        sessionId: this.sessionId,
        capturedAt: new Date().toISOString(),
        appName: app.getName(),
        appVersion: this.getAppVersionSafe(),
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        isDev: this.isDev,
        window: this.getWindowSnapshot(),
      };

      this.writeJsonSync(path.join(bundleDir, 'manifest.json'), manifest);
      this.writeJsonSync(path.join(bundleDir, 'event.json'), payload);
      this.writeJsonSync(path.join(bundleDir, 'system.json'), this.buildSystemSnapshot());
      this.writeJsonSync(path.join(bundleDir, 'breadcrumbs.json'), this.breadcrumbs);
      this.writeJsonSync(
        path.join(bundleDir, 'attachments.json'),
        this.persistBundleAttachments(bundleDir, {
          includePreviousRun: false,
          referenceTimeIso: manifest.capturedAt,
        }),
      );
      fs.writeFileSync(path.join(bundleDir, 'README.txt'), this.buildBundleReadme(eventType), 'utf8');

      const recentLogTail = this.getRecentMainLogTailSync();
      if (recentLogTail) {
        fs.writeFileSync(path.join(bundleDir, 'recent-main.log'), recentLogTail, 'utf8');
      }
    } catch (error) {
      safeConsole.error('[CrashCapture] Failed to persist crash bundle:', error);
    }
  }

  private ensureDirectoriesSync(): void {
    fs.mkdirSync(this.crashRootDir, { recursive: true });
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  private writeCurrentRunMarkerSync(): void {
    const marker = this.buildRunMarkerSnapshot(false);

    this.writeJsonSync(this.currentRunMarkerPath, marker);
  }

  private buildRunMarkerSnapshot(cleanExit: boolean, exitCode?: number): RunMarker {
    return {
      sessionId: this.sessionId,
      pid: process.pid,
      startedAt: this.getProcessStartTimeIso(),
      appName: app.getName(),
      appVersion: this.getAppVersionSafe(),
      platform: process.platform,
      arch: process.arch,
      isDev: this.isDev,
      cleanExit,
      exitCode,
      exitedAt: cleanExit ? new Date().toISOString() : undefined,
    };
  }

  private createBundleDirectorySync(eventType: CrashEventType): string {
    const bundleDir = path.join(
      this.crashRootDir,
      `${createTimestampToken()}-${eventType}-${this.sessionId}`,
    );
    fs.mkdirSync(bundleDir, { recursive: true });
    return bundleDir;
  }

  private writeJsonSync(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private readJsonSync<T>(filePath: string): T | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private getProcessStartTimeIso(): string {
    return new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();
  }

  private getAppVersionSafe(): string {
    try {
      return app.getVersion();
    } catch {
      return 'unknown';
    }
  }

  private getRecentMainLogTailSync(maxLines: number = 200): string {
    try {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(logsDir)) {
        return '';
      }

      const logFiles = fs
        .readdirSync(logsDir)
        .filter((fileName) => fileName.endsWith('.log'))
        .map((fileName) => {
          const filePath = path.join(logsDir, fileName);
          return {
            fileName,
            filePath,
            mtimeMs: fs.statSync(filePath).mtimeMs,
          };
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs);

      const latestFile = logFiles[0];
      if (!latestFile) {
        return '';
      }

      const content = fs.readFileSync(latestFile.filePath, 'utf8');
      return content.split(/\r?\n/).slice(-maxLines).join('\n');
    } catch {
      return '';
    }
  }

  private persistBundleAttachments(
    bundleDir: string,
    options: {
      includePreviousRun: boolean;
      referenceTimeIso: string;
      previousRunStartedAtIso?: string;
    },
  ): CrashBundleAttachments {
    const attachments: CrashBundleAttachments = {
      currentRun: false,
      previousRun: false,
      recentLogs: [],
      crashDumps: [],
    };

    const bundleStateDir = path.join(bundleDir, 'state');
    fs.mkdirSync(bundleStateDir, { recursive: true });

    this.writeJsonSync(path.join(bundleStateDir, 'current-run.json'), this.buildRunMarkerSnapshot(false));
    attachments.currentRun = true;

    if (options.includePreviousRun) {
      attachments.previousRun = this.copyIfExistsSync(
        this.currentRunMarkerPath,
        path.join(bundleStateDir, 'previous-current-run.json'),
      );
    }

    attachments.recentLogs = this.copyRecentLogAttachmentsSync(bundleDir);
    attachments.crashDumps = this.copyCrashDumpAttachmentsSync(bundleDir, options.referenceTimeIso, options.previousRunStartedAtIso);

    return attachments;
  }

  private copyRecentLogAttachmentsSync(bundleDir: string): CrashAttachmentEntry[] {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logsDir)) {
      return [];
    }

    const bundleLogsDir = path.join(bundleDir, 'recent-logs');
    fs.mkdirSync(bundleLogsDir, { recursive: true });

    return fs
      .readdirSync(logsDir)
      .filter((fileName) => fileName.endsWith('.log'))
      .map((fileName) => {
        const filePath = path.join(logsDir, fileName);
        const stat = fs.statSync(filePath);
        return { fileName, filePath, stat };
      })
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
      .slice(0, this.maxRecentLogFiles)
      .map(({ fileName, filePath, stat }) => {
        const tail = this.readFileTailSync(filePath, this.maxRecentLogLines);
        const targetName = `${path.parse(fileName).name}.tail.log`;
        const targetPath = path.join(bundleLogsDir, targetName);

        if (!tail) {
          return {
            fileName,
            relativePath: path.join('recent-logs', targetName),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            sourcePath: filePath,
            copied: false,
            reason: 'empty-log-tail',
          };
        }

        fs.writeFileSync(targetPath, tail, 'utf8');
        return {
          fileName,
          relativePath: path.join('recent-logs', targetName),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          sourcePath: filePath,
          copied: true,
        };
      });
  }

  private copyCrashDumpAttachmentsSync(
    bundleDir: string,
    referenceTimeIso: string,
    previousRunStartedAtIso?: string,
  ): CrashAttachmentEntry[] {
    if (!this.crashDumpsDir || !fs.existsSync(this.crashDumpsDir)) {
      return [];
    }

    const referenceTimeMs = Date.parse(referenceTimeIso);
    const previousRunStartedAtMs = previousRunStartedAtIso ? Date.parse(previousRunStartedAtIso) : Number.NaN;
    const lowerBoundMs = Number.isFinite(previousRunStartedAtMs)
      ? previousRunStartedAtMs - 60_000
      : referenceTimeMs - 30 * 60 * 1000;

    const bundleCrashDumpsDir = path.join(bundleDir, 'crash-dumps');
    fs.mkdirSync(bundleCrashDumpsDir, { recursive: true });

    return fs
      .readdirSync(this.crashDumpsDir)
      .map((fileName) => {
        const filePath = path.join(this.crashDumpsDir, fileName);
        const stat = fs.statSync(filePath);
        return { fileName, filePath, stat };
      })
      .filter(({ stat }) => stat.isFile())
      .filter(({ stat }) => stat.mtimeMs >= lowerBoundMs && stat.mtimeMs <= referenceTimeMs + 60_000)
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
      .slice(0, this.maxCrashDumpFiles)
      .map(({ fileName, filePath, stat }) => {
        const targetPath = path.join(bundleCrashDumpsDir, fileName);
        const copied = this.copyFileWithLimitSync(filePath, targetPath, this.maxAttachmentBytes);

        return {
          fileName,
          relativePath: path.join('crash-dumps', fileName),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          sourcePath: filePath,
          copied: copied.success,
          reason: copied.reason,
        };
      });
  }

  private copyIfExistsSync(sourcePath: string, targetPath: string): boolean {
    try {
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        return false;
      }

      fs.copyFileSync(sourcePath, targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private copyFileWithLimitSync(sourcePath: string, targetPath: string, maxBytes: number): { success: boolean; reason?: string } {
    try {
      const stat = fs.statSync(sourcePath);
      if (stat.size > maxBytes) {
        return { success: false, reason: `file-too-large:${stat.size}` };
      }

      fs.copyFileSync(sourcePath, targetPath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'copy-failed',
      };
    }
  }

  private readFileTailSync(filePath: string, maxLines: number): string {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return content.split(/\r?\n/).slice(-maxLines).join('\n');
    } catch {
      return '';
    }
  }

  private buildBundleReadme(eventType: CrashEventType): string {
    return [
      'Crash bundle contents',
      '',
      `eventType: ${eventType}`,
      `sessionId: ${this.sessionId}`,
      '',
      'Files:',
      '- manifest.json: top-level capture metadata',
      '- event.json / recovered-crash.json: event-specific payload',
      '- system.json: machine/process snapshot plus crashDumps path',
      '- breadcrumbs.json: in-memory breadcrumbs before capture',
      '- recent-main.log: latest main log tail',
      '- attachments.json: copied attachments manifest',
      '- state/current-run.json: current run marker at capture time',
      '- recent-logs/: tail samples from the newest log files',
      '- crash-dumps/: recent crash dump files copied from Electron crashDumps directory when available',
    ].join('\n');
  }

  private getWindowSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      attachedMainWindowId: this.attachedMainWindowId,
      lastKnownMainWindowUrl: this.lastKnownMainWindowUrl,
    };

    if (this.attachedMainWindowId !== null) {
      const mainWindow = BrowserWindow.fromId(this.attachedMainWindowId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        snapshot.bounds = mainWindow.getBounds();
        snapshot.title = mainWindow.getTitle();
        snapshot.visible = mainWindow.isVisible();
        snapshot.minimized = mainWindow.isMinimized();
        snapshot.focused = mainWindow.isFocused();
      }
    }

    return snapshot;
  }

  private buildSystemSnapshot(): Record<string, unknown> {
    return {
      hostname: os.hostname(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptime: os.uptime(),
      processUptime: process.uptime(),
      versions: process.versions,
      crashDumpsDir: this.crashDumpsDir,
    };
  }

  private normalizeChildProcessDetails(details: unknown): Record<string, unknown> {
    if (!isRecord(details)) {
      return { raw: serializeUnknown(details) } as Record<string, unknown>;
    }

    return serializeUnknown(details) as Record<string, unknown>;
  }
}

export const crashCaptureManager = CrashCaptureManager.getInstance();