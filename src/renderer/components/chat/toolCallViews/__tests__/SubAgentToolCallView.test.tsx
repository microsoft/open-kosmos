/**
 * @vitest-environment happy-dom
 */

/**
 * SubAgentToolCallView rendering tests
 *
 * Component subscribes to subAgent:stateUpdate IPC for real-time progress display. Tests:
 * - Argument parsing and display (prompt, share_context)
 * - Running / success / failure states
 * - Real-time progress step list rendering (via simulated IPC callbacks)
 * - Edge cases (empty arguments, malformed JSON)
 */

import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { SubAgentToolCallView } from '../SubAgentToolCallView';
import type { ToolCallViewProps, ToolCallExecutionStatus } from '../types';
import type { ToolCall, Message } from '@shared/types/chatTypes';
import type { SubAgentRuntimeState } from '../../../../../main/lib/userDataADO/types/profile';

// ========== Mock electronAPI.subAgent.onStateUpdate ==========

type StateUpdateCallback = (state: SubAgentRuntimeState) => void;

let stateUpdateCallbacks: StateUpdateCallback[] = [];
const mockShowSidepane = vi.fn();
const mockSelectTask = vi.fn();

vi.mock('../../chat-side.atom', () => ({
  SubAgentTasksSidepaneAtom: {
    use: () => [null, { show: mockShowSidepane, selectTask: mockSelectTask }],
  },
}));

/** Simulate sending a subAgent:stateUpdate event */
function emitStateUpdate(state: SubAgentRuntimeState) {
  stateUpdateCallbacks.forEach(cb => cb(state));
}

beforeEach(() => {
  stateUpdateCallbacks = [];
  mockShowSidepane.mockClear();
  mockSelectTask.mockClear();
  (window as any).electronAPI = {
    subAgent: {
      onStateUpdate: (callback: StateUpdateCallback) => {
        stateUpdateCallbacks.push(callback);
        return () => {
          stateUpdateCallbacks = stateUpdateCallbacks.filter(cb => cb !== callback);
        };
      },
    },
    subAgentTask: {
      resolveByCorrelationId: vi.fn().mockResolvedValue({ success: false }),
    },
  };
});

afterEach(() => {
  stateUpdateCallbacks = [];
  vi.useRealTimers();
});

// ========== Helper factories ==========

