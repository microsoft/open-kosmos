// @ts-nocheck
import { describe, it, expect, beforeEach } from 'vitest';
import { applyStepUpdate } from '../subAgentStepHandler';

function makeState(steps = []) {
  return { steps, currentTurn: 0, streamingText: undefined, lastTextSnippet: undefined };
}

describe('applyStepUpdate', () => {
  it('tool_start — clears streamingText and pushes step with correct fields', () => {
    const state = makeState();
    state.streamingText = 'old';
    applyStepUpdate(state, {
      type: 'tool_start',
      toolCallId: 'tc1',
      toolName: 'search',
      toolArgsSummary: 'q=hello',
      turn: 2,
    }, 10);
    expect(state.streamingText).toBeUndefined();
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({
      type: 'tool_start',
      toolCallId: 'tc1',
      toolName: 'search',
      toolArgsSummary: 'q=hello',
      turn: 2,
    });
    expect(typeof state.steps[0].timestamp).toBe('number');
    expect(state.currentTurn).toBe(2);
  });

  it('tool_done — finds existing tool_start by toolCallId and updates in-place', () => {
    const state = makeState([
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'search', turn: 1, timestamp: 100 },
    ]);
    applyStepUpdate(state, {
      type: 'tool_done',
      toolCallId: 'tc1',
      toolName: 'search',
      turn: 1,
      durationMs: 42,
      toolResultLength: 99,
    }, 10);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].type).toBe('tool_done');
    expect(state.steps[0].durationMs).toBe(42);
    expect(state.steps[0].toolResultLength).toBe(99);
  });

  it('tool_done — pushes new step when no matching tool_start exists', () => {
    const state = makeState();
    applyStepUpdate(state, {
      type: 'tool_done',
      toolCallId: 'tc99',
      toolName: 'read',
      turn: 3,
      durationMs: 5,
      toolResultLength: 10,
    }, 10);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({
      type: 'tool_done',
      toolCallId: 'tc99',
      toolName: 'read',
      turn: 3,
      durationMs: 5,
      toolResultLength: 10,
    });
  });

  it('tool_error — finds existing tool_start and updates in-place', () => {
    const state = makeState([
      { type: 'tool_start', toolCallId: 'tc2', toolName: 'run', turn: 1, timestamp: 100 },
    ]);
    applyStepUpdate(state, {
      type: 'tool_error',
      toolCallId: 'tc2',
      toolName: 'run',
      turn: 1,
      durationMs: 7,
      toolResultLength: 0,
    }, 10);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].type).toBe('tool_error');
  });

  it('tool_error — pushes new step when no matching tool_start exists', () => {
    const state = makeState();
    applyStepUpdate(state, {
      type: 'tool_error',
      toolCallId: 'tc3',
      toolName: 'run',
      turn: 2,
      durationMs: 1,
      toolResultLength: 0,
    }, 10);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].type).toBe('tool_error');
  });

  it('text — sets lastTextSnippet and clears streamingText', () => {
    const state = makeState();
    state.streamingText = 'streaming...';
    applyStepUpdate(state, { type: 'text', lastTextSnippet: 'hello world', turn: 1 }, 10);
    expect(state.lastTextSnippet).toBe('hello world');
    expect(state.streamingText).toBeUndefined();
    expect(state.currentTurn).toBe(1);
  });

  it('turn_start — clears streamingText', () => {
    const state = makeState();
    state.streamingText = 'in progress';
    applyStepUpdate(state, { type: 'turn_start', turn: 4 }, 10);
    expect(state.streamingText).toBeUndefined();
    expect(state.currentTurn).toBe(4);
  });

  it('llm_streaming — sets streamingText', () => {
    const state = makeState();
    applyStepUpdate(state, { type: 'llm_streaming', streamingText: 'thinking...', turn: 5 }, 10);
    expect(state.streamingText).toBe('thinking...');
    expect(state.currentTurn).toBe(5);
  });

  it('FIFO eviction — keeps only last maxSteps when exceeded', () => {
    const state = makeState();
    for (let i = 0; i < 5; i++) {
      applyStepUpdate(state, {
        type: 'tool_start',
        toolCallId: `tc${i}`,
        toolName: 'tool',
        toolArgsSummary: '',
        turn: i,
      }, 3);
    }
    expect(state.steps).toHaveLength(3);
    expect(state.steps[0].toolCallId).toBe('tc2');
    expect(state.steps[2].toolCallId).toBe('tc4');
  });

  it('currentTurn always updated from update.turn', () => {
    const state = makeState();
    applyStepUpdate(state, { type: 'turn_start', turn: 7 }, 10);
    expect(state.currentTurn).toBe(7);
    applyStepUpdate(state, { type: 'llm_streaming', streamingText: 'x', turn: 9 }, 10);
    expect(state.currentTurn).toBe(9);
  });
});
