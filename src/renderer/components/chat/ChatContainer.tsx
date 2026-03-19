import React, { useRef, useEffect, useCallback, memo, useMemo, useState } from 'react';
import { Message, ToolCall } from '../../types/chatTypes';
import MessageComponent from './Message';
import { ToolCallsSection } from './ToolCallsSection';
import { PresentedFile } from './PresentedFilesCard';
import { CachedFilePath } from '../../lib/chat/agentChatSessionCacheManager';
import '../../styles/ChatContainer.css';
import { useMessages, extractFilePathsFromText } from '../../lib/chat/agentChatSessionCacheManager';

interface ChatContainerProps {
  messages: Message[];
  allMessages: Message[]; // All messages including tool messages for context
  streamingMessageId?: string; // ID of the message currently being streamed
  onSystemPromptClick?: () => void; // Callback when system prompt message is clicked
  onApprovalResponse?: (approved: boolean) => void; // Callback for approval requests
  workspacePath?: string; // Workspace path for resolving relative file paths
  chatStatus?: {
    chatId: string;
    chatStatus: 'idle' | 'sending_response' | 'compressing_context' | 'compressed_context' | 'received_response';
    agentName?: string;
  } | null; // Chat status support
  // Override messages for replay - takes priority over useMessages() hook
  overrideMessages?: Message[];
}

// Helper: check if an assistant message has only tool_calls with no text content
const isToolCallOnlyMessage = (message: Message): boolean => {
  if (message.role !== 'assistant') return false;
  if (!message.tool_calls || message.tool_calls.length === 0) return false;

  // Check whether there is any text content
  const hasTextContent = message.content.some(part => {
    if (part.type === 'text') {
      const text = (part as any).text || '';
      return text.trim().length > 0;
    }
    return false;
  });

  return !hasTextContent;
};

// Helper: check if an assistant message has text content (may also have tool_calls)
const hasTextContent = (message: Message): boolean => {
  return message.content.some(part => {
    if (part.type === 'text') {
      const text = (part as any).text || '';
      return text.trim().length > 0;
    }
    return false;
  });
};

