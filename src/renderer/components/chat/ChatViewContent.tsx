import React, { memo, useEffect, useMemo } from 'react';
import ChatContainer from './ChatContainer';
import ChatInput from './ChatInput';
import ChatZeroStates from './ChatZeroStates';
import { Message } from '@shared/types/chatTypes';
import { BRAND_NAME } from '@shared/constants/branding';
import { ZeroStates, isBuiltinAgent } from '../../lib/userData/types';
import { useCurrentChatSessionId, useMessagesWithStream, ChatStatus } from '../../lib/chat/agentChatSessionCacheManager';
import {
  isFrontendOnlySayHiMessage,
} from '../../lib/chat/sessionMessageVisibility';
import { PM_AGENT_CANONICAL_NAME } from '../../config/pmAgentSayHiConfig';
import '../../styles/ContentView.css';
import '../../styles/Sidepane.css';
import { createLogger } from '../../lib/utilities/logger';
import { sendUserMessage, sendUserPrompt } from '@renderer/lib/chat/sendUserMessageOptimistically';
import { editMessageAtom } from './edit-message.atom';
import ChatSide from './ChatSide';
import { InlinePreviewAtom } from './chat-side.atom';

const logger = createLogger('[ChatViewContent]');

interface ChatViewContentProps {
  // ChatContainer props
  isSessionSwitching?: boolean;

  // Chat status support
  chatId?: string;
  chatStatus?: ChatStatus;

  // Zero States props
  zeroStates?: ZeroStates;
  agentName?: string; // Agent name, used for avatar image caching

  onSelectScheduledSession?: (sessionId: string) => void | Promise<void>;
  // Read-only mode for remote sessions
  isReadOnly?: boolean;
}

const ChatViewContent: React.FC<ChatViewContentProps> = memo(({
  isSessionSwitching = false,
  chatId,
  chatStatus,
  zeroStates,
  agentName,
  onSelectScheduledSession,
  isReadOnly
}) => {
  const { messages, streamingMessageId } = useMessagesWithStream();
  const [editingMessageState, editMessageActions] = editMessageAtom.use();
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
   * │ 4. Has user/assistant/tool messages     │ false    │ Normal layout, hides Say Hi message  │
   * └─────────────────────────────────────────┴──────────┴─────────────────────────────────────┘
   *
   * Notes:
   * - assistantSayHiMessage is a frontend-only greeting message; although its role is 'assistant',
   *   it is identified by the 'say-hi-' id prefix
   * - real session content is any user/assistant/tool message except the frontend-only say-hi message
   */
  const [renderedMessages, hasSayHiMessage, hasRealSessionMessages] = useMemo(() => {
    let list: Message[] = [];
    let [hasSayHi, hasReal] = [false, false];
    for (const msg of messages) {
      if (isFrontendOnlySayHiMessage(msg)) {
        hasSayHi = true;
        continue;
      }
      if (msg.role !== 'system') hasReal = true;
      list.push(msg);
    }
    if (hasSayHi && !hasReal) list = messages;
    return [list, hasSayHi, hasReal] as const;
  }, [messages]);

  const shouldShowSayHiMessage = hasSayHiMessage && !hasRealSessionMessages;
  const isEmpty = !isSessionSwitching && !hasRealSessionMessages && !shouldShowSayHiMessage;

  // Determine whether to show Zero States (quick-start prompts when the chat is empty)
  const hasValidZeroStates = zeroStates && (
    (zeroStates.greeting && zeroStates.greeting.trim().length > 0) ||
    (zeroStates.quick_starts && zeroStates.quick_starts.length > 0)
  );
  const shouldDisableZeroStates =
    agentName === PM_AGENT_CANONICAL_NAME && isBuiltinAgent(agentName, BRAND_NAME);
  const showZeroStates = !isSessionSwitching && !shouldDisableZeroStates && isEmpty && hasValidZeroStates;

  const currentChatSessionId = useCurrentChatSessionId();
  const InlinePreviewActions = InlinePreviewAtom.useChange();
  // Close preview when switching chat sessions
  useEffect(() => {
    InlinePreviewActions.cancel();
    editMessageActions.cancel();
  }, [currentChatSessionId]);

  return (
    <div className="chat-content-wrapper">
      <div className={`chat-content ${isEmpty ? 'empty-chat' : ''} ${showZeroStates ? 'with-zero-states' : ''}`}>
        {isSessionSwitching ? (
          <div className="chat-session-transition-state" role="status" aria-live="polite">
            <div className="chat-session-transition-copy">
              Opening chat history...
            </div>
          </div>
        ) : (
          <ChatContainer
            messages={renderedMessages}
            allMessages={messages}
            streamingMessageId={streamingMessageId ?? undefined}
            chatId={chatId}
            chatSessionId={currentChatSessionId || undefined}
            chatStatus={chatStatus}
            editingMessage={editingMessageState}
            canEditUserMessage={!(isReadOnly || isSessionSwitching || (chatStatus && chatStatus !== 'idle'))}
          />
        )}
        {/* Zero States - shown above ChatInput when the chat is empty */}
        {showZeroStates && (
          <ChatZeroStates
            zeroStates={zeroStates!}
            agentName={agentName || 'default'}
            onQuickStartClick={sendUserPrompt}
          />
        )}
        <ChatInput
          onSendMessage={sendUserMessage}
          enableContextMenu
          chatSessionId={currentChatSessionId}
          isReadOnly={isReadOnly}
          isInputLocked={!!editingMessageState || isSessionSwitching}
        />
      </div>
      <ChatSide onSelectScheduledSession={onSelectScheduledSession}/>
    </div>
  );
});

ChatViewContent.displayName = 'ChatViewContent';

export default ChatViewContent;
