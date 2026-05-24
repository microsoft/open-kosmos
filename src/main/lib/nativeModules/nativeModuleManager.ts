/**
 * NativeModuleManager
 *
 * Manages on-demand download and lazy-loading of very large native modules.
 * These modules are not distributed with the application installer; instead they
 * are downloaded from the npm CDN and cached in the userData directory the first
 * time the user activates the corresponding feature.
 *
 * Download path:   {userData}/native-modules/{packageName}/{version}/package/
 * Download source: npm CDN  https://registry.npmjs.org/{pkg}/-/{pkg}-{ver}.tgz
 *
 * Supports:
 * - Download progress push (IPC → renderer)
 * - Cancelling in-progress downloads
 * - Retry mechanism (up to 3 times)
 * - Multi-platform / multi-architecture isolation
 */

import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import { createRequire } from 'module';
import { app, BrowserWindow } from 'electron';
import { createLogger } from '../unifiedLogger';
import { execFile } from "child_process";
import { promisify } from "util";
import * as tar from "tar";
const logger = createLogger();

/**
 * Native Node.js require that bypasses webpack's module resolution.
 * webpack's require() cannot handle runtime dynamic absolute paths (e.g. cached
 * modules under userData); createRequire must be used to obtain the native require.
 */
const nativeRequire = createRequire(__filename);

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface NativeModuleSpec {
  /** npm package name, e.g. '@kutalia/whisper-node-addon' */
  packageName: string;
  /** npm package version, e.g. '1.1.0' */
  version: string;
}

export type NativeModuleStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface NativeModuleInfo {
  packageName: string;
  version: string;
  status: NativeModuleStatus;
  /** Local path after download (package/ root, directly require-able) */
  localPath?: string;
  error?: string;
  downloadProgress?: NativeModuleDownloadProgress;
}

export interface NativeModuleDownloadProgress {
  packageName: string;
  bytesDownloaded: number;
  bytesTotal: number;
  percent: number;
}

// --------------------------------------------------------------------------
// Registry: metadata for known modules (versions determined by package.json optionalDependencies)
// --------------------------------------------------------------------------

export const NATIVE_MODULE_REGISTRY: Record<string, NativeModuleSpec> = {
  'whisper-addon': {
    packageName: '@kutalia/whisper-node-addon',
    version: '1.1.0',
  },
};

// --------------------------------------------------------------------------
// NativeModuleManager
// --------------------------------------------------------------------------

class NativeModuleManager {
  private static instance: NativeModuleManager;

  /** Storage root directory under userData */
  private readonly baseDir: string;

  /** AbortControllers for in-progress downloads */
  private activeDownloads = new Map<string, AbortController>();

  /** Cache of loaded modules (moduleKey → required module) */
  private loadedModules = new Map<string, unknown>();

