import React, { useCallback, memo, useLayoutEffect } from 'react';
import { Message, UserMessage } from '@shared/types/chatTypes';
import { type ChatStatus, CurrentSessionInteractiveRequest } from '../../lib/chat/agentChatSessionCacheManager';
import '../../styles/ChatContainer.css';
import { useToast } from '../ui/ToastProvider';
import { EditingMessageState, editMessageAtom } from './edit-message.atom';
import FindBar from './FindBar';
import { getChatRenderItemStableKey, ChatRenderItemComponent, useRenderItems } from './ChatRenderItem';
import LazyRenderItem, { NEAR_BOTTOM_COUNT } from './LazyRenderItem';
import MessageFlowNavigationRail, { CHAT_RENDER_ITEM_KEY_ATTRIBUTE } from './MessageFlowNavigationRail';
import ChatScrollbar from './ChatScrollbar';
import { useActivitySlot, useAutoScroll, useFileExistsCache } from './ChatContainer.hooks';
import { useI18n } from '../../lib/i18n/useI18n';

interface ChatContainerProps {
  messages: Message[];
  allMessages: Message[]; // All messages including tool messages for context
  streamingMessageId?: string; // ID of the message currently being streamed
  chatId?: string;
  chatSessionId?: string;
  chatStatus?: ChatStatus;
  editingMessage?: EditingMessageState | null;
  canEditUserMessage?: boolean;
}

const ChatContainerInner: React.FC<ChatContainerProps> = ({
  messages,
  allMessages,
  streamingMessageId,
  chatId,
  chatSessionId,
  chatStatus,
  editingMessage,
  canEditUserMessage,
}) => {
  const { t } = useI18n();
  const pendingInteractiveRequest = CurrentSessionInteractiveRequest.use();
  const {
    containerRef,
    messageFlowRef,
    showJumpToLatest,
    handleContainerScroll,
    handleJumpToLatestClick,
    handleContentChange,
    isWithinLatestScrollStabilizationWindow,
    scrollToLatestPosition,
  } = useAutoScroll(chatSessionId, messages, pendingInteractiveRequest);

  // Build render items directly from messages, with tool-call merging support
  const renderItems = useRenderItems(allMessages, chatSessionId, messages, pendingInteractiveRequest);
  const fileExistsCache = useFileExistsCache(renderItems, chatId);
  const {
    renderItemsWithActivity,
    shouldShowTopLevelLoading,
    shouldShowBoundaryContainer,
  } = useActivitySlot(renderItems, streamingMessageId, allMessages, chatStatus, messages);

  const toast = useToast();
  const editMessageActions = editMessageAtom.useChange();
  const handleStartEdit = useCallback((message: UserMessage) => {
    editMessageActions.start(chatSessionId!, message, toast);
  }, [chatSessionId, toast]);

  const isCompressing = chatStatus === 'compressing_context';
  const renderLoadingIndicator = useCallback((className?: string) => {
    let loadingText = '';
    if (isCompressing) {
      loadingText = 'Compressing...';
    }

    if (loadingText) {
      return (
        <div className={`loading-text ${className || ''}`.trim()}>
          {loadingText}&nbsp;
          <div className="typing-indicator inline">
            <div className="dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`typing-indicator ${className || ''}`.trim()}>
        <div className="dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }, [isCompressing]);

  useLayoutEffect(() => {
    if (messages.length === 0 || !isWithinLatestScrollStabilizationWindow()) return;
    scrollToLatestPosition('layout-effect');
  }, [chatSessionId, isWithinLatestScrollStabilizationWindow, messages.length, renderItemsWithActivity.length, scrollToLatestPosition]);

  return (
    <div className="chat-container-with-overlay">
      <FindBar rootRef={messageFlowRef} scrollContainerRef={containerRef} sessionId={chatSessionId} />
      <div className="chat-container-reverse" ref={containerRef} onScroll={handleContainerScroll} tabIndex={-1}>
        <div className="chat-message-flow-reverse" ref={messageFlowRef}>
          {/* Fixed boundary container */}
          {shouldShowBoundaryContainer() && (
            <div className={`message-boundary-container ${shouldShowTopLevelLoading() ? 'has-loading' : ''}`}>
              {shouldShowTopLevelLoading() && (
                <div className="message assistant-message loading-message fixed-boundary">
                  <div className="message-content">
                    <div className="flex w-full min-w-0 max-w-full items-start">
                      <div className="min-w-0 max-w-full flex-1">
                        {renderLoadingIndicator()}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {renderItemsWithActivity.reduceRight((acc, item, index) => {
            const isNearBottom = index >= renderItemsWithActivity.length - NEAR_BOTTOM_COUNT;
            const key = getChatRenderItemStableKey(item);
            const renderedItem = (
              <LazyRenderItem key={key} isNearBottom={isNearBottom}>
                <ChatRenderItemComponent
                  item={item}
                  isLast={index === renderItemsWithActivity.length - 1}
                  renderLoadingIndicator={renderLoadingIndicator}
                  chatStatus={chatStatus}
                  editingMessage={editingMessage}
                  onSaveEditedMessage={editMessageActions.save}
                  onCancelEdit={editMessageActions.cancel}
                  onStartEdit={handleStartEdit}
                  canEditUserMessage={canEditUserMessage}
                  streamingMessageId={streamingMessageId}
                  fileExistsCache={fileExistsCache}
                  handleContentChange={handleContentChange}
                />
              </LazyRenderItem>
            );
            const rendered = item.type === 'user'
              ? <div key={key} {...{ [CHAT_RENDER_ITEM_KEY_ATTRIBUTE]: key }}>{renderedItem}</div>
              : renderedItem;
            return (acc.push(rendered), acc);
          }, [] as React.ReactNode[])}
        </div>
      </div>
      <MessageFlowNavigationRail
        items={renderItemsWithActivity}
        scrollContainerRef={containerRef}
        messageFlowRef={messageFlowRef}
      />
      <ChatScrollbar scrollContainerRef={containerRef} />
      {showJumpToLatest && (
        <button
          type="button"
          className="chat-jump-to-latest-button"
          onClick={handleJumpToLatestClick}
          aria-label={t('chat.container.scrollToLatest')}
          title={t('chat.container.scrollToLatest')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 4L8 8.5L12.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 8.5L8 13L12.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
};

const ChatContainer: React.FC<ChatContainerProps> = memo(ChatContainerInner);
ChatContainer.displayName = 'ChatContainer';
export default ChatContainer;