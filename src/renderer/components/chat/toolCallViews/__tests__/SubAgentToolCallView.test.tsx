/**
 * @vitest-environment happy-dom
 */

/**
 * SubAgentToolCallView & ParallelSubAgentsToolCallView rendering tests
 *
 * Component subscribes to subAgent:stateUpdate IPC for real-time progress display. Tests:
 * - Argument parsing and display (sub_agent_name, task, share_context)
 * - Running / success / failure states
 * - Real-time progress step list rendering (via simulated IPC callbacks)
 * - Parallel task card rendering + independent progress
 * - Edge cases (empty arguments, malformed JSON)
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { SubAgentToolCallView, ParallelSubAgentsToolCallView } from '../SubAgentToolCallView';
import type { ToolCallViewProps, ToolCallExecutionStatus } from '../types';
import type { ToolCall, Message } from '@shared/types/chatTypes';
import type { SubAgentRuntimeState } from '../../../../../main/lib/userDataADO/types/profile';

// ========== Mock electronAPI.subAgent.onStateUpdate ==========

type StateUpdateCallback = (state: SubAgentRuntimeState) => void;

let stateUpdateCallbacks: StateUpdateCallback[] = [];

/** Simulate sending a subAgent:stateUpdate event */
function emitStateUpdate(state: SubAgentRuntimeState) {
  stateUpdateCallbacks.forEach(cb => cb(state));
}

beforeEach(() => {
  stateUpdateCallbacks = [];
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
      resolveByCorrelationId: vi.fn().mockResolvedValue(null),
    },
  };
});

afterEach(() => {
  stateUpdateCallbacks = [];
});

// ========== Helper factories ==========

