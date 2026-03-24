import * as fs from 'fs';
import * as path from 'path';

type ElectronApp = {
  getPath: (name: string) => string;
};

function resolveElectronApp(): ElectronApp | null {
  try {
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    return app;
  } catch (_error) {
    return null;
  }
}

function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getUserDataPath(): string {
  const electronApp = resolveElectronApp();
  if (electronApp) {
    return electronApp.getPath('userData');
  }

  const os = require('os');
  const fallbackPath = path.join(os.tmpdir(), 'openkosmos-app-test');
  ensureDirectoryExists(fallbackPath);
  return fallbackPath;
}

export function getProfilesRootPath(): string {
  const profilesRoot = path.join(getUserDataPath(), 'profiles');
  ensureDirectoryExists(profilesRoot);
  return profilesRoot;
}

export function getProfileDirectoryPath(alias: string): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve profile directory path.');
  }
  const profileDir = path.join(getProfilesRootPath(), alias);
  ensureDirectoryExists(profileDir);
  return profileDir;
}

export interface Mem0StoragePaths {
  basePath: string;
  vectorStorePath: string;
  historyDirectory: string;
  historyDbPath: string;
}

export function ensureMem0StoragePaths(
  alias: string,
  baseDir?: string
): Mem0StoragePaths {
  const profileDir = baseDir ? path.resolve(baseDir) : getProfileDirectoryPath(alias);
  const ragBasePath = path.join(profileDir, 'rag');
  const vectorStorePath = path.join(ragBasePath, 'user_memories.db'); // SQLite + sqlite-vec database file
  const historyDirectory = path.join(ragBasePath, 'history');

  [ragBasePath, historyDirectory].forEach(ensureDirectoryExists);

  const historyDbPath = path.join(historyDirectory, 'openkosmos_memory.db');

  return {
    basePath: ragBasePath,
    vectorStorePath,
    historyDirectory,
    historyDbPath,
  };
}

/**
 * Get the default workspace path for a specific chat
 * Path format: {profile_directory}/chat_workspaces/{chat_id}/
 * 
 * @deprecated Use getDefaultAgentWorkspacePath for new agent creation.
 * This function is kept for backward compatibility with existing chat sessions.
 */
export function getDefaultWorkspacePath(alias: string, chatId: string): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve workspace path.');
  }
  if (!chatId) {
    throw new Error('Chat ID is required to resolve workspace path.');
  }
  
  const profileDir = getProfileDirectoryPath(alias);
  const workspacesRoot = path.join(profileDir, 'chat_workspaces');
  const workspacePath = path.join(workspacesRoot, chatId);
  
  // Ensure the directory exists
  ensureDirectoryExists(workspacePath);
  
  return workspacePath;
}

/**
 * Get the default workspace path for a new agent
 * Path format: {profile_directory}/chat_workspaces/agent-{name}-{source}/
 * 
 * @param alias - User profile alias
 * @param agentName - Agent name (spaces will be replaced with hyphens, converted to lowercase)
 * @param agentSource - Agent source (always 'ON-DEVICE')
 * @returns The workspace path for the agent
 */
export function getDefaultAgentWorkspacePath(
  alias: string,
  agentName: string,
  agentSource: string
): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve workspace path.');
  }
  if (!agentName) {
    throw new Error('Agent name is required to resolve workspace path.');
  }
  
  // Convert agent name: replace spaces with hyphens and convert to lowercase
  const normalizedName = agentName.replace(/\s+/g, '-').toLowerCase();
  
  // Normalize source: default to 'on-device' if not provided, convert to lowercase
  const normalizedSource = (agentSource || 'ON-DEVICE').toLowerCase();
  
  // Build folder name: agent-{name}-{source}
  const folderName = `agent-${normalizedName}-${normalizedSource}`;
  
  const profileDir = getProfileDirectoryPath(alias);
  const workspacesRoot = path.join(profileDir, 'chat_workspaces');
  const workspacePath = path.join(workspacesRoot, folderName);
  
  // Ensure the directory exists (create if not exist, reuse if exists)
  ensureDirectoryExists(workspacePath);
  
  return workspacePath;
}

/**
 * Check if a workspace path is a default workspace path (under chat_workspaces directory)
 * Default paths follow the pattern: {profileDir}/chat_workspaces/{chatId or agent-name-source}/
 * 
 * @param alias - User profile alias
 * @param workspacePath - The workspace path to check
 * @returns true if the path is under the default chat_workspaces directory
 */
