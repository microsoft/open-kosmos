import { CreateChatSessionParams } from '@shared/types/chatSessionTypes';
import { Message, UserMessage, UserContentPart } from '@shared/types/chatTypes';
import { ChatSessionFile } from '../userDataADO/chatSessionFileOps';
import type { ChatSession } from '../userDataADO/types/profile';
import { ChatSessionTitleLlmSummarizer } from '../llm/chatSessionTitleLlmSummarizer';
import { chatSessionStore } from './chatSessionStore';
import { createLogger } from '../unifiedLogger';
import { CancellationError, CancellationToken } from '../cancellation';
import type { StartChatCallbacks } from '@shared/types/chatTypes';
import { MessageHelper } from '@shared/types/chatTypes';
import { isToolMessageOrphaned } from './agentChatToolMessageSanitizer';

const logger = createLogger();

interface UserMessageEditValidationResult {
  canEdit: boolean;
  targetUserIndex: number;
  targetUserMessage: Message | null;
  targetContextUserIndex: number;
  error?: string;
}

export interface AgentChatSessionServiceDeps {
  getCurrentChatSession(): ChatSessionFile | null;
  setCurrentChatSession(session: ChatSessionFile | null): void;
  getCurrentUserAlias(): string;
  getChatId(): string;
  getChatSessionId(): string;
  getAgentName(): string;
  getFirstUserMessage(): Message | null;
  setFirstUserMessage(message: Message | null): void;
  getSchedulerMetadata(): {
    schedulerJobId?: string;
    schedulerExecutionStatus?: 'running' | 'completed' | 'failed';
    schedulerStartedAt?: string;
    schedulerCompletedAt?: string;
    schedulerError?: string;
  };
  getMessagesToSave(): Message[];
  setMessagesToSave(messages: Message[]): void;
  getSaveChain(): Promise<{ success: boolean; error?: string }>;
  setSaveChain(chain: Promise<{ success: boolean; error?: string }>): void;
  addMessageToChatHistory(message: Message): void;
  addMessageToContext(message: Message): Promise<void>;
  shouldTrackChatSessionActivatedForUserMessage(message: Message): boolean;
  getChatSessionEntryTypeForUserMessage(message: Message): 'new' | 'continued';
  trackChatSessionActivated(message: Message, sessionEntryType: 'new' | 'continued'): void;
  exitNewChatSessionState(): void;
  calculateAndNotifyContext(): Promise<void>;
  startChat(token?: CancellationToken, callbacks?: StartChatCallbacks): Promise<void>;
  getDisplayMessages(): Message[];
  getSkipPersistence(): boolean;
}

export class AgentChatSessionService {
  constructor(private readonly deps: AgentChatSessionServiceDeps) {}

