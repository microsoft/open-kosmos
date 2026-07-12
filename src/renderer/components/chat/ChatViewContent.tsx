import React, { memo, useEffect, useMemo } from 'react';
import ChatContainer from './ChatContainer';
import ChatInput from './ChatInput';
import ChatZeroStates from './ChatZeroStates';
import { Message } from '@shared/types/chatTypes';
import { ZeroStates } from '../../lib/userData/types';
import { useCurrentChatSessionId, useMessagesWithStream, ChatStatus } from '../../lib/chat/agentChatSessionCacheManager';
import {
  isFrontendOnlySayHiMessage,
} from '../../lib/chat/sessionMessageVisibility';
import '../../styles/ContentView.css';
import '../../styles/Sidepane.css';
import { createLogger } from '../../lib/utilities/logger';
import { sendUserMessage, sendUserPrompt } from '@renderer/lib/chat/sendUserMessageOptimistically';
import { editMessageAtom } from './edit-message.atom';
import ChatSide from './ChatSide';
import { WorkspaceExplorerAtom } from './chat-side.atom';
import { queuedMessageAtom } from './queued-message.atom';
import { useI18n } from '../../lib/i18n/useI18n';

const logger = createLogger('[ChatViewContent]');

interface ChatViewContentProps {
  // ChatContainer props
  isSessionSwitching?: boolean;

  // Chat status support
  chatId?: string;
  chatStatus?: ChatStatus;

  // Zero States props
  zeroStates?: ZeroStates;
  agentName?: string;

  onSelectScheduledSession?: (sessionId: string) => void | Promise<void>;
}

const ChatViewContent: React.FC<ChatViewContentProps> = memo(({
  isSessionSwitching = false,
  chatId,
  chatStatus,
  zeroStates,
  onSelectScheduledSession
}) => {
  const { t } = useI18n();
  const { messages, streamingMessageId } = useMessagesWithStream();
  const [editingMessageState, editMessageActions] = editMessageAtom.use();
  const [queuedMessages] = queuedMessageAtom.use();
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
  const showZeroStates = !isSessionSwitching && isEmpty && hasValidZeroStates;

  const currentChatSessionId = useCurrentChatSessionId();
  const queuedMessageItems = currentChatSessionId ? queuedMessages[currentChatSessionId]?.items ?? [] : [];
  const workspaceExplorerActions = WorkspaceExplorerAtom.useChange();
  // On chat-session switch: tree-origin previews fall back to the file tree,
  // chat-origin previews close the workspace sidepane (legacy behavior). Also
  // exits inline message editing.
  useEffect(() => {
    workspaceExplorerActions.onSessionSwitch();
    editMessageActions.cancel();
  }, [currentChatSessionId]);

  return (
    <div className="chat-content-wrapper">
      <div className={`chat-content ${isEmpty ? 'empty-chat' : ''} ${showZeroStates ? 'with-zero-states' : ''}`}>
        {isSessionSwitching ? (
          <div className="chat-session-transition-state" role="status" aria-live="polite">
            <div className="chat-session-transition-copy">
              {t('chat.history.opening')}
            </div>
          </div>
        ) : (
          <ChatContainer
            key={currentChatSessionId || undefined}
            messages={renderedMessages}
            allMessages={messages}
            streamingMessageId={streamingMessageId ?? undefined}
            chatId={chatId}
            chatSessionId={currentChatSessionId || undefined}
            chatStatus={chatStatus}
            editingMessage={editingMessageState}
            canEditUserMessage={!(isSessionSwitching || (chatStatus && chatStatus !== 'idle'))}
          />
        )}
        {/* Zero States - shown above ChatInput when the chat is empty */}
        {showZeroStates && (
          <ChatZeroStates
            zeroStates={zeroStates!}
            onQuickStartClick={sendUserPrompt}
          />
        )}
        <ChatInput
          onSendMessage={sendUserMessage}
          enableContextMenu
          chatSessionId={currentChatSessionId}
          queuedMessages={queuedMessageItems}
          isInputLocked={!!editingMessageState || isSessionSwitching}
        />
      </div>
      <ChatSide onSelectScheduledSession={onSelectScheduledSession}/>
    </div>
  );
});

ChatViewContent.displayName = 'ChatViewContent';

export default ChatViewContent;
