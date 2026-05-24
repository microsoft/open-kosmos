/**
 * SubAgentStepHandler — Pure function for applying step updates to runtime state.
 *
 * Extracted from SubAgentManager to deduplicate identical onStepUpdate closures
 * in spawnSubAgent and spawnAdhocSubAgent.
 *
 * File location: src/main/lib/subAgent/subAgentStepHandler.ts
 */

import type { SubAgentStepUpdate } from './types';
import type {
  SubAgentRuntimeState,
  SubAgentStep,
} from '../userDataADO/types/profile';

/**
 * Apply a step update to a SubAgentRuntimeState in place.
 *
 * Handles: tool_start, tool_done, tool_error, text, turn_start, llm_streaming.
 * Performs FIFO eviction when steps exceed maxSteps.
 */
export function applyStepUpdate(
  state: SubAgentRuntimeState,
  update: SubAgentStepUpdate,
  maxSteps: number,
): void {
  if (update.type === 'tool_start') {
    state.streamingText = undefined;
    const step: SubAgentStep = {
      type: 'tool_start',
      toolCallId: update.toolCallId,
      toolName: update.toolName,
      toolArgsSummary: update.toolArgsSummary,
      turn: update.turn,
      timestamp: Date.now(),
    };
    state.steps.push(step);
  } else if (update.type === 'tool_done' || update.type === 'tool_error') {
    const idx = state.steps.findIndex(
      s => s.toolCallId === update.toolCallId && s.type === 'tool_start'
    );
    if (idx !== -1) {
      state.steps[idx] = {
        ...state.steps[idx],
        type: update.type,
        durationMs: update.durationMs,
        toolResultLength: update.toolResultLength,
        timestamp: Date.now(),
      };
    } else {
      state.steps.push({
        type: update.type,
        toolCallId: update.toolCallId,
        toolName: update.toolName,
        turn: update.turn,
        timestamp: Date.now(),
        durationMs: update.durationMs,
        toolResultLength: update.toolResultLength,
      });
    }
  } else if (update.type === 'text') {
    state.lastTextSnippet = update.lastTextSnippet;
    state.streamingText = undefined;
  } else if (update.type === 'turn_start') {
    state.streamingText = undefined;
  } else if (update.type === 'llm_streaming') {
    state.streamingText = update.streamingText;
  }

  // FIFO eviction
  if (state.steps.length > maxSteps) {
    state.steps = state.steps.slice(-maxSteps);
  }

  // Update turn
  state.currentTurn = update.turn;
}
