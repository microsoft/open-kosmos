/**
 * Desktop control providers — the only place that touches Electron's screen /
 * desktopCapturer APIs and the OS window-control shell commands.
 *
 * Everything is exposed through the {@link DesktopControl} interface and built
 * by {@link createDefaultDesktopControl}, which takes an injectable command
 * `runner` and `platform` so the parsing/branching logic is unit-testable and
 * the Electron surface is covered with a mocked `electron` module.
 */

import { app, screen, desktopCapturer } from 'electron';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync } from 'fs';
import { createLogger } from '../unifiedLogger';
import { toDriverPoint as scaleLogicalToDriverPoint } from './coordinateMapping';
import type { DisplayBounds, DisplayInfo, ForegroundApp, Point, WindowInfo } from './types';

const logger = createLogger();

/**
 * Benign user32 P/Invoke declarations used to resolve the foreground window's owning
 * process. Compiled once into a cached assembly (see {@link FOREGROUND_PROBE_DLL}) so the
 * hot screenshot path reloads it (~0.5s) instead of re-running the C# compiler every call
 * (~1.2s). Contains only `GetForegroundWindow` / `GetWindowThreadProcessId`.
 */
const FOREGROUND_PROBE_SOURCE =
  'using System;using System.Runtime.InteropServices;' +
  'public class KCu{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();' +
  '[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int pid);}';

/**
 * Per-process cache path for the compiled foreground probe. Randomized (not a fixed name)
 * so we never load a predictable, attacker-plantable path, and confined to the per-user,
 * ACL-restricted OS temp dir. The file persists on disk between calls within a run, so the
 * first screenshot compiles it (~0.8s) and every subsequent one only reloads it (~0.5s).
 * `Add-Type` already writes a csc temp DLL on every inline compile; this just reuses one.
 */
const FOREGROUND_PROBE_DLL = join(tmpdir(), `openkosmos-cu-fg-${randomUUID()}.dll`);

/**
 * Best-effort removal of the cached foreground-probe DLL. Registered on Electron
 * `will-quit` (Windows only — {@link winForegroundScript} is the sole writer) so each
 * launch's randomized `openkosmos-cu-fg-*.dll` doesn't accumulate in the OS temp dir. The
 * randomized name is a deliberate anti-DLL-planting measure (a fixed reusable name is
 * NOT an option), so proactive cleanup is the only way to avoid the per-launch residue.
 * Swallows all errors: the file may never have been written, be locked, or already gone,
 * and the OS reclaims the temp dir regardless.
 */
export function cleanupForegroundProbe(): void {
  try {
    unlinkSync(FOREGROUND_PROBE_DLL);
  } catch {
    // Never created (non-Windows), already gone, or locked — nothing to do.
  }
}

/** Wrap a value as a PowerShell single-quoted literal, doubling embedded single quotes. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Escape a value for embedding inside an AppleScript double-quoted string literal.
 * The caller supplies the surrounding quotes. Without this, a model-supplied app
 * name containing `"` or a newline could close the literal and inject arbitrary
 * AppleScript statements into `osascript`.
 */
