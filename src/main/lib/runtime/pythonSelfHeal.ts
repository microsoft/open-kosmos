import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '../unifiedLogger';
import { getTerminalManager } from '../terminalManager';
import type { InternalToolType } from './RuntimeManager';

const logger = createLogger();
const VENV_REPAIR_COMMAND_ENV: Record<string, string | null> = { VIRTUAL_ENV: null };

/**
 * Context the Python self-heal helpers need from RuntimeManager.
 *
 * These functions are extracted from RuntimeManager as free functions (rather than
 * methods) so the class stays under the file-length budget. RuntimeManager satisfies
 * this interface structurally and passes `this` as the context; the helpers call back
 * through it (e.g. ctx.recreateVenv) so existing vi.spyOn(manager, ...) targets still fire.
 */
export interface PythonSelfHealCtx {
  venvPath: string;
  getBinaryPath(tool: InternalToolType): string;
  listPythonVersionsFast(): { version: string; path: string; status: 'installed'; impl: string; semver: string }[];
  installPythonVersion(version: string): Promise<void>;
  recreateVenv(version: string): Promise<void>;
  venvBaseInterpreterResolves(): boolean;
  ensureVenvPipAvailable(): Promise<boolean>;
}

type TerminalCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

function venvPythonPath(venvPath: string): string {
  return process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
}

function quoteCommandPath(commandPath: string): string {
  return commandPath.includes(' ') ? `"${commandPath.replace(/"/g, '\\"')}"` : commandPath;
}

async function runVenvRepairCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<TerminalCommandResult> {
  const terminalManager = getTerminalManager();
  return terminalManager.executeCommand({
    command: quoteCommandPath(command),
    args,
    cwd,
    type: 'command',
    env: VENV_REPAIR_COMMAND_ENV,
    timeoutMs,
  });
}

/**
 * Ensure the layer-2 venv at {userData}/python-venv matches the pinned Python.
 *
 * Only major.minor is compared (3.12.8 -> 3.12.9 is a compatible venv, no rebuild).
 * Even when the version text matches, the venv is rebuilt if its base (layer-1)
 * interpreter no longer resolves on disk — a dangling venv whose pyvenv.cfg still
 * reads the right version but whose `python`/`uv pip` would fail.
 */
export async function ensureVenvMatchesPinnedPython(ctx: PythonSelfHealCtx, pinnedVersion: string): Promise<void> {
  const venvDir = ctx.venvPath;
  const pyvenvCfg = path.join(venvDir, 'pyvenv.cfg');

  const semverMatch = pinnedVersion.match(/(\d+\.\d+\.\d+)/);
  if (!semverMatch) {
    logger.warn(`[FRE] Cannot parse semver from pinned version "${pinnedVersion}", skipping venv check`, 'RuntimeManager');
    return;
  }
  const pinnedMajorMinor = semverMatch[1].split('.').slice(0, 2).join('.'); // e.g. "3.12"

  // Read current venv's Python version from pyvenv.cfg
  let venvVersion: string | null = null;
  try {
    if (fs.existsSync(pyvenvCfg)) {
      const content = fs.readFileSync(pyvenvCfg, 'utf-8');
      const match = content.match(/version_info\s*=\s*(\d+\.\d+)/);
      if (match) {
        venvVersion = match[1]; // e.g. "3.10"
      }
    }
  } catch (err) {
    logger.warn(`[FRE] Failed to read pyvenv.cfg: ${err instanceof Error ? err.message : String(err)}`, 'RuntimeManager');
  }

  // If no venv exists, proactively create one
  if (!fs.existsSync(venvDir)) {
    logger.debug('[FRE] No python-venv directory found, creating for pinned version', 'RuntimeManager');
    await ctx.recreateVenv(pinnedVersion);
    await ctx.ensureVenvPipAvailable();
    return;
  }

  if (venvVersion === pinnedMajorMinor) {
    // Version text matches; only healthy if the base interpreter still exists (not dangling).
    if (ctx.venvBaseInterpreterResolves()) {
      logger.debug(`[FRE] python-venv Python version (${venvVersion}) matches pinned (${pinnedMajorMinor}) and base interpreter resolves, no rebuild needed`, 'RuntimeManager');
      await ctx.ensureVenvPipAvailable();
      return;
    }
    logger.info(
      `[FRE] python-venv version (${venvVersion}) matches pinned (${pinnedMajorMinor}) but base interpreter is missing/dangling. Rebuilding...`,
      'RuntimeManager'
    );
    await ctx.recreateVenv(pinnedVersion);
    await ctx.ensureVenvPipAvailable();
    return;
  }

  logger.info(
    `[FRE] python-venv Python version mismatch: venv=${venvVersion || 'unknown'}, pinned=${pinnedMajorMinor}. Rebuilding...`,
    'RuntimeManager'
  );
  await ctx.recreateVenv(pinnedVersion);
  await ctx.ensureVenvPipAvailable();
}

