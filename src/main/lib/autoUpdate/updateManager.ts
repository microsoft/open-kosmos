import { BrowserWindow, dialog, app, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { spawn } from 'child_process';
import * as os from 'os';
import { createLogger } from '../unifiedLogger';
import { CdnUpdateChecker, CdnUpdateInfo } from './cdnUpdateChecker';
import { UpdaterFetcher, UpdaterFetchProgress } from './updaterFetcher';
import { BRAND_CONFIG, BRAND_NAME } from '../../../shared/constants/branding';
import { getCdnBaseUrl } from '../../../shared/utils/cdn';
import { assetsLibraryManager } from "../assetsFetcher/assetsLibraryManager";

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
  files?: Array<{url: string; size: number; sha512?: string}>;
}

export interface DownloadProgress {
  percent: number;
  transferred: string;
  total: string;
  bytesPerSecond: string;
}

export interface UpdatePreferences {
  autoUpdateEnabled: boolean;
  skipVersions: string[];
}

// Global update check status
export enum UpdateCheckStatus {
  NotStarted = 'NotStarted',
  InProgress = 'InProgress',
  Done = 'Done'
}

export enum UpdateCheckResult {
  None = 'None',
  UpToDate = 'Up-to-date',
  NewVersionFound = 'New version founded'
}

// Updater check phases
export enum UpdaterCheckPhase {
  NotStarted = 'NotStarted',
  CheckingUpdater = 'CheckingUpdater',
  DownloadingUpdater = 'DownloadingUpdater',
  UpdaterReady = 'UpdaterReady',
  CheckingVersion = 'CheckingVersion'
}

export interface LastCheckState {
  lastCheckStartedAt: number | null;
  lastCheckEndedAt: number | null;
  lastCheckStatus: UpdateCheckStatus;
  lastCheckResult: UpdateCheckResult;
}

export class UpdateManager {
  private getMainWindow: () => BrowserWindow | null;
  private logger = createLogger();
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private preferences: UpdatePreferences;
  private errorHandler: UpdateErrorHandler;
  private cdnUpdateChecker: CdnUpdateChecker | null = null;
  private useCdnUpdates: boolean = false;
  private isSilentCheck: boolean = false; // flag indicating whether this is a silent check
  private updaterFetcher: UpdaterFetcher; // Updater downloader
  private currentPhase: UpdaterCheckPhase = UpdaterCheckPhase.NotStarted;

  private get filenamePrefix(): string {
    return BRAND_CONFIG.filenamePrefix || 'OpenKosmos';
  }

