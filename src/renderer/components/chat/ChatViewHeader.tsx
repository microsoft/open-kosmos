import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import '../../styles/Header.css';
import { Eye, EyeOff, Pin, PinOff, RotateCw, Play, Square, AlarmClock, Copy, Check, Bot } from 'lucide-react';
import StatusBadges from '../ui/StatusBadges';
import { useAgentConfig } from '../userData/userDataProvider';
import { useLayout } from '../layout/LayoutProvider';
import { agentChatSessionCacheManager, ChatSessionCache, CurrentSessionStatus, useMessages, useCurrentChatId, useCurrentChatSessionId } from '../../lib/chat/agentChatSessionCacheManager';
import { hasRealSessionContentMessages, isRealSessionContentMessage } from '../../lib/chat/sessionMessageVisibility';
import { AgentAvatar } from '../common/AgentAvatar';
import UnreadCountBadge from '../common/UnreadCountBadge';
import { createLogger } from '../../lib/utilities/logger';
import { useToast } from '../ui/ToastProvider';
import { ScheduleSidepaneAtom, WorkspaceExplorerAtom, SubAgentTasksSidepaneAtom } from './chat-side.atom';
import { useAuthContext } from '../auth/AuthProvider';
import { useChatUnreadSummary } from '@renderer/lib/chat/useChatUnreadSummary';

const logger = createLogger('[ChatViewHeader]');
const ENABLE_TOGGLE_MINIMAL_MODE = false;