  async saveChatSession(): Promise<{ success: boolean; error?: string }> {
    if (this.deps.getSkipPersistence()) {
      return { success: true };
    }

    const saveOperation = async (): Promise<{ success: boolean; error?: string }> => {
      const currentChatSession = this.deps.getCurrentChatSession();
      if (!currentChatSession) {
        return { success: false, error: 'No current ChatSession' };
      }

      const currentUserAlias = this.deps.getCurrentUserAlias();
      if (!currentUserAlias) {
        logger.error('[AgentChat] No user alias set, cannot save ChatSession', 'saveChatSession', {
          agentName: this.deps.getAgentName(),
          sessionId: currentChatSession.chatSession_id,
        });
        return { success: false, error: 'No user alias set' };
      }

      const chatId = this.deps.getChatId();
      if (!chatId) {
        logger.error('[AgentChat] No chat ID set, cannot save ChatSession', 'saveChatSession', {
          agentName: this.deps.getAgentName(),
          sessionId: currentChatSession.chatSession_id,
          hint: 'Make sure setChatId() is called when creating the AgentChat instance',
        });
        return { success: false, error: 'No chat ID set' };
      }

      if (this.deps.getFirstUserMessage() && currentChatSession.title === 'New Chat') {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        currentChatSession.title = `Chat ${timeStr}`;

        const cachedUserMessage = this.deps.getFirstUserMessage();
        this.deps.setFirstUserMessage(null);
        if (cachedUserMessage) {
          this.generateChatSessionTitle(cachedUserMessage).then(() => {
            this.saveChatSession().catch((error) => {
              logger.error('[AgentChat] Failed to save after title generation', 'saveChatSession', {
                agentName: this.deps.getAgentName(),
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }).catch((error) => {
            logger.error('[AgentChat] Async title generation failed', 'saveChatSession', {
              agentName: this.deps.getAgentName(),
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      try {
        const sessionSnapshot = JSON.parse(JSON.stringify(currentChatSession)) as ChatSessionFile;
        const sessionMetadata = {
          chatSession_id: sessionSnapshot.chatSession_id,
          last_updated: new Date().toISOString(),
          title: sessionSnapshot.title,
          ...this.deps.getSchedulerMetadata(),
        };

        sessionSnapshot.last_updated = sessionMetadata.last_updated;
        currentChatSession.last_updated = sessionMetadata.last_updated;

        const saved = await chatSessionStore.saveSession(
          currentUserAlias,
          chatId,
          sessionMetadata,
          sessionSnapshot,
        );

        if (!saved) {
          return { success: false, error: 'Failed to save session through ChatSessionStore' };
        }

        return { success: true };
      } catch (error) {
        logger.error('[AgentChat] ❌ Exception in saveChatSession', 'saveChatSession', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          agentName: this.deps.getAgentName(),
          sessionId: currentChatSession?.chatSession_id,
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };

    const nextSave = this.deps.getSaveChain().then(() => saveOperation(), () => saveOperation());
    this.deps.setSaveChain(nextSave.catch(() => ({ success: false })));
    return nextSave;
  }

  async replaceFilePathInSession(oldPath: string, newPath: string): Promise<{ success: boolean; replacedCount: number; error?: string }> {
    const currentChatSession = this.deps.getCurrentChatSession();
    if (!currentChatSession) {
      return { success: false, replacedCount: 0, error: 'No current ChatSession' };
    }

    let replacedCount = 0;

    const replaceInMessages = (messages: Message[]) => {
      for (const message of messages) {
        if (!Array.isArray(message.content)) {
          continue;
        }

        for (const part of message.content) {
          switch (part.type) {
            case 'file': {
              const filePart = part as any;
              if (filePart.file?.filePath === oldPath) {
                filePart.file.filePath = newPath;
                replacedCount += 1;
              }
              break;
            }
            case 'office': {
              const officePart = part as any;
              if (officePart.file?.filePath === oldPath) {
                officePart.file.filePath = newPath;
                replacedCount += 1;
              }
              break;
            }
            case 'others': {
              const othersPart = part as any;
              if (othersPart.file?.filePath === oldPath) {
                othersPart.file.filePath = newPath;
                replacedCount += 1;
              }
              break;
            }
            case 'image': {
              const imagePart = part as any;
              if (imagePart.image_url?.url === oldPath) {
                imagePart.image_url.url = newPath;
                replacedCount += 1;
              }
              break;
            }
            case 'text': {
              const textPart = part as any;
              if (textPart.text && textPart.text.includes(oldPath)) {
                textPart.text = textPart.text.split(oldPath).join(newPath);
                replacedCount += 1;
              }
              break;
            }
          }
        }

        if (message.role === 'assistant' && message.tool_calls) {
          for (const toolCall of message.tool_calls) {
            if (toolCall.function?.arguments && toolCall.function.arguments.includes(oldPath)) {
              toolCall.function.arguments = toolCall.function.arguments.split(oldPath).join(newPath);
              replacedCount += 1;
            }
          }
        }
      }
    };

    try {
      replaceInMessages(currentChatSession.chat_history);
      replaceInMessages(currentChatSession.context_history);
      await this.saveChatSession();

      logger.info('[AgentChat] File path replaced in session', 'replaceFilePathInSession', {
        oldPath,
        newPath,
        replacedCount,
        agentName: this.deps.getAgentName(),
        sessionId: currentChatSession.chatSession_id,
      });

      return { success: true, replacedCount };
    } catch (error) {
      logger.error('[AgentChat] Failed to replace file path in session', 'replaceFilePathInSession', {
        oldPath,
        newPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, replacedCount, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async editUserMessage(
    messageId: string,
    updatedMessage: Message,
    token?: CancellationToken,
    callbacks?: StartChatCallbacks,
  ): Promise<Message[]> {
    logger.info('[AgentChat] ✏️ Editing user message', 'editUserMessage', {
      messageId,
      agentName: this.deps.getAgentName(),
      hasCancellationToken: !!token,
    });

    if (token?.isCancellationRequested) {
      throw new CancellationError('Edit was cancelled before it started');
    }

    const currentChatSession = this.deps.getCurrentChatSession();
    if (!currentChatSession) {
      throw new Error('No current ChatSession to edit');
    }

    const hasUserContent = updatedMessage.content.some((part) => {
      if (part.type === 'text') {
        return part.text.trim().length > 0;
      }
      return part.type !== 'thinking';
    });

    if (!hasUserContent) {
      throw new Error('Edited message cannot be empty');
    }

    const validation = this.validateUserMessageEditable(messageId);
    if (!validation.canEdit || !validation.targetUserMessage) {
      throw new Error(validation.error || 'User message cannot be edited');
    }

    const normalizedMessage: UserMessage = {
      id: validation.targetUserMessage.id,
      role: 'user',
      timestamp: validation.targetUserMessage.timestamp ?? updatedMessage.timestamp ?? Date.now(),
      content: structuredClone(updatedMessage.content).filter(p => p.type !== 'thinking'),
    };

    currentChatSession.chat_history = [
      ...currentChatSession.chat_history.slice(0, validation.targetUserIndex),
      normalizedMessage,
    ];

    currentChatSession.context_history = [
      ...currentChatSession.context_history.slice(0, validation.targetContextUserIndex),
      normalizedMessage,
    ];

    currentChatSession.last_updated = new Date().toISOString();
    if (validation.targetUserIndex === 0) {
      this.deps.setFirstUserMessage(normalizedMessage);
      currentChatSession.title = 'New Chat';
    }

    // Clear any stale messagesToSave buffer left from a cancelled tool execution
    this.deps.setMessagesToSave([]);

    await this.saveChatSession();
    await this.deps.calculateAndNotifyContext();
    await this.deps.startChat(token, callbacks);
    return this.deps.getDisplayMessages();
  }

  validateUserMessageEditable(messageId: string): UserMessageEditValidationResult {
    const currentChatSession = this.deps.getCurrentChatSession();
    if (!currentChatSession) {
      return {
        canEdit: false,
        targetUserIndex: -1,
        targetUserMessage: null,
        targetContextUserIndex: -1,
        error: 'No current ChatSession to edit',
      };
    }

    const targetUserIndex = currentChatSession.chat_history.findIndex(
      (message) => message.id === messageId && message.role === 'user',
    );

    if (targetUserIndex === -1) {
      return {
        canEdit: false,
        targetUserIndex,
        targetUserMessage: null,
        targetContextUserIndex: -1,
        error: 'This user message is no longer available in chat history, so it can no longer be edited.',
      };
    }

    const targetUserMessage = currentChatSession.chat_history[targetUserIndex];
    const targetContextUserIndex = currentChatSession.context_history.findIndex(
      (message) => message.id === messageId && message.role === 'user',
    );

    if (targetContextUserIndex === -1) {
      return {
        canEdit: false,
        targetUserIndex,
        targetUserMessage,
        targetContextUserIndex,
        error: 'This message can no longer be edited because its original content has been compressed out of the current context.',
      };
    }

    return {
      canEdit: true,
      targetUserIndex,
      targetUserMessage,
      targetContextUserIndex,
    };
  }

  createChatSession(params: CreateChatSessionParams = {}): void {
    if (!params.chatSession_id) {
      throw new Error('chatSession_id must be provided by AgentChatManager');
    }

    this.deps.setCurrentChatSession({
      chatSession_id: params.chatSession_id,
      title: params.title || 'New Chat',
      last_updated: new Date().toISOString(),
      chat_history: params.initialMessage ? [params.initialMessage] : [],
      context_history: params.initialMessage ? [params.initialMessage] : [],
      interaction_history: [],
    });
  }

  async generateChatSessionTitle(userMessage: Message): Promise<void> {
    const currentChatSession = this.deps.getCurrentChatSession();
    if (!currentChatSession) {
      logger.warn('[AgentChat] No current ChatSession for title generation', 'AgentChat.generateChatSessionTitle', {
        agentName: this.deps.getAgentName(),
      });
      return;
    }

    try {
      const userMessageText = MessageHelper.getText(userMessage);
      if (!userMessageText || userMessageText.trim().length === 0) {
        logger.warn('[AgentChat] User message has no text content, skipping title generation', 'AgentChat.generateChatSessionTitle', {
          agentName: this.deps.getAgentName(),
        });
        return;
      }

      const titleResponse = await ChatSessionTitleLlmSummarizer.generateTitle(userMessageText);
      if (titleResponse?.success && titleResponse.title) {
        currentChatSession.title = titleResponse.title.trim();
        currentChatSession.last_updated = new Date().toISOString();
      } else {
        logger.warn('[AgentChat] Title generation failed or returned no title', 'AgentChat.generateChatSessionTitle', {
          agentName: this.deps.getAgentName(),
          sessionId: currentChatSession.chatSession_id,
          success: titleResponse?.success,
          hasTitle: !!titleResponse?.title,
          errors: titleResponse?.errors,
          warnings: titleResponse?.warnings,
        });
        currentChatSession.title = this.generateFallbackTitle(userMessageText);
        currentChatSession.last_updated = new Date().toISOString();
      }
    } catch (error) {
      logger.error('[AgentChat] Exception during title generation', 'AgentChat.generateChatSessionTitle', {
        agentName: this.deps.getAgentName(),
        sessionId: currentChatSession.chatSession_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      try {
        currentChatSession.title = this.generateFallbackTitle(MessageHelper.getText(userMessage));
        currentChatSession.last_updated = new Date().toISOString();
      } catch (recoveryError) {
        logger.error('[AgentChat] Failed to apply fallback title after exception', 'AgentChat.generateChatSessionTitle', {
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        });
      }
    }
  }

  generateFallbackTitle(userMessageText: string): string {
    const trimmedMessage = userMessageText.trim();
    const words = trimmedMessage.split(/\s+/).slice(0, 4);
    let fallbackTitle = words.join(' ');
    if (fallbackTitle.length > 50) {
      fallbackTitle = `${fallbackTitle.substring(0, 47)}...`;
    }
    if (fallbackTitle.length < 5) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      fallbackTitle = `Chat ${timeStr}`;
    }
    return fallbackTitle;
  }

  async addMessageToSession(message: Message): Promise<void> {
    const currentChatSession = this.deps.getCurrentChatSession();
    if (!currentChatSession) {
      throw new Error('currentChatSession must be initialized before calling addMessageToSession.');
    }

    if (message.role === 'tool' && message.tool_call_id) {
      if (isToolMessageOrphaned(message.tool_call_id, currentChatSession.chat_history)) {
        logger.warn('[AgentChat] ⚠️ Rejected orphaned tool message — no matching assistant tool_call found', 'addMessageToSession', {
          toolCallId: message.tool_call_id,
          toolName: message.name,
          messageId: message.id,
          agentName: this.deps.getAgentName(),
        });
        return;
      }
    }

    const isFirstMessage = currentChatSession.chat_history.length === 0;
    const isFirstUserMessage = isFirstMessage && message.role === 'user';
    const shouldTrackChatSessionActivated = this.deps.shouldTrackChatSessionActivatedForUserMessage(message);
    const chatSessionEntryType = this.deps.getChatSessionEntryTypeForUserMessage(message);

    this.deps.addMessageToChatHistory(message);
    await this.deps.addMessageToContext(message);

    if (isFirstMessage && message.role === 'user' && !this.deps.getFirstUserMessage()) {
      this.deps.setFirstUserMessage(message);
    }

    const messagesToSave = [...this.deps.getMessagesToSave(), message];
    this.deps.setMessagesToSave(messagesToSave);

    if (messagesToSave.length > 2) {
      logger.error('[AgentChat] ❌ CRITICAL ERROR: messagesToSave exceeded limit', 'addMessageToSession', {
        messagesToSaveLength: messagesToSave.length,
        messages: messagesToSave.map((queuedMessage) => ({
          id: queuedMessage.id,
          role: queuedMessage.role,
          hasToolCalls: !!(queuedMessage.role === 'assistant' && queuedMessage.tool_calls),
        })),
      });
      throw new Error('MessageToSave only allow a single message or a pair of <Assistant message with Tool call, Tool message>');
    }

    const isAssistantWithToolCall = message.role === 'assistant' && !!message.tool_calls && message.tool_calls.length > 0;
    if (!isAssistantWithToolCall) {
      this.saveChatSession().then((result) => {
        if (result.success && isFirstUserMessage) {
          this.deps.exitNewChatSessionState();
        }

        if (result.success && shouldTrackChatSessionActivated) {
          this.deps.trackChatSessionActivated(message, chatSessionEntryType);
        }
      }).catch((error) => {
        logger.error('[AgentChat] ❌ Async save failed', 'addMessageToSession', {
          error: error instanceof Error ? error.message : String(error),
          agentName: this.deps.getAgentName(),
        });
      });

      this.deps.setMessagesToSave([]);
    }
  }
}