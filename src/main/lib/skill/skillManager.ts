/**
 * Unified Skill Manager
 * Provides unified functionality for skill validation, version management,
 * metadata parsing, and extraction.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from '../userDataADO';
// @ts-ignore - js-yaml types may not be available
import * as yaml from 'js-yaml';
import JSZip from 'jszip';

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
  source: 'ON-DEVICE' | 'PLUGIN';
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
   * Validate whether a skill name conforms to naming rules.
   * Only allows digits 0-9, lowercase letters a-z, and the "-" character.
   * "-" cannot appear at the start or end, and no spaces are allowed.
   */
  public validateSkillName(name: string): SkillValidationResult {
    if (!name || name.trim() === '') {
      return { valid: false, error: 'Skill name cannot be empty' };
    }

    // Check whether the name starts or ends with "-"
    if (name.startsWith('-') || name.endsWith('-')) {
      return { valid: false, error: 'Skill name cannot start or end with "-"' };
    }

    // Check whether the name contains spaces
    if (name.includes(' ')) {
      return { valid: false, error: 'Skill name cannot contain spaces' };
    }

    // Check whether the name contains only allowed characters: 0-9, a-z, "-"
    const validPattern = /^[a-z0-9-]+$/;
    if (!validPattern.test(name)) {
      return { valid: false, error: 'Skill name can only contain lowercase letters (a-z), numbers (0-9), and hyphens (-)' };
    }

    return { valid: true };
  }

  /**
   * Extract the skill name and version number from a zip/skill file name.
   * Supported formats:
   * 1. {skill-name}.zip
   * 2. {skill-name}-{version}.zip
   * 3. {skill-name}.skill (Claude standard format, essentially zip)
   * 4. {skill-name}-{version}.skill
   */
  public parseSkillFileName(zipFileName: string): VersionParseResult {
    // Remove the .zip or .skill extension
    const nameWithoutExt = zipFileName.replace(/\.(zip|skill)$/i, '');

    // Check whether it matches the versioned format: {skill-name}-{version}
    const versionMatch = nameWithoutExt.match(/^(.+)-(\d+\.\d+\.\d+)$/);

    if (versionMatch) {
      // Versioned format
      const skillName = versionMatch[1];
      const version = versionMatch[2];

      // Validate the version number format: [digits].[digits].[digits]
      const versionParts = version.split('.');
      if (versionParts.length === 3 && versionParts.every(part => /^\d+$/.test(part))) {
        return { skillName, version };
      } else {
        // Invalid version format — treat as a plain file name
        return { skillName: nameWithoutExt };
      }
    } else {
      // Non-versioned format
      return { skillName: nameWithoutExt };
    }
  }

  /**
   * Determine the final version number to use.
   * Priority:
   * 1. The version field in the SKILL.md metadata
   * 2. The version number parsed from the file name
   * 3. If no skill with the same name exists, default to 1.0.0
   * 4. If a skill with the same name exists, use its existing version number
   */
  public determineVersion(
    metadataVersion?: string,
    parsedVersion?: string,
    existingSkill?: any
  ): string {
    // 1. Prefer the version number from SKILL.md metadata
    if (metadataVersion && metadataVersion.trim()) {
      return metadataVersion.trim();
    }

    // 2. Next, use the version number parsed from the file name
    if (parsedVersion) {
      return parsedVersion;
    }

    // 3. Finally, decide based on whether a skill with the same name already exists
    if (existingSkill) {
      // Same-named skill exists — use its current version number
      return existingSkill.version || '1.0.0';
    } else {
      // No same-named skill — default to 1.0.0
      return '1.0.0';
    }
  }

  /**
   * Parse a SKILL.md file and extract the YAML metadata
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
    try {
      logger.info(`[SkillManager] Reading zip file: ${zipPath}`);
      const zipData = fs.readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipData);

      // Ensure the destination directory exists
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const fileEntries = Object.keys(zip.files);

      // Determine zip structure: does a single root directory wrap all files?
      // If all files share the same top-level directory, treat it as having a root directory;
      // otherwise treat it as a flat structure (files directly at the zip root level).
      const hasRootDir = this.detectZipRootDirectory(fileEntries);

      let rootDirName: string;
      let extractPrefix: string; // Path prefix used when extracting files

      if (hasRootDir) {
        // Standard structure with a wrapping root directory
        rootDirName = hasRootDir;
        extractPrefix = '';
        logger.info(`[SkillManager] Zip has root directory: "${rootDirName}"`);
      } else {
        // Flat structure: files are directly at the zip root level; create a virtual root directory.
        // Use the zip file name (without extension) as the root directory name.
        const zipFileName = path.basename(zipPath);
        rootDirName = zipFileName.replace(/\.(zip|skill)$/i, '');
        // Strip the version suffix (e.g., skill-name-1.0.0 → skill-name)
        const versionMatch = rootDirName.match(/^(.+)-(\d+\.\d+\.\d+)$/);
        if (versionMatch) {
          rootDirName = versionMatch[1];
        }
        extractPrefix = rootDirName + '/';
        logger.info(`[SkillManager] Zip has flat structure, creating virtual root directory: "${rootDirName}"`);
      }

      // Extract all files (skipping macOS metadata)
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
            // Ensure the parent directory exists
            const fileDir = path.dirname(filePath);
            if (!fs.existsSync(fileDir)) {
              fs.mkdirSync(fileDir, { recursive: true });
            }
            // Write the file
            fs.writeFileSync(filePath, content);
          });
          filePromises.push(filePromise);
        }
      });

      // Wait for all files to be extracted
      await Promise.all(filePromises);

      logger.info(`[SkillManager] Extracted zip to: ${destDir}`);
      return rootDirName;
    } catch (error) {
      throw new Error(`Failed to extract zip: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Detect whether a zip file has a single root directory wrapping all files.
   * Returns the root directory name if found, otherwise null.
   *
   * Detection logic:
   * 1. The first path segment of every file/directory entry must be the same.
   * 2. That first path segment must be a directory (not a top-level file).
   * 3. Files like SKILL.md must be inside that directory, not at the zip root level.
   */
  private detectZipRootDirectory(fileEntries: string[]): string | null {
    if (fileEntries.length === 0) return null;

    // Collect all top-level path segments (ignoring macOS metadata like __MACOSX and .DS_Store)
    const topLevelNames = new Set<string>();
    let hasTopLevelFile = false;

    for (const entry of fileEntries) {
      // Skip macOS resource fork metadata directories
      if (entry.startsWith('__MACOSX/') || entry === '__MACOSX') continue;

      const parts = entry.split('/').filter(p => p.length > 0);
      if (parts.length === 0) continue;

      // Skip top-level .DS_Store files
      if (parts.length === 1 && parts[0] === '.DS_Store') continue;

      topLevelNames.add(parts[0]);

      // Check whether any file exists directly at the zip root level (not inside any directory).
      // A single path segment that doesn't end with "/" indicates a top-level file.
      if (parts.length === 1 && !entry.endsWith('/')) {
        hasTopLevelFile = true;
      }
    }

    // If there are top-level files (e.g., SKILL.md directly at the zip root), it's a flat structure
    if (hasTopLevelFile) {
      return null;
    }

    // If all entries share the same top-level directory, that directory is the root
    if (topLevelNames.size === 1) {
      return topLevelNames.values().next().value || null;
    }

    // Multiple top-level directories/files — flat structure
    return null;
  }

  /**
   * Clean up a temporary directory
   */
  public cleanupTempDirectory(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        logger.info(`[SkillManager] Cleaned up temporary directory: ${dirPath}`);
      }
    } catch (error) {
      logger.error(`[SkillManager] Failed to cleanup directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate the integrity and compliance of a skill package
   */
  public validateSkillPackage(extractedDir: string, expectedName?: string): SkillValidationResult {
    try {
      // 1. Check for the SKILL.md file
      const skillMdPath = path.join(extractedDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        return { valid: false, error: 'SKILL.md file not found in the skill package' };
      }

      // 2. Read and validate SKILL.md
      const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
      const { metadata, error: parseError } = this.parseSkillMarkdown(skillMdContent);

      if (!metadata || parseError) {
        return { valid: false, error: parseError || 'Failed to parse SKILL.md metadata' };
      }

      // 3. If expectedName is provided, the package metadata must match it exactly
      if (expectedName && metadata.name !== expectedName) {
        return {
          valid: false,
          error: `Skill package contains skill "${metadata.name}" but expected "${expectedName}"`
        };
      }

      // 4. Check that the directory name matches the skill name (if expectedName is provided)
      if (expectedName && path.basename(extractedDir) !== metadata.name) {
        return {
          valid: false,
          error: `Directory name "${path.basename(extractedDir)}" must match skill name "${metadata.name}" from SKILL.md`
        };
      }

      // 5. Check that the skill name conforms to naming rules
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
   * Get the metadata for a skill
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
   * Check whether a skill already exists
   */
  public checkSkillExists(userAlias: string, skillName: string): any | null {
    const profile = profileCacheManager.getCachedProfile(userAlias);
    return profile && profile.skills ? profile.skills.find(s => s.name === skillName) : null;
  }

  /**
   * Install or update a skill into the user profile
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

      // If updating or a same-named skill already exists, remove the existing directory first
      if (fs.existsSync(skillRootDir)) {
        logger.info(`[SkillManager] Removing existing skill directory: ${skillRootDir}`);
        // Symlink/junction safety: unlinkSync for links, rmSync for real dirs
        const stat = fs.lstatSync(skillRootDir);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(skillRootDir);
        } else {
          fs.rmSync(skillRootDir, { recursive: true, force: true });
        }
      }

      // Move or copy the skill directory to its final location
      if (fs.existsSync(sourceDir)) {
        fs.renameSync(sourceDir, skillRootDir);
        logger.info(`[SkillManager] Moved skill to: ${skillRootDir}`);
      } else {
        return { success: false, error: 'Source skill directory not found' };
      }

      // Save/update skill configuration via ProfileCacheManager
      let success: boolean;
      if (isUpdate) {
        success = await profileCacheManager.updateSkill(userAlias, skillConfig.name, skillConfig);
      } else {
        success = await profileCacheManager.addSkill(userAlias, skillConfig);
      }

      if (!success) {
        // If saving fails, clean up the moved files
        this.cleanupTempDirectory(skillRootDir);
        return { success: false, error: 'Failed to save skill configuration to profile' };
      }

      logger.info(`[SkillManager] Skill installed successfully: ${skillConfig.name}`);
      return { success: true, skillName: skillConfig.name };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[SkillManager] Failed to install skill: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Create a temporary directory
   */
  public createTempDirectory(prefix: string = 'openkosmos-skill'): string {
    const tempDir = path.join(app.getPath('userData'), 'tmp', `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
  }
}

// Export singleton instance
export const skillManager = SkillManager.getInstance();