const ChatContainerInner: React.FC<ChatContainerProps> = ({
  messages: propMessages,
  allMessages,
  streamingMessageId,
  onSystemPromptClick,
  onApprovalResponse,
  workspacePath,
  chatStatus,
  overrideMessages
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [forceUpdate, setForceUpdate] = React.useState(0);

  // Use the useMessages hook to get the flat message array
  const hookMessages = useMessages();
  // Use overrideMessages during replay, otherwise fall back to hook data
  const messages = overrideMessages ?? hookMessages;

  // File path existence cache: key = filePath, value = exists
  const [fileExistsCache, setFileExistsCache] = useState<Record<string, boolean>>({});

  // Check whether a loading indicator should be shown
  const shouldShowLoading = useCallback(() => {
    if (chatStatus?.chatStatus === 'sending_response') {
      return true;
    }
    if (chatStatus?.chatStatus === 'compressing_context') {
      return true;
    }
    if (chatStatus?.chatStatus === 'compressed_context') {
      return true;
    }
    return false;
  }, [chatStatus?.chatStatus]);

  // Build render items directly from messages, with tool-call merging support
  const renderItems = useMemo(() => {
    // tool-calls-section type for rendering merged tool calls
    type LocalRenderItem = {
      type: 'system' | 'say-hi' | 'user' | 'assistant' | 'tool-calls-section';
      message?: Message;
      index: number;
      // Fields specific to tool-calls-section
      toolCalls?: ToolCall[];
      sectionKey?: string;
      // Presented files attached to the last assistant message
      presentedFiles?: PresentedFile[];
      // File paths extracted from assistant text (fallback when no presentedFiles)
      extractedFilePaths?: string[];
    };

    const items: LocalRenderItem[] = [];
    let pendingToolCalls: ToolCall[] = [];
    let pendingPresentedFiles: PresentedFile[] = [];
    let toolCallsSectionCounter = 0;

    // Track the last assistant message index for attaching presentedFiles
    let lastAssistantItemIndex = -1;

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
          index: items.length
        });
        pendingToolCalls = [];
      }
      // Attach presented files to the last assistant message
      if (pendingPresentedFiles.length > 0 && lastAssistantItemIndex >= 0) {
        items[lastAssistantItemIndex].presentedFiles = [...pendingPresentedFiles];
        pendingPresentedFiles = [];
      }
    };

    messages.forEach((message, index) => {
      // Skip tool messages (they will be looked up as tool results by ToolCallsSection)
      if (message.role === 'tool') {
        return;
      }

      if (message.role === 'system') {
        // Flush pending tool calls and presented files before a system message
        flushPendingItems();
        items.push({ type: 'system', message, index });
      } else if (message.role === 'user') {
        // Flush pending tool calls and presented files before a user message
        flushPendingItems();
        items.push({ type: 'user', message, index });
      } else if (message.role === 'assistant') {
        const msgHasText = hasTextContent(message);
        const msgHasTools = message.tool_calls && message.tool_calls.length > 0;

        // Check whether this is a say-hi message
        if (message.id?.startsWith('say-hi-')) {
          // Flush pending tool calls and presented files before a say-hi message
          flushPendingItems();
          items.push({ type: 'say-hi', message, index });
        } else if (msgHasText) {
          // Assistant message that has text content
          // First flush any previously accumulated tool calls
          if (pendingToolCalls.length > 0) {
            // Extract present tool calls first
            const newPresentedFiles = extractPresentedFiles(pendingToolCalls);
            pendingPresentedFiles.push(...newPresentedFiles);

            items.push({
              type: 'tool-calls-section',
              toolCalls: [...pendingToolCalls],
              sectionKey: `tool-section-${toolCallsSectionCounter++}`,
              index: items.length
            });
            pendingToolCalls = [];
          }
          // Render the message; also extract file paths from assistant text as fallback
          const textContent = message.content
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text || '')
            .join('\n');
          const extractedPaths = textContent ? extractFilePathsFromText(textContent) : [];
          items.push({ type: 'assistant', message, index, extractedFilePaths: extractedPaths });
          // Track last assistant message index for presentedFiles
          lastAssistantItemIndex = items.length - 1;

          // Collect tool calls from this message
          if (msgHasTools) {
            pendingToolCalls.push(...message.tool_calls!);
          }
        } else if (msgHasTools) {
          // Message has only tool_calls with no text — collect tool calls, do not render
          pendingToolCalls.push(...message.tool_calls!);
        }
        // If there is neither text nor tool_calls, skip the message
      }
    });

    // Flush any remaining tool calls and presented files at the end
    flushPendingItems();

    console.log('🎯 [ChatContainer] Built render items from messages:', {
      total: items.length,
      messageCount: messages.length,
      toolCallsSections: items.filter(i => i.type === 'tool-calls-section').length,
      assistantWithPresentedFiles: items.filter(i => i.type === 'assistant' && i.presentedFiles && i.presentedFiles.length > 0).length,
      note: 'With tool calls merging and presented files attached to assistant'
    });

    return items;
  }, [messages]);

  // Asynchronously check whether extracted file paths from assistant messages exist on disk
  useEffect(() => {
    const allExtractedPaths = new Set<string>();
    renderItems.forEach(item => {
      if (item.type === 'assistant' && item.extractedFilePaths) {
        item.extractedFilePaths.forEach(p => allExtractedPaths.add(p));
      }
    });

    // Find paths that have not yet been checked
    const uncheckedPaths = [...allExtractedPaths].filter(p => !(p in fileExistsCache));
    if (uncheckedPaths.length === 0) return;

    let cancelled = false;
    (async () => {
      const results: Record<string, boolean> = {};
      await Promise.all(
        uncheckedPaths.map(async (filePath) => {
          try {
            if (window.electronAPI?.fs?.exists) {
              results[filePath] = await window.electronAPI.fs.exists(filePath);
            } else {
              results[filePath] = false;
            }
          } catch {
            results[filePath] = false;
          }
        })
      );
      if (!cancelled) {
        setFileExistsCache(prev => ({ ...prev, ...results }));
      }
    })();

    return () => { cancelled = true; };
  }, [renderItems]);

  // Optimization: only log when the component first renders or the message count changes
  const lastMessageCount = React.useRef(0);
  const lastChatStatus = React.useRef<string | undefined>(undefined);
  const shouldLogRender = messages.length !== lastMessageCount.current;
  const chatStatusChanged = chatStatus?.chatStatus !== lastChatStatus.current;

  if (shouldLogRender) {
    lastMessageCount.current = messages.length;
  }

  if (chatStatusChanged) {
    lastChatStatus.current = chatStatus?.chatStatus;
  }

  // Initial scroll to top when component mounts (since we're using column-reverse)
  useEffect(() => {
    if (containerRef.current && messages.length > 0) {
      containerRef.current.scrollTop = 0;
    }
  }, []);

  // Watch window visibility changes to ensure the loading indicator re-renders after the window regains focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && shouldShowLoading()) {
        setForceUpdate(prev => prev + 1);
      }
    };

    const handleFocus = () => {
      if (shouldShowLoading()) {
        setForceUpdate(prev => prev + 1);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [chatStatus]);

  // Scroll to top when new messages arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [messages.length]);

  // Create content change callback for streaming messages
  const handleContentChange = useCallback((newContent: string, heightChanged: boolean) => {
    // Since we're using column-reverse and messages expand upward,
    // we don't need to force scroll here
  }, []);

  // Check whether a top-level loading indicator should be shown
  const shouldShowTopLevelLoading = useCallback(() => {
    const hasMessages = renderItems.length > 0;
    const hasUserMessage = renderItems.some(item => item.type === 'user');

    // Show at top if there are no messages (or no user messages) while loading
    return shouldShowLoading() && (!hasMessages || !hasUserMessage);
  }, [renderItems, shouldShowLoading]);

  // Get the loading indicator label text
  const getLoadingMessageText = () => {
    if (!chatStatus?.chatStatus) return null;

    switch (chatStatus.chatStatus) {
      case 'sending_response':
        return null;
      case 'compressing_context':
        return 'Compressing';
      case 'compressed_context':
        return null;
      default:
        return null;
    }
  };

  // Determine whether the boundary container should be rendered
  const shouldShowBoundaryContainer = useCallback(() => {
    return shouldShowTopLevelLoading() || messages.length > 0;
  }, [shouldShowTopLevelLoading, messages.length]);

  // Check if loading indicator should be shown after last message
  // Fix: In agentic loop, show loading before each assistant message starts streaming
  const shouldShowLoadingAfterLastMessage = useCallback(() => {
    if (!shouldShowLoading()) return false;

    // Fix: Check if an assistant message is currently streaming by looking up the message role
    // Find the streaming message in allMessages by its ID
    if (streamingMessageId) {
      const streamingMessage = allMessages.find(msg => msg.id === streamingMessageId);
      if (streamingMessage && streamingMessage.role === 'assistant') {
        // An assistant message is streaming, no need for loading indicator
        return false;
      }
    }

    // No assistant message is streaming, show loading if chatStatus indicates waiting for response
    return true;
  }, [shouldShowLoading, streamingMessageId, allMessages]);

  return (
    <div className="chat-container-reverse" ref={containerRef}>
      {/* Fixed boundary container */}
      {shouldShowBoundaryContainer() && (
        <div className={`message-boundary-container ${shouldShowTopLevelLoading() ? 'has-loading' : ''}`}>
          {shouldShowTopLevelLoading() && (
            <div className="message assistant-message loading-message fixed-boundary">
              <div className="message-content">
                <div className="flex items-start">
                  <div className="flex-1">
                    {getLoadingMessageText() ? (
                      <div className="loading-text">
                        {getLoadingMessageText()}&nbsp;
                        <div className="typing-indicator inline">
                          <div className="dots">
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="typing-indicator">
                        <div className="dots">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading indicator shown after the last message */}
      {shouldShowLoadingAfterLastMessage() && (
        <div style={{
          padding: '16px 0px',
        }}>
          {getLoadingMessageText() ? (
            <div className="loading-text">
              {getLoadingMessageText()}&nbsp;
              <div className="typing-indicator inline">
                <div className="dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          ) : (
            <div className="typing-indicator">
              <div className="dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Iterate over render items; tool calls are merged into sections */}
      {(() => {
        // Reverse so the most recent message appears at the top (column-reverse layout)
        const reversedItems = [...renderItems].reverse();

        return reversedItems.map((item, index) => {
          const { type, message, toolCalls, sectionKey, presentedFiles } = item;

          // Render merged ToolCallsSection
          if (type === 'tool-calls-section' && toolCalls && toolCalls.length > 0) {
            return (
              <ToolCallsSection
                key={sectionKey || `tool-section-${index}`}
                toolCalls={toolCalls}
                allMessages={allMessages}
                messageId={sectionKey}
              />
            );
          }

          if (type === 'system' && message) {
            return (
              <MessageComponent
                key={`system_${message.id || index}`}
                message={message}
                allMessages={allMessages}
                isStreaming={false}
                onSystemPromptClick={onSystemPromptClick}
                workspacePath={workspacePath}
                chatStatus={chatStatus}
              />
            );
          }

          if (type === 'say-hi' && message) {
            return (
              <MessageComponent
                key={`say-hi_${message.id || index}`}
                message={message}
                allMessages={allMessages}
                isStreaming={false}
                workspacePath={workspacePath}
                chatStatus={chatStatus}
              />
            );
          }

          if (type === 'user' && message) {
            return (
              <MessageComponent
                key={`user_${chatStatus?.chatId || 'default'}_${message.id || index}`}
                message={message}
                allMessages={allMessages}
                isStreaming={false}
                onSystemPromptClick={onSystemPromptClick}
                workspacePath={workspacePath}
                chatStatus={chatStatus}
              />
            );
          }

          if (type === 'assistant' && message) {
            const isStreaming = streamingMessageId === message.id;

            // Fallback: when there are no presentedFiles, build cachedFilePaths from paths extracted from assistant text
            const hasPresentedFiles = presentedFiles && presentedFiles.length > 0;
            const extractedFilePaths = item.extractedFilePaths || [];
            const cachedFilePaths: CachedFilePath[] = (!hasPresentedFiles && extractedFilePaths.length > 0)
              ? extractedFilePaths.map(p => ({
                  path: p,
                  exists: fileExistsCache[p] ?? true // Default true until the async check completes
                }))
              : [];

            return (
              <MessageComponent
                key={`assistant_${chatStatus?.chatId || 'default'}_${message.id || index}`}
                message={message}
                isStreaming={isStreaming}
                onContentChange={isStreaming ? handleContentChange : undefined}
                presentedFiles={presentedFiles}
                cachedFilePaths={cachedFilePaths}
              />
            );
          }

          return null;
        });
      })()}
    </div>
  );
};

// Wrap with memo to avoid unnecessary re-renders
const ChatContainer: React.FC<ChatContainerProps> = memo(ChatContainerInner);

ChatContainer.displayName = 'ChatContainer';

export default ChatContainer;
