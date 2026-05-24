// src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx
// Custom view component for Sub-Agent tool calls — single task + parallel task display
// Real-time progress rendering — subscribes to subAgent:stateUpdate IPC, displays step list + LLM streaming text

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { ToolCallViewProps } from './types';
import { MessageHelper } from '@shared/types/chatTypes';
import type { SubAgentRuntimeState, SubAgentStep } from '../../../../main/lib/userDataADO/types/profile';
import { SubAgentTasksSidepaneAtom } from '../chat-side.atom';

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
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums">
        Turn {current}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StreamingTextDisplay — LLM Real-time Streaming Text Display
// ─────────────────────────────────────────────────────────────────────────────

const StreamingTextDisplay: React.FC<{ text: string; label?: string }> = ({ text, label = '💭 Thinking' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  if (!text) return null;

  return (
    <div className="mt-1.5 rounded overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-white/2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div
        ref={containerRef}
        className="px-2.5 py-1.5 max-h-[120px] overflow-y-auto text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap scrollbar-thin"
      >
        {text}
        <span className="inline-block w-[2px] h-3.5 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
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
const SubAgentStepsList: React.FC<{ steps: SubAgentStep[]; compact?: boolean }> = ({ steps, compact = false }) => {
  // Filter out non-tool type steps
  const toolSteps = useMemo(
    () => steps.filter(s => s.type === 'tool_start' || s.type === 'tool_done' || s.type === 'tool_error'),
    [steps]
  );

  if (toolSteps.length === 0) return null;

  // Compact mode shows only the latest 3
  const visibleSteps = compact ? toolSteps.slice(-3) : toolSteps;
  const hiddenCount = compact ? Math.max(0, toolSteps.length - 3) : 0;

  return (
    <div className="flex flex-col gap-px">
      {hiddenCount > 0 && (
        <div className="text-[10px] text-zinc-600 pl-5 py-0.5">
          ... {hiddenCount} earlier step{hiddenCount > 1 ? 's' : ''}
        </div>
      )}
      {visibleSteps.map((step, idx) => (
        <div key={step.toolCallId || idx} className="flex items-start gap-1.5 text-xs leading-5 py-px group">
          {/* Status icon */}
          <span className="w-4 text-center shrink-0 pt-px">
            {step.type === 'tool_start' && (
              <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
            {step.type === 'tool_done' && <span className="text-emerald-500 text-[11px]">✓</span>}
            {step.type === 'tool_error' && <span className="text-red-400 text-[11px]">✗</span>}
          </span>

          {/* Tool name + args summary */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-zinc-400 truncate max-w-[160px]">
                {step.toolName}
              </span>
              {step.type === 'tool_start' && (
                <span className="text-zinc-600 text-[10px] animate-pulse">running...</span>
              )}
              {step.type === 'tool_done' && step.durationMs != null && (
                <span className="text-zinc-600 text-[10px]">{formatDuration(step.durationMs)}</span>
              )}
              {step.type === 'tool_done' && step.toolResultLength != null && (
                <span className="text-zinc-600 text-[10px]">→ {formatSize(step.toolResultLength)}</span>
              )}
              {step.type === 'tool_error' && (
                <span className="text-red-400/80 text-[10px]">failed</span>
              )}
            </div>
            {/* Tool args summary - show on hover or always in non-compact mode */}
            {step.toolArgsSummary && !compact && (
              <div className="text-[10px] text-zinc-600 truncate mt-px leading-4">
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
  // Step 1: Parse tool arguments
  const args = useMemo(() => parseArgs(toolCall.function.arguments), [toolCall.function.arguments]);

  const subAgentName = (args.sub_agent_name as string) || (args.subagent_type as string) || 'Unknown';
  const task = (args.task as string) || (args.prompt as string) || 'No task description';
  const shareContext = args.share_context as boolean | undefined;
  const runInBackground = args.run_in_background as boolean | undefined;
  const isAdhoc = toolCall.function.name === 'spawn_adhoc_subagent' || (toolCall.function.name === 'sub_agent' && !args.subagent_type);

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
  const isError = finalStatus === 'failed' || finalStatus === 'cancelled';

  // Step 8: Running timer
  const elapsed = useElapsedTimer(runtimeState?.startTime, isRunning);

  // Step 9: Check if any tool is currently running (steps contain tool_start type)
  const hasRunningTool = useMemo(
    () => runtimeState?.steps?.some(s => s.type === 'tool_start') ?? false,
    [runtimeState?.steps]
  );

  // Step 10: Decide whether to show streamingText or lastTextSnippet
  const displayText = runtimeState?.streamingText || runtimeState?.lastTextSnippet;
  const isStreaming = !!runtimeState?.streamingText;

  // Step 11: Open task detail view in sidepane
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
        <span className="sub-agent-tool-icon">{isAdhoc ? '⚡' : '🤖'}</span>
        <span className="sub-agent-tool-label">
          {isAdhoc ? 'Ad-hoc Worker' : <>Sub-Agent: <strong>{subAgentName}</strong></>}
        </span>
        {isRunning && elapsed && (
          <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">{elapsed}</span>
        )}
        <span className={`sub-agent-status-badge ${isRunning ? 'running' : isSuccess ? 'success' : 'error'}`}>
          {isRunning
            ? runtimeState
              ? `⏳ Turn ${runtimeState.currentTurn}`
              : '⏳ Starting...'
            : isInterrupted
              ? '⚠ Interrupted'
              : isSuccess
              ? '✅ Done'
              : '❌ Failed'}
        </span>
        {taskId && (
          <button
            onClick={handleViewDetails}
            className="sub-agent-view-details-btn"
            title="View task details"
            type="button"
          >
            ↗
          </button>
        )}
      </div>

      {/* Task Description */}
      <div className="sub-agent-tool-task">
        <span className="sub-agent-task-label">Task:</span>
        <span className="sub-agent-task-text">{task}</span>
      </div>

      {/* Context Badge */}
      {shareContext && (
        <div className="sub-agent-context-badge">
          📋 Context shared with sub-agent
        </div>
      )}
      {runInBackground && (
        <div className="sub-agent-context-badge" style={{ color: '#6366f1' }}>
          🔄 Running in background
        </div>
      )}
      {!runInBackground && toolResult && MessageHelper.getText(toolResult)?.includes('auto-promoted to background') && (
        <div className="sub-agent-context-badge" style={{ color: '#d97706' }}>
          ⏱️ Auto-promoted to background (120s)
        </div>
      )}

      {/* Real-time progress area */}
      {isRunning && runtimeState && (
        <div className="px-3 py-2 bg-white/3 border-l-2 border-blue-400 border-b border-b-(--border-color,#e5e7eb)">
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
                <div className="mt-1.5 px-2 py-1 text-xs text-zinc-400 whitespace-pre-wrap line-clamp-4 italic leading-relaxed">
                  💬 {displayText}
                </div>
              )
          )}
        </div>
      )}

      {/* Result */}
      {resultText && (
        <div className="sub-agent-tool-result">
          <div className="sub-agent-result-divider">Result</div>
          <div className="sub-agent-result-content">
            <pre className="sub-agent-result-pre">{resultText}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ParallelSubAgentsToolCallView — Parallel Task Display Component (with real-time progress)
// ─────────────────────────────────────────────────────────────────────────────

export const ParallelSubAgentsToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
  executionStatus,
}) => {
  // Step 1: Parse arguments
  const args = useMemo(() => parseArgs(toolCall.function.arguments), [toolCall.function.arguments]);

  const tasks: Array<{ sub_agent_name: string; task: string }> = (args.tasks as Array<{ sub_agent_name: string; task: string }>) || [];

  // Step 2: Real-time progress state — indexed by correlationId
  const [stateMap, setStateMap] = useState<Map<string, SubAgentRuntimeState>>(new Map());
  // Track taskIds by correlationId for the "View Details" button
  const [taskIdMap, setTaskIdMap] = useState<Map<string, string>>(new Map());
  const [, sidepaneActions] = SubAgentTasksSidepaneAtom.use();

  useEffect(() => {
    if (toolResult) return;

    const cleanup = window.electronAPI.subAgent.onStateUpdate((state: SubAgentRuntimeState) => {
      if (state.correlationId?.startsWith(toolCall.id + '_')) {
        setStateMap(prev => {
          const next = new Map(prev);
          next.set(state.correlationId!, state);
          return next;
        });
        if (state.taskId && state.correlationId) {
          setTaskIdMap(prev => {
            if (prev.has(state.correlationId!)) return prev;
            const next = new Map(prev);
            next.set(state.correlationId!, state.taskId);
            return next;
          });
        }
      }
    });

    return cleanup;
  }, [toolCall.id, toolResult]);

  // Resolve taskIds for already-completed parallel tasks
  useEffect(() => {
    if (!toolCall.id) return;
    tasks.forEach((_task, index) => {
      const correlationId = `${toolCall.id}_${index}`;
      if (taskIdMap.has(correlationId)) return;
      window.electronAPI.subAgentTask.resolveByCorrelationId(correlationId).then(result => {
        if (result.success && result.data) {
          setTaskIdMap(prev => {
            const next = new Map(prev);
            next.set(correlationId, result.data!);
            return next;
          });
        }
      }).catch(() => { /* ignore */ });
    });
  }, [toolCall.id, tasks.length, taskIdMap]);

  // Step 3: Parse parallel results
  const resultText = useMemo(() => {
    if (!toolResult) return null;
    return MessageHelper.getText(toolResult);
  }, [toolResult]);

  // Step 4: Split result text into individual task results by "### Task N:" headers
  const taskResults = useMemo(() => {
    if (!resultText) return [];
    const taskHeaderRegex = /### Task \d+:/g;
    const indices: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = taskHeaderRegex.exec(resultText)) !== null) {
      indices.push(match.index);
    }
    if (indices.length === 0) return [];
    return indices.map((start, i) => {
      const end = i + 1 < indices.length ? indices[i + 1] : resultText.length;
      const section = resultText.slice(start, end).replace(/\n{1,2}---\s*$/, '').trim();
      const statusMatch = section.match(/\*\*Status\*\*:\s*(.*)/);
      const durationMatch = section.match(/\*\*Duration\*\*:\s*(\d+)ms/);
      return {
        text: section,
        isSuccess: statusMatch?.[1]?.includes('Completed') ?? false,
        durationMs: durationMatch ? parseInt(durationMatch[1]) : undefined,
      };
    });
  }, [resultText]);

  const isRunning = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';

  // Step 5: Count completed tasks
  const completedCount = useMemo(() => {
    let count = 0;
    stateMap.forEach(s => {
      if (s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled') count++;
    });
    return count;
  }, [stateMap]);

  return (
    <div className="parallel-sub-agents-tool-call-view">
      {/* Header */}
      <div className="sub-agent-tool-header">
        <span className="sub-agent-tool-icon">🤖</span>
        <span className="sub-agent-tool-label">
          Parallel Sub-Agents ({tasks.length} tasks)
        </span>
        <span className={`sub-agent-status-badge ${isRunning ? 'running' : 'done'}`}>
          {isRunning
            ? stateMap.size > 0
              ? `⏳ ${completedCount}/${tasks.length} done`
              : '⏳ Starting...'
            : isInterrupted
              ? '⚠ Interrupted'
              : '✅ All Done'}
        </span>
      </div>

      {/* Task Cards */}
      <div className="parallel-tasks-list">
        {tasks.map((task, index) => {
          const correlationId = `${toolCall.id}_${index}`;
          const taskState = stateMap.get(correlationId);
          const taskResult = taskResults[index];
          const displayText = taskState?.streamingText || taskState?.lastTextSnippet;
          const isTaskStreaming = !!taskState?.streamingText;

          return (
            <div key={index} className="parallel-task-card">
              <div className="parallel-task-header">
                <strong>{task.sub_agent_name}</strong>
                {taskResult && (
                  <span className={`parallel-task-status ${taskResult.isSuccess ? 'success' : 'error'}`}>
                    {taskResult.isSuccess ? '✅' : '❌'}
                    {taskResult.durationMs && ` ${formatDuration(taskResult.durationMs)}`}
                  </span>
                )}
                {!taskResult && isRunning && (
                  <span className="parallel-task-status running">
                    {taskState
                      ? `⏳ Turn ${taskState.currentTurn}`
                      : '⏳'}
                  </span>
                )}
                {taskIdMap.get(correlationId) && (
                  <button
                    onClick={() => {
                      const tid = taskIdMap.get(correlationId);
                      if (tid) { sidepaneActions.show(); sidepaneActions.selectTask(tid); }
                    }}
                    className="sub-agent-view-details-btn"
                    title="View task details"
                    type="button"
                  >
                    ↗
                  </button>
                )}
              </div>
              <div className="parallel-task-description">{task.task}</div>

              {/* Progress bar + step list + LLM streaming text */}
              {isRunning && taskState && (
                <div className="mt-1.5 px-2 py-1.5 bg-white/3 rounded border-l-2 border-blue-400">
                  <TurnProgressBar current={taskState.currentTurn} />
                  {taskState.steps.length > 0 && (
                    <div className="mt-1">
                      <SubAgentStepsList steps={taskState.steps} compact />
                    </div>
                  )}
                  {displayText && (
                    isTaskStreaming
                      ? <StreamingTextDisplay text={displayText} />
                      : (
                        <div className="mt-1 text-[11px] text-zinc-400 line-clamp-2 italic leading-relaxed">
                          💬 {displayText}
                        </div>
                      )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Combined Results (collapsible) */}
      {resultText && (
        <details className="parallel-results-details">
          <summary>View detailed results</summary>
          <div className="parallel-results-content">
            <pre className="sub-agent-result-pre">{resultText}</pre>
          </div>
        </details>
      )}
    </div>
  );
};

export default SubAgentToolCallView;
