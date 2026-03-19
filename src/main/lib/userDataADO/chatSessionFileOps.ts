/**
 * Chat Session File Operations - Main Process
 *
 * This module handles reading and writing ChatSession files in the main process.
 * Each ChatSession is stored as a separate JSON file in '{userProfile}/chat_sessions'.
 * File naming convention: {chatSessionId}.json
 *
 * Features:
 * - Read/Write ChatSession JSON files
 * - File path management
 * - Chat_History and Context_History data structures aligned with agentChat.ts
 * - Error handling and validation
 * - File system operations with proper permissions
 * - Dynamic user profile directory support
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
// Define Message interface locally to avoid cross-process imports
interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: any[]; // UnifiedContentPart[] - simplified for main process
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  streamingComplete?: boolean;
  timestamp?: number;
}

/**
 * ChatSession File Structure
 * Stored in user profile directory under chat_sessions/
 */
export interface ChatSessionFile {
  /** ChatSession ID，format: chatSession_YYYYMMDDHHMMSS */
  chatSession_id: string;
  /** Last update time in ISO format */
  last_updated: string;
  /** Chat session title, summarized from first 2 message turns, max 20 tokens */
  title: string;
  /** Chat history for UI display (corresponds to agentChat.ts chatHistory) */
  chat_history: Message[];
  /** Context history for LLM processing (corresponds to agentChat.ts contextHistory) */
  context_history: Message[];
}

/**
 * Operation result interface
 */
export interface ChatSessionFileResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Chat Session File Operations Manager
 */
export class ChatSessionFileOps {
  private static instances: Map<string, ChatSessionFileOps> = new Map();
  private readonly basePath: string;
  private readonly userAlias: string;

  private constructor(userAlias: string) {
    this.userAlias = userAlias;
    // Use user profile directory: {userData}/profiles/{userAlias}/chat_sessions
    let userDataPath: string;
    
    try {
      // In production/main process, use app.getPath
      userDataPath = app.getPath('userData');
    } catch (error) {
      // In test environment, use a local test directory
      const os = require('os');
      userDataPath = path.join(os.tmpdir(), 'kosmos-app-test');
    }
    
    this.basePath = path.join(userDataPath, 'profiles', userAlias, 'chat_sessions');
    this.ensureDirectoryExists();
  }

  static getInstance(userAlias: string): ChatSessionFileOps {
    if (!ChatSessionFileOps.instances.has(userAlias)) {
      ChatSessionFileOps.instances.set(userAlias, new ChatSessionFileOps(userAlias));
    }
    return ChatSessionFileOps.instances.get(userAlias)!;
  }

  /**
   * Ensure the chat sessions directory exists
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.basePath)) {
        fs.mkdirSync(this.basePath, { recursive: true });
      }
    } catch (error) {
      throw new Error(`Failed to create chat sessions directory for user ${this.userAlias}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the user alias for this instance
   */
  getUserAlias(): string {
    return this.userAlias;
  }

  /**
   * Get file path for a ChatSession
   */
  private getFilePath(chatSessionId: string): string {
    return path.join(this.basePath, `${chatSessionId}.json`);
  }

  /**
   * Validate ChatSession ID format
   */
  private isValidChatSessionId(chatSessionId: string): boolean {
    return /^chatSession_\d{14}$/.test(chatSessionId);
  }

  /**
   * Read ChatSession file
   */
  async readChatSession(chatSessionId: string): Promise<ChatSessionFileResult> {
    try {
      if (!this.isValidChatSessionId(chatSessionId)) {
        return {
          success: false,
          error: `Invalid ChatSession ID format: ${chatSessionId}`
        };
      }

      const filePath = this.getFilePath(chatSessionId);
      
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `ChatSession file not found: ${chatSessionId}`
        };
      }

      const fileContent = fs.readFileSync(filePath, 'utf8');
      const chatSession: ChatSessionFile = JSON.parse(fileContent);

      // Validate the loaded data
      if (!this.validateChatSessionStructure(chatSession)) {
        return {
          success: false,
          error: `Invalid ChatSession file structure: ${chatSessionId}`
        };
      }

