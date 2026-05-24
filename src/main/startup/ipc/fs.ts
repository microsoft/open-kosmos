import { ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { getAdvancedLogger } from '../lazy';
import type { Context, ImportConflictResolution } from './shared';
import { promptImportConflictResolution, getUniqueImportPath } from './shared';

export default function(ctx: Context) {

  // Delete files or directories (supports recursive directory deletion)
  // Use shell.trashItem to move to trash, safer and handles permission issues
  ipcMain.handle('fs:deletePaths', async (event, paths: string[]) => {
    try {
      const results: { path: string; success: boolean; error?: string }[] = [];

      for (const targetPath of paths) {
        try {
          // Security check: ensure path exists
          if (!fs.existsSync(targetPath)) {
            results.push({ path: targetPath, success: false, error: 'Path does not exist' });
            continue;
          }

          // Use shell.trashItem to move to trash
          // This is safer (user can recover) and handles permission issues with system files like .DS_Store
          await shell.trashItem(targetPath);

          results.push({ path: targetPath, success: true });
        } catch (err) {
          // If trashItem fails, try deleting using traditional method
          try {
            const stats = fs.statSync(targetPath);

            if (stats.isDirectory()) {
              // Recursively delete directory
              fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
              // Delete file
              fs.unlinkSync(targetPath);
            }

            results.push({ path: targetPath, success: true });
          } catch (fallbackErr) {
            results.push({
              path: targetPath,
              success: false,
              error: fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error'
            });
          }
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      return {
        success: failCount === 0,
        results,
        successCount,
        failCount
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // File system handlers for VSCode import
  ipcMain.handle('fs:exists', async (event, filePath: string) => {
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('fs:listDir', async (event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      return {
        success: true,
        entries: entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('fs:access', async (event, filePath: string) => {
    try {
      // Check if file is readable
      fs.accessSync(filePath, fs.constants.R_OK);
      const readable = true;

      // Check if file is writable
      let writable = false;
      try {
        fs.accessSync(filePath, fs.constants.W_OK);
        writable = true;
      } catch {
        // File is not writable, but that's okay for reading
      }

      return { readable, writable };
    } catch (error) {
      return { readable: false, writable: false };
    }
  });

  ipcMain.handle('fs:readFile', async (event, filePath: string, encoding?: BufferEncoding | 'base64') => {
    try {
      const stats = fs.statSync(filePath);

      let content: string;
      if (encoding === 'base64') {
        // 🔥 Binary file: read as Buffer then convert to base64 string
        const buffer = fs.readFileSync(filePath);
        content = buffer.toString('base64');
      } else {
        // Text file: use specified encoding or default utf8
        content = fs.readFileSync(filePath, encoding || 'utf8');
      }

      return {
        success: true,
        content,
        size: stats.size,
        lastModified: stats.mtime.getTime()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });



  ipcMain.handle('fs:writeFile', async (
    event,
    filePath: string,
    content: string,
    encoding?: BufferEncoding,
    options?: { conflictResolution?: ImportConflictResolution },
  ) => {
    try {
      // Ensure directory exists
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const strategy = options?.conflictResolution || 'reject';
      const targetExisted = fs.existsSync(filePath);
      let finalPath = filePath;

      if (targetExisted) {
        if (strategy === 'reject') {
          return {
            success: false,
            error: `Target path already exists: ${path.basename(filePath)}`,
          };
        }

        if (strategy === 'prompt') {
          const decision = await promptImportConflictResolution(event, 'save this file', [{
            id: filePath,
            displayName: path.basename(filePath),
            desiredPath: filePath,
            reason: 'already-exists',
          }]);

          if (decision === 'cancel') {
            return {
              success: false,
              canceled: true,
              error: 'User canceled conflict resolution',
            };
          }

          if (decision === 'skip') {
            return {
              success: true,
              skipped: true,
            };
          }

          if (decision === 'keep-both') {
            finalPath = getUniqueImportPath(filePath, new Set<string>());
          }
        } else if (strategy === 'keep-both') {
          finalPath = getUniqueImportPath(filePath, new Set<string>());
        } else if (strategy === 'skip') {
          return {
            success: true,
            skipped: true,
          };
        }
      }

      // Write file
      fs.writeFileSync(finalPath, content, encoding || 'utf8');

      return {
        success: true,
        filePath: finalPath,
        replaced: targetExisted && finalPath === filePath,
        renamed: finalPath !== filePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('fs:stat', async (event, filePath: string) => {
    try {
      const stats = fs.statSync(filePath);

      return {
        success: true,
        stats: {
          size: stats.size,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          mtime: stats.mtime.getTime(),
          atime: stats.atime.getTime(),
          birthtime: stats.birthtime.getTime()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('fs:expandPath', async (event, filePath: string) => {
    try {
      // Expand environment variables and tilde
      let expandedPath = filePath;

      // Handle tilde expansion
      if (expandedPath.startsWith('~/')) {
        expandedPath = path.join(os.homedir(), expandedPath.slice(2));
      }

      // Handle Windows environment variables
      if (process.platform === 'win32') {
        expandedPath = expandedPath.replace(/%([^%]+)%/g, (match, envVar) => {
          return process.env[envVar] || match;
        });
      }

      // Handle Unix-style environment variables
      expandedPath = expandedPath.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (match, envVar) => {
        return process.env[envVar] || match;
      });

      return expandedPath;
    } catch (error) {
      return filePath; // Return original path if expansion fails
    }
  });

  ipcMain.handle('fs:selectFile', async (event, options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => {
    try {
      if (!ctx.mainWindow) {
        return {
          success: false,
          error: 'No main window available'
        };
      }

      const dialogOptions: Electron.OpenDialogOptions = {
        title: options?.title || 'Select File',
        properties: ['openFile'],
        filters: options?.filters || [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      };

      const result = await dialog.showOpenDialog(ctx.mainWindow, dialogOptions);

      // Handle the result properly - check if it's the old format or new format
      if (Array.isArray(result)) {
        // Old API format (just file paths array)
        if (result.length === 0) {
          return {
            success: false,
            error: 'File selection canceled'
          };
        }
        return {
          success: true,
          filePath: result[0]
        };
      } else {
        // New API format (object with canceled and filePaths)
        const dialogResult = result as any;
        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
          return {
            success: false,
            error: 'File selection canceled'
          };
        }
        return {
          success: true,
          filePath: dialogResult.filePaths[0]
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // New: API implementation for getting complete file metadata
  ipcMain.handle('fs:getFileMetadata', async (event, filePath: string) => {
    try {
      const stats = fs.statSync(filePath);
      const fileName = path.basename(filePath);
      const fileExtension = path.extname(filePath).toLowerCase().slice(1);

      // Detect MIME type
      const mimeTypeMap: { [key: string]: string } = {
        'txt': 'text/plain',
        'md': 'text/markdown',
        'js': 'text/javascript',
        'ts': 'text/typescript',
        'jsx': 'text/javascript',
        'tsx': 'text/typescript',
        'css': 'text/css',
        'html': 'text/html',
        'json': 'application/json',
        'xml': 'application/xml',
        'yaml': 'text/yaml',
        'yml': 'text/yaml',
        'py': 'text/x-python',
        'java': 'text/x-java',
        'c': 'text/x-c',
        'cpp': 'text/x-cpp',
        'cs': 'text/x-csharp',
        'go': 'text/x-go',
        'rs': 'text/x-rust'
      };

      const mimeType = mimeTypeMap[fileExtension] || 'text/plain';
      const isTextFile = Object.keys(mimeTypeMap).includes(fileExtension);

      // If it is a text file, calculate line count
      let lineCount: number | undefined;
      if (isTextFile && stats.size < 50 * 1024 * 1024) { // Only process files smaller than 50MB
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          lineCount = content.split('\n').length;
        } catch {
          // If read fails, do not set line count
        }
      }

      return {
        success: true,
        metadata: {
          fullPath: filePath,
          fileName: fileName,
          fileSize: stats.size,
          fileType: fileExtension,
          mimeType: mimeType,
          lineCount: lineCount,
          lastModified: stats.mtime.getTime(),
          isTextFile: isTextFile
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // New: download file from URL to local path
  ipcMain.handle('fs:downloadFile', async (event, url: string, destPath: string) => {
    try {
      // Ensure destination directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Download the file using fetch
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destPath, buffer);

      getAdvancedLogger().info(`[fs:downloadFile] Downloaded ${url} to ${destPath}`, 'fs:downloadFile');

      return {
        success: true,
        filePath: destPath,
        size: buffer.length
      };
    } catch (error) {
      getAdvancedLogger().error(`[fs:downloadFile] Failed to download ${url}:`, 'fs:downloadFile', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // New: API implementation for selecting multiple files
  ipcMain.handle('fs:selectFiles', async (event, options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    allowMultiple?: boolean;
  }) => {
    const logger = getAdvancedLogger();
    logger.info('[fs:selectFiles] Dialog requested', 'fs:selectFiles', { options });
    try {
      if (!ctx.mainWindow) {
        logger.warn('[fs:selectFiles] No main window available', 'fs:selectFiles', {});
        return {
          success: false,
          error: 'No main window available'
        };
      }

      const dialogOptions: Electron.OpenDialogOptions = {
        title: options?.title || 'Select Files',
        properties: options?.allowMultiple ? ['openFile', 'multiSelections'] : ['openFile'],
        // Do not set filters, show all file types by default
        // On Windows, if both '*' wildcard and specific extensions exist, the wildcard is skipped in favor of specific extensions
        filters: options?.filters
      };

      const result = await dialog.showOpenDialog(ctx.mainWindow, dialogOptions);
      logger.info('[fs:selectFiles] Dialog closed', 'fs:selectFiles', { raw: JSON.stringify(result) });

      // Handle the result properly - check if it's the old format or new format
      if (Array.isArray(result)) {
        // Old API format (just file paths array)
        if (result.length === 0) {
          logger.info('[fs:selectFiles] Canceled (old API format)', 'fs:selectFiles', {});
          return {
            success: false,
            error: 'File selection canceled'
          };
        }
        logger.info('[fs:selectFiles] Selected (old API format)', 'fs:selectFiles', { filePaths: result });
        return {
          success: true,
          filePaths: result
        };
      } else {
        // New API format (object with canceled and filePaths)
        const dialogResult = result as any;
        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
          logger.info('[fs:selectFiles] Canceled', 'fs:selectFiles', {});
          return {
            success: false,
            error: 'File selection canceled'
          };
        }
        logger.info('[fs:selectFiles] Selected', 'fs:selectFiles', { filePaths: dialogResult.filePaths });
        return {
          success: true,
          filePaths: dialogResult.filePaths
        };
      }
    } catch (error) {
      logger.error('[fs:selectFiles] Error', 'fs:selectFiles', { error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

}

