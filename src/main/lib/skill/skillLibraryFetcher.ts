/**
 * Skill Library Fetcher
 * Fetches skill library data from remote server, downloads and extracts skills
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { getCdnBaseUrl, isCdnConfigured } from '@shared/utils/cdn';
import https from 'https';
import http from 'http';
import { skillManager } from './skillManager';
// Inlined from urlUtils to avoid circular chunk dependency at bundle time
// (urlUtils lives in main chunk; this file gets split into a separate chunk due to jszip size)
function appendCacheBustingTimestamp(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}timestamp=${Date.now()}`;
}

const logger = createLogger();

interface SkillLibraryItem {
  name: string;
  description: string;
  version: string;
  contact?: string;
}

interface SkillLibraryData {
  skills: SkillLibraryItem[];
}

export class SkillLibraryFetcher {
  private static instance: SkillLibraryFetcher;
  private readonly libraryUrl: string;
  private readonly skillBaseUrl: string;
  private readonly assetsDir: string;
  private readonly skillsDir: string;
  private readonly libraryFilePath: string;

  private constructor() {
    // Resolve the optional CDN base URL. When unset, the Skill Library feature
    // (catalog + skill .zip downloads) has no remote source and stays disabled.
    const baseCdnUrl = getCdnBaseUrl();

    // Set URLs based on environment (empty when CDN not configured)
    this.libraryUrl = baseCdnUrl ? `${baseCdnUrl}/skills/skills_lib.json` : '';
    this.skillBaseUrl = baseCdnUrl ? `${baseCdnUrl}/skills` : '';

    logger.info(`[SkillLibraryFetcher] Initialized with baseCdnUrl: ${baseCdnUrl || '(none — optional feature disabled)'}, libraryUrl: ${this.libraryUrl || '(none)'}, skillBaseUrl: ${this.skillBaseUrl || '(none)'}`, 'SkillLibraryFetcher');

    // Get user data directory (writable location)
    const userDataPath = app.getPath('userData');

    // Create assets/skills directory path in user data
    this.assetsDir = path.join(userDataPath, 'assets');
    this.skillsDir = path.join(this.assetsDir, 'skills');
    this.libraryFilePath = path.join(this.skillsDir, 'skills_lib.json');

    // Ensure directories exist
    this.ensureDirectories();
  }

  public static getInstance(): SkillLibraryFetcher {
    if (!SkillLibraryFetcher.instance) {
      SkillLibraryFetcher.instance = new SkillLibraryFetcher();
    }
    return SkillLibraryFetcher.instance;
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    try {
      if (!fs.existsSync(this.assetsDir)) {
        fs.mkdirSync(this.assetsDir, { recursive: true });
        logger.info(`[SkillLibraryFetcher] Created assets directory: ${this.assetsDir}`);
      }

      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
        logger.info(`[SkillLibraryFetcher] Created skills directory: ${this.skillsDir}`);
      }
    } catch (error) {
      logger.error(`[SkillLibraryFetcher] Failed to create directories: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Fetch library data from remote server using http/https modules
   */
  private async fetchFromRemote(): Promise<SkillLibraryData> {
    return new Promise((resolve, reject) => {
      // CDN is optional; without a configured base URL there is no remote source.
      if (!isCdnConfigured() || !this.libraryUrl) {
        reject(new Error('CDN not configured; skipping remote Skill Library fetch'));
        return;
      }

      // Add timestamp to bypass CDN cache
      const urlWithTimestamp = appendCacheBustingTimestamp(this.libraryUrl);
      const urlObj = new URL(urlWithTimestamp);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      logger.info(`[SkillLibraryFetcher] Fetching from remote: ${urlWithTimestamp}`);

      const request = protocol.get(urlWithTimestamp, (response) => {
        // Use Buffer array to properly handle multi-byte UTF-8 characters (e.g., emoji)
        const chunks: Buffer[] = [];

        // Check response status
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // Collect data chunks as Buffer to avoid UTF-8 boundary issues
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        // Parse complete response
        response.on('end', () => {
          try {
            // Concatenate all chunks and decode as UTF-8 to preserve multi-byte characters
            const data = Buffer.concat(chunks).toString('utf-8');
            logger.info(`[SkillLibraryFetcher] Response received, length: ${data.length}`);
            const jsonData: SkillLibraryData = JSON.parse(data);

            // Validate data structure
            if (!jsonData.skills || !Array.isArray(jsonData.skills)) {
              reject(new Error('Invalid data format: skills array not found'));
              return;
            }

            logger.info(`[SkillLibraryFetcher] Successfully fetched ${jsonData.skills.length} skills`);
            resolve(jsonData);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      });

      // Handle request errors
      request.on('error', (error) => {
        logger.error(`[SkillLibraryFetcher] Request error: ${error.message}`);
        reject(new Error(`Network error: ${error.message}`));
      });

      // Set timeout
      request.setTimeout(10000, () => {
        request.destroy();
        reject(new Error('Request timeout (10s)'));
      });
    });
  }

  /**
   * Save library data to local file
   */
  private async saveToLocal(data: SkillLibraryData): Promise<void> {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.libraryFilePath, jsonString, 'utf-8');
      logger.info(`[SkillLibraryFetcher] Saved library data to: ${this.libraryFilePath}`);
    } catch (error) {
      logger.error(`[SkillLibraryFetcher] Failed to save library data: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Load library data from local file
   */
  private async loadFromLocal(): Promise<SkillLibraryData | null> {
    try {
      if (!fs.existsSync(this.libraryFilePath)) {
        logger.info('[SkillLibraryFetcher] Local library file not found');
        return null;
      }

      const content = fs.readFileSync(this.libraryFilePath, 'utf-8');
      const data: SkillLibraryData = JSON.parse(content);

      // Validate data structure
      if (!data.skills || !Array.isArray(data.skills)) {
        logger.warn('[SkillLibraryFetcher] Invalid local data format, will re-fetch');
        return null;
      }

      logger.info(`[SkillLibraryFetcher] Loaded ${data.skills.length} skills from local cache`);
      return data;
    } catch (error) {
      logger.error(`[SkillLibraryFetcher] Failed to load local library data: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get library data (prioritize remote, fallback to local cache)
   */
  public async getLibraryData(): Promise<{ success: boolean; data?: SkillLibraryData; error?: string }> {
    try {
      // First, try to fetch from remote
      logger.info('[SkillLibraryFetcher] Attempting to fetch from remote...');
      const data = await this.fetchFromRemote();

      // Save to local
      await this.saveToLocal(data);

      return {
        success: true,
        data
      };
    } catch (error) {
      // Remote fetch failed, try to use local cache as fallback
      logger.warn('[SkillLibraryFetcher] Remote fetch failed, trying local cache as fallback...');
      const localData = await this.loadFromLocal();

      if (localData) {
        logger.info('[SkillLibraryFetcher] Using local cache as fallback');
        return {
          success: true,
          data: localData
        };
      }

      // Both remote and local failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Remote fetch failed: ${errorMessage}. No local cache available.`
      };
    }
  }

  /**
   * Download file from URL
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // CDN is optional; skill .zip downloads require a configured base URL.
      if (!isCdnConfigured() || !url) {
        reject(new Error('CDN not configured; skipping skill download'));
        return;
      }

      // Add timestamp to bypass CDN cache
      const urlWithTimestamp = appendCacheBustingTimestamp(url);
      const urlObj = new URL(urlWithTimestamp);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      logger.info(`[SkillLibraryFetcher] Downloading: ${urlWithTimestamp}`);

      const file = fs.createWriteStream(destPath);

      const request = protocol.get(urlWithTimestamp, (response) => {
        if (response.statusCode !== 200) {
          fs.unlinkSync(destPath);
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          logger.info(`[SkillLibraryFetcher] Download completed: ${destPath}`);
          resolve();
        });
      });

      request.on('error', (error) => {
        fs.unlinkSync(destPath);
        reject(error);
      });

      file.on('error', (error) => {
        fs.unlinkSync(destPath);
        reject(error);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        fs.unlinkSync(destPath);
        reject(new Error('Download timeout (30s)'));
      });
    });
  }

  /**
   * Validate skill compliance and check for duplicates
   */
  public async validateSkill(skillName: string, userAlias: string): Promise<{ success: boolean; error?: string; hasExisting?: boolean; existingSkill?: any }> {
    try {
      logger.info(`[SkillLibraryFetcher] Validating skill: ${skillName} for user: ${userAlias}`);

      // 1. Get skill info from library data first to obtain version
      const libraryResult = await this.getLibraryData();
      if (!libraryResult.success || !libraryResult.data) {
        throw new Error('Failed to get library data');
      }

      const skillInfo = libraryResult.data.skills.find(s => s.name === skillName);
      if (!skillInfo) {
        throw new Error(`Skill ${skillName} not found in library`);
      }

      // 2. Create temporary directory for download and extraction
      const tempDir = skillManager.createTempDirectory('library-skill-validate');

      try {
        // 3. Download skill zip file with version
        const zipUrl = `${this.skillBaseUrl}/${skillName}-${skillInfo.version}.zip`;
        const zipPath = path.join(tempDir, `${skillName}-${skillInfo.version}.zip`);

        logger.info('[SkillLibraryFetcher] Downloading skill zip for validation...');
        await this.downloadFile(zipUrl, zipPath);

        // 4. Extract to temporary directory first
        logger.info('[SkillLibraryFetcher] Extracting skill for validation...');
        const rootDirName = await skillManager.extractZip(zipPath, tempDir);
        const extractedDir = path.join(tempDir, rootDirName);

        // 5. Validate skill package (compliance check)
        const validation = skillManager.validateSkillPackage(extractedDir, skillName);
        if (!validation.valid) {
          throw new Error(`Invalid skill package: ${validation.error}`);
        }

        // 6. Check for existing skill with same name
        const existingSkill = skillManager.checkSkillExists(userAlias, skillName);
        const hasExisting = !!existingSkill;

        // 7. Cleanup temporary files
        skillManager.cleanupTempDirectory(tempDir);

        logger.info(`[SkillLibraryFetcher] Skill validation completed successfully: ${skillName}`);
        return {
          success: true,
          hasExisting,
          existingSkill: hasExisting ? existingSkill : undefined
        };

      } catch (error) {
        // Cleanup on error
        skillManager.cleanupTempDirectory(tempDir);
        throw error;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[SkillLibraryFetcher] Failed to validate skill: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Add skill to user profile
   */
  public async addSkill(skillName: string, userAlias: string, options?: { overwrite?: boolean }): Promise<{ success: boolean; error?: string; skillName?: string; skillVersion?: string; installAction?: 'install' | 'update' }> {
    let tempDir: string | null = null;
    let extractedDir: string | null = null;

    try {
      logger.info(`[SkillLibraryFetcher] Adding skill: ${skillName} for user: ${userAlias} (overwrite: ${options?.overwrite || false})`);

      // 1. Get skill info from library data first to obtain version
      const libraryResult = await this.getLibraryData();
      if (!libraryResult.success || !libraryResult.data) {
        throw new Error('Failed to get library data');
      }

      const skillInfo = libraryResult.data.skills.find(s => s.name === skillName);
      if (!skillInfo) {
        throw new Error(`Skill ${skillName} not found in library`);
      }

      // 2. Check for existing skill if overwrite is not enabled
      const existingSkill = skillManager.checkSkillExists(userAlias, skillName);
      if (existingSkill && !options?.overwrite) {
        throw new Error(`Skill "${skillName}" already exists. Use overwrite option to replace it.`);
      }

      // 3. Create temporary directory for download and extraction
      tempDir = skillManager.createTempDirectory('library-skill');

      // 4. Download skill zip file with version
      const zipUrl = `${this.skillBaseUrl}/${skillName}-${skillInfo.version}.zip`;
      const zipPath = path.join(tempDir, `${skillName}-${skillInfo.version}.zip`);

      logger.info('[SkillLibraryFetcher] Downloading skill zip...');
      await this.downloadFile(zipUrl, zipPath);

      // 5. Extract to temporary directory first
      logger.info('[SkillLibraryFetcher] Extracting skill...');
      const rootDirName = await skillManager.extractZip(zipPath, tempDir);
      extractedDir = path.join(tempDir, rootDirName);

      // 6. Validate skill package (compliance check)
      const validation = skillManager.validateSkillPackage(extractedDir, skillName);
      if (!validation.valid) {
        throw new Error(`Invalid skill package: ${validation.error}`);
      }

      // 7. Prepare skill configuration
      // 🆕 For IN-LIBRARY skills, set remoteVersion to the CDN library version
      const skillConfig = {
        name: skillInfo.name,
        description: skillInfo.description,
        version: skillInfo.version,
        remoteVersion: skillInfo.version, // 🆕 Record CDN library version for IN-LIBRARY skills
        source: 'IN-LIBRARY' as const
      };

      // 8. Install skill using unified logic (overwrite mode if existing skill)
      const installResult = await skillManager.installSkill(
        userAlias,
        skillConfig,
        extractedDir,
        !!existingSkill // This is an update if skill already exists
      );

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to install skill');
      }

      // 9. Cleanup temporary files
      skillManager.cleanupTempDirectory(tempDir);

      const actionType = existingSkill ? 'updated' : 'added';
      logger.info(`[SkillLibraryFetcher] Skill ${actionType} successfully:`, skillName);
      return {
        success: true,
        skillName: skillInfo.name,
        skillVersion: skillInfo.version,
        installAction: existingSkill ? 'update' : 'install',
      };

    } catch (error) {
      // Cleanup on error
      if (tempDir) {
        skillManager.cleanupTempDirectory(tempDir);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[SkillLibraryFetcher] Failed to add skill: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update skill to latest version
   */
  public async updateSkill(skillName: string, userAlias: string): Promise<{ success: boolean; error?: string; skillName?: string; skillVersion?: string; installAction?: 'update' }> {
    let tempDir: string | null = null;
    let extractedDir: string | null = null;

    try {
      logger.info(`[SkillLibraryFetcher] Updating skill: ${skillName} for user: ${userAlias}`);

      // 1. Get skill info from library data to obtain latest version
      const libraryResult = await this.getLibraryData();
      if (!libraryResult.success || !libraryResult.data) {
        throw new Error('Failed to get library data');
      }

      const skillInfo = libraryResult.data.skills.find(s => s.name === skillName);
      if (!skillInfo) {
        throw new Error(`Skill ${skillName} not found in library`);
      }

      // 2. Check if skill exists in user profile
      const existingSkill = skillManager.checkSkillExists(userAlias, skillName);
      if (!existingSkill) {
        throw new Error(`Skill ${skillName} is not installed for user ${userAlias}`);
      }

      // 3. Create temporary directory for download and extraction
      tempDir = skillManager.createTempDirectory('library-skill-update');

      // 4. Download latest version zip file
      const zipUrl = `${this.skillBaseUrl}/${skillName}-${skillInfo.version}.zip`;
      const zipPath = path.join(tempDir, `${skillName}-${skillInfo.version}.zip`);

      logger.info('[SkillLibraryFetcher] Downloading latest skill version...');
      await this.downloadFile(zipUrl, zipPath);

      // 5. Extract to temporary directory first
      logger.info('[SkillLibraryFetcher] Extracting latest skill version...');
      const rootDirName = await skillManager.extractZip(zipPath, tempDir);
      extractedDir = path.join(tempDir, rootDirName);

      // 6. Validate skill package
      const validation = skillManager.validateSkillPackage(extractedDir, skillName);
      if (!validation.valid) {
        throw new Error(`Invalid skill package: ${validation.error}`);
      }

      // 7. Prepare updated skill configuration
      // 🆕 For IN-LIBRARY skills, set remoteVersion to the CDN library version
      const skillConfig = {
        name: skillInfo.name,
        description: skillInfo.description,
        version: skillInfo.version,
        remoteVersion: skillInfo.version, // 🆕 Record CDN library version for IN-LIBRARY skills
        source: 'IN-LIBRARY' as const
      };

      // 8. Install skill using unified logic (as update)
      const installResult = await skillManager.installSkill(
        userAlias,
        skillConfig,
        extractedDir,
        true // This is an update
      );

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to update skill');
      }

      // 9. Cleanup temporary files
      skillManager.cleanupTempDirectory(tempDir);

      logger.info(`[SkillLibraryFetcher] Skill updated successfully: ${skillName}`);
      return {
        success: true,
        skillName: skillInfo.name,
        skillVersion: skillInfo.version,
        installAction: 'update',
      };

    } catch (error) {
      // Cleanup on error
      if (tempDir) {
        skillManager.cleanupTempDirectory(tempDir);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[SkillLibraryFetcher] Failed to update skill: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }
}