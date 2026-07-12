// src/renderer/components/chat/toolCallViews/CodingAgentToolCallView.tsx
// Coding Agent tool call view - terminal-style rendering of CLI coding agent output

import React, { useRef, useEffect } from 'react';
import { ToolCallViewProps, CodingAgentToolArgs, CodingAgentToolResult } from './types';
import { MessageHelper } from '@shared/types/chatTypes';
import { CODING_CLI_DISPLAY_NAMES, CodingCliId } from '@shared/types/codingCli';
import { useI18n } from '../../../lib/i18n/useI18n';

const parseArgs = (argsStr?: string): CodingAgentToolArgs | null => {
  if (!argsStr) return null;
  try { return JSON.parse(argsStr); } catch { return null; }
};

const parseResult = (content: string): CodingAgentToolResult | null => {
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
};

export const CodingAgentToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
  executionStatus,
}) => {
  const { t } = useI18n();
  const outputRef = useRef<HTMLPreElement>(null);
  const args = parseArgs(toolCall.function.arguments);
  const resultText = toolResult ? MessageHelper.getText(toolResult) : '';
  const result = resultText ? parseResult(resultText) : null;

  // Auto-scroll to bottom as output streams in
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [result?.output]);

  if (!args || !args.task) {
    return null;
  }

  const isExecuting = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';
  const hasError = result && result.exitCode !== null && result.exitCode !== 0;
  const timedOut = result?.timedOut;

  // Show which coding CLI is actually driving this run. The resolved CLI is carried on the result
  // (including the initial partial result), so it is available during execution too; fall back to
  // the default display name when the id is missing or unrecognized.
  const cliId = result?.cli;
  const cliDisplayName =
    cliId && cliId in CODING_CLI_DISPLAY_NAMES
      ? CODING_CLI_DISPLAY_NAMES[cliId as CodingCliId]
      : CODING_CLI_DISPLAY_NAMES.claude;

  return (
    <div className="coding-agent-view">
      <div className="terminal-container">
        {/* Header */}
        <div className="terminal-line" style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ fontSize: '16px' }}>🤖</span>
          <span style={{ fontWeight: 600, color: 'var(--color-neutral-200)' }}>{t('chat.tool.codingAgent.title', { cli: cliDisplayName })}</span>
          {result?.durationMs && !isExecuting && (
            <span style={{ fontSize: '11px', color: 'var(--color-neutral-500)', marginLeft: 'auto' }}>
              {formatDuration(result.durationMs)}
            </span>
          )}
        </div>

        {/* Task description */}
        <div style={{ padding: '6px 0', fontSize: '12px', color: 'var(--color-neutral-400)' }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>{t('chat.tool.codingAgent.task')} </span>
          <span>{args.task.length > 200 ? args.task.slice(0, 200) + '...' : args.task}</span>
        </div>

        {/* Executing indicator */}
        {isExecuting && (
          <div className="terminal-line terminal-executing">
            <span className="terminal-executing-text">
              {t('chat.tool.codingAgent.running', { cli: cliDisplayName })}
            </span>
          </div>
        )}

        {isInterrupted && (
          <div className="terminal-line terminal-timeout">
            <span className="terminal-timeout-text">{t('chat.tool.codingAgent.interrupted')}</span>
          </div>
        )}

        {/* Output */}
        {result?.output && (
          <div className={`terminal-output ${hasError ? 'has-error' : ''}`}>
            <pre ref={outputRef} className="terminal-output-pre" style={{ maxHeight: '400px', overflow: 'auto' }}>
              {result.output}
            </pre>
          </div>
        )}

        {/* Timeout warning */}
        {timedOut && (
          <div className="terminal-line terminal-timeout">
            <span className="terminal-timeout-text">{t('chat.tool.codingAgent.timedOut')}</span>
          </div>
        )}

        {/* Truncated notice */}
        {result?.truncated && (
          <div className="terminal-line terminal-truncated">
            <span className="terminal-truncated-text">{t('chat.tool.outputTruncated')}</span>
          </div>
        )}

        {/* Exit code (non-zero only) */}
        {result && result.exitCode !== null && result.exitCode !== 0 && !timedOut && (
          <div className="terminal-line terminal-exit-code">
            <span className="terminal-exit-code-text">{t('chat.tool.exitCode', { code: result.exitCode })}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodingAgentToolCallView;
