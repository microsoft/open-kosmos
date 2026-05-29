import React, { useState, useCallback, useEffect } from 'react';
import type { AgentQuestionPayload, AgentQuestion, AgentAnswerValue } from '@shared/ipc/doctor';
import { doctorAnalyzeAtom } from '@/states/doctor.atom';
import { Button } from '../ui/button';
import { doctor_icon } from './Icon';

interface Props {
  payload: AgentQuestionPayload;
}

/**
 * Question form rendered inside the indicator's popover.
 * The popover itself enforces non-dismissable behavior; this component just
 * collects answers and submits them.
 */
const AgentQuestionForm: React.FC<Props> = ({ payload }) => {
  const analyzeActions = doctorAnalyzeAtom.useChange();
  const [answers, setAnswers] = useState<Record<string, AgentAnswerValue>>(() =>
    initialAnswers(payload.questions)
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAnswers(initialAnswers(payload.questions));
  }, [payload.taskId, payload.questions]);

  const onText = useCallback((id: string, v: string) => {
    setAnswers((p) => ({ ...p, [id]: v }));
  }, []);
  const onSingle = useCallback((id: string, v: string) => {
    setAnswers((p) => ({ ...p, [id]: v }));
  }, []);
  const onMulti = useCallback((id: string, v: string, checked: boolean) => {
    setAnswers((p) => {
      const cur = (p[id] as string[]) || [];
      return { ...p, [id]: checked ? [...cur, v] : cur.filter((x) => x !== v) };
    });
  }, []);

  const canSubmit = (() => {
    for (const q of payload.questions) {
      if (q.required === false) continue;
      const a = answers[q.id];
      if (!a || (Array.isArray(a) && a.length === 0) || (typeof a === 'string' && a.trim() === '')) {
        return false;
      }
    }
    return true;
  })();

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await analyzeActions.submitAnswer(answers);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, answers, analyzeActions]);

  return (
    <div className="w-[340px] rounded-xl border border-neutral-200 bg-white shadow-2xl shadow-black/15 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100 bg-gradient-to-r from-blue-50 to-violet-50">
        {doctor_icon}
        <div className="text-sm font-semibold text-neutral-900">Doctor needs your input</div>
      </div>

      <div className="px-4 py-4 max-h-[420px] overflow-y-auto flex flex-col gap-4">
        {payload.questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={answers[q.id]}
            onText={onText}
            onSingle={onSingle}
            onMulti={onMulti}
          />
        ))}
      </div>

      <div className="flex justify-end px-4 py-3 border-t border-neutral-100 bg-neutral-50/50">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          size="sm"
          className="bg-neutral-900 text-neutral-50 hover:bg-neutral-800 disabled:bg-neutral-400"
        >
          {submitting ? 'Submitting...' : 'Submit Answer'}
        </Button>
      </div>
    </div>
  );
};

function initialAnswers(questions: AgentQuestion[]): Record<string, AgentAnswerValue> {
  const init: Record<string, AgentAnswerValue> = {};
  for (const q of questions) {
    init[q.id] = q.inputType === 'multi_select' ? [] : '';
  }
  return init;
}

interface FieldProps {
  question: AgentQuestion;
  value: AgentAnswerValue;
  onText: (id: string, v: string) => void;
  onSingle: (id: string, v: string) => void;
  onMulti: (id: string, v: string, checked: boolean) => void;
}
const QuestionField: React.FC<FieldProps> = ({ question, value, onText, onSingle, onMulti }) => (
  <div>
    <label className="mb-2 block text-sm font-medium text-neutral-800">
      {question.text}
      {question.required !== false && <span className="ml-1 text-red-500">*</span>}
    </label>

    {question.inputType === 'text' && (
      <textarea
        value={value as string}
        onChange={(e) => onText(question.id, e.target.value)}
        placeholder={question.placeholder || ''}
        rows={3}
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 resize-y transition-colors hover:border-neutral-300 focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
      />
    )}

    {question.inputType === 'single_select' && (
      <div className="flex flex-col gap-1">
        {question.options.map((opt) => {
          const checked = value === opt;
          return (
            <label
              key={opt}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-sm cursor-pointer transition-colors ${
                checked
                  ? 'border-neutral-900 bg-neutral-50 text-neutral-900'
                  : 'border-neutral-200 text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={checked}
                onChange={() => onSingle(question.id, opt)}
                className="h-4 w-4 text-neutral-900 focus:ring-neutral-900/20"
              />
              <span className="flex-1">{opt}</span>
            </label>
          );
        })}
      </div>
    )}

    {question.inputType === 'multi_select' && (
      <div className="flex flex-col gap-1">
        {question.options.map((opt) => {
          const checked = (value as string[]).includes(opt);
          return (
            <label
              key={opt}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-sm cursor-pointer transition-colors ${
                checked
                  ? 'border-neutral-900 bg-neutral-50 text-neutral-900'
                  : 'border-neutral-200 text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onMulti(question.id, opt, e.target.checked)}
                className="h-4 w-4 rounded text-neutral-900 focus:ring-neutral-900/20"
              />
              <span className="flex-1">{opt}</span>
            </label>
          );
        })}
      </div>
    )}
  </div>
);

export default AgentQuestionForm;
