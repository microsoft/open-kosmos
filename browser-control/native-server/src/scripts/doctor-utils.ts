import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { COMMAND_NAME } from './constant';
import {
  BrowserType,
  detectInstalledBrowsers,
  parseBrowserType,
} from './browser-config';
import {
  colorText,
  ensureExecutionPermissions,
  tryRegisterUserLevelHost,
  getLogDir,
} from './utils';

export interface DoctorOptions {
  json?: boolean;
  fix?: boolean;
  browser?: string;
}

export type DoctorStatus = 'ok' | 'warn' | 'error';

export interface DoctorFixAttempt {
  id: string;
  description: string;
  success: boolean;
  error?: string;
}

export interface DoctorCheckResult {
  id: string;
  title: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  schemaVersion: number;
  timestamp: string;
  ok: boolean;
  summary: {
    ok: number;
    warn: number;
    error: number;
  };
  environment: {
    platform: NodeJS.Platform;
    arch: string;
    node: {
      version: string;
      execPath: string;
    };
    package: {
      name: string;
      version: string;
      rootDir: string;
      distDir: string;
    };
    command: {
      canonical: string;
      aliases: string[];
    };
    nativeHost: {
      hostName: string;
      expectedPort: number;
    };
  };
  fixes: DoctorFixAttempt[];
  checks: DoctorCheckResult[];
  nextSteps: string[];
}

export interface NodeResolutionResult {
  nodePath?: string;
  source?: string;
  version?: string;
  versionError?: string;
  nodePathFile: {
    path: string;
    exists: boolean;
    value?: string;
    valid?: boolean;
    error?: string;
  };
}

