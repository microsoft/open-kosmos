/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AgentQuestionForm.tsx
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockSubmitAnswer = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ── Dependency mocks ──────────────────────────────────────────────────────────
vi.mock('../../../states/doctor.atom', () => ({
  doctorAnalyzeAtom: {
    useChange: () => ({ submitAnswer: mockSubmitAnswer }),
  },
}));

vi.mock('../../ui/button', () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button
      data-testid="submit-btn"
      onClick={onClick}
      disabled={disabled}
      type={type}
    >
      {children}
    </button>
  ),
}));

vi.mock('../Icon', () => ({
  doctor_icon: <svg data-testid="doctor-icon" />,
}));

// ── import component ──────────────────────────────────────────────────────────
import AgentQuestionForm from '../AgentQuestionForm';
import type { AgentQuestionPayload } from '@shared/ipc/doctor';

// ── helpers ───────────────────────────────────────────────────────────────────
function makeTextPayload(): AgentQuestionPayload {
  return {
    taskId: 'task-1',
    questions: [
      {
        id: 'q1',
        text: 'What is your issue?',
        inputType: 'text',
        placeholder: 'Describe the issue...',
        required: true,
      },
    ],
  };
}

function makeSingleSelectPayload(): AgentQuestionPayload {
  return {
    taskId: 'task-2',
    questions: [
      {
        id: 'q1',
        text: 'How severe is the issue?',
        inputType: 'single_select',
        options: ['Low', 'Medium', 'High'],
        required: true,
      },
    ],
  };
}

function makeMultiSelectPayload(): AgentQuestionPayload {
  return {
    taskId: 'task-3',
    questions: [
      {
        id: 'q1',
        text: 'Which components are affected?',
        inputType: 'multi_select',
        options: ['UI', 'API', 'Database'],
        required: true,
      },
    ],
  };
}

