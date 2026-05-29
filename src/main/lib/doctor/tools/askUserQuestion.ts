/**
 * askUserQuestionTool — ask the user a clarifying question.
 * Pauses the agent loop while waiting for the user to submit answers via the UI.
 */

import type { AgentQuestion, QuestionInputType } from '@shared/ipc/doctor';
import { doctorManager } from '../manager';

export const askUserQuestionToolDef = {
  type: 'function' as const,
  function: {
    name: 'ask_user_question',
    description: `Ask the user one or more clarifying questions when you need more information to analyze the bug. The user will see a dialog with your questions and can respond. Use this sparingly — only when the provided information is truly insufficient. Each question can be single_select (radio), multi_select (checkbox), or text (free input). IMPORTANT: All user-facing strings (question \`text\`, every entry in \`options\`, and \`placeholder\`) MUST be written in English, regardless of the language used elsewhere in this conversation or the system prompt. Field \`id\` is internal and may be any ASCII string.`,
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for this question' },
              text: { type: 'string', description: 'The question text shown to the user. MUST be English.' },
              inputType: {
                type: 'string',
                enum: ['single_select', 'multi_select', 'text'],
                description: 'Input type: single_select (radio), multi_select (checkbox), or text (free input)',
              },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Options for single_select or multi_select (required for those types). Each option MUST be English.',
              },
              placeholder: {
                type: 'string',
                description: 'Placeholder text for text input. MUST be English.',
              },
              required: {
                type: 'boolean',
                description: 'Whether this question must be answered (default true)',
              },
            },
            required: ['id', 'text', 'inputType'],
          },
          description: 'Array of questions to ask the user',
        },
      },
      required: ['questions'],
    },
  },
};

/** Raw question shape returned by the LLM — fields are loose because the model may omit or misname them. */
interface RawQuestion {
  id: string;
  text: string;
  inputType?: string;
  /** The model occasionally uses snake_case; tolerate it. */
  input_type?: string;
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

function normalizeQuestion(raw: RawQuestion): AgentQuestion | null {
  const inputType = (raw.inputType ?? raw.input_type) as QuestionInputType | undefined;
  const required = raw.required ?? true;
  const base = { id: raw.id, text: raw.text, required };

  if (inputType === 'text') {
    return { ...base, inputType: 'text', placeholder: raw.placeholder };
  }
  if (inputType === 'single_select' || inputType === 'multi_select') {
    if (!raw.options || raw.options.length === 0) return null;
    return { ...base, inputType, options: raw.options };
  }
  return null;
}

export async function executeAskUserQuestion(
  args: { questions: RawQuestion[] },
  context: { taskId: string },
): Promise<string> {
  const questions = args.questions
    .map(normalizeQuestion)
    .filter((q): q is AgentQuestion => q !== null);

  if (questions.length === 0) {
    return JSON.stringify({ error: 'No valid questions provided.' });
  }

  const answers = await doctorManager.askUserQuestion(context.taskId, questions);
  return JSON.stringify({ answers });
}
