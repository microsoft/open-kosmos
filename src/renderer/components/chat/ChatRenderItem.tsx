import React, { useMemo } from 'react';
import { Message, MessageHelper, ToolCall, UserMessage } from '@shared/types/chatTypes';
import MessageComponent from './message/Message';
import ChatInput from './ChatInput';
import { ToolCallsSection } from './ToolCallsSection';
import { PresentedFile } from './message/GeneratedFileCards';
import { CachedFilePath, ChatStatus, extractFilePathsFromText } from '../../lib/chat/agentChatSessionCacheManager';
import type { InteractiveRequest, InteractiveResponse } from '@shared/types/interactiveRequestTypes';
import type { ExecuteCommandInteractiveAuthHint, ExecuteCommandToolArgs, ExecuteCommandToolResult } from '@shared/types/toolCallArgs';
import InteractiveRequestCard from './InteractiveRequestCard';
import InteractiveAuthCard from './InteractiveAuthCard';
import type { EditingMessageState } from './edit-message.atom';
import { logger } from '@renderer/lib/utilities/logger';

export type ChatRenderItem =
  | { type: 'system'; message: Message; index: number }
  | { type: 'say-hi'; message: Message; index: number }
  | { type: 'user'; message: Message; index: number }
  | { type: 'assistant'; message: Message; index: number; presentedFiles?: PresentedFile[]; extractedFilePaths?: string[] }
  | { type: 'tool-calls-section'; toolCalls: ToolCall[]; sectionKey: string; sourceMessageIndex?: number; index: number }
  | { type: 'activity-loading'; sectionKey: string; index: number }
  | { type: 'activity-placeholder'; sectionKey: string; index: number }
  | { type: 'interactive-request'; interactiveRequest: InteractiveRequest; sectionKey: string; index: number }
  | { type: 'interactive-auth'; interactiveAuth: { hint: ExecuteCommandInteractiveAuthHint; command?: string; chatSessionId?: string | null }; sectionKey: string; sourceMessageIndex?: number; index: number };

function assertNever(item: never): never {
  throw new Error('Function not implemented.');
}
export const getChatRenderItemStableKey = (item?: ChatRenderItem): string => {
  if (!item) {
    return 'none';
  }

  switch (item.type) {
    case 'assistant':
    case 'user':
    case 'system':
    case 'say-hi':
      return `${item.type}:${item.message.id || item.index}`;
    case 'tool-calls-section':
      return `${item.type}:${item.sectionKey || item.sourceMessageIndex || item.index}`;
    case 'interactive-request':
      return `${item.type}:${item.interactiveRequest.interactionId || item.index}`;
    case 'interactive-auth':
      return `${item.type}:${item.sectionKey || item.interactiveAuth.hint.commandFamily || item.index}`;
    case 'activity-loading':
    case 'activity-placeholder':
      return `${item.type}:${item.sectionKey || item.index}`;
    default:
      assertNever(item);
  }
};

export const isVisibleChatRenderItem = (item?: ChatRenderItem): boolean => {
  if (!item) {
    return false;
  }

  if (item.type === 'tool-calls-section') {
    return Boolean(item.toolCalls.some(toolCall => toolCall.function.name?.trim()));
  }

  if (item.type === 'interactive-request') {
    return Boolean(item.interactiveRequest);
  }

  if (item.type === 'interactive-auth') {
    return Boolean(item.interactiveAuth.hint);
  }

  return item.type !== 'activity-loading' && item.type !== 'activity-placeholder';
};

export const hasTextContent = (message: Message): boolean => {
  return message.content.some(part => {
    if (part.type === 'text') {
      const text = part.text || '';
      return text.trim().length > 0;
    }
    return false;
  });
};

const parseExecuteCommandArgs = (toolCall: ToolCall): ExecuteCommandToolArgs | null => {
  try {
    return JSON.parse(toolCall.function.arguments || '{}') as ExecuteCommandToolArgs;
  } catch {
    return null;
  }
};

const parseExecuteCommandToolResult = (message: Message): ExecuteCommandToolResult | null => {
  try {
    const text = MessageHelper.getText(message);
    if (!text) {
      return null;
    }
    return JSON.parse(text) as ExecuteCommandToolResult;
  } catch {
    return null;
  }
};

// Helper: extract present_deliverables tool calls as PresentedFiles
const extractPresentedFiles = (toolCalls: ToolCall[]): PresentedFile[] => {
  const files: PresentedFile[] = [];
  toolCalls.forEach(tc => {
    if (tc.function.name === 'present_deliverables') {
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        if (args.filePaths && Array.isArray(args.filePaths)) {
          files.push({
            filePath: JSON.stringify(args.filePaths),
            description: args.description || 'Final deliverables'
          });
        }
      } catch {
        // Skip on parse failure
      }
    }
  });
  return files;
};

