import React from 'react';
import { CornerDownRight, Pencil, Trash2 } from 'lucide-react';
import { MessageHelper } from '@shared/types/chatTypes';
import { QueuedMessageDraft, queuedMessageAtom } from './queued-message.atom';
import { useI18n } from '../../lib/i18n/useI18n';

interface QueuedMessageListProps {
  chatSessionId?: string | null;
  items: QueuedMessageDraft[];
}

const QueuedMessageList: React.FC<QueuedMessageListProps> = ({ chatSessionId, items }) => {
  const actions = queuedMessageAtom.useChange();
  const { t } = useI18n();

  if (!chatSessionId || items.length === 0) {
    return null;
  }

  return (
    <div className="queued-message-list" aria-label={t('chat.queue.aria')}>
      {items.map((item) => {
        const isEditing = item.status === 'editing';
        const text = MessageHelper.getText(item.message).trim() || t('chat.queue.defaultMessage');
        return (
          <div className="queued-message-list-row" key={item.id}>
            <div className="queued-message-list-text" title={text}>
              <CornerDownRight className="queued-message-list-icon" size={18} strokeWidth={2} aria-hidden="true" />
              <span className="queued-message-list-copy">{text}</span>
              {isEditing && (
                <span className="queued-message-list-status">
                  {item.pendingSteer ? t('chat.queue.editingThenSteering') : t('chat.queue.editing')}
                </span>
              )}
            </div>
            <div className="queued-message-list-actions">
              <button
                type="button"
                className="queued-message-list-action"
                onClick={() => actions.steerNow(chatSessionId, item.id)}
                title={isEditing ? t('chat.queue.moveToFrontAfterEditing') : t('chat.queue.moveToFront')}
              >
                <CornerDownRight size={16} strokeWidth={2} aria-hidden="true" />
                <span>{t('chat.queue.steer')}</span>
              </button>
              <button
                type="button"
                className="queued-message-list-icon-button"
                onClick={() => actions.cancel(chatSessionId, item.id)}
                title={t('chat.queue.cancel')}
                aria-label={t('chat.queue.cancel')}
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="queued-message-list-icon-button"
                onClick={() => actions.startEdit(chatSessionId, item.id)}
                title={t('chat.queue.edit')}
                aria-label={t('chat.queue.edit')}
              >
                <Pencil size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default QueuedMessageList;
