import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import {
  extractMonthFromChatSessionIdValue,
  isValidChatSessionIdFormat,
} from '../../../shared/utils/idFormats';
import { generateChatSessionId as generateRuntimeChatSessionId } from '../utilities/idFactory';
import { isSafeAgentId } from './agentStoreManager';
import { createLogger } from '../unifiedLogger';
const logger = createLogger();

type ElectronApp = {
  getPath: (name: string) => string;
};

function resolveElectronApp(): ElectronApp | null {
  try {
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }
    return app as unknown as ElectronApp;
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

/**
 * Per-profile directory for Agent Hook scripts and artifacts.
 * Hook command actions can reference files here via the
 * `${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}` placeholder, and the same path is
 * exported as the `OPENKOSMOS_HOOKS_ARTIFACTS_PATH` env var to spawned
 * hook processes. The directory is created on first access.
 */
export function getHooksArtifactsPath(alias: string): string {
  const profileDir = getProfileDirectoryPath(alias);
  const artifactsDir = path.join(profileDir, 'hooks-artifacts');
  ensureDirectoryExists(artifactsDir);
  return artifactsDir;
}

/**
 * Get the default workspace path for a specific chat
 * Path format: {profile_directory}/chat_workspaces/{chat_id}/
 *
 * Chat workspaces are keyed by `chat_id` in the separated Agent/Chat model.
 * This is the canonical workspace resolver for both new and existing chats.
 */
export function getDefaultWorkspacePath(alias: string, chatId: string): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve workspace path.');
  }
  if (!chatId) {
    throw new Error('Chat ID is required to resolve workspace path.');
  }
  // Confine chatId to a single safe path segment (twin of getAgentKnowledgePath).
  // chatId is profile-supplied (a corrupted/imported profile.json can carry a
  // malicious chat_id like '../../evil'), and this is the canonical resolver for
  // every chat workspace (schedules, logs, month dirs), so an unguarded segment
  // would let ensureDirectoryExists create — and downstream code read/write — a
  // directory OUTSIDE chat_workspaces (path-traversal).
  if (!isSafeAgentId(chatId)) {
    throw new Error(`Chat ID must be a safe path segment: ${JSON.stringify(chatId)}`);
  }

  const profileDir = getProfileDirectoryPath(alias);
  const workspacesRoot = path.join(profileDir, 'chat_workspaces');
  const workspacePath = path.join(workspacesRoot, chatId);

  // Ensure the directory exists
  ensureDirectoryExists(workspacePath);

  return workspacePath;
}

/**
 * Get the per-agent knowledge directory under the standalone agent store.
 * Path format: {profile_directory}/agents/{agentId}/knowledge/
 * Replaces the legacy chat_workspaces/agent-{name}-{source}/knowledge layout.
 */
export function getAgentKnowledgePath(alias: string, agentId: string): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve knowledge path.');
  }
  // Confine the id to a single safe path segment (twin of agentStoreManager.getAgentDir).
  // agentId here can be a caller/profile-supplied value (addChatConfig derives it from the
  // inline agent), so a corrupt/malicious id like '../../evil' must never build a knowledge
  // dir outside agents/{id}. isSafeAgentId also rejects empty/non-string ids.
  if (!isSafeAgentId(agentId)) {
    throw new Error(`Agent ID is required and must be a safe path segment: ${JSON.stringify(agentId)}`);
  }
  const profileDir = getProfileDirectoryPath(alias);
  const knowledgePath = path.join(profileDir, 'agents', agentId, 'knowledge');
  ensureDirectoryExists(knowledgePath);
  return knowledgePath;
}