export function readPackageJson(): Record<string, unknown> {
  try {
    return require('../../package.json') as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getCommandInfo(pkg: Record<string, unknown>): {
  canonical: string;
  aliases: string[];
} {
  const bin = pkg.bin as Record<string, string> | undefined;
  if (!bin || typeof bin !== 'object') {
    return { canonical: COMMAND_NAME, aliases: [] };
  }

  const canonical = COMMAND_NAME;
  const canonicalTarget = bin[canonical];
  const aliases = canonicalTarget
    ? Object.keys(bin).filter((name) => name !== canonical && bin[name] === canonicalTarget)
    : [];

  return { canonical, aliases };
}

export function resolveDistDir(): string {
  const candidateFromDistScripts = path.resolve(__dirname, '..');
  const candidateFromSrcScripts = path.resolve(__dirname, '..', '..', 'dist');

  const looksLikeDist = (dir: string): boolean => {
    return (
      fs.existsSync(path.join(dir, 'mcp', 'stdio-config.json')) ||
      fs.existsSync(path.join(dir, 'run_host.sh')) ||
      fs.existsSync(path.join(dir, 'run_host.bat'))
    );
  };

  if (looksLikeDist(candidateFromDistScripts)) return candidateFromDistScripts;
  if (looksLikeDist(candidateFromSrcScripts)) return candidateFromSrcScripts;
  return candidateFromDistScripts;
}

export function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function canExecute(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function normalizeComparablePath(filePath: string): string {
  if (process.platform === 'win32') {
    return path.normalize(filePath).toLowerCase();
  }
  return path.normalize(filePath);
}

export function stripOuterQuotes(input: string): string {
  const trimmed = input.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function expandTilde(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function expandWindowsEnvVars(input: string): string {
  if (process.platform !== 'win32') return input;
  return input.replace(/%([^%]+)%/g, (_match, name: string) => {
    const key = String(name);
    return process.env[key] ?? process.env[key.toUpperCase()] ?? process.env[key.toLowerCase()] ?? _match;
  });
}

function parseVersionFromDirName(dirName: string): number[] | null {
  const cleaned = dirName.trim().replace(/^v/, '');
  if (!/^\d+(\.\d+){0,3}$/.test(cleaned)) return null;
  return cleaned.split('.').map((part) => Number(part));
}

export function parseNodeMajorVersion(versionString: string): number | null {
  if (!versionString) return null;
  const match = versionString.trim().match(/^v?(\d+)(?:\.\d+)*(?:[-+].*)?$/i);
  if (match?.[1]) {
    const major = Number(match[1]);
    return Number.isNaN(major) ? null : major;
  }
  return null;
}

function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function pickLatestVersionDir(parentDir: string): string | null {
  if (!fs.existsSync(parentDir)) return null;
  const dirents = fs.readdirSync(parentDir, { withFileTypes: true });
  let best: { name: string; version: number[] } | null = null;

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const parsed = parseVersionFromDirName(dirent.name);
    if (!parsed) continue;
    if (!best || compareVersions(parsed, best.version) > 0) {
      best = { name: dirent.name, version: parsed };
    }
  }

  return best ? path.join(parentDir, best.name) : null;
}

export function resolveNodeCandidate(distDir: string): NodeResolutionResult {
  const nodeFileName = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodePathFilePath = path.join(distDir, 'node_path.txt');

  const nodePathFile: NodeResolutionResult['nodePathFile'] = {
    path: nodePathFilePath,
    exists: fs.existsSync(nodePathFilePath),
  };

  const consider = (source: string, rawCandidate?: string): { nodePath: string; source: string } | null => {
    if (!rawCandidate) return null;
    let candidate = expandTilde(stripOuterQuotes(rawCandidate));

    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        candidate = path.join(candidate, nodeFileName);
      }
    } catch {
      // ignore
    }

    if (canExecute(candidate)) {
      return { nodePath: candidate, source };
    }
    return null;
  };

  const fromEnv = consider('CHROME_MCP_NODE_PATH', process.env.CHROME_MCP_NODE_PATH);
  if (fromEnv) {
    return { ...fromEnv, nodePathFile };
  }

  if (nodePathFile.exists) {
    try {
      const content = fs.readFileSync(nodePathFilePath, 'utf8').trim();
      nodePathFile.value = content;
      const fromFile = consider('node_path.txt', content);
      nodePathFile.valid = Boolean(fromFile);
      if (fromFile) {
        return { ...fromFile, nodePathFile };
      }
    } catch (error) {
      nodePathFile.error = stringifyError(error);
      nodePathFile.valid = false;
    }
  }

  const relativeNodePath =
    process.platform === 'win32'
      ? path.resolve(distDir, '..', '..', '..', nodeFileName)
      : path.resolve(distDir, '..', '..', '..', 'bin', nodeFileName);
  const fromRelative = consider('relative', relativeNodePath);
  if (fromRelative) return { ...fromRelative, nodePathFile };

  const voltaHome = process.env.VOLTA_HOME || path.join(os.homedir(), '.volta');
  const fromVolta = consider('volta', path.join(voltaHome, 'bin', nodeFileName));
  if (fromVolta) return { ...fromVolta, nodePathFile };

  const asdfDir = process.env.ASDF_DATA_DIR || path.join(os.homedir(), '.asdf');
  const asdfNodejsDir = path.join(asdfDir, 'installs', 'nodejs');
  const latestAsdf = pickLatestVersionDir(asdfNodejsDir);
  if (latestAsdf) {
    const fromAsdf = consider('asdf', path.join(latestAsdf, 'bin', nodeFileName));
    if (fromAsdf) return { ...fromAsdf, nodePathFile };
  }

  const fnmDir = process.env.FNM_DIR || path.join(os.homedir(), '.fnm');
  const fnmVersionsDir = path.join(fnmDir, 'node-versions');
  const latestFnm = pickLatestVersionDir(fnmVersionsDir);
  if (latestFnm) {
    const fnmNodePath =
      process.platform === 'win32'
        ? path.join(latestFnm, 'installation', nodeFileName)
        : path.join(latestFnm, 'installation', 'bin', nodeFileName);
    const fromFnm = consider('fnm', fnmNodePath);
    if (fromFnm) return { ...fromFnm, nodePathFile };
  }

  if (process.platform !== 'win32') {
    const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
    const nvmDefaultAlias = path.join(nvmDir, 'alias', 'default');
    try {
      if (fs.existsSync(nvmDefaultAlias)) {
        const stat = fs.lstatSync(nvmDefaultAlias);
        const maybeVersion = stat.isSymbolicLink()
          ? fs.readlinkSync(nvmDefaultAlias).trim()
          : fs.readFileSync(nvmDefaultAlias, 'utf8').trim();
        const fromDefault = consider(
          'nvm-default',
          path.join(nvmDir, 'versions', 'node', maybeVersion, 'bin', 'node'),
        );
        if (fromDefault) return { ...fromDefault, nodePathFile };
      }
    } catch {
      // ignore
    }

    const latestNvm = pickLatestVersionDir(path.join(nvmDir, 'versions', 'node'));
    if (latestNvm) {
      const fromNvm = consider('nvm-latest', path.join(latestNvm, 'bin', 'node'));
      if (fromNvm) return { ...fromNvm, nodePathFile };
    }
  }

  const commonPaths =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
        ].filter((candidate) => path.isAbsolute(candidate))
      : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  for (const common of commonPaths) {
    const resolved = consider('common', common);
    if (resolved) return { ...resolved, nodePathFile };
  }

  const pathEnv = process.env.PATH || '';
  for (const rawDir of pathEnv.split(path.delimiter)) {
    const dir = stripOuterQuotes(rawDir);
    if (!dir) continue;
    const candidate = path.join(dir, nodeFileName);
    if (canExecute(candidate)) {
      return { nodePath: candidate, source: 'PATH', nodePathFile };
    }
  }

  return { nodePathFile };
}

export function resolveTargetBrowsers(browserArg: string | undefined): BrowserType[] | undefined {
  if (!browserArg) return undefined;
  const normalized = browserArg.toLowerCase();
  if (normalized === 'all') return [BrowserType.CHROME, BrowserType.CHROMIUM];
  if (normalized === 'detect' || normalized === 'auto') return undefined;
  const parsed = parseBrowserType(normalized);
  if (!parsed) {
    throw new Error(`Invalid browser: ${browserArg}. Use 'chrome', 'chromium', or 'all'`);
  }
  return [parsed];
}

export function resolveBrowsersToCheck(requested: BrowserType[] | undefined): BrowserType[] {
  if (requested && requested.length > 0) return requested;
  const detected = detectInstalledBrowsers();
  if (detected.length > 0) return detected;
  return [BrowserType.CHROME, BrowserType.CHROMIUM];
}

type RegistryValueType = 'REG_SZ' | 'REG_EXPAND_SZ';

export function queryWindowsRegistryDefaultValue(registryKey: string): {
  value?: string;
  valueType?: RegistryValueType;
  error?: string;
} {
  try {
    const output = execFileSync('reg', ['query', registryKey, '/ve'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2500,
      windowsHide: true,
    });
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/\b(REG_SZ|REG_EXPAND_SZ)\b\s+(.*)$/i);
      if (match?.[2]) {
        const valueType = match[1].toUpperCase() as RegistryValueType;
        return { value: match[2].trim(), valueType };
      }
    }
    return { error: 'No REG_SZ/REG_EXPAND_SZ default value found' };
  } catch (error) {
    return { error: stringifyError(error) };
  }
}

