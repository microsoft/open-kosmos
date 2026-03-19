import React, { memo, useCallback, useState, useEffect, useRef } from 'react';
import ChatContainer from './ChatContainer';
import ChatInput from './ChatInput';
import ChatZeroStates from './ChatZeroStates';
import WorkspaceExplorerSidepane from './workspace/WorkspaceExplorerSidepane';
import { Message, MessageHelper } from '../../types/chatTypes';
import { ContextOption } from '../../lib/chat/contextMentions';
import { WorkspaceMenuActions } from './workspace/WorkspaceExplorerSidepane';
import { ZeroStates } from '../../lib/userData/types';
import { useIsReplaying, useCurrentChatSessionId, agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import '../../styles/ContentView.css';
import '../../styles/Sidepane.css';

interface ChatViewContentProps {
  // ChatContainer props
  messages: Message[];
  allMessages: Message[];
  streamingMessageId?: string;
  onSystemPromptClick: () => void;
  workspacePath?: string; // Workspace path for resolving relative file paths
  
  // ChatInput props
  onSendMessage: (message: Message) => void;
  onCancelChat?: () => void; // Callback to cancel the current chat (optional)
  onOpenMcpTools: () => void;
  onContextMenuTrigger: (query: string, inputRect: DOMRect) => void;
  onContextMenuClose: () => void;
  contextMenuState: {
    isOpen: boolean;
    options: ContextOption[];
    selectedIndex: number;
  };
  onContextMenuNavigate: (direction: 'up' | 'down') => void;
  batchApprovalRequests: Array<{
    requestId: string;
    toolCallId: string;
    toolName: string;
    paths: Array<{
      path: string;
      normalizedPath?: string;
    }>;
    message: string;
  }>;
  onApproveRequest: (requestId: string) => void;
  onRejectRequest: (requestId: string) => void;
  onTimeoutAutoReject: (requestIds: string[]) => void;
  
  // ErrorBar-related props
  errorMessage?: string | null;
  chatSessionId?: string | null;
  onRetry?: (chatSessionId: string) => void;
  
  // Chat status support
  chatStatus?: {
    chatId: string;
    chatStatus: 'idle' | 'sending_response' | 'compressing_context' | 'compressed_context' | 'received_response';
    agentName?: string;
  } | null;
  
  // Zero States props
  zeroStates?: ZeroStates;
  agentName?: string; // Agent name, used for avatar image caching
  
  // Sidepanes props
  isWorkspaceExplorerVisible: boolean;
  onWorkspaceExplorerClose: () => void;
  onWorkspaceMenuToggle?: (buttonElement: HTMLElement, menuActions: WorkspaceMenuActions) => void;
  workspaceMenuState?: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
    actions: WorkspaceMenuActions | null;
  };
  onEditAgentMenuToggle?: (buttonElement: HTMLElement) => void;
  onAttachMenuToggle?: (buttonElement: HTMLElement) => void;
  onFileTreeNodeMenuToggle?: (event: React.MouseEvent, node: any, workspacePath: string) => void;
}