/**
 * Get the default workspace path for a new agent
 * Path format: {profile_directory}/chat_workspaces/agent-{name}-{source}/
 *
 * @deprecated Chat workspaces are keyed by `chat_id` in the separated
 * Agent/Chat model. Use {@link getDefaultWorkspacePath} (chat_id-keyed) for new
 * chats. Retained only for the load-time consolidation migration that moves
 * legacy agent-name-keyed dirs onto their chat_id.
 *
 * @param alias - User profile alias
 * @param agentName - Agent name (spaces will be replaced with hyphens, converted to lowercase)
 * @param agentSource - Agent source ('IN-LIBRARY' or 'ON-DEVICE')
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
      if (fs.existsSync(destPath)) {
        // Both sides directories: recursively merge so same-named subtrees
        // (e.g. a month dir like 202606 present in both the legacy and the
        // chat_id workspace) combine instead of being skipped wholesale. Any
        // other conflict (file-vs-file, file-vs-dir) keeps the existing
        // destination so user data is never overwritten.
        if (fs.statSync(srcPath).isDirectory() && fs.statSync(destPath).isDirectory()) {
          movedCount += moveContentsToDirectory(srcPath, destPath, skipItems);
          if (fs.readdirSync(srcPath).length === 0) {
            fs.rmdirSync(srcPath);
          }
        }
        continue;
      }
      fs.renameSync(srcPath, destPath);
      movedCount++;
    }
  } catch (error) {
    logger.error(`[pathUtils] Failed to move contents from ${srcDir} to ${destDir} ${error}`);
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
    logger.error(`[pathUtils] Failed to ensure workspace exists: ${workspacePath} ${error}`);
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
 * Get the root path of chat_sessions
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
 * Get the chat_sessions directory path for the specified chat_id
 * Path format: {profile_directory}/chat_sessions/{chat_id}/
 */
export function getChatSessionsChatPath(alias: string, chatId: string): string {
  if (!alias) {
    throw new Error('Profile alias is required to resolve chat sessions path.');
  }
  if (!chatId) {
    throw new Error('Chat ID is required to resolve chat sessions path.');
  }
  // Confine chatId to a single safe path segment (twin of getDefaultWorkspacePath).
  // chatId is profile-supplied (a corrupted/imported profile.json can carry a
  // malicious chat_id like '../../evil'), and this is the canonical resolver every
  // chat_sessions read/write sink derives from (index/month/session files), so an
  // unguarded segment would let ensureDirectoryExists create — and downstream code
  // read/write — a directory OUTSIDE chat_sessions (path-traversal).
  if (!isSafeAgentId(chatId)) {
    throw new Error(`Chat ID must be a safe path segment: ${JSON.stringify(chatId)}`);
  }

  const chatSessionsRoot = getChatSessionsRootPath(alias);
  const chatPath = path.join(chatSessionsRoot, chatId);

  ensureDirectoryExists(chatPath);

  return chatPath;
}

/**
 * Get the index file path for the specified chat_id
 * Path format: {profile_directory}/chat_sessions/{chat_id}/index.json
 * This file maintains the list of all months under the chat_id
 */
export function getChatSessionsChatIndexPath(alias: string, chatId: string): string {
  const chatPath = getChatSessionsChatPath(alias, chatId);
  return path.join(chatPath, 'index.json');
}

/**
 * Get the directory path for the specified chat_id and month
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
 * Get the index file path for the specified chat_id and month
 * Path format: {profile_directory}/chat_sessions/{chat_id}/{YYYYMM}/index.json
 * This file maintains the metadata index of all chatSessions in the month
 */
export function getChatSessionsMonthIndexPath(alias: string, chatId: string, month: string): string {
  const monthPath = getChatSessionsMonthPath(alias, chatId, month);
  return path.join(monthPath, 'index.json');
}

/**
 * Get the file path for the specified chatSession
 * Path format: {profile_directory}/chat_sessions/{chat_id}/{YYYYMM}/{chatSessionId}.json
 */
export function getChatSessionFilePath(alias: string, chatId: string, chatSessionId: string): string {
  if (!chatSessionId) {
    throw new Error('ChatSession ID is required to resolve file path.');
  }

  // Extract month from chatSessionId
  const month = extractMonthFromChatSessionId(chatSessionId);
  if (!month) {
    throw new Error(`Invalid chatSessionId format: ${chatSessionId}. Expected format: chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>`);
  }

  const monthPath = getChatSessionsMonthPath(alias, chatId, month);
  return path.join(monthPath, `${chatSessionId}.json`);
}

