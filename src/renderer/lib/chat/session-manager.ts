
import { Message, UserMessage, AssistantMessage } from '@shared/types/chatTypes';
import type { InteractiveRequest } from '@shared/types/interactiveRequestTypes';
import { StreamingChunk } from '@shared/types/streamingTypes';
import { isFeatureEnabled } from '../featureFlags';
import { createLogger } from '../utilities/logger';
import { produce, original, current, type WritableDraft } from 'immer';

const logger = createLogger('[SessionManager]');

/**
 * ChatStatus enum - kept in sync with ChatStatus in backend agentChat.ts
 */
export type ChatStatus =
  | 'idle'
  | 'sending_response'
  | 'compressing_context'
  | 'compressed_context'
  | 'received_response';

/**
 * ChatSession cache data structure.
 * Refactored: replaced structuredChatHistory with messages: Message[] for a simpler shape.
 */
export interface ChatSessionCache {
  chatSessionId: string;
  chatId: string;

  // Core change: store a flat message array directly
  messages: Message[];

  chatStatus: ChatStatus;
  streamingMessageId: string | null; // ID of the message currently being streamed
  contextTokenUsage: {
    tokenCount: number;
    totalMessages: number;
    contextMessages: number;
    compressionRatio: number;
  };
  lastUpdated: number;
  pendingInteractiveRequest?: InteractiveRequest | null;
  // Error message for display in ErrorBar
  errorMessage?: string | null;
}

interface Sessions {
  [id: string]: ChatSessionCache | undefined;
}

type ChangeType = 'add' | 'update' | 'remove';
type ChangedMessagesInSession = Array<{ message: Message; type: ChangeType }>;
export type SessionListener = (session: ChatSessionCache, type: ChangeType) => void;
export type MessageListener = (message: ChangedMessagesInSession, session: ChatSessionCache) => void;

export class SessionManager {
  private chatSessionCaches: Sessions = {};
  private sessionListeners = new Set<SessionListener>();
  private messageListeners = new Set<MessageListener>();
  private pendingMessageUpdates = new Map<string, [Message, ChangeType]>();