function createToolCall(args: Record<string, unknown>, name = 'sub_agent'): ToolCall {
  return {
    id: 'tc_001',
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function createToolResult(text: string): Message {
  return {
    id: 'tool-result-1',
    role: 'tool',
    timestamp: 1000,
    content: [{ type: 'text', text }],
    tool_call_id: 'tc_001',
    name: 'sub_agent',
  };
}

function createRuntimeState(overrides: Partial<SubAgentRuntimeState> = {}): SubAgentRuntimeState {
  return {
    taskId: 'task_001',
    subAgentName: 'test-agent',
    status: 'running',
    startTime: Date.now(),
    currentTurn: 1,
    steps: [],
    correlationId: 'tc_001',
    ...overrides,
  };
}

// Test wrappers that auto-default executionStatus based on toolResult
const TestSingleView: React.FC<Omit<ToolCallViewProps, 'executionStatus'> & { executionStatus?: ToolCallExecutionStatus }> = ({ executionStatus, toolResult, ...rest }) => (
  <SubAgentToolCallView {...rest} toolResult={toolResult} executionStatus={executionStatus ?? (toolResult ? 'completed' : 'executing')} />
);

// ================================================================
// SubAgentToolCallView
// ================================================================

describe('SubAgentToolCallView', () => {
  // ========== Rendering ==========

  describe('rendering', () => {
    it('should render ad-hoc worker label', () => {
      const tc = createToolCall({ prompt: 'Search React 19' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Ad-hoc Worker')).toBeInTheDocument();
    });

    it('should render task description', () => {
      const tc = createToolCall({ prompt: 'Write unit tests' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    });

    it('should render context badge when share_context is true', () => {
      const tc = createToolCall({ prompt: 'b', share_context: true });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/Context shared/)).toBeInTheDocument();
    });

    it('should render background and auto-promoted badges', () => {
      const backgroundCall = createToolCall({ prompt: 'b', run_in_background: true });
      const { rerender } = render(<TestSingleView toolCall={backgroundCall} toolResult={null} />);
      expect(screen.getByText(/Running in background/)).toBeInTheDocument();

      const foregroundCall = createToolCall({ prompt: 'b', run_in_background: false });
      rerender(<TestSingleView toolCall={foregroundCall} toolResult={createToolResult('auto-promoted to background')} />);
      expect(screen.getByText(/Auto-promoted to background/)).toBeInTheDocument();
    });

    it('should NOT render context badge when share_context is false/absent', () => {
      const tc = createToolCall({ prompt: 'b' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.queryByText(/Context shared/)).not.toBeInTheDocument();
    });
  });

  // ========== Status states ==========

  describe('status states', () => {
    it('should show Starting when toolResult is null and no runtimeState', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/Starting/)).toBeInTheDocument();
    });

    it('should show Turn progress when runtimeState is received via IPC', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ currentTurn: 3 }));
      });

      expect(screen.getAllByText(/Turn 3/).length).toBeGreaterThanOrEqual(1);
    });

    it('should show Done for successful result (no IPC finalStatus)', () => {
      const tc = createToolCall({ prompt: 'y' });
      const result = createToolResult('Task completed successfully.');
      render(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText(/Done/)).toBeInTheDocument();
    });

    it('should show Done when IPC finalStatus is completed', () => {
      const tc = createToolCall({ prompt: 'y' });
      const { rerender } = render(<TestSingleView toolCall={tc} toolResult={null} />);

      // Simulate IPC completion
      act(() => {
        emitStateUpdate(createRuntimeState({ status: 'completed' }));
      });

      // Then toolResult arrives
      const result = createToolResult('Task completed.');
      rerender(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText(/Done/)).toBeInTheDocument();
    });

    it('should show Failed when IPC finalStatus is failed', () => {
      const tc = createToolCall({ prompt: 'y' });
      const { rerender } = render(<TestSingleView toolCall={tc} toolResult={null} />);

      // Simulate IPC failure
      act(() => {
        emitStateUpdate(createRuntimeState({ status: 'failed' }));
      });

      // Then toolResult arrives
      const result = createToolResult('Sub-agent failed: timeout');
      rerender(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText(/Failed/)).toBeInTheDocument();
    });

    it('should show Failed when IPC finalStatus is cancelled', () => {
      const tc = createToolCall({ prompt: 'y' });
      const { rerender } = render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ status: 'cancelled' }));
      });

      const result = createToolResult('Cancelled by user');
      rerender(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText(/Failed/)).toBeInTheDocument();
    });

    it('should show Interrupted when execution is interrupted', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} executionStatus="interrupted" />);
      expect(screen.getByText(/Interrupted/)).toBeInTheDocument();
    });
  });

  // ========== Real-time progress ==========

  describe('real-time progress', () => {
    it('should render tool steps from runtimeState', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'bing_web_search', turn: 1, timestamp: Date.now(), durationMs: 350 },
            { type: 'tool_start', toolCallId: 'tc2', toolName: 'fetch_web_content', turn: 2, timestamp: Date.now() },
          ],
        }));
      });

      expect(screen.getByText('bing_web_search')).toBeInTheDocument();
      expect(screen.getByText('fetch_web_content')).toBeInTheDocument();
      expect(screen.getByText('350ms')).toBeInTheDocument();
      expect(screen.getByText('running...')).toBeInTheDocument();
    });

    it('should render lastTextSnippet', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [{ type: 'tool_done', toolCallId: 'tc1', toolName: 'read_file', turn: 1, timestamp: Date.now() }],
          lastTextSnippet: 'Analyzing the document structure...',
        }));
      });

      expect(screen.getByText(/Analyzing the document structure/)).toBeInTheDocument();
    });

    it('should not render steps when runtimeState has empty steps', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ steps: [] }));
      });

      // No step-related elements rendered
      expect(screen.queryByText('running...')).not.toBeInTheDocument();
    });

    it('should ignore non-tool runtime steps', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'text', turn: 1, timestamp: Date.now(), textSnippet: 'not a tool step' },
          ],
        }));
      });

      expect(screen.queryByText('not a tool step')).not.toBeInTheDocument();
      expect(screen.queryByText('running...')).not.toBeInTheDocument();
    });

    it('should clear runtimeState when toolResult arrives', () => {
      const tc = createToolCall({ prompt: 'y' });
      const { rerender } = render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [{ type: 'tool_start', toolCallId: 'tc1', toolName: 'write_file', turn: 1, timestamp: Date.now() }],
        }));
      });

      expect(screen.getByText('write_file')).toBeInTheDocument();

      // toolResult arrives → steps should disappear
      const result = createToolResult('Done.');
      rerender(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.queryByText('write_file')).not.toBeInTheDocument();
    });

    it('should only match state updates with matching correlationId', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        // Different correlationId — should be ignored
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_OTHER',
          steps: [{ type: 'tool_start', toolCallId: 'tc1', toolName: 'ignored_tool', turn: 1, timestamp: Date.now() }],
        }));
      });

      expect(screen.queryByText('ignored_tool')).not.toBeInTheDocument();
    });

    it('should format tool duration as seconds when >= 1000ms', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'slow_tool', turn: 1, timestamp: Date.now(), durationMs: 2500 },
          ],
        }));
      });

      expect(screen.getByText('2.5s')).toBeInTheDocument();
    });

    it('should show error indicator for tool_error steps', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'tool_error', toolCallId: 'tc1', toolName: 'broken_tool', turn: 1, timestamp: Date.now() },
          ],
        }));
      });

      expect(screen.getByText('broken_tool')).toBeInTheDocument();
      expect(screen.getByText('failed')).toBeInTheDocument();
    });

    it('should render streamingText via StreamingTextDisplay when present', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          streamingText: 'Analyzing your code...',
        }));
      });

      expect(screen.getByText(/Analyzing your code/)).toBeInTheDocument();
      expect(screen.getByText(/Thinking/i)).toBeInTheDocument();
    });

    it('should prioritize streamingText over lastTextSnippet', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          streamingText: 'Live streaming text',
          lastTextSnippet: 'Old snippet text',
        }));
      });

      expect(screen.getByText(/Live streaming text/)).toBeInTheDocument();
      expect(screen.queryByText(/Old snippet text/)).not.toBeInTheDocument();
    });

    it('should fall back to lastTextSnippet when streamingText is absent', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          lastTextSnippet: 'Some previous text...',
        }));
      });

      expect(screen.getByText(/Some previous text/)).toBeInTheDocument();
    });

    it('should render TurnProgressBar with current/max turns', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ currentTurn: 7 }));
      });

      expect(screen.getAllByText(/Turn 7/).length).toBeGreaterThanOrEqual(1);
    });

    it('should render toolArgsSummary for tool steps', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'read_file', turn: 1, timestamp: Date.now(), durationMs: 100, toolArgsSummary: 'path: /src/main.ts' },
          ],
        }));
      });

      expect(screen.getByText('path: /src/main.ts')).toBeInTheDocument();
    });

    it('should render toolResultLength formatted as size for tool_done steps', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'read_file', turn: 1, timestamp: Date.now(), durationMs: 50, toolResultLength: 5200 },
          ],
        }));
      });

      // 5200 chars => "5.2K"
      expect(screen.getByText('→ 5.2K')).toBeInTheDocument();
    });

    it('formats small result sizes as character counts', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'read_file', turn: 1, timestamp: Date.now(), toolResultLength: 999 },
          ],
        }));
      });

      expect(screen.getByText('→ 999 chars')).toBeInTheDocument();
    });

    it('formats minute durations and very large result sizes', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'long_tool', turn: 1, timestamp: Date.now(), durationMs: 125000, toolResultLength: 125000 },
          ],
        }));
      });

      expect(screen.getByText('2m 5s')).toBeInTheDocument();
      expect(screen.getByText('→ 125K')).toBeInTheDocument();
    });

    it('ticks elapsed running time when a startTime is present', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ startTime: now - 500 }));
      });
      expect(screen.getByText('500ms')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('1.5s')).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('shows and uses task detail button from runtime taskId', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ taskId: 'task_runtime' }));
      });

      fireEvent.click(screen.getByTitle('View task details'));
      expect(mockShowSidepane).toHaveBeenCalled();
      expect(mockSelectTask).toHaveBeenCalledWith('task_runtime');
    });

    it('resolves task detail button by correlation id for completed calls', async () => {
      (window as any).electronAPI.subAgentTask.resolveByCorrelationId = vi.fn().mockResolvedValue({
        success: true,
        data: 'task_resolved',
      });
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={createToolResult('Done.')} />);

      await waitFor(() => screen.getByTitle('View task details'));
      fireEvent.click(screen.getByTitle('View task details'));

      expect(mockShowSidepane).toHaveBeenCalled();
      expect(mockSelectTask).toHaveBeenCalledWith('task_resolved');
    });

    it('does not resolve task details without a tool call id', async () => {
      const resolveByCorrelationId = vi.fn().mockResolvedValue({ success: true, data: 'task_resolved' });
      (window as any).electronAPI.subAgentTask.resolveByCorrelationId = resolveByCorrelationId;
      const tc = createToolCall({ prompt: 'y' });
      tc.id = '';

      render(<TestSingleView toolCall={tc} toolResult={createToolResult('Done.')} />);

      await waitFor(() => expect(resolveByCorrelationId).not.toHaveBeenCalled());
      expect(screen.queryByTitle('View task details')).not.toBeInTheDocument();
    });

    it('keeps rendering when task detail resolution rejects', async () => {
      const resolveByCorrelationId = vi.fn().mockRejectedValue(new Error('lookup failed'));
      (window as any).electronAPI.subAgentTask.resolveByCorrelationId = resolveByCorrelationId;
      const tc = createToolCall({ prompt: 'y' });

      render(<TestSingleView toolCall={tc} toolResult={createToolResult('Done.')} />);

      await waitFor(() => expect(resolveByCorrelationId).toHaveBeenCalledWith('tc_001'));
      expect(screen.getByText('Done.')).toBeInTheDocument();
      expect(screen.queryByTitle('View task details')).not.toBeInTheDocument();
    });
  });

  // ========== Result display ==========

  describe('result display', () => {
    it('should render result text when available', () => {
      const tc = createToolCall({ prompt: 'y' });
      const result = createToolResult('Here are the findings...');
      render(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText('Here are the findings...')).toBeInTheDocument();
    });

    it('should render "Result" divider label', () => {
      const tc = createToolCall({ prompt: 'y' });
      const result = createToolResult('some output');
      render(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText('Result')).toBeInTheDocument();
    });

    it('should NOT render result section when toolResult is null', () => {
      const tc = createToolCall({ prompt: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });
  });

  // ========== Edge cases ==========

  describe('edge cases', () => {
    it('should render the ad-hoc label when only a prompt is provided', () => {
      const tc = createToolCall({ prompt: 'do something' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Ad-hoc Worker')).toBeInTheDocument();
    });

    it('should show fallback task text when task is missing', () => {
      const tc = createToolCall({});
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('No task description')).toBeInTheDocument();
    });

    it('uses prompt as the task text', () => {
      const tc = createToolCall({ prompt: 'Review the patch' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Review the patch')).toBeInTheDocument();
    });

    it('renders ad-hoc worker label for sub_agent calls', () => {
      const tc = createToolCall({ prompt: 'Quick task' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Ad-hoc Worker')).toBeInTheDocument();
    });

    it('should handle malformed JSON arguments gracefully', () => {
      const tc: ToolCall = {
        id: 'tc_bad',
        type: 'function',
        function: { name: 'sub_agent', arguments: '{invalid json' },
      };
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      // Should not crash — falls back to defaults
      expect(screen.getByText('Ad-hoc Worker')).toBeInTheDocument();
      expect(screen.getByText('No task description')).toBeInTheDocument();
    });

    it('should handle empty arguments string', () => {
      const tc: ToolCall = {
        id: 'tc_empty',
        type: 'function',
        function: { name: 'sub_agent', arguments: '' },
      };
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Ad-hoc Worker')).toBeInTheDocument();
    });
  });
});