/**
 * Extract month (YYYYMM) from chatSessionId
 * Supports old format: chatSession_YYYYMMDDHHMMSS
 * Supports new format: chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>
 */
export function extractMonthFromChatSessionId(chatSessionId: string): string | null {
  return extractMonthFromChatSessionIdValue(chatSessionId);
}

/**
 * Generate a ChatSession ID
 * Format: chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>
 */
export function generateChatSessionId(): string {
  return generateRuntimeChatSessionId();
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
  return isValidChatSessionIdFormat(chatSessionId);
}

/**
 * Recursively remove a directory and all its contents
 * @param dirPath - The directory path to remove
 * @returns true if removal succeeded or directory does not exist, false if removal failed
 */
export function removeDirectoryRecursively(dirPath: string): boolean {
  try {
    if (!dirPath || typeof dirPath !== 'string') {
      return false;
    }

    const normalizedPath = path.resolve(dirPath.trim());

    if (!fs.existsSync(normalizedPath)) {
      return true; // Directory does not exist — treat as success
    }

    fs.rmSync(normalizedPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    logger.error(`[pathUtils] Failed to remove directory: ${dirPath} ${error}`);
    return false;
  }
}

/**
 * Remove all ChatSessions directory for the specified chat_id
 * Path format: {profile_directory}/chat_sessions/{chat_id}/
 * @param alias - User alias
 * @param chatId - Chat ID
 * @returns true if removal succeeded, false if removal failed
 */
export function removeChatSessionsDirectory(alias: string, chatId: string): boolean {
  if (!alias || !chatId) {
    return false;
  }
  // Never build a recursive-delete target from an unsafe segment: a corrupt
  // chat_id like '../../evil' would otherwise make removeDirectoryRecursively
  // delete a directory OUTSIDE chat_sessions (destructive path-traversal).
  // Mirrors removeDefaultWorkspaceDirectory's guard for chat_workspaces.
  if (!isSafeAgentId(chatId)) {
    logger.error(`[pathUtils] Refusing to remove chat sessions for unsafe chat id: ${JSON.stringify(chatId)}`);
    return false;
  }

  try {
    const profileDir = getProfileDirectoryPath(alias);
    const chatSessionsRoot = path.join(profileDir, 'chat_sessions');
    const chatPath = path.join(chatSessionsRoot, chatId);

    return removeDirectoryRecursively(chatPath);
  } catch (error) {
    logger.error(`[pathUtils] Failed to remove chat sessions directory for ${chatId} ${error}`);
    return false;
  }
}

/**
 * Remove the default workspace directory for the specified chat_id
 * Path format: {profile_directory}/chat_workspaces/{chat_id}/
 * @param alias - User alias
 * @param chatId - Chat ID
 * @returns true if removal succeeded, false if removal failed
 */
export function removeDefaultWorkspaceDirectory(alias: string, chatId: string): boolean {
  if (!alias || !chatId) {
    return false;
  }
  // Never build a recursive-delete target from an unsafe segment: a corrupt
  // chat_id like '../../evil' would otherwise make removeDirectoryRecursively
  // delete a directory OUTSIDE chat_workspaces (destructive path-traversal).
  if (!isSafeAgentId(chatId)) {
    logger.error(`[pathUtils] Refusing to remove workspace for unsafe chat id: ${JSON.stringify(chatId)}`);
    return false;
  }

  try {
    const profileDir = getProfileDirectoryPath(alias);
    const workspacesRoot = path.join(profileDir, 'chat_workspaces');
    const workspacePath = path.join(workspacesRoot, chatId);

    return removeDirectoryRecursively(workspacePath);
  } catch (error) {
    logger.error(`[pathUtils] Failed to remove workspace directory for ${chatId} ${error}`);
    return false;
  }
}