  onSessionChange(listener: SessionListener) {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  onMessageChange(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private markMessage(message: Message, type: ChangeType) {
    this.pendingMessageUpdates.set(message.id, [message, type]);
  }

  /**
   * Immutable session update via immer produce.
   * All mutation sites should use this method instead of directly mutating cache properties.
   */
  private updateSession(
    id: string,
    editFn: (session: WritableDraft<ChatSessionCache>) => void,
    tag?: string,
  ) {
    const session = this.chatSessionCaches[id];
    if (!session) {
      logger.warn('[SessionManager] Cache not found for chatSessionId' + (tag ? `---${tag}:` : ':'), id);
      return 'none' as const;
    }
    const next = produce(session, (draft) => editFn(draft));
    if (next === session) return 'unchanged' as const;

    this.chatSessionCaches[id] = next;

    if (this.pendingMessageUpdates.size > 0) {
      const changes: ChangedMessagesInSession = [];
      this.pendingMessageUpdates.forEach(([message, type]) => {
        changes.push({ message, type });
      });
      this.messageListeners.forEach(f => f(changes, next));
      this.pendingMessageUpdates.clear();
    }
    this.sessionListeners.forEach(f => f(next, 'update'));

    return 'updated' as const;
  }

  /**
   * Merge a backend snapshot into an already-populated frontend cache.
   *
   * Why this exists:
   * - Streaming chunks update the frontend cache immediately.
   * - Session switching / refresh can later recreate the cache from a backend snapshot.
   * - That snapshot is not guaranteed to be newer than the cache, especially while streaming
   *   is still in flight or when duplicate switch flows trigger an extra cache refresh.
   *
   * Failure mode seen in production:
   * - User switches away from a streaming session and then switches back.
   * - Frontend cache still contains newer streamed content.
   * - Backend sends a slightly older renderChatHistory snapshot.
   * - If we replace the cache blindly, the already-streamed prefix disappears until later chunks arrive.
   *
   * Merge rule:
   * - Treat the frontend cache as newer for the active streaming message.
   * - Keep any trailing messages that exist only in the frontend cache.
   * - Still allow the backend snapshot to refresh stable historical messages.
   *
   * This preserves UX correctness without changing the backend persistence contract.
   */
  private mergeSnapshotMessagesWithExistingCache(
    incomingMessages: Message[],
    existingCache: ChatSessionCache
  ): Message[] {
    if (existingCache.messages.length === 0) {
      return incomingMessages;
    }

    const existingMessageById = new Map(
      existingCache.messages
        .filter(message => Boolean(message.id) && !message.id?.startsWith('say-hi-'))
        .map(message => [message.id!, message])
    );

    const mergedMessages = incomingMessages.map(message => {
      if (!message.id) {
        return message;
      }

      if (existingCache.streamingMessageId && message.id === existingCache.streamingMessageId) {
        return existingMessageById.get(message.id) || message;
      }

      return message;
    });

    const mergedMessageIds = new Set(
      mergedMessages
        .filter(message => Boolean(message.id))
        .map(message => message.id!)
    );

    const canPreserveTrailingMessages = this.isIncomingSnapshotPrefixOfExistingCache(
      incomingMessages,
      existingCache.messages,
    );

    if (!canPreserveTrailingMessages) {
      logger.debug('[SessionManager] Skipping trailing cache preservation for divergent snapshot:', {
        chatSessionId: existingCache.chatSessionId,
        incomingCount: incomingMessages.length,
        existingCount: existingCache.messages.length,
        streamingMessageId: existingCache.streamingMessageId,
      });
      return mergedMessages;
    }

    const trailingExistingMessages = existingCache.messages.filter(message => {
      if (!message.id || message.id.startsWith('say-hi-')) {
        return false;
      }
      return !mergedMessageIds.has(message.id);
    });

    if (trailingExistingMessages.length === 0) {
      return mergedMessages;
    }

    logger.debug('[SessionManager] Preserving newer cached messages during cache refresh:', {
      chatSessionId: existingCache.chatSessionId,
      incomingCount: incomingMessages.length,
      existingCount: existingCache.messages.length,
      appendedCount: trailingExistingMessages.length,
      streamingMessageId: existingCache.streamingMessageId,
    });

    return [...mergedMessages, ...trailingExistingMessages];
  }

  private isIncomingSnapshotPrefixOfExistingCache(
    incomingMessages: Message[],
    existingMessages: Message[],
  ): boolean {
    const incomingIds = incomingMessages
      .filter(message => Boolean(message.id) && !message.id?.startsWith('say-hi-'))
      .map(message => message.id as string);
    const existingIds = existingMessages
      .filter(message => Boolean(message.id) && !message.id?.startsWith('say-hi-'))
      .map(message => message.id as string);

    if (incomingIds.length === 0) {
      return true;
    }

    if (incomingIds.length > existingIds.length) {
      return false;
    }

    return incomingIds.every((messageId, index) => existingIds[index] === messageId);
  }

  /**
   * Handle ChatSession cache creation.
   * Refactored: use renderChatHistory directly as messages; no StructuredChatHistory conversion needed.
   */
  handleChatSessionCacheCreated(
    chatSessionId: string,
    chatId: string,
    initialData?: Partial<ChatSessionCache>
  ) {
    logger.debug('[SessionManager] Creating chat session cache:', {
      chatSessionId,              // Session ID (chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>)
      chatId,                     // Agent ID (chat_TIMESTAMP_RANDOM)
      hasInitialData: !!initialData,
      note: 'Creating new session cache entry'
    });

    // Use renderChatHistory directly; no conversion needed
    let messages: Message[] = [];

    if (initialData?.messages) {
      // New structure: use messages directly
      messages = initialData.messages;
      logger.debug('[SessionManager] Using provided messages:', {
        chatSessionId,
        messageCount: messages.length
      });
    } else if ((initialData as any)?.renderChatHistory && Array.isArray((initialData as any).renderChatHistory)) {
      // Old structure: get from renderChatHistory
      messages = (initialData as any).renderChatHistory as Message[];
      logger.debug('[SessionManager] Using renderChatHistory as messages:', {
        chatSessionId,
        messageCount: messages.length
      });
    }

    // Filter out MCP-injected image messages (user_img_*) so they are never rendered.
    // These are backend-only messages injected by agentChat.ts for vision model consumption.
    if (isFeatureEnabled('browserControl') && messages.length > 0) {
      const beforeCount = messages.length;
      messages = messages.filter(m => !(m.role === 'user' && m.id?.startsWith('user_img_')));
      if (messages.length < beforeCount) {
        logger.debug('[SessionManager] Filtered MCP-injected image messages:', {
          chatSessionId,
          removed: beforeCount - messages.length,
          remaining: messages.length
        });
      }
    }

    // Check whether a cache already exists
    const existingCache = this.chatSessionCaches[chatSessionId];

    // Critical rule: cache recreation is not a blind replace.
    // The frontend cache may already be ahead of the incoming snapshot because streaming updates
    // are applied optimistically and more frequently than full backend snapshot refreshes.
    // Merge first so session switch / refresh cannot erase already-rendered streaming content.
    if (existingCache) {
      messages = this.mergeSnapshotMessagesWithExistingCache(messages, existingCache);

      // Preserve say-hi messages from the existing cache (frontend-only; never fetched from the backend)
      const existingSayHi = existingCache.messages.find(m => m.id?.startsWith('say-hi-'));
      if (existingSayHi && !messages.find(m => m.id?.startsWith('say-hi-'))) {
        // Insert say-hi message after the system message
        const systemIndex = messages.findIndex(m => m.role === 'system');
        if (systemIndex !== -1) {
          messages.splice(systemIndex + 1, 0, existingSayHi);
        } else {
          messages.unshift(existingSayHi);
        }
        logger.debug('[SessionManager] Preserved assistantSayHiMessage from existing cache:', {
          chatSessionId,
          messageId: existingSayHi.id
        });
      }
    }

    // Create new cache
    const newCache: ChatSessionCache = {
      chatSessionId,
      chatId,
      messages,
      chatStatus: initialData?.chatStatus || 'idle',
      streamingMessageId: initialData?.streamingMessageId || null,
      contextTokenUsage: initialData?.contextTokenUsage || {
        tokenCount: 0,
        totalMessages: 0,
        contextMessages: 0,
        compressionRatio: 1.0
      },
      pendingInteractiveRequest: initialData?.pendingInteractiveRequest !== undefined
        ? initialData.pendingInteractiveRequest
        : existingCache?.pendingInteractiveRequest,
      // Retain errorMessage state
      errorMessage: (initialData as any)?.errorMessage !== undefined
        ? (initialData as any).errorMessage
        : existingCache?.errorMessage,
      lastUpdated: Date.now()
    };

    // Inherit the streaming message ID
    if (existingCache) {
      if (initialData?.streamingMessageId === undefined) {
        newCache.streamingMessageId = existingCache.streamingMessageId;
      }
    }

    this.chatSessionCaches[chatSessionId] = newCache;
    this.sessionListeners.forEach(f => f(newCache, 'add'));

    return Boolean(existingCache);
  }

  handleChatSessionCacheDestroyed(chatSessionId: string) {
    logger.debug('[SessionManager] Destroying chat session cache:', { chatSessionId });
    const cache = this.chatSessionCaches[chatSessionId];
    if (cache) {
      delete this.chatSessionCaches[chatSessionId];
      this.sessionListeners.forEach(f => f(cache, 'remove'));
      return true;
    }
  }

  handleChatStatusChanged(chatSessionId: string, chatStatus: ChatStatus) {
    logger.debug('[SessionManager] Chat status changed:', {
      chatSessionId,              // Session ID (chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>)
      chatStatus,
      note: 'Status update for specific session'
    });

    const result =this.updateSession(chatSessionId, session => {
      session.chatStatus = chatStatus;
      session.lastUpdated = Date.now();

      // When transitioning to idle (e.g. after cancel), clear any stale streaming state
      // so the next turn starts fresh with a proper typing indicator.
      if (chatStatus === 'idle' && session.streamingMessageId) {
        session.streamingMessageId = null;
      }
    }, 'handleChatStatusChanged');

    return result === 'updated';
  }

  handleContextChange(chatSessionId: string, stats: any) {
    logger.debug('[SessionManager] Context changed:', {
      chatSessionId,              // Session ID (chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>)
      stats,
      note: 'Context token usage updated for session'
    });

    const result = this.updateSession(chatSessionId, session => {
      session.contextTokenUsage = {
        tokenCount: stats.tokenCount || 0,
        totalMessages: stats.totalMessages || 0,
        contextMessages: stats.contextMessages || 0,
        compressionRatio: stats.compressionRatio || 1.0
      };
      session.lastUpdated = Date.now();
    }, 'handleContextChange');

    return result === 'updated';
  }

  /**
   * Handle a streaming chunk (updates renderChatHistory).
   *
   * New architecture: process raw StreamingChunks directly, maintaining accumulated state internally.
   * Supports:
   * 1. Content chunks  - accumulate text content
   * 2. Tool call chunks - accumulate tool calls
   * 3. Tool result chunks - create tool messages
   * 4. Complete chunks - mark message as complete
   */
  handleStreamingChunk(chatSessionId: string, chunk: StreamingChunk) {
    const result = this.updateSession(chatSessionId, (cache) => {
      // Key optimization: set streamingMessageId without creating a placeholder.
      // Let the first content chunk create the real message to avoid an empty placeholder.
      if (chunk.type !== 'complete' && chunk.messageId) {
        if (cache.streamingMessageId !== chunk.messageId) {
          cache.streamingMessageId = chunk.messageId;
          logger.debug('[SessionManager] 🚀 Set streamingMessageId:', {
            chatSessionId: cache.chatSessionId,
            streamingMessageId: chunk.messageId,
            chunkType: chunk.type
          });
        }
      }

      // Dispatch based on chunk type.
      // Optimization: each handler immediately notifies listeners, enabling character-by-character rendering.
      switch (chunk.type) {
        case 'content':
          this.handleContentChunk(cache, chunk);
          break;
        case 'tool_call':
          this.handleToolCallChunk(cache, chunk);
          break;
        case 'tool_result':
          this.handleToolResultChunk(cache, chunk);
          break;
        case 'complete':
          this.handleCompleteChunk(cache, chunk);
          break;
        case 'user_message':
          this.handleUserMessageChunk(cache, chunk);
          break;
        default:
          logger.warn('[SessionManager] Unknown chunk type:', chunk);
      }
    }, 'handleStreamingChunk');

    return result === 'updated';
  }

  /**
   * Add a user message to the messages array.
   * No longer creates a ChatTurn; appends directly to the flat message list.
   */
  addUserMessage(chatSessionId: string, userMessage: Message) {
    // Filter out MCP-injected image messages
    if (isFeatureEnabled('browserControl') && userMessage.id.startsWith('user_img_')) {
      return;
    }

    const result = this.updateSession(chatSessionId, session => {
      this.markMessage(userMessage, 'add');
      session.messages.push(userMessage);
      session.lastUpdated = Date.now();
      logger.debug('[SessionManager] Added user message:', {
        chatSessionId,
        messageId: userMessage.id,
        totalMessages: session.messages.length
      });
    }, 'addUserMessage');

    return result === 'updated';
  }

  removeMessage(chatSessionId: string, messageId: string) {
    const result = this.updateSession(chatSessionId, session => {
      const i = session.messages.findIndex(m => m.id === messageId);
      if (i === -1) return;
      const target = original(session.messages[i])!;
      this.markMessage(target, 'remove');
      session.messages.splice(i, 1);
      session.lastUpdated = Date.now();
    });

    return result === 'updated';
  }

  /**
   * Handle a user_message chunk — remote channel user message pushed from backend.
   * Reuses addUserMessage() to append the message and trigger UI update.
   */
  private handleUserMessageChunk(cache: WritableDraft<ChatSessionCache>, chunk: StreamingChunk) {
    if (!chunk.userMessage) return;

    // Avoid duplicate: skip if a message with the same id already exists
    if (chunk.userMessage.id && cache.messages.some(m => m.id === chunk.userMessage!.id)) {
      return;
    }

    const userMessage: UserMessage = {
      id: chunk.userMessage.id || chunk.messageId,
      role: 'user',
      content: chunk.userMessage.content,
      timestamp: chunk.userMessage.timestamp || chunk.timestamp,
    };
    this.markMessage(userMessage, 'add');
    cache.messages.push(userMessage);
    cache.lastUpdated = Date.now();
  }

  /**
   * Handle a Content chunk - accumulate text content.
   * Refactored: find and update messages directly in the messages array.
   */
  private handleContentChunk(cache: WritableDraft<ChatSessionCache>, chunk: StreamingChunk) {
    if (!chunk.contentDelta) return;

    // Look up the target message in the messages array
    const messageIndex = cache.messages.findIndex(msg => msg.id === chunk.messageId);

    if (messageIndex === -1) {
      // Create a new message and append it
      const newMessage: Message = {
        id: chunk.messageId,
        role: 'assistant',
        content: [{ type: 'text', text: chunk.contentDelta.text }],
        timestamp: chunk.timestamp,
        streamingComplete: false
      };
      this.markMessage(newMessage, 'add');
      cache.messages.push(newMessage);
      cache.lastUpdated = Date.now();
    } else {
      // Update the existing message
      const targetMessage = cache.messages[messageIndex];
      const textContent = targetMessage.content.find((c: any) => c.type === 'text');

      const updatedMessage: Message = {
        ...targetMessage,
        content: textContent
          ? targetMessage.content.map((c: any) =>
              c.type === 'text' ? { type: 'text', text: c.text + chunk.contentDelta!.text } : c
            )
          : [...targetMessage.content, { type: 'text', text: chunk.contentDelta!.text }]
      };

      this.markMessage(updatedMessage, 'update');
      cache.messages.splice(messageIndex, 1, updatedMessage);
      cache.lastUpdated = Date.now();
    }
  }

  /**
   * Handle a Tool Call chunk - accumulate tool calls.
   * Refactored: find and update messages directly in the messages array.
   */
  private handleToolCallChunk(cache: WritableDraft<ChatSessionCache>, chunk: StreamingChunk) {
    if (!chunk.toolCallDelta) return;

    const messageIndex = cache.messages.findIndex(msg => msg.id === chunk.messageId);
    let targetMessage: AssistantMessage;

    if (messageIndex === -1) {
      targetMessage = {
        id: chunk.messageId,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        timestamp: chunk.timestamp,
        streamingComplete: false,
        tool_calls: []
      };
      cache.messages.push(targetMessage);
    } else {
      const existing = cache.messages[messageIndex];
      if (existing.role !== 'assistant') return;
      targetMessage = existing;
    }

    const delta = chunk.toolCallDelta;
    const index = delta.index || 0;

    // Initialise or update the tool_calls array
    const toolCalls = targetMessage.tool_calls ? [...targetMessage.tool_calls] : [];

    while (toolCalls.length <= index) {
      toolCalls.push({
        id: '',
        type: 'function',
        function: { name: '', arguments: '' }
      });
    }

    // 🔥 Fix: Create new toolCall object to avoid in-place mutation that React cannot detect
    const oldToolCall = toolCalls[index];
    const updatedToolCall = {
      ...oldToolCall,
      id: delta.id || oldToolCall.id,
      function: {
        ...oldToolCall.function,
        name: delta.function?.name || oldToolCall.function.name,
        arguments: oldToolCall.function.arguments + (delta.function?.arguments || '')
      }
    };
    toolCalls[index] = updatedToolCall;

    const updatedMessage = { ...targetMessage, tool_calls: toolCalls };

    // this must not be -1
    const idx = cache.messages.findIndex(msg => msg.id === chunk.messageId);
    this.markMessage(updatedMessage, 'update');
    cache.messages.splice(idx, 1, updatedMessage);

    cache.lastUpdated = Date.now();
  }

  /**
   * Handle a Tool Result chunk - create a tool message.
   * Refactored: append tool messages directly to the messages array.
   */
  private handleToolResultChunk(cache: WritableDraft<ChatSessionCache>, chunk: StreamingChunk) {
    if (!chunk.toolResult) return;

    const isFinalToolResult = !chunk.toolResult.isPartial;

    // Create the tool message
    const toolMessage: Message = {
      id: chunk.toolResult.tool_call_id,
      role: 'tool',
      content: [{ type: 'text', text: chunk.toolResult.content }],
      tool_call_id: chunk.toolResult.tool_call_id,
      name: chunk.toolResult.tool_name,
      timestamp: chunk.timestamp,
      streamingComplete: !chunk.toolResult.isPartial
    };

    // Check whether this tool message already exists
    const existingIndex = cache.messages.findIndex(
      msg => msg.role === 'tool' && msg.id === toolMessage.id
    );

    if (existingIndex !== -1) {
      // Update the existing message
      this.markMessage(toolMessage, 'update');
      cache.messages.splice(existingIndex, 1, toolMessage);
    } else {
      // Append the new tool message
      this.markMessage(toolMessage, 'add');
      cache.messages.push(toolMessage);
    }

    cache.lastUpdated = Date.now();

    if (isFinalToolResult && cache.streamingMessageId === toolMessage.id) {
      cache.streamingMessageId = null;
    }
  }

  /**
   * Handle a Complete chunk - mark the message as complete.
   * Refactored: update message state directly in the messages array.
   */
  private handleCompleteChunk(cache: WritableDraft<ChatSessionCache>, chunk: StreamingChunk) {
    if (!chunk.complete) return;

    const messageIndex = cache.messages.findIndex(msg => msg.id === chunk.complete!.messageId);
    let updatedMessage: Message | null = null;

    if (messageIndex !== -1) {
      const target = cache.messages[messageIndex];
      if (target.role !== 'assistant' && target.role !== 'tool') return;
      updatedMessage = { ...target, streamingComplete: true };

      this.markMessage(updatedMessage, 'update');
      cache.messages.splice(messageIndex, 1, updatedMessage);
      cache.streamingMessageId = null;
      cache.lastUpdated = Date.now();

      logger.debug('[SessionManager] Message completed:', {
        chatSessionId: cache.chatSessionId,
        messageId: chunk.complete.messageId,
        hasToolCalls: chunk.complete.hasToolCalls
      });
    }
  }

  handleInteractiveRequest(chatSessionId: string, data: InteractiveRequest) {
    const result = this.updateSession(chatSessionId, session => {
      session.pendingInteractiveRequest = data;
      session.lastUpdated = Date.now();
    }, 'handleInteractiveRequest');
    return result === 'updated';
  }

  handleInteractionProcessed(chatSessionId: string, data: any) {
    const result =this.updateSession(chatSessionId, session => {
      if (session.pendingInteractiveRequest?.interactionId === data.interactionId) {
        session.pendingInteractiveRequest = null;
        session.lastUpdated = Date.now();
      }
    }, 'handleInteractionProcessed');
    return result === 'updated';
  }

  getChatSessionCache(chatSessionId: string): ChatSessionCache | null {
    return this.chatSessionCaches[chatSessionId] || null;
  }

  getUserMessageSendState(chatSessionId: string | null | undefined): {
    canSend: boolean;
    error: string;
    chatStatus: string | null;
  } {
    if (!chatSessionId) {
      return { canSend: false, error: 'Cannot send a new message until chat status is ready.', chatStatus: null };
    }

    const chatStatus = this.getChatSessionCache(chatSessionId)?.chatStatus ?? null;
    if (chatStatus !== 'idle') {
      return {
        canSend: false,
        error: chatStatus
          ? `Cannot send a new message while chat status is ${chatStatus}.`
          : 'Cannot send a new message until chat status is ready.',
        chatStatus,
      };
    }
    return { canSend: true, error: '', chatStatus };
  }

  hasChatSessionCache(chatSessionId: string | null | undefined): boolean {
    return chatSessionId ? !!this.chatSessionCaches[chatSessionId] : false;
  }

  getAllChatSessionCaches(): Sessions {
    return this.chatSessionCaches;
  }


  replaceFilePathInMessages(
    chatSessionId: string,
    oldPath: string,
    newPath: string,
  ): number {
    let replacedCount = 0;

    this.updateSession(chatSessionId, (cache) => {
      for (let messageIndex = 0; messageIndex < cache.messages.length; messageIndex += 1) {
        const message = cache.messages[messageIndex];

        let count = replacedCount;
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content) {
          switch (part.type) {
            case 'file': {
              if (part.file?.filePath === oldPath) {
                part.file.filePath = newPath;
                replacedCount++;
              }
              break;
            }
            case 'office': {
              if (part.file?.filePath === oldPath) {
                part.file.filePath = newPath;
                replacedCount++;
              }
              break;
            }
            case 'others': {
              if (part.file?.filePath === oldPath) {
                part.file.filePath = newPath;
                replacedCount++;
              }
              break;
            }
            case 'image': {
              if (part.image_url?.url === oldPath) {
                part.image_url.url = newPath;
                replacedCount++;
              }
              break;
            }
            case 'text': {
              if (part.text && part.text.includes(oldPath)) {
                part.text = part.text.split(oldPath).join(newPath);
                replacedCount++;
              }
              break;
            }
          }
        }
        // Also check tool_calls arguments for file path references
        if (message.role === 'assistant' && message.tool_calls) {
          for (const toolCall of message.tool_calls) {
            if (toolCall.function?.arguments && toolCall.function.arguments.includes(oldPath)) {
              toolCall.function.arguments = toolCall.function.arguments.split(oldPath).join(newPath);
              replacedCount++;
            }
          }
        }

        if (replacedCount > count) {
          this.markMessage(current(message), 'update');
        }
      }

      if (replacedCount > 0) {
        cache.lastUpdated = Date.now();
      }
    }, 'replaceFilePathInMessages');

    return replacedCount;
  }

  // Todo: maybe just remove messages after one
  replaceMessages(chatSessionId: string, messages: Message[], updates?: Partial<ChatSessionCache>) {
    const result = this.updateSession(chatSessionId, session => {
      if (updates) Object.assign(session, updates);
      // Todo: mark messages update
      session.messages = messages;
      session.lastUpdated = Date.now();
    }, 'replaceMessages');
    return result === 'updated';
  }

  /**
   * Set the Assistant Say Hi message.
   * Used for frontend rendering only; not included in the chat context and never sent to the backend.
   * @param chatSessionId - ChatSession ID
   * @param markdownContent - Markdown greeting text; pass null or an empty string to clear it
   */
  setAssistantSayHiMessage(chatSessionId: string, markdownContent: string | null) {
    const result = this.updateSession(chatSessionId, (session) => {
      // Remove existing say-hi messages
      session.messages = session.messages.filter(m => !m.id?.startsWith('say-hi-'));

      if (markdownContent && markdownContent.trim()) {
        const sayHiMessage: AssistantMessage = {
          id: `say-hi-${chatSessionId}-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: markdownContent }],
          timestamp: Date.now(),
          streamingComplete: true
        };

        // Insert after the system message
        const systemIndex = session.messages.findIndex(m => m.role === 'system');
        if (systemIndex !== -1) {
          session.messages.splice(systemIndex + 1, 0, sayHiMessage);
        } else {
          session.messages.unshift(sayHiMessage);
        }

        this.markMessage(sayHiMessage, 'add');
        session.lastUpdated = Date.now();
      }
    }, 'setAssistantSayHiMessage');
    return result === 'updated';
  }

  setErrorMessage(chatSessionId: string, errorMessage: string) {
    logger.debug('[SessionManager] Setting error message:', {
      chatSessionId,
      errorMessage: errorMessage.substring(0, 100) + (errorMessage.length > 100 ? '...' : '')
    });

    const result = this.updateSession(chatSessionId, session => {
      session.errorMessage = errorMessage;
      session.lastUpdated = Date.now();
    }, 'setErrorMessage');

    return result === 'updated';
  }

  clearErrorMessage(chatSessionId: string) {
    logger.debug('[SessionManager] Clearing error message:', { chatSessionId });

    const result = this.updateSession(chatSessionId, session => {
      session.errorMessage = null;
      session.lastUpdated = Date.now();
    }, 'clearErrorMessage');

    return result === 'updated';
  }

  cleanup(): void {
    this.chatSessionCaches = {};
  }
}