const extractInteractiveAuthCards = (
  toolCalls: ToolCall[],
  allMessages: Message[],
  chatSessionId?: string | null,
) => {
  function findToolMessage(id: string) {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const message = allMessages[i];
      if (
        message.role === 'tool'
        && message.tool_call_id === id
        && message.name === 'execute_command'
        && message.streamingComplete === false
      ) {
        return message;
      }
    }
  }

  return toolCalls.flatMap((toolCall) => {
    if (toolCall.function.name !== 'execute_command' || !toolCall.id) {
      return [];
    }
    const toolMessage = findToolMessage(toolCall.id);
    if (!toolMessage) {
      return [];
    }

    const parsedResult = parseExecuteCommandToolResult(toolMessage);
    if (!parsedResult?.interactiveAuth || parsedResult.exitCode !== null || parsedResult.timedOut) {
      return [];
    }

    const parsedArgs = parseExecuteCommandArgs(toolCall);
    const command = parsedArgs
      ? parsedArgs.command + (parsedArgs.args && parsedArgs.args.length > 0 ? ` ${parsedArgs.args.join(' ')}` : '')
      : undefined;

    return [{
      hint: parsedResult.interactiveAuth,
      command,
      chatSessionId,
    }];
  });
};

interface MessageDerived {
  hasText: boolean;
  extractedFilePaths: string[];
}
const messageDerivedCache = new WeakMap<Message, MessageDerived>();
function getMessageDerived(message: Message): MessageDerived {
  const cached = messageDerivedCache.get(message);
  if (cached) return cached;

  const hasText = hasTextContent(message);
  const textContent = message.content
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('\n');
  const extractedFilePaths = textContent ? extractFilePathsFromText(textContent) : [];

  const derived = { hasText, extractedFilePaths };
  messageDerivedCache.set(message, derived);
  return derived;
}

