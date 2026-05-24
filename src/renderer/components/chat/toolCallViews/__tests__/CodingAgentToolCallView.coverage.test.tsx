/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@shared/types/chatTypes', () => ({
  MessageHelper: {
    getText: vi.fn((msg: any) => msg?.content || ''),
  },
}));

import { CodingAgentToolCallView } from '../CodingAgentToolCallView';
import { MessageHelper } from '@shared/types/chatTypes';

const makeToolCall = (args: object) => ({
  id: 'tc1',
  type: 'function' as const,
  function: {
    name: 'coding_agent',
    arguments: JSON.stringify(args),
  },
});

const makeResult = (data: object) => ({
  id: 'msg1',
  role: 'tool' as const,
  content: JSON.stringify(data),
  tool_call_id: 'tc1',
});

describe('CodingAgentToolCallView', () => {
  it('returns null when args is invalid', () => {
    const tc = { id: 'tc1', type: 'function' as const, function: { name: 'x', arguments: 'invalid-json' } };
    const { container } = render(
      <CodingAgentToolCallView toolCall={tc} toolResult={null} executionStatus="completed" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when task is missing', () => {
    const tc = makeToolCall({ notTask: 'hello' });
    const { container } = render(
      <CodingAgentToolCallView toolCall={tc} toolResult={null} executionStatus="completed" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders task description', () => {
    (MessageHelper.getText as any).mockReturnValue('');
    const tc = makeToolCall({ task: 'Write a fibonacci function' });
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={null} executionStatus="completed" />
    );
    expect(screen.getByText('Write a fibonacci function')).toBeTruthy();
    expect(screen.getByText('Claude Code')).toBeTruthy();
  });

  it('truncates long task descriptions', () => {
    (MessageHelper.getText as any).mockReturnValue('');
    const longTask = 'A'.repeat(300);
    const tc = makeToolCall({ task: longTask });
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={null} executionStatus="completed" />
    );
    expect(screen.getByText(/\.\.\./)).toBeTruthy();
  });

  it('shows executing indicator when status is executing', () => {
    (MessageHelper.getText as any).mockReturnValue('');
    const tc = makeToolCall({ task: 'do something' });
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={null} executionStatus="executing" />
    );
    expect(screen.getByText(/Running Claude Code/)).toBeTruthy();
  });

  it('shows interrupted message when status is interrupted', () => {
    (MessageHelper.getText as any).mockReturnValue('');
    const tc = makeToolCall({ task: 'do something' });
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={null} executionStatus="interrupted" />
    );
    expect(screen.getByText(/Interrupted before completion/)).toBeTruthy();
  });

  it('renders output when result has output', () => {
    const resultData = { output: 'Hello from agent', exitCode: 0, durationMs: 1500 };
    (MessageHelper.getText as any).mockReturnValue(JSON.stringify(resultData));
    const tc = makeToolCall({ task: 'run something' });
    const tr = makeResult(resultData);
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={tr as any} executionStatus="completed" />
    );
    expect(screen.getByText('Hello from agent')).toBeTruthy();
  });

  it('shows duration when result has durationMs', () => {
    const resultData = { output: 'done', exitCode: 0, durationMs: 2500 };
    (MessageHelper.getText as any).mockReturnValue(JSON.stringify(resultData));
    const tc = makeToolCall({ task: 'run something' });
    const tr = makeResult(resultData);
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={tr as any} executionStatus="completed" />
    );
    expect(screen.getByText('2.5s')).toBeTruthy();
  });

  it('shows exit code on non-zero exit', () => {
    const resultData = { output: 'error', exitCode: 1, durationMs: 500 };
    (MessageHelper.getText as any).mockReturnValue(JSON.stringify(resultData));
    const tc = makeToolCall({ task: 'run' });
    const tr = makeResult(resultData);
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={tr as any} executionStatus="completed" />
    );
    expect(screen.getByText(/Exit code: 1/)).toBeTruthy();
  });

  it('shows timed out warning', () => {
    const resultData = { output: 'partial', exitCode: 0, durationMs: 60000, timedOut: true };
    (MessageHelper.getText as any).mockReturnValue(JSON.stringify(resultData));
    const tc = makeToolCall({ task: 'long task' });
    const tr = makeResult(resultData);
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={tr as any} executionStatus="completed" />
    );
    expect(screen.getByText(/timed out/)).toBeTruthy();
  });

  it('shows truncated notice', () => {
    const resultData = { output: 'partial output', exitCode: 0, durationMs: 100, truncated: true };
    (MessageHelper.getText as any).mockReturnValue(JSON.stringify(resultData));
    const tc = makeToolCall({ task: 'big task' });
    const tr = makeResult(resultData);
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={tr as any} executionStatus="completed" />
    );
    expect(screen.getByText(/output truncated/)).toBeTruthy();
  });

  it('formats duration in minutes', () => {
    const resultData = { output: 'done', exitCode: 0, durationMs: 90000 };
    (MessageHelper.getText as any).mockReturnValue(JSON.stringify(resultData));
    const tc = makeToolCall({ task: 'run' });
    const tr = makeResult(resultData);
    render(
      <CodingAgentToolCallView toolCall={tc} toolResult={tr as any} executionStatus="completed" />
    );
    expect(screen.getByText('1m 30s')).toBeTruthy();
  });
});
