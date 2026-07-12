// src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx
// Custom view component for ad-hoc Sub-Agent tool calls.
// Real-time progress rendering — subscribes to subAgent:stateUpdate IPC, displays step list + LLM streaming text

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { ToolCallViewProps } from './types';
import { MessageHelper } from '@shared/types/chatTypes';
import type { SubAgentRuntimeState, SubAgentStep } from '../../../../main/lib/userDataADO/types/profile';
import { SubAgentTasksSidepaneAtom } from '../chat-side.atom';
import { useI18n } from '../../../lib/i18n/useI18n';

/**
 * Parse tool call argument JSON
 */
const parseArgs = (argsStr?: string): Record<string, unknown> => {
  if (!argsStr) return {};
  try {
    return JSON.parse(argsStr);
  } catch {
    return {};
  }
};

/**
 * Format duration to human-readable text
 */
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
};

/**
 * Format character count
 */
const formatSize = (chars: number): string => {
  if (chars < 1000) return `${chars} chars`;
  if (chars < 100000) return `${(chars / 1000).toFixed(1)}K`;
  return `${(chars / 1000).toFixed(0)}K`;
};

// ─────────────────────────────────────────────────────────────────────────────
// ElapsedTimer — Running Timer Hook
// ─────────────────────────────────────────────────────────────────────────────

const useElapsedTimer = (startTime: number | undefined, isRunning: boolean): string => {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isRunning || !startTime) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  if (!startTime) return '';
  const elapsed = Date.now() - startTime;
  return formatDuration(elapsed);
};

// ─────────────────────────────────────────────────────────────────────────────
// TurnProgressBar — Turn counter display (no max/budget)
// ─────────────────────────────────────────────────────────────────────────────