export function useRenderItems(
  allMessages: Message[],
  chatSessionId: string | null | undefined,
  messages: Message[],
  pendingInteractiveRequest: InteractiveRequest | null,
) {
  const allMessageIndexById = useMemo(() => {
    const indexMap = new Map<string, number>();
    allMessages.forEach((message, index) => {
      if (message.id) indexMap.set(message.id, index);
    });
    return indexMap;
  }, [allMessages]);

  return useMemo<ChatRenderItem[]>(() => {
    const items: ChatRenderItem[] = [];
    let pendingToolCalls: ToolCall[] = [];
    let pendingToolCallsSourceMessageIndex: number | null = null;
    let pendingPresentedFiles: PresentedFile[] = [];
    let toolCallsSectionCounter = 0;
    // Track the last assistant message index for attaching presentedFiles
    let lastAssistantItemIndex = -1;
    // Helper: flush pending tool calls before a user/system message, then attach presented files to the last assistant
    const flushPendingItems = () => {
      if (pendingToolCalls.length > 0) {
        // Extract present tool calls first
        const newPresentedFiles = extractPresentedFiles(pendingToolCalls);
        pendingPresentedFiles.push(...newPresentedFiles);

        items.push({
          type: 'tool-calls-section',
          toolCalls: [...pendingToolCalls],
          sectionKey: `tool-section-${toolCallsSectionCounter++}`,
          sourceMessageIndex: pendingToolCallsSourceMessageIndex ?? undefined,
          index: items.length
        });

        const interactiveAuthCards = extractInteractiveAuthCards(pendingToolCalls, allMessages, chatSessionId);
        interactiveAuthCards.forEach((interactiveAuth, authIndex) => {
          items.push({
            type: 'interactive-auth',
            interactiveAuth,
            sectionKey: `interactive-auth-${toolCallsSectionCounter - 1}-${authIndex}`,
            sourceMessageIndex: pendingToolCallsSourceMessageIndex ?? undefined,
            index: items.length,
          });
        });

        pendingToolCalls = [];
        pendingToolCallsSourceMessageIndex = null;
      }
      // Attach presented files to the last assistant message
      const lastAssistantItem = items[lastAssistantItemIndex];
      if (pendingPresentedFiles.length > 0 && lastAssistantItem?.type === 'assistant') {
        lastAssistantItem.presentedFiles = [...pendingPresentedFiles];
        pendingPresentedFiles = [];
      }
    };

    messages.forEach((message, index) => {
      const sourceMessageIndex = allMessageIndexById.get(message.id) ?? index;

      // Skip tool messages (they will be looked up as tool results by ToolCallsSection)
      if (message.role === 'tool') return;

      if (message.role === 'system') {
        // Flush pending tool calls and presented files before a system message
        flushPendingItems();
        items.push({ type: 'system', message, index: sourceMessageIndex });
      } else if (message.role === 'user') {
        // Skip synthetic messages (e.g. sub-agent task-notification triggers)
        if ((message as any).metadata?.synthetic) return;
        // Fallback: also skip messages whose only text is the trigger tag (legacy sessions without metadata)
        const textParts = message.content.filter(p => p.type === 'text').map(p => (p.text || '').trim()).join('');
        if (textParts === '<task-notification-trigger/>') return;
        // Flush pending tool calls and presented files before a user message
        flushPendingItems();
        items.push({ type: 'user', message, index: sourceMessageIndex });
      } else if (message.role === 'assistant') {
        const derived = getMessageDerived(message);
        const msgHasTools = message.tool_calls && message.tool_calls.length > 0;

        // Check whether this is a say-hi message
        if (message.id.startsWith('say-hi-')) {
          // Flush pending tool calls and presented files before a say-hi message
          flushPendingItems();
          items.push({ type: 'say-hi', message, index: sourceMessageIndex });
        } else if (derived.hasText) {
          // Assistant message that has text content — flush accumulated tool calls first
          if (pendingToolCalls.length > 0) {
            const newPresentedFiles = extractPresentedFiles(pendingToolCalls);
            pendingPresentedFiles.push(...newPresentedFiles);

            items.push({
              type: 'tool-calls-section',
              toolCalls: [...pendingToolCalls],
              sectionKey: `tool-section-${toolCallsSectionCounter++}`,
              sourceMessageIndex: pendingToolCallsSourceMessageIndex ?? undefined,
              index: items.length
            });

            const interactiveAuthCards = extractInteractiveAuthCards(pendingToolCalls, allMessages, chatSessionId);
            interactiveAuthCards.forEach((interactiveAuth, authIndex) => {
              items.push({
                type: 'interactive-auth',
                interactiveAuth,
                sectionKey: `interactive-auth-${toolCallsSectionCounter - 1}-${authIndex}`,
                sourceMessageIndex: pendingToolCallsSourceMessageIndex ?? undefined,
                index: items.length,
              });
            });

            pendingToolCalls = [];
            pendingToolCallsSourceMessageIndex = null;
          }

          items.push({ type: 'assistant', message, index: sourceMessageIndex, extractedFilePaths: derived.extractedFilePaths });
          lastAssistantItemIndex = items.length - 1;

          if (msgHasTools) {
            pendingToolCalls.push(...message.tool_calls!);
            pendingToolCallsSourceMessageIndex = sourceMessageIndex;
          }
        } else if (msgHasTools) {
          pendingToolCalls.push(...message.tool_calls!);
          pendingToolCallsSourceMessageIndex = sourceMessageIndex;
        }
      }
    });

    // Flush any remaining tool calls and presented files at the end
    flushPendingItems();

    if (pendingInteractiveRequest) {
      items.push({
        type: 'interactive-request',
        interactiveRequest: pendingInteractiveRequest,
        sectionKey: `interactive-request-${pendingInteractiveRequest.interactionId}`,
        index: items.length,
      });
    }

    return items;
  }, [allMessageIndexById, allMessages, chatSessionId, messages, pendingInteractiveRequest]);
}

async function submitInteractiveRequest(response: InteractiveResponse) {
  try {
    await window.electronAPI.agentChat.sendInteractionResponse(response);
  } catch (error) {
    logger.error('[ChatRenderItem] Failed to submit interactive request response:', error);
  }
}

export interface ChatRenderItemProps {
  item: ChatRenderItem;
  isLast?: boolean;
  renderLoadingIndicator: (className?: string) => React.ReactNode;
  chatId?: string;
  chatStatus?: ChatStatus;
  editingMessage?: EditingMessageState | null;
  onSaveEditedMessage: (updatedMessage: UserMessage) => void;
  onCancelEdit: () => void;
  onStartEdit: (msg: UserMessage) => void;
  canEditUserMessage?: boolean;
  streamingMessageId?: string;
  fileExistsCache: Record<string, boolean>;
  handleContentChange?: (newContent: string, heightChanged: boolean) => void;
}

