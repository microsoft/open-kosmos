import { app, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

import type { Context } from './shared';
import { installAndActivateSkill } from "../../lib/skill/installAndActivateSkill";
import { applySkillToAgents } from "../../lib/skill/applySkillToAgents";
import { updateSkillFromDevice } from "../../lib/skill/skillDeviceImporter";
import { deleteInstalledSkill } from "../../lib/skill/deleteInstalledSkill";
export default function(ctx: Context) {

  const resolveSingleSelectedPath = (result: unknown): string | undefined => {
    if (Array.isArray(result)) {
      return result.length > 0 ? result[0] : undefined;
    }

    const dialogResult = result as { canceled?: boolean; filePaths?: string[] };
    if (dialogResult?.canceled || !dialogResult?.filePaths || dialogResult.filePaths.length === 0) {
      return undefined;
    }

    return dialogResult.filePaths[0];
  };

  const selectSkillArtifactPath = async (titles?: {
    mode?: string;
    file?: string;
    folder?: string;
    detail?: string;
  }, selectionMode?: 'artifact' | 'folder'): Promise<string | undefined> => {
    if (!ctx.mainWindow) {
      return undefined;
    }

    const modeTitle = titles?.mode || 'Select Skill Artifact Type';
    const fileTitle = titles?.file || 'Select Skill Artifact';
    const folderTitle = titles?.folder || 'Select Skill Folder';
    const modeDetail = titles?.detail || 'Select File for .zip/.skill, or Folder for a skill directory.';

    if (selectionMode === 'artifact') {
      const fileResult = await dialog.showOpenDialog(ctx.mainWindow, {
        title: fileTitle,
        properties: ['openFile'],
        filters: [
          { name: 'Skill Artifact', extensions: ['zip', 'skill'] }
        ]
      });
      return resolveSingleSelectedPath(fileResult);
    }

    if (selectionMode === 'folder') {
      const folderResult = await dialog.showOpenDialog(ctx.mainWindow, {
        title: folderTitle,
        properties: ['openDirectory'],
      });
      return resolveSingleSelectedPath(folderResult);
    }

    // Windows cannot reliably support selecting files and folders in one native dialog.
    // Ask for input type first, then open the matching dialog to keep behavior consistent across platforms.
    if (process.platform === 'win32') {
      const modeResult = await dialog.showMessageBox(ctx.mainWindow, {
        type: 'question',
        title: modeTitle,
        message: 'Choose how you want to import the skill.',
        detail: modeDetail,
        buttons: ['Cancel', 'File (.zip/.skill)', 'Folder'],
        defaultId: 1,
        cancelId: 0,
      });

      const selectedMode = typeof modeResult === 'number'
        ? modeResult
        : (modeResult as { response?: number }).response ?? 0;

      if (selectedMode === 0) {
        return undefined;
      }

      if (selectedMode === 1) {
        const fileResult = await dialog.showOpenDialog(ctx.mainWindow, {
          title: fileTitle,
          properties: ['openFile'],
          filters: [
            { name: 'Skill Artifact', extensions: ['zip', 'skill'] }
          ]
        });
        return resolveSingleSelectedPath(fileResult);
      }

      const folderResult = await dialog.showOpenDialog(ctx.mainWindow, {
        title: folderTitle,
        properties: ['openDirectory'],
      });
      return resolveSingleSelectedPath(folderResult);
    }

    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: fileTitle,
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'Skill Artifact', extensions: ['zip', 'skill'] }
      ]
    });

    return resolveSingleSelectedPath(result);
  };

  // Install skill from a known file path (e.g., from file card / assistant message attachment)
  ipcMain.handle('skillLibrary:installSkillFromFilePath', async (event, filePath: string, options?: { chatId?: string; applyToCurrentAgent?: boolean; agentName?: string; requestSource?: string }) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      if (!filePath) {
        return { success: false, error: 'File path is required' };
      }


      // Create confirmation callback for overwrite scenarios
      const confirmCallback = async (skillName: string): Promise<boolean> => {
        if (!ctx.mainWindow) {
          return false;
        }

        const confirmResult = await dialog.showMessageBox(ctx.mainWindow, {
          type: 'warning',
          title: 'Skill Already Exists',
          message: `A skill named "${skillName}" already exists.`,
          detail: 'Do you want to replace it with the new version? This action cannot be undone.',
          buttons: ['Cancel', 'Replace'],
          defaultId: 0,
          cancelId: 0
        });

        if (typeof confirmResult === 'number') {
          return confirmResult === 1;
        } else {
          return (confirmResult as any).response === 1;
        }
      };

      const importResult = await installAndActivateSkill({
        userAlias: ctx.currentUserAlias,
        source: { type: 'device-path', value: filePath },
        activation: {
          mode: options?.applyToCurrentAgent ? 'current-agent' : 'install-only',
          chatId: options?.chatId,
          agentName: options?.agentName,
        },
        requestSource: options?.requestSource,
        confirmOverwrite: confirmCallback,
      });

      return {
        success: importResult.success,
        skillName: importResult.skillName,
        skillVersion: importResult.skillVersion,
        error: importResult.error,
        isOverwrite: importResult.install.isOverwrite,
        inputType: importResult.inputType,
        resolution: importResult.resolution,
        currentChat: importResult.currentChat,
        activation: importResult.activation,
        message: importResult.message,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Add skill from local device (.zip, .skill, or folder)
  ipcMain.handle('skillLibrary:addSkillFromDevice', async (event, selectedPath?: string, options?: { chatId?: string; applyToCurrentAgent?: boolean; agentName?: string; requestSource?: string; selectionMode?: 'artifact' | 'folder' }) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      if (!ctx.mainWindow) {
        return { success: false, error: 'No main window available' };
      }

      let skillInputPath = selectedPath;

      if (!skillInputPath) {
        skillInputPath = await selectSkillArtifactPath(undefined, options?.selectionMode);
      }

      if (!skillInputPath) {
        return { success: false, error: 'File selection canceled' };
      }

      // 2. Import and validate the skill with confirmation callback

      // Create confirmation callback for overwrite scenarios
      const confirmCallback = async (skillName: string): Promise<boolean> => {
        if (!ctx.mainWindow) {
          return false;
        }

        const confirmResult = await dialog.showMessageBox(ctx.mainWindow, {
          type: 'warning',
          title: 'Skill Already Exists',
          message: `A skill named "${skillName}" already exists.`,
          detail: 'Do you want to replace it with the new version? This action cannot be undone.',
          buttons: ['Cancel', 'Replace'],
          defaultId: 0,
          cancelId: 0
        });

        // Handle both old and new Electron API formats
        if (typeof confirmResult === 'number') {
          return confirmResult === 1; // Old API format
        } else {
          return (confirmResult as any).response === 1; // New API format - use type assertion
        }
      };

      const importResult = await installAndActivateSkill({
        userAlias: ctx.currentUserAlias,
        source: { type: 'device-path', value: skillInputPath },
        activation: {
          mode: options?.applyToCurrentAgent ? 'current-agent' : 'install-only',
          chatId: options?.chatId,
          agentName: options?.agentName,
        },
        requestSource: options?.requestSource,
        confirmOverwrite: confirmCallback,
      });

      return {
        success: importResult.success,
        skillName: importResult.skillName,
        skillVersion: importResult.skillVersion,
        error: importResult.error,
        isOverwrite: importResult.install.isOverwrite,
        inputType: importResult.inputType,
        resolution: importResult.resolution,
        currentChat: importResult.currentChat,
        activation: importResult.activation,
        message: importResult.message,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('skillLibrary:applySkillToAgents', async (event, skillName: string, targets?: Array<{ chatId: string; agentName: string }>) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      return await applySkillToAgents(ctx.currentUserAlias, {
        skillName,
        targets,
      });
    } catch (error) {
      return {
        success: false,
        skillName,
        message: error instanceof Error ? error.message : 'Unknown error',
        appliedCount: 0,
        alreadyAppliedCount: 0,
        failedCount: 0,
        appliedTargets: [],
        skippedTargets: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Update skill from local device (.zip, .skill, or folder) with specific skill name validation
  ipcMain.handle('skillLibrary:updateSkillFromDevice', async (event, targetSkillName: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      if (!ctx.mainWindow) {
        return { success: false, error: 'No main window available' };
      }

      if (!targetSkillName) {
        return { success: false, error: 'Target skill name is required for update' };
      }

      const selectedPath = await selectSkillArtifactPath({
        mode: 'Select Skill Artifact Type to Update',
        file: 'Select Skill Artifact to Update',
        folder: 'Select Skill Folder to Update',
      });

      if (!selectedPath) {
        return { success: false, error: 'File selection canceled' };
      }

      // 2. Import and validate the skill with skillName validation callback

      // Create skillName validation callback for update scenarios
      const validateSkillNameCallback = async (detectedSkillName: string): Promise<boolean> => {
        // Check if detected skill name matches the target skill name
        if (detectedSkillName !== targetSkillName) {
          return false; // Validation failed - skill names don't match
        }
        return true; // Validation passed - proceed with update
      };

      // Create confirmation callback for overwrite scenarios (always confirm for updates)
      const confirmCallback = async (skillName: string): Promise<boolean> => {
        if (!ctx.mainWindow) {
          return false;
        }

        const confirmResult = await dialog.showMessageBox(ctx.mainWindow, {
          type: 'question',
          title: 'Update Skill',
          message: `Update skill "${skillName}"?`,
          detail: 'This will replace the existing skill with the new version. This action cannot be undone.',
          buttons: ['Cancel', 'Update'],
          defaultId: 1,
          cancelId: 0
        });

        // Handle both old and new Electron API formats
        if (typeof confirmResult === 'number') {
          return confirmResult === 1; // Old API format
        } else {
          return (confirmResult as any).response === 1; // New API format - use type assertion
        }
      };

      const importResult = await updateSkillFromDevice(selectedPath, ctx.currentUserAlias, targetSkillName, validateSkillNameCallback, confirmCallback);

      return importResult;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Skills - AUTHORIZED
  // Get SKILL.md file content for Skill
  ipcMain.handle('skills:getSkillMarkdown', async (event, skillName: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      // Build SKILL.md file path
      // {app user data folder}/profiles/{user alias}/skills/{skill-name}/SKILL.md
      const skillMarkdownPath = path.join(
        app.getPath('userData'),
        'profiles',
        ctx.currentUserAlias,
        'skills',
        skillName,
        'SKILL.md'
      );

      // Check if file exists
      if (!fs.existsSync(skillMarkdownPath)) {
        return { success: false, error: `SKILL.md not found for skill: ${skillName}` };
      }

      // Read file content
      const content = fs.readFileSync(skillMarkdownPath, 'utf8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get list of files and directories in Skill directory
  ipcMain.handle('skills:getSkillDirectoryContents', async (event, skillName: string, relativePath: string = '') => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      // Build Skill directory path
      const skillBasePath = path.join(
        app.getPath('userData'),
        'profiles',
        ctx.currentUserAlias,
        'skills',
        skillName
      );

      // Build full path
      const fullPath = relativePath ? path.join(skillBasePath, relativePath) : skillBasePath;

      // Security check: ensure path is within skill directory
      const normalizedFullPath = path.normalize(fullPath);
      const normalizedBasePath = path.normalize(skillBasePath);
      if (!normalizedFullPath.startsWith(normalizedBasePath)) {
        return { success: false, error: 'Invalid path: attempted to access outside skill directory' };
      }

      // Check if directory exists
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Directory not found: ${relativePath || '/'}` };
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path is not a directory' };
      }

      // Read directory content
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });

      const items = entries.map(entry => {
        const itemPath = path.join(fullPath, entry.name);
        const itemStats = fs.statSync(itemPath);
        const itemRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        return {
          name: entry.name,
          path: itemRelativePath,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          size: itemStats.size,
          modifiedTime: itemStats.mtime.toISOString(),
          extension: entry.isFile() ? path.extname(entry.name).toLowerCase().slice(1) : null
        };
      });

      // Sort: directories first, files second, each sorted by name
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        success: true,
        data: {
          currentPath: relativePath || '/',
          parentPath: relativePath ? path.dirname(relativePath) || null : null,
          items
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Read file content in Skill directory
  ipcMain.handle('skills:getSkillFileContent', async (event, skillName: string, relativePath: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      if (!relativePath) {
        return { success: false, error: 'File path is required' };
      }

      // Build Skill directory path
      const skillBasePath = path.join(
        app.getPath('userData'),
        'profiles',
        ctx.currentUserAlias,
        'skills',
        skillName
      );

      // Build full path
      const fullPath = path.join(skillBasePath, relativePath);

      // Security check: ensure path is within skill directory
      const normalizedFullPath = path.normalize(fullPath);
      const normalizedBasePath = path.normalize(skillBasePath);
      if (!normalizedFullPath.startsWith(normalizedBasePath)) {
        return { success: false, error: 'Invalid path: attempted to access outside skill directory' };
      }

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${relativePath}` };
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) {
        return { success: false, error: 'Path is not a file' };
      }

      // Get file extension
      const extension = path.extname(relativePath).toLowerCase().slice(1);
      const fileName = path.basename(relativePath);

      // Supported text file types
      const supportedTextExtensions = ['md', 'js', 'ts', 'jsx', 'tsx', 'py', 'json', 'yaml', 'yml', 'txt', 'css', 'html', 'xml'];

      if (!supportedTextExtensions.includes(extension)) {
        return {
          success: true,
          data: {
            fileName,
            path: relativePath,
            extension,
            content: null,
            isSupported: false,
            size: stats.size,
            modifiedTime: stats.mtime.toISOString()
          }
        };
      }

      // Read file content
      const content = fs.readFileSync(fullPath, 'utf8');

      return {
        success: true,
        data: {
          fileName,
          path: relativePath,
          extension,
          content,
          isSupported: true,
          size: stats.size,
          modifiedTime: stats.mtime.toISOString()
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Delete Skill (delete cache config, profile.json config, and folder)
  ipcMain.handle('skills:deleteSkill', async (event, skillName: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }
      const deleteResult = await deleteInstalledSkill(ctx.currentUserAlias, skillName);
      if (!deleteResult.success) {
        return { success: false, error: deleteResult.error || 'Failed to delete skill' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Open Skill folder (in Finder/File Explorer)
  ipcMain.handle('skills:openSkillFolder', async (event, skillName: string) => {
    try {
      if (!ctx.currentUserAlias) {
        return { success: false, error: 'No current user alias set' };
      }

      // Build Skill directory path
      const skillPath = path.join(
        app.getPath('userData'),
        'profiles',
        ctx.currentUserAlias,
        'skills',
        skillName
      );

      // Check if directory exists
      if (!fs.existsSync(skillPath)) {
        return { success: false, error: `Skill directory not found: ${skillName}` };
      }

      // Open directory in file manager
      await shell.openPath(skillPath);

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

