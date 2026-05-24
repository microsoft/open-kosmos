import { ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

import { getAdvancedLogger } from '../lazy';
import type { Context, ImportConflictResolution } from './shared';
import { collectImportConflicts, planImportTargets, promptImportConflictResolution } from './shared';
import { getWorkspaceWatcher } from "../../lib/workspace/WorkspaceWatcher";
import { getDefaultWorkspacePath } from "../../lib/userDataADO/pathUtils";

export default function(ctx: Context) {

  // ===============================
  // Workspace related IPC handlers
  // ===============================

  // Select workspace folder
  ipcMain.handle('workspace:selectFolder', async () => {
    try {
      if (!ctx.mainWindow) {
        return {
          success: false,
          error: 'No main window available'
        };
      }

      const dialogOptions: Electron.OpenDialogOptions = {
        title: 'Select Workspace Folder',
        properties: ['openDirectory'],
        buttonLabel: 'Select Folder'
      };

      const result = await dialog.showOpenDialog(ctx.mainWindow, dialogOptions);

      // Handle the result properly
      if (Array.isArray(result)) {
        // Old API format (just file paths array)
        if (result.length === 0) {
          return {
            success: false,
            error: 'Folder selection canceled'
          };
        }
        return {
          success: true,
          folderPath: result[0]
        };
      } else {
        // New API format (object with canceled and filePaths)
        const dialogResult = result as any;
        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
          return {
            success: false,
            error: 'Folder selection canceled'
          };
        }
        return {
          success: true,
          folderPath: dialogResult.filePaths[0]
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get file tree structure - using ripgrep-based high-performance implementation
  ipcMain.handle('workspace:getFileTree', async (event, workspacePath: string, options?: {
    maxDepth?: number;
    ignorePatterns?: string[];
  }) => {
    try {
      // 🔥 Fix: normalize path separators to prevent startsWith check failures caused by mixed slashes on Windows
      workspacePath = path.normalize(workspacePath);
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return {
          success: false,
          error: 'Invalid workspace path'
        };
      }


      // Use FileTreeService (ripgrep-based)
      const watcher = getWorkspaceWatcher();

      // Convert ignorePatterns to excludePattern
      const excludePattern = options?.ignorePatterns?.join(',');

      const result = await watcher.getFileTree({
        folder: workspacePath,
        maxDepth: options?.maxDepth, // Do not set default value, allow undefined to enable unlimited depth
        excludePattern,
        includeHidden: true,
        useGitignore: true
      });

      // Convert to frontend-expected format (with path safety validation and absolute path conversion)
      const convertNodeFormat = (node: any, workspacePath: string): any => {
        if (!node) return null;

        // 🔥 Critical fix: ensure all paths are absolute paths
        let safePath = node.path;

        // Detailed debug log

        // 🔥 Force convert to absolute path
        if (!path.isAbsolute(safePath)) {
          // Relative path: join to workspace
          safePath = path.join(workspacePath, safePath);
        }

        // Normalize path
        safePath = path.normalize(safePath);

        // 🔥 Strict validation: ensure path is within workspace
        if (!safePath.startsWith(workspacePath)) {
          return null;
        }

        const converted: any = {
          name: node.name,
          path: safePath,
          type: node.isDirectory ? 'directory' : 'file'
        };

        // Add size information for file nodes
        if (!node.isDirectory) {
          try {
            const stats = fs.statSync(safePath);
            converted.size = stats.size;
          } catch (err) {
            converted.size = 0;
          }
        }

        // Directory nodes need to include children property, even for empty directories
        if (node.isDirectory) {
          const validChildren = node.children && node.children.length > 0
            ? node.children.map((child: any) => convertNodeFormat(child, workspacePath)).filter(Boolean)
            : [];
          converted.children = validChildren;
          converted.isExpanded = false;

        }

        return converted;
      };

      const tree = result.root.children?.map((child: any) => convertNodeFormat(child, workspacePath)).filter(Boolean) || [];


      return {
        success: true,
        data: {
          workspacePath,
          workspaceName: path.basename(workspacePath),
          tree
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Clear file tree cache - for refresh functionality
  ipcMain.handle('workspace:clearFileTreeCache', async (event, workspacePath?: string) => {
    try {

      const watcher = getWorkspaceWatcher();

      // Clear specified path or all cache
      watcher.clearFileTreeCache(workspacePath);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get direct children of directory (lazy-loaded file tree) - returns single level only, no recursion
  ipcMain.handle('workspace:getDirectoryChildren', async (event, dirPath: string, options?: {
    ignorePatterns?: string[];
  }) => {
    try {
      dirPath = path.normalize(dirPath);
      if (!dirPath || !fs.existsSync(dirPath)) {
        return { success: false, error: 'Invalid directory path' };
      }

      const ignoreSet = new Set(options?.ignorePatterns || [
        'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.vscode', '.idea'
      ]);

      // Use fs.readdir directly to get immediate children - ripgrep --files only
      // returns files and misses directories that contain no files at depth 1.
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      const children: any[] = [];
      for (const entry of entries) {
        // Skip ignored patterns
        if (ignoreSet.has(entry.name)) continue;

        const childPath = path.join(dirPath, entry.name);
        const isDirectory = entry.isDirectory() || entry.isSymbolicLink() && (() => {
          try { return fs.statSync(childPath).isDirectory(); } catch { return false; }
        })();

        const item: any = {
          name: entry.name,
          path: childPath,
          type: isDirectory ? 'directory' : 'file',
        };

        if (!isDirectory) {
          try { item.size = fs.statSync(childPath).size; } catch { item.size = 0; }
        }

        children.push(item);
      }

      // Sort: directories first, then files, both alphabetically
      children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { success: true, data: { dirPath, children } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Listen for workspace file changes - using real file system monitoring
  ipcMain.handle('workspace:startWatch', async (event, workspacePath: string, options?: {
    excludes?: string[];
    includes?: string[];
  }) => {
    try {

      const watcher = getWorkspaceWatcher();

      // Set up event listeners (if not already set)
      if (!watcher.listenerCount('fileChanged')) {
        watcher.on('fileChanged', (changes) => {
          // Send file change events to renderer process (check if webContents is still valid)
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('workspace:fileChanged', changes);
            }
          } catch (error) {
            // Ignore send failure errors (window may have been closed)
          }
        });

        watcher.on('watchError', (error) => {
          // Send error events to renderer process (check if webContents is still valid)
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('workspace:watchError', error);
            }
          } catch (err) {
            // Ignore send failure errors (window may have been closed)
          }
        });
      }

      // Start file monitoring
      await watcher.startFileWatch(workspacePath, options);

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Stop watching workspace
  ipcMain.handle('workspace:stopWatch', async () => {
    try {

      const watcher = getWorkspaceWatcher();

      await watcher.stopFileWatch();

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get file watcher statistics
  ipcMain.handle('workspace:getWatcherStats', async () => {
    try {
      const watcher = getWorkspaceWatcher();

      const stats = watcher.getWatcherStats();

      return {
        success: true,
        data: stats
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Search workspace files
  ipcMain.handle('workspace:searchFiles', async (event, query: {
    folder?: string;
    pattern?: string;
    maxResults?: number;
    fuzzy?: boolean;
    searchTarget?: 'files' | 'folders' | 'both';
  }) => {
    try {

      // Validate folder parameter
      if (!query.folder) {
        const errorMsg = 'Workspace folder path is required for file search. Please provide a valid workspace path.';
        return {
          success: false,
          error: errorMsg
        };
      }

      const watcher = getWorkspaceWatcher();

      // Call search service
      const result = await watcher.searchFiles(query as any);


      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Copy file or directory to target path
  const copyPathRecursive = (srcPath: string, finalTargetPath: string) => {
    const sourceStats = fs.statSync(srcPath);

    if (sourceStats.isDirectory()) {
      fs.mkdirSync(finalTargetPath, { recursive: true });
      const entries = fs.readdirSync(srcPath);
      for (const entry of entries) {
        const childSourcePath = path.join(srcPath, entry);
        const childTargetPath = path.join(finalTargetPath, entry);
        copyPathRecursive(childSourcePath, childTargetPath);
      }
      return sourceStats;
    }

    fs.mkdirSync(path.dirname(finalTargetPath), { recursive: true });
    fs.copyFileSync(srcPath, finalTargetPath);
    return sourceStats;
  };

  const executeWorkspaceCopy = async (
    event: Electron.IpcMainInvokeEvent,
    sourcePaths: string[],
    destPath: string,
    options?: { conflictResolution?: ImportConflictResolution },
  ) => {
    const logger = getAdvancedLogger();
    logger.info('[workspace:copyPaths] Copy requested', 'workspace:copyPaths', { sourcePaths, destPath, options });

    const strategy = options?.conflictResolution || 'reject';
    const results: Array<{ sourcePath: string; targetPath?: string; success: boolean; skipped?: boolean; renamed?: boolean; replaced?: boolean; error?: string }> = [];

    const validSourcePaths = sourcePaths.filter(Boolean);
    const missingSourcePaths = validSourcePaths.filter((sourcePath) => !fs.existsSync(sourcePath));
    for (const missingSourcePath of missingSourcePaths) {
      results.push({
        sourcePath: missingSourcePath,
        success: false,
        error: 'Source path does not exist',
      });
    }

    const plannedCandidates = validSourcePaths
      .filter((sourcePath) => fs.existsSync(sourcePath))
      .map((sourcePath, index) => ({
        id: String(index),
        sourcePath,
        sourceName: path.basename(sourcePath),
        desiredPath: path.join(destPath, path.basename(sourcePath)),
      }));

    const conflicts = collectImportConflicts(
      plannedCandidates.map((candidate) => ({
        id: candidate.id,
        displayName: candidate.sourceName,
        desiredPath: candidate.desiredPath,
      })),
    );

    let effectiveStrategy = strategy;
    if (strategy === 'prompt' && conflicts.length > 0) {
      const decision = await promptImportConflictResolution(event, 'add files', conflicts);
      if (decision === 'cancel') {
        return {
          success: false,
          canceled: true,
          error: 'User canceled conflict resolution',
          data: {
            results,
            successCount: 0,
            failCount: results.length,
            skippedCount: 0,
            renamedCount: 0,
          },
        };
      }
      effectiveStrategy = decision;
    }

    if (effectiveStrategy === 'reject' && conflicts.length > 0) {
      return {
        success: false,
        error: `Target path already exists: ${conflicts[0].displayName}`,
        data: {
          results,
          successCount: 0,
          failCount: results.length,
          skippedCount: 0,
          renamedCount: 0,
        },
      };
    }

    const plans = planImportTargets(plannedCandidates, effectiveStrategy as Exclude<ImportConflictResolution, 'prompt' | 'reject'>);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    for (const candidate of plannedCandidates) {
      try {
        const plan = planById.get(candidate.id);
        if (!plan) {
          results.push({
            sourcePath: candidate.sourcePath,
            success: false,
            error: 'Missing import plan',
          });
          continue;
        }

        if (plan.skipped) {
          results.push({
            sourcePath: candidate.sourcePath,
            success: true,
            skipped: true,
          });
          continue;
        }

        const finalTargetPath = plan.finalPath!;
        if (plan.replaceExisting && fs.existsSync(finalTargetPath)) {
          fs.rmSync(finalTargetPath, { recursive: true, force: true });
        }

        const sourceStats = copyPathRecursive(candidate.sourcePath, finalTargetPath);
        results.push({
          sourcePath: candidate.sourcePath,
          targetPath: finalTargetPath,
          success: true,
          renamed: !!plan.renamed,
          replaced: !!plan.replaceExisting,
        });
        logger.info('[workspace:copyPaths] Copy completed successfully', 'workspace:copyPaths', {
          sourcePath: candidate.sourcePath,
          finalTargetPath,
          isDirectory: sourceStats.isDirectory(),
        });
      } catch (error) {
        logger.error('[workspace:copyPaths] Copy failed', 'workspace:copyPaths', {
          sourcePath: candidate.sourcePath,
          destPath,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          sourcePath: candidate.sourcePath,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((result) => result.success && !result.skipped).length;
    const skippedCount = results.filter((result) => result.skipped).length;
    const failCount = results.filter((result) => !result.success).length;
    const renamedCount = results.filter((result) => result.renamed).length;

    return {
      success: true,
      data: {
        results,
        successCount,
        failCount,
        skippedCount,
        renamedCount,
      },
    };
  };

  ipcMain.handle('workspace:copyPaths', async (event, sourcePaths: string[], destPath: string, options?: { conflictResolution?: ImportConflictResolution }) => {
    return executeWorkspaceCopy(event, sourcePaths, destPath, options);
  });

  ipcMain.handle('workspace:copyPath', async (event, sourcePath: string, destPath: string, options?: { conflictResolution?: ImportConflictResolution }) => {
    const logger = getAdvancedLogger();
    logger.info('[workspace:copyPath] Copy requested', 'workspace:copyPath', { sourcePath, destPath });
    try {
      return executeWorkspaceCopy(event, [sourcePath], destPath, options);
    } catch (error) {
      logger.error('[workspace:copyPath] Copy failed', 'workspace:copyPath', { sourcePath, destPath, error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Move file or directory to target path
  ipcMain.handle('workspace:movePath', async (event, sourcePath: string, destPath: string, options?: { force?: boolean }) => {
    try {
      // Validate source path exists
      if (!fs.existsSync(sourcePath)) {
        return {
          success: false,
          error: 'Source path does not exist'
        };
      }

      // Ensure target directory exists
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      const sourceName = path.basename(sourcePath);
      const targetPath = path.join(destPath, sourceName);

      // Check if target path already exists
      if (fs.existsSync(targetPath)) {
        if (!options?.force) {
          return {
            success: false,
            error: 'TARGET_EXISTS',
            data: { targetPath, sourceName }
          };
        }
        // force mode: delete existing target first
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      // Try rename (efficient within same file system), fall back to copy + delete on failure
      try {
        fs.renameSync(sourcePath, targetPath);
      } catch (renameError) {
        // rename fails across file systems, use copy + delete
        const sourceStats = fs.statSync(sourcePath);
        if (sourceStats.isDirectory()) {
          const copyRecursive = (src: string, dest: string) => {
            fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src);
            for (const entry of entries) {
              const srcPath = path.join(src, entry);
              const dstPath = path.join(dest, entry);
              if (fs.statSync(srcPath).isDirectory()) {
                copyRecursive(srcPath, dstPath);
              } else {
                fs.copyFileSync(srcPath, dstPath);
              }
            }
          };
          copyRecursive(sourcePath, targetPath);
          fs.rmSync(sourcePath, { recursive: true, force: true });
        } else {
          fs.copyFileSync(sourcePath, targetPath);
          fs.unlinkSync(sourcePath);
        }
      }

      return {
        success: true,
        data: {
          sourcePath,
          targetPath,
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Open file or directory (with system default program)
  ipcMain.handle('workspace:openPath', async (event, targetPath: string) => {
    try {

      // Validate path exists
      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          error: 'Path does not exist'
        };
      }

      // Use shell.openPath to open file or directory
      const result = await shell.openPath(targetPath);

      if (result) {
        // If a non-empty string is returned, it indicates an error
        return {
          success: false,
          error: result
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Show file or directory in file manager
  ipcMain.handle('workspace:showInFolder', async (event, targetPath: string) => {
    try {

      // Validate path exists
      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          error: 'Path does not exist'
        };
      }

      // Use shell.showItemInFolder to show in file manager
      shell.showItemInFolder(targetPath);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });


  // Get default Workspace path
  ipcMain.handle('workspace:getDefaultWorkspacePath', async (event, alias: string, chatId: string) => {
    try {

      if (!alias || !chatId) {
        return {
          success: false,
          error: 'Both alias and chatId are required'
        };
      }

      const defaultPath = getDefaultWorkspacePath(alias, chatId);

      return {
        success: true,
        data: defaultPath
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}

