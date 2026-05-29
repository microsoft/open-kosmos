import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { appendCacheBustingTimestamp } from '../utils/urlUtils';
import { BRAND_NAME } from '../../../shared/constants/branding';

export interface CdnUpdateInfo {
  latest: string;
  releaseNotes?: string;
  releaseDate?: string;
  downloadUrls?: {
    [platformKey: string]: string; // format: "darwin-arm64", "win32-x64", etc.
  };
}

export interface UpdateFileInfo {
  version: string;
  platform: string;
  arch: string;
  url: string;
  size?: number;
  sha512?: string;
}

export class CdnUpdateChecker {
  private logger = createLogger();
  private cdnBaseUrl: string;
  private currentVersion: string;

  constructor(cdnBaseUrl: string) {
    this.cdnBaseUrl = cdnBaseUrl.replace(/\/$/, ''); // remove trailing slash
    this.currentVersion = app.getVersion();
  }

  /**
   * Check whether a new version is available
   */
  public async checkForUpdates(): Promise<{
    hasUpdate: boolean;
    updateInfo?: CdnUpdateInfo;
    downloadUrl?: string;
  }> {
    try {

      // Fetch latest version info
      const latestInfo = await this.fetchLatestVersion();

      if (!latestInfo) {
        this.logger.warn('Step 1 failed: unable to fetch latest version info', 'CdnUpdateChecker');
        return { hasUpdate: false };
      }


      // Compare versions
      const versionComparison = this.compareVersions(latestInfo.latest, this.currentVersion);
      const hasUpdate = versionComparison > 0;


      if (hasUpdate) {

        // Get the download URL for the current platform
        const downloadUrl = await this.getDownloadUrl(latestInfo);


        return {
          hasUpdate: true,
          updateInfo: latestInfo,
          downloadUrl
        };
      } else {
        return { hasUpdate: false, updateInfo: latestInfo };
      }
    } catch (error) {
      this.logger.error('=== CDN Update Check Failed ===', 'CdnUpdateChecker', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: (error as any).code
        } : String(error)
      });

      // Enhanced error information to help users understand the problem
      if (error instanceof Error) {
        const errorCode = (error as any).code;

        // Network-related errors
        if (errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT') {
          const enhancedError = new Error(
            'Unable to connect to update server. Please check your network connection.\n\n' +
            'If you are on a corporate network, you may need to connect to MSFT VPN to access the update server.\n\n' +
            `Detailed error: ${error.message}`
          );
          (enhancedError as any).code = errorCode;
          (enhancedError as any).originalError = error;
          throw enhancedError;
        }

        // DNS resolution errors
        if (errorCode === 'EAI_AGAIN') {
          const enhancedError = new Error(
            'DNS resolution failed, unable to access update server. Please check network connection and DNS settings.\n\n' +
            'If you are on a corporate network, you may need to connect to MSFT VPN.\n\n' +
            `Detailed error: ${error.message}`
          );
          (enhancedError as any).code = errorCode;
          (enhancedError as any).originalError = error;
          throw enhancedError;
        }

        // SSL/TLS errors
        if (error.message.includes('CERT_') || error.message.includes('SSL')) {
          const enhancedError = new Error(
            'SSL certificate verification failed. This may be a network configuration issue.\n\n' +
            'Suggestions:\n' +
            '1. Check if system time is correct\n' +
            '2. If on corporate network, please connect to MSFT VPN\n' +
            '3. Check firewall or proxy settings\n\n' +
            `Detailed error: ${error.message}`
          );
          (enhancedError as any).code = 'SSL_ERROR';
          (enhancedError as any).originalError = error;
          throw enhancedError;
        }
      }