/**
 * Verify the venv's base Python interpreter (layer-1) still exists on disk.
 *
 * A `uv venv` records the interpreter dir in pyvenv.cfg's `home = ...` line and places
 * a `bin/python` (Scripts/python.exe on Windows) symlink pointing at it. If the layer-1
 * interpreter is deleted, the venv keeps a valid-looking pyvenv.cfg but every
 * `python`/`uv pip` invocation fails. Returns false in that dangling case so callers rebuild.
 */
export function venvBaseInterpreterResolves(ctx: PythonSelfHealCtx): boolean {
  const venvDir = ctx.venvPath;
  const isWin = process.platform === 'win32';

  try {
    // The active venv must expose the interpreter entrypoints uv inspects.
    // fs.existsSync follows symlinks, so a dangling python/python3 symlink returns false.
    const venvEntrypoints = isWin
      ? [path.join(venvDir, 'Scripts', 'python.exe')]
      : [path.join(venvDir, 'bin', 'python'), path.join(venvDir, 'bin', 'python3')];
    if (!venvEntrypoints.every((entrypoint) => fs.existsSync(entrypoint))) {
      return false;
    }

    // Also verify pyvenv.cfg points at a real base interpreter.
    const pyvenvCfg = path.join(venvDir, 'pyvenv.cfg');
    if (!fs.existsSync(pyvenvCfg)) {
      return false;
    }
    const content = fs.readFileSync(pyvenvCfg, 'utf-8');
    const homeMatch = content.match(/^\s*home\s*=\s*(.+?)\s*$/m);
    if (!homeMatch) {
      return false;
    }
    const homeDir = homeMatch[1];
    const baseExe = isWin ? path.join(homeDir, 'python.exe') : path.join(homeDir, 'python');
    return fs.existsSync(baseExe);
  } catch (err) {
    logger.warn(`[FRE] Failed to verify venv base interpreter: ${err instanceof Error ? err.message : String(err)}`, 'RuntimeManager');
    // On read error, treat as unresolved so the caller rebuilds rather than trusting a broken venv.
    return false;
  }
}

/**
 * Ensure the pinned layer-1 Python interpreter is installed via uv.
 *
 * Startup previously installed only uv/bun and built the layer-2 venv shell, but never
 * the actual CPython interpreter (`uv python install`) — that only happened via the
 * manual "Install Python" button, so a fresh machine showed "No Python versions detected".
 * No-op when a matching major.minor interpreter is already installed. Non-fatal: errors
 * are logged and swallowed so init continues.
 */
