// src/renderer/components/chat/toolCallViews/GetScheduleToolCallView.tsx
// Custom view component for the Get Schedule tool call - shows a list of schedules

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { ToolCallViewProps, GetScheduleToolArgs, GetScheduleToolResult } from './types';
import { MessageHelper } from '@shared/types/chatTypes';
import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions';
import { useCurrentChatId } from '../../../lib/chat/agentChatSessionCacheManager';
import { useI18n } from '../../../lib/i18n/useI18n';
import type { TranslationKey, TranslationParams } from '../../../lib/i18n';

const parseToolArgs = (argsStr?: string): GetScheduleToolArgs | null => {
  if (!argsStr) return null;
  try {
    return JSON.parse(argsStr);
  } catch {
    return null;
  }
};

const parseToolResult = (content: string): GetScheduleToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const formatRunAt = (
  runAt: string | undefined,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string => {
  if (!runAt) return t('chat.schedule.oneTimeSchedule');
  try {
    return t('chat.schedule.oneTimeAt', { time: new Date(runAt).toLocaleString() });
  } catch {
    return t('chat.schedule.oneTimeAt', { time: runAt });
  }
};

const getUniqueChatIds = (schedules: NonNullable<GetScheduleToolResult['schedules']>): string[] => (
  Array.from(new Set(schedules.map((schedule) => schedule.chat_id).filter(Boolean)))
);

export const GetScheduleToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
  executionStatus,
}) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const currentChatId = useCurrentChatId();
  const args = parseToolArgs(toolCall.function.arguments);
  const resultText = toolResult ? MessageHelper.getText(toolResult) : '';
  const result = resultText ? parseToolResult(resultText) : null;

  const isExecuting = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';
  const isSuccess = result?.success === true;
  const schedules = result?.schedules || [];
  const uniqueChatIds = getUniqueChatIds(schedules);
  const singleTargetChatId = args?.chat_id || (uniqueChatIds.length === 1 ? uniqueChatIds[0] : undefined) || currentChatId;
  const shouldUsePerScheduleLinks = !args?.chat_id && uniqueChatIds.length > 1;

  return (
    <div className="create-schedule-view">
      <div className="schedule-card">
        {/* Card header */}
        <div className="schedule-card-header">
          <div className="schedule-card-icon">
            <Clock size={18} />
          </div>
          <div className="schedule-card-title">
            {args?.chat_id ? t('chat.schedule.agentSchedules') : t('chat.schedule.allSchedules')}
          </div>
          <button
            className="schedule-card-link"
            onClick={() => {
              if (singleTargetChatId && !shouldUsePerScheduleLinks) {
                navigate(`/agent/chat/${singleTargetChatId}/settings/schedules`);
              }
            }}
            title={
              shouldUsePerScheduleLinks
                ? t('chat.schedule.openFromOwnAgentRow')
                : singleTargetChatId
                  ? t('chat.schedule.openRelatedAgentSchedules')
                  : t('chat.schedule.unavailable')
            }
            disabled={!singleTargetChatId || shouldUsePerScheduleLinks}
          >
            <ExternalLink size={14} />
          </button>
          <div className="schedule-card-status">
            {isExecuting && <Loader2 size={16} className="schedule-spinner" />}
            {!isExecuting && isSuccess && <CheckCircle2 size={16} className="schedule-status-success" />}
            {!isExecuting && !isSuccess && <XCircle size={16} className="schedule-status-error" />}
          </div>
        </div>

        {/* Result summary */}
        {!isExecuting && (
          <div className="schedule-card-description">
            {isInterrupted ? t('chat.schedule.queryInterrupted') : result?.message}
          </div>
        )}

        {/* Schedule list */}
        {schedules.length > 0 && (
          <div className="schedule-card-fields">
            {schedules.map((s) => (
              <div key={s.job_id} className="schedule-field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
                <span className="schedule-field-label" style={{
                  minWidth: 'unset',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  {s.name}
                  {!s.enabled && (
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--color-neutral-400)',
                      backgroundColor: 'var(--color-neutral-100)',
                      padding: '0 5px',
                      borderRadius: '3px',
                    }}>{t('chat.schedule.disabledStatus')}</span>
                  )}
                </span>
                <span className="schedule-field-value" style={{ fontSize: '12px' }}>
                  {s.schedule_type === 'once'
                    ? formatRunAt(s.run_at, t)
                    : describeCronExpression(s.cron_expression)}
                  {' '}
                  &middot; {s.message}
                </span>
                {shouldUsePerScheduleLinks && (
                  <button
                    type="button"
                    className="schedule-inline-link"
                    onClick={() => navigate(`/agent/chat/${s.chat_id}/settings/schedules`)}
                  >
                    {t('chat.schedule.openAgent')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GetScheduleToolCallView;