describe('AgentQuestionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Renders header ────────────────────────────────────────────────────────
  it('renders doctor header', () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    expect(screen.getByText("Doctor needs your input")).toBeInTheDocument();
    expect(screen.getByTestId('doctor-icon')).toBeInTheDocument();
  });

  // ── Text question renders ─────────────────────────────────────────────────
  it('renders text question with label and textarea', () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    expect(screen.getByText('What is your issue?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe the issue...')).toBeInTheDocument();
  });

  // ── Required indicator ────────────────────────────────────────────────────
  it('shows required asterisk for required questions', () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    const asterisk = document.querySelector('.text-red-500');
    expect(asterisk).toBeInTheDocument();
    expect(asterisk?.textContent).toBe('*');
  });

  // ── No required asterisk for optional questions ────────────────────────────
  it('does not show asterisk for optional questions', () => {
    const payload: AgentQuestionPayload = {
      taskId: 'task-x',
      questions: [
        { id: 'q1', text: 'Optional question', inputType: 'text', required: false },
      ],
    };
    render(<AgentQuestionForm payload={payload} />);
    expect(document.querySelector('.text-red-500')).not.toBeInTheDocument();
  });

  // ── Submit disabled when required text empty ──────────────────────────────
  it('submit button is disabled when required text field is empty', () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    expect(screen.getByTestId('submit-btn')).toBeDisabled();
  });

  // ── Submit enabled after filling text ────────────────────────────────────
  it('enables submit after filling required text field', () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    const textarea = screen.getByPlaceholderText('Describe the issue...');
    fireEvent.change(textarea, { target: { value: 'Something broke' } });
    expect(screen.getByTestId('submit-btn')).not.toBeDisabled();
  });

  // ── Whitespace-only text does not enable submit ───────────────────────────
  it('keeps submit disabled when text is only whitespace', () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    const textarea = screen.getByPlaceholderText('Describe the issue...');
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(screen.getByTestId('submit-btn')).toBeDisabled();
  });

  // ── Single select: renders options ───────────────────────────────────────
  it('renders radio options for single_select question', () => {
    render(<AgentQuestionForm payload={makeSingleSelectPayload()} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  // ── Single select: selecting option enables submit ────────────────────────
  it('enables submit after selecting a single_select option', () => {
    render(<AgentQuestionForm payload={makeSingleSelectPayload()} />);
    expect(screen.getByTestId('submit-btn')).toBeDisabled();
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]); // click "Medium"
    expect(screen.getByTestId('submit-btn')).not.toBeDisabled();
  });

  // ── Multi select: renders checkboxes ─────────────────────────────────────
  it('renders checkboxes for multi_select question', () => {
    render(<AgentQuestionForm payload={makeMultiSelectPayload()} />);
    expect(screen.getByText('UI')).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
  });

  // ── Multi select: selecting options enables submit ─────────────────────────
  it('enables submit after selecting a multi_select option', () => {
    render(<AgentQuestionForm payload={makeMultiSelectPayload()} />);
    expect(screen.getByTestId('submit-btn')).toBeDisabled();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // select UI
    expect(screen.getByTestId('submit-btn')).not.toBeDisabled();
  });

  // ── Multi select: unchecking all disables submit ──────────────────────────
  it('disables submit after unchecking all multi_select options', () => {
    render(<AgentQuestionForm payload={makeMultiSelectPayload()} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // select
    expect(screen.getByTestId('submit-btn')).not.toBeDisabled();
    fireEvent.click(checkboxes[0]); // unselect
    expect(screen.getByTestId('submit-btn')).toBeDisabled();
  });

  // ── Submit calls analyzeActions.submitAnswer ──────────────────────────────
  it('calls submitAnswer with answers on submit', async () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    const textarea = screen.getByPlaceholderText('Describe the issue...');
    fireEvent.change(textarea, { target: { value: 'My issue' } });
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(mockSubmitAnswer).toHaveBeenCalledWith({ q1: 'My issue' });
    });
  });

  // ── Submitting state shows "Submitting..." ────────────────────────────────
  it('shows Submitting... while submitting', async () => {
    let resolveSubmit: any;
    mockSubmitAnswer.mockReturnValue(new Promise((r) => { resolveSubmit = r; }));
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    const textarea = screen.getByPlaceholderText('Describe the issue...');
    fireEvent.change(textarea, { target: { value: 'My issue' } });
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('submit-btn')).toHaveTextContent('Submitting...');
    });
    resolveSubmit(undefined);
  });

  // ── Submit disabled while already submitting ──────────────────────────────
  it('disables submit button while submitting is in progress', async () => {
    let resolveSubmit: any;
    mockSubmitAnswer.mockReturnValue(new Promise((r) => { resolveSubmit = r; }));
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    const textarea = screen.getByPlaceholderText('Describe the issue...');
    fireEvent.change(textarea, { target: { value: 'My issue' } });
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('submit-btn')).toBeDisabled();
    });
    resolveSubmit(undefined);
  });

  // ── Submit while canSubmit=false: no-op ───────────────────────────────────
  it('does not call submitAnswer when submit is disabled', () => {
    render(<AgentQuestionForm payload={makeTextPayload()} />);
    // The button is disabled, clicking shouldn't call submitAnswer
    fireEvent.click(screen.getByTestId('submit-btn'));
    expect(mockSubmitAnswer).not.toHaveBeenCalled();
  });

  // ── Multi select: submit with selected values ─────────────────────────────
  it('submits correct array for multi_select', async () => {
    render(<AgentQuestionForm payload={makeMultiSelectPayload()} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // UI
    fireEvent.click(checkboxes[2]); // Database
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(mockSubmitAnswer).toHaveBeenCalledWith({ q1: ['UI', 'Database'] });
    });
  });

  // ── Single select: submit with selected value ─────────────────────────────
  it('submits correct string for single_select', async () => {
    render(<AgentQuestionForm payload={makeSingleSelectPayload()} />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[2]); // High
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(mockSubmitAnswer).toHaveBeenCalledWith({ q1: 'High' });
    });
  });

  // ── Payload change resets answers ─────────────────────────────────────────
  it('resets answers when payload taskId changes', () => {
    const payload1 = makeTextPayload();
    const { rerender } = render(<AgentQuestionForm payload={payload1} />);

    const textarea = screen.getByPlaceholderText('Describe the issue...');
    fireEvent.change(textarea, { target: { value: 'Old answer' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('Old answer');

    const payload2: AgentQuestionPayload = {
      taskId: 'task-99',
      questions: [
        { id: 'q1', text: 'New question?', inputType: 'text', placeholder: 'New placeholder' },
      ],
    };
    rerender(<AgentQuestionForm payload={payload2} />);

    const newTextarea = screen.getByPlaceholderText('New placeholder');
    expect((newTextarea as HTMLTextAreaElement).value).toBe('');
  });

  // ── Multiple questions ────────────────────────────────────────────────────
  it('renders multiple questions', () => {
    const payload: AgentQuestionPayload = {
      taskId: 'task-multi',
      questions: [
        { id: 'q1', text: 'Question 1?', inputType: 'text', required: true },
        { id: 'q2', text: 'Question 2?', inputType: 'single_select', options: ['A', 'B'], required: true },
        { id: 'q3', text: 'Question 3?', inputType: 'multi_select', options: ['X', 'Y'], required: false },
      ],
    };
    render(<AgentQuestionForm payload={payload} />);
    expect(screen.getByText('Question 1?')).toBeInTheDocument();
    expect(screen.getByText('Question 2?')).toBeInTheDocument();
    expect(screen.getByText('Question 3?')).toBeInTheDocument();
  });

  // ── All required filled: submit enabled ───────────────────────────────────
  it('enables submit when all required questions are answered', () => {
    const payload: AgentQuestionPayload = {
      taskId: 'task-all',
      questions: [
        { id: 'q1', text: 'Q1?', inputType: 'text', required: true },
        { id: 'q2', text: 'Q2?', inputType: 'single_select', options: ['A', 'B'], required: true },
        { id: 'q3', text: 'Q3 optional?', inputType: 'text', required: false },
      ],
    };
    render(<AgentQuestionForm payload={payload} />);
    // Fill q1 (the first textarea)
    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[0], { target: { value: 'answer' } });
    // Select q2
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]);
    expect(screen.getByTestId('submit-btn')).not.toBeDisabled();
  });
});