      throw error;
    }
  }

  /**
   * Get the brand-specific path segment
   */
  private getBrandPath(): string {
    return BRAND_NAME === 'kosmos' ? '' : `/${BRAND_NAME}`;
  }

  /**
   * Fetch the latest version info from the CDN
   */
  private async fetchLatestVersion(): Promise<CdnUpdateInfo | null> {
    // Add timestamp to bypass CDN cache
    const latestUrl = appendCacheBustingTimestamp(`${this.cdnBaseUrl}${this.getBrandPath()}/latest.json`);

    try {

      const startTime = Date.now();
      const response = await this.httpsGet(latestUrl);
      const endTime = Date.now();
      const responseTime = endTime - startTime;


      // Log first 200 characters of the response content
      const responsePreview = response.length > 200 ? response.substring(0, 200) + '...' : response;

      const latestInfo: CdnUpdateInfo = JSON.parse(response);


      return latestInfo;
    } catch (error) {
      this.logger.error('Failed to fetch latest version info', 'CdnUpdateChecker', {
        url: latestUrl,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: (error as any).code
        } : String(error)
      });

      // 🔥 Important: do not return null — throw the error instead
      // so it is caught by checkForUpdates() and handled correctly
      throw error;
    }
  }

  /**
   * Get the download URL for the current platform
   */
  private async getDownloadUrl(latestInfo: CdnUpdateInfo): Promise<string> {
    const platform = process.platform;
    const arch = process.arch;

    // Build the platform-architecture key
    const platformKey = `${platform}-${arch}`;


    // Get the filename for the corresponding platform from downloadUrls
    if (!latestInfo.downloadUrls || !latestInfo.downloadUrls[platformKey]) {
      throw new Error(`Unsupported platform combination: ${platformKey}`);
    }

    const fileName = latestInfo.downloadUrls[platformKey];
    const downloadUrl = `${this.cdnBaseUrl}${this.getBrandPath()}/${fileName}`;


    return downloadUrl;
  }

  /**
   * Verify that a download file exists
   */
  public async verifyDownloadExists(downloadUrl: string): Promise<boolean> {
    try {
      await this.httpsHead(downloadUrl);
      return true;
    } catch (error) {
      this.logger.error('Download file does not exist', 'CdnUpdateChecker', { url: downloadUrl, error });
      return false;
    }
  }

  /**
   * Get file size and hash information
   */
  public async getFileInfo(downloadUrl: string): Promise<UpdateFileInfo | null> {
    try {
      const response = await this.httpsHead(downloadUrl);
      const contentLength = response.headers['content-length'];
      const size = contentLength ? parseInt(contentLength) : undefined;

      const urlParts = downloadUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      // Parse filename: <ProductName>-<Version>-<Platform>-<Arch>.<Ext>
      // e.g. OpenKosmos-1.0.13-mac-arm64.dmg or CustomBrand-1.0.13-win32-x64.exe

      const nameParts = fileName.split('-');
      if (nameParts.length < 3) {
        throw new Error(`Invalid filename format: ${fileName}`);
      }

      const archWithExt = nameParts.pop() || '';
      const platformCode = nameParts.pop() || '';
      const version = nameParts.pop() || '';
      const productName = nameParts.join('-'); // Remainder is product name

      const arch = archWithExt.split('.')[0];

      const fileInfo: UpdateFileInfo = {
        version,
        platform: this.mapPlatformName(platformCode),
        arch,
        url: downloadUrl,
        size,
      };

      return fileInfo;
    } catch (error) {
      this.logger.error('Failed to get file info', 'CdnUpdateChecker', { url: downloadUrl, error });
      return null;
    }
  }

  /**
   * Compare version strings
   * @param version1 Version 1
   * @param version2 Version 2
   * @returns 1: version1 > version2, 0: equal, -1: version1 < version2
   */
  private compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.replace(/^v/, '').split('.').map(Number);
    const v2Parts = version2.replace(/^v/, '').split('.').map(Number);

    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;

      if (v1Part > v2Part) return 1;
      if (v1Part < v2Part) return -1;
    }

    return 0;
  }

  /**
   * Map platform names (filename platform name → Node.js platform)
   */
  private mapPlatformName(platform: string): string {
    switch (platform) {
      case 'mac':
        return 'darwin';
      case 'win':
        return 'win32';
      case 'linux':
        return 'linux';
      default:
        return platform;
    }
  }

  /**
   * Get the current platform identifier
   */
  public getCurrentPlatformKey(): string {
    const platform = process.platform;
    const arch = process.arch;
    return `${platform}-${arch}`;
  }

  /**
   * Check whether the current platform is supported
   */
  public isPlatformSupported(latestInfo: CdnUpdateInfo): boolean {
    const platformKey = this.getCurrentPlatformKey();
    const isSupported = !!(latestInfo.downloadUrls && latestInfo.downloadUrls[platformKey]);


    return isSupported;
  }

  /**
   * HTTP/HTTPS GET request
   */
  private httpsGet(url: string): Promise<string> {
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
   * HTTP/HTTPS HEAD request
   */
  private httpsHead(url: string): Promise<{ headers: any; statusCode?: number }> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;


      const request = httpModule.request(url, { method: 'HEAD' }, (res) => {
        if (res.statusCode === 200) {
          resolve({
            headers: res.headers,
            statusCode: res.statusCode
          });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.end();
    });
  }

  /**
   * Set the CDN base URL
   */
  public setCdnBaseUrl(url: string): void {
    this.cdnBaseUrl = url.replace(/\/$/, '');
  }

  /**
   * Get the currently configured CDN URL
   */
  public getCdnBaseUrl(): string {
    return this.cdnBaseUrl;
  }
}