export async function attemptFixes(
  enabled: boolean,
  silent: boolean,
  distDir: string,
  targetBrowsers: BrowserType[] | undefined,
): Promise<DoctorFixAttempt[]> {
  if (!enabled) return [];

  const fixes: DoctorFixAttempt[] = [];
  const logDir = getLogDir();
  const nodePathFile = path.join(distDir, 'node_path.txt');

  const withMutedConsole = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!silent) return await fn();
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };

  const attempt = async (id: string, description: string, action: () => Promise<void> | void) => {
    try {
      await withMutedConsole(async () => {
        await action();
      });
      fixes.push({ id, description, success: true });
    } catch (error) {
      fixes.push({ id, description, success: false, error: stringifyError(error) });
    }
  };

  await attempt('logs', 'Ensure logs directory exists', async () => {
    fs.mkdirSync(logDir, { recursive: true });
  });

  await attempt('node_path', 'Write node_path.txt for run_host scripts', async () => {
    fs.writeFileSync(nodePathFile, process.execPath, 'utf8');
  });

  await attempt('permissions', 'Fix execution permissions for native host files', async () => {
    await ensureExecutionPermissions();
  });

  await attempt('register', 'Re-register Native Messaging host (user-level)', async () => {
    const ok = await tryRegisterUserLevelHost(targetBrowsers);
    if (!ok) {
      throw new Error('User-level registration failed');
    }
  });

  return fixes;
}

export function readJsonFile(
  filePath: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: stringifyError(error) };
  }
}

type FetchFn = typeof globalThis.fetch;

function resolveFetch(): FetchFn | null {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as FetchFn;
  }
  try {
    const mod = require('node-fetch');
    return (mod.default ?? mod) as FetchFn;
  } catch {
    return null;
  }
}

export async function checkConnectivity(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    return { ok: false, error: 'fetch is not available (requires Node.js >=18 or node-fetch)' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  try {
    const res = await fetchFn(url, { method: 'GET', signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    const errName = error instanceof Error ? error.name : '';
    if (errName === 'AbortError' || errMessage.toLowerCase().includes('abort')) {
      return { ok: false, error: `Timeout after ${timeoutMs}ms` };
    }
    return { ok: false, error: errMessage };
  } finally {
    clearTimeout(timeout);
  }
}

export function computeSummary(checks: DoctorCheckResult[]): { ok: number; warn: number; error: number } {
  let ok = 0;
  let warn = 0;
  let error = 0;
  for (const check of checks) {
    if (check.status === 'ok') ok++;
    else if (check.status === 'warn') warn++;
    else error++;
  }
  return { ok, warn, error };
}

export function statusBadge(status: DoctorStatus): string {
  if (status === 'ok') return colorText('[OK]', 'green');
  if (status === 'warn') return colorText('[WARN]', 'yellow');
  return colorText('[ERROR]', 'red');
}