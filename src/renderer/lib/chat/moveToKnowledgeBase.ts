// src/renderer/lib/chat/moveToKnowledgeBase.ts
// Utility function for moving files to Knowledge Base with path replacement in chat history

import { agentChatSessionCacheManager } from './agentChatSessionCacheManager';
import { workspaceOps } from './workspaceOps';
import { createLogger } from '../utilities/logger';
const logger = createLogger('[MoveToKnowledgeBase]');

function normalizePathForComparison(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function isPathInKnowledgeBase(filePath: string, knowledgeBasePath?: string): boolean {
  if (!filePath || !knowledgeBasePath) {
    return false;
  }

  const normalizedFilePath = normalizePathForComparison(filePath);
  const normalizedKnowledgeBasePath = normalizePathForComparison(knowledgeBasePath);

  if (!normalizedFilePath || !normalizedKnowledgeBasePath) {
    return false;
  }

  return normalizedFilePath === normalizedKnowledgeBasePath || normalizedFilePath.startsWith(`${normalizedKnowledgeBasePath}/`);
}

export function shouldShowMoveToKnowledgeBaseOption(
  filePath: string,
  knowledgeBasePath?: string,
  isSessionIdle: boolean = true,
): boolean {
  if (!filePath || !knowledgeBasePath || !isSessionIdle) {
    return false;
  }

  return !isPathInKnowledgeBase(filePath, knowledgeBasePath);
}

/**
 * Move a file to the Agent's Knowledge Base directory and replace all path references
 * in the current ChatSession (frontend cache, backend memory, and persisted file).
 *
 * @param filePath - Absolute path of the file to move
 * @param knowledgeBasePath - Absolute path of the Knowledge Base directory
 * @param options - Optional configuration
 * @returns Result object with success status and new file path
 */
export async function moveFileToKnowledgeBase(
  filePath: string,
  knowledgeBasePath: string,
  options?: { force?: boolean }
): Promise<{ success: boolean; newPath?: string; error?: string }> {
  try {
    // Step 1: Move the file via IPC
    if (!window.electronAPI?.workspace?.movePath) {
      return { success: false, error: 'Move file API not available' };
    }

    let result = await window.electronAPI.workspace.movePath(filePath, knowledgeBasePath, options);

    // Handle TARGET_EXISTS - prompt user for force override
    if (!result?.success && result?.error === 'TARGET_EXISTS') {
      const fileName = result?.data?.sourceName || filePath.split(/[/\\]/).pop();
      const confirmed = window.confirm(
        `A file named "${fileName}" already exists in Knowledge Base.\n\nDo you want to replace it?`
      );
      if (!confirmed) {
        return { success: false, error: 'User cancelled replacement' };
      }
      result = await window.electronAPI.workspace.movePath(filePath, knowledgeBasePath, { force: true });
    }

    if (!result?.success) {
      return { success: false, error: result?.error || 'Failed to move file' };
    }

    // Step 2: Calculate new file path
    const sep = knowledgeBasePath.includes('\\') ? '\\' : '/';
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const newPath = `${knowledgeBasePath}${sep}${fileName}`;

    // Step 3: Replace file path references in backend (AgentChat chat_history/context_history + disk)
    try {
      if (window.electronAPI?.agentChat?.replaceFilePathInSession) {
        await window.electronAPI.agentChat.replaceFilePathInSession(filePath, newPath);
      }
    } catch (replaceError) {
      logger.warn('[moveToKnowledgeBase] Failed to replace path in backend session:', replaceError);
      // Non-fatal: file was already moved, just path references not updated in backend
    }

    // Step 4: Replace file path references in frontend session cache
    try {
      agentChatSessionCacheManager.replaceFilePathInMessages(filePath, newPath);
    } catch (cacheError) {
      logger.warn('[moveToKnowledgeBase] Failed to replace path in frontend cache:', cacheError);
      // Non-fatal: file was already moved
    }

    // Step 5: Refresh file tree caches
    try {
      // Clear source directory cache
      const sourceDir = filePath.substring(0, filePath.lastIndexOf(sep) || filePath.lastIndexOf('/'));
      if (sourceDir) {
        await workspaceOps.clearFileTreeCache(sourceDir);
      }
      // Clear knowledge base directory cache
      await workspaceOps.clearFileTreeCache(knowledgeBasePath);
      // Trigger refresh for all FileExplorerSections
      workspaceOps.triggerRefresh();
    } catch (refreshError) {
      logger.warn('[moveToKnowledgeBase] Failed to refresh file tree caches:', refreshError);
      // Non-fatal
    }

    return { success: true, newPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[moveToKnowledgeBase] Error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
