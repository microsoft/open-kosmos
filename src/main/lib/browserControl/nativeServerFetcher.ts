import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { appendCacheBustingTimestamp } from '../utils/urlUtils';

export interface NativeServerInfo {
  latest: string; // Remote latest version number
  downloadUrls: {
    [platformKey: string]: string; // Format: "darwin-arm64" -> "chromium-mcp-native-server-1.0.0.zip"
  };
}

export interface AppConfig {
  nativeServerVersion?: string; // Local native-server version number
  [key: string]: any; // Allow other fields
}

export interface NativeServerCheckResult {
  exists: boolean;
  nativeServerDir: string;
  needsDownload: boolean;
  localVersion?: string; // Local version number
}

export interface NativeServerFetchProgress {
  percent: number;
  transferred: string;
  total: string;
}

/**
 * NativeServerFetcher - Responsible for checking and downloading the native-server program
 * Ensures a correct native-server program exists locally when Chrome Extension is enabled
 */
export class NativeServerFetcher {
  private logger = createLogger();
  private baseUrl: string;

  constructor() {
    // Get base CDN URL based on environment
    const isDevelopment = process.env.NODE_ENV === 'development';
    this.baseUrl = isDevelopment
      ? process.env.DEVELOPMENT_BASE_CDN_URL || ''
      : process.env.PRODUCTION_BASE_CDN_URL || '';
    
    this.logger.info('NativeServerFetcher initialized', 'NativeServerFetcher', {
      isDevelopment,
      baseUrl: this.baseUrl
    });
  }

  /**
   * Get current platform identifier
   */
  private getCurrentPlatformKey(): string {
    const platform = process.platform;
    const arch = process.arch;
    return `${platform}-${arch}`;
  }

  /**
   * Get local storage directory for native-server
   * Uses app.getPath('userData')/assets/native-server/
   */
  private getNativeServerDir(): string {
    return path.join(app.getPath('userData'), 'assets', 'native-server');
  }

  /**
   * Get app.json config file path
   */
  private getAppConfigPath(): string {
    return path.join(app.getPath('userData'), 'app.json');
  }

