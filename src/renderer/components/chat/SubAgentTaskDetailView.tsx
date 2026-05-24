import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSubAgentTask } from '../../lib/subAgent/useSubAgentTask';
import type { Message } from '@shared/types/chatTypes';
import { useRenderItems, ChatRenderItemComponent, getChatRenderItemStableKey } from './ChatRenderItem';
import '../../styles/Message.css';
import '../../styles/markdown-render.css';

interface SubAgentTaskDetailViewProps {
  taskId: string;
}

const SubAgentTaskDetailView: React.FC<SubAgentTaskDetailViewProps> = ({ taskId }) => {
  const { messages, status, loading, error } = useSubAgentTask(taskId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isStreaming = status === 'running';

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

  // No-op callbacks for ChatRenderItemComponent props we don't need
  const noopRenderLoading = useCallback(() => null, []);
  const noopSave = useCallback(() => {}, []);
  const noopCancel = useCallback(() => {}, []);
  const noopStartEdit = useCallback(() => {}, []);
  const emptyFileCache: Record<string, boolean> = useMemo(() => ({}), []);

  if (loading) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, #888)', textAlign: 'center' }}>
        Loading task...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: '#ef4444', textAlign: 'center' }}>
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
        <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, #888)', textAlign: 'center' }}>
          No messages yet
        </div>
      )}
      {renderItems.map((item, index) => (
        <ChatRenderItemComponent
          key={getChatRenderItemStableKey(item)}
          item={item}
          isLast={index === renderItems.length - 1}
          renderLoadingIndicator={noopRenderLoading}
          chatStatus={undefined}
          editingMessage={null}
          onSaveEditedMessage={noopSave}
          onCancelEdit={noopCancel}
          onStartEdit={noopStartEdit}
          canEditUserMessage={false}
          streamingMessageId={streamingMessageId}
          fileExistsCache={emptyFileCache}
        />
      ))}
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