export function asQuote(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/**
 * Max long-edge (in pixels) of the screenshot handed to the model. A full Retina
 * / 4K display capture is multiple megapixels and, encoded losslessly, produces a
 * ~3 MB base64 payload; a few of those accumulating in one conversation overflow
 * the model endpoint's request-body limit (HTTP 413). 1280px is the resolution
 * vision computer-use models are tuned for — larger images get downscaled
 * server-side anyway, wasting tokens and hurting coordinate accuracy.
 */
export const MAX_SCREENSHOT_LONG_EDGE = 1280;

/** JPEG quality (0-100) for the captured frame. ~80 keeps UI text legible while
 * shrinking the payload by an order of magnitude versus lossless PNG. */
export const SCREENSHOT_JPEG_QUALITY = 80;

/**
 * Scale `width`x`height` down so its long edge is at most `maxLongEdge`,
 * preserving aspect ratio. Returns the input unchanged when it already fits (or
 * when degenerate), and never returns a zero dimension.
 */
export function fitWithinLongEdge(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= 0 || longEdge <= maxLongEdge) {
    return { width, height };
  }
  const ratio = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** A captured frame: downscaled JPEG base64 plus the frame/display metadata for mapping. */
export interface CapturedFrame {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  displayId: number;
  bounds: DisplayBounds;
  scaleFactor: number;
}

export interface DesktopControl {
  listDisplays(): DisplayInfo[];
  capture(displayId?: number): Promise<CapturedFrame>;
  /**
   * Convert an Electron DIP coordinate into the coordinate space expected by the
   * native input driver. The default Electron-backed implementation uses
   * `screen.dipToScreenPoint` off macOS so mixed-DPI display origins are handled
   * by Electron instead of by an approximate `logical * scaleFactor` formula.
   */
  toDriverPoint(logicalPoint: Point, scaleFactor: number): Point;
  listWindows(): Promise<WindowInfo[]>;
  focusWindow(query: { appId?: string; title?: string }): Promise<boolean>;
  /** Identity of the OS frontmost application, or undefined if it can't be determined. */
  getFrontmostApp(): Promise<ForegroundApp | undefined>;
}

/** Runs an OS command and resolves stdout. Injected so window logic is testable. */
export type CommandRunner = (cmd: string, args: string[]) => Promise<string>;

export interface DesktopControlDeps {
  runner: CommandRunner;
  platform: NodeJS.Platform;
}

/** Default command runner backed by `child_process.execFile`. */
export const DEFAULT_COMMAND_RUNNER_OPTIONS = { timeout: 5000, windowsHide: true } as const;

export const defaultCommandRunner: CommandRunner = (cmd, args) =>
  new Promise<string>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = require('child_process') as typeof import('child_process');
    execFile(cmd, args, DEFAULT_COMMAND_RUNNER_OPTIONS, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });

/** Parse osascript comma-separated app names; trims and drops blanks. */
export function parseMacAppList(stdout: string): string[] {
  return stdout
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function defaultListDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    primary: d.id === primaryId,
  }));
}

/**
 * Pick the `desktopCapturer` screen source for a target display.
 *
 * `source.display_id` is the reliable key on macOS but is frequently **empty on Windows**,
 * where the old `find(byId) ?? sources[0]` fell back to the *primary* monitor and silently
 * captured the wrong screen on multi-monitor setups. Electron returns screen sources in the
 * same order as `screen.getAllDisplays()`, so when the id match misses we fall back to the
 * target's **positional index** before finally defaulting to the first source.
 */
export function selectCaptureSource<T extends { display_id?: string }>(
  sources: T[],
  targetId: number,
  targetIndex: number,
): T | undefined {
  if (sources.length === 0) {
    return undefined;
  }
  const byId = sources.find((s) => !!s.display_id && s.display_id === String(targetId));
  if (byId) {
    return byId;
  }
  if (targetIndex >= 0 && targetIndex < sources.length) {
    return sources[targetIndex];
  }
  return sources[0];
}

async function defaultCapture(displayId?: number): Promise<CapturedFrame> {
  const displays = screen.getAllDisplays();
  const target =
    displayId !== undefined
      ? displays.find((d) => d.id === displayId)
      : screen.getPrimaryDisplay();
  if (!target) {
    throw new Error(`Display ${displayId} not found.`);
  }
  const nativeWidth = Math.round(target.size.width * target.scaleFactor);
  const nativeHeight = Math.round(target.size.height * target.scaleFactor);
  const requested = fitWithinLongEdge(nativeWidth, nativeHeight, MAX_SCREENSHOT_LONG_EDGE);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: requested.width, height: requested.height },
  });
  const targetIndex = displays.findIndex((d) => d.id === target.id);
  const source = selectCaptureSource(sources, target.id, targetIndex);
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(
      'Screen capture returned no image. Grant Screen Recording permission and restart the app.',
    );
  }
  const size = source.thumbnail.getSize();
  return {
    base64: source.thumbnail.toJPEG(SCREENSHOT_JPEG_QUALITY).toString('base64'),
    mimeType: 'image/jpeg',
    width: size.width,
    height: size.height,
    displayId: target.id,
    bounds: target.bounds,
    scaleFactor: target.scaleFactor,
  };
}

