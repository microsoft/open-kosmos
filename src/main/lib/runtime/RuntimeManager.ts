import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import { spawn, execSync } from 'child_process';
import { createLogger } from '../unifiedLogger';
import { LocalPythonMirror } from './LocalPythonMirror';
import { isFeatureEnabled } from '../featureFlags';
import { appCacheManager } from '../userDataADO/appCacheManager';
import type { RuntimeEnvironment, RuntimeMode } from '../userDataADO/types/app';
import { DEFAULT_RUNTIME_ENVIRONMENT } from '../userDataADO/types/app';
import { getTerminalManager } from '../terminalManager';
import StreamZip from 'node-stream-zip';

const logger = createLogger();

export type InternalToolType = 'bun' | 'uv';

export class RuntimeManager {
  private static instance: RuntimeManager;
  private binPath: string;
  private venvPath: string;

  // Installation locks to prevent concurrent installations of the same component
  private installLocks: Map<string, Promise<void>> = new Map();

  // Resolves when ensureRequiredToolsInstalled + ensureShims completes (internal mode only)
  private _shimsReadyPromise: Promise<void> | null = null;

  // Guards against concurrent venv creation attempts
  private _venvCreationPromise: Promise<void> | null = null;
  private _venvCreationVersion: string | null = null;

  private constructor() {
    // Determine user data path (handling multi-brand via app.getName() usually,
    // but app.getPath('userData') is already app-specific)
    const userDataPath = app.getPath('userData');
    this.binPath = path.join(userDataPath, 'bin');
    this.venvPath = path.join(userDataPath, 'python-venv');

    const mode = appCacheManager.getConfig().runtimeEnvironment?.mode ?? DEFAULT_RUNTIME_ENVIRONMENT.mode;
    logger.info(`Initialized. Bin path: ${this.binPath}, Venv path: ${this.venvPath}, Mode: ${mode}`);

    // Register IPC handlers
    this.registerIpcHandlers();

    // Initialize internal mode if configured (check and repair shims)
    this.initializeInternalMode();

  }

  public static getInstance(): RuntimeManager {
    if (!RuntimeManager.instance) {
      RuntimeManager.instance = new RuntimeManager();
    }
    return RuntimeManager.instance;
  }

  // --- Configuration Management ---

  /**
   * Returns the current RuntimeEnvironment configuration (read from AppCacheManager).
   */
  public getRunTimeConfig(): RuntimeEnvironment {
    return appCacheManager.getConfig().runtimeEnvironment ?? { ...DEFAULT_RUNTIME_ENVIRONMENT };
  }

