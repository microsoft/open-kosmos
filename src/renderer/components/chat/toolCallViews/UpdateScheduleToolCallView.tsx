// src/renderer/components/chat/toolCallViews/UpdateScheduleToolCallView.tsx
// Custom view component for the Update Schedule tool call - shows the updated schedule card

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { ToolCallViewProps, UpdateScheduleToolArgs, UpdateScheduleToolResult } from './types';
import { MessageHelper } from '@shared/types/chatTypes';
import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions';
import { useCurrentChatId } from '../../../lib/chat/agentChatSessionCacheManager';

const parseToolArgs = (argsStr?: string): UpdateScheduleToolArgs | null => {
  if (!argsStr) return null;
  try {
    return JSON.parse(argsStr);
  } catch {
    return null;
  }
};

const parseToolResult = (content: string): UpdateScheduleToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export const UpdateScheduleToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
  executionStatus,
}) => {
  const navigate = useNavigate();
  const currentChatId = useCurrentChatId();
  const args = parseToolArgs(toolCall.function.arguments);
  const resultText = toolResult ? MessageHelper.getText(toolResult) : '';
  const result = resultText ? parseToolResult(resultText) : null;

  if (!args) return null;

  const isExecuting = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';
  const isSuccess = result?.success === true;
  const job = result?.job;
  const targetAgentId = job?.agent_id || currentChatId;

  // Use result job data when available, fall back to args for the executing state
  const displayName = job?.name || args.name || 'Scheduled Task';
  const displayCron = job?.cron_expression || args.cron_expression;
  const displayMessage = job?.message || args.message;
  const displayDescription = job?.description || args.description;

  return (
    <div className="create-schedule-view">
      <div className="schedule-card">
        {/* Card header */}
        <div className="schedule-card-header">
          <div className="schedule-card-icon">
            <Pencil size={18} />
          </div>
          <div className="schedule-card-title">
            {displayName}
          </div>
          <button
            className="schedule-card-link"
            onClick={() => {
              if (targetAgentId) {
                navigate(`/agent/chat/${targetAgentId}/settings/schedules`);
              }
            }}
            title={targetAgentId ? 'Open target agent schedules' : 'Agent schedules unavailable'}
            disabled={!targetAgentId}
          >
            <ExternalLink size={14} />
          </button>
          <div className="schedule-card-status">
            {isExecuting && <Loader2 size={16} className="schedule-spinner" />}
            {!isExecuting && isSuccess && <CheckCircle2 size={16} className="schedule-status-success" />}
            {!isExecuting && !isSuccess && <XCircle size={16} className="schedule-status-error" />}
          </div>
        </div>

        {/* Description */}
        {displayDescription && (
          <div className="schedule-card-description">
            {displayDescription}
          </div>
        )}

        {isInterrupted && (
          <div className="schedule-card-description">
            Interrupted before schedule update result was recorded.
          </div>
        )}

        {/* Error message on failure */}
        {!isExecuting && !isSuccess && result?.message && (
          <div className="schedule-card-description">
            {result.message}
          </div>
        )}

        {/* Fields */}
        <div className="schedule-card-fields">
          {displayCron && (
            <div className="schedule-field">
              <span className="schedule-field-label">Schedule</span>
              <span className="schedule-field-value">{describeCronExpression(displayCron)}</span>
            </div>
          )}
          {displayMessage && (
            <div className="schedule-field">
              <span className="schedule-field-label">Prompt</span>
              <span className="schedule-field-value schedule-field-message">{displayMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateScheduleToolCallView;