      return {
        success: true,
        data: chatSession
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to read ChatSession: ${errorMessage}`
      };
    }
  }

  /**
   * Write ChatSession file
   */
  async writeChatSession(chatSession: ChatSessionFile): Promise<ChatSessionFileResult> {
    try {
      if (!this.validateChatSessionStructure(chatSession)) {
        return {
          success: false,
          error: 'Invalid ChatSession structure'
        };
      }

      if (!this.isValidChatSessionId(chatSession.chatSession_id)) {
        return {
          success: false,
          error: `Invalid ChatSession ID format: ${chatSession.chatSession_id}`
        };
      }

      // Update last_updated timestamp
      chatSession.last_updated = new Date().toISOString();

      const filePath = this.getFilePath(chatSession.chatSession_id);
      const fileContent = JSON.stringify(chatSession, null, 2);

      fs.writeFileSync(filePath, fileContent, 'utf8');

      return {
        success: true,
        data: chatSession
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to write ChatSession: ${errorMessage}`
      };
    }
  }

  /**
   * Update ChatSession file
   */
  async updateChatSession(
    chatSessionId: string,
    updates: Partial<Omit<ChatSessionFile, 'chatSession_id'>>
  ): Promise<ChatSessionFileResult> {
    try {
      // First read the existing file
      const readResult = await this.readChatSession(chatSessionId);
      if (!readResult.success) {
        return readResult;
      }

      const existingSession = readResult.data as ChatSessionFile;
      
      // Apply updates
      const updatedSession: ChatSessionFile = {
        ...existingSession,
        ...updates,
        chatSession_id: chatSessionId, // Ensure ID cannot be changed
        last_updated: new Date().toISOString() // Always update timestamp
      };

      // Write the updated session
      return await this.writeChatSession(updatedSession);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to update ChatSession: ${errorMessage}`
      };
    }
  }

  /**
   * Delete ChatSession file
   */
  async deleteChatSession(chatSessionId: string): Promise<ChatSessionFileResult> {
    try {
      if (!this.isValidChatSessionId(chatSessionId)) {
        return {
          success: false,
          error: `Invalid ChatSession ID format: ${chatSessionId}`
        };
      }

      const filePath = this.getFilePath(chatSessionId);
      
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `ChatSession file not found: ${chatSessionId}`
        };
      }

      fs.unlinkSync(filePath);

      return {
        success: true,
        data: { chatSessionId }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to delete ChatSession: ${errorMessage}`
      };
    }
  }

  /**
   * Check if ChatSession file exists
   */
  chatSessionExists(chatSessionId: string): boolean {
    if (!this.isValidChatSessionId(chatSessionId)) {
      return false;
    }
    
    const filePath = this.getFilePath(chatSessionId);
    return fs.existsSync(filePath);
  }

  /**
   * Validate ChatSession structure
   */
  private validateChatSessionStructure(chatSession: any): chatSession is ChatSessionFile {
    return (
      chatSession &&
      typeof chatSession === 'object' &&
      typeof chatSession.chatSession_id === 'string' &&
      typeof chatSession.last_updated === 'string' &&
      typeof chatSession.title === 'string' &&
      Array.isArray(chatSession.chat_history) &&
      Array.isArray(chatSession.context_history) &&
      this.isValidChatSessionId(chatSession.chatSession_id)
    );
  }

  /**
   * Get the base directory path
   */
  getBasePath(): string {
    return this.basePath;
  }
}

// Convenience functions for common operations that require userAlias
export async function readChatSessionFile(userAlias: string, chatSessionId: string): Promise<ChatSessionFileResult> {
  const ops = ChatSessionFileOps.getInstance(userAlias);
  return await ops.readChatSession(chatSessionId);
}

export async function writeChatSessionFile(userAlias: string, chatSession: ChatSessionFile): Promise<ChatSessionFileResult> {
  const ops = ChatSessionFileOps.getInstance(userAlias);
  return await ops.writeChatSession(chatSession);
}

export async function updateChatSessionFile(
  userAlias: string,
  chatSessionId: string,
  updates: Partial<Omit<ChatSessionFile, 'chatSession_id'>>
): Promise<ChatSessionFileResult> {
  const ops = ChatSessionFileOps.getInstance(userAlias);
  return await ops.updateChatSession(chatSessionId, updates);
}

export async function deleteChatSessionFile(userAlias: string, chatSessionId: string): Promise<ChatSessionFileResult> {
  const ops = ChatSessionFileOps.getInstance(userAlias);
  return await ops.deleteChatSession(chatSessionId);
}

export function getChatSessionBasePath(userAlias: string): string {
  const ops = ChatSessionFileOps.getInstance(userAlias);
  return ops.getBasePath();
}