import React, { useEffect, useState, useCallback, useRef } from 'react';

import '../../styles/Header.css';
import { Pin, PinOff, Play, Square, AlarmClock, Copy, Check, Bot, Globe } from 'lucide-react';
import StatusBadges from '../ui/StatusBadges';
import { useAgentConfig } from '../userData/userDataProvider';
import { useLayout } from '../layout/LayoutProvider';
import { agentChatSessionCacheManager, CurrentSessionStatus, useMessages, useCurrentChatId, useCurrentChatSessionId } from '../../lib/chat/agentChatSessionCacheManager';
import { hasRealSessionContentMessages, isRealSessionContentMessage } from '../../lib/chat/sessionMessageVisibility';
import { AgentAvatar } from '../common/AgentAvatar';
import UnreadCountBadge from '../common/UnreadCountBadge';
import { createLogger } from '../../lib/utilities/logger';
import { ScheduleSidepaneAtom, WorkspaceExplorerAtom, SubAgentTasksSidepaneAtom } from './chat-side.atom';
import { EmbeddedBrowserAtom, isBrowserOpenFor } from '../browser/embeddedBrowser.atom';
import { useAuthContext } from '../auth/AuthProvider';
import { useChatUnreadSummary } from '@renderer/lib/chat/useChatUnreadSummary';
import { useEmbeddedBrowserEnabled } from '../../lib/userData/useEmbeddedBrowserEnabled';
import { ToggleMemexMemory } from './MemexMemorySidepane';
import { useI18n } from '../../lib/i18n/useI18n';

const logger = createLogger('[ChatViewHeader]');

