/**
 * Agent Assets Importer
 *
 * Import Agent assets (chat sessions and workspaces) from a zip package
 *
 * Zip package structure:
 *   xxx.zip
 *     |_workspace (or chat_workspaces)
 *     |        |_All files and directories in the workspace
 *     |
 *     |_chat_sessions
 *             |_index.json
 *             |_month1
 *             |    |_index.json
 *             |    |_chatSession_XXXXX.json
 *             |
 *             |_month2
 *                 |_index.json
 *                 |_chatSession_XXXXX.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import JSZip from 'jszip';
import { createConsoleLogger } from '../unifiedLogger';
import { chatSessionManager, ChatSessionsChatIndex, ChatSessionsMonthIndex } from './chatSessionManager';
import { ChatSession } from './types/profile';
import { ChatSessionFile } from './chatSessionFileOps';
import {
  getChatSessionsChatPath,
  getChatSessionsChatIndexPath,
  getChatSessionsMonthPath,
  getChatSessionsMonthIndexPath,
  getChatSessionFilePath,
  getDefaultWorkspacePath,
  extractMonthFromChatSessionId,
  isValidChatSessionId
} from './pathUtils';

const logger = createConsoleLogger();

/**
 * Import result
 */
export interface ImportResult {
  success: boolean;
  error?: string;
  importedSessions?: number;
  importedWorkspaceFiles?: number;
}

/**
 * Get the Agent's configured workspace path from profile.json
 */
async function getAgentWorkspacePath(alias: string, chatId: string): Promise<string | null> {
  try {
    const { profileCacheManager } = await import('./index');
    const chatConfig = profileCacheManager.getChatConfig(alias, chatId);
    
    if (chatConfig && chatConfig.agent && chatConfig.agent.workspace) {
      return chatConfig.agent.workspace;
    }
    
    // If workspace is not configured, return default path
    return getDefaultWorkspacePath(alias, chatId);
  } catch (error) {
    logger.warn('[AgentAssetsImporter] Failed to get agent workspace path, using default', 'getAgentWorkspacePath', {
      alias,
      chatId,
      error: error instanceof Error ? error.message : String(error)
    });
    return getDefaultWorkspacePath(alias, chatId);
  }
}

/**
 * Import Agent assets from a zip package
 * 
 * @param alias User alias
 * @param chatId Chat ID
 * @param zipFilePath Zip file path
 * @returns Import result
 */
export async function importAgentAssetsFromZip(
  alias: string,
  chatId: string,
  zipFilePath: string
): Promise<ImportResult> {
  let tempDir: string | null = null;
  
  try {
    logger.info('[AgentAssetsImporter] Starting import from zip', 'importAgentAssetsFromZip', {
      alias,
      chatId,
      zipFilePath
    });
    
    // Validate parameters
    if (!alias || !chatId || !zipFilePath) {
      return { success: false, error: 'Missing required parameters' };
    }
    
    // Verify zip file exists
    if (!fs.existsSync(zipFilePath)) {
      return { success: false, error: `Zip file not found: ${zipFilePath}` };
    }
    
    // Get workspace path from Agent configuration
    const agentWorkspacePath = await getAgentWorkspacePath(alias, chatId);
    
    logger.info('[AgentAssetsImporter] Got agent workspace path', 'importAgentAssetsFromZip', {
      alias,
      chatId,
      agentWorkspacePath
    });
    
    // Step 1: Extract zip package to temporary directory
    tempDir = await extractZipToTempDir(zipFilePath);
    if (!tempDir) {
      return { success: false, error: 'Failed to extract zip file' };
    }
    
    logger.info('[AgentAssetsImporter] Extracted zip to temp directory', 'importAgentAssetsFromZip', {
      tempDir
    });
    
    let importedSessions = 0;
    let importedWorkspaceFiles = 0;
    
    // Step 2: Copy workspace files to the Agent's configured workspace path
    const workspaceResult = await importWorkspaceFiles(alias, chatId, tempDir, agentWorkspacePath);
    if (workspaceResult.success) {
      importedWorkspaceFiles = workspaceResult.fileCount || 0;
    }
    
    // Step 3: Merge chat_sessions
    const chatSessionsResult = await importChatSessions(alias, chatId, tempDir);
    if (chatSessionsResult.success) {
      importedSessions = chatSessionsResult.sessionCount || 0;
    } else if (chatSessionsResult.error) {
      // If chat_sessions import failed, return error
      return { 
        success: false, 
        error: chatSessionsResult.error,
        importedWorkspaceFiles
      };
    }
    
    logger.info('[AgentAssetsImporter] Import completed successfully', 'importAgentAssetsFromZip', {
      alias,
      chatId,
      importedSessions,
      importedWorkspaceFiles
    });
    
    return {
      success: true,
      importedSessions,
      importedWorkspaceFiles
    };
    
  } catch (error) {
    logger.error('[AgentAssetsImporter] Import failed', 'importAgentAssetsFromZip', {
      alias,
      chatId,
      zipFilePath,
      error: error instanceof Error ? error.message : String(error)
    });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  } finally {
    // Step 5: Asynchronously delete temporary directory
    if (tempDir) {
      cleanupTempDir(tempDir);
    }
  }
}