  // Global update check state
  private lastCheckState: LastCheckState = {
    lastCheckStartedAt: null,
    lastCheckEndedAt: null,
    lastCheckStatus: UpdateCheckStatus.NotStarted,
    lastCheckResult: UpdateCheckResult.None,
  };

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow;
    this.preferences = this.loadPreferences();
    this.errorHandler = new UpdateErrorHandler();
    this.updaterFetcher = new UpdaterFetcher();
    this.initializeCdnChecker();
    this.setupAutoUpdater();
  }

  private initializeCdnChecker(): void {
    // CDN-based auto-update is optional. When no CDN base URL is configured,
    // disable CDN updates entirely instead of pointing at an invalid URL.
    const baseCdnUrl = getCdnBaseUrl();

    if (!baseCdnUrl) {
      this.logger.info(
        'CDN base URL not configured; CDN auto-update disabled',
        'UpdateManager',
      );
      this.useCdnUpdates = false;
      return;
    }

    const cdnUrl = `${baseCdnUrl}/releases`;

    this.logger.info(
      `CDN update config - baseCdnUrl: ${baseCdnUrl}, cdnUrl: ${cdnUrl}`,
      'UpdateManager',
    );

    try {
      this.cdnUpdateChecker = new CdnUpdateChecker(cdnUrl);
      this.useCdnUpdates = true;
    } catch (error) {
      this.logger.error('❌ CDN checker initialization failed', 'UpdateManager', {
        error,
        cdnUrl,
      });
      this.useCdnUpdates = false;
    }
  }

  private setupAutoUpdater(): void {
    // This project uses CDN update mode
    if (this.useCdnUpdates) {
      return;
    }

    this.logger.warn('CDN update mode not enabled, please check CDN configuration', 'UpdateManager');
  }

  private registerEventListeners(): void {
    // CDN mode does not need electron-updater event listeners
  }

  // Public methods
  public async checkForUpdates(silent: boolean = false): Promise<void> {
    try {
      this.isSilentCheck = silent; // set the silent check flag

      // Check whether a check is already in progress
      if (
        this.lastCheckState.lastCheckStatus === UpdateCheckStatus.InProgress
      ) {
        this.logger.info('Update check already in progress, waiting for result', 'UpdateManager', {
          silent,
          lastCheckStartedAt: this.lastCheckState.lastCheckStartedAt,
        });

        // Regardless of silent or not, wait for the ongoing check to complete
        // UX: the user only cares about the result, not which check produced it.
        // The frontend receives results via event listeners (updateAvailable/updateNotAvailable/updateError)
        return;
      }

      // Update state: begin check
      this.lastCheckState = {
        lastCheckStartedAt: Date.now(),
        lastCheckEndedAt: null,
        lastCheckStatus: UpdateCheckStatus.InProgress,
        lastCheckResult: UpdateCheckResult.None,
      };

      this.logger.info('Starting update check', 'UpdateManager', {
        silent,
        timestamp: this.lastCheckState.lastCheckStartedAt,
      });

      // 🔧 Step 1: Check and download Updater
      await this.ensureUpdaterReady();

      // 🔧 Step 2: Check for a version update
      this.currentPhase = UpdaterCheckPhase.CheckingVersion;
      this.sendToRenderer('checkPhaseChanged', { phase: 'checkingVersion' });

      if (this.useCdnUpdates && this.cdnUpdateChecker) {
        await this.checkCdnUpdates();
      } else {
        throw new Error(
          'CDN update mode is not enabled, please check CDN configuration',
        );
      }

      // Check succeeded — update state
      const endTime = Date.now();
      const startTime = this.lastCheckState.lastCheckStartedAt ?? endTime;

      this.lastCheckState = {
        ...this.lastCheckState,
        lastCheckEndedAt: endTime,
        lastCheckStatus: UpdateCheckStatus.Done,
        lastCheckResult: UpdateCheckResult.UpToDate, // default to up-to-date; checkCdnUpdates may override
      };

      this.logger.info('Update check completed', 'UpdateManager', {
        silent,
        duration: endTime - startTime,
        result: this.lastCheckState.lastCheckResult,
      });
    } catch (error) {
      // Check failed — update state
      this.lastCheckState = {
        ...this.lastCheckState,
        lastCheckEndedAt: Date.now(),
        lastCheckStatus: UpdateCheckStatus.Done,
        lastCheckResult: UpdateCheckResult.None,
      };

      this.logger.error('=== Update check failed ===', 'UpdateManager', {
        silent,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error),
      });
      throw error;
    } finally {
      this.isSilentCheck = false; // reset flag
      this.currentPhase = UpdaterCheckPhase.NotStarted;
    }
  }

  /**
   * Ensure the Updater executable is ready (includes version check).
   * Flow is handled by updaterFetcher.ensureUpdater():
   * 1. Check whether a local updater exists
   * 2. If not, download it directly
   * 3. If it exists, compare versions and update if the local version is older than remote
   */
  private async ensureUpdaterReady(): Promise<void> {
    this.logger.info('Checking Updater executable', 'UpdateManager');

    // Update phase state
    this.currentPhase = UpdaterCheckPhase.CheckingUpdater;
    this.sendToRenderer('checkPhaseChanged', { phase: 'checkingUpdater' });

    // Call updaterFetcher.ensureUpdater() for full version check and download
    const result = await this.updaterFetcher.ensureUpdater((progress) => {
      // If a download is in progress, update phase state
      if (this.currentPhase !== UpdaterCheckPhase.DownloadingUpdater) {
        this.currentPhase = UpdaterCheckPhase.DownloadingUpdater;
        this.sendToRenderer('checkPhaseChanged', {
          phase: 'downloadingUpdater',
        });
      }

      // Send download progress to the renderer
      this.sendToRenderer('updaterDownloadProgress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    if (!result.success) {
      const errorMessage = result.error || 'Failed to download updater';
      this.logger.error('Updater check/download failed', 'UpdateManager', {
        error: errorMessage,
      });

      // Notify renderer of updater download failure
      this.sendToRenderer('updaterDownloadFailed', { error: errorMessage });

      throw new Error(`Updater check/download failed: ${errorMessage}`);
    }

    this.logger.info('Updater is ready', 'UpdateManager', {
      updaterPath: result.updaterPath,
      downloaded: result.downloaded,
      version: result.version,
    });

    this.currentPhase = UpdaterCheckPhase.UpdaterReady;
    this.sendToRenderer('checkPhaseChanged', { phase: 'updaterReady' });
  }

  /**
   * Returns the current check state (for external queries).
   */
  public getLastCheckState(): LastCheckState {
    return { ...this.lastCheckState };
  }

  /**
   * CDN update check
   */
  private async checkCdnUpdates(): Promise<void> {
    if (!this.cdnUpdateChecker) {
      const error = new Error('CDN update checker not initialized');
      this.logger.error('CDN update checker not initialized', 'UpdateManager');
      throw error;
    }

    try {
      // Notify renderer that check is starting
      this.sendToRenderer('checkingForUpdate');

      // Run CDN update check
      const result = await this.cdnUpdateChecker.checkForUpdates();

      if (result.hasUpdate && result.updateInfo) {
        // Check whether this version is skipped
        if (this.preferences.skipVersions.includes(result.updateInfo.latest)) {
          // Update check result state
          this.lastCheckState.lastCheckResult = UpdateCheckResult.UpToDate;

          this.sendToRenderer('updateNotAvailable', {
            version: app.getVersion(),
            reason: 'skipped',
            platform: this.cdnUpdateChecker.getCurrentPlatformKey(),
          });
          return;
        }

        // Check whether the current platform is supported
        const isPlatformSupported = this.cdnUpdateChecker.isPlatformSupported(
          result.updateInfo,
        );
        const currentPlatform = this.cdnUpdateChecker.getCurrentPlatformKey();

        if (!isPlatformSupported) {
          this.logger.warn('Current platform does not support updates', 'UpdateManager', {
            platform: currentPlatform,
            availablePlatforms: Object.keys(
              result.updateInfo.downloadUrls || {},
            ),
          });
          this.sendToRenderer(
            'updateError',
            `Current platform ${currentPlatform} does not support automatic updates yet`,
          );
          return;
        }

        // Get download URL
        if (!result.downloadUrl) {
          const error = new Error('Unable to get download link');
          this.logger.error('Download URL is empty', 'UpdateManager');
          throw error;
        }

        // Verify that the download file exists
        const fileExists = await this.cdnUpdateChecker.verifyDownloadExists(
          result.downloadUrl,
        );

        if (!fileExists) {
          const error = new Error('Download file does not exist');
          this.logger.error('Download file verification failed', 'UpdateManager', {
            downloadUrl: result.downloadUrl,
          });
          throw error;
        }

        // 🚀 Simplified notification logic: check whether a local installer is already available
        const fileName = path.basename(result.downloadUrl);
        const expectedVersion = this.extractVersionFromFileName(fileName);
        const cacheStatus = await this.checkLocalCacheFile(
          result.downloadUrl,
          expectedVersion || '',
        );

        if (
          cacheStatus.exists &&
          cacheStatus.isCurrentVersion &&
          cacheStatus.filePath
        ) {
          // Local installer already available — notify user immediately

          // Verify the existing file
          const isValid = await this.verifyDownloadedFile(
            cacheStatus.filePath,
            result.downloadUrl,
          );
          if (isValid) {
            // Send updateDownloaded event directly to trigger notification
            this.sendToRenderer('updateDownloaded', {
              filePath: cacheStatus.filePath,
              downloadUrl: result.downloadUrl,
              fromCache: true,
              version: result.updateInfo.latest,
              releaseNotes: result.updateInfo.releaseNotes,
              releaseDate: result.updateInfo.releaseDate,
            });
            return; // 🔒 Ensure return here to avoid continuing into download logic
          } else {
            this.logger.warn(
              'Local installer verification failed, re-download required',
              'UpdateManager',
            );
            await this.cleanupFile(cacheStatus.filePath);
          }
        }

        // 🔍 No local installer or verification failed — start silent download

        try {
          // 🔽 Silent download, do not notify user (unless an error occurs)
          await this.downloadCdnUpdate(result.downloadUrl, result.updateInfo);
          // downloadCdnUpdate sends updateDownloaded event automatically on success
        } catch (downloadError) {
          this.logger.error(
            'Silent download failed, notifying user of available update',
            'UpdateManager',
            { downloadError },
          );

          // On download failure, notify the user so they can manually choose to download
          const updateData = {
            version: result.updateInfo.latest,
            releaseNotes: result.updateInfo.releaseNotes,
            releaseDate: result.updateInfo.releaseDate,
            files: (await this.cdnUpdateChecker.getFileInfo(result.downloadUrl))
              ? [await this.cdnUpdateChecker.getFileInfo(result.downloadUrl)]
              : [],
            downloadUrl: result.downloadUrl,
            platform: currentPlatform,
          };

          this.sendToRenderer('updateAvailable', updateData);
        }

        // Update check result state: new version found
        this.lastCheckState.lastCheckResult = UpdateCheckResult.NewVersionFound;
      } else {
        // Update check result state: already up to date
        this.lastCheckState.lastCheckResult = UpdateCheckResult.UpToDate;

        this.sendToRenderer('updateNotAvailable', {
          version: app.getVersion(),
          platform: this.cdnUpdateChecker.getCurrentPlatformKey(),
          latestVersion: result.updateInfo?.latest,
        });
      }
    } catch (error) {
      this.logger.error('=== CDN Update Check Failed ===', 'UpdateManager', {
        isSilentCheck: this.isSilentCheck,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
                code: (error as any).code,
              }
            : String(error),
      });

      // Only send error to renderer (showing a dialog) for non-silent checks
      if (!this.isSilentCheck) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.sendToRenderer('updateError', errorMessage);
      } else {
      }

      // Important: throw the error to ensure "no update available" logic is not executed
      throw error;
    }
  }

  public async downloadUpdate(
    downloadUrl?: string,
    updateInfo?: {
      latest: string;
      releaseNotes?: string;
      releaseDate?: string;
    },
  ): Promise<void> {
    try {
      if (downloadUrl) {
        await this.downloadCdnUpdate(downloadUrl, updateInfo);
      } else {
        throw new Error('Download URL not provided');
      }
    } catch (error) {
      this.logger.error('Failed to download update:', 'UpdateManager', { error });

      try {
        await this.errorHandler.handleUpdateError(
          error instanceof Error ? error : new Error(String(error)),
          'download',
          async () => {
            if (downloadUrl) {
              await this.downloadCdnUpdate(downloadUrl, updateInfo);
            }
          },
        );
      } catch (handledError) {
        throw handledError;
      }
    }
  }

  /**
   * Returns the installer cache directory path.
   * Uses app.getPath('userData')/assets/<prefix>-updates/
   */
  private getUpdatesCacheDir(): string {
    return path.join(
      app.getPath('userData'),
      'assets',
      `${this.filenamePrefix}-updates`,
    );
  }

  /**
   * Check the status of a local cache file.
   */
  private async checkLocalCacheFile(
    downloadUrl: string,
    expectedVersion: string,
  ): Promise<{
    exists: boolean;
    isCurrentVersion: boolean;
    filePath?: string;
    needsDownload: boolean;
  }> {
    try {
      const tempDir = this.getUpdatesCacheDir();
      const fileName = path.basename(downloadUrl);
      const filePath = path.join(tempDir, fileName);

      // Check whether the file exists
      if (!fs.existsSync(filePath)) {
        return {
          exists: false,
          isCurrentVersion: false,
          needsDownload: true,
        };
      }

      // Check whether the file is valid (non-empty, readable)
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        this.logger.warn('Local cache file is empty, re-download required', 'UpdateManager', {
          filePath,
        });
        await this.cleanupFile(filePath);
        return {
          exists: false,
          isCurrentVersion: false,
          needsDownload: true,
        };
      }

      // Parse version info from filename
      const fileVersion = this.extractVersionFromFileName(fileName);
      const isCurrentVersion = fileVersion === expectedVersion;

      return {
        exists: true,
        isCurrentVersion,
        filePath,
        needsDownload: !isCurrentVersion,
      };
    } catch (error) {
      this.logger.error('Failed to check local cache file', 'UpdateManager', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        exists: false,
        isCurrentVersion: false,
        needsDownload: true,
      };
    }
  }

  /**
   * Extract the version number from a filename.
   */
  private extractVersionFromFileName(fileName: string): string | null {
    try {
      // Filename format: <PREFIX>-<VERSION>-<ARCH>.<EXT>
      const prefix = this.filenamePrefix;

      if (!fileName.startsWith(prefix + '-')) {
        return null;
      }

      // Strip the prefix and its trailing separator
      const rest = fileName.slice(prefix.length + 1);

      // The version is assumed to be the first part after the prefix (e.g. 1.0.12)
      const parts = rest.split('-');
      if (parts.length > 0) {
        return parts[0];
      }
      return null;
    } catch (error) {
      this.logger.error('Failed to extract version from filename', 'UpdateManager', {
        fileName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Safely delete a file.
   */
  private async cleanupFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.info('File deleted', 'UpdateManager', { filePath });
      }
    } catch (error) {
      this.logger.error('Failed to delete file', 'UpdateManager', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up all installer files from older versions.
   * @param currentFileName The filename for the current version (this file is kept).
   */
  private async cleanupOldVersions(currentFileName: string): Promise<void> {
    try {
      const cacheDir = this.getUpdatesCacheDir();

      if (!fs.existsSync(cacheDir)) {
        return;
      }

      const files = fs.readdirSync(cacheDir);
      const platform = process.platform;

      // Determine installer extensions by platform
      const installPackageExtensions =
        platform === 'darwin'
          ? ['.dmg', '.zip']
          : platform === 'win32'
          ? ['.exe', '.zip']
          : ['.AppImage', '.deb', '.rpm', '.zip'];

      let cleanedCount = 0;

      for (const file of files) {
        // Skip the current version's file
        if (file === currentFileName) {
          continue;
        }

        // Only process installer files
        const ext = path.extname(file).toLowerCase();
        if (!installPackageExtensions.includes(ext)) {
          continue;
        }

        // Check whether it is a OpenKosmos installer file
        if (!file.startsWith(this.filenamePrefix + '-')) {
          continue;
        }

        const filePath = path.join(cacheDir, file);

        try {
          fs.unlinkSync(filePath);
          cleanedCount++;
          this.logger.info('Cleaned up old version file', 'UpdateManager', {
            file,
            filePath,
          });
        } catch (deleteError) {
          this.logger.warn('Failed to clean up old version file', 'UpdateManager', {
            file,
            error:
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError),
          });
        }
      }

      if (cleanedCount > 0) {
        this.logger.info('Old version cleanup completed', 'UpdateManager', {
          cleanedCount,
          currentFileName,
          cacheDir,
        });
      }
    } catch (error) {
      this.logger.error('Failed to clean up old versions', 'UpdateManager', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * CDN download update (optimized version)
   */
  private async downloadCdnUpdate(
    downloadUrl: string,
    updateInfo?: {
      latest: string;
      releaseNotes?: string;
      releaseDate?: string;
    },
  ): Promise<void> {
    try {
      // Get the cache directory path
      const cacheDir = this.getUpdatesCacheDir();
      const fileName = path.basename(downloadUrl);
      const filePath = path.join(cacheDir, fileName);

      // Ensure the cache directory exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Infer the expected version from the download URL
      const expectedVersion = this.extractVersionFromFileName(fileName);

      // Check local cache file status
      const cacheStatus = await this.checkLocalCacheFile(
        downloadUrl,
        expectedVersion || '',
      );

      if (
        cacheStatus.exists &&
        cacheStatus.isCurrentVersion &&
        cacheStatus.filePath
      ) {
        // File already exists and is the current version — no re-download needed

        // Verify the existing file
        const isValid = await this.verifyDownloadedFile(
          cacheStatus.filePath,
          downloadUrl,
        );
        if (!isValid) {
          this.logger.warn('Local file verification failed, re-downloading', 'UpdateManager');
          await this.cleanupFile(cacheStatus.filePath);
        } else {
          // Notify renderer that download is complete
          this.sendToRenderer('updateDownloaded', {
            filePath: cacheStatus.filePath,
            downloadUrl,
            fromCache: true,
            version:
              updateInfo?.latest ||
              this.extractVersionFromFileName(path.basename(downloadUrl)),
            releaseNotes: updateInfo?.releaseNotes,
            releaseDate: updateInfo?.releaseDate,
          });
          return;
        }
      }
      // Note: the previous `else if (cacheStatus.exists && !cacheStatus.isCurrentVersion)` branch has been removed.
      // checkLocalCacheFile only checks the file corresponding to the current download URL,
      // so "exists but version differs" cannot occur here.
      // Actual stale-version cleanup is handled by cleanupOldVersions() below.

      // 🧹 Clean up all stale installer files (before downloading, to free space)
      await this.cleanupOldVersions(fileName);

      // Start download
      await this.downloadFile(downloadUrl, filePath);

      // Verify the file
      const isValid = await this.verifyDownloadedFile(filePath, downloadUrl);
      if (!isValid) {
        throw new Error('Downloaded file verification failed');
      }

      // Notify renderer that download is complete
      this.sendToRenderer('updateDownloaded', {
        filePath,
        downloadUrl,
        fromCache: false,
        version:
          updateInfo?.latest ||
          this.extractVersionFromFileName(path.basename(downloadUrl)),
        releaseNotes: updateInfo?.releaseNotes,
        releaseDate: updateInfo?.releaseDate,
      });
    } catch (error) {
      this.logger.error('CDN download failed', 'UpdateManager', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Download a file and report progress.
   */
  private async downloadFile(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const request = httpModule.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
          );
          return;
        }

        const totalSize = parseInt(
          response.headers['content-length'] || '0',
          10,
        );
        let downloadedSize = 0;
        let lastProgressTime = Date.now();

        // Create write stream
        const fileStream = fs.createWriteStream(filePath);

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          fileStream.write(chunk);

          // Throttle progress updates (at most once per 100 ms)
          const now = Date.now();
          if (now - lastProgressTime > 100) {
            const percent =
              totalSize > 0
                ? Math.round((downloadedSize / totalSize) * 100)
                : 0;
            const transferred = this.formatBytes(downloadedSize);
            const total = this.formatBytes(totalSize);
            const speed = this.calculateSpeed(
              downloadedSize,
              now - lastProgressTime,
            );

            this.sendToRenderer('downloadProgress', {
              percent,
              transferred,
              total,
              bytesPerSecond: speed,
            });

            lastProgressTime = now;
          }
        });

        response.on('end', () => {
          fileStream.end();

          // Send final progress
          this.sendToRenderer('downloadProgress', {
            percent: 100,
            transferred: this.formatBytes(downloadedSize),
            total: this.formatBytes(totalSize),
            bytesPerSecond: '0 B/s',
          });

          resolve();
        });

        response.on('error', (error) => {
          fileStream.destroy();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(error);
        });
      });

      request.on('error', (error) => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(error);
      });

      request.setTimeout(300000, () => {
        // 5-minute timeout
        request.destroy();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Verify a downloaded file.
   */
  private async verifyDownloadedFile(
    filePath: string,
    downloadUrl: string,
  ): Promise<boolean> {
    try {
      // Check whether the file exists
      if (!fs.existsSync(filePath)) {
        this.logger.error('Downloaded file does not exist', 'UpdateManager', { filePath });
        return false;
      }

      // Get file stats
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        this.logger.error('Downloaded file is empty', 'UpdateManager', {
          filePath,
          size: stats.size,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('File verification failed', 'UpdateManager', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Calculate download speed.
   */
  private calculateSpeed(bytesDownloaded: number, timeElapsed: number): string {
    if (timeElapsed === 0) return '0 B/s';
    const bytesPerSecond = (bytesDownloaded * 1000) / timeElapsed;
    return this.formatBytes(bytesPerSecond) + '/s';
  }

  public quitAndInstall(filePath?: string): void {
    try {
      if (!filePath) {
        throw new Error('Installation package file path not provided');
      }

      // Check whether it is a zip file
      const isZip = path.extname(filePath).toLowerCase() === '.zip';

      this.logger.info('Preparing to install update', 'UpdateManager', {
        filePath,
        isZip,
        fileExtension: path.extname(filePath),
      });

      if (isZip) {
        // Use the updater executable for silent update
        this.silentUpdate(filePath);
      } else {
        // Fall back to traditional installation (dmg/exe)
        this.installUpdate(filePath);
      }
    } catch (error) {
      this.logger.error('Failed to install update:', 'UpdateManager', { error });

      // Synchronously send error to renderer
      this.sendToRenderer(
        'updateError',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Silent update: use the updater executable to unzip the ZIP and replace the app.
   *
   * ============================================================================
   * ZIP Update Flow
   * ============================================================================
   *
   * 1. Download the ZIP update package to userData/assets/<prefix>-updates/
   * 2. Launch the updater executable (from userData/assets/updater/)
   * 3. The updater receives two arguments:
   *    - zipPath: path to the ZIP file
   *    - installPath: installation directory path (returned by getAppInstallPath())
   * 4. The updater extracts the ZIP to installPath, overwriting existing files
   * 5. The main app exits; the updater restarts the app after completion
   *
   * ============================================================================
   * Install Path (installPath) Notes
   * ============================================================================
   *
   * macOS:
   *   /Applications/<productName>.app
   *   e.g. /Applications/OpenKosmos.app
   *
   * Windows:
   *   %LOCALAPPDATA%\Programs\<brandName>
   *   e.g. C:\Users\xxx\AppData\Local\Programs\kosmos
   *
   * ⚠️ Note: Windows uses brandName instead of productName to avoid path spaces.
   *
   */
  private silentUpdate(zipPath: string): void {
    try {
      const platform = process.platform;
      const arch = process.arch;

      // Get the updater executable path
      const updaterName =
        platform === 'win32'
          ? `updater-win-${arch}.exe`
          : `updater-mac-${arch}`;

      // The updater is stored in userData/assets/updater/
      // Example paths:
      //   Windows: C:\Users\xxx\AppData\Roaming\open-kosmos-app\assets\updater\updater-win-x64.exe
      //   macOS:   ~/Library/Application Support/open-kosmos-app/assets/updater/updater-mac-arm64
      const updaterDir = path.join(
        app.getPath('userData'),
        'assets',
        'updater',
      );
      const updaterPath = path.join(updaterDir, updaterName);

      this.logger.info('Silent update configuration', 'UpdateManager', {
        platform,
        arch,
        updaterName,
        updaterPath,
        zipPath,
      });

      // Check whether the updater exists
      if (!fs.existsSync(updaterPath)) {
        const error = new Error(`Updater not found: ${updaterPath}`);
        this.logger.error('Updater executable not found', 'UpdateManager', {
          updaterPath,
        });
        throw error;
      }

      // Get the app installation path (see getAppInstallPath() for details)
      const installPath = this.getAppInstallPath();

      this.logger.info('Launching silent update', 'UpdateManager', {
        updater: updaterPath,
        zipPath,
        installPath,
      });

      // Launch the updater executable
      const updaterProcess = spawn(updaterPath, [zipPath, installPath], {
        detached: true,
        stdio: 'ignore',
      });

      updaterProcess.unref();

      // Notify user that the update is about to begin
      this.sendToRenderer('updateInstalling', {
        message: 'Application will restart to complete the update...',
      });

      this.logger.info('Updater launched, preparing to exit main app', 'UpdateManager');

      // Wait briefly to ensure the updater started successfully, then quit
      setTimeout(() => {
        this.logger.info(
          'Exiting main app, handing over to updater',
          'UpdateManager',
        );
        app.quit();
      }, 1000);
    } catch (error) {
      this.logger.error('Silent update failed', 'UpdateManager', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Returns the app installation path (used for ZIP silent updates).
   *
   * ============================================================================
   * Path Rules (see electron-builder.config.js)
   * ============================================================================
   *
   * macOS:
   *   Install path: /Applications/<productName>.app
   *   Example:      /Applications/OpenKosmos.app
   *
   * Windows:
   *   Install path: %LOCALAPPDATA%\Programs\<brandName>
   *   Example:      C:\Users\xxx\AppData\Local\Programs\kosmos
   *   Notes:
   *     - The install directory name is determined by extraMetadata.name (i.e. BRAND_NAME)
   *     - Uses brandName instead of productName to avoid spaces in the path
   *
   * ⚠️ Important: Do NOT use productName for the Windows path!
   *    productName may contain spaces, which would break path parsing in update scripts.
   *
   * ============================================================================
   */
  private getAppInstallPath(): string {
    const productName = BRAND_CONFIG.productName || 'OpenKosmos';

    if (process.platform === 'darwin') {
      // macOS: /Applications/<productName>.app
      return `/Applications/${productName}.app`;
    } else if (process.platform === 'win32') {
      // Windows: %LOCALAPPDATA%\Programs\<brandName>
      // Use BRAND_NAME, not productName, to avoid spaces in path.
      // This matches the extraMetadata.name field in electron-builder.config.js
      const localAppData =
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

      // BRAND_NAME is injected by webpack at build time (e.g. "kosmos")
      const brandName = BRAND_NAME || 'kosmos';
      return path.join(localAppData, 'Programs', brandName);
    }
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  /**
   * Install an update package: handles all platforms uniformly.
   * Flow: open the installer, then close the app; restart is handled by the user.
   */
  private installUpdate(filePath: string): void {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(
          `Installation package file does not exist: ${filePath}`,
        );
      }

      // Check file permissions
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch (accessError) {
        throw new Error(
          `Installation package file cannot be accessed: ${filePath}`,
        );
      }

      // Launch using the appropriate method for the platform
      if (process.platform === 'darwin') {
        // macOS: launch the DMG file using the open command
        const openProcess = spawn('open', [filePath], {
          detached: true,
          stdio: 'ignore',
        });

        openProcess.on('error', (error: Error) => {
          this.logger.error('macOS open command failed', 'UpdateManager', {
            error,
            filePath,
          });
          this.sendToRenderer(
            'updateError',
            `Unable to open installer: ${error.message}`,
          );
          return;
        });

        openProcess.on('spawn', () => {
          setTimeout(() => {
            app.quit();
          }, 1000);
        });
      } else if (process.platform === 'win32') {
        // Windows: execute the EXE file directly
        const installProcess = spawn(filePath, [], {
          detached: true,
          stdio: 'ignore',
        });

        installProcess.on('error', (error: Error) => {
          this.logger.error('Windows installer failed to launch', 'UpdateManager', {
            error,
            filePath,
          });
          this.sendToRenderer(
            'updateError',
            `Unable to start installer: ${error.message}`,
          );
          return;
        });

        installProcess.on('spawn', () => {
          setTimeout(() => {
            app.quit();
          }, 1000);
        });
      } else {
        // Linux: use shell.openPath as a fallback
        shell
          .openPath(filePath)
          .then(() => {
            setTimeout(() => {
              app.quit();
            }, 1000);
          })
          .catch((error) => {
            this.logger.error('Linux failed to open installer', 'UpdateManager', {
              error,
              filePath,
            });
            this.sendToRenderer(
              'updateError',
              `Unable to open installer: ${error.message}`,
            );
          });
      }
    } catch (error) {
      this.logger.error('Failed to install update package', 'UpdateManager', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendToRenderer(
        'updateError',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  public skipVersion(version: string): void {
    if (!this.preferences.skipVersions.includes(version)) {
      this.preferences.skipVersions.push(version);
      this.savePreferences();
    }
  }

  // Periodic check
  public startPeriodicCheck(intervalMinutes: number = 360): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }

    // Periodic check logic: attempt an update check every fixed interval
    const checkInterval = 60 * 60 * 1000; // check once per hour whether an update check should run

    this.updateCheckInterval = setInterval(() => {
      if (!this.preferences.autoUpdateEnabled) {
        return;
      }

      // Check whether a check is already in progress
      if (
        this.lastCheckState.lastCheckStatus === UpdateCheckStatus.InProgress
      ) {
        this.logger.debug('Update check in progress, skipping periodic check', 'UpdateManager');
        return;
      }

      // Check whether enough time has elapsed since the last check
      const now = Date.now();
      const lastCheckTime = this.lastCheckState.lastCheckStartedAt ?? 0;
      const minutesSinceLastCheck = (now - lastCheckTime) / (60 * 1000);

      if (minutesSinceLastCheck >= intervalMinutes) {
        this.logger.info('Triggering periodic auto update check', 'UpdateManager', {
          minutesSinceLastCheck: minutesSinceLastCheck.toFixed(2),
          intervalMinutes,
        });

        // Silently check for app updates
        this.checkForUpdates(true).catch((error) => {
          this.logger.error('Periodic auto check failed', 'UpdateManager', { error });
        });

        // 🆕 Also trigger assets library check (agent_lib, mcp_lib, skills_lib)
        this.checkAssetsLibraries().catch((error) => {
          this.logger.error('Periodic assets library check failed', 'UpdateManager', {
            error,
          });
        });
      }
    }, checkInterval);

    this.logger.info('Periodic update checker started', 'UpdateManager', {
      intervalMinutes,
      checkIntervalSeconds: checkInterval / 1000,
    });

    // Update checks are triggered automatically by the backend — no frontend dependency
  }

  /**
   * 🆕 Check remote assets libraries (agent_lib.json, mcp_lib.json, skills_lib.json)
   * and update the remoteVersion field in the user profile.
   */
  private async checkAssetsLibraries(): Promise<void> {
    try {
      this.logger.info('Starting remote assets library check', 'UpdateManager');

      // Dynamic import of AssetsLibraryManager to avoid circular dependencies

      // Execute check and update
      const result = await assetsLibraryManager.checkAndUpdateLibraries();

      // Log results
      const successCount = result.fetchResults.filter((r) => r.success).length;
      this.logger.info('Assets library check completed', 'UpdateManager', {
        totalLibraries: result.fetchResults.length,
        successCount,
        updateResult: result.updateResult
          ? {
              updatedAgents: result.updateResult.updatedAgents,
              updatedMcpServers: result.updateResult.updatedMcpServers,
              updatedSkills: result.updateResult.updatedSkills,
              errors: result.updateResult.errors.length,
            }
          : 'no profile update',
      });
    } catch (error) {
      this.logger.error('Assets library check failed', 'UpdateManager', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public stopPeriodicCheck(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  // Preference management
  public updatePreferences(newPreferences: Partial<UpdatePreferences>): void {
    this.preferences = { ...this.preferences, ...newPreferences };
    this.savePreferences();
  }

  public getPreferences(): UpdatePreferences {
    return { ...this.preferences };
  }

  // Utility methods
  private sendToRenderer(channel: string, data?: any): void {
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`update:${channel}`, data);
      this.logger.debug('Sending IPC message to renderer', 'UpdateManager', {
        channel: `update:${channel}`,
        hasData: !!data,
        windowExists: true,
      });
    } else {
      this.logger.warn('Cannot send IPC message: window does not exist or is destroyed', 'UpdateManager', {
        channel: `update:${channel}`,
        windowExists: !!mainWindow,
        isDestroyed: mainWindow ? mainWindow.isDestroyed() : 'window is null',
      });
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private loadPreferences(): UpdatePreferences {
    const defaultPreferences: UpdatePreferences = {
      autoUpdateEnabled: true,
      skipVersions: [],
    };

    try {
      const prefsPath = path.join(
        app.getPath('userData'),
        'update-preferences.json',
      );
      if (fs.existsSync(prefsPath)) {
        const saved = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        return { ...defaultPreferences, ...saved };
      }
    } catch (error) {
      this.logger.warn('Failed to load update preferences, using defaults:', 'UpdateManager', {
        error,
      });
    }

    return defaultPreferences;
  }

  private savePreferences(): void {
    try {
      const prefsPath = path.join(
        app.getPath('userData'),
        'update-preferences.json',
      );
      fs.writeFileSync(prefsPath, JSON.stringify(this.preferences, null, 2));
    } catch (error) {
      this.logger.error('Failed to save update preferences:', 'UpdateManager', { error });
    }
  }

  // Clean up resources
  public destroy(): void {
    this.stopPeriodicCheck();
  }
}

// Error handler class
export class UpdateErrorHandler {
  private maxRetries = 3;
  private retryDelay = 5000; // 5 seconds
  private logger = createLogger();
  private fallbackSources: string[] = [];
  private currentRetryCount = 0;

  constructor() {
    // Configure fallback update sources
    this.setupFallbackSources();
  }

  private setupFallbackSources(): void {
    // Configure fallback update sources (used if the primary source fails)
    this.fallbackSources = [
      // Additional GitHub mirrors or other fallback sources can be added here
    ];
  }

  async handleUpdateError(error: Error, context: string, retryFunction?: () => Promise<void>): Promise<void> {
    this.logger.error(`Update failed [${context}]:`, 'UpdateErrorHandler', {
      error: error.message,
      retryCount: this.currentRetryCount
    });

    switch (context) {
      case 'check':
        await this.handleCheckError(error, retryFunction);
        break;
      case 'download':
        await this.handleDownloadError(error, retryFunction);
        break;
      case 'install':
        await this.handleInstallError(error, retryFunction);
        break;
      case 'verification':
        await this.handleVerificationError(error, retryFunction);
        break;
      default:
        await this.handleGenericError(error, retryFunction);
        break;
    }
  }

  private async handleCheckError(error: Error, retryFunction?: () => Promise<void>): Promise<void> {
    // Network connectivity issues
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      this.logger.warn('Network connectivity issue, will retry later', 'UpdateErrorHandler');

      if (retryFunction && this.currentRetryCount < this.maxRetries) {
        await this.performRetry(retryFunction);
      }
    }

    // SSL/TLS certificate issues
    if (error.message.includes('CERT_') || error.message.includes('SSL')) {
      this.logger.error('SSL/TLS certificate verification failed', 'UpdateErrorHandler', {
        error: error.message
      });
      // Do not retry certificate errors — this may be a security issue
      throw new Error('Update source certificate verification failed, stopping update for security reasons');
    }
  }

  private async handleDownloadError(error: Error, retryFunction?: () => Promise<void>): Promise<void> {
    // Insufficient disk space
    if (error.message.includes('ENOSPC')) {
      this.logger.error('Insufficient disk space', 'UpdateErrorHandler');
      throw new Error('Insufficient disk space, unable to download update');
    }

    // Network interrupted or connection timed out
    if (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNRESET')) {
      this.logger.warn('Network connection interrupted, preparing to retry download', 'UpdateErrorHandler');

      if (retryFunction && this.currentRetryCount < this.maxRetries) {
        await this.performRetry(retryFunction);
      } else {
        throw new Error(`Download failed after ${this.maxRetries} retries`);
      }
    }

    // Generic download error retry
    if (retryFunction && this.currentRetryCount < this.maxRetries) {
      await this.performRetry(retryFunction);
    } else {
      throw new Error(`Download failed after ${this.maxRetries} retries: ${error.message}`);
    }
  }

  private async handleInstallError(error: Error, retryFunction?: () => Promise<void>): Promise<void> {
    // Permission issues
    if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
      this.logger.error('Insufficient installation permissions', 'UpdateErrorHandler');
      throw new Error('Insufficient installation permissions, please run the application as administrator');
    }

    // Insufficient disk space
    if (error.message.includes('ENOSPC')) {
      this.logger.error('Insufficient disk space', 'UpdateErrorHandler');
      throw new Error('Insufficient disk space, unable to install update');
    }

    // File is in use
    if (error.message.includes('EBUSY') || error.message.includes('EPERM')) {
      this.logger.warn('File is in use, recommend closing the app before retrying', 'UpdateErrorHandler');
      throw new Error('File is in use, please close all application instances and try again');
    }

    // Other installation errors
    this.logger.error('Installation failed:', 'UpdateErrorHandler', { error: error.message });
    throw new Error(`Installation failed: ${error.message}`);
  }

  private async handleVerificationError(error: Error, retryFunction?: () => Promise<void>): Promise<void> {
    this.logger.warn('Update package verification failed', 'UpdateErrorHandler', { error: error.message });

    // Verification failure may indicate a corrupt file — attempt to re-download
    if (retryFunction && this.currentRetryCount < this.maxRetries) {
      await this.performRetry(retryFunction);
    } else {
      throw new Error('Update package verification failed, attempted to re-download');
    }
  }

  private async handleGenericError(error: Error, retryFunction?: () => Promise<void>): Promise<void> {
    this.logger.error('Generic update error:', 'UpdateErrorHandler', { error: error.message });

    if (retryFunction && this.currentRetryCount < this.maxRetries) {
      await this.performRetry(retryFunction);
    } else {
      throw error;
    }
  }

  private async performRetry(retryFunction: () => Promise<void>): Promise<void> {
    this.currentRetryCount++;
    const delay = this.retryDelay * this.currentRetryCount;


    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await retryFunction();
      this.currentRetryCount = 0; // reset counter on success
    } catch (retryError) {
      if (this.currentRetryCount >= this.maxRetries) {
        throw new Error(`Retry failed, maximum retry count ${this.maxRetries} reached`);
      }
      throw retryError;
    }
  }


  public async performRollback(previousVersion?: string): Promise<void> {
    try {

      // Actual rollback logic should be implemented based on specific requirements.
      // This may include:
      // 1. Restoring backed-up configuration files
      // 2. Re-installing the previous version
      // 3. Restoring user data

      if (previousVersion) {
      }

      // This is a simplified implementation.
      // In a real scenario, it may be necessary to re-download and install a specific version.

      this.logger.warn('Version rollback requires manual handling', 'UpdateErrorHandler');

    } catch (error) {
      this.logger.error('Version rollback failed:', 'UpdateErrorHandler', { error });
      throw new Error(`Version rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public resetRetryCount(): void {
    this.currentRetryCount = 0;
  }

  public getRetryCount(): number {
    return this.currentRetryCount;
  }

  public setMaxRetries(maxRetries: number): void {
    this.maxRetries = Math.max(1, Math.min(10, maxRetries)); // clamp to 1–10
  }
}