/** Dev-only popover showing version & IDs, click to toggle, click-outside to close */
function DevInfoBadge({ appVersion, chatId, sessionId }: {
  appVersion: string;
  chatId: string | null;
  sessionId?: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const copyValue = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const rows = [
    { key: 'version', label: t('chat.header.dev.version'), value: appVersion },
    ...(chatId ? [{ key: 'chat', label: t('chat.header.dev.chatId'), value: chatId }] : []),
    ...(sessionId ? [{ key: 'session', label: t('chat.header.dev.sessionId'), value: sessionId }] : []),
  ];

  return (
    <div className="dev-info-wrapper" ref={ref}>
      <button
        className={`dev-info-badge${open ? ' dev-info-badge--active' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        {t('chat.header.dev.badge')}
      </button>
      {open && (
        <div className="dev-info-popover">
          {rows.map(({ key, label, value }) => (
            <div key={key} className="dev-info-row" onClick={() => copyValue(key, value)}>
              <span className="dev-info-label">{label}</span>
              <span className="dev-info-value">
                <span>{value}</span>
                {copied === key ? <Check size={12} /> : <Copy size={12} />}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChatViewHeaderProps {
  onOpenMcpTools?: () => void;
  onOpenSkills?: () => void;
  currentChatSessionId?: string | null;
}

const ChatViewHeader: React.FC<ChatViewHeaderProps> = ({
  onOpenMcpTools,
  onOpenSkills,
  currentChatSessionId,
}) => {
  const { t } = useI18n();
  // Get minimal-mode state and always-on-top toggle from LayoutProvider
  const { isMinimalMode, isAlwaysOnTop, toggleAlwaysOnTop } = useLayout();

  // For programmatic navigation


  // Get currentChatId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );

  // Get app version for development mode display
  const [appVersion, setAppVersion] = useState<string>('1.15.6');

  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      window.electronAPI?.getVersion?.().then((version) => {
        setAppVersion(version);
      }).catch(() => {
        setAppVersion('1.15.6');
      });
    }
  }, []);

  // Get current agent configuration data - depends on currentChatId to update on switch
  const { agent } = useAgentConfig();

  return (
    <header className="unified-header">
      <div className="header-title">
        {agent && (
          <span className="header-icon">
            <AgentAvatar
              emoji={agent.emoji}
              avatar={agent.avatar}
              source={agent.source}
              name={agent.name}
              size="md"
              version={agent.version}
            />
          </span>
        )}
        <span className="header-name">{agent ? agent.name : t('chat.header.defaultTitle')}</span>
        <StatusBadges
          onOpenMcpTools={onOpenMcpTools}
          onOpenSkills={onOpenSkills}
        />
        {/* Development mode: Display version and current chat IDs */}
        {process.env.NODE_ENV === 'development' && (
          <DevInfoBadge
            appVersion={appVersion}
            chatId={currentChatId}
            sessionId={currentChatSessionId}
          />
        )}
      </div>
      <div className="header-actions">

        {/* Always on top toggle button - only shown in minimal mode */}
        {isMinimalMode && (
          <button
            className={`btn-action ${isAlwaysOnTop ? 'active' : ''}`}
            onClick={toggleAlwaysOnTop}
            title={isAlwaysOnTop ? t('chat.header.disableAlwaysOnTop') : t('chat.header.enableAlwaysOnTop')}
            aria-label={isAlwaysOnTop ? t('chat.header.disableAlwaysOnTop') : t('chat.header.enableAlwaysOnTop')}
          >
            {isAlwaysOnTop ? <Pin size={24} /> : <PinOff size={24} />}
          </button>
        )}

        {!isMinimalMode && <ToggleSubAgentTasks />}
        {!isMinimalMode && <ToggleMemexMemory />}
        {!isMinimalMode && <ToggleSchedulesSidepane />}
        {!isMinimalMode && <ToggleEmbeddedBrowser />}
        {!isMinimalMode && <ToggleWorkspaceExplorer />}
      </div>

    </header>
  );
};

function ToggleWorkspaceExplorer() {
  const [{ visible }, actions] = WorkspaceExplorerAtom.use();
  const { t } = useI18n();
  return (
    <button
      className={`btn-action ${visible ? 'active' : ''}`}
      onClick={actions.effectiveToggle}
      title={visible ? t('chat.header.hideWorkspace') : t('chat.header.showWorkspace')}
      aria-label={visible ? t('chat.header.hideWorkspace') : t('chat.header.showWorkspace')}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <mask id="mask0_428_1507" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <path d="M3.5 6.25V8H8.12868C8.32759 8 8.51836 7.92098 8.65901 7.78033L10.1893 6.25L8.65901 4.71967C8.51836 4.57902 8.32759 4.5 8.12868 4.5H5.25C4.2835 4.5 3.5 5.2835 3.5 6.25ZM2 6.25C2 4.45507 3.45507 3 5.25 3H8.12868C8.72542 3 9.29771 3.23705 9.71967 3.65901L11.5607 5.5H18.75C20.5449 5.5 22 6.95507 22 8.75V17.75C22 19.5449 20.5449 21 18.75 21H5.25C3.45507 21 2 19.5449 2 17.75V6.25ZM3.5 9.5V17.75C3.5 18.7165 4.2835 19.5 5.25 19.5H18.75C19.7165 19.5 20.5 18.7165 20.5 17.75V8.75C20.5 7.7835 19.7165 7 18.75 7H11.5607L9.71967 8.84099C9.29771 9.26295 8.72542 9.5 8.12868 9.5H3.5Z" fill="currentColor" />
        </mask>
        <g mask="url(#mask0_428_1507)">
          <rect width="24" height="24" fill="currentColor" />
        </g>
      </svg>
    </button>
  );
}

function ToggleSubAgentTasks() {
  const [state, actions] = SubAgentTasksSidepaneAtom.use();
  const { t } = useI18n();
  const currentSessionId = useCurrentChatSessionId();
  const [hasTasks, setHasTasks] = useState(false);
  const [hasRunning, setHasRunning] = useState(false);

  useEffect(() => {
    if (!currentSessionId) { setHasTasks(false); setHasRunning(false); return; }
    // Check if session has any sub-agent tasks
    window.electronAPI.subAgentTask.listForSession(currentSessionId).then(result => {
      if (result.success && result.data && result.data.length > 0) {
        setHasTasks(true);
        setHasRunning(result.data.some((t: { status: string }) => t.status === 'running'));
      } else {
        setHasTasks(false);
        setHasRunning(false);
      }
    }).catch(() => { setHasTasks(false); setHasRunning(false); });
  }, [currentSessionId]);

  // Listen for new task creation to show the button immediately
  useEffect(() => {
    if (!currentSessionId) return;
    const unsub = window.electronAPI.subAgentTask.onTaskCreated((data) => {
      if (data.parentSessionId === currentSessionId) {
        setHasTasks(true);
        if (data.status === 'running') setHasRunning(true);
      }
    });
    return unsub;
  }, [currentSessionId]);

  // Listen for task updates to track running state
  useEffect(() => {
    if (!currentSessionId) return;
    const unsub = window.electronAPI.subAgentTask.onTaskUpdated((data) => {
      if (data.parentSessionId !== currentSessionId) return;
      // Re-check running state: if this task stopped running, re-query
      if (data.status !== 'running') {
        window.electronAPI.subAgentTask.listForSession(currentSessionId).then(result => {
          if (result.success && result.data) {
            setHasRunning(result.data.some((t: { status: string }) => t.status === 'running'));
          }
        }).catch(() => {});
      }
    });
    return unsub;
  }, [currentSessionId]);

  if (!hasTasks && !state.visible) return null;

  return (
    <button
      className={`btn-action subagent-toggle-button ${state.visible ? 'active' : ''}`}
      onClick={actions.effectiveToggle}
      title={state.visible ? t('chat.header.hideSubAgentTasks') : t('chat.header.showSubAgentTasks')}
      aria-label={state.visible ? t('chat.header.hideSubAgentTasks') : t('chat.header.showSubAgentTasks')}
    >
      <Bot size={20} />
      {hasRunning && <span className="subagent-running-badge" />}
    </button>
  );
}

function ToggleSchedulesSidepane() {
  const [visible, actions] = ScheduleSidepaneAtom.use();
  const { t } = useI18n();
  const { user } = useAuthContext();
  const currentChatId = useCurrentChatId();
  const { scheduledUnreadCount } = useChatUnreadSummary(currentChatId, user?.login || null);

  return (
    <button
      className={`btn-action schedule-toggle-button ${visible ? 'active' : ''}`}
      onClick={actions.effectiveToggle}
      title={visible ? t('chat.header.hideSchedules') : t('chat.header.showSchedules')}
      aria-label={visible ? t('chat.header.hideSchedules') : t('chat.header.showSchedules')}
    >
      <AlarmClock size={20} />
      <UnreadCountBadge
        count={scheduledUnreadCount}
        className="schedule-unread-badge"
        ariaLabel={t('chat.header.schedulesUnread', { count: scheduledUnreadCount })}
      />
    </button>
  );
}

function ToggleEmbeddedBrowser() {
  const browserEnabled = useEmbeddedBrowserEnabled();
  const { t } = useI18n();
  const currentSessionId = useCurrentChatSessionId();
  const [state, actions] = EmbeddedBrowserAtom.use();
  const open = isBrowserOpenFor(state, currentSessionId);

  // App-level feature switch: hide the entry entirely when disabled.
  if (!browserEnabled) return null;

  // The browser is chat-session-scoped; without an active session there is
  // nothing to attach a view to.
  if (!currentSessionId) return null;

  return (
    <button
      className={`btn-action ${open ? 'active' : ''}`}
      onClick={() => actions.toggle(currentSessionId)}
      title={open ? t('chat.header.hideBrowser') : t('chat.header.showBrowser')}
      aria-label={open ? t('chat.header.hideBrowser') : t('chat.header.showBrowser')}
    >
      <Globe size={20} />
    </button>
  );
}

export default ChatViewHeader;