/**
 * Extract zip file to temporary directory
 */
async function extractZipToTempDir(zipFilePath: string): Promise<string | null> {
  try {
    // Read zip file
    const zipBuffer = await fs.promises.readFile(zipFilePath);
    const zip = await JSZip.loadAsync(zipBuffer);
    
    // Create temporary directory
    const tempDir = path.join(os.tmpdir(), `kosmos-import-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Extract all files
    const entries = Object.entries(zip.files);
    for (const [relativePath, zipEntry] of entries) {
      const targetPath = path.join(tempDir, relativePath);
      
      if (zipEntry.dir) {
        // Create directory
        fs.mkdirSync(targetPath, { recursive: true });
      } else {
        // Ensure parent directory exists
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        
        // Write file
        const content = await zipEntry.async('nodebuffer');
        await fs.promises.writeFile(targetPath, content);
      }
    }
    
    // Check if there is a root directory wrapper (e.g. example-pm-agent-journeys/chat_sessions instead of direct chat_sessions)
    const actualContentDir = await findActualContentDir(tempDir);
    
    logger.info('[AgentAssetsImporter] Detected content directory', 'extractZipToTempDir', {
      tempDir,
      actualContentDir
    });
    
    return actualContentDir;
  } catch (error) {
    logger.error('[AgentAssetsImporter] Failed to extract zip', 'extractZipToTempDir', {
      zipFilePath,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Find the actual content directory
 * Handles the case where zip packages may have a root directory wrapper
 * e.g.: after extraction it might be tempDir/example-pm-agent-journeys/chat_sessions
 * instead of tempDir/chat_sessions directly
 */
async function findActualContentDir(tempDir: string): Promise<string> {
  // Check if tempDir directly contains chat_sessions or workspace/chat_workspaces
  const hasChatSessions = fs.existsSync(path.join(tempDir, 'chat_sessions'));
  const hasWorkspace = fs.existsSync(path.join(tempDir, 'workspace'));
  const hasChatWorkspaces = fs.existsSync(path.join(tempDir, 'chat_workspaces'));
  
  if (hasChatSessions || hasWorkspace || hasChatWorkspaces) {
    // Content is directly under tempDir
    return tempDir;
  }
  
  // Check if a subdirectory contains the content (common when zip has a root directory)
  const entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
  const subdirs = entries.filter(e => e.isDirectory());
  
  // If there's only one subdirectory, check if it contains the content
  if (subdirs.length === 1) {
    const subdir = path.join(tempDir, subdirs[0].name);
    const subHasChatSessions = fs.existsSync(path.join(subdir, 'chat_sessions'));
    const subHasWorkspace = fs.existsSync(path.join(subdir, 'workspace'));
    const subHasChatWorkspaces = fs.existsSync(path.join(subdir, 'chat_workspaces'));
    
    if (subHasChatSessions || subHasWorkspace || subHasChatWorkspaces) {
      logger.info('[AgentAssetsImporter] Found content in subdirectory', 'findActualContentDir', {
        subdirName: subdirs[0].name
      });
      return subdir;
    }
  }
  
  // If there are multiple subdirectories, check each for content
  for (const subdir of subdirs) {
    const subdirPath = path.join(tempDir, subdir.name);
    const subHasChatSessions = fs.existsSync(path.join(subdirPath, 'chat_sessions'));
    const subHasWorkspace = fs.existsSync(path.join(subdirPath, 'workspace'));
    const subHasChatWorkspaces = fs.existsSync(path.join(subdirPath, 'chat_workspaces'));
    
    if (subHasChatSessions || subHasWorkspace || subHasChatWorkspaces) {
      logger.info('[AgentAssetsImporter] Found content in subdirectory', 'findActualContentDir', {
        subdirName: subdir.name
      });
      return subdirPath;
    }
  }
  
  // Default: return original directory
  return tempDir;
}

/**
 * Import workspace files
 * @param alias User alias
 * @param chatId Chat ID
 * @param tempDir Temporary directory (extracted zip contents)
 * @param agentWorkspacePath Agent's configured workspace path (from profile.json)
 */
async function importWorkspaceFiles(
  alias: string,
  chatId: string,
  tempDir: string,
  agentWorkspacePath: string | null
): Promise<{ success: boolean; fileCount?: number; error?: string }> {
  try {
    // Check workspace or chat_workspaces directory
    let workspaceSourceDir = path.join(tempDir, 'workspace');
    if (!fs.existsSync(workspaceSourceDir)) {
      workspaceSourceDir = path.join(tempDir, 'chat_workspaces');
    }
    
    if (!fs.existsSync(workspaceSourceDir)) {
      logger.info('[AgentAssetsImporter] No workspace directory found in zip', 'importWorkspaceFiles', {
        tempDir
      });
      return { success: true, fileCount: 0 };
    }
    
    // Use Agent's configured workspace path, or default path if not available
    const targetWorkspacePath = agentWorkspacePath || getDefaultWorkspacePath(alias, chatId);
    
    // Ensure target directory exists
    if (!fs.existsSync(targetWorkspacePath)) {
      fs.mkdirSync(targetWorkspacePath, { recursive: true });
    }
    
    // Recursively copy files
    const fileCount = await copyDirectoryRecursive(workspaceSourceDir, targetWorkspacePath);
    
    logger.info('[AgentAssetsImporter] Workspace files imported', 'importWorkspaceFiles', {
      sourceDir: workspaceSourceDir,
      targetDir: targetWorkspacePath,
      fileCount
    });
    
    return { success: true, fileCount };
  } catch (error) {
    logger.error('[AgentAssetsImporter] Failed to import workspace files', 'importWorkspaceFiles', {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Import chat_sessions
 */
async function importChatSessions(
  alias: string,
  chatId: string,
  tempDir: string
): Promise<{ success: boolean; sessionCount?: number; error?: string }> {
  try {
    const chatSessionsSourceDir = path.join(tempDir, 'chat_sessions');
    
    if (!fs.existsSync(chatSessionsSourceDir)) {
      logger.info('[AgentAssetsImporter] No chat_sessions directory found in zip', 'importChatSessions', {
        tempDir
      });
      return { success: true, sessionCount: 0 };
    }
    
    // Read source index.json
    const sourceIndexPath = path.join(chatSessionsSourceDir, 'index.json');
    if (!fs.existsSync(sourceIndexPath)) {
      logger.warn('[AgentAssetsImporter] No index.json found in chat_sessions', 'importChatSessions', {
        sourceIndexPath
      });
      return { success: true, sessionCount: 0 };
    }
    
    const sourceIndexContent = await fs.promises.readFile(sourceIndexPath, 'utf-8');
    const sourceIndex: ChatSessionsChatIndex = JSON.parse(sourceIndexContent);
    
    // Get or create target chat index
    const targetChatPath = getChatSessionsChatPath(alias, chatId);
    const targetIndexPath = getChatSessionsChatIndexPath(alias, chatId);
    
    let targetIndex: ChatSessionsChatIndex;
    if (fs.existsSync(targetIndexPath)) {
      const targetIndexContent = await fs.promises.readFile(targetIndexPath, 'utf-8');
      targetIndex = JSON.parse(targetIndexContent);
    } else {
      targetIndex = {
        chat_id: chatId,
        months: [],
        last_updated: new Date().toISOString()
      };
    }
    
    let totalSessionCount = 0;
    
    // Iterate through each month in the source index
    for (const month of sourceIndex.months) {
      // Merge month into target index (deduplicate)
      if (!targetIndex.months.includes(month)) {
        targetIndex.months.push(month);
      }
      
      // Process sessions for this month
      const sessionCount = await importMonthSessions(
        alias,
        chatId,
        month,
        chatSessionsSourceDir
      );
      totalSessionCount += sessionCount;
    }
    
    // Sort months in descending order
    targetIndex.months.sort().reverse();
    targetIndex.last_updated = new Date().toISOString();
    
    // Write target chat index
    await fs.promises.writeFile(targetIndexPath, JSON.stringify(targetIndex, null, 2), 'utf-8');
    
    // Step 4: Notify frontend of ChatSession data update
    await notifyFrontendUpdate(alias, chatId);
    
    logger.info('[AgentAssetsImporter] Chat sessions imported', 'importChatSessions', {
      alias,
      chatId,
      totalSessionCount,
      months: targetIndex.months
    });
    
    return { success: true, sessionCount: totalSessionCount };
  } catch (error) {
    logger.error('[AgentAssetsImporter] Failed to import chat sessions', 'importChatSessions', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Import sessions for a specific month
 */
async function importMonthSessions(
  alias: string,
  chatId: string,
  month: string,
  chatSessionsSourceDir: string
): Promise<number> {
  try {
    const sourceMonthDir = path.join(chatSessionsSourceDir, month);
    const sourceMonthIndexPath = path.join(sourceMonthDir, 'index.json');
    
    if (!fs.existsSync(sourceMonthIndexPath)) {
      logger.warn('[AgentAssetsImporter] No index.json found for month', 'importMonthSessions', {
        month,
        sourceMonthIndexPath
      });
      return 0;
    }
    
    // Read source month index
    const sourceMonthIndexContent = await fs.promises.readFile(sourceMonthIndexPath, 'utf-8');
    const sourceMonthIndex: ChatSessionsMonthIndex = JSON.parse(sourceMonthIndexContent);
    
    // Ensure target month directory exists
    const targetMonthPath = getChatSessionsMonthPath(alias, chatId, month);
    const targetMonthIndexPath = getChatSessionsMonthIndexPath(alias, chatId, month);
    
    // Get or create target month index
    let targetMonthIndex: ChatSessionsMonthIndex;
    if (fs.existsSync(targetMonthIndexPath)) {
      const targetMonthIndexContent = await fs.promises.readFile(targetMonthIndexPath, 'utf-8');
      targetMonthIndex = JSON.parse(targetMonthIndexContent);
    } else {
      targetMonthIndex = {
        chat_id: chatId,
        month: month,
        sessions: [],
        last_updated: new Date().toISOString()
      };
    }
    
    // Create a Set of existing session IDs for deduplication
    const existingSessionIds = new Set(
      targetMonthIndex.sessions.map(s => s.chatSession_id)
    );
    
    let importedCount = 0;
    
    // Iterate through sessions in the source month
    for (const sourceSession of sourceMonthIndex.sessions) {
      // Skip existing sessions (deduplication)
      if (existingSessionIds.has(sourceSession.chatSession_id)) {
        logger.info('[AgentAssetsImporter] Skipping duplicate session', 'importMonthSessions', {
          chatSessionId: sourceSession.chatSession_id
        });
        continue;
      }
      
      // Validate chatSessionId format
      if (!isValidChatSessionId(sourceSession.chatSession_id)) {
        logger.warn('[AgentAssetsImporter] Invalid chatSessionId format, skipping', 'importMonthSessions', {
          chatSessionId: sourceSession.chatSession_id
        });
        continue;
      }
      
      // Copy chatSession file
      const sourceSessionFilePath = path.join(
        sourceMonthDir,
        `${sourceSession.chatSession_id}.json`
      );
      
      if (!fs.existsSync(sourceSessionFilePath)) {
        logger.warn('[AgentAssetsImporter] Session file not found, skipping', 'importMonthSessions', {
          sourceSessionFilePath
        });
        continue;
      }
      
      const targetSessionFilePath = getChatSessionFilePath(alias, chatId, sourceSession.chatSession_id);
      
      // Copy file
      await fs.promises.copyFile(sourceSessionFilePath, targetSessionFilePath);
      
      // Add to target month index
      targetMonthIndex.sessions.push(sourceSession);
      existingSessionIds.add(sourceSession.chatSession_id);
      
      importedCount++;
      
      logger.info('[AgentAssetsImporter] Imported session', 'importMonthSessions', {
        chatSessionId: sourceSession.chatSession_id,
        month
      });
    }
    
    // Sort by time in descending order
    targetMonthIndex.sessions.sort((a, b) =>
      new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
    );
    targetMonthIndex.last_updated = new Date().toISOString();
    
    // Write target month index
    await fs.promises.writeFile(
      targetMonthIndexPath,
      JSON.stringify(targetMonthIndex, null, 2),
      'utf-8'
    );
    
    return importedCount;
  } catch (error) {
    logger.error('[AgentAssetsImporter] Failed to import month sessions', 'importMonthSessions', {
      month,
      error: error instanceof Error ? error.message : String(error)
    });
    return 0;
  }
}

/**
 * Recursively copy directory
 */
async function copyDirectoryRecursive(source: string, target: string): Promise<number> {
  let fileCount = 0;
  
  // Ensure target directory exists
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    
    if (entry.isDirectory()) {
      fileCount += await copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      await fs.promises.copyFile(sourcePath, targetPath);
      fileCount++;
    }
  }
  
  return fileCount;
}

/**
 * Notify frontend of ChatSession data update
 */
async function notifyFrontendUpdate(alias: string, chatId: string): Promise<void> {
  try {
    const { BrowserWindow } = await import('electron');
    const windows = BrowserWindow.getAllWindows();
    
    // Find the first non-destroyed window as the main window
    // (usually the first window is the main window)
    const mainWindow = windows.find((window: any) =>
      !window.isDestroyed() && window.webContents
    );
    
    if (mainWindow && mainWindow.webContents) {
      // Get the latest chatSessions list
      const result = await chatSessionManager.getChatSessions(alias, chatId);
      
      mainWindow.webContents.send('chatSession:updated', {
        alias,
        chatId,
        sessions: result.sessions,
        loadedMonths: result.loadedMonths,
        hasMore: result.hasMore,
        nextMonthIndex: result.nextMonthIndex,
        timestamp: Date.now()
      });
      
      logger.info('[AgentAssetsImporter] Notified frontend of ChatSession update', 'notifyFrontendUpdate', {
        alias,
        chatId,
        sessionCount: result.sessions.length
      });
    } else {
      logger.warn('[AgentAssetsImporter] No main window found to notify', 'notifyFrontendUpdate', {
        alias,
        chatId,
        windowCount: windows.length
      });
    }
  } catch (error) {
    logger.error('[AgentAssetsImporter] Failed to notify frontend', 'notifyFrontendUpdate', {
      alias,
      chatId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Asynchronously clean up temporary directory
 */
function cleanupTempDir(tempDir: string): void {
  // Use setImmediate for async execution, non-blocking
  setImmediate(async () => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        logger.info('[AgentAssetsImporter] Cleaned up temp directory', 'cleanupTempDir', {
          tempDir
        });
      }
    } catch (error) {
      logger.warn('[AgentAssetsImporter] Failed to cleanup temp directory', 'cleanupTempDir', {
        tempDir,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

/**
 * Asynchronously delete file
 * @param filePath File path
 */
function cleanupTempFile(filePath: string): void {
  // Use setImmediate for async execution, non-blocking
  setImmediate(async () => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info('[AgentAssetsImporter] Cleaned up temp file', 'cleanupTempFile', {
          filePath
        });
      }
    } catch (error) {
      logger.warn('[AgentAssetsImporter] Failed to cleanup temp file', 'cleanupTempFile', {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

/**
 * Download file to temporary directory
 * @param url File download URL
 * @returns Downloaded temporary file path
 */
async function downloadToTempFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    logger.info('[AgentAssetsImporter] Starting download', 'downloadToTempFile', { url });
    
    // Create temporary file path
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const tempFilePath = path.join(tempDir, `kosmos-download-${timestamp}-${randomStr}.zip`);
    
    // Create write stream
    const fileStream = fs.createWriteStream(tempFilePath);
    
    // Select http or https module
    const protocol = url.startsWith('https://') ? https : http;
    
    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        logger.info('[AgentAssetsImporter] Following redirect', 'downloadToTempFile', {
          originalUrl: url,
          redirectUrl: response.headers.location
        });
        // Recursively handle redirects
        downloadToTempFile(response.headers.location)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      // Check response status
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status code: ${response.statusCode}`));
        return;
      }
      
      // Pipe to file
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        logger.info('[AgentAssetsImporter] Download completed', 'downloadToTempFile', {
          tempFilePath,
          size: fs.statSync(tempFilePath).size
        });
        resolve(tempFilePath);
      });
      
      fileStream.on('error', (err) => {
        // Clean up temporary file
        fs.unlink(tempFilePath, () => {}); // Ignore deletion errors
        reject(err);
      });
    });
    
    request.on('error', (err) => {
      // Clean up temporary file
      fs.unlink(tempFilePath, () => {}); // Ignore deletion errors
      reject(err);
    });
    
    // Set timeout
    request.setTimeout(60000, () => {
      request.destroy();
      fs.unlink(tempFilePath, () => {}); // Ignore deletion errors
      reject(new Error('Download timeout after 60 seconds'));
    });
  });
}

