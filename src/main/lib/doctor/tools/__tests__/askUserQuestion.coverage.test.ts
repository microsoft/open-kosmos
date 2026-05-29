import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock doctorManager before importing the module
const mockAskUserQuestion = vi.hoisted(() => vi.fn());
vi.mock('../../manager', () => ({
  doctorManager: {
    askUserQuestion: mockAskUserQuestion,
  },
}));

import { executeAskUserQuestion, askUserQuestionToolDef } from '../askUserQuestion';

describe('askUserQuestionToolDef', () => {
  it('has the correct tool name', () => {
    expect(askUserQuestionToolDef.function.name).toBe('ask_user_question');
  });

  it('is a function type', () => {
    expect(askUserQuestionToolDef.type).toBe('function');
  });
});

describe('executeAskUserQuestion', () => {
  const context = { taskId: 'task-1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error JSON when no valid questions provided', async () => {
    const result = await executeAskUserQuestion({ questions: [] }, context);
    expect(JSON.parse(result)).toEqual({ error: 'No valid questions provided.' });
  });

  it('filters out questions with unknown inputType', async () => {
    const result = await executeAskUserQuestion({
      questions: [{ id: 'q1', text: 'What?', inputType: 'unknown' as any }],
    }, context);
    expect(JSON.parse(result)).toEqual({ error: 'No valid questions provided.' });
  });

  it('filters single_select with no options', async () => {
    const result = await executeAskUserQuestion({
      questions: [{ id: 'q1', text: 'Pick one', inputType: 'single_select', options: [] }],
    }, context);
    expect(JSON.parse(result)).toEqual({ error: 'No valid questions provided.' });
  });

  it('passes text questions through', async () => {
    mockAskUserQuestion.mockResolvedValue([{ id: 'q1', answer: 'blue' }]);
    const result = await executeAskUserQuestion({
      questions: [{ id: 'q1', text: 'Color?', inputType: 'text' }],
    }, context);
    expect(mockAskUserQuestion).toHaveBeenCalledWith('task-1', [
      { id: 'q1', text: 'Color?', required: true, inputType: 'text', placeholder: undefined },
    ]);
    expect(JSON.parse(result)).toEqual({ answers: [{ id: 'q1', answer: 'blue' }] });
  });

  it('passes single_select questions through', async () => {
    mockAskUserQuestion.mockResolvedValue([]);
    await executeAskUserQuestion({
      questions: [{
        id: 'q1',
        text: 'Pick one',
        inputType: 'single_select',
        options: ['A', 'B'],
        required: false,
      }],
    }, context);
    expect(mockAskUserQuestion).toHaveBeenCalledWith('task-1', [
      { id: 'q1', text: 'Pick one', required: false, inputType: 'single_select', options: ['A', 'B'] },
    ]);
  });

  it('passes multi_select questions through', async () => {
    mockAskUserQuestion.mockResolvedValue([]);
    await executeAskUserQuestion({
      questions: [{ id: 'q1', text: 'Pick many', inputType: 'multi_select', options: ['X', 'Y'] }],
    }, context);
    expect(mockAskUserQuestion).toHaveBeenCalledWith('task-1', [
      { id: 'q1', text: 'Pick many', required: true, inputType: 'multi_select', options: ['X', 'Y'] },
    ]);
  });

  it('tolerates snake_case input_type from LLM', async () => {
    mockAskUserQuestion.mockResolvedValue([]);
    await executeAskUserQuestion({
      questions: [{ id: 'q1', text: 'Free text', input_type: 'text' } as any],
    }, context);
    expect(mockAskUserQuestion).toHaveBeenCalled();
  });
});