export async function ensurePinnedPythonInstalled(ctx: PythonSelfHealCtx, pinnedVersion: string): Promise<void> {
  try {
    const semverMatch = pinnedVersion.match(/(\d+\.\d+\.\d+)/);
    if (!semverMatch) {
      logger.warn(`[FRE][python] Cannot parse semver from pinned version "${pinnedVersion}", skipping interpreter install`, 'RuntimeManager');
      return;
    }
    const pinnedMajorMinor = semverMatch[1].split('.').slice(0, 2).join('.'); // e.g. "3.10"

    const installed = ctx.listPythonVersionsFast();
    const alreadyInstalled = installed.some(
      (p) => p.semver.split('.').slice(0, 2).join('.') === pinnedMajorMinor,
    );
    if (alreadyInstalled) {
      logger.debug(`[FRE][python] Pinned interpreter (${pinnedMajorMinor}) already installed, skipping`, 'RuntimeManager');
      return;
    }

    logger.info(`[FRE][python] Pinned interpreter (${pinnedVersion}) not installed, starting background install...`, 'RuntimeManager');
    await ctx.installPythonVersion(pinnedVersion);
    logger.info(`[FRE][python] Pinned interpreter (${pinnedVersion}) install completed`, 'RuntimeManager');
  } catch (err) {
    logger.error('[FRE][python] Failed to ensure pinned Python interpreter (non-fatal)', 'RuntimeManager', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Delete the venv at {userData}/python-venv and recreate it with
 * `uv venv --seed --python <version> <venvPath>`. No writability check needed ({userData}
 * is always writable). Serialization of concurrent rebuilds is handled by the caller
 * (RuntimeManager.recreateVenv).
 */
export async function doRecreateVenv(ctx: PythonSelfHealCtx, pythonVersion: string): Promise<void> {
  const venvDir = ctx.venvPath;

  // Remove old venv
  try {
    if (fs.existsSync(venvDir)) {
      fs.rmSync(venvDir, { recursive: true, force: true });
      logger.info('[FRE] Deleted stale python-venv directory', 'RuntimeManager');
    }
  } catch (err) {
    logger.error(`[FRE] Failed to delete python-venv: ${err instanceof Error ? err.message : String(err)}`, 'RuntimeManager');
    return;
  }

  // Recreate venv using uv — explicitly specify the venv path so uv doesn't rely on
  // cwd-based discovery. Use the full uv binary path (not bare "uv") to avoid PATH
  // resolution issues on fresh installs. Quote paths with spaces for TerminalManager's
  // parseCommandString.
  const uvBin = ctx.getBinaryPath('uv');
  if (!fs.existsSync(uvBin)) {
    logger.warn(`[FRE] uv binary not found at ${uvBin}, skipping venv creation`, 'RuntimeManager');
    return;
  }
  const uvCommand = uvBin.includes(' ') ? `"${uvBin}"` : uvBin;

  try {
    const terminalManager = getTerminalManager();
    const result = await terminalManager.executeCommand({
      command: uvCommand,
      args: ['venv', '--seed', '--python', pythonVersion, venvDir],
      cwd: path.dirname(venvDir),
      type: 'command',
      env: VENV_REPAIR_COMMAND_ENV,
      timeoutMs: 60_000,
    });

    if (result.exitCode === 0) {
      logger.info(`[FRE] python-venv created at ${venvDir} with Python ${pythonVersion}`, 'RuntimeManager');
    } else {
      logger.error(
        `[FRE] Failed to create python-venv (exit code ${result.exitCode}): ${result.stderr.substring(0, 300)}`,
        'RuntimeManager'
      );
    }
  } catch (err) {
    logger.error(`[FRE] Error creating python-venv: ${err instanceof Error ? err.message : String(err)}`, 'RuntimeManager');
  }
}

export async function ensureVenvPipAvailable(ctx: PythonSelfHealCtx): Promise<boolean> {
  const venvDir = ctx.venvPath;
  const pythonPath = venvPythonPath(venvDir);

  if (!fs.existsSync(pythonPath)) {
    logger.warn(`[FRE][python] Cannot verify pip because venv Python is missing at ${pythonPath}`, 'RuntimeManager');
    return false;
  }

  try {
    const check = await runVenvRepairCommand(
      pythonPath,
      ['-m', 'pip', '--version'],
      path.dirname(venvDir),
      30_000,
    );
    if (check.exitCode === 0) {
      logger.debug('[FRE][python] python-venv pip is available', 'RuntimeManager');
      return true;
    }

    logger.info('[FRE][python] python-venv pip is unavailable, repairing with uv pip', 'RuntimeManager', {
      stdout: check.stdout.substring(0, 300),
      stderr: check.stderr.substring(0, 300),
    });

    const uvBin = ctx.getBinaryPath('uv');
    if (!fs.existsSync(uvBin)) {
      logger.warn(`[FRE][python] uv binary not found at ${uvBin}, cannot repair pip`, 'RuntimeManager');
      return false;
    }

    const repair = await runVenvRepairCommand(
      uvBin,
      ['pip', 'install', 'pip', 'setuptools', 'wheel', '--python', pythonPath],
      path.dirname(venvDir),
      180_000,
    );
    if (repair.exitCode !== 0) {
      logger.error('[FRE][python] Failed to repair python-venv pip', 'RuntimeManager', {
        stdout: repair.stdout.substring(0, 300),
        stderr: repair.stderr.substring(0, 300),
      });
      return false;
    }

    const verify = await runVenvRepairCommand(
      pythonPath,
      ['-m', 'pip', '--version'],
      path.dirname(venvDir),
      30_000,
    );
    const repaired = verify.exitCode === 0;
    if (repaired) {
      logger.info('[FRE][python] python-venv pip repaired successfully', 'RuntimeManager');
    } else {
      logger.error('[FRE][python] python-venv pip repair did not make pip importable', 'RuntimeManager', {
        stdout: verify.stdout.substring(0, 300),
        stderr: verify.stderr.substring(0, 300),
      });
    }
    return repaired;
  } catch (err) {
    logger.error('[FRE][python] Failed to verify or repair python-venv pip', 'RuntimeManager', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