const ChatViewContent: React.FC<ChatViewContentProps> = memo(({
  messages,
  allMessages,
  streamingMessageId,
  onSystemPromptClick,
  workspacePath,
  onSendMessage,
  onCancelChat,
  onOpenMcpTools,
  onContextMenuTrigger,
  onContextMenuClose,
  contextMenuState,
  onContextMenuNavigate,
  batchApprovalRequests,
  onApproveRequest,
  onRejectRequest,
  onTimeoutAutoReject,
  // ErrorBar-related props
  errorMessage,
  chatSessionId,
  onRetry,
  chatStatus,
  zeroStates,
  agentName,
  isWorkspaceExplorerVisible,
  onWorkspaceExplorerClose,
  onWorkspaceMenuToggle,
  workspaceMenuState,
  onEditAgentMenuToggle,
  onAttachMenuToggle,
  onFileTreeNodeMenuToggle
}) => {
  /**
   * ========== isEmpty Decision Logic ==========
   *
   * Purpose: determines the layout mode of the chat area.
   *
   * Scenario vs. UI behaviour table:
   * ┌─────────────────────────────────────────┬──────────┬─────────────────────────────────────┐
   * │ Scenario                                │ isEmpty  │ UI behaviour                        │
   * ├─────────────────────────────────────────┼──────────┼─────────────────────────────────────┤
   * │ 1. No messages, no Zero States          │ true     │ Input centred                        │
   * │ 2. No messages, with Zero States        │ true     │ Input at bottom + Zero States above  │
   * │ 3. Only assistantSayHiMessage           │ false    │ Normal layout, renders Say Hi msg    │
   * │ 4. Has chatTurns (user conversation)    │ false    │ Normal layout, renders all messages  │
   * └─────────────────────────────────────────┴──────────┴─────────────────────────────────────┘
   *
   * Notes:
   * - visibleMessages excludes system and tool messages (they should not affect the empty-state check)
   * - assistantSayHiMessage is a frontend-only greeting message; although its role is 'assistant',
   *   it is identified by the 'say-hi-' id prefix and does not count as content for empty-state purposes
   */
  
  // Compute visible messages (excluding system and tool messages)
  const visibleMessages = messages.filter(
    msg => msg.role !== 'system' && msg.role !== 'tool'
  );
  // Check whether a Say Hi message exists (frontend-only greeting message)
  const hasSayHiMessage = messages.some(
    msg => msg.role === 'assistant' && msg.id?.startsWith('say-hi-')
  );
  // Empty-state check: no visible messages AND no Say Hi message
  const isEmpty = visibleMessages.length === 0 && !hasSayHiMessage;
  
  // Determine whether to show Zero States (quick-start prompts when the chat is empty)
  const hasValidZeroStates = zeroStates && (
    (zeroStates.greeting && zeroStates.greeting.trim().length > 0) ||
    (zeroStates.quick_starts && zeroStates.quick_starts.length > 0)
  );
  const showZeroStates = isEmpty && hasValidZeroStates;
  
  // Handle quick-start click - send the prompt as a user message
  const handleQuickStartClick = useCallback((prompt: string) => {
    const userMessage = MessageHelper.createTextMessage(prompt, 'user');
    onSendMessage(userMessage);
  }, [onSendMessage]);

  // ========== Replay Logic ==========
  const isReplaying = useIsReplaying();
  const currentChatSessionId = useCurrentChatSessionId();
  const [replayMessages, setReplayMessages] = useState<Message[] | null>(null);
  const [replayStreamingId, setReplayStreamingId] = useState<string | null>(null);
  // Collect all pending timer ids for unified cancellation on interrupt
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAllTimers = useCallback(() => {
    timerRefs.current.forEach(id => clearTimeout(id));
    timerRefs.current = [];
  }, []);

  const stopReplay = useCallback(() => {
    clearAllTimers();
    setReplayMessages(null);
    setReplayStreamingId(null);
    if (currentChatSessionId) {
      agentChatSessionCacheManager.setReplayingStatus(currentChatSessionId, false);
    }
  }, [clearAllTimers, currentChatSessionId]);

  // Watch isReplaying: true -> start animation; false -> stop animation
  useEffect(() => {
    console.log('[Replay] isReplaying changed:', {
      isReplaying,
      currentChatSessionId,
      messagesFromProps: messages.length,
    });

    if (!isReplaying) {
      // External interrupt (e.g., Stop clicked or session switch)
      clearAllTimers();
      setReplayMessages(null);
      setReplayStreamingId(null);
      return;
    }

    // Filter out system/tool messages before replaying
    const replayableMessages = messages.filter(
      msg => msg.role !== 'system' && msg.role !== 'tool'
    );

    console.log('[Replay] Starting replay:', {
      replayableMessages: replayableMessages.length,
      roles: replayableMessages.map(m => m.role),
    });

    if (replayableMessages.length === 0) {
      console.warn('[Replay] No replayable messages, aborting');
      if (currentChatSessionId) {
        agentChatSessionCacheManager.setReplayingStatus(currentChatSessionId, false);
      }
      return;
    }

    let cancelled = false;
    setReplayMessages([]);

    const delay = (ms: number): Promise<void> =>
      new Promise(resolve => {
        const id = setTimeout(() => {
          if (!cancelled) resolve();
        }, ms);
        timerRefs.current.push(id);
      });

    const runReplay = async () => {
      for (let i = 0; i < replayableMessages.length; i++) {
        if (cancelled) return;
        const msg = replayableMessages[i];
        console.log(`[Replay] Processing message ${i + 1}/${replayableMessages.length}:`, { role: msg.role, id: msg.id });

        if (msg.role === 'user') {
          // User message: show immediately
          setReplayMessages(prev => [...(prev ?? []), { ...msg }]);
          console.log('[Replay] User message shown, waiting 1000ms for think delay...');
          // Simulate thinking delay
          await delay(1000);

        } else if (msg.role === 'assistant') {
          // Extract text content from message
          const fullText =
            typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content
                    .filter((p: any) => p.type === 'text')
                    .map((p: any) => p.text)
                    .join('')
                : '';

          console.log('[Replay] Assistant message streaming:', { id: msg.id, textLength: fullText.length });

          const CHUNK_SIZE = 150;
          const CHUNK_INTERVAL = 200;

          // Insert empty placeholder first, then start streaming
          const placeholderMsg: Message = { ...msg, content: [] };
          setReplayMessages(prev => [...(prev ?? []), placeholderMsg]);
          setReplayStreamingId(msg.id || null);

          // Stream out chunks one by one
          for (let pos = 0; pos < fullText.length; pos += CHUNK_SIZE) {
            if (cancelled) return;
            const chunk = fullText.slice(0, pos + CHUNK_SIZE);
            const chunkMsg: Message = {
              ...msg,
              content: [{ type: 'text', text: chunk } as any]
            };
            setReplayMessages(prev => {
              if (!prev) return prev;
              return [...prev.slice(0, -1), chunkMsg];
            });
            await delay(CHUNK_INTERVAL);
          }

          // All chunks done, ensure final content is complete
          const finalMsg: Message = {
            ...msg,
            content: typeof msg.content === 'string'
              ? msg.content
              : [{ type: 'text', text: fullText } as any]
          };
          setReplayMessages(prev => {
            if (!prev) return prev;
            return [...prev.slice(0, -1), finalMsg];
          });
          setReplayStreamingId(null);

          // Wait before moving to next turn
          await delay(1500);
        }
      }

      // All messages replayed
      if (!cancelled) {
        console.log('[Replay] All messages replayed, stopping replay');
        setReplayMessages(null);
        setReplayStreamingId(null);
        if (currentChatSessionId) {
          agentChatSessionCacheManager.setReplayingStatus(currentChatSessionId, false);
        }
      }
    };

    runReplay();

    return () => {
      console.log('[Replay] useEffect cleanup: cancelling replay');
      cancelled = true;
      clearAllTimers();
    };
  // Only re-run when isReplaying flips to true; exclude messages from deps to prevent re-entry
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplaying]);

  // Interrupt replay on session switch
  useEffect(() => {
    return () => {
      clearAllTimers();
      setReplayMessages(null);
      setReplayStreamingId(null);
    };
  }, [currentChatSessionId, clearAllTimers]);

  return (
    <div className="chat-content-wrapper">
      <div className={`chat-content ${isEmpty ? 'empty-chat' : ''} ${showZeroStates ? 'with-zero-states' : ''}`}>
        <ChatContainer
          messages={replayMessages ?? messages}
          allMessages={allMessages}
          streamingMessageId={replayStreamingId ?? streamingMessageId}
          onSystemPromptClick={onSystemPromptClick}
          workspacePath={workspacePath}
          chatStatus={chatStatus}
          overrideMessages={replayMessages ?? undefined}
        />
        {/* Zero States - shown above ChatInput when the chat is empty */}
        {showZeroStates && (
          <ChatZeroStates
            zeroStates={zeroStates!}
            agentName={agentName || 'default'}
            onQuickStartClick={handleQuickStartClick}
          />
        )}
        <ChatInput
          onSendMessage={onSendMessage}
          chatStatus={chatStatus}
          onCancelChat={onCancelChat}
          onOpenMcpTools={onOpenMcpTools}
          onContextMenuTrigger={onContextMenuTrigger}
          onContextMenuClose={onContextMenuClose}
          contextMenuState={contextMenuState}
          onContextMenuNavigate={onContextMenuNavigate}
          approvalRequests={batchApprovalRequests}
          onApproveRequest={onApproveRequest}
          onRejectRequest={onRejectRequest}
          onTimeoutAutoReject={onTimeoutAutoReject}
          onEditAgentMenuToggle={onEditAgentMenuToggle}
          onAttachMenuToggle={onAttachMenuToggle}
          errorMessage={errorMessage}
          chatSessionId={chatSessionId}
          onRetry={onRetry}
          isReplaying={isReplaying}
        />
      </div>
      {/* Workspace Explorer Sidepane */}
      <WorkspaceExplorerSidepane
        isVisible={isWorkspaceExplorerVisible}
        onClose={onWorkspaceExplorerClose}
        onMenuToggle={onWorkspaceMenuToggle}
        menuState={workspaceMenuState}
        onFileTreeNodeMenuToggle={onFileTreeNodeMenuToggle}
      />
    </div>
  );
});

ChatViewContent.displayName = 'ChatViewContent';

export default ChatViewContent;
