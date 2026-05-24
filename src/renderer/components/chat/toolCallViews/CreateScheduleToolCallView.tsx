// src/renderer/components/chat/toolCallViews/CreateScheduleToolCallView.tsx
// Custom view component for the Create Schedule tool call - calendar card style

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { ToolCallViewProps, CreateScheduleToolArgs, CreateScheduleToolResult } from './types';
import { MessageHelper } from '@shared/types/chatTypes';
import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions';
import { useCurrentChatId } from '../../../lib/chat/agentChatSessionCacheManager';

/**
 * Parse tool call arguments
 */
const parseToolArgs = (argsStr?: string): CreateScheduleToolArgs | null => {
  if (!argsStr) return null;
  try {
    return JSON.parse(argsStr);
  } catch {
    return null;
  }
};

/**
 * Parse tool result content
 */
const parseToolResult = (content: string): CreateScheduleToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Create Schedule Tool Call custom view
 */
export const CreateScheduleToolCallView: React.FC<ToolCallViewProps> = ({
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
  const targetAgentId = args.agent_id || currentChatId;

  return (
    <div className="create-schedule-view">
      <div className="schedule-card">
        {/* Card header */}
        <div className="schedule-card-header">
          <div className="schedule-card-icon">
            <Clock size={18} />
          </div>
          <div className="schedule-card-title">
            {args.name || 'Scheduled Task'}
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

        {isInterrupted && (
          <div className="schedule-card-description">
            Interrupted before schedule creation result was recorded.
          </div>
        )}

        {/* Description */}
        {args.description && (
          <div className="schedule-card-description">
            {args.description}
          </div>
        )}

        {/* Fields */}
        <div className="schedule-card-fields">
          {args.cron_expression && (
            <div className="schedule-field">
              <span className="schedule-field-label">Schedule</span>
              <span className="schedule-field-value">{describeCronExpression(args.cron_expression)}</span>
            </div>
          )}
          {args.message && (
            <div className="schedule-field">
              <span className="schedule-field-label">Prompt</span>
              <span className="schedule-field-value schedule-field-message">{args.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateScheduleToolCallView;