  /**
   * Read app.json config
   */
  private readAppConfig(): AppConfig {
    try {
      const configPath = this.getAppConfigPath();
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      this.logger.warn('Failed to read app.json', 'NativeServerFetcher', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return {};
  }

  /**
   * Write app.json config
   */
  private writeAppConfig(config: AppConfig): void {
    try {
      const configPath = this.getAppConfigPath();
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      this.logger.info('app.json configuration updated', 'NativeServerFetcher', { configPath });
    } catch (error) {
      this.logger.error('Failed to write app.json', 'NativeServerFetcher', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get local native-server version number
   * Read from the nativeServerVersion field in app.json
   * Returns "0.0.0" if app.json or the field does not exist
   */
  public getLocalNativeServerVersion(): string {
    const config = this.readAppConfig();
    return config.nativeServerVersion || '0.0.0';
  }

  /**
   * Update local native-server version number
   * Write to the nativeServerVersion field in app.json
   */
  public setLocalNativeServerVersion(version: string): void {
    const config = this.readAppConfig();
    config.nativeServerVersion = version;
    this.writeAppConfig(config);
    this.logger.info('Local native-server version updated', 'NativeServerFetcher', { version });
  }

  /**
   * Compare version numbers
   * Returns: -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    const maxLen = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLen; i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      
      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }
    
    return 0;
  }

  /**
   * Check if native-server exists locally
   * Check if directory exists and contains package.json
   */
  public checkLocalNativeServer(): NativeServerCheckResult {
    const nativeServerDir = this.getNativeServerDir();
    const localVersion = this.getLocalNativeServerVersion();
    const packageJsonPath = path.join(nativeServerDir, 'package.json');
    
    this.logger.info('Checking local native-server', 'NativeServerFetcher', { nativeServerDir, localVersion });
    
    try {
      if (fs.existsSync(nativeServerDir) && fs.existsSync(packageJsonPath)) {
        // Check if package.json is valid
        const stats = fs.statSync(packageJsonPath);
        if (stats.size > 0) {
          this.logger.info('Local native-server exists and is valid', 'NativeServerFetcher', {
            nativeServerDir,
            localVersion
          });
          return {
            exists: true,
            nativeServerDir,
            needsDownload: false,
            localVersion
          };
        } else {
          this.logger.warn('Local native-server package.json is empty, re-download required', 'NativeServerFetcher', { nativeServerDir });
        }
      }
      
      this.logger.info('Local native-server does not exist, download required', 'NativeServerFetcher', { nativeServerDir });
      return {
        exists: false,
        nativeServerDir,
        needsDownload: true,
        localVersion
      };
    } catch (error) {
      this.logger.error('Failed to check local native-server', 'NativeServerFetcher', {
        nativeServerDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        exists: false,
        nativeServerDir,
        needsDownload: true,
        localVersion
      };
    }
  }

  /**
   * Fetch latest.json from CDN
   */
  private async fetchNativeServerInfo(): Promise<NativeServerInfo | null> {
    // Add timestamp to bypass CDN cache
    const latestJsonUrl = appendCacheBustingTimestamp(`${this.baseUrl}/tools/chrome-mcp-native-server/latest.json`);
    
    this.logger.info('Fetching latest.json', 'NativeServerFetcher', { latestJsonUrl });
    
    try {
      const response = await this.httpGet(latestJsonUrl);
      const nativeServerInfo: NativeServerInfo = JSON.parse(response);
      
      this.logger.info('Successfully fetched latest.json', 'NativeServerFetcher', {
        latestVersion: nativeServerInfo.latest,
        downloadUrls: nativeServerInfo.downloadUrls
      });
      
      return nativeServerInfo;
    } catch (error) {
      this.logger.error('Failed to fetch latest.json', 'NativeServerFetcher', {
        url: latestJsonUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get remote latest version number
   */
  public async getRemoteNativeServerVersion(): Promise<string | null> {
    const nativeServerInfo = await this.fetchNativeServerInfo();
    if (nativeServerInfo && nativeServerInfo.latest) {
      return nativeServerInfo.latest;
    }
    return null;
  }

  /**
   * Check if native-server needs to be updated
   * Compare local version with remote version
   */
  public async checkNativeServerNeedsUpdate(): Promise<{
    needsUpdate: boolean;
    localVersion: string;
    remoteVersion: string | null;
  }> {
    const localVersion = this.getLocalNativeServerVersion();
    const remoteVersion = await this.getRemoteNativeServerVersion();
    
    if (!remoteVersion) {
      this.logger.warn('Unable to fetch remote version number', 'NativeServerFetcher');
      return {
        needsUpdate: false,
        localVersion,
        remoteVersion: null
      };
    }
    
    const comparison = this.compareVersions(localVersion, remoteVersion);
    const needsUpdate = comparison < 0;
    
    this.logger.info('Version comparison result', 'NativeServerFetcher', {
      localVersion,
      remoteVersion,
      needsUpdate
    });
    
    return {
      needsUpdate,
      localVersion,
      remoteVersion
    };
  }

  /**
   * Download and extract native-server
   */
  public async downloadNativeServer(
    onProgress?: (progress: NativeServerFetchProgress) => void,
    onPhaseChange?: (phase: string) => void
  ): Promise<{ success: boolean; nativeServerDir?: string; error?: string; version?: string }> {
    try {
      // 1. Fetch latest.json
      const nativeServerInfo = await this.fetchNativeServerInfo();
      if (!nativeServerInfo) {
        return { success: false, error: 'Failed to fetch latest.json' };
      }

      // 2. Get download filename for current platform
      const platformKey = this.getCurrentPlatformKey();
      const fileName = nativeServerInfo.downloadUrls[platformKey];
      if (!fileName) {
        return { success: false, error: `Unsupported platform: ${platformKey}` };
      }

      // 3. Build download URL
      const downloadUrl = `${this.baseUrl}/tools/chrome-mcp-native-server/${fileName}`;
      const nativeServerDir = this.getNativeServerDir();
      const tempZipPath = path.join(app.getPath('temp'), `native-server-${Date.now()}.zip`);

      this.logger.info('Starting native-server download', 'NativeServerFetcher', {
        downloadUrl,
        nativeServerDir,
        tempZipPath,
        version: nativeServerInfo.latest
      });

      // 4. Ensure directory exists
      const assetsDir = path.dirname(nativeServerDir);
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
        this.logger.info('Creating assets directory', 'NativeServerFetcher', { assetsDir });
      }

      // 5. Download zip file
      onPhaseChange?.('downloading');
      await this.downloadFile(downloadUrl, tempZipPath, onProgress);

      // 6. Clean up old native-server directory (if exists)
      if (fs.existsSync(nativeServerDir)) {
        this.logger.info('Cleaning up old native-server directory', 'NativeServerFetcher', { nativeServerDir });
        fs.rmSync(nativeServerDir, { recursive: true, force: true });
      }

      // 7. Extract zip file to target directory
      onPhaseChange?.('extracting');
      this.logger.info('Extracting native-server zip', 'NativeServerFetcher', { tempZipPath, nativeServerDir });
      await this.extractZip(tempZipPath, nativeServerDir, onProgress);

      // 8. Clean up temporary zip file
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
        this.logger.info('Cleaning up temporary zip file', 'NativeServerFetcher', { tempZipPath });
      }

      // 9. Update local version number in app.json
      this.setLocalNativeServerVersion(nativeServerInfo.latest);

      this.logger.info('native-server download completed', 'NativeServerFetcher', {
        nativeServerDir,
        version: nativeServerInfo.latest
      });
      return { success: true, nativeServerDir, version: nativeServerInfo.latest };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to download native-server', 'NativeServerFetcher', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Ensure native-server exists and is the latest version
   * Complete flow:
   * 1. Check if local native-server program exists
   * 2. If not, download directly, then update nativeServerVersion in app.json
   * 3. If yes, compare local version with remote version
   * 4. If local version < remote version, download latest version to overwrite local, update app.json
   */
  public async ensureNativeServer(
    onProgress?: (progress: NativeServerFetchProgress) => void,
    onPhaseChange?: (phase: string) => void
  ): Promise<{ success: boolean; nativeServerDir?: string; error?: string; downloaded: boolean; version?: string }> {
    // 1. Check if local native-server exists
    const checkResult = this.checkLocalNativeServer();
    
    if (!checkResult.exists) {
      // Local native-server does not exist, download directly
      this.logger.info('Local native-server does not exist, starting download', 'NativeServerFetcher');
      const downloadResult = await this.downloadNativeServer(onProgress, onPhaseChange);
      
      return {
        success: downloadResult.success,
        nativeServerDir: downloadResult.nativeServerDir,
        error: downloadResult.error,
        downloaded: downloadResult.success,
        version: downloadResult.version
      };
    }

    // 2. Local native-server exists, check if it needs updating
    this.logger.info('Local native-server exists, checking version', 'NativeServerFetcher', {
      nativeServerDir: checkResult.nativeServerDir,
      localVersion: checkResult.localVersion
    });
    
    const versionCheck = await this.checkNativeServerNeedsUpdate();
    
    if (!versionCheck.needsUpdate) {
      // Local version is already up to date, no download needed
      this.logger.info('Local native-server version is up to date, no download needed', 'NativeServerFetcher', {
        nativeServerDir: checkResult.nativeServerDir,
        localVersion: versionCheck.localVersion,
        remoteVersion: versionCheck.remoteVersion
      });
      return {
        success: true,
        nativeServerDir: checkResult.nativeServerDir,
        downloaded: false,
        version: versionCheck.localVersion
      };
    }

    // 3. Local version is older than remote version, need to download update
    this.logger.info('Local native-server version is outdated, starting update', 'NativeServerFetcher', {
      localVersion: versionCheck.localVersion,
      remoteVersion: versionCheck.remoteVersion
    });
    
    const downloadResult = await this.downloadNativeServer(onProgress, onPhaseChange);
    
    return {
      success: downloadResult.success,
      nativeServerDir: downloadResult.nativeServerDir,
      error: downloadResult.error,
      downloaded: downloadResult.success,
      version: downloadResult.version
    };
  }

  /**
   * Extract zip file (with progress callback)
   * Uses existing node-stream-zip dependency
   */
  private async extractZip(
    zipPath: string, 
    destDir: string,
    onProgress?: (progress: NativeServerFetchProgress) => void
  ): Promise<void> {
    try {
      const StreamZip = require('node-stream-zip');
      
      // Ensure target directory exists
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      const zip = new StreamZip.async({ file: zipPath });
      
      try {
        // Get all entries
        const entries = await zip.entries();
        const entryList = Object.values(entries) as any[];
        const totalFiles = entryList.filter((e: any) => !e.isDirectory).length;
        let extractedFiles = 0;

        // Extract files one by one
        for (const entry of entryList) {
          if (!entry.isDirectory) {
            const destPath = path.join(destDir, entry.name);
            // Ensure parent directory exists
            const parentDir = path.dirname(destPath);
            if (!fs.existsSync(parentDir)) {
              fs.mkdirSync(parentDir, { recursive: true });
            }
            await zip.extract(entry.name, destPath);
            extractedFiles++;

            // Update progress
            if (onProgress) {
              const percent = Math.round((extractedFiles / totalFiles) * 100);
              onProgress({
                percent,
                transferred: `${extractedFiles}`,
                total: `${totalFiles} files`
              });
            }
          }
        }

        this.logger.info('Zip extraction completed', 'NativeServerFetcher', { zipPath, destDir, totalFiles });
      } finally {
        await zip.close();
      }
    } catch (error) {
      this.logger.error('Zip extraction failed', 'NativeServerFetcher', {
        zipPath,
        destDir,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * HTTP GET request
   */
  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      httpModule.get(url, (res) => {
        // Use Buffer array to properly handle multi-byte UTF-8 characters
        const chunks: Buffer[] = [];
        
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        
        res.on('end', () => {
          // Concatenate all chunks and decode as UTF-8
          const data = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Download file
   */
  private downloadFile(
    url: string,
    filePath: string,
    onProgress?: (progress: NativeServerFetchProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      const request = httpModule.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;
        let lastProgressTime = Date.now();
        
        // Create write stream
        const fileStream = fs.createWriteStream(filePath);
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          fileStream.write(chunk);
          
          // Throttle progress updates (at most once per 100ms)
          const now = Date.now();
          if (onProgress && now - lastProgressTime > 100) {
            const percent = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
            onProgress({
              percent,
              transferred: this.formatBytes(downloadedSize),
              total: this.formatBytes(totalSize)
            });
            lastProgressTime = now;
          }
        });
        
        response.on('end', () => {
          fileStream.end();
          
          // Send final progress
          if (onProgress) {
            onProgress({
              percent: 100,
              transferred: this.formatBytes(downloadedSize),
              total: this.formatBytes(totalSize)
            });
          }
          
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
      
      request.setTimeout(120000, () => { // 2-minute timeout
        request.destroy();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Format byte count
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
