'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { useToast } from '../ui/ToastProvider';
import '../../styles/RuntimeSettings.css';
import '../../styles/Header.css';
import { createLogger } from '../../lib/utilities/logger';
import { profileDataManager } from "../../lib/userData";
const logger = createLogger('[ArchivedAgentsView]');

interface ArchivedAgent {
  archived_at: string;
  chat_id: string;
  chat_type: string;
  agent?: {
    name?: string;
    description?: string;
    system_prompt?: string;
    model?: string;
    source?: string;
  };
}

const ArchivedAgentsView: React.FC = () => {
  const [archivedAgents, setArchivedAgents] = useState<ArchivedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { showSuccess, showError } = useToast();

  const loadArchivedAgents = useCallback(async () => {
    try {
      setIsLoading(true);
      if (!window.electronAPI?.profile?.getArchivedAgents) {
        setArchivedAgents([]);
        return;
      }
      const result = await window.electronAPI.profile.getArchivedAgents();
      if (result.success && result.data) {
        // Sort by archived_at descending (most recent first)
        const sorted = [...result.data].sort((a: ArchivedAgent, b: ArchivedAgent) => {
          return new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime();
        });
        setArchivedAgents(sorted);
      } else {
        setArchivedAgents([]);
      }
    } catch (error) {
      logger.error('Failed to load archived agents:', error);
      setArchivedAgents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArchivedAgents();
  }, [loadArchivedAgents]);

  const handleRestore = useCallback(async (chatId: string, agentName: string) => {
    try {
      setRestoringId(chatId);
      if (!window.electronAPI?.profile?.unarchiveChatConfig) {
        showError('Restore API not available');
        return;
      }
      const result = await window.electronAPI.profile.unarchiveChatConfig(chatId);
      if (result.success) {
        showSuccess(`Agent "${agentName}" restored successfully`);
        // Refresh profile data
        await profileDataManager.refresh();
        // Reload archived agents list
        await loadArchivedAgents();
      } else {
        showError(`Failed to restore agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to restore agent: ${errorMessage}`);
    } finally {
      setRestoringId(null);
    }
  }, [loadArchivedAgents, showSuccess, showError]);

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
          <span className="header-name">Archived Agents</span>
        </div>
      </div>

      {/* Content */}
      <div className="runtime-settings-content" style={{ padding: '20px', overflow: 'auto' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: '#6b7280' }}>
            Loading archived agents...
          </div>
        ) : archivedAgents.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: '#6b7280',
            gap: '12px',
          }}>
            <Archive size={48} strokeWidth={1} style={{ opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 500 }}>No archived agents</p>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7 }}>
              Archived agents will appear here. You can archive agents from the agent menu.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {archivedAgents.map((agent) => (
              <div
                key={agent.chat_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  backgroundColor: 'var(--color-surface, #ffffff)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--color-text-primary, #111827)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {agent.agent?.name || 'Unknown Agent'}
                    </span>
                    {agent.agent?.source && (
                      <span style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(0, 0, 0, 0.05)',
                        color: '#6b7280',
                      }}>
                        {agent.agent.source}
                      </span>
                    )}
                  </div>
                  {agent.agent?.description && (
                    <span style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {agent.agent.description}
                    </span>
                  )}
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    Archived {formatDate(agent.archived_at)}
                  </span>
                </div>
                <button
                  onClick={() => handleRestore(agent.chat_id, agent.agent?.name || 'Unknown Agent')}
                  disabled={restoringId === agent.chat_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(0, 0, 0, 0.15)',
                    backgroundColor: 'transparent',
                    cursor: restoringId === agent.chat_id ? 'not-allowed' : 'pointer',
                    opacity: restoringId === agent.chat_id ? 0.5 : 1,
                    fontSize: '13px',
                    color: 'var(--color-text-primary, #374151)',
                    flexShrink: 0,
                    marginLeft: '16px',
                  }}
                  title="Restore this agent"
                >
                  <RotateCcw size={14} />
                  <span>{restoringId === agent.chat_id ? 'Restoring...' : 'Restore'}</span>
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
