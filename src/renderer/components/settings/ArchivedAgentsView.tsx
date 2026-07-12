'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { useToast } from '../ui/ToastProvider';
import '../../styles/RuntimeSettings.css';
import '../../styles/Header.css';
import { createLogger } from '../../lib/utilities/logger';
import { profileDataManager } from "../../lib/userData";
import { useI18n } from '../../lib/i18n/useI18n';
import type { AgentSystemPrompt } from '@shared/types/agentSystemPrompt';
const logger = createLogger('[ArchivedAgentsView]');

interface ArchivedChat {
  archived_at: string;
  chat_id: string;
  chat_type: string;
  agent?: {
    name?: string;
    description?: string;
    system_prompt?: AgentSystemPrompt | string;
    model?: string;
    source?: string;
  };
}

const ArchivedAgentsView: React.FC = () => {
  const [archivedChats, setArchivedChats] = useState<ArchivedChat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { showSuccess, showError } = useToast();
  const { t } = useI18n();

  const loadArchivedChats = useCallback(async () => {
    try {
      setIsLoading(true);
      if (!window.electronAPI?.profile?.getArchivedAgents) {
        setArchivedChats([]);
        return;
      }
      const result = await window.electronAPI.profile.getArchivedAgents();
      if (result.success && result.data) {
        // Sort by archived_at descending (most recent first)
        const sorted = [...result.data].sort((a: ArchivedChat, b: ArchivedChat) => {
          return new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime();
        });
        setArchivedChats(sorted);
      } else {
        setArchivedChats([]);
      }
    } catch (error) {
      logger.error('Failed to load archived chats:', error);
      setArchivedChats([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArchivedChats();
  }, [loadArchivedChats]);

  const handleRestore = useCallback(async (chatId: string, chatName: string) => {
    try {
      setRestoringId(chatId);
      if (!window.electronAPI?.profile?.unarchiveChatConfig) {
        showError(t('settings.archived.restoreApiUnavailable'));
        return;
      }
      const result = await window.electronAPI.profile.unarchiveChatConfig(chatId);
      if (result.success) {
        showSuccess(t('settings.archived.restored', { name: chatName }));
        // Refresh profile data
        await profileDataManager.refresh();
        // Reload archived chats list
        await loadArchivedChats();
      } else {
        showError(t('settings.archived.restoreFailed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('settings.archived.restoreFailed', { error: errorMessage }));
    } finally {
      setRestoringId(null);
    }
  }, [loadArchivedChats, showSuccess, showError, t]);

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="runtime-settings-view">
      {/* Header */}
      <div className="unified-header">
        <div className="header-title">
          <Archive size={24} />
          <span className="header-name">{t('settings.archived.title')}</span>
        </div>
      </div>

      {/* Content */}
      <div className="runtime-settings-content" style={{ padding: '20px', overflow: 'auto' }}>
        {isLoading ? (
          <div className="archived-agents-loading" style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: 'var(--color-neutral-500)' }}>
            {t('settings.archived.loading')}
          </div>
        ) : archivedChats.length === 0 ? (
          <div className="archived-agents-empty" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: 'var(--color-neutral-500)',
            gap: '12px',
          }}>
            <Archive size={48} strokeWidth={1} style={{ opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 500 }}>{t('settings.archived.empty')}</p>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7 }}>
              {t('settings.archived.emptyDescription')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {archivedChats.map((chat) => (
              <div
                className="archived-agent-card"
                key={chat.chat_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  backgroundColor: 'var(--color-surface, var(--color-white))',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="archived-agent-name" style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--color-text-primary, var(--color-neutral-900))',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {chat.agent?.name || t('settings.archived.unknownAgent')}
                    </span>
                    {chat.agent?.source && (
                      <span className="archived-agent-source" style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(0, 0, 0, 0.05)',
                        color: 'var(--color-neutral-500)',
                      }}>
                        {chat.agent.source}
                      </span>
                    )}
                  </div>
                  {chat.agent?.description && (
                    <span className="archived-agent-description" style={{
                      fontSize: '12px',
                      color: 'var(--color-neutral-500)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {chat.agent.description}
                    </span>
                  )}
                  <span className="archived-agent-date" style={{ fontSize: '11px', color: 'var(--color-neutral-400)' }}>
                    {t('settings.archived.archivedAt', { time: formatDate(chat.archived_at) })}
                  </span>
                </div>
                <button
                  className="archived-agent-restore"
                  onClick={() => handleRestore(chat.chat_id, chat.agent?.name || t('settings.archived.unknownAgent'))}
                  disabled={restoringId === chat.chat_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(0, 0, 0, 0.15)',
                    backgroundColor: 'transparent',
                    cursor: restoringId === chat.chat_id ? 'not-allowed' : 'pointer',
                    opacity: restoringId === chat.chat_id ? 0.5 : 1,
                    fontSize: '13px',
                    color: 'var(--color-text-primary, var(--color-neutral-700))',
                    flexShrink: 0,
                    marginLeft: '16px',
                  }}
                  title={t('settings.archived.restoreThisChat')}
                >
                  <RotateCcw size={14} />
                  <span>{restoringId === chat.chat_id ? t('settings.archived.restoring') : t('settings.archived.restore')}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ArchivedAgentsView;
