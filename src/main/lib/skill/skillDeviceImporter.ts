/**
 * Skill Device Importer
 * Handles importing skills from local device (zip files)
 */

import * as path from 'path';
import { createLogger } from '../unifiedLogger';
import { skillManager } from './skillManager';

const logger = createLogger();

/**
 * Add skill from local device
 */
export async function addSkillFromDevice(
  zipPath: string,
  userAlias: string,
  confirmCallback?: (skillName: string) => Promise<boolean>
): Promise<{ success: boolean; error?: string; skillName?: string; isOverwrite?: boolean }> {
  let tempDir: string | null = null;
  let extractedDir: string | null = null;
  
  try {
    logger.info(`[SkillDeviceImporter] Adding skill from device: ${zipPath} for user: ${userAlias}`);
    
    // 1. Extract skill name and version from zip filename
    const zipFileName = path.basename(zipPath);
    const { skillName: fileSkillName, version: fileVersion } = skillManager.parseSkillFileName(zipFileName);
    logger.info(`[SkillDeviceImporter] Parsed from filename - skill: "${fileSkillName}", version: ${fileVersion || 'none'}`);
    
    // 2. Create temporary directory
    tempDir = skillManager.createTempDirectory('device-skill');
    
    // 3. Extract zip to temporary directory
    logger.info('[SkillDeviceImporter] Extracting zip file...');
    const rootDirName = await skillManager.extractZip(zipPath, tempDir);
    extractedDir = path.join(tempDir, rootDirName);
    
    // 4. Validate skill package integrity and compliance
    const validation = skillManager.validateSkillPackage(extractedDir, rootDirName);
    if (!validation.valid) {
      skillManager.cleanupTempDirectory(tempDir);
      return { success: false, error: validation.error };
    }
    
    // 5. Get skill metadata
    const { metadata, error: metadataError } = skillManager.getSkillMetadata(extractedDir);
    if (!metadata || metadataError) {
      skillManager.cleanupTempDirectory(tempDir);
      return { success: false, error: metadataError || 'Failed to parse skill metadata' };
    }
    
    // 6. Check if a skill with the same name already exists
    const existingSkill = skillManager.checkSkillExists(userAlias, metadata.name);
    
    if (existingSkill) {
      // 6.1 Same-name skill exists, request user confirmation for overwrite
      logger.info(`[SkillDeviceImporter] Found existing skill "${metadata.name}", requesting user confirmation`);
      
      if (confirmCallback) {
        const userConfirmed = await confirmCallback(metadata.name);
        if (!userConfirmed) {
          // 6.2 User cancelled overwrite, clean up temp files and end flow
          skillManager.cleanupTempDirectory(tempDir);
          return { success: false, error: 'User cancelled the operation' };
        }
      } else {
        // No confirmation callback provided, return error directly
        skillManager.cleanupTempDirectory(tempDir);
        return {
          success: false,
          error: `A skill with the name "${metadata.name}" is already installed. Use confirmation callback to handle overwrite.`
        };
      }
    }
    
    // 7. Determine the final version (priority: metadata version > filename version > default/existing version)
    const finalVersion = skillManager.determineVersion(
      metadata.version, // version field in SKILL.md
      fileVersion,      // Version parsed from filename
      existingSkill     // Existing skill with same name
    );
    logger.info(`[SkillDeviceImporter] Using version: ${finalVersion} (metadata: ${metadata.version || 'none'}, filename: ${fileVersion || 'none'})`);
    
    // 8. Install skill
    logger.info('[SkillDeviceImporter] Installing skill...');
    
    const skillConfig = {
      name: metadata.name,
      description: metadata.description,
      version: finalVersion,
      source: 'ON-DEVICE' as const
    };
    
    const installResult = await skillManager.installSkill(
      userAlias,
      skillConfig,
      extractedDir,
      !!existingSkill
    );
    
    if (!installResult.success) {
      skillManager.cleanupTempDirectory(tempDir);
      return { success: false, error: installResult.error };
    }
    
    logger.info('[SkillDeviceImporter] Skill installed successfully:', metadata.name);
    return { success: true, skillName: metadata.name, isOverwrite: !!existingSkill };
    
  } catch (error) {
    // Clean up temp files
    if (tempDir) {
      skillManager.cleanupTempDirectory(tempDir);
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[SkillDeviceImporter] Failed to add skill from device:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Update skill from local device (dedicated for update operations, includes skill name validation)
 */
export async function updateSkillFromDevice(
  zipPath: string,
  userAlias: string,
  targetSkillName: string,
  validateSkillNameCallback?: (detectedSkillName: string) => Promise<boolean>,
  confirmCallback?: (skillName: string) => Promise<boolean>
): Promise<{ success: boolean; error?: string; skillName?: string }> {
  let tempDir: string | null = null;
  let extractedDir: string | null = null;
  
  try {
    logger.info(`[SkillDeviceImporter] Updating skill from device: ${zipPath} for user: ${userAlias}, target: ${targetSkillName}`);
    
    // 1. Extract skill name and version from zip filename
    const zipFileName = path.basename(zipPath);
    const { skillName: fileSkillName, version: fileVersion } = skillManager.parseSkillFileName(zipFileName);
    logger.info(`[SkillDeviceImporter] Parsed from filename - skill: "${fileSkillName}", version: ${fileVersion || 'none'}`);
    
    // 2. Create temporary directory
    tempDir = skillManager.createTempDirectory('update-skill');
    
    // 3. Extract zip to temporary directory
    logger.info('[SkillDeviceImporter] Extracting zip file...');
    const rootDirName = await skillManager.extractZip(zipPath, tempDir);
    extractedDir = path.join(tempDir, rootDirName);
    
    // 4. Validate skill package integrity and compliance
    const validation = skillManager.validateSkillPackage(extractedDir, rootDirName);
    if (!validation.valid) {
      skillManager.cleanupTempDirectory(tempDir);
      return { success: false, error: validation.error };
    }
    
    // 5. Get skill metadata
    const { metadata, error: metadataError } = skillManager.getSkillMetadata(extractedDir);
    if (!metadata || metadataError) {
      skillManager.cleanupTempDirectory(tempDir);
      return { success: false, error: metadataError || 'Failed to parse skill metadata' };
    }
    
    // 6. Validate skill name matches target skill
    if (validateSkillNameCallback) {
      const nameValidationResult = await validateSkillNameCallback(metadata.name);
      if (!nameValidationResult) {
        // Skill name validation failed
        skillManager.cleanupTempDirectory(tempDir);
        return {
          success: false,
          error: `Validation failed: The selected zip file contains skill "${metadata.name}" but you are trying to update skill "${targetSkillName}". Please select the correct zip file for skill "${targetSkillName}".`
        };
      }
    } else {
      // Fallback: direct name comparison if no callback provided
      if (metadata.name !== targetSkillName) {
        skillManager.cleanupTempDirectory(tempDir);
        return {
          success: false,
          error: `Validation failed: The selected zip file contains skill "${metadata.name}" but you are trying to update skill "${targetSkillName}". Please select the correct zip file for skill "${targetSkillName}".`
        };
      }
    }
    
    // 7. Check if target skill exists (must exist for update)
    const existingSkill = skillManager.checkSkillExists(userAlias, metadata.name);
    
    if (!existingSkill) {
      // Target skill doesn't exist, cannot update
      skillManager.cleanupTempDirectory(tempDir);
      return {
        success: false,
        error: `Cannot update skill "${metadata.name}" because it does not exist. Use "Add from Device" to install it first.`
      };
    }
    
    // 8. Request user confirmation for update operation
    if (confirmCallback) {
      const userConfirmed = await confirmCallback(metadata.name);
      if (!userConfirmed) {
        // User cancelled update, clean up temp files and end flow
        skillManager.cleanupTempDirectory(tempDir);
        return { success: false, error: 'User cancelled the operation' };
      }
    }
    
    // 9. Determine the final version (priority: metadata version > filename version > existing version)
    const finalVersion = skillManager.determineVersion(
      metadata.version, // version field in SKILL.md
      fileVersion,      // Version parsed from filename
      existingSkill     // Existing skill with same name
    );
    logger.info(`[SkillDeviceImporter] Using version: ${finalVersion} (metadata: ${metadata.version || 'none'}, filename: ${fileVersion || 'none'})`);
    
    // 10. Update skill
    logger.info('[SkillDeviceImporter] Updating skill...');
    
    const skillConfig = {
      name: metadata.name,
      description: metadata.description,
      version: finalVersion,
      source: 'ON-DEVICE' as const
    };
    
    const installResult = await skillManager.installSkill(
      userAlias,
      skillConfig,
      extractedDir,
      true // isUpdate = true (overwrite existing skill)
    );
    
    if (!installResult.success) {
      skillManager.cleanupTempDirectory(tempDir);
      return { success: false, error: installResult.error };
    }
    
    logger.info('[SkillDeviceImporter] Skill updated successfully:', metadata.name);
    return { success: true, skillName: metadata.name };
    
  } catch (error) {
    // Clean up temp files
    if (tempDir) {
      skillManager.cleanupTempDirectory(tempDir);
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[SkillDeviceImporter] Failed to update skill from device:', errorMessage);
    return { success: false, error: errorMessage };
  }
}