export function isDefaultWorkspacePath(alias: string, workspacePath: string): boolean {
  if (!alias || !workspacePath) {
    return false;
  }
  try {
    const profileDir = getProfileDirectoryPath(alias);
    const workspacesRoot = path.join(profileDir, 'chat_workspaces');
    const normalizedWorkspace = path.resolve(workspacePath);
    const normalizedRoot = path.resolve(workspacesRoot);
    return normalizedWorkspace.startsWith(normalizedRoot + path.sep);
  } catch {
    return false;
  }
}

/**
 * Move files and directories from source to destination, skipping specified items
 * Used for knowledgeBase migration - moves non-chatSession files into knowledge directory
 * 
 * @param srcDir - Source directory
 * @param destDir - Destination directory
 * @param skipItems - Items to skip (directory/file names)
 * @returns number of items moved
 */
export function moveContentsToDirectory(srcDir: string, destDir: string, skipItems: string[] = []): number {
  if (!srcDir || !destDir || !fs.existsSync(srcDir)) {
    return 0;
  }
  
  ensureDirectoryExists(destDir);
  
  let movedCount = 0;
  try {
    const items = fs.readdirSync(srcDir);
    for (const item of items) {
      if (skipItems.includes(item)) {
        continue;
      }
      const srcPath = path.join(srcDir, item);
      const destPath = path.join(destDir, item);
      // Skip if destination already exists
      if (fs.existsSync(destPath)) {
        continue;
      }
      fs.renameSync(srcPath, destPath);
      movedCount++;
    }
  } catch (error) {
    console.error(`[pathUtils] Failed to move contents from ${srcDir} to ${destDir}`, error);
  }
  return movedCount;
}

/**
 * Ensure a workspace directory exists, creating it if necessary
 * Works for both default and custom workspace paths
 * 
 * @param workspacePath - The workspace directory path to ensure exists
 * @returns true if directory exists or was created successfully, false otherwise
 */
export function ensureWorkspaceExists(workspacePath: string): boolean {
  if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim() === '') {
    return false;
  }
  
  try {
    const normalizedPath = path.resolve(workspacePath.trim());
    ensureDirectoryExists(normalizedPath);
    return true;
  } catch (error) {
    console.error(`[pathUtils] Failed to ensure workspace exists: ${workspacePath}`, error);
    return false;
  }
}

/**
 * ========================================
 * ChatSession Path Management Functions (New Architecture)
 * ========================================
 *
 * New chatSessions directory structure:
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/index.json
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/index.json
 * {app user data folder}/profiles/{user alias}/chat_sessions/{chat_id}/{YYYYMM}/{chatSessionId}.json
 *
 * ChatSessionId format: "chatSession_{YYYYMMDDHHmmSS}"
 */

/**
 * Get the chat_sessions root directory path
 * Path format: {profile_directory}/chat_sessions/
 */
export function getChatSessionsRootPath(alias: string): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve chat sessions root path.');
  }
  
  const profileDir = getProfileDirectoryPath(alias);
  const chatSessionsRoot = path.join(profileDir, 'chat_sessions');
  
  ensureDirectoryExists(chatSessionsRoot);
  
  return chatSessionsRoot;
}

/**
 * Get the chat_sessions directory path for a specific chat_id
 * Path format: {profile_directory}/chat_sessions/{chat_id}/
 */
export function getChatSessionsChatPath(alias: string, chatId: string): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve chat sessions path.');
  }
  if (!chatId) {
    throw new Error('Chat ID is required to resolve chat sessions path.');
  }
  
  const chatSessionsRoot = getChatSessionsRootPath(alias);
  const chatPath = path.join(chatSessionsRoot, chatId);
  
  ensureDirectoryExists(chatPath);
  
  return chatPath;
}

/**
 * Get the index file path for a specific chat_id
 * Path format: {profile_directory}/chat_sessions/{chat_id}/index.json
 * This file maintains the list of all months under the chat_id
 */
export function getChatSessionsChatIndexPath(alias: string, chatId: string): string {
  const chatPath = getChatSessionsChatPath(alias, chatId);
  return path.join(chatPath, 'index.json');
}

/**
 * Get the directory path for a specific chat_id and month
 * Path format: {profile_directory}/chat_sessions/{chat_id}/{YYYYMM}/
 */
export function getChatSessionsMonthPath(alias: string, chatId: string, month: string): string {
  if (!month || !/^\d{6}$/.test(month)) {
    throw new Error('Month must be in YYYYMM format.');
  }
  
  const chatPath = getChatSessionsChatPath(alias, chatId);
  const monthPath = path.join(chatPath, month);
  
  ensureDirectoryExists(monthPath);
  
  return monthPath;
}