function createToolCall(args: Record<string, unknown>, name = 'spawn_subagent'): ToolCall {
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

const TestParallelView: React.FC<Omit<ToolCallViewProps, 'executionStatus'> & { executionStatus?: ToolCallExecutionStatus }> = ({ executionStatus, toolResult, ...rest }) => (
  <ParallelSubAgentsToolCallView {...rest} toolResult={toolResult} executionStatus={executionStatus ?? (toolResult ? 'completed' : 'executing')} />
);

// ================================================================
// SubAgentToolCallView
// ================================================================

describe('SubAgentToolCallView', () => {
  // ========== Rendering ==========

  describe('rendering', () => {
    it('should render sub-agent name', () => {
      const tc = createToolCall({ sub_agent_name: 'web-researcher', task: 'Search React 19' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('web-researcher')).toBeInTheDocument();
    });

    it('should render task description', () => {
      const tc = createToolCall({ sub_agent_name: 'helper', task: 'Write unit tests' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    });

    it('should render context badge when share_context is true', () => {
      const tc = createToolCall({ sub_agent_name: 'a', task: 'b', share_context: true });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/Context shared/)).toBeInTheDocument();
    });

    it('should NOT render context badge when share_context is false/absent', () => {
      const tc = createToolCall({ sub_agent_name: 'a', task: 'b' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.queryByText(/Context shared/)).not.toBeInTheDocument();
    });
  });

  // ========== Status states ==========

  describe('status states', () => {
    it('should show Starting when toolResult is null and no runtimeState', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/Starting/)).toBeInTheDocument();
    });

    it('should show Turn progress when runtimeState is received via IPC', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ currentTurn: 3 }));
      });

      expect(screen.getAllByText(/Turn 3/).length).toBeGreaterThanOrEqual(1);
    });

    it('should show Done for successful result (no IPC finalStatus)', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      const result = createToolResult('Task completed successfully.');
      render(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText(/Done/)).toBeInTheDocument();
    });

    it('should show Done when IPC finalStatus is completed', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      const { rerender } = render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ status: 'cancelled' }));
      });

      const result = createToolResult('Cancelled by user');
      rerender(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText(/Failed/)).toBeInTheDocument();
    });
  });

  // ========== Real-time progress ==========

  describe('real-time progress', () => {
    it('should render tool steps from runtimeState', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ steps: [] }));
      });

      // No step-related elements rendered
      expect(screen.queryByText('running...')).not.toBeInTheDocument();
    });

    it('should clear runtimeState when toolResult arrives', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          lastTextSnippet: 'Some previous text...',
        }));
      });

      expect(screen.getByText(/Some previous text/)).toBeInTheDocument();
    });

    it('should render TurnProgressBar with current/max turns', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({ currentTurn: 7 }));
      });

      expect(screen.getAllByText(/Turn 7/).length).toBeGreaterThanOrEqual(1);
    });

    it('should render toolArgsSummary for tool steps', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
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
  });

  // ========== Result display ==========

  describe('result display', () => {
    it('should render result text when available', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      const result = createToolResult('Here are the findings...');
      render(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText('Here are the findings...')).toBeInTheDocument();
    });

    it('should render "Result" divider label', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      const result = createToolResult('some output');
      render(<TestSingleView toolCall={tc} toolResult={result} />);
      expect(screen.getByText('Result')).toBeInTheDocument();
    });

    it('should NOT render result section when toolResult is null', () => {
      const tc = createToolCall({ sub_agent_name: 'x', task: 'y' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });
  });

  // ========== Edge cases ==========

  describe('edge cases', () => {
    it('should show "Unknown" when sub_agent_name is missing', () => {
      const tc = createToolCall({ task: 'do something' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('should show fallback task text when task is missing', () => {
      const tc = createToolCall({ sub_agent_name: 'x' });
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('No task description')).toBeInTheDocument();
    });

    it('should handle malformed JSON arguments gracefully', () => {
      const tc: ToolCall = {
        id: 'tc_bad',
        type: 'function',
        function: { name: 'spawn_subagent', arguments: '{invalid json' },
      };
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      // Should not crash — falls back to defaults
      expect(screen.getByText('Unknown')).toBeInTheDocument();
      expect(screen.getByText('No task description')).toBeInTheDocument();
    });

    it('should handle empty arguments string', () => {
      const tc: ToolCall = {
        id: 'tc_empty',
        type: 'function',
        function: { name: 'spawn_subagent', arguments: '' },
      };
      render(<TestSingleView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });
});

// ================================================================
// ParallelSubAgentsToolCallView
// ================================================================

describe('ParallelSubAgentsToolCallView', () => {
  const sampleTasks = [
    { sub_agent_name: 'web-researcher', task: 'Search React 19' },
    { sub_agent_name: 'code-reviewer', task: 'Review PR #42' },
    { sub_agent_name: 'doc-writer', task: 'Write API docs' },
  ];

  // ========== Rendering ==========

  describe('rendering', () => {
    it('should show task count in header', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/3 tasks/)).toBeInTheDocument();
    });

    it('should render all task sub-agent names', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('web-researcher')).toBeInTheDocument();
      expect(screen.getByText('code-reviewer')).toBeInTheDocument();
      expect(screen.getByText('doc-writer')).toBeInTheDocument();
    });

    it('should render all task descriptions', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.getByText('Search React 19')).toBeInTheDocument();
      expect(screen.getByText('Review PR #42')).toBeInTheDocument();
      expect(screen.getByText('Write API docs')).toBeInTheDocument();
    });
  });

  // ========== Status ==========

  describe('status', () => {
    it('should show Starting when toolResult is null and no IPC updates', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/Starting/)).toBeInTheDocument();
    });

    it('should show completion count when IPC updates arrive (N/M done)', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_0',
          subAgentName: 'web-researcher',
          status: 'completed',
        }));
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_1',
          subAgentName: 'code-reviewer',
          status: 'running',
        }));
      });

      expect(screen.getByText(/1\/3 done/)).toBeInTheDocument();
    });

    it('should show All Done when toolResult is present', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      const result = createToolResult(
        '### Task 1: web-researcher\n**Status**: ✅ Completed\n**Duration**: 1000ms | **Turns**: 5\n\nResult 1' +
        '\n\n---\n\n' +
        '### Task 2: code-reviewer\n**Status**: ✅ Completed\n**Duration**: 2000ms | **Turns**: 8\n\nResult 2' +
        '\n\n---\n\n' +
        '### Task 3: doc-writer\n**Status**: ✅ Completed\n**Duration**: 3000ms | **Turns**: 10\n\nResult 3'
      );
      render(<TestParallelView toolCall={tc} toolResult={result} />);
      expect(screen.getByText(/All Done/)).toBeInTheDocument();
    });
  });

  // ========== Real-time parallel progress ==========

  describe('real-time parallel progress', () => {
    it('should show per-task Turn progress from IPC stateUpdates', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_0',
          subAgentName: 'web-researcher',
          currentTurn: 3,
          steps: [],
        }));
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_1',
          subAgentName: 'code-reviewer',
          currentTurn: 5,
          steps: [],
        }));
      });

      expect(screen.getAllByText(/Turn 3/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Turn 5/).length).toBeGreaterThanOrEqual(1);
    });

    it('should render tool steps within individual task cards', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_0',
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'bing_web_search', turn: 1, timestamp: Date.now(), durationMs: 200 },
            { type: 'tool_start', toolCallId: 'tc2', toolName: 'fetch_web_content', turn: 2, timestamp: Date.now() },
          ],
        }));
      });

      expect(screen.getByText('bing_web_search')).toBeInTheDocument();
      expect(screen.getByText('fetch_web_content')).toBeInTheDocument();
    });

    it('should ignore state updates with non-matching correlationId prefix', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_OTHER_0',
          steps: [{ type: 'tool_start', toolCallId: 'tc1', toolName: 'should_not_appear', turn: 1, timestamp: Date.now() }],
        }));
      });

      expect(screen.queryByText('should_not_appear')).not.toBeInTheDocument();
    });

    it('should render per-task TurnProgressBar from IPC stateUpdates', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_0',
          subAgentName: 'web-researcher',
          currentTurn: 4,
          steps: [],
        }));
      });

      // Progress bar text
      expect(screen.getAllByText(/Turn 4/).length).toBeGreaterThanOrEqual(1);
    });

    it('should render streamingText for individual parallel tasks', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_0',
          subAgentName: 'web-researcher',
          streamingText: 'Searching for React 19 docs...',
        }));
      });

      expect(screen.getByText(/Searching for React 19 docs/)).toBeInTheDocument();
    });

    it('should show compact step list in parallel view (max 3 steps)', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);

      act(() => {
        emitStateUpdate(createRuntimeState({
          correlationId: 'tc_001_0',
          subAgentName: 'web-researcher',
          steps: [
            { type: 'tool_done', toolCallId: 'tc1', toolName: 'tool_a', turn: 1, timestamp: Date.now(), durationMs: 100 },
            { type: 'tool_done', toolCallId: 'tc2', toolName: 'tool_b', turn: 2, timestamp: Date.now(), durationMs: 200 },
            { type: 'tool_done', toolCallId: 'tc3', toolName: 'tool_c', turn: 3, timestamp: Date.now(), durationMs: 300 },
            { type: 'tool_done', toolCallId: 'tc4', toolName: 'tool_d', turn: 4, timestamp: Date.now(), durationMs: 400 },
            { type: 'tool_start', toolCallId: 'tc5', toolName: 'tool_e', turn: 5, timestamp: Date.now() },
          ],
        }));
      });

      // Should show "... 2 earlier steps" because compact=true shows only last 3
      expect(screen.getByText(/2 earlier step/)).toBeInTheDocument();
      // Latest 3 should be visible
      expect(screen.getByText('tool_c')).toBeInTheDocument();
      expect(screen.getByText('tool_d')).toBeInTheDocument();
      expect(screen.getByText('tool_e')).toBeInTheDocument();
      // Oldest should NOT be visible
      expect(screen.queryByText('tool_a')).not.toBeInTheDocument();
      expect(screen.queryByText('tool_b')).not.toBeInTheDocument();
    });
  });

  // ========== Result details ==========

  describe('result details', () => {
    it('should render collapsible details when result is present', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      const result = createToolResult('Task 1 result\n---\nTask 2 result\n---\nTask 3 result');
      render(<TestParallelView toolCall={tc} toolResult={result} />);
      expect(screen.getByText('View detailed results')).toBeInTheDocument();
    });

    it('should NOT render details when no result', () => {
      const tc = createToolCall({ tasks: sampleTasks }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.queryByText('View detailed results')).not.toBeInTheDocument();
    });
  });

  // ========== Edge cases ==========

  describe('edge cases', () => {
    it('should handle empty tasks array', () => {
      const tc = createToolCall({ tasks: [] }, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/0 tasks/)).toBeInTheDocument();
    });

    it('should handle missing tasks field', () => {
      const tc = createToolCall({}, 'spawn_subagents');
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/0 tasks/)).toBeInTheDocument();
    });

    it('should handle malformed JSON arguments', () => {
      const tc: ToolCall = {
        id: 'tc_bad',
        type: 'function',
        function: { name: 'spawn_subagents', arguments: 'not json' },
      };
      render(<TestParallelView toolCall={tc} toolResult={null} />);
      expect(screen.getByText(/0 tasks/)).toBeInTheDocument();
    });

    it('should parse duration from result text', () => {
      const tc = createToolCall({
        tasks: [{ sub_agent_name: 'fast-agent', task: 'Quick check' }],
      }, 'spawn_subagents');
      const result = createToolResult('### Task 1: fast-agent\n**Status**: ✅ Completed\n**Duration**: 1500ms | **Turns**: 3\n\nDone');
      render(<TestParallelView toolCall={tc} toolResult={result} />);
      // 1500ms => "1.5s"
      expect(screen.getByText(/1\.5s/)).toBeInTheDocument();
    });

    it('should correctly parse task status when sub-agent result contains --- separators', () => {
      // Regression test: sub-agent result content containing markdown --- should not break parsing
      const tc = createToolCall({
        tasks: [
          { sub_agent_name: 'researcher-1', task: 'Research topic A' },
          { sub_agent_name: 'researcher-2', task: 'Research topic B' },
        ],
      }, 'spawn_subagents');
      const result = createToolResult(
        '### Task 1: researcher-1\n**Status**: ✅ Completed\n**Duration**: 5000ms | **Turns**: 10\n\n' +
        '<sub_agent_result>\n## Report\nSection 1\n---\nSection 2\n---\nSection 3\n</sub_agent_result>' +
        '\n\n---\n\n' +
        '### Task 2: researcher-2\n**Status**: ✅ Completed\n**Duration**: 8000ms | **Turns**: 15\n\n' +
        '<sub_agent_result>\nAnother report with --- in it\n---\nMore content\n</sub_agent_result>'
      );
      render(<TestParallelView toolCall={tc} toolResult={result} />);
      // Both tasks should show success ✅, not ❌
      const successBadges = screen.getAllByText('✅', { exact: false });
      expect(successBadges.length).toBeGreaterThanOrEqual(2);
      // Verify no error badge is shown for individual tasks
      const taskCards = document.querySelectorAll('.parallel-task-card');
      taskCards.forEach(card => {
        expect(card.querySelector('.error')).toBeNull();
      });
    });
  });
});
