/**
 * Unified Skill Manager
 * Provides unified functionality for skill validation, version management, metadata parsing, extraction, etc.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from '../userDataADO';
// @ts-ignore - js-yaml types may not be available
import * as yaml from 'js-yaml';

const logger = createLogger();

export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  [key: string]: any;
}

export interface SkillConfig {
  name: string;
  description: string;
  version: string;
  source: 'ON-DEVICE';
}

export interface SkillValidationResult {
  valid: boolean;
  error?: string;
}

export interface VersionParseResult {
  skillName: string;
  version?: string;
}

export interface MetadataParseResult {
  metadata: SkillMetadata | null;
  error?: string;
}

export interface SkillOperationResult {
  success: boolean;
  error?: string;
  skillName?: string;
}

/**
 * Unified Skill Manager class
 */
export class SkillManager {
  private static instance: SkillManager;
  
  public static getInstance(): SkillManager {
    if (!SkillManager.instance) {
      SkillManager.instance = new SkillManager();
    }
    return SkillManager.instance;
  }

  /**
   * Validate whether skill name conforms to naming conventions
   * Can only contain digits 0-9, lowercase letters a-z, and hyphens "-"
   * "-" cannot be at the start or end, no spaces allowed
   */
  public validateSkillName(name: string): SkillValidationResult {
    if (!name || name.trim() === '') {
      return { valid: false, error: 'Skill name cannot be empty' };
    }

    // Check if starts or ends with "-"
    if (name.startsWith('-') || name.endsWith('-')) {
      return { valid: false, error: 'Skill name cannot start or end with "-"' };
    }

    // Check if contains spaces
    if (name.includes(' ')) {
      return { valid: false, error: 'Skill name cannot contain spaces' };
    }

    // Check if only contains allowed characters: 0-9, a-z, "-"
    const validPattern = /^[a-z0-9-]+$/;
    if (!validPattern.test(name)) {
      return { valid: false, error: 'Skill name can only contain lowercase letters (a-z), numbers (0-9), and hyphens (-)' };
    }

    return { valid: true };
  }

  /**
   * Extract skill name and version from zip/skill filename
   * Supports the following formats:
   * 1. {skill-name}.zip
   * 2. {skill-name}-{version}.zip
   * 3. {skill-name}.skill (Claude standard format, essentially zip)
   * 4. {skill-name}-{version}.skill
   */
  public parseSkillFileName(zipFileName: string): VersionParseResult {
    // Remove .zip or .skill extension
    const nameWithoutExt = zipFileName.replace(/\.(zip|skill)$/i, '');
    
    // Check if matches version format: {skill-name}-{version}
    const versionMatch = nameWithoutExt.match(/^(.+)-(\d+\.\d+\.\d+)$/);
    
    if (versionMatch) {
      // Format with version
      const skillName = versionMatch[1];
      const version = versionMatch[2];
      
      // Validate version format: [digits].[digits].[digits]
      const versionParts = version.split('.');
      if (versionParts.length === 3 && versionParts.every(part => /^\d+$/.test(part))) {
        return { skillName, version };
      } else {
        // Invalid version format, treat as regular filename
        return { skillName: nameWithoutExt };
      }
    } else {
      // Format without version
      return { skillName: nameWithoutExt };
    }
  }

  /**
   * Determine the final version to use
   * Priority:
   * 1. version field in SKILL.md metadata
   * 2. Version parsed from filename
   * 3. If no skill with same name exists, default to 1.0.0
   * 4. If a skill with same name exists, use the existing skill's version
   */
  public determineVersion(
    metadataVersion?: string,
    parsedVersion?: string,
    existingSkill?: any
  ): string {
    // 1. Prefer version from SKILL.md metadata
    if (metadataVersion && metadataVersion.trim()) {
      return metadataVersion.trim();
    }
    
    // 2. Then use version parsed from filename
    if (parsedVersion) {
      return parsedVersion;
    }
    
    // 3. Finally decide based on whether a skill with same name exists
    if (existingSkill) {
      // Same-name skill exists, use existing version
      return existingSkill.version || '1.0.0';
    } else {
      // No same-name skill, default to 1.0.0
      return '1.0.0';
    }
  }