  /**
   * Wait until internal-mode shims are ready (tools installed + shims created).
   * Resolves immediately if not in internal mode or if tools are already installed.
   * Times out after `timeoutMs` to avoid blocking MCP startup indefinitely.
   */
  public async waitForShimsReady(timeoutMs: number = 30_000): Promise<void> {
    if (!this._shimsReadyPromise) {
      return;
    }
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Shims not ready after ${timeoutMs}ms`)), timeoutMs),
    );
    try {
      await Promise.race([this._shimsReadyPromise, timeout]);
    } catch (e) {
      logger.warn('waitForShimsReady did not complete in time, proceeding anyway', 'RuntimeManager', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  public async setRuntimeMode(mode: RuntimeMode): Promise<void> {
    logger.info(`Switching runtime mode to: ${mode}`);
    const current = appCacheManager.getConfig();
    await appCacheManager.updateConfig({
      runtimeEnvironment: {
        ...(current.runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT),
        mode,
      },
    });
    if (mode === 'internal') {
      this.initializeInternalMode();
    }
  }

  public async setVersion(tool: InternalToolType, version: string): Promise<void> {
    const current = appCacheManager.getConfig();
    const rt = current.runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT;
    await appCacheManager.updateConfig({
      runtimeEnvironment: {
        ...rt,
        ...(tool === 'bun' ? { bunVersion: version } : { uvVersion: version }),
      },
    });
  }

  public async setPinnedPythonVersion(version: string | null): Promise<void> {
    const current = appCacheManager.getConfig();
    const rt = current.runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT;
    logger.info(`[FRE] Setting pinned Python version`, 'RuntimeManager', {
      newVersion: version,
      oldVersion: rt.pinnedPythonVersion,
    });

    if (rt.pinnedPythonVersion !== version) {
      logger.debug(`[FRE] Saving runtime config with new pinned version`, 'RuntimeManager');
      await appCacheManager.updateConfig({
        runtimeEnvironment: {
          ...rt,
          pinnedPythonVersion: version,
        },
      });
      // Note: We no longer clean uv cache here as it doesn't help with venv issues
      // and can cause FRE to hang for a long time if cache is large
      logger.info(`[FRE] Pinned Python version set to ${version}`, 'RuntimeManager');

      // Auto-rebuild .venv if the existing venv's Python version doesn't match.
      // uv pip refuses to operate when the venv was created with a different Python.
      if (version) {
        await this.ensureVenvMatchesPinnedPython(version);
      }
    } else {
      logger.debug(`[FRE] Pinned Python version unchanged, skipping`, 'RuntimeManager');
    }
  }

  /**
   * Returns the absolute path to the Python virtual environment directory.
   *
   * The venv lives under {userData}/python-venv/ (e.g.
   * ~/Library/Application Support/openkosmos-app/python-venv/ on macOS).
   *
   * This is deliberately NOT in process.cwd()/.venv because:
   *   - process.cwd() is "/" on packaged macOS apps and "C:\Windows\System32"
   *     on packaged Windows apps — both are not writable.
   *   - app.getPath('userData') is always writable, in both dev and production.
   *   - Other app-managed resources (whisper models, native modules, playwright
   *     profiles) already live under userData.
   *
   * The VIRTUAL_ENV environment variable is set in getEnvWithInternalPath()
   * so that `uv pip install`, `python`, and any subprocess automatically
   * discover this venv regardless of their working directory.
   */
  public getVenvPath(): string {
    return this.venvPath;
  }

  /**
   * Ensure the Python venv matches the pinned Python version.
   *
   * Reads {userData}/python-venv/pyvenv.cfg to extract `version_info`
   * (e.g. "3.10"). If it doesn't match the pinned version's major.minor
   * (e.g. "3.12"), deletes the stale venv and recreates it with
   * `uv venv --python <version> {userData}/python-venv`.
   *
   * This prevents `uv pip install` from failing with:
   *   "No virtual environment found for cpython-X.Y.Z-..."
   *
   * Called automatically by setPinnedPythonVersion() when the version changes.
   *
   * Environment compatibility:
   *   The venv lives in {userData}/python-venv/, which is always writable
   *   in both dev and packaged (production) environments on macOS and Windows.
   *   This eliminates the need for process.cwd() writability checks.
   *
   * Version comparison:
   *   Only major.minor is compared (e.g. "3.12"). Patch-level differences
   *   (3.12.8 → 3.12.9) produce compatible venvs and do NOT trigger rebuild.
   */
  private async ensureVenvMatchesPinnedPython(pinnedVersion: string): Promise<void> {
    const venvDir = this.venvPath;
    const pyvenvCfg = path.join(venvDir, 'pyvenv.cfg');

    // Extract semver from pinned version (handles both "3.12.9" and "cpython-3.12.9-..." formats)
    const semverMatch = pinnedVersion.match(/(\d+\.\d+\.\d+)/);
    if (!semverMatch) {
      logger.warn(`[FRE] Cannot parse semver from pinned version "${pinnedVersion}", skipping venv check`, 'RuntimeManager');
      return;
    }
    const pinnedSemver = semverMatch[1]; // e.g. "3.12.9"
    // Compare major.minor only (patch difference is OK, venv is compatible)
    const pinnedMajorMinor = pinnedSemver.split('.').slice(0, 2).join('.'); // e.g. "3.12"

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
      // Proactively create venv for the pinned version
      await this.recreateVenv(pinnedVersion);
      return;
    }

    if (venvVersion === pinnedMajorMinor) {
      logger.debug(`[FRE] python-venv Python version (${venvVersion}) matches pinned (${pinnedMajorMinor}), no rebuild needed`, 'RuntimeManager');
      return;
    }

    // Version mismatch — rebuild
    logger.info(
      `[FRE] python-venv Python version mismatch: venv=${venvVersion || 'unknown'}, pinned=${pinnedMajorMinor}. Rebuilding...`,
      'RuntimeManager'
    );

    await this.recreateVenv(pinnedVersion);
  }

  /**
   * Delete the venv at {userData}/python-venv and recreate it with
   * `uv venv --python <version> <venvPath>`.
   *
   * No writability check is needed because {userData} is always writable.
   */
  private async recreateVenv(pythonVersion: string): Promise<void> {
    // Serialize concurrent venv creation attempts. After waiting for any
    // in-flight rebuild, re-check: if another waiter already started (or is
    // starting) a rebuild for the version we need, join that; otherwise
    // become the owner of the next rebuild. This loop guarantees every
    // caller returns only after a rebuild for its requested version has
    // actually completed.
    while (this._venvCreationPromise) {
      logger.debug('[FRE] Venv creation already in progress, waiting for it to finish', 'RuntimeManager');
      await this._venvCreationPromise;
      // After the await, re-check: another waiter may have kicked off a new
      // rebuild already (loop re-enters), or the just-finished rebuild may
      // match our version (return early).
      if (!this._venvCreationPromise && this._venvCreationVersion === pythonVersion) {
        return;
      }
    }

    this._venvCreationVersion = pythonVersion;
    this._venvCreationPromise = this.doRecreateVenv(pythonVersion).finally(() => {
      this._venvCreationPromise = null;
    });
    await this._venvCreationPromise;
  }

  private async doRecreateVenv(pythonVersion: string): Promise<void> {
    const venvDir = this.venvPath;

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

    // Recreate venv using uv — explicitly specify the venv path so uv doesn't
    // rely on cwd-based discovery. This works in both dev and packaged environments.
    // Use the full path to uv binary instead of bare "uv" to avoid PATH resolution
    // issues on fresh installs where the bin directory was just created.
    // Quote the path for TerminalManager's parseCommandString so paths with
    // spaces (e.g. "C:\Users\John Smith\AppData\...\uv.exe") are not split.
    const uvBin = this.getBinaryPath('uv');
    if (!fs.existsSync(uvBin)) {
      logger.warn(`[FRE] uv binary not found at ${uvBin}, skipping venv creation`, 'RuntimeManager');
      return;
    }
    const uvCommand = uvBin.includes(' ') ? `"${uvBin}"` : uvBin;

    try {
      const terminalManager = getTerminalManager();
      const result = await terminalManager.executeCommand({
        command: uvCommand,
        args: ['venv', '--python', pythonVersion, venvDir],
        cwd: path.dirname(venvDir),
        type: 'command',
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

  // --- Path & Environment ---

  public getBinaryPath(tool: InternalToolType): string {
    const isWin = process.platform === 'win32';

    if (tool === 'bun') {
      return path.join(this.binPath, isWin ? 'bun.exe' : 'bun');
    } else {
      // uv usually installs 'uv' and 'uvx'. We return the path to the executable.
      return path.join(this.binPath, isWin ? 'uv.exe' : 'uv');
    }
  }

  public isInstalled(tool: InternalToolType): boolean {
      const binPath = this.getBinaryPath(tool);
      return fs.existsSync(binPath);
  }

  /**
   * Check if Git is installed in the system PATH and return its version
   */
  public async checkGitVersion(): Promise<{ installed: boolean; version: string | null; path: string | null }> {
    const terminalManager = getTerminalManager();

    try {
      // Try to get git version
      const versionResult = await terminalManager.executeCommand({
        command: 'git',
        args: ['--version'],
        cwd: process.cwd(),
        type: 'command',
        timeoutMs: 5000
      });

      if (versionResult.exitCode !== 0) {
        return {
          installed: false,
          version: null,
          path: null
        };
      }

      const versionOutput = versionResult.stdout.trim();

      // Extract version number from "git version X.XX.X..."
      const versionMatch = versionOutput.match(/git version (\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : versionOutput.replace('git version ', '');

      // Try to get git path
      let gitPath: string | null = null;
      try {
        // On Windows, use where.exe explicitly (not 'where' which is a PowerShell alias for Where-Object)
        const whereCommand = process.platform === 'win32' ? 'where.exe' : 'which';
        const pathResult = await terminalManager.executeCommand({
          command: whereCommand,
          args: ['git'],
          cwd: process.cwd(),
          type: 'command',
          timeoutMs: 5000
        });

        if (pathResult.exitCode === 0) {
          gitPath = pathResult.stdout.trim().split('\n')[0]; // Get first result if multiple
        }
      } catch {
        // Path lookup failed, but git is still installed
      }


      return {
        installed: true,
        version,
        path: gitPath
      };
    } catch {
      return {
        installed: false,
        version: null,
        path: null
      };
    }
  }

  /**
   * ============================================================================
   * SHIM MANAGEMENT
   * ============================================================================
   *
   * Shims are small wrapper scripts that redirect command calls to internal tools.
   * For example, when user runs "python", the shim redirects it to "uv run python".
   *
   * This approach allows us to:
   * 1. Override system commands (python, pip, npm, node) with our managed versions
   * 2. Use uv's Python management for all Python-related commands
   * 3. Use bun as a faster alternative for Node.js/npm commands
   *
   * SHIM LIST:
   * ┌─────────────┬─────────────────────────┬────────────┐
   * │ Shim        │ Redirects to            │ Dependency │
   * ├─────────────┼─────────────────────────┼────────────┤
   * │ python      │ uv run python           │ uv         │
   * │ python3     │ uv run python           │ uv         │
   * │ pip         │ uv pip                  │ uv         │
   * │ pip3        │ uv pip                  │ uv         │
   * │ uvx         │ uv tool run             │ uv         │
   * │ npm         │ bun                     │ bun        │
   * │ npx         │ bun x -y                │ bun        │
   * │ node        │ bun                     │ bun        │
   * └─────────────┴─────────────────────────┴────────────┘
   *
   * On Windows, shims are .cmd batch files.
   * On Unix/macOS, shims are shell scripts.
   *
   * @param forceRecreate - If true, recreate all shims even if they exist.
   *                        Set to true when:
   *                        - App starts in internal mode (ensure shims are up-to-date)
   *                        - After installing a new tool (create shims for the new tool)
   */
  private ensureShims(forceRecreate: boolean = false) {
    try {
      if (!fs.existsSync(this.binPath)) {
        return;
      }

      const isWin = process.platform === 'win32';
      const createdShims: string[] = [];
      const skippedShims: string[] = [];

      /**
       * Creates a single shim file.
       * @param name - Filename of the shim (e.g., 'python.cmd' or 'python')
       * @param content - The script content to write
       * @param dependency - Optional: the tool that must be installed for this shim to work
       */
      const createShim = (name: string, content: string, dependency?: 'uv' | 'bun') => {
         // Skip creating shim if its dependency tool is not installed
         if (dependency) {
           const depPath = path.join(this.binPath, isWin ? `${dependency}.exe` : dependency);
           if (!fs.existsSync(depPath)) {
             skippedShims.push(`${name} (missing ${dependency})`);
             return;
           }
         }

         const shimPath = path.join(this.binPath, name);
         // Recreate if forceRecreate is true or if shim doesn't exist
         if (forceRecreate || !fs.existsSync(shimPath)) {
             fs.writeFileSync(shimPath, content, { encoding: 'utf-8', mode: 0o755 });
             createdShims.push(name);
         }
      };

      if (isWin) {
         // ========== Windows .cmd Shims ==========
         // Format: @echo off + call to actual executable with %* for all arguments
         // %~dp0 expands to the directory containing the .cmd file (our bin folder)

         // UV-dependent shims (Python ecosystem)
         createShim('python.cmd', '@echo off\r\n"%~dp0uv.exe" run python %*', 'uv');
         createShim('python3.cmd', '@echo off\r\n"%~dp0uv.exe" run python %*', 'uv');
         createShim('pip.cmd', '@echo off\r\n"%~dp0uv.exe" pip %*', 'uv');
         createShim('pip3.cmd', '@echo off\r\n"%~dp0uv.exe" pip %*', 'uv');
         createShim('uvx.cmd', '@echo off\r\n"%~dp0uv.exe" tool run %*', 'uv');

         // Bun-dependent shims (Node.js ecosystem)
         createShim('npm.cmd', '@echo off\r\n"%~dp0bun.exe" %*', 'bun');
         createShim('npx.cmd', '@echo off\r\n"%~dp0bun.exe" x -y %*', 'bun');
         createShim('node.cmd', '@echo off\r\n"%~dp0bun.exe" %*', 'bun');

      } else {
         // ========== Unix/macOS Shell Shims ==========
         // Format: #!/bin/sh script that execs the actual command
         // $DIR resolves to the directory containing the shim script

         const createShellShim = (name: string, command: string, args: string = '', dependency?: 'uv' | 'bun') => {
             const content = `#!/bin/sh\nDIR="$(dirname "$0")"\nexec "$DIR/${command}" ${args} "$@"\n`;
             createShim(name, content, dependency);
         };