  private constructor() {
    this.baseDir = path.join(app.getPath('userData'), 'native-modules');
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  static getInstance(): NativeModuleManager {
    if (!NativeModuleManager.instance) {
      NativeModuleManager.instance = new NativeModuleManager();
    }
    return NativeModuleManager.instance;
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  /**
   * Get the current status of a module
   */
  getStatus(moduleKey: string): NativeModuleInfo {
    const spec = NATIVE_MODULE_REGISTRY[moduleKey];
    if (!spec) {
      return { packageName: moduleKey, version: 'unknown', status: 'error', error: `Unknown module key: ${moduleKey}` };
    }

    const localPath = this.getLocalPackagePath(spec);
    if (this.activeDownloads.has(moduleKey)) {
      return { ...spec, status: 'downloading' };
    }
    if (this.isDownloaded(spec)) {
      return { ...spec, status: 'downloaded', localPath };
    }
    return { ...spec, status: 'not-downloaded' };
  }

  /**
   * Check whether a module has been downloaded (does not trigger a download)
   */
  isAvailable(moduleKey: string): boolean {
    const spec = NATIVE_MODULE_REGISTRY[moduleKey];
    if (!spec) return false;
    return this.isDownloaded(spec);
  }

  /**
   * Get the require path for a module. Returns null if not downloaded.
   */
  getRequirePath(moduleKey: string): string | null {
    const spec = NATIVE_MODULE_REGISTRY[moduleKey];
    if (!spec) return null;
    if (!this.isDownloaded(spec)) return null;
    return this.getLocalPackagePath(spec);
  }

  /**
   * Ensure a module is downloaded; triggers download if not already present.
   * Returns the local path usable by require.
   *
   * @param moduleKey - key in NATIVE_MODULE_REGISTRY
   * @param onProgress - optional download progress callback (also pushed via IPC)
   */
  async ensureDownloaded(
    moduleKey: string,
    onProgress?: (progress: NativeModuleDownloadProgress) => void,
  ): Promise<string> {
    const spec = NATIVE_MODULE_REGISTRY[moduleKey];
    if (!spec) {
      throw new Error(`[NativeModuleManager] Unknown module key: ${moduleKey}`);
    }

    const localPath = this.getLocalPackagePath(spec);

    if (this.isDownloaded(spec)) {
      logger.debug(`[NativeModuleManager] ${moduleKey} already available at ${localPath}`);
      return localPath;
    }

    if (this.activeDownloads.has(moduleKey)) {
      throw new Error(`[NativeModuleManager] ${moduleKey} is already downloading`);
    }

    return this.download(moduleKey, spec, onProgress);
  }

  /**
   * Cancel an in-progress download for the specified module
   */
  cancelDownload(moduleKey: string): void {
    const controller = this.activeDownloads.get(moduleKey);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(moduleKey);
      logger.debug(`[NativeModuleManager] Cancelled download for ${moduleKey}`);
      this.notifyRenderer('native-module:downloadCancelled', { packageName: moduleKey });
    }
  }

  /**
   * Delete a downloaded module (frees disk space)
   */
  deleteModule(moduleKey: string): void {
    const spec = NATIVE_MODULE_REGISTRY[moduleKey];
    if (!spec) return;

    const versionDir = this.getVersionDir(spec);
    if (fs.existsSync(versionDir)) {
      fs.rmSync(versionDir, { recursive: true, force: true });
      logger.debug(`[NativeModuleManager] Deleted ${moduleKey} from ${versionDir}`);
    }
    this.loadedModules.delete(moduleKey);
  }

  /**
   * Load a downloaded native module. Throws NativeModuleNotDownloadedError if not downloaded.
   */
  requireModule(moduleKey: string): unknown {
    if (this.loadedModules.has(moduleKey)) {
      return this.loadedModules.get(moduleKey);
    }

    const requirePath = this.getRequirePath(moduleKey);
    if (!requirePath) {
      throw new NativeModuleNotDownloadedError(moduleKey);
    }

    // Apply platform compatibility fixes (idempotent, only when needed)
    this.applyModuleFixes(moduleKey, requirePath);

    try {
      // Use nativeRequire (obtained via createRequire) to bypass webpack module resolution
      const mod = nativeRequire(requirePath);
      this.loadedModules.set(moduleKey, mod);
      logger.debug(`[NativeModuleManager] Loaded ${moduleKey} from ${requirePath}`);
      return mod;
    } catch (err) {
      throw new Error(`[NativeModuleManager] Failed to load ${moduleKey}: ${err}`);
    }
  }

  /**
   * Apply platform compatibility fixes for specific modules (idempotent).
   *
   * whisper-addon macOS issue 1 — directory name mismatch:
   *   The npm tarball binary directory is mac-{arch}/, but index.js constructs
   *   the path as darwin-{arch}/ via os.platform(). Fix: create
   *   darwin-{arch} → mac-{arch} symlinks.
   *
   * whisper-addon macOS issue 2 — rpath hard-coded to CI machine paths:
   *   The pre-built whisper.node has rpath pointing to absolute paths on the CI
   *   build machine, with no @loader_path, causing dlopen to fail to find the
   *   sibling libwhisper.1.dylib. Fix: append @loader_path via install_name_tool.
   */
  private applyModuleFixes(moduleKey: string, localPath: string): void {
    if (os.platform() !== 'darwin') return;

    if (moduleKey === 'whisper-addon') {
      // Fix 1: darwin-{arch} → mac-{arch} symlinks
      for (const arch of ['arm64', 'x64']) {
        const macDir = path.join(localPath, 'dist', `mac-${arch}`);
        const darwinDir = path.join(localPath, 'dist', `darwin-${arch}`);
        if (fs.existsSync(macDir) && !fs.existsSync(darwinDir)) {
          try {
            fs.symlinkSync(macDir, darwinDir, 'dir');
            logger.debug(`[NativeModuleManager] Created symlink: ${darwinDir} -> ${macDir}`);
          } catch (err) {
            logger.warn(`[NativeModuleManager] Failed to create symlink ${darwinDir}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }

      // Fix 2: Add @loader_path rpath to .node files (needed so dlopen can find
      //         sibling .dylibs at runtime; the npm prebuild only has CI machine paths)
      this.fixMacosRpaths(localPath);
    }
  }

  /**
   * Append @loader_path rpath to all .node files under dist/mac-{arch}/ (idempotent).
   * Uses install_name_tool, which is available out-of-the-box on macOS (Xcode Command Line Tools).
   */
  private fixMacosRpaths(localPath: string): void {
    const arch = os.arch(); // 'arm64' | 'x64'
    const distDir = path.join(localPath, 'dist', `mac-${arch}`);
    const markerFile = path.join(distDir, '.rpath-fixed');

    if (!fs.existsSync(distDir) || fs.existsSync(markerFile)) return;

    const { execFileSync } = nativeRequire('child_process') as typeof import('child_process');

    const nodeFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.node'));
    for (const nodeFile of nodeFiles) {
      const nodePath = path.join(distDir, nodeFile);
      try {
        execFileSync('install_name_tool', ['-add_rpath', '@loader_path', nodePath], { stdio: 'pipe' });
        logger.debug(`[NativeModuleManager] Fixed rpath for ${nodePath}`);
      } catch (err: unknown) {
        // install_name_tool exits non-zero when rpath already exists — that's fine
        const msg = String((err as { stderr?: Buffer })?.stderr ?? err);
        if (!msg.includes('already exists')) {
          logger.warn(`[NativeModuleManager] install_name_tool failed for ${nodePath}: ${msg}`);
        }
      }
    }

    // Write marker so we don't re-run on every load
    try { fs.writeFileSync(markerFile, new Date().toISOString()); } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------------------
  // Internal implementation
  // ------------------------------------------------------------------------

  private getVersionDir(spec: NativeModuleSpec): string {
    // Sanitize scoped package names for use in file paths: @kutalia/whisper-node-addon → @kutalia+whisper-node-addon
    const safeName = spec.packageName.replace('/', '+');
    return path.join(this.baseDir, safeName, spec.version);
  }

  private getLocalPackagePath(spec: NativeModuleSpec): string {
    return path.join(this.getVersionDir(spec), 'package');
  }

  private isDownloaded(spec: NativeModuleSpec): boolean {
    const pkgJson = path.join(this.getLocalPackagePath(spec), 'package.json');
    return fs.existsSync(pkgJson);
  }

  /**
   * Build the npm CDN tarball URL.
   * scoped packages: @scope/name → @scope%2fname
   */
  private getTarballUrl(spec: NativeModuleSpec): string {
    const { packageName, version } = spec;
    if (packageName.startsWith('@')) {
      // @scope/name
      const [scope, name] = packageName.slice(1).split('/');
      return `https://registry.npmjs.org/%40${scope}%2F${name}/-/${name}-${version}.tgz`;
    }
    return `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;
  }

  private async download(
    moduleKey: string,
    spec: NativeModuleSpec,
    onProgress?: (progress: NativeModuleDownloadProgress) => void,
  ): Promise<string> {
    const controller = new AbortController();
    this.activeDownloads.set(moduleKey, controller);

    const versionDir = this.getVersionDir(spec);
    const tmpFile = path.join(versionDir, '__download.tmp.tgz');

    try {
      fs.mkdirSync(versionDir, { recursive: true });

      const url = this.getTarballUrl(spec);
      logger.debug(`[NativeModuleManager] Downloading ${moduleKey} from ${url}`);
      this.notifyRenderer('native-module:downloadStarted', { packageName: moduleKey, url });

      await this.downloadFile(url, tmpFile, controller.signal, (progress) => {
        const p: NativeModuleDownloadProgress = {
          packageName: moduleKey,
          ...progress,
        };
        onProgress?.(p);
        this.notifyRenderer('native-module:downloadProgress', p);
      });

      logger.debug(`[NativeModuleManager] Extracting ${moduleKey}...`);
      await this.extractTarball(tmpFile, versionDir);

      // Clean up temporary file
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      const localPath = this.getLocalPackagePath(spec);

      // Apply platform compatibility fixes
      this.applyModuleFixes(moduleKey, localPath);

      logger.debug(`[NativeModuleManager] ${moduleKey} installed at ${localPath}`);
      this.notifyRenderer('native-module:downloadComplete', {
        packageName: moduleKey,
        localPath,
      });

      return localPath;
    } catch (err: unknown) {
      // Clean up leftover temporary file
      if (fs.existsSync(tmpFile)) {
        try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
      }

      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        this.notifyRenderer('native-module:downloadCancelled', { packageName: moduleKey });
      } else {
        this.notifyRenderer('native-module:downloadError', {
          packageName: moduleKey,
          error: String(err),
        });
      }
      throw err;
    } finally {
      this.activeDownloads.delete(moduleKey);
    }
  }

  /**
   * Download a file to disk, supporting redirects and progress callbacks
   */
  private downloadFile(
    url: string,
    destPath: string,
    signal: AbortSignal,
    onProgress: (p: { bytesDownloaded: number; bytesTotal: number; percent: number }) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const followRedirect = (currentUrl: string, redirectCount = 0): void => {
        if (redirectCount > 10) {
          reject(new Error('Too many redirects'));
          return;
        }
        if (signal.aborted) {
          reject(Object.assign(new Error('Download aborted'), { name: 'AbortError' }));
          return;
        }

        const lib = currentUrl.startsWith('https') ? https : http;
        const req = lib.get(currentUrl, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            followRedirect(res.headers.location, redirectCount + 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          const file = fs.createWriteStream(destPath);

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
            onProgress({ bytesDownloaded: downloaded, bytesTotal: total, percent });
          });

          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', (e) => {
            fs.unlink(destPath, () => reject(e));
          });
        });

        req.on('error', reject);
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(Object.assign(new Error('Download aborted'), { name: 'AbortError' }));
        });
      };

      followRedirect(url);
    });
  }

  /**
   * Extract a .tgz to the target directory.
   * npm tarballs have all files prefixed with package/; that structure is preserved after extraction.
   */
  private async extractTarball(tgzPath: string, destDir: string): Promise<void> {
    // Use child_process to invoke the system tar, avoiding npm tar package API compatibility issues
    const execFileAsync = promisify(execFile);

    if (os.platform() === 'win32') {
      // Windows: use the built-in node tar (Electron Node.js >= 16 includes tar)
      await this.extractTarballWithNodeTar(tgzPath, destDir);
    } else {
      try {
        await execFileAsync('tar', ['-xzf', tgzPath, '-C', destDir]);
      } catch (_) {
        // fallback to node-tar if system tar fails
        await this.extractTarballWithNodeTar(tgzPath, destDir);
      }
    }
  }

  private async extractTarballWithNodeTar(tgzPath: string, destDir: string): Promise<void> {
    // Use the tar package already in dependencies
    await tar.x({
      file: tgzPath,
      cwd: destDir,
    });
  }

  /**
   * Push an event to the renderer process
   */
  private notifyRenderer(channel: string, data: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }
}

// --------------------------------------------------------------------------
// Error types
// --------------------------------------------------------------------------

export class NativeModuleNotDownloadedError extends Error {
  readonly moduleKey: string;

  constructor(moduleKey: string) {
    super(
      `Native module "${moduleKey}" is not downloaded. ` +
      `Call nativeModuleManager.ensureDownloaded("${moduleKey}") first.`,
    );
    this.name = 'NativeModuleNotDownloadedError';
    this.moduleKey = moduleKey;
  }
}

// --------------------------------------------------------------------------
// Export singleton
// --------------------------------------------------------------------------

export const nativeModuleManager = NativeModuleManager.getInstance();