/**
 * Get the index file path for a specific chat_id and month
 * Path format: {profile_directory}/chat_sessions/{chat_id}/{YYYYMM}/index.json
 * This file maintains the metadata index of all chatSessions in that month
 */
export function getChatSessionsMonthIndexPath(alias: string, chatId: string, month: string): string {
  const monthPath = getChatSessionsMonthPath(alias, chatId, month);
  return path.join(monthPath, 'index.json');
}

/**
 * Get the file path for a specific chatSession
 * Path format: {profile_directory}/chat_sessions/{chat_id}/{YYYYMM}/{chatSessionId}.json
 */
export function getChatSessionFilePath(alias: string, chatId: string, chatSessionId: string): string {
  if (!chatSessionId) {
    throw new Error('ChatSession ID is required to resolve file path.');
  }
  
  // Extract month from chatSessionId (format: chatSession_YYYYMMDDHHmmSS)
  const month = extractMonthFromChatSessionId(chatSessionId);
  if (!month) {
    throw new Error(`Invalid chatSessionId format: ${chatSessionId}. Expected format: chatSession_YYYYMMDDHHmmSS`);
  }
  
  const monthPath = getChatSessionsMonthPath(alias, chatId, month);
  return path.join(monthPath, `${chatSessionId}.json`);
}

/**
 * Extract month (YYYYMM) from chatSessionId
 * chatSessionId format: chatSession_YYYYMMDDHHmmSS
 */
export function extractMonthFromChatSessionId(chatSessionId: string): string | null {
  const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})\d{8}$/);
  if (match) {
    return match[1] + match[2]; // YYYYMM
  }
  return null;
}

/**
 * Generate a ChatSession ID
 * Format: chatSession_YYYYMMDDHHmmSS
 */
export function generateChatSessionId(): string {
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');
  return `chatSession_${timestamp}`;
}

/**
 * Get the current month string (YYYYMM)
 */
export function getCurrentMonth(): string {
  const now = new Date();
  return now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0');
}

/**
 * Validate ChatSession ID format
 */
export function isValidChatSessionId(chatSessionId: string): boolean {
  return /^chatSession_\d{14}$/.test(chatSessionId);
}

/**
 * Recursively delete a directory and all its contents
 * @param dirPath - Directory path to delete
 * @returns true if deletion succeeds or directory doesn't exist, false if deletion fails
 */
export function removeDirectoryRecursively(dirPath: string): boolean {
  try {
    if (!dirPath || typeof dirPath !== 'string') {
      return false;
    }
    
    const normalizedPath = path.resolve(dirPath.trim());
    
    if (!fs.existsSync(normalizedPath)) {
      return true; // Directory not existing is treated as success
    }
    
    fs.rmSync(normalizedPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`[pathUtils] Failed to remove directory: ${dirPath}`, error);
    return false;
  }
}

/**
 * Delete all ChatSessions directories for a specific chat_id
 * Path format: {profile_directory}/chat_sessions/{chat_id}/
 * @param alias - User alias
 * @param chatId - Chat ID
 * @returns true if deletion succeeds, false if deletion fails
 */
export function removeChatSessionsDirectory(alias: string, chatId: string): boolean {
  if (!alias || !chatId) {
    return false;
  }
  
  try {
    const profileDir = getProfileDirectoryPath(alias);
    const chatSessionsRoot = path.join(profileDir, 'chat_sessions');
    const chatPath = path.join(chatSessionsRoot, chatId);
    
    return removeDirectoryRecursively(chatPath);
  } catch (error) {
    console.error(`[pathUtils] Failed to remove chat sessions directory for ${chatId}`, error);
    return false;
  }
}

/**
 * Delete the default workspace directory for a specific chat_id
 * Path format: {profile_directory}/chat_workspaces/{chat_id}/
 * @param alias - User alias
 * @param chatId - Chat ID
 * @returns true if deletion succeeds, false if deletion fails
 */
export function removeDefaultWorkspaceDirectory(alias: string, chatId: string): boolean {
  if (!alias || !chatId) {
    return false;
  }
  
  try {
    const profileDir = getProfileDirectoryPath(alias);
    const workspacesRoot = path.join(profileDir, 'chat_workspaces');
    const workspacePath = path.join(workspacesRoot, chatId);
    
    return removeDirectoryRecursively(workspacePath);
  } catch (error) {
    console.error(`[pathUtils] Failed to remove workspace directory for ${chatId}`, error);
    return false;
  }
}