const TurnProgressBar: React.FC<{ current: number }> = ({ current }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-[10px] text-neutral-500 shrink-0 tabular-nums">
        {t('chat.tool.subAgent.turnPlain', { turn: current })}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StreamingTextDisplay — LLM Real-time Streaming Text Display
// ─────────────────────────────────────────────────────────────────────────────

const StreamingTextDisplay: React.FC<{ text: string; label?: string }> = ({ text, label }) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedLabel = label ?? t('chat.tool.subAgent.thinking');

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div className="mt-1.5 rounded overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-white/2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
        <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">{resolvedLabel}</span>
      </div>
      <div
        ref={containerRef}
        className="px-2.5 py-1.5 max-h-[120px] overflow-y-auto text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap scrollbar-thin"
      >
        {text}
        <span className="inline-block w-[2px] h-3.5 bg-primary-400 animate-pulse ml-0.5 align-text-bottom" />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SubAgentStepsList — Sub-Agent Steps List Sub-component (Enhanced)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sub-agent steps list component
 * Displays tool call progress — including tool argument summary, execution duration, result size
 *
 * Note: Backend SubAgentManager handles in-place replacement of tool_start → tool_done/tool_error,
 * so the frontend doesn't need to merge again — just filter and render directly.
 */
const SubAgentStepsList: React.FC<{ steps: SubAgentStep[] }> = ({ steps }) => {
  const { t } = useI18n();
  // Filter out non-tool type steps
  const toolSteps = useMemo(
    () => steps.filter(s => s.type === 'tool_start' || s.type === 'tool_done' || s.type === 'tool_error'),
    [steps]
  );

  if (toolSteps.length === 0) return null;

  return (
    <div className="flex flex-col gap-px">
      {toolSteps.map((step, idx) => (
        <div key={step.toolCallId || idx} className="flex items-start gap-1.5 text-xs leading-5 py-px group">
          {/* Status icon */}
          <span className="w-4 text-center shrink-0 pt-px">
            {step.type === 'tool_start' && (
              <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-primary-400 border-t-transparent rounded-full animate-spin" />
            )}
            {step.type === 'tool_done' && <span className="text-success-500 text-[11px]">✓</span>}
            {step.type === 'tool_error' && <span className="text-danger-400 text-[11px]">✗</span>}
          </span>

          {/* Tool name + args summary */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-neutral-400 truncate max-w-[160px]">
                {step.toolName}
              </span>
              {step.type === 'tool_start' && (
                <span className="text-neutral-600 text-[10px] animate-pulse">{t('chat.tool.subAgent.running')}</span>
              )}
              {step.type === 'tool_done' && step.durationMs != null && (
                <span className="text-neutral-600 text-[10px]">{formatDuration(step.durationMs)}</span>
              )}
              {step.type === 'tool_done' && step.toolResultLength != null && (
                <span className="text-neutral-600 text-[10px]">→ {formatSize(step.toolResultLength)}</span>
              )}
              {step.type === 'tool_error' && (
                <span className="text-danger-400/80 text-[10px]">{t('chat.tool.subAgent.failedLower')}</span>
              )}
            </div>
            {step.toolArgsSummary && (
              <div className="text-[10px] text-neutral-600 truncate mt-px leading-4">
                {step.toolArgsSummary}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SubAgentToolCallView — Single Task Display Component (with real-time progress + LLM streaming)
// ─────────────────────────────────────────────────────────────────────────────

export const SubAgentToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
  executionStatus,
}) => {
  const { t } = useI18n();
  // Step 1: Parse tool arguments
  const args = useMemo(() => parseArgs(toolCall.function.arguments), [toolCall.function.arguments]);

  const task = (args.prompt as string) || (args.task as string) || t('chat.tool.subAgent.noTaskDescription');
  const shareContext = args.share_context as boolean | undefined;
  const runInBackground = args.run_in_background as boolean | undefined;

  // Step 2: Real-time progress state
  const [runtimeState, setRuntimeState] = useState<SubAgentRuntimeState | null>(null);

  // Step 3: Remember final status (for accurate success/failure detection, replacing fragile string matching)
  const [finalStatus, setFinalStatus] = useState<'completed' | 'failed' | 'cancelled' | null>(null);

  // Step 4: Subscribe to subAgent:stateUpdate IPC, using toolCall.id as correlationId for precise matching
  // Also capture taskId for the "View Details" button
  const [taskId, setTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (toolResult) return;

    const cleanup = window.electronAPI.subAgent.onStateUpdate((state: SubAgentRuntimeState) => {
      if (state.correlationId === toolCall.id) {
        setRuntimeState(state);
        if (!taskId && state.taskId) {
          setTaskId(state.taskId);
        }
        if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
          setFinalStatus(state.status);
        }
      }
    });

    return cleanup;
  }, [toolCall.id, toolResult, taskId]);

  // Step 4b: Resolve taskId from backend for already-completed tool calls
  useEffect(() => {
    if (taskId) return;
    if (!toolCall.id) return;
    window.electronAPI.subAgentTask.resolveByCorrelationId(toolCall.id).then(result => {
      if (result.success && result.data) {
        setTaskId(result.data);
      }
    }).catch(() => { /* ignore */ });
  }, [toolCall.id, taskId]);

  // Step 5: Clear real-time state after tool execution completes
  useEffect(() => {
    if (toolResult) {
      setRuntimeState(null);
    }
  }, [toolResult]);

  // Step 6: Parse execution result text
  const resultText = useMemo(() => {
    if (!toolResult) return null;
    return MessageHelper.getText(toolResult);
  }, [toolResult]);

  // Step 7: Determine execution status
  const isRunning = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';
  const isSuccess = finalStatus === 'completed' || (resultText !== null && finalStatus === null);

  // Step 8: Running timer
  const elapsed = useElapsedTimer(runtimeState?.startTime, isRunning);

  // Step 9: Decide whether to show streamingText or lastTextSnippet
  const displayText = runtimeState?.streamingText || runtimeState?.lastTextSnippet;
  const isStreaming = !!runtimeState?.streamingText;

  // Step 10: Open task detail view in sidepane
  const [, sidepaneActions] = SubAgentTasksSidepaneAtom.use();
  const handleViewDetails = useCallback(() => {
    if (!taskId) return;
    sidepaneActions.show();
    sidepaneActions.selectTask(taskId);
  }, [taskId, sidepaneActions]);

  return (
    <div className="sub-agent-tool-call-view">
      {/* Header — Display turn progress + timer */}
      <div className="sub-agent-tool-header">
        <span className="sub-agent-tool-icon">⚡</span>
        <span className="sub-agent-tool-label">{t('chat.tool.subAgent.worker')}</span>
        {isRunning && elapsed && (
          <span className="text-[11px] text-neutral-500 tabular-nums shrink-0">{elapsed}</span>
        )}
        <span className={`sub-agent-status-badge ${isRunning ? 'running' : isSuccess ? 'success' : 'error'}`}>
          {isRunning
            ? runtimeState
              ? t('chat.tool.subAgent.turn', { turn: runtimeState.currentTurn })
              : t('chat.tool.subAgent.starting')
            : isInterrupted
              ? t('chat.tool.subAgent.interrupted')
              : isSuccess
              ? t('chat.tool.subAgent.done')
              : t('chat.tool.subAgent.failed')}
        </span>
        {taskId && (
          <button
            onClick={handleViewDetails}
            className="sub-agent-view-details-btn"
            title={t('chat.tool.subAgent.viewDetails')}
            type="button"
          >
            ↗
          </button>
        )}
      </div>

      {/* Task Description */}
      <div className="sub-agent-tool-task">
        <span className="sub-agent-task-label">{t('chat.tool.subAgent.task')}</span>
        <span className="sub-agent-task-text">{task}</span>
      </div>

      {/* Context Badge */}
      {shareContext && (
        <div className="sub-agent-context-badge">
          {t('chat.tool.subAgent.contextShared')}
        </div>
      )}
      {runInBackground && (
        <div className="sub-agent-context-badge" style={{ color: 'var(--color-indigo-500)' }}>
          {t('chat.tool.subAgent.runningBackground')}
        </div>
      )}
      {!runInBackground && toolResult && MessageHelper.getText(toolResult)?.includes('auto-promoted to background') && (
        <div className="sub-agent-context-badge" style={{ color: 'var(--color-warning-600)' }}>
          {t('chat.tool.subAgent.autoPromoted')}
        </div>
      )}

      {/* Real-time progress area */}
      {isRunning && runtimeState && (
        <div className="px-3 py-2 bg-white/3 border-l-2 border-primary-400 border-b border-b-(--border-color,var(--color-neutral-200))">
          {/* Turn progress bar */}
          <TurnProgressBar current={runtimeState.currentTurn} />

          {/* Tool call list */}
          {runtimeState.steps.length > 0 && (
            <div className="mt-2">
              <SubAgentStepsList steps={runtimeState.steps} />
            </div>
          )}

          {/* LLM real-time streaming text or recent text snippet */}
          {displayText && (
            isStreaming
              ? <StreamingTextDisplay text={displayText} />
              : (
                <div className="mt-1.5 px-2 py-1 text-xs text-neutral-400 whitespace-pre-wrap line-clamp-4 italic leading-relaxed">
                  💬 {displayText}
                </div>
              )
          )}
        </div>
      )}

      {/* Result */}
      {resultText && (
        <div className="sub-agent-tool-result">
          <div className="sub-agent-result-divider">{t('chat.tool.subAgent.result')}</div>
          <div className="sub-agent-result-content">
            <pre className="sub-agent-result-pre">{resultText}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubAgentToolCallView;