export function ChatRenderItemComponent(props: ChatRenderItemProps) {
  const {
    item,
    isLast,
    renderLoadingIndicator,
    chatId,
    chatStatus,
    editingMessage,
    onSaveEditedMessage,
    onCancelEdit,
    onStartEdit,
    canEditUserMessage,
    streamingMessageId,
    fileExistsCache,
    handleContentChange,
  } = props;
  const editingSourceMessageIndex = editingMessage?.index ?? -1;

  if (item.type === 'activity-loading') {
    return (
      <div className="chat-activity-slot">
        {renderLoadingIndicator()}
      </div>
    );
  }

  if (item.type === 'activity-placeholder') {
    return (
      <div className="chat-activity-slot chat-activity-slot-placeholder" aria-hidden="true">
        {renderLoadingIndicator('chat-activity-slot-placeholder-content')}
      </div>
    );
  }

  if (item.type === 'interactive-request') {
    return (
      <div>
        <InteractiveRequestCard request={item.interactiveRequest} onSubmit={submitInteractiveRequest} />
      </div>
    );
  }

  if (item.type === 'interactive-auth') {
    const shouldDim = editingSourceMessageIndex >= 0 && (item.sourceMessageIndex ?? -1) > editingSourceMessageIndex;
    const { hint, command, chatSessionId: interactiveAuthChatSessionId } = item.interactiveAuth;
    return (
      <div
        className={isLast ? 'chat-latest-live-item' : undefined}
        style={shouldDim ? { opacity: 0.42, transition: 'opacity 120ms ease' } : undefined}
      >
        <InteractiveAuthCard hint={hint} command={command} chatSessionId={interactiveAuthChatSessionId} />
      </div>
    );
  }

  if (item.type === 'tool-calls-section' && item.toolCalls.length > 0) {
    const shouldDim = editingSourceMessageIndex >= 0 && (item.sourceMessageIndex ?? -1) > editingSourceMessageIndex;
    return (
      <div
        className={isLast ? 'chat-latest-live-item' : undefined}
        style={shouldDim ? { opacity: 0.42, transition: 'opacity 120ms ease' } : undefined}
      >
        <ToolCallsSection
          toolCalls={item.toolCalls}
          chatStatus={chatStatus}
          sourceMessageIndex={item.sourceMessageIndex}
          messageId={item.sectionKey}
        />
      </div>
    );
  }

  if (item.type === 'system') {
    const shouldDim = editingSourceMessageIndex >= 0 && item.index > editingSourceMessageIndex;
    return (
      <div style={shouldDim ? { opacity: 0.42, transition: 'opacity 120ms ease' } : undefined}>
        <MessageComponent
          chatId={chatId}
          message={item.message}
        />
      </div>
    );
  }

  if (item.type === 'say-hi') {
    const shouldDim = editingSourceMessageIndex >= 0 && item.index > editingSourceMessageIndex;
    return (
      <div style={shouldDim ? { opacity: 0.42, transition: 'opacity 120ms ease' } : undefined}>
        <MessageComponent
          chatId={chatId}
          message={item.message}
        />
      </div>
    );
  }

  if (item.type === 'user') {
    const shouldRenderEditor = editingMessage?.id === item.message.id;
    if (shouldRenderEditor) {
      return (
        <div
          className="inline-edit-message-shell"
        >
          <ChatInput
            onSendMessage={() => undefined}
            mode="edit-inline"
            initialMessage={item.message}
            onSubmitEditedMessage={onSaveEditedMessage}
            onCancelEdit={onCancelEdit}
            warningMessage={editingMessage?.warningMessage}
            chatSessionId={null}
            isReadOnly={false}
          />
        </div>
      );
    }

    const shouldDim = editingSourceMessageIndex >= 0 && item.index > editingSourceMessageIndex;
    return (
      <div style={shouldDim ? { opacity: 0.42, transition: 'opacity 120ms ease' } : undefined}>
        <MessageComponent
          chatId={chatId}
          message={item.message}
          canEditUserMessage={!editingMessage && canEditUserMessage}
          onEditUserMessage={!editingMessage && canEditUserMessage ? onStartEdit : undefined}
        />
      </div>
    );
  }

  if (item.type === 'assistant') {
    const isStreaming = streamingMessageId === item.message.id;
    const shouldDim = editingSourceMessageIndex >= 0 && item.index > editingSourceMessageIndex;

    const hasPresentedFiles = item.presentedFiles && item.presentedFiles.length > 0;
    const extractedFilePaths = item.extractedFilePaths || [];
    const cachedFilePaths: CachedFilePath[] = (!hasPresentedFiles && extractedFilePaths.length > 0)
      ? extractedFilePaths.map((p: string) => ({
        path: p,
        exists: fileExistsCache[p] ?? true
      }))
      : [];

    return (
      <div style={shouldDim ? { opacity: 0.42, transition: 'opacity 120ms ease' } : undefined}>
        <MessageComponent
          chatId={chatId}
          message={item.message}
          isStreaming={isStreaming}
          onContentChange={isStreaming ? handleContentChange : undefined}
          presentedFiles={item.presentedFiles}
          cachedFilePaths={cachedFilePaths}
        />
      </div>
    );
  }

  return null;
}

