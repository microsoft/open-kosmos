import React, { useEffect, useMemo, useRef } from 'react';
import { useSubAgentTask } from '../../lib/subAgent/useSubAgentTask';
import type { Message } from '@shared/types/chatTypes';
import type { ChatStatus } from '../../lib/chat/agentChatSessionCacheManager';
import { useRenderItems, ChatRenderItemComponent, getChatRenderItemStableKey } from './ChatRenderItem';
import { ToolCallsMessagesContext } from './ToolCallsSection';
import '../../styles/Message.css';
import '../../styles/markdown-render.css';
import { useI18n } from '../../lib/i18n/useI18n';

interface SubAgentTaskDetailViewProps {
  taskId: string;
}

// The sub-agent detail view is read-only: it never edits messages, renders inline
// loading slots, or starts an edit. These satisfy ChatRenderItemComponent's
// required callback props but are intentionally inert and never invoked here.
/* v8 ignore start -- read-only view: these ChatRenderItem callbacks are never called */
const NOOP = (): void => {};
const RENDER_NO_LOADING = (): React.ReactNode => null;
/* v8 ignore stop */
const EMPTY_FILE_CACHE: Record<string, boolean> = {};

const SubAgentTaskDetailView: React.FC<SubAgentTaskDetailViewProps> = ({ taskId }) => {
  const { t } = useI18n();
  const { messages, status, loading, error } = useSubAgentTask(taskId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isStreaming = status === 'running';

  // Map the sub-agent task status to a ChatStatus so ToolCallsSection renders the
  // correct icon. A running task means tools may still be executing; a finished
  // task (completed/failed/cancelled) is idle, so any unfinished tool reads as
  // interrupted while finished tools read as completed. Without this the section
  // defaulted to undefined and always fell back to the interrupted (alert) icon.
  const toolChatStatus: ChatStatus = isStreaming ? 'sending_response' : 'idle';

  // Determine which message is "streaming" (the last assistant message if task is running)
  const streamingMessageId = useMemo(() => {
    if (!isStreaming || messages.length === 0) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return undefined;
  }, [isStreaming, messages]);

  // Build render items using the same pipeline as ChatContainer
  const renderItems = useRenderItems(messages, null, messages, null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, renderItems.length]);

  if (loading) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, var(--color-warm-400))', textAlign: 'center' }}>
        {t('sidepane.subAgents.loadingTask')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--color-danger-500)', textAlign: 'center' }}>
        {error}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="sidepane-body"
      style={{
        overflowY: 'auto',
        padding: '8px 12px',
        flex: 1,
      }}
    >
      {messages.length === 0 && (
        <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, var(--color-warm-400))', textAlign: 'center' }}>
          {t('sidepane.subAgents.noMessagesYet')}
        </div>
      )}
      <ToolCallsMessagesContext.Provider value={messages}>
        {renderItems.map((item, index) => (
          <ChatRenderItemComponent
            key={getChatRenderItemStableKey(item)}
            item={item}
            isLast={index === renderItems.length - 1}
            renderLoadingIndicator={RENDER_NO_LOADING}
            chatStatus={toolChatStatus}
            editingMessage={null}
            onSaveEditedMessage={NOOP}
            onCancelEdit={NOOP}
            onStartEdit={NOOP}
            canEditUserMessage={false}
            streamingMessageId={streamingMessageId}
            fileExistsCache={EMPTY_FILE_CACHE}
          />
        ))}
      </ToolCallsMessagesContext.Provider>
      {isStreaming && messages.length > 0 && (
        <div className="typing-indicator" style={{ padding: '8px 0' }}>
          <div className="dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubAgentTaskDetailView;
