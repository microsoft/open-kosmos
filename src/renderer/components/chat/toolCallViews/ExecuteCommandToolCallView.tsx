// src/renderer/components/chat/toolCallViews/ExecuteCommandToolCallView.tsx
// Execute Command tool call custom view component - terminal-style display

import React from 'react';
import { ToolCallViewProps, ExecuteCommandToolArgs, ExecuteCommandToolResult } from './types';
import { MessageHelper } from '../../../types/chatTypes';

/**
 * Parse tool call arguments
 */
const parseToolArgs = (argsStr?: string): ExecuteCommandToolArgs | null => {
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
const parseToolResult = (content: string): ExecuteCommandToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Get shell prompt
 */
const getPrompt = (shell?: string, cwd?: string): string => {
  const displayPath = cwd || '~';
  // Return different style prompts based on shell type
  switch (shell) {
    case 'powershell':
      return `PS ${displayPath}>`;
    case 'cmd':
      return `${displayPath}>`;
    case 'bash':
    case 'sh':
    case 'zsh':
    default:
      return `$ `;
  }
};

/**
 * Execute Command Tool Call custom view
 * Terminal-style display for command execution results
 */
export const ExecuteCommandToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
}) => {
  const args = parseToolArgs(toolCall.function.arguments);
  // Use MessageHelper.getText to extract text from UnifiedContentPart[]
  const resultText = toolResult ? MessageHelper.getText(toolResult) : '';
  const result = resultText ? parseToolResult(resultText) : null;

  // If no arguments, don't render
  if (!args || !args.command) {
    return null;
  }

  const isExecuting = !toolResult;
  const command = args.command + (args.args ? ' ' + args.args.join(' ') : '');
  const prompt = getPrompt(args.shell, args.cwd);

  // Build complete output content
  const buildOutput = (): string => {
    if (!result) return '';

    let output = '';

    // Add stdout
    if (result.stdout && result.stdout.trim()) {
      output += result.stdout;
    }

    // Add stderr (if any)
    if (result.stderr && result.stderr.trim()) {
      if (output) output += '\n';
      output += result.stderr;
    }

    return output.trim();
  };

  const output = buildOutput();
  const hasError = result && (result.exitCode !== 0 || (result.stderr && result.stderr.trim()));
  const timedOut = result?.timedOut;

  return (
    <div className="execute-command-view">
      <div className="terminal-container">
        {/* Command line */}
        <div className="terminal-line terminal-command-line">
          <span className="terminal-prompt">{prompt}</span>
          <span className="terminal-command">{command}</span>
        </div>

        {/* Executing state */}
        {isExecuting && (
          <div className="terminal-line terminal-executing">
            <span className="terminal-executing-text">Executing...</span>
          </div>
        )}

        {/* Output content */}
        {output && (
          <div className={`terminal-output ${hasError ? 'has-error' : ''}`}>
            <pre className="terminal-output-pre">{output}</pre>
          </div>
        )}

        {/* Timeout notice */}
        {timedOut && (
          <div className="terminal-line terminal-timeout">
            <span className="terminal-timeout-text">⚠ Command timed out</span>
          </div>
        )}

        {/* Truncation notice */}
        {result?.truncated && (
          <div className="terminal-line terminal-truncated">
            <span className="terminal-truncated-text">... (output truncated)</span>
          </div>
        )}

        {/* Exit code (only shown when non-zero) */}
        {result && result.exitCode !== null && result.exitCode !== 0 && !timedOut && (
          <div className="terminal-line terminal-exit-code">
            <span className="terminal-exit-code-text">Exit code: {result.exitCode}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExecuteCommandToolCallView;
