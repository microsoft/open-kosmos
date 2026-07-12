import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Play, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SchedulerJob } from '@shared/ipc/scheduler';

import { schedulerApi } from '../../../ipc/scheduler';
import { useCurrentChatId } from '../../../lib/chat/agentChatSessionCacheManager';
import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions';
import { showScheduledRunStartedToast } from '../../../lib/scheduler/showScheduledRunStartedToast';
import { useToast } from '../../ui/ToastProvider';
import { ScheduleSidepaneAtom } from '../chat-side.atom';
import { useI18n } from '../../../lib/i18n/useI18n';

interface GeneratedScheduleCardsProps {
  scheduleIds: string[];
}

const formatRunSummary = (job: SchedulerJob | undefined, fallback: string): string => {
  if (!job) {
    return fallback;
  }

  if (job.scheduleType === 'once' && job.runAt) {
    const timestamp = Date.parse(job.runAt);
    if (!Number.isNaN(timestamp)) {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(timestamp));
    }
  }

  if (job.scheduleType === 'cron' && job.cronExpression) {
    return describeCronExpression(job.cronExpression);
  }

  return fallback;
};

export const GeneratedScheduleCards: React.FC<GeneratedScheduleCardsProps> = ({ scheduleIds }) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { showToast, showSuccess, showError } = useToast();
  const currentChatId = useCurrentChatId();
  const [jobsById, setJobsById] = useState<Record<string, SchedulerJob>>({});
  const [loading, setLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const effectiveChatId = currentChatId || undefined;

  const normalizedScheduleIds = useMemo(
    () => Array.from(new Set(scheduleIds.map((scheduleId) => scheduleId.trim()).filter(Boolean))),
    [scheduleIds],
  );

  useEffect(() => {
    if (normalizedScheduleIds.length === 0) {
      setJobsById({});
      return;
    }

    let mounted = true;
    setLoading(true);

    void (async () => {
      try {
        const response = await schedulerApi.listJobs();
        if (!mounted) {
          return;
        }

        if (response?.success && response.data) {
          const nextJobsById: Record<string, SchedulerJob> = {};
          response.data.forEach((job) => {
            if (normalizedScheduleIds.includes(job.id)) {
              nextJobsById[job.id] = job;
            }
          });
          setJobsById(nextJobsById);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [normalizedScheduleIds]);

  const scheduleSidepaneActions = ScheduleSidepaneAtom.useChange();
  const handleRunNow = useCallback(async (jobId: string) => {
    try {
      setRunningJobId(jobId);
      const response = await schedulerApi.runJobNow(jobId);
      if (response?.success) {
        showScheduledRunStartedToast({
          result: response.data,
          chatId: jobsById[jobId]?.chat_id,
          navigate,
          showToast,
          showSuccess,
          t,
        });
        scheduleSidepaneActions.effectiveShow();
        return;
      }

      showError(t('chat.schedule.runFailed', { error: response?.error || t('common.unknownError') }));
    } catch (error) {
      showError(t('chat.schedule.runFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setRunningJobId((current) => (current === jobId ? null : current));
    }
  }, [jobsById, navigate, showError, showSuccess, showToast, t]);

  const handleManage = useCallback(() => {
    if (!effectiveChatId) {
      showError(t('chat.schedule.openFailed'));
      return;
    }

    navigate(`/agent/chat/${effectiveChatId}/settings/schedules`);
  }, [effectiveChatId, navigate, showError, t]);

  if (normalizedScheduleIds.length === 0) {
    return null;
  }

  return (
    <div className="message-schedule-cards">
      {normalizedScheduleIds.map((scheduleId) => {
        const job = jobsById[scheduleId];
        const isRunning = runningJobId === scheduleId;

        return (
          <div key={scheduleId} className="message-schedule-card">
            <div className="message-schedule-card-header">
              <div className="message-schedule-card-title-group">
                <span className="message-schedule-card-icon">
                  <CalendarClock size={18} strokeWidth={1.8} />
                </span>
                <div className="message-schedule-card-copy">
                  <span className="message-schedule-card-label">{t('chat.schedule.cardLabel')}</span>
                  <span className="message-schedule-card-title">{job?.name || t('chat.schedule.defaultTaskSentence')}</span>
                </div>
              </div>
              {loading && !job && (
                <Loader2 size={14} className="message-schedule-card-loading" />
              )}
            </div>

            <div className="message-schedule-card-body">
              <div className="message-schedule-card-row">
                <span className="message-schedule-card-row-label">{t('chat.schedule.runs')}</span>
                <span className="message-schedule-card-row-value">{formatRunSummary(job, t('chat.schedule.foundInResponse'))}</span>
              </div>
              <div className="message-schedule-card-row">
                <span className="message-schedule-card-row-label">{t('chat.schedule.jobId')}</span>
                <span className="message-schedule-card-id">{scheduleId}</span>
              </div>
            </div>

            <div className="message-schedule-card-actions">
              <button
                type="button"
                className="message-schedule-card-button secondary"
                onClick={() => handleRunNow(scheduleId)}
                disabled={isRunning || !job}
              >
                {isRunning ? <Loader2 size={14} className="message-schedule-card-button-spinner" /> : <Play size={14} strokeWidth={2} />}
                {t('chat.schedule.runNow')}
              </button>
              <button
                type="button"
                className="message-schedule-card-button primary"
                onClick={handleManage}
                disabled={!effectiveChatId}
              >
                <Settings2 size={14} strokeWidth={2} />
                {t('common.manage')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default GeneratedScheduleCards;