  /**
   * Parse SKILL.md file and extract YAML metadata
   */
  public parseSkillMarkdown(content: string): MetadataParseResult {
    try {
      // Check if YAML front matter starts from the very beginning (line 1)
      if (!content.startsWith('---')) {
        return {
          metadata: null,
          error: 'YAML metadata must start from line 1 of SKILL.md (no empty lines or spaces before "---"). Expected format:\n---\nname: skill-name\ndescription: "description"\n---'
        };
      }
      
      // Extract YAML front matter (between --- markers at the start of file)
      const yamlRegex = /^---\s*\n([\s\S]*?)\n---/;
      const match = content.match(yamlRegex);
      
      if (!match) {
        return {
          metadata: null,
          error: 'SKILL.md does not contain valid YAML metadata. Expected format:\n---\nname: skill-name\ndescription: "description"\n---'
        };
      }
      
      const yamlContent = match[1];
      const metadata = yaml.load(yamlContent) as any;
      
      // Validate metadata structure
      if (!metadata || typeof metadata !== 'object') {
        return { metadata: null, error: 'Invalid YAML metadata structure' };
      }
      
      // Validate required fields (lowercase: name and description)
      if (!metadata.name || typeof metadata.name !== 'string' || !metadata.name.trim()) {
        return { metadata: null, error: 'SKILL.md metadata must contain a valid "name" field (lowercase)' };
      }
      
      if (!metadata.description || typeof metadata.description !== 'string' || !metadata.description.trim()) {
        return { metadata: null, error: 'SKILL.md metadata must contain a valid "description" field (lowercase)' };
      }
      
      logger.info(`[SkillManager] Parsed skill metadata - name: "${metadata.name}", description: "${metadata.description}"`);
      
      return { metadata: metadata as SkillMetadata };
    } catch (error) {
      return { metadata: null, error: `Failed to parse YAML metadata: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Unified extraction logic
   */
  public async extractZip(zipPath: string, destDir: string): Promise<string> {
    const JSZip = require('jszip');
    
    try {
      logger.info('[SkillManager] Reading zip file:', zipPath);
      const zipData = fs.readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipData);
      
      // Ensure destination directory exists
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      const fileEntries = Object.keys(zip.files);
      
      // Determine zip structure: whether all files are wrapped in a single root directory
      // If all files are under the same top-level directory, it has a root directory
      // Otherwise it's a flat structure (files directly at zip root level)
      const hasRootDir = this.detectZipRootDirectory(fileEntries);
      
      let rootDirName: string;
      let extractPrefix: string; // Path prefix when extracting files
      
      if (hasRootDir) {
        // Standard structure with root directory wrapping
        rootDirName = hasRootDir;
        extractPrefix = '';
        logger.info(`[SkillManager] Zip has root directory: "${rootDirName}"`);
      } else {
        // Flat structure: files directly at zip root level, need to create virtual root directory
        // Use zip filename (without extension) as root directory name
        const zipFileName = path.basename(zipPath);
        rootDirName = zipFileName.replace(/\.(zip|skill)$/i, '');
        // Remove version suffix (e.g., skill-name-1.0.0 -> skill-name)
        const versionMatch = rootDirName.match(/^(.+)-(\d+\.\d+\.\d+)$/);
        if (versionMatch) {
          rootDirName = versionMatch[1];
        }
        extractPrefix = rootDirName + '/';
        logger.info(`[SkillManager] Zip has flat structure, creating virtual root directory: "${rootDirName}"`);
      }
      
      // Extract all files (skip macOS metadata)
      const filePromises: Promise<void>[] = [];
      zip.forEach((relativePath: string, file: any) => {
        // Skip macOS resource fork metadata and .DS_Store files
        if (relativePath.startsWith('__MACOSX/') || relativePath === '__MACOSX' || path.basename(relativePath) === '.DS_Store') {
          return;
        }
        const filePath = path.join(destDir, extractPrefix + relativePath);
        
        if (file.dir) {
          // Create directory
          if (!fs.existsSync(filePath)) {
            fs.mkdirSync(filePath, { recursive: true });
          }
        } else {
          // Extract file
          const filePromise = file.async('nodebuffer').then((content: Buffer) => {
            // Ensure parent directory exists
            const fileDir = path.dirname(filePath);
            if (!fs.existsSync(fileDir)) {
              fs.mkdirSync(fileDir, { recursive: true });
            }
            // Write file
            fs.writeFileSync(filePath, content);
          });
          filePromises.push(filePromise);
        }
      });
      
      // Wait for all files to be extracted
      await Promise.all(filePromises);
      
      logger.info('[SkillManager] Extracted zip to:', destDir);
      return rootDirName;
    } catch (error) {
      throw new Error(`Failed to extract zip: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Detect whether the zip file has a single root directory wrapping all files
   * Returns the root directory name if it exists, otherwise returns null
   * 
   * Detection logic:
   * 1. All files/directories must share the same first-level path segment
   * 2. That first-level path segment must be a directory (not a top-level file)
   * 3. Must have SKILL.md etc. under that directory (not at zip root level)
   */
  private detectZipRootDirectory(fileEntries: string[]): string | null {
    if (fileEntries.length === 0) return null;
    
    // Collect all top-level path segments (ignore __MACOSX and .DS_Store macOS metadata)
    const topLevelNames = new Set<string>();
    let hasTopLevelFile = false;
    
    for (const entry of fileEntries) {
      // Skip macOS resource fork metadata directory
      if (entry.startsWith('__MACOSX/') || entry === '__MACOSX') continue;
      
      const parts = entry.split('/').filter(p => p.length > 0);
      if (parts.length === 0) continue;
      
      // Skip top-level .DS_Store files
      if (parts.length === 1 && parts[0] === '.DS_Store') continue;
      
      topLevelNames.add(parts[0]);
      
      // Check if there are files directly at zip root level (not inside any directory)
      // If path has only one segment and doesn't end with /, it's a top-level file
      if (parts.length === 1 && !entry.endsWith('/')) {
        hasTopLevelFile = true;
      }
    }
    
    // If there are top-level files (e.g., SKILL.md directly at zip root level), it's a flat structure
    if (hasTopLevelFile) {
      return null;
    }
    
    // If all entries are under the same top-level directory, that directory is the root
    if (topLevelNames.size === 1) {
      return topLevelNames.values().next().value || null;
    }
    
    // Multiple top-level directories/files indicates a flat structure
    return null;
  }

  /**
   * Clean up temporary directory
   */
  public cleanupTempDirectory(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        logger.info('[SkillManager] Cleaned up temporary directory:', dirPath);
      }
    } catch (error) {
      logger.error('[SkillManager] Failed to cleanup directory:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Validate skill package integrity and compliance
   */
  public validateSkillPackage(extractedDir: string, expectedName?: string): SkillValidationResult {
    try {
      // 1. Check if SKILL.md file exists
      const skillMdPath = path.join(extractedDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        return { valid: false, error: 'SKILL.md file not found in the skill package' };
      }
      
      // 2. Read and validate SKILL.md file
      const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
      const { metadata, error: parseError } = this.parseSkillMarkdown(skillMdContent);
      
      if (!metadata || parseError) {
        return { valid: false, error: parseError || 'Failed to parse SKILL.md metadata' };
      }
      
      // 3. Check if directory name matches skill name (if expectedName is provided)
      if (expectedName && path.basename(extractedDir) !== metadata.name) {
        return {
          valid: false,
          error: `Directory name "${path.basename(extractedDir)}" must match skill name "${metadata.name}" from SKILL.md`
        };
      }
      
      // 4. Check if skill name conforms to naming conventions
      const nameValidation = this.validateSkillName(metadata.name);
      if (!nameValidation.valid) {
        return {
          valid: false,
          error: nameValidation.error || 'Invalid skill name format'
        };
      }
      
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: `Skill package validation failed: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Get skill metadata
   */
  public getSkillMetadata(skillDir: string): MetadataParseResult {
    try {
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        return { metadata: null, error: 'SKILL.md file not found' };
      }
      
      const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
      return this.parseSkillMarkdown(skillMdContent);
    } catch (error) {
      return { 
        metadata: null, 
        error: `Failed to read skill metadata: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Check if a skill already exists
   */
  public checkSkillExists(userAlias: string, skillName: string): any | null {
    const profile = profileCacheManager.getCachedProfile(userAlias);
    return profile && profile.skills ? profile.skills.find(s => s.name === skillName) : null;
  }

  /**
   * Install or update a skill to user profile
   */
  public async installSkill(
    userAlias: string,
    skillConfig: SkillConfig,
    sourceDir: string,
    isUpdate: boolean = false
  ): Promise<SkillOperationResult> {
    try {
      const userSkillsDir = path.join(app.getPath('userData'), 'profiles', userAlias, 'skills');
      if (!fs.existsSync(userSkillsDir)) {
        fs.mkdirSync(userSkillsDir, { recursive: true });
      }
      
      const skillRootDir = path.join(userSkillsDir, skillConfig.name);
      
      // If updating or same-name skill exists, remove original directory first
      if (fs.existsSync(skillRootDir)) {
        logger.info(`[SkillManager] Removing existing skill directory: ${skillRootDir}`);
        fs.rmSync(skillRootDir, { recursive: true, force: true });
      }
      
      // Move or copy skill directory to final location
      if (fs.existsSync(sourceDir)) {
        fs.renameSync(sourceDir, skillRootDir);
        logger.info('[SkillManager] Moved skill to:', skillRootDir);
      } else {
        return { success: false, error: 'Source skill directory not found' };
      }
      
      // Save/update skill config via ProfileCacheManager
      let success: boolean;
      if (isUpdate) {
        success = await profileCacheManager.updateSkill(userAlias, skillConfig.name, skillConfig);
      } else {
        success = await profileCacheManager.addSkill(userAlias, skillConfig);
      }
      
      if (!success) {
        // If save failed, clean up moved files
        this.cleanupTempDirectory(skillRootDir);
        return { success: false, error: 'Failed to save skill configuration to profile' };
      }
      
      logger.info('[SkillManager] Skill installed successfully:', skillConfig.name);
      return { success: true, skillName: skillConfig.name };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[SkillManager] Failed to install skill:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Create temporary directory
   */
  public createTempDirectory(prefix: string = 'kosmos-skill'): string {
    const tempDir = path.join(app.getPath('userData'), 'tmp', `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
  }
}

// Export singleton instance
export const skillManager = SkillManager.getInstance();