         // UV-dependent shims (Python ecosystem)
         createShellShim('python', 'uv', 'run python', 'uv');
         createShellShim('python3', 'uv', 'run python', 'uv');
         createShellShim('pip', 'uv', 'pip', 'uv');
         createShellShim('pip3', 'uv', 'pip', 'uv');
         createShellShim('uvx', 'uv', 'tool run', 'uv');

         // Bun-dependent shims (Node.js ecosystem)
         createShellShim('npm', 'bun', '', 'bun');
         createShellShim('npx', 'bun', 'x -y', 'bun');
         createShellShim('node', 'bun', '', 'bun');
      }

      if (createdShims.length > 0) {
        logger.info(`Shims created/updated: ${createdShims.join(', ')}`, 'RuntimeManager');
      }
      if (skippedShims.length > 0) {
        logger.debug(`Shims skipped (dependency not installed): ${skippedShims.join(', ')}`, 'RuntimeManager');
      }
      logger.debug('Shims check completed', 'RuntimeManager');
    } catch (e) {
      logger.error('Failed to ensure shims', 'RuntimeManager', { error: e });
    }
  }

  /**
   * ============================================================================
   * INTERNAL MODE INITIALIZATION
   * ============================================================================
   *
   * Called automatically when RuntimeManager is instantiated and mode is 'internal'.
   *
   * INITIALIZATION FLOW:
   * ┌─────────────────────────────────────────────────────────────────┐
   * │ 1. Create bin directory (if not exists)                        │
   * │    └─> {userData}/bin/                                         │
   * │                                                                 │
   * │ 2. Check & install required tools (async, non-blocking)        │
   * │    ├─> uv not found? → Install silently → Refresh shims        │
   * │    └─> bun not found? → Install silently → Refresh shims       │
   * │                                                                 │
   * │ 3. Ensure Python venv exists (async, after tools installed)    │
   * │    └─> {userData}/python-venv/ created if missing              │
   * │                                                                 │
   * │ 4. Ensure shims are up-to-date (force recreate)                │
   * │    └─> Creates shims for already-installed tools immediately   │
   * └─────────────────────────────────────────────────────────────────┘
   *
   * WHY ASYNC TOOL INSTALLATION?
   * - Tool downloads can take time (network dependent)
   * - We don't want to block app startup
   * - Shims are created immediately for existing tools
   * - New shims are created after each tool finishes installing
   */
  public initializeInternalMode() {
    const mode = appCacheManager.getConfig().runtimeEnvironment?.mode ?? DEFAULT_RUNTIME_ENVIRONMENT.mode;
    if (mode !== 'internal') {
      logger.debug('Skipping internal mode initialization (mode is system)', 'RuntimeManager');
      return;
    }

    logger.info('Initializing internal mode...', 'RuntimeManager');

    // Step 1: Ensure bin directory exists
    if (!fs.existsSync(this.binPath)) {
      fs.mkdirSync(this.binPath, { recursive: true });
      logger.info(`Created bin directory: ${this.binPath}`, 'RuntimeManager');
    }

    // Step 2: Check and silently install required tools (uv and bun) if not present
    // This runs asynchronously in the background to not block app startup
    // Installation failures are logged but won't crash the app
    this._shimsReadyPromise = this.ensureRequiredToolsInstalled()
      .then(() => {
        // Refresh shims after all tools are installed
        this.ensureShims(true);
        // Step 3: After tools are installed, ensure the Python venv exists.
        // This must run AFTER uv is available (ensureRequiredToolsInstalled installs uv).
        // If a pinned Python version is configured but no venv exists yet,
        // create one proactively so that subsequent `uv pip install` calls succeed.
        const pinnedVersion = this.getRunTimeConfig().pinnedPythonVersion;
        if (pinnedVersion) {
          return this.ensureVenvMatchesPinnedPython(pinnedVersion);
        }
      })
      .catch(err => {
        logger.error('Failed to ensure required tools/venv are ready', 'RuntimeManager', { error: err });
      });

    // Step 4: Check and repair shims (force recreate to ensure they are up-to-date)
    // Note: Some shims may not be created yet if tools are being installed
    // They will be created after installation completes (see ensureRequiredToolsInstalled)
    this.ensureShims(true);

    logger.info('Internal mode initialization completed', 'RuntimeManager');
  }

  /**
   * Ensure required tools (uv and bun) are installed for internal mode.
   *
   * This method:
   * 1. Checks if uv is installed → if not, installs it silently
   * 2. Checks if bun is installed → if not, installs it silently
   * 3. Both installations run in parallel for faster completion
   * 4. After each tool is installed, shims are refreshed to make them available
   *
   * IMPORTANT: This is an async method that runs in the background.
   * Failures are caught and logged, but won't crash the application.
   *
   * VERSION MANAGEMENT:
   * - Uses runtimeEnvironment.uvVersion for uv
   * - Uses runtimeEnvironment.bunVersion for bun
   * - Versions can be updated via setVersion() method
   */
  private async ensureRequiredToolsInstalled(): Promise<void> {
    const installPromises: Promise<void>[] = [];

    // Check and install uv if not present
    // uv is critical for: python, python3, pip, pip3, uvx shims
    const rt = this.getRunTimeConfig();
    if (!this.isInstalled('uv')) {
      logger.info(`[FRE] uv not found, starting silent installation (v${rt.uvVersion})...`, 'RuntimeManager');
      installPromises.push(
        this.installRuntime('uv', rt.uvVersion)
          .then(() => {
            logger.info('[FRE] uv silent installation completed', 'RuntimeManager');
            // Refresh shims after uv installation to create python/pip shims
            this.ensureShims(true);
          })
          .catch(err => {
            logger.error('[FRE] uv silent installation failed', 'RuntimeManager', { error: err });
          })
      );
    } else {
      logger.debug('[FRE] uv already installed', 'RuntimeManager');
    }

    // Check and install bun if not present
    // bun is used for: npm, npx, node shims (faster alternative to Node.js)
    if (!this.isInstalled('bun')) {
      logger.info(`[FRE] bun not found, starting silent installation (v${rt.bunVersion})...`, 'RuntimeManager');
      installPromises.push(
        this.installRuntime('bun', rt.bunVersion)
          .then(() => {
            logger.info('[FRE] bun silent installation completed', 'RuntimeManager');
            // Refresh shims after bun installation to create npm/npx/node shims
            this.ensureShims(true);
          })
          .catch(err => {
            logger.error('[FRE] bun silent installation failed', 'RuntimeManager', { error: err });
          })
      );
    } else {
      logger.debug('[FRE] bun already installed', 'RuntimeManager');
    }

    // Wait for all installations to complete (parallel execution)
    if (installPromises.length > 0) {
      logger.info(`[FRE] Waiting for ${installPromises.length} tool(s) to install...`, 'RuntimeManager');
      await Promise.all(installPromises);
      logger.info('[FRE] All required tools installation completed', 'RuntimeManager');
    }
  }

  /**
   * Returns environment variables with Internal Bin path prepended to PATH
   */
  public getEnvWithInternalPath(baseEnv = process.env): NodeJS.ProcessEnv {
      // Ensure shims exist whenever we use the internal environment
      this.ensureShims();

      const env = { ...baseEnv };
      const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';

      const currentPath = env[pathKey] || '';
      env[pathKey] = `${this.binPath}${path.delimiter}${currentPath}`;

      // Ensure Python uses UTF-8 to avoid encoding issues in subprocesses
      // This is especially important for tools running on Windows
      env['PYTHONUTF8'] = '1';
      env['PYTHONIOENCODING'] = 'utf-8';

      // If a specific python version is pinned, force uv to use it
      const pinnedPythonVersion = this.getRunTimeConfig().pinnedPythonVersion;
      if (pinnedPythonVersion && pinnedPythonVersion.trim().length > 0) {
         // UV_PYTHON sets the Python interpreter for uv commands (run, tool run, pip, etc.)
         // It can accept a path or a version request like "3.12"
         env['UV_PYTHON'] = pinnedPythonVersion;
      }

      // Point VIRTUAL_ENV to {userData}/python-venv so that `uv pip install`,
      // `python`, and any subprocess discover the venv regardless of cwd.
      // This replaces the previous reliance on process.cwd()/.venv discovery.
      env['VIRTUAL_ENV'] = this.venvPath;

      // Remove npm_config_prefix to avoid conflicts with nvm in subprocesses.
      // Homebrew node sets this, but it's incompatible with nvm and unnecessary
      // for our internal runtime environment.
      delete env['npm_config_prefix'];

      // Check if mirror is running and inject environment variable
      const mirrorUrl = LocalPythonMirror.getInstance().getBaseUrlIfRunning();
      if (mirrorUrl) {
           env['UV_PYTHON_INSTALL_MIRROR'] = mirrorUrl;
      }

      return env;
  }

  // --- Installation ---

  public async installRuntime(tool: InternalToolType, version: string): Promise<void> {
    const lockKey = `${tool}-${version}`;

    // Check if installation is already in progress
    const existingLock = this.installLocks.get(lockKey);
    if (existingLock) {
        logger.info(`[FRE] ${tool} v${version} installation already in progress, waiting for it to complete...`, 'RuntimeManager');
        return existingLock;
    }

    // Create installation promise and store it
    const installPromise = this.doInstallRuntime(tool, version);
    this.installLocks.set(lockKey, installPromise);

    try {
        await installPromise;
    } finally {
        // Clean up lock after completion (success or failure)
        this.installLocks.delete(lockKey);
    }
  }

  private async doInstallRuntime(tool: InternalToolType, version: string): Promise<void> {
    const startTime = Date.now();
    logger.info(`[FRE] Starting installation of ${tool} v${version}...`, 'RuntimeManager', {
      tool,
      version,
      isPackaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      binPath: this.binPath
    });

    // Ensure bin directory exists
    if (!fs.existsSync(this.binPath)) {
      fs.mkdirSync(this.binPath, { recursive: true });
    }

    // Run installation directly in main process (not as subprocess)
    // This is critical because in packaged Electron apps, process.execPath
    // points to the Electron app itself, not Node.js runtime
    if (tool === 'bun') {
      await this.installBunDirectly(version);
    } else if (tool === 'uv') {
      await this.installUvDirectly(version);
    } else {
      throw new Error(`Unknown tool: ${tool}`);
    }

    const duration = Date.now() - startTime;
    logger.info(`[FRE] Successfully installed ${tool} v${version} in ${duration}ms`, 'RuntimeManager', { tool, version, duration });

    // Refresh shims after installation to ensure new tools have their corresponding shims
    logger.debug(`[FRE] Ensuring shims after ${tool} installation...`, 'RuntimeManager');
    this.ensureShims();
  }

  // --- Python Management ---

  /**
   * Get the UV Python installation directory path (cross-platform).
   *
   * UV stores managed Python installations in:
   * - Linux/macOS: ~/.local/share/uv/python/
   * - Windows: %APPDATA%\uv\python\ (Roaming, not Local!)
   */
  private getUvPythonDir(): string {
    if (process.platform === 'win32') {
      // UV uses Roaming AppData on Windows, not Local AppData
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'uv', 'python');
    } else {
      // Linux / macOS
      return path.join(os.homedir(), '.local', 'share', 'uv', 'python');
    }
  }

  /**
   * Fast Python version discovery by directly scanning UV's Python directory.
   *
   * This is MUCH faster than `uv python list` because:
   * - No subprocess spawn overhead (~200-500ms saved)
   * - No UV startup time
   * - Pure directory scan with minimal I/O
   * - Typically completes in 1-50ms
   *
   * UV Python directory structure:
   * python/
   * ├── cpython-3.8.18-linux-x86_64
   * ├── cpython-3.9.19-macos-aarch64
   * ├── cpython-3.10.14-windows-x86_64-none
   * └── pypy-3.10.13-linux-x86_64
   *
   * The directory name itself contains: implementation-version-platform-arch
   *
   * @returns Array of installed Python versions with version, path, and status
   */
  public listPythonVersionsFast(): { version: string; path: string; status: 'installed'; impl: string; semver: string }[] {
    const startTime = Date.now();
    const uvPythonDir = this.getUvPythonDir();

    logger.debug(`[FRE][python] Fast scanning UV Python directory: ${uvPythonDir}`, 'RuntimeManager');

    if (!fs.existsSync(uvPythonDir)) {
      logger.debug(`[FRE][python] UV Python directory does not exist`, 'RuntimeManager');
      return [];
    }

    // Regex to parse directory names like "cpython-3.10.14-macos-aarch64" or "cpython-3.12.8-windows-x86_64-none"
    const versionPattern = /^(cpython|pypy)-(\d+\.\d+\.\d+)/;

    try {
      // Use fs.readdirSync for maximum speed - avoid async overhead for small directory listing
      const entries = fs.readdirSync(uvPythonDir, { withFileTypes: true });
      const results: { version: string; path: string; status: 'installed'; impl: string; semver: string }[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const match = versionPattern.exec(entry.name);
        if (match) {
          const impl = match[1];  // cpython or pypy
          const semver = match[2]; // 3.10.14
          const fullPath = path.join(uvPythonDir, entry.name);

          // Verify the Python executable exists
          const exeName = process.platform === 'win32' ? 'python.exe' : 'python';
          const exePath = process.platform === 'win32'
            ? path.join(fullPath, exeName)
            : path.join(fullPath, 'bin', exeName);

          // Only include if executable exists (quick stat check)
          if (fs.existsSync(exePath)) {
            results.push({
              version: entry.name,  // Full directory name for compatibility
              path: exePath,
              status: 'installed',
              impl,
              semver
            });
          }
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`[FRE][python] Fast scan completed in ${duration}ms, found ${results.length} Python versions`, 'RuntimeManager');

      return results;
    } catch (e) {
      logger.error('[FRE][python] Error during fast Python scan', 'RuntimeManager', {
        error: e instanceof Error ? e.message : String(e)
      });
      return [];
    }
  }

  /**
   * List installed Python versions.
   *
   * Uses fast directory scanning only (< 100ms, typically 1-50ms).
   * Directly scans UV's Python installation directory without spawning any subprocess.
   */
  public async listPythonVersions(): Promise<any[]> {
    // Use fast directory scan only - no subprocess, no uv python list
    return this.listPythonVersionsFast();
  }

  // NOTE: parsePythonListOutput is kept for potential future use but not called
  private parsePythonListOutput(output: string): any[] {
     // Simple parser for standard uv python list output
     // e.g.
     // cpython-3.12.8-windows-x86_64-none     F:\AppData\uv\python\cpython-3.12.8-windows-x86_64-none\python.exe
     // cpython-3.13.1-windows-x86_64-none     <download available>

     const lines = output.split(/[\r\n]+/);
     const results: any[] = [];
     for(const line of lines) {
         if(!line.trim()) continue;
         const parts = line.split(/\s+/);
         if(parts.length >= 2) {
             const version = parts[0];
             const pathOrStatus = parts.slice(1).join(' ');
             const isInstalled = path.isAbsolute(pathOrStatus); // Heuristic
             results.push({
                 version,
                 path: isInstalled ? pathOrStatus : null,
                 status: isInstalled ? 'installed' : 'available'
             });
         }
     }
     return results;
  }

  public async installPythonVersion(version: string): Promise<void> {
      const lockKey = `python-${version}`;

      // Check if installation is already in progress
      const existingLock = this.installLocks.get(lockKey);
      if (existingLock) {
          logger.info(`[FRE] Python ${version} installation already in progress, waiting for it to complete...`, 'RuntimeManager');
          return existingLock;
      }

      // Start global mirror before installation
      const mirror = LocalPythonMirror.getInstance();
      try {
           await mirror.start();
      } catch (e) {
           logger.warn(`[FRE] Failed to start local python mirror, proceeding without it`, 'RuntimeManager', { error: e });
      }

      // Create installation promise and store it
      const installPromise = this.doInstallPythonVersion(version);
      this.installLocks.set(lockKey, installPromise);

      try {
          await installPromise;
      } finally {
          // Clean up lock after completion (success or failure)
          this.installLocks.delete(lockKey);

          // Stop mirror
          mirror.stop();
      }
  }

  private async doInstallPythonVersion(version: string): Promise<void> {
      const startTime = Date.now();
      logger.info(`[FRE][python][${new Date().toISOString()}] Starting Python ${version} installation via uv...`, 'RuntimeManager', {
        version,
        uvInstalled: this.isInstalled('uv'),
        binPath: this.binPath
      });

      if (!this.isInstalled('uv')) {
          logger.error(`[FRE][python][${new Date().toISOString()}] Cannot install Python: uv is not installed`, 'RuntimeManager');
          throw new Error('uv is not installed');
      }

      const uvPath = this.getBinaryPath('uv');
      const uvExists = fs.existsSync(uvPath);

      // Check file stats for better diagnostics
      let fileStats: fs.Stats | null = null;
      if (uvExists) {
          try {
              fileStats = fs.statSync(uvPath);
          } catch (e) {
              logger.warn(`[FRE][python][${new Date().toISOString()}] Could not stat uv binary`, 'RuntimeManager', { error: (e as Error).message });
          }
      }

      logger.debug(`[FRE][python][${new Date().toISOString()}] uv binary path resolved`, 'RuntimeManager', {
        uvPath,
        exists: uvExists,
        mode: fileStats?.mode?.toString(8),
        size: fileStats?.size,
        isFile: fileStats?.isFile()
      });

      if (!uvExists) {
          logger.error(`[FRE][python][${new Date().toISOString()}] uv binary not found at expected path`, 'RuntimeManager', { uvPath });
          throw new Error(`uv binary not found at ${uvPath}`);
      }

      // Ensure executable permissions on macOS/Linux
      if (process.platform !== 'win32') {
          try {
              fs.chmodSync(uvPath, 0o755);
              logger.debug(`[FRE][python][${new Date().toISOString()}] Ensured executable permissions on uv binary`, 'RuntimeManager');
          } catch (e) {
              logger.warn(`[FRE][python][${new Date().toISOString()}] Could not set executable permissions on uv binary`, 'RuntimeManager', {
                  error: (e as Error).message
              });
          }
      }

      const env = this.getEnvWithInternalPath();
      logger.debug(`[FRE][python][${new Date().toISOString()}] Environment prepared for uv python install`, 'RuntimeManager', {
        PATH: env['PATH']?.substring(0, 200) + '...', // Truncate for log readability
        UV_PYTHON: env['UV_PYTHON']
      });

      const args = ['python', 'install', version];
      logger.info(`[FRE][python][${new Date().toISOString()}] Spawning: ${uvPath} ${args.join(' ')}`, 'RuntimeManager');

      return new Promise((resolve, reject) => {
          let stdoutData = '';
          let stderrData = '';
          let hasExited = false;

          const child = spawn(uvPath, args, {
              env,
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe']
          });

          logger.debug(`[FRE][python][${new Date().toISOString()}] Python install process spawned`, 'RuntimeManager', { pid: child.pid });

          child.stdout.on('data', d => {
              const msg = d.toString();
              stdoutData += msg;
              logger.debug(`[FRE][python][${new Date().toISOString()}][uv python install stdout] ${msg.trim()}`, 'RuntimeManager');
          });

          child.stderr.on('data', d => {
              const msg = d.toString();
              stderrData += msg;
              // uv usually prints progress to stderr
              logger.info(`[FRE][python][${new Date().toISOString()}][uv python install stderr] ${msg.trim()}`, 'RuntimeManager');
          });

          child.on('error', (err) => {
              if (hasExited) return;
              hasExited = true;
              const duration = Date.now() - startTime;
              logger.error(`[FRE][python][${new Date().toISOString()}] Failed to spawn uv python install process`, 'RuntimeManager', {
                  error: err.message,
                  errorCode: (err as NodeJS.ErrnoException).code,
                  duration,
                  version
              });
              reject(err);
          });

          child.on('close', (code, signal) => {
              if (hasExited) return;
              hasExited = true;
              const duration = Date.now() - startTime;
              logger.info(`[FRE][python][${new Date().toISOString()}] uv python install process exited`, 'RuntimeManager', {
                  code,
                  signal,
                  duration,
                  version,
                  stdoutLength: stdoutData.length,
                  stderrLength: stderrData.length,
                  stdout: stdoutData.substring(0, 500),
                  stderr: stderrData.substring(0, 500)
              });

              if (code === 0) {
                  logger.info(`[FRE][python][${new Date().toISOString()}] Python ${version} installed successfully in ${duration}ms`, 'RuntimeManager');
                  resolve();
              } else if (signal) {
                  // Process was terminated by a signal (e.g., SIGTERM, SIGKILL)
                  logger.error(`[FRE][python][${new Date().toISOString()}] uv python install was terminated by signal`, 'RuntimeManager', {
                      signal,
                      stdout: stdoutData.substring(0, 1000),
                      stderr: stderrData.substring(0, 1000)
                  });
                  reject(new Error(`uv python install was terminated by signal ${signal}. stderr: ${stderrData.substring(0, 500)}`));
              } else if (code === null) {
                  // code is null but no signal - this is unusual, might be a spawn issue
                  logger.error(`[FRE][python][${new Date().toISOString()}] uv python install exited with null code`, 'RuntimeManager', {
                      stdout: stdoutData.substring(0, 1000),
                      stderr: stderrData.substring(0, 1000)
                  });
                  reject(new Error(`uv python install exited unexpectedly. stderr: ${stderrData.substring(0, 500)}`));
              } else {
                  logger.error(`[FRE][python][${new Date().toISOString()}] uv python install failed`, 'RuntimeManager', {
                      code,
                      stdout: stdoutData.substring(0, 1000),
                      stderr: stderrData.substring(0, 1000)
                  });
                  reject(new Error(`uv python install failed with code ${code}. stderr: ${stderrData.substring(0, 500)}`));
              }
          });
      });
  }

  public async uninstallPythonVersion(version: string): Promise<void> {
    if (!this.isInstalled('uv')) {
        throw new Error('uv is not installed');
    }

    // If we're uninstalling the pinned version, unpin it first.
    // pinnedPythonVersion may be stored as a short semver ("3.10.12") while
    // version is the full uv directory name ("cpython-3.10.12-macos-aarch64-none"),
    // so match both forms.
    const pinned = this.getRunTimeConfig().pinnedPythonVersion;
    const semverMatch = version.match(/^(?:cpython|pypy)-(\d+\.\d+\.\d+)/);
    const versionSemver = semverMatch ? semverMatch[1] : null;
    if (pinned && (pinned === version || (versionSemver && pinned === versionSemver))) {
        await this.setPinnedPythonVersion(null);
    }

    const uvPath = this.getBinaryPath('uv');
    logger.info(`Uninstalling python version ${version} via uv...`);

    return new Promise((resolve, reject) => {
        const child = spawn(uvPath, ['python', 'uninstall', version], {
            env: this.getEnvWithInternalPath(),
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.on('data', d => logger.debug(`[uv python uninstall] ${d}`));
        child.stderr.on('data', d => logger.info(`[uv python uninstall] ${d}`));

        child.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`uv python uninstall failed with code ${code}`));
            }
        });
    });
}

  public async cleanUvCache(): Promise<void> {
      logger.info('[FRE] cleanUvCache called', 'RuntimeManager', { uvInstalled: this.isInstalled('uv') });

      if (!this.isInstalled('uv')) {
          logger.debug('[FRE] uv not installed, skipping cache clean', 'RuntimeManager');
          return;
      }

      const uvPath = this.getBinaryPath('uv');
      const startTime = Date.now();
      logger.info('[FRE] Cleaning uv cache to prevent environment conflicts...', 'RuntimeManager', { uvPath });

      return new Promise((resolve, reject) => {
          let stdoutData = '';
          let stderrData = '';

          const child = spawn(uvPath, ['cache', 'clean'], {
              env: this.getEnvWithInternalPath(),
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe']
          });

          logger.debug('[FRE] uv cache clean process spawned', 'RuntimeManager', { pid: child.pid });

          child.stdout.on('data', d => {
              const msg = d.toString();
              stdoutData += msg;
              logger.debug(`[FRE][uv cache clean stdout] ${msg.trim()}`, 'RuntimeManager');
          });

          child.stderr.on('data', d => {
              const msg = d.toString();
              stderrData += msg;
              logger.warn(`[FRE][uv cache clean stderr] ${msg.trim()}`, 'RuntimeManager');
          });

          child.on('close', code => {
              const duration = Date.now() - startTime;
              logger.info('[FRE] uv cache clean process exited', 'RuntimeManager', { code, duration });

              // We don't strictly fail if cache clean issues warning, but let's log it
              if (code === 0) {
                  logger.info(`[FRE] uv cache cleaned successfully in ${duration}ms`, 'RuntimeManager');
                  resolve();
              } else {
                  logger.warn(`[FRE] uv cache clean exited with code ${code}`, 'RuntimeManager', {
                      stdout: stdoutData.substring(0, 500),
                      stderr: stderrData.substring(0, 500)
                  });
                  resolve(); // Resolve anyway to not block user
              }
          });

          child.on('error', err => {
              const duration = Date.now() - startTime;
              logger.error('[FRE] Failed to run uv cache clean', 'RuntimeManager', { err, duration });
              resolve(); // Resolve anyway
          });
      });
  }

  // --- Direct Installation Methods (No subprocess) ---
  // These methods run directly in the main process to avoid the issue where
  // spawn(process.execPath, ...) launches the Electron app instead of Node.js

  /**
   * Downloads a file from URL with redirect handling
   */
  private downloadWithRedirects(url: string, destinationPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = (downloadUrl: string) => {
        logger.debug(`[FRE] Downloading from: ${downloadUrl}`, 'RuntimeManager');

        https.get(downloadUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              request(redirectUrl);
            } else {
              reject(new Error('Redirect without location header'));
            }
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
            return;
          }

          const file = fs.createWriteStream(destinationPath);
          response.pipe(file);

          file.on('finish', () => {
            file.close(() => resolve());
          });

          file.on('error', (err) => {
            fs.unlink(destinationPath, () => reject(err));
          });
        }).on('error', (err) => {
          fs.unlink(destinationPath, () => reject(err));
        });
      };

      request(url);
    });
  }

  /**
   * Installs Bun directly in the main process
   */
  private async installBunDirectly(version: string): Promise<void> {
    const BUN_RELEASE_BASE_URL = 'https://github.com/oven-sh/bun/releases/download';
    const BUN_PACKAGES: Record<string, string> = {
      'darwin-arm64': 'bun-darwin-aarch64.zip',
      'darwin-x64': 'bun-darwin-x64.zip',
      'win32-x64': 'bun-windows-x64.zip',
      'win32-arm64': 'bun-windows-x64.zip',
      'linux-x64': 'bun-linux-x64.zip',
      'linux-arm64': 'bun-linux-aarch64.zip',
    };

    const platform = os.platform();
    const arch = os.arch();
    const platformKey = `${platform}-${arch}`;

    logger.info(`[FRE] Installing Bun ${version} for ${platformKey}`, 'RuntimeManager');

    const packageName = BUN_PACKAGES[platformKey];
    if (!packageName) {
      throw new Error(`Unsupported platform/architecture: ${platformKey}`);
    }

    const downloadUrl = `${BUN_RELEASE_BASE_URL}/bun-v${version}/${packageName}`;
    const tempDir = os.tmpdir();
    const tempFilename = path.join(tempDir, packageName);

    try {
      logger.info(`[FRE] Downloading Bun from ${downloadUrl}`, 'RuntimeManager');
      await this.downloadWithRedirects(downloadUrl, tempFilename);

      logger.info(`[FRE] Extracting ${packageName}`, 'RuntimeManager');
      const zip = new StreamZip.async({ file: tempFilename });
      const entries = await zip.entries();

      for (const entry of Object.values(entries) as any[]) {
        if (!entry.isDirectory) {
          const filename = path.basename(entry.name);

          // Only extract the bun binary
          if (filename === 'bun' || filename === 'bun.exe') {
            const outputPath = path.join(this.binPath, filename);
            logger.debug(`[FRE] Extracting ${entry.name} -> ${outputPath}`, 'RuntimeManager');
            await zip.extract(entry.name, outputPath);

            if (platform !== 'win32') {
              fs.chmodSync(outputPath, 0o755);
            }
          }
        }
      }

      await zip.close();

      // Verify installation
      const binaryName = platform === 'win32' ? 'bun.exe' : 'bun';
      const finalPath = path.join(this.binPath, binaryName);

      if (fs.existsSync(finalPath)) {
        logger.info(`[FRE] Successfully installed Bun at ${finalPath}`, 'RuntimeManager');
      } else {
        throw new Error('Bun binary not found after extraction');
      }

      // Clean up temp file
      try { fs.unlinkSync(tempFilename); } catch (e) { /* ignore */ }

    } catch (error) {
      // Clean up temp file on error
      try { if (fs.existsSync(tempFilename)) fs.unlinkSync(tempFilename); } catch (e) { /* ignore */ }
      throw error;
    }
  }

  /**
   * Installs uv directly in the main process
   */
  private async installUvDirectly(version: string): Promise<void> {
    const UV_RELEASE_BASE_URL = 'https://github.com/astral-sh/uv/releases/download';
    const UV_PACKAGES: Record<string, string> = {
      'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
      'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
      'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
      'win32-ia32': 'uv-i686-pc-windows-msvc.zip',
      'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
      'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
      'linux-ia32': 'uv-i686-unknown-linux-gnu.tar.gz',
      'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
    };

    const platform = os.platform();
    const arch = os.arch();
    const platformKey = `${platform}-${arch}`;

    logger.info(`[FRE] Installing uv ${version} for ${platformKey}`, 'RuntimeManager');

    const packageName = UV_PACKAGES[platformKey];
    if (!packageName) {
      throw new Error(`Unsupported platform/architecture: ${platformKey}`);
    }

    const downloadUrl = `${UV_RELEASE_BASE_URL}/${version}/${packageName}`;
    const tempDir = os.tmpdir();
    const tempFilename = path.join(tempDir, packageName);
    const isTarGz = packageName.endsWith('.tar.gz');

    try {
      logger.info(`[FRE] Downloading uv from ${downloadUrl}`, 'RuntimeManager');
      await this.downloadWithRedirects(downloadUrl, tempFilename);

      logger.info(`[FRE] Extracting ${packageName}`, 'RuntimeManager');

      if (isTarGz) {
        // Use system tar for tar.gz
        const tempExtractDir = path.join(tempDir, `uv-extract-${Date.now()}`);
        fs.mkdirSync(tempExtractDir, { recursive: true });

        try {
          execSync(`tar -xzf "${tempFilename}" -C "${tempExtractDir}"`, { stdio: 'pipe' });

          // Find binary in extracted structure and move to binPath
          const findAndMoveFiles = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                findAndMoveFiles(fullPath);
              } else {
                const filename = entry.name;
                if (filename === 'uv' || filename === 'uvx') {
                  const outputPath = path.join(this.binPath, filename);
                  fs.copyFileSync(fullPath, outputPath);
                  fs.chmodSync(outputPath, 0o755);
                  logger.info(`[FRE] Installed ${filename}`, 'RuntimeManager');
                }
              }
            }
          };
          findAndMoveFiles(tempExtractDir);
        } finally {
          try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }
      } else {
        // Use StreamZip for zip (Windows)
        const zip = new StreamZip.async({ file: tempFilename });
        const entries = await zip.entries();

        for (const entry of Object.values(entries) as any[]) {
          if (!entry.isDirectory) {
            const filename = path.basename(entry.name);
            if (filename === 'uv.exe' || filename === 'uvx.exe') {
              const outputPath = path.join(this.binPath, filename);
              await zip.extract(entry.name, outputPath);
              logger.info(`[FRE] Installed ${filename}`, 'RuntimeManager');
            }
          }
        }
        await zip.close();
      }

      // Verify installation
      const uvBinaryName = platform === 'win32' ? 'uv.exe' : 'uv';
      const finalPath = path.join(this.binPath, uvBinaryName);

      if (fs.existsSync(finalPath)) {
        logger.info(`[FRE] Successfully installed uv at ${finalPath}`, 'RuntimeManager');
      } else {
        throw new Error('uv binary not found after extraction');
      }

      // Clean up temp file
      try { fs.unlinkSync(tempFilename); } catch (e) { /* ignore */ }

    } catch (error) {
      // Clean up temp file on error
      try { if (fs.existsSync(tempFilename)) fs.unlinkSync(tempFilename); } catch (e) { /* ignore */ }
      throw error;
    }
  }

  // --- IPC --
  private registerIpcHandlers() {
      logger.debug('[FRE] Registering runtime IPC handlers', 'RuntimeManager');

      ipcMain.handle('runtime:set-mode', async (_, mode: RuntimeMode) => {
          logger.info(`[FRE] IPC: runtime:set-mode called`, 'RuntimeManager', { mode });
          await this.setRuntimeMode(mode);
          return this.getRunTimeConfig();
      });

      ipcMain.handle('runtime:install-component', async (_, tool: InternalToolType, version: string) => {
          logger.info(`[FRE] IPC: runtime:install-component called`, 'RuntimeManager', { tool, version });
          const startTime = Date.now();
          try {
              await this.installRuntime(tool, version);

              if(tool === 'bun') {
                  await this.setVersion('bun', version);
              } else {
                  await this.setVersion('uv', version);
              }

              const duration = Date.now() - startTime;
              logger.info(`[FRE] IPC: runtime:install-component completed`, 'RuntimeManager', { tool, version, duration });
              return { success: true };
          } catch (error) {
              const duration = Date.now() - startTime;
              logger.error(`[FRE] IPC: runtime:install-component failed`, 'RuntimeManager', {
                  tool,
                  version,
                  duration,
                  error: error instanceof Error ? error.message : String(error)
              });
              throw error;
          }
      });

      ipcMain.handle('runtime:check-status', async () => {
          logger.debug('[FRE] IPC: runtime:check-status called', 'RuntimeManager');
          const status = {
              bun: this.isInstalled('bun'),
              uv: this.isInstalled('uv'),
              bunPath: this.getBinaryPath('bun'),
              uvPath: this.getBinaryPath('uv'),
          };
          logger.debug('[FRE] IPC: runtime:check-status result', 'RuntimeManager', status);
          return status;
      });

      ipcMain.handle('runtime:list-python-versions', async () => {
        logger.debug('[FRE] IPC: runtime:list-python-versions called', 'RuntimeManager');
        const versions = await this.listPythonVersions();
        logger.debug(`[FRE] IPC: runtime:list-python-versions returned ${versions.length} versions`, 'RuntimeManager');
        return versions;
      });

      // Fast synchronous Python version scan - typically < 50ms
      // Use this for FRE and any performance-critical paths
      ipcMain.handle('runtime:list-python-versions-fast', () => {
        logger.debug('[FRE] IPC: runtime:list-python-versions-fast called', 'RuntimeManager');
        const startTime = Date.now();
        const versions = this.listPythonVersionsFast();
        const duration = Date.now() - startTime;
        logger.debug(`[FRE] IPC: runtime:list-python-versions-fast returned ${versions.length} versions in ${duration}ms`, 'RuntimeManager');
        return versions;
      });

      ipcMain.handle('runtime:install-python-version', async (_, version) => {
         logger.info(`[FRE] IPC: runtime:install-python-version called`, 'RuntimeManager', { version });
         const startTime = Date.now();
         try {
             await this.installPythonVersion(version);
             const duration = Date.now() - startTime;
             logger.info(`[FRE] IPC: runtime:install-python-version completed`, 'RuntimeManager', { version, duration });
         } catch (error) {
             const duration = Date.now() - startTime;
             logger.error(`[FRE] IPC: runtime:install-python-version failed`, 'RuntimeManager', {
                 version,
                 duration,
                 error: error instanceof Error ? error.message : String(error)
             });
             throw error;
         }
      });

      ipcMain.handle('runtime:uninstall-python-version', async (_, version) => {
        logger.info(`[FRE] IPC: runtime:uninstall-python-version called`, 'RuntimeManager', { version });
        return this.uninstallPythonVersion(version);
      });

      ipcMain.handle('runtime:set-pinned-python-version', async (_, version) => {
          logger.info(`[FRE] IPC: runtime:set-pinned-python-version called`, 'RuntimeManager', { version });
          return this.setPinnedPythonVersion(version);
      });

      ipcMain.handle('runtime:clean-uv-cache', async () => {
        logger.debug('[FRE] IPC: runtime:clean-uv-cache called', 'RuntimeManager');
        return this.cleanUvCache();
      });

      ipcMain.handle('runtime:check-git-version', async () => {
        const result = await this.checkGitVersion();
        logger.debug('[FRE] IPC: runtime:check-git-version result', 'RuntimeManager', result);
        return result;
      });

      logger.info('[FRE] Runtime IPC handlers registered', 'RuntimeManager');
  }
}