function defaultToDriverPoint(
  logicalPoint: Point,
  scaleFactor: number,
  platform: NodeJS.Platform,
): Point {
  if (platform === 'darwin') {
    return logicalPoint;
  }
  if (typeof screen.dipToScreenPoint === 'function') {
    const converted = screen.dipToScreenPoint(logicalPoint);
    return { x: Math.round(converted.x), y: Math.round(converted.y) };
  }
  return scaleLogicalToDriverPoint(logicalPoint, scaleFactor, platform);
}

async function macFrontmostApp(runner: CommandRunner): Promise<ForegroundApp | undefined> {
  const out = await runner('osascript', [
    '-e',
    'tell application "System Events" to get name of first application process whose frontmost is true',
  ]).catch(() => '');
  const name = out.trim();
  // System Events already returns the human app name (e.g. "WeChat"), which is both the
  // display name and the only identifier to match.
  return name.length > 0 ? { name, candidates: [name] } : undefined;
}

/**
 * PowerShell that resolves the foreground window's owning process and prints
 * `processName<TAB>fileDescription<TAB>windowTitle`. It loads the cached probe assembly
 * (compiling it on first use), falling back to an inline compile if the cache can't be
 * used, so it never hard-depends on disk. `FileDescription` is the friendly app name
 * (e.g. `msedge` -> `Microsoft Edge`) the allowlist should match.
 */
function winForegroundScript(): string {
  return [
    ...winForegroundProbePrelude(),
    `$p=0;[void][KCu]::GetWindowThreadProcessId([KCu]::GetForegroundWindow(),[ref]$p);`,
    `$proc=Get-Process -Id $p -EA SilentlyContinue;`,
    `if($proc){ $d='';try{ $d=$proc.MainModule.FileVersionInfo.FileDescription }catch{}; "$($proc.ProcessName)$([char]9)$d$([char]9)$($proc.MainWindowTitle)" }`,
  ].join('\n');
}

function winForegroundProbePrelude(): string[] {
  return [
    `$src=${psQuote(FOREGROUND_PROBE_SOURCE)};`,
    `$dll=${psQuote(FOREGROUND_PROBE_DLL)};`,
    `if(-not (Test-Path $dll)){ try{ Add-Type -TypeDefinition $src -OutputAssembly $dll -EA Stop *>$null }catch{} }`,
    `if(Test-Path $dll){ try{ Add-Type -Path $dll -EA Stop }catch{ Add-Type -TypeDefinition $src -EA Stop } }else{ Add-Type -TypeDefinition $src -EA Stop }`,
  ];
}

/** Parse the `process<TAB>friendly<TAB>title` probe output into a {@link ForegroundApp}. */
export function parseWinForeground(stdout: string): ForegroundApp | undefined {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) {
    return undefined;
  }
  const fields = line.split('\t');
  const proc = (fields[0] ?? '').trim();
  const friendly = (fields[1] ?? '').trim();
  const name = friendly || proc;
  if (!name) {
    return undefined;
  }
  const candidates = Array.from(new Set([name, proc].filter((s) => s.length > 0)));
  return { name, candidates };
}

async function winFrontmostApp(runner: CommandRunner): Promise<ForegroundApp | undefined> {
  const out = await runner('powershell', [
    '-NoProfile',
    '-Command',
    winForegroundScript(),
  ]).catch(() => '');
  return parseWinForeground(out);
}

async function macListWindows(runner: CommandRunner): Promise<WindowInfo[]> {
  const [namesOut, front] = await Promise.all([
    runner('osascript', [
      '-e',
      'tell application "System Events" to get name of (processes where background only is false)',
    ]),
    macFrontmostApp(runner),
  ]);
  return parseMacAppList(namesOut).map((appId) => ({
    appId,
    title: appId,
    focused: appId === front?.name,
  }));
}