/**
 * Compare version strings; returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 * Supports semver format (e.g. 1.0.0, 2.1.3).
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

/** Dev-only popover showing version & IDs, click to toggle, click-outside to close */
function DevInfoBadge({ appVersion, chatId, sessionId }: {
  appVersion: string;
  chatId: string | null;
  sessionId?: string | null;
}) {
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
    { key: 'version', label: 'Version', value: appVersion },
    ...(chatId ? [{ key: 'chat', label: 'Chat ID', value: chatId }] : []),
    ...(sessionId ? [{ key: 'session', label: 'Session ID', value: sessionId }] : []),
  ];

  return (
    <div className="dev-info-wrapper" ref={ref}>
      <button
        className={`dev-info-badge${open ? ' dev-info-badge--active' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        DEV
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
  // Get minimal-mode state and always-on-top toggle from LayoutProvider
  const { isMinimalMode, setMinimalMode, isAlwaysOnTop, toggleAlwaysOnTop } = useLayout();

  // For programmatic navigation
  const navigate = useNavigate();


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

  /**
   * Check whether all ChatSessions for the current chatId are in Idle state.
   * If any session is active, the config cannot be updated because it would affect ongoing sessions.
   */
  const areAllChatSessionsIdle = useCallback((): boolean => {
    if (!currentChatId) {
      return true; // Default to true when there is no chatId
    }

    const allCaches = agentChatSessionCacheManager.getAllChatSessionCaches();

    // Find all ChatSessions that belong to the current chatId
    const sessionsForCurrentChat: ChatSessionCache[] = [];
    Object.values(allCaches).forEach((cache) => {
      if (cache && cache.chatId === currentChatId) {
        sessionsForCurrentChat.push(cache);
      }
    });

    // Default to true when there are no sessions
    if (sessionsForCurrentChat.length === 0) {
      return true;
    }

    // Check whether all sessions are idle
    return sessionsForCurrentChat.every((cache) => cache.chatStatus === 'idle');
  }, [currentChatId]);

  // Compute whether to show the Update button and its tooltip
  const updateButtonInfo = useMemo(() => {
    return { show: false, tooltip: '' };
  }, [agent, areAllChatSessionsIdle]);

  /**
   * Handle Update button click.
   * Navigate to the Agent Library page, passing the agent name as a URL parameter.
   * The Agent Library page will auto-select the matching agent.
   */
  const handleUpdateClick = useCallback(() => {
    if (!agent?.name) {
      logger.warn('Update button clicked but agent name is not available');
      return;
    }

    logger.debug('Update button clicked for agent:', agent.name);

    // Navigate to Agent Library with the agent name as a query parameter.
    // Use encodeURIComponent to safely encode any special characters in the agent name.
    const agentLibraryUrl = `/agent/chat/creation/agent-library?selectAgent=${encodeURIComponent(agent.name)}`;
    navigate(agentLibraryUrl);
  }, [agent?.name, navigate]);

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
        <span className="header-name">{agent ? agent.name : 'Chat'}</span>
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
        {/* Update Agent button - shown when remote version is newer */}
        {updateButtonInfo.show && (
          <button
            className="update-agent-button"
            onClick={handleUpdateClick}
            title={updateButtonInfo.tooltip}
            aria-label={updateButtonInfo.tooltip}
            type="button"
          >
            <RotateCw className="update-agent-icon" />
            <span className="update-agent-text">Update</span>
          </button>
        )}

        {/* Always on top toggle button - only shown in minimal mode */}
        {isMinimalMode && (
          <button
            className={`btn-action ${isAlwaysOnTop ? 'active' : ''}`}
            onClick={toggleAlwaysOnTop}
            title={isAlwaysOnTop ? "Disable always on top" : "Enable always on top"}
            aria-label={isAlwaysOnTop ? "Disable always on top" : "Enable always on top"}
          >
            {isAlwaysOnTop ? <Pin size={24} /> : <PinOff size={24} />}
          </button>
        )}

        {!isMinimalMode && <ToggleSubAgentTasks />}
        {!isMinimalMode && <ToggleSchedulesSidepane />}
        {!isMinimalMode && <ToggleWorkspaceExplorer />}

        {/* Minimal/Focus mode toggle - currently disabled */}
        {ENABLE_TOGGLE_MINIMAL_MODE && (
          <ToggleMinimal isMinimalMode={isMinimalMode} setMinimalMode={setMinimalMode} />
        )}
      </div>

    </header>
  );
};

function ToggleWorkspaceExplorer() {
  const [{ visible }, actions] = WorkspaceExplorerAtom.use();
  return (
    <button
      className={`btn-action ${visible ? 'active' : ''}`}
      onClick={actions.effectiveToggle}
      title={visible ? "Hide workspace explorer" : "Show workspace explorer"}
      aria-label={visible ? "Hide workspace explorer" : "Show workspace explorer"}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <mask id="mask0_428_1507" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <path d="M3.5 6.25V8H8.12868C8.32759 8 8.51836 7.92098 8.65901 7.78033L10.1893 6.25L8.65901 4.71967C8.51836 4.57902 8.32759 4.5 8.12868 4.5H5.25C4.2835 4.5 3.5 5.2835 3.5 6.25ZM2 6.25C2 4.45507 3.45507 3 5.25 3H8.12868C8.72542 3 9.29771 3.23705 9.71967 3.65901L11.5607 5.5H18.75C20.5449 5.5 22 6.95507 22 8.75V17.75C22 19.5449 20.5449 21 18.75 21H5.25C3.45507 21 2 19.5449 2 17.75V6.25ZM3.5 9.5V17.75C3.5 18.7165 4.2835 19.5 5.25 19.5H18.75C19.7165 19.5 20.5 18.7165 20.5 17.75V8.75C20.5 7.7835 19.7165 7 18.75 7H11.5607L9.71967 8.84099C9.29771 9.26295 8.72542 9.5 8.12868 9.5H3.5Z" fill="#242424" />
        </mask>
        <g mask="url(#mask0_428_1507)">
          <rect width="24" height="24" fill="#272320" />
        </g>
      </svg>
    </button>
  );
}

function ToggleSubAgentTasks() {
  const [state, actions] = SubAgentTasksSidepaneAtom.use();
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
      title={state.visible ? "Hide sub-agent tasks" : "Show sub-agent tasks"}
      aria-label={state.visible ? "Hide sub-agent tasks" : "Show sub-agent tasks"}
    >
      <Bot size={20} />
      {hasRunning && <span className="subagent-running-badge" />}
    </button>
  );
}

function ToggleSchedulesSidepane() {
  const [visible, actions] = ScheduleSidepaneAtom.use();
  const { user } = useAuthContext();
  const currentChatId = useCurrentChatId();
  const { scheduledUnreadCount } = useChatUnreadSummary(currentChatId, user?.login || null);

  return (
    <button
      className={`btn-action schedule-toggle-button ${visible ? 'active' : ''}`}
      onClick={actions.effectiveToggle}
      title={visible ? "Hide schedules" : "Show schedules"}
      aria-label={visible ? "Hide schedules" : "Show schedules"}
    >
      <AlarmClock size={20} />
      <UnreadCountBadge
        count={scheduledUnreadCount}
        className="schedule-unread-badge"
        ariaLabel={`Schedules has ${scheduledUnreadCount} unread sessions`}
      />
    </button>
  );
}

function ToggleMinimal(props: {
  disabled?: boolean,
  isMinimalMode?: boolean,
  setMinimalMode: (value: boolean) => void,
}) {
  const { disabled, isMinimalMode, setMinimalMode } = props;
  const { showError } = useToast();
  const [originalWindowSize, setOriginalWindowSize] = useState<{ width: number; height: number } | null>(null);

  // Handle minimal mode toggle
  const onToggleMinimalMode = async () => {
    try {
      if (!isMinimalMode) {
        // Entering minimal mode

        // Store current window size and constraints
        if (window.electronAPI?.window?.getSize) {
          const currentSize = await window.electronAPI.window.getSize();
          setOriginalWindowSize(currentSize);
        }

        // Set minimal mode constraints
        // Minimal mode: min width 400, min height 600; max width 800, max height unlimited
        if (window.electronAPI?.window?.setMinSize) {
          await window.electronAPI.window.setMinSize(400, 600);
        }
        if (window.electronAPI?.window?.setMaxSize) {
          await window.electronAPI.window.setMaxSize(800, 0); // 0 means no height limit
        }

        // Set minimal mode default size: width 600, height 800
        if (window.electronAPI?.window?.setSize) {
          await window.electronAPI.window.setSize(600, 800);
        }

        setMinimalMode(true);
      } else {
        // Exiting minimal mode

        // Restore normal mode constraints
        // Normal mode: keep existing settings minWidth: 800, minHeight: 600, no max limit
        if (window.electronAPI?.window?.setMinSize) {
          await window.electronAPI.window.setMinSize(800, 600);
        }
        if (window.electronAPI?.window?.setMaxSize) {
          await window.electronAPI.window.setMaxSize(0, 0); // 0 means no limit
        }

        // Restore original size or default
        if (window.electronAPI?.window?.setSize) {
          if (originalWindowSize) {
            await window.electronAPI.window.setSize(
              originalWindowSize.width,
              originalWindowSize.height,
            );
          } else {
            // Fallback to default size if original size is not available
            await window.electronAPI.window.setSize(1200, 800);
          }
        }

        setMinimalMode(false);
        setOriginalWindowSize(null);
      }
    } catch (error) {
      showError('Failed to resize window');
    }
  };

  return (
    <button
      className={`btn-action ${isMinimalMode ? 'active' : ''}`}
      onClick={onToggleMinimalMode}
      disabled={disabled}
      title={isMinimalMode ? "Exit minimal mode" : "Enter minimal mode"}
      aria-label={isMinimalMode ? "Exit minimal mode" : "Enter minimal mode"}
    >
      {isMinimalMode ? <Eye size={24} /> : <EyeOff size={24} />}
    </button>
  );
}

export default ChatViewHeader;