/**
 * Import Agent assets from URL
 *
 * Workflow:
 * 1. Download zip package to temporary directory
 * 2. Call importAgentAssetsFromZip to perform import
 * 3. Asynchronously delete the downloaded temporary file
 *
 * @param alias User alias
 * @param chatId Chat ID (target Agent's ID)
 * @param zipUrl Zip file download URL
 * @returns Import result
 */
export async function importAgentAssetsFromUrl(
  alias: string,
  chatId: string,
  zipUrl: string
): Promise<ImportResult> {
  let tempFilePath: string | null = null;
  
  try {
    logger.info('[AgentAssetsImporter] Starting import from URL', 'importAgentAssetsFromUrl', {
      alias,
      chatId,
      zipUrl
    });
    
    // Validate parameters
    if (!alias || !chatId || !zipUrl) {
      return { success: false, error: 'Missing required parameters' };
    }
    
    // Validate URL format
    if (!zipUrl.startsWith('http://') && !zipUrl.startsWith('https://')) {
      return { success: false, error: 'Invalid URL format: must start with http:// or https://' };
    }
    
    // Step 1: Download zip package to temporary directory
    logger.info('[AgentAssetsImporter] Step 1: Downloading zip file', 'importAgentAssetsFromUrl', {
      zipUrl
    });
    tempFilePath = await downloadToTempFile(zipUrl);
    
    logger.info('[AgentAssetsImporter] Step 1 completed: Download successful', 'importAgentAssetsFromUrl', {
      tempFilePath
    });
    
    // Step 2: Call existing importAgentAssetsFromZip to perform import
    logger.info('[AgentAssetsImporter] Step 2: Importing from zip file', 'importAgentAssetsFromUrl', {
      tempFilePath
    });
    const importResult = await importAgentAssetsFromZip(alias, chatId, tempFilePath);
    
    logger.info('[AgentAssetsImporter] Import from URL completed', 'importAgentAssetsFromUrl', {
      alias,
      chatId,
      zipUrl,
      result: importResult
    });
    
    return importResult;
    
  } catch (error) {
    logger.error('[AgentAssetsImporter] Import from URL failed', 'importAgentAssetsFromUrl', {
      alias,
      chatId,
      zipUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    // Step 3: Asynchronously delete downloaded temporary file
    if (tempFilePath) {
      cleanupTempFile(tempFilePath);
    }
  }
}

export default {
  importAgentAssetsFromZip,
  importAgentAssetsFromUrl
};
