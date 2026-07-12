import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { ChatSession } from '../../lib/userData/types';
import { useI18n } from '../../lib/i18n/useI18n';
import {
  getScheduledSessionDisplayState,
  getScheduledSessionInterruptionReason,
} from './SchedulesSidepane.utils';

interface ScheduleSessionListItemProps {
  session: ChatSession;
  isActive: boolean;
  isUnread: boolean;
  isMenuOpen: boolean;
  onSelectSession?: (sessionId: string) => void | Promise<void>;
  onOpenMenu?: (session: ChatSession, trigger: HTMLDivElement) => void;
}

const formatTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ExecutingIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      animation: 'spin 1s linear infinite',
      display: 'block',
    }}
  >
    <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2" />
    <path
      d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19"
      stroke="var(--color-warm-900)"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const CompletedIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <path
      d="M0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10Z"
      fill="var(--color-warm-900)"
    />
    <mask
      id="schedule-sidepane-completed-icon-mask"
      style={{ maskType: 'alpha' }}
      maskUnits="userSpaceOnUse"
      x="4"
      y="4"
      width="12"
      height="12"
    >
      <path
        d="M13.765 7.20474C14.0661 7.48915 14.0797 7.96383 13.7953 8.26497L9.54526 12.765C9.40613 12.9123 9.21332 12.997 9.01071 12.9999C8.8081 13.0028 8.61295 12.9236 8.46967 12.7803L6.21967 10.5303C5.92678 10.2374 5.92678 9.76257 6.21967 9.46967C6.51256 9.17678 6.98744 9.17678 7.28033 9.46967L8.98463 11.174L12.7047 7.23503C12.9891 6.9339 13.4638 6.92033 13.765 7.20474Z"
        fill="var(--color-neutral-800)"
      />
    </mask>
    <g mask="url(#schedule-sidepane-completed-icon-mask)">
      <rect width="12" height="12" transform="translate(4 4)" fill="var(--color-warm-200)" />
    </g>
  </svg>
);

const InterruptedIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <circle cx="10" cy="10" r="9" fill="var(--color-danger-50)" stroke="var(--color-danger-600)" strokeWidth="2" />
    <path
      d="M10 5.75V10.25"
      stroke="var(--color-danger-700)"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <circle cx="10" cy="13.5" r="1" fill="var(--color-danger-700)" />
  </svg>
);

const ScheduleSessionListItem: React.FC<ScheduleSessionListItemProps> = ({
  session,
  isActive,
  isUnread,
  isMenuOpen,
  onSelectSession,
  onOpenMenu,
}) => {
  const { t } = useI18n();
  const executionState = getScheduledSessionDisplayState(session);
  const isExecuting = executionState === 'running';
  const isFailed = executionState === 'failed';
  const isInterrupted = executionState === 'interrupted';
  const isProblemState = isFailed || isInterrupted;
  const interruptedReason = isInterrupted ? getScheduledSessionInterruptionReason(session) : undefined;
  const displayTime = isProblemState
    ? session.schedulerCompletedAt || session.last_updated
    : session.last_updated;
  const problemStatusText = isInterrupted
    ? interruptedReason
      ? t('sidepane.schedules.interruptedWithReason', { reason: interruptedReason })
      : t('sidepane.schedules.interrupted')
    : isFailed
      ? session.schedulerError
        ? t('sidepane.schedules.failedWithError', { error: session.schedulerError })
        : t('sidepane.schedules.failed')
      : undefined;
  const titleColor = isUnread ? 'var(--color-warm-900)' : 'var(--color-neutral-500)';
  const titleFontWeight = isUnread ? 600 : 410;

  return (
    <button
      type="button"
      onClick={() => {
        onSelectSession?.(session.chatSession_id);
      }}
      title={session.title}
      className={`chat-session-item sidepane-list-card schedule-session-list-item${isMenuOpen ? ' menu-open' : ''}`}
      style={{
        width: '100%',
        border: 'none',
        borderRadius: '12px',
        padding: '12px',
        background: isActive ? 'rgba(0, 0, 0, 0.06)' : 'var(--color-white)',
        cursor: 'pointer',
        opacity: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '6px',
        boxSizing: 'border-box',
        textAlign: 'left',
        position: 'relative',
      }}
      data-read-status={session.readStatus || 'read'}
      onMouseEnter={(event) => {
        if (!isActive) {
          event.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        }
        const moreBtn = event.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
        if (moreBtn) {
          moreBtn.style.opacity = '1';
        }
      }}
      onMouseLeave={(event) => {
        if (!isActive) {
          event.currentTarget.style.backgroundColor = 'var(--color-white)';
        }
        if (!isMenuOpen) {
          const moreBtn = event.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
          if (moreBtn) {
            moreBtn.style.opacity = '0';
          }
        }
      }}
    >
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div
          style={{
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isExecuting ? <ExecutingIcon /> : isProblemState ? <InterruptedIcon /> : <CompletedIcon />}
        </div>
        <span
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: '14px',
            fontWeight: titleFontWeight,
            color: titleColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.title}
        </span>
        <div
          className="chat-session-more-btn"
          onClick={(event) => {
            event.stopPropagation();
            const trigger = event.currentTarget as HTMLDivElement;
            trigger.dataset.scheduleRunning = isExecuting ? 'true' : 'false';
            trigger.dataset.scheduleRetryable = isFailed || isInterrupted ? 'true' : 'false';
            trigger.dataset.scheduleJobId = session.schedulerJobId || '';
            onOpenMenu?.(session, trigger);
          }}
          style={{
            opacity: isMenuOpen ? '1' : '0',
            marginLeft: 'auto',
          }}
          title={t('common.moreOptions')}
        >
          <MoreHorizontal size={20} strokeWidth={1.5} />
        </div>
      </div>
      <span
        style={{
          fontSize: '12px',
          color: isUnread && !isProblemState ? 'var(--color-neutral-700)' : 'var(--color-neutral-500)',
          paddingLeft: '28px',
          fontWeight: isUnread ? 600 : 400,
        }}
      >
        {formatTime(displayTime)}
      </span>
      {problemStatusText && (
        <span
          style={{
            fontSize: '12px',
            color: 'var(--color-danger-700)',
            paddingLeft: '28px',
            fontWeight: isUnread ? 600 : 400,
          }}
        >
          {problemStatusText}
        </span>
      )}
    </button>
  );
};

export default ScheduleSessionListItem;
