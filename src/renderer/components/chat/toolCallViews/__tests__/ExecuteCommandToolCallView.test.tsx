/**
 * @vitest-environment happy-dom
 */

/**
 * ExecuteCommandToolCallView rendering tests
 *
 * Covers: null/invalid args, executing state, interrupted state, successful output,
 * stderr display, exit code display, timeout indicator, truncation indicator,
 * various shell prompt styles (powershell, cmd, bash, default).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ExecuteCommandToolCallView } from '../ExecuteCommandToolCallView';
import type { ToolCallExecutionStatus } from '../types';
import type { ToolCall, Message } from '@shared/types/chatTypes';

// ========== Helper factories ==========

function makeToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: 'tc_exec_001',
    type: 'function',
    function: {
      name: 'execute_command',
      arguments: JSON.stringify(args),
    },
  };
}

function makeToolResult(resultObj: unknown): Message {
  return {
    id: 'tr_exec_001',
    timestamp: Date.now(),
    role: 'tool',
    tool_call_id: 'tc_exec_001',
    name: 'execute_command',
    content: [{ type: 'text', text: JSON.stringify(resultObj) }],
  };
}

function renderView(
  toolCall: ToolCall,
  toolResult: Message | null = null,
  executionStatus: ToolCallExecutionStatus = 'completed',
) {
  return render(
    <ExecuteCommandToolCallView
      toolCall={toolCall}
      toolResult={toolResult}
      executionStatus={executionStatus}
    />,
  );
}

// ========== Tests ==========

describe('ExecuteCommandToolCallView', () => {
  describe('null / missing args', () => {
    it('returns null when arguments string is empty', () => {
      const toolCall: ToolCall = {
        id: 'tc_empty',
        type: 'function',
        function: { name: 'execute_command', arguments: '' },
      };
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when arguments is malformed JSON', () => {
      const toolCall: ToolCall = {
        id: 'tc_bad',
        type: 'function',
        function: { name: 'execute_command', arguments: '{bad' },
      };
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when command field is missing', () => {
      const toolCall = makeToolCall({ shell: 'bash' });
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('shell prompt styles', () => {
    it('shows default bash prompt $ when no shell specified', () => {
      const toolCall = makeToolCall({ command: 'ls' });
      renderView(toolCall);
      expect(screen.getByText('$')).toBeInTheDocument();
      expect(screen.getByText('ls')).toBeInTheDocument();
    });

    it('shows PS> prompt for powershell', () => {
      const toolCall = makeToolCall({ command: 'Get-Process', shell: 'powershell', cwd: 'C:\\Users\\test' });
      renderView(toolCall);
      expect(screen.getByText('PS C:\\Users\\test>')).toBeInTheDocument();
    });

    it('shows cwd> prompt for cmd', () => {
      const toolCall = makeToolCall({ command: 'dir', shell: 'cmd', cwd: 'C:\\Windows' });
      renderView(toolCall);
      expect(screen.getByText('C:\\Windows>')).toBeInTheDocument();
    });

    it('shows $ prompt for bash', () => {
      const toolCall = makeToolCall({ command: 'echo hello', shell: 'bash' });
      renderView(toolCall);
      expect(screen.getByText('$')).toBeInTheDocument();
    });

    it('shows $ prompt for zsh', () => {
      const toolCall = makeToolCall({ command: 'pwd', shell: 'zsh' });
      renderView(toolCall);
      expect(screen.getByText('$')).toBeInTheDocument();
    });

    it('uses ~ as default cwd when cwd is not set', () => {
      const toolCall = makeToolCall({ command: 'pwd', shell: 'powershell' });
      renderView(toolCall);
      expect(screen.getByText('PS ~>')).toBeInTheDocument();
    });
  });

  describe('command with args', () => {
    it('appends args to command in the display', () => {
      const toolCall = makeToolCall({ command: 'npm', args: ['run', 'build'] });
      renderView(toolCall);
      expect(screen.getByText('npm run build')).toBeInTheDocument();
    });
  });

  describe('executing state', () => {
    it('shows Executing... indicator', () => {
      const toolCall = makeToolCall({ command: 'npm test' });
      renderView(toolCall, null, 'executing');
      expect(screen.getByText('Executing...')).toBeInTheDocument();
    });
  });

  describe('interrupted state', () => {
    it('shows interrupted message', () => {
      const toolCall = makeToolCall({ command: 'long-running' });
      renderView(toolCall, null, 'interrupted');
      expect(screen.getByText('Interrupted before command output was recorded')).toBeInTheDocument();
    });
  });

  describe('completed with stdout', () => {
    it('shows stdout output', () => {
      const toolCall = makeToolCall({ command: 'echo hello' });
      const result = makeToolResult({ exitCode: 0, stdout: 'hello\n', stderr: '' });
      renderView(toolCall, result);
      expect(screen.getByText('hello')).toBeInTheDocument();
    });
  });

  describe('completed with stderr', () => {
    it('shows stderr output', () => {
      const toolCall = makeToolCall({ command: 'bad-command' });
      const result = makeToolResult({ exitCode: 1, stdout: '', stderr: 'command not found' });
      renderView(toolCall, result);
      expect(screen.getByText('command not found')).toBeInTheDocument();
    });

    it('shows both stdout and stderr when both are present', () => {
      const toolCall = makeToolCall({ command: 'my-cmd' });
      const result = makeToolResult({ exitCode: 1, stdout: 'partial output', stderr: 'warning message' });
      renderView(toolCall, result);
      const outputEl = document.querySelector('.terminal-output-pre');
      expect(outputEl?.textContent).toContain('partial output');
      expect(outputEl?.textContent).toContain('warning message');
    });
  });

  describe('exit code', () => {
    it('shows exit code when non-zero and not timed out', () => {
      const toolCall = makeToolCall({ command: 'fail' });
      const result = makeToolResult({ exitCode: 2, stdout: '', stderr: 'error' });
      renderView(toolCall, result);
      expect(screen.getByText('Exit code: 2')).toBeInTheDocument();
    });

    it('does not show exit code 0', () => {
      const toolCall = makeToolCall({ command: 'success' });
      const result = makeToolResult({ exitCode: 0, stdout: 'ok', stderr: '' });
      renderView(toolCall, result);
      expect(screen.queryByText(/Exit code/)).toBeNull();
    });

    it('does not show exit code when timed out', () => {
      const toolCall = makeToolCall({ command: 'slow' });
      const result = makeToolResult({ exitCode: 1, stdout: '', stderr: '', timedOut: true });
      renderView(toolCall, result);
      expect(screen.queryByText(/Exit code/)).toBeNull();
    });
  });

  describe('timeout indicator', () => {
    it('shows timeout warning when timedOut is true', () => {
      const toolCall = makeToolCall({ command: 'sleep 100' });
      const result = makeToolResult({ exitCode: 1, stdout: '', stderr: '', timedOut: true });
      renderView(toolCall, result);
      expect(screen.getByText('⚠ Command timed out')).toBeInTheDocument();
    });
  });

  describe('truncation indicator', () => {
    it('shows truncation message when output is truncated', () => {
      const toolCall = makeToolCall({ command: 'large-output' });
      const result = makeToolResult({ exitCode: 0, stdout: 'lots of output', stderr: '', truncated: true });
      renderView(toolCall, result);
      expect(screen.getByText('... (output truncated)')).toBeInTheDocument();
    });
  });

  describe('no output', () => {
    it('does not show output section when stdout and stderr are empty', () => {
      const toolCall = makeToolCall({ command: 'silent-cmd' });
      const result = makeToolResult({ exitCode: 0, stdout: '', stderr: '' });
      renderView(toolCall, result);
      expect(document.querySelector('.terminal-output')).toBeNull();
    });
  });
});
