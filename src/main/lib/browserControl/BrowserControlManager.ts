/**
 * BrowserControlManager -- core business logic for Browser Control enable/disable/launch.
 * Extracted from main.ts to keep IPC handlers thin.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, screen } from 'electron';
import { exec } from 'child_process';
import * as os from 'os';
import { BROWSER_CONFIG, COMBINED_SCRIPTS, BrowserType } from './browserConfig';
import { browserControlHttpServer } from './browserControlHttpServer';
import type { FeatureFlagName } from '../featureFlags/types';
import sudoPrompt from 'sudo-prompt';
import { createLogger } from '../unifiedLogger';
import { checkBrowserControlStatus, checkBrowserInstalled } from "./browserControlStatus";
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
const logger = createLogger();

// -- Types --

type BrowserConfigEntry = (typeof BROWSER_CONFIG)[BrowserType];

export interface BrowserControlDeps {
  getAlias: () => string | null;
  getProfileCacheManager: () => Promise<any>;
  getMainWindow: () => BrowserWindow | null;
  getUserDataDir: () => string;
  getAppPath: () => string;
  getTempDir: () => string;
  isFeatureEnabled: (flag: FeatureFlagName) => boolean;
}

interface InstallState {
  isInstalling: boolean;
  phase: string;
  progress: number;
  error: string;
}

interface UpdateState {
  isUpdating: boolean;
  phase: string;
  progress: number;
  error: string;
  localVersion: string;
  remoteVersion: string;
}

type Result<T = void> = { success: true; data?: T } | { success: false; error: string };

// -- Manager --

export class BrowserControlManager {
  private installState: InstallState = { isInstalling: false, phase: 'idle', progress: 0, error: '' };
  private updateState: UpdateState = { isUpdating: false, phase: 'idle', progress: 0, error: '', localVersion: '', remoteVersion: '' };

  // Pending confirmation callbacks
  private pendingBrowserInstallConfirm = new Map<string, (confirmed: boolean) => void>();
  private pendingNativeServerDownloadConfirm = new Map<string, (confirmed: boolean) => void>();
  private pendingBrowserRestartConfirm = new Map<string, (confirmed: boolean) => void>();

  constructor(private deps: BrowserControlDeps) {}

  // -- Helpers --

  private sendToRenderer(channel: string, ...args: any[]) {
    this.deps.getMainWindow()?.webContents.send(channel, ...args);
  }

  private sendPhaseChange(phase: string, message?: string) {
    this.installState.phase = phase;
    if (phase === 'error') {
      this.installState.error = message || 'Unknown error';
      this.installState.isInstalling = false;
    } else if (phase === 'completed') {
      this.installState.isInstalling = false;
      this.installState.progress = 100;
    }
    this.sendToRenderer('browserControl:phaseChange', phase, message);
  }

  private sendDownloadProgress(progress: { percent: number; transferred: string; total: string }) {
    this.installState.progress = progress.percent;
    this.sendToRenderer('browserControl:downloadProgress', progress);
  }

  private sendUpdatePhaseChange(phase: string, message?: string) {
    this.updateState.phase = phase;
    if (phase === 'error') {
      this.updateState.error = message || 'Unknown error';
      this.updateState.isUpdating = false;
    } else if (phase === 'completed') {
      this.updateState.isUpdating = false;
      this.updateState.progress = 100;
    }
    this.sendToRenderer('browserControl:updatePhaseChange', phase, message);
  }

  private sendUpdateDownloadProgress(progress: { percent: number; transferred: string; total: string }) {
    this.updateState.progress = progress.percent;
    this.sendToRenderer('browserControl:updateDownloadProgress', progress);
  }

  private async waitForUserConfirm(
    pendingMap: Map<string, (confirmed: boolean) => void>,
    requestId: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      pendingMap.set(requestId, (confirmed) => {
        pendingMap.delete(requestId);
        resolve(confirmed);
      });
    });
  }

  // -- Settings --

  async getSettings(): Promise<Result<{ browser: BrowserType }>> {
    try {
      const alias = this.deps.getAlias();
      if (!alias) return { success: false, error: 'No current user alias set' };
      const pcManager = await this.deps.getProfileCacheManager();
      const settings = pcManager.getBrowserControlSettings(alias);
      return { success: true, data: settings };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateSettings(settings: { browser?: BrowserType }): Promise<Result> {
    try {
      logger.debug(`[BrowserControl] Browser change requested: ${settings}`);
      const alias = this.deps.getAlias();
      if (!alias) return { success: false, error: 'No current user alias set' };
      const pcManager = await this.deps.getProfileCacheManager();

      const success = await pcManager.updateBrowserControlSettings(alias, settings);

      if (settings.browser) {
        const selectedBrowserPath = path.join(this.deps.getUserDataDir(), 'assets', 'native-server', 'selectedBrowser.json');
        try {
          const dir = path.dirname(selectedBrowserPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(selectedBrowserPath, JSON.stringify({ browser: settings.browser, updatedAt: Date.now() }, null, 2));
          logger.debug(`[BrowserControl] Selected browser saved to: ${selectedBrowserPath}`);
        } catch (writeErr) {
          logger.warn(`[BrowserControl] Failed to write selectedBrowser.json: ${writeErr}`);
        }

        // Notify Native Server if running
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          await fetch('http://127.0.0.1:12306/control/set-browser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ browser: settings.browser }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          logger.debug(`[BrowserControl] Native Server notified of browser change`);
        } catch {
          logger.debug(`[BrowserControl] Native Server not reachable, skipped notification`);
        }
      }

      return success ? { success: true } : { success: false, error: 'Failed to update settings' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // -- Status --

  async getStatus(): Promise<Result<{ enabled: boolean }>> {
    try {
      let selectedBrowser: BrowserType = 'edge';
      const alias = this.deps.getAlias();
      if (alias) {
        const pcManager = await this.deps.getProfileCacheManager();
        const settings = pcManager.getBrowserControlSettings(alias);
        selectedBrowser = settings.browser || 'edge';
      }
      const isEnabled = await checkBrowserControlStatus(selectedBrowser, alias);
      return { success: true, data: { enabled: isEnabled } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  getInstallStatus(): { success: true; data: InstallState } {
    return { success: true, data: { ...this.installState } };
  }

  getUpdateStatus(): { success: true; data: UpdateState } {
    return { success: true, data: { ...this.updateState } };
  }

  // -- Native Server Update --

  async checkNativeServerUpdate(): Promise<Result<{ localVersion: string; remoteVersion: string | null; needsUpdate: boolean }>> {
    try {
      const { NativeServerFetcher } = await import('./nativeServerFetcher');
      const fetcher = new NativeServerFetcher();
      const local = fetcher.checkLocalNativeServer();
      if (!local.exists) {
        return { success: true, data: { localVersion: '0.0.0', remoteVersion: null, needsUpdate: false } };
      }
      const versionCheck = await fetcher.checkNativeServerNeedsUpdate();
      return {
        success: true,
        data: {
          localVersion: versionCheck.localVersion,
          remoteVersion: versionCheck.remoteVersion,
          needsUpdate: versionCheck.needsUpdate,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateNativeServer(): Promise<Result> {
    this.updateState = { isUpdating: true, phase: 'idle', progress: 0, error: '', localVersion: '', remoteVersion: '' };
    try {
      const { NativeServerFetcher } = await import('./nativeServerFetcher');
      const fetcher = new NativeServerFetcher();

      // Store version info before downloading
      const versionCheck = await fetcher.checkNativeServerNeedsUpdate();
      this.updateState.localVersion = versionCheck.localVersion;
      this.updateState.remoteVersion = versionCheck.remoteVersion || versionCheck.localVersion;

      const result = await fetcher.downloadNativeServer(
        (progress) => this.sendUpdateDownloadProgress(progress),
        (phase) => this.sendUpdatePhaseChange(phase),
      );
      if (!result.success) {
        this.sendUpdatePhaseChange('error', result.error || 'Download failed');
        return { success: false, error: result.error || 'Download failed' };
      }
      this.sendUpdatePhaseChange('completed');
      return { success: true };
    } catch (error) {
      this.sendUpdatePhaseChange('error', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // -- Confirmation resolvers (called from IPC layer) --

  resolveBrowserInstallConfirm(requestId: string, confirmed: boolean): boolean {
    const cb = this.pendingBrowserInstallConfirm.get(requestId);
    if (cb) { cb(confirmed); return true; }
    return false;
  }

  resolveNativeServerDownloadConfirm(requestId: string, confirmed: boolean): boolean {
    const cb = this.pendingNativeServerDownloadConfirm.get(requestId);
    if (cb) { cb(confirmed); return true; }
    return false;
  }

  resolveBrowserRestartConfirm(requestId: string, confirmed: boolean): boolean {
    const cb = this.pendingBrowserRestartConfirm.get(requestId);
    if (cb) { cb(confirmed); return true; }
    return false;
  }

  // -- Enable --

  async enable(): Promise<Result> {
    if (!this.deps.isFeatureEnabled('browserControl')) {
      return { success: false, error: 'Browser Control feature is not enabled' };
    }

    this.installState = { isInstalling: true, phase: 'idle', progress: 0, error: '' };

    try {
      if (process.platform !== 'win32' && process.platform !== 'darwin') {
        this.sendPhaseChange('error', 'Browser Control setup is only supported on Windows and macOS');
        return { success: false, error: 'Browser Control setup is only supported on Windows and macOS' };
      }

      const browserControlDir = path.join(this.deps.getAppPath(), 'resources', 'browser-control');
      const pcManager = await this.deps.getProfileCacheManager();
      const alias = this.deps.getAlias();
      const browserSettings = alias
        ? pcManager.getBrowserControlSettings(alias)
        : { browser: 'edge' as const };
      const selectedBrowser: BrowserType = browserSettings.browser || 'edge';
      const browserConfig = BROWSER_CONFIG[selectedBrowser];

      // 0. Check if browser is installed + auto-install
      await this.ensureBrowserInstalled(selectedBrowser, browserConfig, browserControlDir);

      // Write config files
      const userDataDir = this.deps.getUserDataDir();
      if (alias) {
        pcManager.updateBrowserControlSettings(alias, { browser: selectedBrowser });
        logger.debug(`[BrowserControl] Written profile.json browserControl: ${selectedBrowser}`);
      }
      const selectedBrowserJson = path.join(userDataDir, 'assets', 'native-server', 'selectedBrowser.json');
      fs.mkdirSync(path.dirname(selectedBrowserJson), { recursive: true });
      fs.writeFileSync(selectedBrowserJson, JSON.stringify({ browser: selectedBrowser }, null, 2));
      logger.debug(`[BrowserControl] Written selectedBrowser.json: ${selectedBrowser}`);

      // 1. Start HTTP server (must be ready before registering extensions,
      //    because the browser may immediately fetch update.xml upon detecting the new policy)
      await browserControlHttpServer.ensureStarted();

      // 2. Register browser extensions
      await this.registerExtensions(browserControlDir);

      // 3. Download Native Server if needed
      await this.ensureNativeServer();

      // 4. Register Native Server
      this.sendPhaseChange('connecting');
      await this.registerNativeServer(browserControlDir, userDataDir);

      // 5. Add MCP server config
      await this.addMcpConfig();

      // 5.5. Check if browser needs restart
      let browserWasRestarted = false;
      browserWasRestarted = await this.checkAndRestartBrowser(browserConfig);
      if (browserWasRestarted === null as any) {
        // User skipped restart: enable completes without launch
        return { success: true };
      }

      // 6. Launch browser and snap
      await this.launchBrowserWithSnap(browserWasRestarted ? { skipEdgeHack: true } : undefined);

      this.sendPhaseChange('completed');
      return { success: true };
    } catch (error) {
      this.sendPhaseChange('error', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // -- Enable sub-steps --

  private async ensureBrowserInstalled(selectedBrowser: BrowserType, browserConfig: BrowserConfigEntry, browserControlDir: string): Promise<void> {

    if (process.platform === 'win32') {
      let isBrowserInstalled = await checkBrowserInstalled(selectedBrowser);
      if (!isBrowserInstalled) {
        await this.downloadAndInstallBrowserWindows(browserConfig);
        isBrowserInstalled = await checkBrowserInstalled(selectedBrowser);
        if (!isBrowserInstalled) {
          throw new Error(`${browserConfig.displayName} installation may have failed. Please install manually and retry.`);
        }
      }
    } else if (process.platform === 'darwin') {
      let isBrowserInstalled = await checkBrowserInstalled(selectedBrowser);
      if (!isBrowserInstalled && selectedBrowser === 'chrome') {
        await this.downloadAndInstallBrowserMac(browserConfig);
        isBrowserInstalled = await checkBrowserInstalled(selectedBrowser);
        if (!isBrowserInstalled) {
          throw new Error(`${browserConfig.displayName} installation may have failed. Please install manually and retry.`);
        }
      }
    }
  }

  private async downloadAndInstallBrowserWindows(browserConfig: BrowserConfigEntry): Promise<void> {
    logger.debug(`[BrowserControl] ${browserConfig.displayName} is not installed, asking user for confirmation...`);

    const requestId = `browser-install-${Date.now()}`;
    this.sendToRenderer('browserControl:showBrowserInstallConfirm', { requestId, browserName: browserConfig.displayName });

    const userConfirmed = await this.waitForUserConfirm(this.pendingBrowserInstallConfirm, requestId);
    if (!userConfirmed) {
      this.sendPhaseChange('idle');
      this.installState.isInstalling = false;
      throw new Error('User cancelled browser installation');
    }

    logger.debug(`[BrowserControl] User confirmed, downloading installer...`);
    this.sendPhaseChange('downloading');

    const tempDir = this.deps.getTempDir();
    const timestamp = Date.now();
    const installerExt = path.extname(browserConfig.installerName);
    const installerBase = path.basename(browserConfig.installerName, installerExt);
    const uniqueInstallerName = `${installerBase}_${timestamp}${installerExt}`;
    const installerPath = path.join(tempDir, uniqueInstallerName);

    logger.debug(`[BrowserControl] Installer path: ${installerPath}`);

    await new Promise<void>((resolve, reject) => {
      const downloadCmd = `curl -L -o "${installerPath}" "${browserConfig.downloadUrl}"`;
      logger.debug(`[BrowserControl] Download command: ${downloadCmd}`);
      exec(downloadCmd, { timeout: 300000 }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          logger.error(`[BrowserControl] Download failed: ${error.message}`);
          if (stderr) logger.error(`[BrowserControl] Download stderr: ${stderr}`);
          reject(error);
        } else {
          logger.debug(`[BrowserControl] Download completed: ${installerPath}`);
          resolve();
        }
      });
    });

    if (!fs.existsSync(installerPath)) {
      throw new Error(`Failed to download ${browserConfig.displayName} installer.`);
    }

    this.sendPhaseChange('installing', `Installing ${browserConfig.displayName}...`);
    logger.debug(`[BrowserControl] Installing ${browserConfig.displayName} from: ${installerPath}`);

    const installCmd = `msiexec /i "${installerPath}" ${browserConfig.installerArgs}`;
    logger.debug(`[BrowserControl] Install command: ${installCmd}`);

    await new Promise<void>((resolve, reject) => {
      sudoPrompt.exec(installCmd, { name: 'OpenKosmos Browser Install' }, (error?: Error, stdout?: string | Buffer, stderr?: string | Buffer) => {
        if (error) {
          logger.error(`[BrowserControl] Install failed: ${error.message}`);
          if (stderr) logger.error(`[BrowserControl] Install stderr: ${stderr}`);
          reject(error);
        } else {
          logger.debug(`[BrowserControl] Install process completed`);
          if (stdout) logger.debug(`[BrowserControl] Install stdout: ${stdout}`);
          resolve();
        }
      });
    });

    try { fs.unlinkSync(installerPath); } catch { /* ignore */ }
    logger.debug(`[BrowserControl] ${browserConfig.displayName} installed successfully`);
  }

  private async downloadAndInstallBrowserMac(browserConfig: BrowserConfigEntry): Promise<void> {
    logger.debug(`[BrowserControl] ${browserConfig.displayName} is not installed, asking user for confirmation...`);

    const requestId = `browser-install-${Date.now()}`;
    this.sendToRenderer('browserControl:showBrowserInstallConfirm', { requestId, browserName: browserConfig.displayName });

    const userConfirmed = await this.waitForUserConfirm(this.pendingBrowserInstallConfirm, requestId);
    if (!userConfirmed) {
      this.sendPhaseChange('idle');
      this.installState.isInstalling = false;
      throw new Error('User cancelled browser installation');
    }

    logger.debug(`[BrowserControl] User confirmed, downloading Chrome DMG...`);
    this.sendPhaseChange('downloading');

    const tempDir = this.deps.getTempDir();
    const timestamp = Date.now();
    const dmgFileName = `googlechrome_${timestamp}.dmg`;
    const dmgPath = path.join(tempDir, dmgFileName);

    logger.debug(`[BrowserControl] DMG path: ${dmgPath}`);

    await new Promise<void>((resolve, reject) => {
      const downloadCmd = `curl -L -o "${dmgPath}" "${browserConfig.macDownloadUrl}"`;
      logger.debug(`[BrowserControl] Download command: ${downloadCmd}`);
      exec(downloadCmd, { timeout: 300000 }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          logger.error(`[BrowserControl] Download failed: ${error.message}`);
          if (stderr) logger.error(`[BrowserControl] Download stderr: ${stderr}`);
          reject(error);
        } else {
          logger.debug(`[BrowserControl] Download completed: ${dmgPath}`);
          resolve();
        }
      });
    });

    if (!fs.existsSync(dmgPath)) {
      throw new Error(`Failed to download ${browserConfig.displayName} installer.`);
    }

    this.sendPhaseChange('installing', `Installing ${browserConfig.displayName}...`);
    logger.debug(`[BrowserControl] Installing ${browserConfig.displayName} from: ${dmgPath}`);

    const volumeName = browserConfig.macDmgVolumeName;
    const volumePath = `/Volumes/${volumeName}`;
    const appName = `${browserConfig.macAppName}.app`;

    await new Promise<void>((resolve, reject) => {
      exec(`hdiutil attach "${dmgPath}" -nobrowse -quiet`, { timeout: 60000 }, (error: Error | null) => {
        if (error) {
          logger.error(`[BrowserControl] Failed to mount DMG: ${error.message}`);
          reject(error);
        } else {
          logger.debug(`[BrowserControl] DMG mounted at ${volumePath}`);
          resolve();
        }
      });
    });

    try {
      const installCmd = `cp -R "${volumePath}/${appName}" /Applications/`;
      logger.debug(`[BrowserControl] Install command: ${installCmd}`);
      await new Promise<void>((resolve, reject) => {
        sudoPrompt.exec(installCmd, { name: 'OpenKosmos Browser Install' }, (error?: Error, stdout?: string | Buffer, stderr?: string | Buffer) => {
          if (error) {
            logger.error(`[BrowserControl] Install failed: ${error.message}`);
            if (stderr) logger.error(`[BrowserControl] Install stderr: ${stderr}`);
            reject(error);
          } else {
            logger.debug(`[BrowserControl] Install process completed`);
            if (stdout) logger.debug(`[BrowserControl] Install stdout: ${stdout}`);
            resolve();
          }
        });
      });
    } finally {
      try {
        await new Promise<void>((resolve) => {
          exec(`hdiutil detach "${volumePath}" -quiet`, { timeout: 30000 }, () => resolve());
        });
        logger.debug(`[BrowserControl] DMG unmounted`);
      } catch {
        logger.warn(`[BrowserControl] Failed to unmount DMG`);
      }
    }

    try { fs.unlinkSync(dmgPath); } catch { /* ignore */ }
    logger.debug(`[BrowserControl] ${browserConfig.displayName} installed successfully`);
  }

  private async registerExtensions(browserControlDir: string): Promise<void> {
    if (process.platform === 'win32') {
      this.sendPhaseChange('preparing');
      const registerAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.registerAll);
      const command = `powershell.exe -ExecutionPolicy Bypass -File "${registerAllScript}"`;
      await new Promise<void>((resolve, reject) => {
        sudoPrompt.exec(command, { name: 'OpenKosmos Browser Control Setup' }, (error?: Error) => {
          if (error) reject(error);
          else { logger.debug('[BrowserControl] Chrome and Edge extensions registered successfully'); resolve(); }
        });
      });
    } else if (process.platform === 'darwin') {
      this.sendPhaseChange('preparing');
      const registerAllMacScript = path.join(browserControlDir, COMBINED_SCRIPTS.registerAllMac);
      const currentUsername = os.userInfo().username;
      const command = `/bin/bash "${registerAllMacScript}" "${currentUsername}"`;
      await new Promise<void>((resolve, reject) => {
        sudoPrompt.exec(command, { name: 'OpenKosmos Browser Control Setup' }, (error?: Error, stdout?: string | Buffer, stderr?: string | Buffer) => {
          if (error) {
            logger.error(`[BrowserControl] macOS extension registration failed: ${error.message}`);
            if (stderr) logger.error(`[BrowserControl] stderr: ${stderr}`);
            reject(error);
          } else {
            logger.debug('[BrowserControl] macOS: Chrome and Edge extensions registered successfully');
            if (stdout) logger.debug(`[BrowserControl] stdout: ${stdout}`);
            resolve();
          }
        });
      });
    }
  }

  private async ensureNativeServer(): Promise<void> {
    const { NativeServerFetcher } = await import('./nativeServerFetcher');
    const nativeServerFetcher = new NativeServerFetcher();
    const nativeServerCheck = nativeServerFetcher.checkLocalNativeServer();

    if (nativeServerCheck.needsDownload) {
      logger.debug('[BrowserControl] Native Server not found, asking user for confirmation...');
      const requestId = `native-server-download-${Date.now()}`;
      this.sendToRenderer('browserControl:showNativeServerDownloadConfirm', { requestId });

      const userConfirmed = await this.waitForUserConfirm(this.pendingNativeServerDownloadConfirm, requestId);
      if (!userConfirmed) {
        this.sendPhaseChange('idle');
        this.installState.isInstalling = false;
        throw new Error('User cancelled Native Server download');
      }
      logger.debug('[BrowserControl] User confirmed Native Server download');
    }

    logger.debug('[BrowserControl] Ensuring Native Server is downloaded...');
    const fetchResult = await nativeServerFetcher.ensureNativeServer(
      (progress) => this.sendDownloadProgress(progress),
      (phase) => this.sendPhaseChange(phase),
    );
    if (!fetchResult.success) {
      throw new Error(`Failed to download Native Server: ${fetchResult.error}`);
    }
    logger.debug(`[BrowserControl] Native Server ready: ${fetchResult.nativeServerDir}, version: ${fetchResult.version}, downloaded: ${fetchResult.downloaded}`);
  }

  private async registerNativeServer(browserControlDir: string, userDataDir: string): Promise<void> {
    if (process.platform === 'win32') {
      const env = { ...process.env, OpenKosmos_USER_DATA_DIR: userDataDir };
      const registerNativeServerAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.registerNativeServerAll);
      logger.debug('[BrowserControl] Registering Chrome and Edge Native Server...');
      await new Promise<void>((resolveNative) => {
        exec(`powershell -ExecutionPolicy Bypass -File "${registerNativeServerAllScript}"`, { env }, (err: Error | null) => {
          if (err) logger.error(`[BrowserControl] Native Server registration failed: ${err.message}`);
          else logger.debug('[BrowserControl] Chrome and Edge Native Server registered successfully');
          resolveNative();
        });
      });
    } else if (process.platform === 'darwin') {
      const hostName = 'com.chromemcp.nativehost';
      const extensionId = 'oopmjmifghgbliienphmofbfffhhgcjl';
      const nativeServerDir = path.join(userDataDir, 'assets', 'native-server');
      const runHostPath = path.join(nativeServerDir, 'dist', 'run_host.sh');

      const manifest = {
        name: hostName,
        description: 'Node.js Host for Browser Bridge Extension',
        path: runHostPath,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId}/`],
      };
      const manifestJson = JSON.stringify(manifest, null, 2);

      const nmhDirs = [
        path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
        path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
      ];
      for (const nmhDir of nmhDirs) {
        fs.mkdirSync(nmhDir, { recursive: true });
        const manifestPath = path.join(nmhDir, `${hostName}.json`);
        fs.writeFileSync(manifestPath, manifestJson, 'utf8');
        logger.debug(`[BrowserControl] macOS: NativeMessagingHost manifest written to ${manifestPath}`);
      }
    }
  }

  private async addMcpConfig(): Promise<void> {
    const alias = this.deps.getAlias();
    if (!alias) return;

    const pcManager = await this.deps.getProfileCacheManager();
    const mcpServerName = 'openkosmos-chrome-extension';
    const existingServer = pcManager.getMcpServerInfo(alias, mcpServerName);

    if (!existingServer.config) {
      const mcpConfig = {
        name: mcpServerName,
        transport: 'StreamableHttp' as const,
        command: '',
        args: [],
        env: {},
        url: 'http://127.0.0.1:12306/mcp',
        in_use: true,
        version: '1.0.0',
        source: 'ON-DEVICE' as const,
      };
      await pcManager.addMcpServerConfig(alias, mcpConfig);
      logger.debug(`[BrowserControl] MCP server config added: ${mcpServerName}`);
    }
  }

  /**
   * Check if browser is running and prompt user to restart.
   * Returns true if browser was restarted, false if not running, or completes enable without launch if user skips.
   * Returns null (via sendPhaseChange + early return in caller) if user skips restart.
   */
  private async checkAndRestartBrowser(browserConfig: BrowserConfigEntry): Promise<boolean> {
    const isBrowserCurrentlyRunning = await new Promise<boolean>((resolve) => {
      if (process.platform === 'win32') {
        const processName = browserConfig.exe.replace('.exe', '');
        exec(`powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0"`, (err: Error | null, stdout: string) => {
          resolve(!err && stdout.trim().toLowerCase() === 'true');
        });
      } else if (process.platform === 'darwin') {
        exec(`pgrep -x "${browserConfig.macProcessName}"`, (err: Error | null) => {
          resolve(!err);
        });
      } else {
        resolve(false);
      }
    });

    if (!isBrowserCurrentlyRunning) return false;

    logger.debug(`[BrowserControl] ${browserConfig.displayName} is already running, asking user to restart...`);
    const requestId = `browser-restart-${Date.now()}`;
    this.sendToRenderer('browserControl:showBrowserRestartConfirm', { requestId, browserName: browserConfig.displayName });

    const userConfirmedRestart = await this.waitForUserConfirm(this.pendingBrowserRestartConfirm, requestId);

    if (!userConfirmedRestart) {
      logger.debug(`[BrowserControl] User skipped browser restart, enable completes without launch`);
      this.sendPhaseChange('completed');
      // Signal caller to return early -- use a sentinel value
      return null as any;
    }

    logger.debug(`[BrowserControl] User confirmed, closing ${browserConfig.displayName}...`);
    this.sendPhaseChange('connecting', `Restarting ${browserConfig.displayName}...`);
    await new Promise<void>((resolveKill) => {
      if (process.platform === 'win32') {
        exec(`taskkill /IM ${browserConfig.exe} /F`, (err: Error | null) => {
          if (err) logger.warn(`[BrowserControl] Failed to close ${browserConfig.exe}: ${err.message}`);
          resolveKill();
        });
      } else {
        exec(`pkill -x "${browserConfig.macProcessName}"`, (err: Error | null) => {
          if (err) logger.warn(`[BrowserControl] Failed to close ${browserConfig.macProcessName}: ${err.message}`);
          resolveKill();
        });
      }
    });
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  }

  // -- Disable --

  async disable(): Promise<Result> {
    if (!this.deps.isFeatureEnabled('browserControl')) {
      return { success: false, error: 'Browser Control feature is not enabled' };
    }

    try {
      if (process.platform !== 'win32' && process.platform !== 'darwin') {
        return { success: false, error: 'Browser Control setup is only supported on Windows and macOS' };
      }

      const browserControlDir = path.join(this.deps.getAppPath(), 'resources', 'browser-control');

      if (process.platform === 'win32') {

        const unregisterNativeServerAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.unregisterNativeServerAll);
        logger.debug('[BrowserControl] Unregistering Chrome and Edge Native Server...');
        await new Promise<void>((resolveNative) => {
          exec(`powershell -ExecutionPolicy Bypass -File "${unregisterNativeServerAllScript}"`, (err: Error | null) => {
            if (err) logger.error(`[BrowserControl] Native Server unregistration failed: ${err.message}`);
            else logger.debug('[BrowserControl] Chrome and Edge Native Server unregistered successfully');
            resolveNative();
          });
        });

        const unregisterAllScript = path.join(browserControlDir, COMBINED_SCRIPTS.unregisterAll);
        const command = `powershell.exe -ExecutionPolicy Bypass -File "${unregisterAllScript}"`;
        await new Promise<void>((resolve, reject) => {
          sudoPrompt.exec(command, { name: 'OpenKosmos Browser Control Uninstall' }, (error?: Error) => {
            if (error) reject(error);
            else { logger.debug('[BrowserControl] Chrome and Edge extensions unregistered successfully'); resolve(); }
          });
        });
      } else if (process.platform === 'darwin') {
        const hostName = 'com.chromemcp.nativehost';
        const nmhManifests = [
          path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${hostName}.json`),
          path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts', `${hostName}.json`),
        ];
        for (const manifestPath of nmhManifests) {
          if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
            logger.debug(`[BrowserControl] macOS: Deleted NativeMessagingHost manifest: ${manifestPath}`);
          }
        }

        const unregisterAllMacScript = path.join(browserControlDir, COMBINED_SCRIPTS.unregisterAllMac);
        const currentUsername = os.userInfo().username;
        const command = `/bin/bash "${unregisterAllMacScript}" "${currentUsername}"`;
        await new Promise<void>((resolve, reject) => {
          sudoPrompt.exec(command, { name: 'OpenKosmos Browser Control Uninstall' }, (error?: Error, stdout?: string | Buffer, stderr?: string | Buffer) => {
            if (error) {
              logger.error(`[BrowserControl] macOS extension unregistration failed: ${error.message}`);
              if (stderr) logger.error(`[BrowserControl] stderr: ${stderr}`);
              reject(error);
            } else {
              logger.debug('[BrowserControl] macOS: Chrome and Edge extensions unregistered successfully');
              if (stdout) logger.debug(`[BrowserControl] stdout: ${stdout}`);
              resolve();
            }
          });
        });
      }

      await browserControlHttpServer.stop();

      const alias = this.deps.getAlias();
      if (alias) {
        const mcpServerName = 'openkosmos-chrome-extension';
        try { await mcpClientManager.disconnect(mcpServerName); logger.debug(`[BrowserControl] MCP server disconnected: ${mcpServerName}`); }
        catch (e) { logger.debug(`[BrowserControl] MCP server disconnect attempt: ${e instanceof Error ? e.message : String(e)}`); }
        try { await mcpClientManager.delete(mcpServerName); logger.debug(`[BrowserControl] MCP server config removed: ${mcpServerName}`); }
        catch (e) { logger.debug(`[BrowserControl] MCP server remove attempt: ${e instanceof Error ? e.message : String(e)}`); }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // -- Launch Browser with Snap --

  async launchBrowserWithSnap(options?: { skipEdgeHack?: boolean }): Promise<Result> {
    try {
      if (process.platform !== 'win32' && process.platform !== 'darwin') {
        return { success: false, error: 'Browser Control is only supported on Windows and macOS' };
      }

      const alias = this.deps.getAlias();
      if (!alias) return { success: false, error: 'No current user alias set' };

      const browserControlDir = path.join(this.deps.getAppPath(), 'resources', 'browser-control');

      const pcManager = await this.deps.getProfileCacheManager();
      const browserSettings = pcManager.getBrowserControlSettings(alias);
      const selectedBrowser: BrowserType = browserSettings.browser || 'edge';
      const browserConfig = BROWSER_CONFIG[selectedBrowser];
      const mainWindow = this.deps.getMainWindow();

      // ============ macOS platform implementation ============
      if (process.platform === 'darwin') {
        const isBrowserRunning = await new Promise<boolean>((resolve) => {
          exec(`pgrep -x "${browserConfig.macProcessName}"`, (err: Error | null) => {
            resolve(!err);
          });
        });

        logger.debug('[BrowserControl] Setting up browser with macOS split view...');

        try {

          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }

          const currentBounds = mainWindow?.getBounds() || { x: 0, y: 0, width: 960, height: 540 };
          const display = screen.getDisplayMatching(currentBounds);
          const workArea = display.workArea;
          const leftHalf = { x: workArea.x, y: workArea.y, width: Math.floor(workArea.width / 2), height: workArea.height };

          logger.debug(`[BrowserControl] Snapping OpenKosmos to left: x=${leftHalf.x}, y=${leftHalf.y}, w=${leftHalf.width}, h=${leftHalf.height}`);
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBounds(leftHalf);

          const actualBounds = mainWindow?.getBounds() || leftHalf;
          const rightHalf = { x: actualBounds.x + actualBounds.width, y: workArea.y, width: workArea.width - actualBounds.width, height: workArea.height };
          logger.debug(`[BrowserControl] OpenKosmos actual bounds: x=${actualBounds.x}, w=${actualBounds.width}; Browser target: x=${rightHalf.x}, y=${rightHalf.y}, w=${rightHalf.width}, h=${rightHalf.height}`);

          if (!isBrowserRunning) {
            logger.debug(`[BrowserControl] Launching ${browserConfig.macAppName} via open -a...`);
            await new Promise<void>((resolveLaunch) => {
              exec(`open -a "${browserConfig.macAppName}"`, (err: Error | null) => {
                if (err) logger.warn(`[BrowserControl] Failed to launch ${browserConfig.macAppName}: ${err.message}`);
                resolveLaunch();
              });
            });
            await new Promise(resolve => setTimeout(resolve, 1500));
          }

          const appleScriptBounds = `{${rightHalf.x}, ${rightHalf.y}, ${rightHalf.x + rightHalf.width}, ${rightHalf.y + rightHalf.height}}`;
          const appleScript = [
            `tell application "${browserConfig.macAppName}"`,
            `  activate`,
            `  if (count of windows) = 0 then`,
            `    make new window`,
            `    delay 0.5`,
            `  end if`,
            `  set bounds of front window to ${appleScriptBounds}`,
            `end tell`,
          ].join('\n');

          logger.debug(`[BrowserControl] Snapping ${browserConfig.macAppName} to right via AppleScript...`);
          await new Promise<void>((resolveSnap) => {
            exec(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, (err: Error | null) => {
              if (err) logger.warn(`[BrowserControl] Failed to snap ${browserConfig.macAppName} to right: ${err.message}`);
              resolveSnap();
            });
          });
        } catch (snapError) {
          logger.warn(`[BrowserControl] macOS snap failed, falling back to normal launch: ${snapError}`);
          await new Promise<void>((resolveExec) => {
            exec(`open -a "${browserConfig.macAppName}"`, (err: Error | null) => {
              if (err) logger.warn(`[BrowserControl] Failed to launch ${browserConfig.macAppName}: ${err.message}`);
              resolveExec();
            });
          });
        }
      }

      // ============ Windows platform implementation ============
      if (process.platform === 'win32') {
        const processName = browserConfig.exe.replace('.exe', '');
        const isBrowserRunning = await new Promise<boolean>((resolve) => {
          exec(`powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0"`, (err: Error | null, stdout: string) => {
            resolve(!err && stdout.trim().toLowerCase() === 'true');
          });
        });

        logger.debug('[BrowserControl] Setting up browser with Windows Snap...');

        try {
          const snapLeftScript = path.join(browserControlDir, 'snap-left.ps1');

          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }

          logger.debug('[BrowserControl] Snapping OpenKosmos to left...');
          await new Promise<void>((resolveSnap) => {
            exec(`powershell -ExecutionPolicy Bypass -File "${snapLeftScript}"`, (err: Error | null) => {
              if (err) logger.warn(`[BrowserControl] Failed to snap OpenKosmos to left: ${err.message}`);
              resolveSnap();
            });
          });

          const openkosmosBounds = mainWindow?.getBounds() || { x: 0, y: 0, width: 960, height: 540 };
          const targetX = openkosmosBounds.x + openkosmosBounds.width;
          const targetY = openkosmosBounds.y;
          logger.debug(`[BrowserControl] OpenKosmos bounds: x=${openkosmosBounds.x}, y=${openkosmosBounds.y}, width=${openkosmosBounds.width}, height=${openkosmosBounds.height}`);

          if (isBrowserRunning) {
            logger.debug(`[BrowserControl] ${browserConfig.exe} is already running, skipping launch`);
          } else {
            logger.debug(`[BrowserControl] Launching ${browserConfig.exe}...`);
            if (browserSettings.browser === 'edge' && !options?.skipEdgeHack) {
              await new Promise<void>((resolveExec) => {
                exec(`${browserConfig.startCmd} --new-window`, (err: Error | null) => {
                  if (err) logger.warn(`[BrowserControl] Failed to launch ${browserConfig.exe}: ${err.message}`);
                  resolveExec();
                });
              });
              await new Promise(resolve => setTimeout(resolve, 1000));
              logger.debug(`[BrowserControl] Closing ${browserConfig.exe} for extension registration...`);
              await new Promise<void>((resolveKill) => {
                exec(`taskkill /IM ${browserConfig.exe} /F`, (err: Error | null) => {
                  if (err) logger.warn(`[BrowserControl] Failed to close ${browserConfig.exe}: ${err.message}`);
                  resolveKill();
                });
              });
              await new Promise(resolve => setTimeout(resolve, 1000));
              logger.debug(`[BrowserControl] Re-launching ${browserConfig.exe}...`);
              await new Promise<void>((resolveExec) => {
                exec(`${browserConfig.startCmd} --new-window`, (err: Error | null) => {
                  if (err) logger.warn(`[BrowserControl] Failed to re-launch ${browserConfig.exe}: ${err.message}`);
                  resolveExec();
                });
              });
            } else {
              await new Promise<void>((resolveExec) => {
                exec(`${browserConfig.startCmd} --new-window`, (err: Error | null) => {
                  if (err) logger.warn(`[BrowserControl] Failed to launch ${browserConfig.exe}: ${err.message}`);
                  resolveExec();
                });
              });
            }
          }

          logger.debug(`[BrowserControl] Moving ${browserConfig.exe} to OpenKosmos display...`);
          const moveBrowserScript = path.join(browserControlDir, browserConfig.moveBrowserToDisplayScript);
          await new Promise<void>((resolveMove) => {
            exec(`powershell -ExecutionPolicy Bypass -File "${moveBrowserScript}" -targetX ${targetX} -targetY ${targetY}`, (err: Error | null) => {
              if (err) logger.warn(`[BrowserControl] Failed to move ${browserConfig.exe}: ${err.message}`);
              resolveMove();
            });
          });

          logger.debug(`[BrowserControl] Snapping ${browserConfig.exe} to right...`);
          const snapRightScript = path.join(browserControlDir, browserConfig.snapRightScript);
          await new Promise<void>((resolveSnap) => {
            exec(`powershell -ExecutionPolicy Bypass -File "${snapRightScript}"`, (err: Error | null) => {
              if (err) logger.warn(`[BrowserControl] Failed to snap ${browserConfig.exe} to right: ${err.message}`);
              resolveSnap();
            });
          });
        } catch (snapError) {
          logger.warn(`[BrowserControl] Snap failed, falling back to normal launch: ${snapError}`);
          if (!isBrowserRunning) {
            await new Promise<void>((resolveExec) => {
              exec(browserConfig.startCmd, (err: Error | null) => {
                if (err) logger.warn(`[BrowserControl] Failed to launch ${browserConfig.exe}: ${err.message}`);
                resolveExec();
              });
            });
          }
        }
      }

      // Poll and wait for Native Server to start
      const mcpServerUrl = 'http://127.0.0.1:12306';
      const maxWaitTime = 30000;
      const pollInterval = 500;
      const startTime = Date.now();

      logger.debug('[BrowserControl] Waiting for Native Server to start...');

      let serverReady = false;
      while (Date.now() - startTime < maxWaitTime) {
        try {
          const response = await fetch(`${mcpServerUrl}/ping`);
          if (response.ok) { serverReady = true; logger.debug('[BrowserControl] Native Server is ready!'); break; }
        } catch { /* Connection failed, continue waiting */ }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      if (!serverReady) {
        logger.warn('[BrowserControl] Native Server did not start within timeout, attempting MCP connection anyway...');
      }

      return { success: true };
    } catch (error) {
      logger.error(`[BrowserControl] launchBrowserWithSnap failed: ${error instanceof Error ? error.message : String(error)}`)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // -- Reinstall Extension --

  async reinstallExtension(): Promise<Result> {
    if (!this.deps.isFeatureEnabled('browserControl')) {
      return { success: false, error: 'Browser Control feature is not enabled' };
    }

    try {
      if (process.platform !== 'win32' && process.platform !== 'darwin') {
        return { success: false, error: 'Browser Control setup is only supported on Windows and macOS' };
      }

      const pcManager = await this.deps.getProfileCacheManager();
      const alias = this.deps.getAlias();
      const browserSettings = alias
        ? pcManager.getBrowserControlSettings(alias)
        : { browser: 'edge' as const };
      const selectedBrowser: BrowserType = browserSettings.browser || 'edge';
      const browserConfig = BROWSER_CONFIG[selectedBrowser];

      // 1. Disable (unregister extensions, stop HTTP server, remove MCP config)
      logger.debug('[BrowserControl] Reinstall: Step 1 - Disabling...');
      await this.disable();

      // 2. Check if browser is running
      const isBrowserRunning = await new Promise<boolean>((resolve) => {
        if (process.platform === 'win32') {
          const processName = browserConfig.exe.replace('.exe', '');
          exec(`powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0"`, (err: Error | null, stdout: string) => {
            resolve(!err && stdout.trim().toLowerCase() === 'true');
          });
        } else if (process.platform === 'darwin') {
          exec(`pgrep -x "${browserConfig.macProcessName}"`, (err: Error | null) => {
            resolve(!err);
          });
        } else {
          resolve(false);
        }
      });

      if (isBrowserRunning) {
        // Browser is running: ask user to confirm, then kill
        logger.debug(`[BrowserControl] Reinstall: Browser is running, asking user to restart...`);
        const requestId = `browser-restart-${Date.now()}`;
        this.sendToRenderer('browserControl:showBrowserRestartConfirm', { requestId, browserName: browserConfig.displayName });

        const userConfirmed = await this.waitForUserConfirm(this.pendingBrowserRestartConfirm, requestId);
        if (!userConfirmed) {
          logger.debug('[BrowserControl] Reinstall: User cancelled browser restart');
          return { success: false, error: 'User cancelled browser restart' };
        }

        logger.debug(`[BrowserControl] Reinstall: Killing ${browserConfig.displayName}...`);
        await new Promise<void>((resolveKill) => {
          if (process.platform === 'win32') {
            exec(`taskkill /IM ${browserConfig.exe} /F`, (err: Error | null) => {
              if (err) logger.warn(`[BrowserControl] Failed to close ${browserConfig.exe}: ${err.message}`);
              resolveKill();
            });
          } else {
            exec(`pkill -x "${browserConfig.macProcessName}"`, (err: Error | null) => {
              if (err) logger.warn(`[BrowserControl] Failed to close ${browserConfig.macProcessName}: ${err.message}`);
              resolveKill();
            });
          }
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // Launch browser so it reads the empty registry (uninstalls old extension)
      logger.debug(`[BrowserControl] Reinstall: Launching browser to apply unregistration...`);
      await new Promise<void>((resolveLaunch) => {
        if (process.platform === 'win32') {
          exec(`${browserConfig.startCmd} --new-window`, (err: Error | null) => {
            if (err) logger.warn(`[BrowserControl] Failed to launch ${browserConfig.exe}: ${err.message}`);
            resolveLaunch();
          });
        } else {
          exec(`open -a "${browserConfig.macAppName}"`, (err: Error | null) => {
            if (err) logger.warn(`[BrowserControl] Failed to launch ${browserConfig.macAppName}: ${err.message}`);
            resolveLaunch();
          });
        }
      });
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 3. Re-enable (register extensions, start HTTP server, download native server, restart browser)
      logger.debug('[BrowserControl] Reinstall: Step 3 - Re-enabling...');
      const enableResult = await this.enable();
      if (!enableResult.success) {
        return { success: false, error: `Re-enable failed: ${enableResult.error}` };
      }

      logger.debug('[BrowserControl] Reinstall completed successfully');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ============== CDP (DevTools MCP) ==============

  private static readonly CDP_MCP_SERVER_NAME = 'chrome-devtools-mcp';

  async cdpEnable(): Promise<Result> {
    try {
      const alias = this.deps.getAlias();
      if (!alias) return { success: false, error: 'Not logged in' };

      const pcManager = await this.deps.getProfileCacheManager();
      const existingServer = pcManager.getMcpServerInfo(alias, BrowserControlManager.CDP_MCP_SERVER_NAME);

      if (!existingServer.config) {
        const mcpConfig = {
          name: BrowserControlManager.CDP_MCP_SERVER_NAME,
          transport: 'stdio' as const,
          command: 'npx',
          args: ['chrome-devtools-mcp@latest', '--autoConnect'],
          env: {},
          url: '',
          in_use: true,
          version: '1.0.1',
          source: 'ON-DEVICE' as const,
        };
        await pcManager.addMcpServerConfig(alias, mcpConfig);
        logger.debug(`[BrowserControl/CDP] MCP server config added: ${BrowserControlManager.CDP_MCP_SERVER_NAME}`);
      }

      try { await mcpClientManager.connect(BrowserControlManager.CDP_MCP_SERVER_NAME); } catch { /* will retry */ }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async cdpDisable(): Promise<Result> {
    try {
      const alias = this.deps.getAlias();
      if (!alias) return { success: false, error: 'Not logged in' };


      try { await mcpClientManager.disconnect(BrowserControlManager.CDP_MCP_SERVER_NAME); } catch { /* may already be disconnected */ }
      try { await mcpClientManager.delete(BrowserControlManager.CDP_MCP_SERVER_NAME); } catch { /* may already be deleted */ }

      logger.debug(`[BrowserControl/CDP] MCP server removed: ${BrowserControlManager.CDP_MCP_SERVER_NAME}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async cdpGetStatus(): Promise<Result<{ enabled: boolean }>> {
    try {
      const alias = this.deps.getAlias();
      if (!alias) return { success: true, data: { enabled: false } };

      const pcManager = await this.deps.getProfileCacheManager();
      const existingServer = pcManager.getMcpServerInfo(alias, BrowserControlManager.CDP_MCP_SERVER_NAME);
      return { success: true, data: { enabled: !!existingServer.config } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
