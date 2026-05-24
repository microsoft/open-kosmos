/**
 * Chat Session Importer
 *
 * Imports a single ChatSession JSON file into an agent's chat session store.
 */

import * as fs from 'fs';
import { createConsoleLogger } from '../unifiedLogger';
import { ChatSession } from './types/profile';
import { ChatSessionFile, deserializeChatFile } from './chatSessionFileOps';
import { generateChatSessionId, isValidChatSessionId } from './pathUtils';
import { chatSessionStore } from '../chat/chatSessionStore';
import { profileCacheManager } from './index';

const logger = createConsoleLogger();

export interface ImportResult {
  success: boolean;
  error?: string;
  importedSessions?: number;
  importedWorkspaceFiles?: number;
  importedSessionId?: string;
}

function isValidChatSessionFile(value: unknown): value is ChatSessionFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ChatSessionFile>;
  return (
    typeof candidate.chatSession_id === 'string' &&
    typeof candidate.last_updated === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.chat_history) &&
    Array.isArray(candidate.context_history)
  );
}

function buildImportedChatSessionFile(sourceFile: ChatSessionFile): ChatSessionFile {
  const importedSessionId = generateChatSessionId();
  const importedAt = new Date().toISOString();

  return {
    ...sourceFile,
    chatSession_id: importedSessionId,
    last_updated: importedAt,
  };
}

function buildImportedChatSessionMetadata(chatSessionFile: ChatSessionFile): ChatSession {
  return {
    chatSession_id: chatSessionFile.chatSession_id,
    title: chatSessionFile.title,
    last_updated: chatSessionFile.last_updated,
    readStatus: 'read',
    source: { type: 'local' },
  };
}

export async function importChatSessionFromFile(
  alias: string,
  chatId: string,
  jsonFilePath: string
): Promise<ImportResult> {
  try {
    logger.info('[AgentAssetsImporter] Starting chat session import from JSON file', 'importChatSessionFromFile', {
      alias,
      chatId,
      jsonFilePath,
    });

    if (!alias || !chatId || !jsonFilePath) {
      return { success: false, error: 'Missing required parameters' };
    }

    if (!fs.existsSync(jsonFilePath)) {
      return { success: false, error: `Chat session file not found: ${jsonFilePath}` };
    }

    const fileContent = await fs.promises.readFile(jsonFilePath, 'utf-8');
    const parsedFile = JSON.parse(fileContent) as unknown;

    if (!isValidChatSessionFile(parsedFile)) {
      return { success: false, error: 'Invalid chat session JSON structure' };
    }

    if (!isValidChatSessionId(parsedFile.chatSession_id)) {
      return { success: false, error: `Invalid ChatSession ID format: ${parsedFile.chatSession_id}` };
    }

    const deserialized = deserializeChatFile(parsedFile);

    const importedChatSessionFile = buildImportedChatSessionFile(deserialized);
    const importedChatSession = buildImportedChatSessionMetadata(importedChatSessionFile);

    const createdSession = await chatSessionStore.createSession(
      alias,
      chatId,
      importedChatSession,
      importedChatSessionFile,
      { autoSelect: false },
    );

    if (!createdSession) {
      return { success: false, error: 'Failed to import chat session' };
    }

    await profileCacheManager.forceNotifyProfileDataManager(alias);

    logger.info('[AgentAssetsImporter] Chat session imported from JSON file', 'importChatSessionFromFile', {
      alias,
      chatId,
      sourceChatSessionId: parsedFile.chatSession_id,
      importedChatSessionId: importedChatSessionFile.chatSession_id,
    });

    return {
      success: true,
      importedSessions: 1,
      importedSessionId: importedChatSessionFile.chatSession_id,
      importedWorkspaceFiles: 0,
    };
  } catch (error) {
    logger.error('[AgentAssetsImporter] Failed to import chat session from JSON file', 'importChatSessionFromFile', {
      alias,
      chatId,
      jsonFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default {
  importChatSessionFromFile,
};