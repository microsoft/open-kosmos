import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { AsyncLocalStorage } from 'async_hooks';
import { createLogger } from '../unifiedLogger';
import type { InternalToolType } from './RuntimeManager';
import { isValidPackageSpec, parsePackageSpecs } from '../../../shared/utils/pythonPackageSpec';

export { isValidPackageSpec, parsePackageSpecs };

const logger = createLogger();

/** Default time budget for a single uv pip invocation. Installs can be slow on cold caches. */
const INSTALL_TIMEOUT_MS = 180_000;
const LIST_TIMEOUT_MS = 30_000;

/** One package installed in the app-managed venv. */
export interface PythonPackage {
  name: string;
  version: string;
}

/**
 * Context the package helpers need from RuntimeManager. RuntimeManager satisfies this
 * structurally and passes thin delegators, mirroring pythonSelfHeal.ts. Keeping these as
 * free functions keeps RuntimeManager under its file-length budget.
 */
export interface PythonPackagesCtx {
  venvPath: string;
  getBinaryPath(tool: InternalToolType): string;
  getEnvWithInternalPath(): NodeJS.ProcessEnv;
  /**
   * Create/repair {userData}/python-venv for the pinned interpreter before a mutation. This also
   * serializes mutations behind any in-flight venv recreation; the renderer separately disables
   * package actions while the interpreter is updating, so the two never run concurrently.
   */
  ensureVenvReady?(): Promise<void>;
}

/** Serializes venv mutations so install/uninstall and venv recreation don't overlap. */
let mutationLock: Promise<unknown> = Promise.resolve();
const mutationLockScope = new AsyncLocalStorage<boolean>();

export function withVenvMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  if (mutationLockScope.getStore()) {
    return Promise.resolve().then(fn);
  }
  const run = mutationLock.then(
    () => mutationLockScope.run(true, fn),
    () => mutationLockScope.run(true, fn),
  );
  mutationLock = run.then(() => {}, () => {});
  return run;
}

/** Resolve the venv interpreter so `uv pip` targets {userData}/python-venv regardless of cwd. */
function venvPythonPath(venvPath: string): string {
  return process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
}

/**
 * Run `uv pip <args>` against the app-managed venv. Executes uv directly via spawn with
 * shell:false so package specs containing shell metacharacters — extras like `mcp[cli]`,
 * version ranges like `httpx>=0.27,<1` — reach uv verbatim instead of being globbed or
 * parsed as redirection by a shell. Never throws on a nonzero exit; callers inspect exitCode.
 */
async function runUvPip(
  ctx: PythonPackagesCtx,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const uvBin = ctx.getBinaryPath('uv');
  if (!fs.existsSync(uvBin)) {
    throw new Error('uv is not installed');
  }
  const venvPython = venvPythonPath(ctx.venvPath);
  const argv = ['pip', ...args, '--python', venvPython];
  return await new Promise((resolve) => {
    const child = spawn(uvBin, argv, {
      cwd: ctx.venvPath,
      env: ctx.getEnvWithInternalPath(),
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (exitCode: number | null) => {
      /* v8 ignore next */
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\nuv timed out after ${timeoutMs}ms`;
      finish(null);
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => { stderr += String(err); finish(null); });
    child.on('close', (code) => finish(code));
  });
}

/** List packages installed in the app-managed venv. Returns [] when the venv has none yet. */
export async function listPythonPackages(ctx: PythonPackagesCtx): Promise<PythonPackage[]> {
  if (!fs.existsSync(venvPythonPath(ctx.venvPath))) {
    return [];
  }
  const result = await runUvPip(ctx, ['list', '--format', 'json'], LIST_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    logger.warn(`[python-packages] uv pip list failed: ${result.stderr.substring(0, 300)}`, 'RuntimeManager');
    return [];
  }
  try {
    const parsed = JSON.parse(result.stdout) as Array<{ name?: string; version?: string }>;
    return parsed
      .filter((p) => !!p.name)
      .map((p) => ({ name: p.name as string, version: p.version ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    logger.warn(`[python-packages] Failed to parse uv pip list output: ${err instanceof Error ? err.message : String(err)}`, 'RuntimeManager');
    return [];
  }
}

/** Install one or more packages into the app-managed venv. Throws on validation or uv failure. */
export async function installPythonPackages(ctx: PythonPackagesCtx, packages: string[]): Promise<void> {
  if (!Array.isArray(packages)) {
    throw new Error('No packages specified');
  }
  const specs = packages.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter((p) => p.length > 0);
  if (specs.length === 0) {
    throw new Error('No packages specified');
  }
  const invalid = specs.filter((s) => !isValidPackageSpec(s));
  if (invalid.length > 0) {
    throw new Error(`Invalid package name(s): ${invalid.join(', ')}`);
  }
  await withVenvMutationLock(async () => {
    await ctx.ensureVenvReady?.();
    logger.info(`[python-packages] Installing: ${specs.join(', ')}`, 'RuntimeManager');
    const result = await runUvPip(ctx, ['install', ...specs], INSTALL_TIMEOUT_MS);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to install ${specs.join(', ')}: ${result.stderr.substring(0, 300)}`);
    }
    logger.info(`[python-packages] Installed: ${specs.join(', ')}`, 'RuntimeManager');
  });
}

/** Uninstall a single package from the app-managed venv. Throws on validation or uv failure. */
export async function uninstallPythonPackage(ctx: PythonPackagesCtx, packageName: string): Promise<void> {
  const name = typeof packageName === 'string' ? packageName.trim() : '';
  if (!isValidPackageSpec(name)) {
    throw new Error(`Invalid package name: ${packageName}`);
  }
  await withVenvMutationLock(async () => {
    await ctx.ensureVenvReady?.();
    logger.info(`[python-packages] Uninstalling: ${name}`, 'RuntimeManager');
    const result = await runUvPip(ctx, ['uninstall', name], INSTALL_TIMEOUT_MS);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to uninstall ${name}: ${result.stderr.substring(0, 300)}`);
    }
    logger.info(`[python-packages] Uninstalled: ${name}`, 'RuntimeManager');
  });
}