async function winListWindows(runner: CommandRunner): Promise<WindowInfo[]> {
  const out = await runner('powershell', [
    '-NoProfile',
    '-Command',
    winListWindowsScript(),
  ]);
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const fields = line.split('\t');
      const appId = (fields[0] ?? '').trim();
      const focusField = (fields.at(-1) ?? '').trim().toLowerCase();
      const hasFocusField = focusField === 'true' || focusField === 'false';
      const titleFields = hasFocusField ? fields.slice(1, -1) : fields.slice(1);
      const title = titleFields.join('\t').trim() || appId;
      return { appId, title, focused: hasFocusField && focusField === 'true' };
    });
}

function winListWindowsScript(): string {
  return [
    ...winForegroundProbePrelude(),
    `$fg=[KCu]::GetForegroundWindow().ToInt64();`,
    `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { "$($_.ProcessName)$([char]9)$($_.MainWindowTitle)$([char]9)$([bool]($_.MainWindowHandle.ToInt64() -eq $fg))" }`,
  ].join('\n');
}

/**
 * PowerShell that focuses a window by **process identity**, not by window title.
 *
 * The query is matched (case-insensitively) against the process name, the window title
 * (a **literal** substring via `.Contains`, NOT a `-like` wildcard — so titles containing
 * `[`, `]`, `?` or `*`, e.g. "Word [Protected View]", match correctly), then the file
 * description (friendly name) of every top-level window, and the winning process
 * is activated **by PID** via `WScript.Shell.AppActivate($pid)`. Activating by PID is far
 * more reliable than the old `AppActivate('<name>')`, which only ever matched a window's
 * live *title* (e.g. "Inbox - Outlook"), so an app/process name almost never matched. It
 * prints `OK` / `FAIL` / `NONE` so the caller can report the real outcome.
 */
function winFocusScript(name: string): string {
  return [
    `$q=${psQuote(name)};`,
    `$ws=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 };`,
    `$t=$ws | Where-Object { $_.ProcessName -ieq $q -or ($_.MainWindowTitle -and $_.MainWindowTitle.ToLower().Contains($q.ToLower())) } | Select-Object -First 1;`,
    `if(-not $t){ $t=$ws | Where-Object { try{ $_.MainModule.FileVersionInfo.FileDescription -ieq $q }catch{ $false } } | Select-Object -First 1 }`,
    `if(-not $t){ 'NONE' }else{ if((New-Object -ComObject WScript.Shell).AppActivate($t.Id)){ 'OK' }else{ 'FAIL' } }`,
  ].join('\n');
}

export function createDefaultDesktopControl(
  deps: Partial<DesktopControlDeps> = {},
): DesktopControl {
  const runner = deps.runner ?? defaultCommandRunner;
  const platform = deps.platform ?? process.platform;

  // Windows compiles a per-launch probe DLL into the temp dir; reclaim it on quit so
  // launches don't leave stale openkosmos-cu-fg-*.dll files behind (see cleanupForegroundProbe).
  if (platform === 'win32') {
    app.once('will-quit', cleanupForegroundProbe);
  }

  return {
    listDisplays: defaultListDisplays,
    capture: defaultCapture,
    toDriverPoint: (logicalPoint, scaleFactor) =>
      defaultToDriverPoint(logicalPoint, scaleFactor, platform),
    async listWindows(): Promise<WindowInfo[]> {
      try {
        if (platform === 'darwin') return await macListWindows(runner);
        if (platform === 'win32') return await winListWindows(runner);
        return [];
      } catch (err) {
        logger.warn(`[ComputerUse] listWindows failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },
    async focusWindow(query: { appId?: string; title?: string }): Promise<boolean> {
      const name = (query.appId ?? query.title ?? '').trim();
      if (!name) return false;
      try {
        if (platform === 'darwin') {
          await runner('osascript', ['-e', `tell application "${asQuote(name)}" to activate`]);
          return true;
        }
        if (platform === 'win32') {
          const out = await runner('powershell', ['-NoProfile', '-Command', winFocusScript(name)]);
          return out.trim() === 'OK';
        }
        return false;
      } catch (err) {
        logger.warn(`[ComputerUse] focusWindow failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    async getFrontmostApp(): Promise<ForegroundApp | undefined> {
      if (platform === 'darwin') return macFrontmostApp(runner);
      if (platform === 'win32') return winFrontmostApp(runner);
      return undefined;
    },
  };
}
