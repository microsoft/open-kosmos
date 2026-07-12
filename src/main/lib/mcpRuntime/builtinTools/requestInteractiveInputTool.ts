import { z } from 'zod';
import type {
  RequestInteractiveInputArgs,
  RequestInteractiveInputToolResult,
} from '@shared/types/requestInteractiveInputTypes';
import { BuiltinToolDefinition } from './types';

const choiceOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
});

const choiceSchema = z.object({
  kind: z.literal('choice'),
  mode: z.enum(['single', 'multi']),
  options: z.array(choiceOptionSchema).min(1),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
});

const formFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  control: z.enum(['text', 'textarea', 'time', 'folder', 'file', 'number', 'checkbox', 'select', 'multiselect']),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  options: z.array(choiceOptionSchema).optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
});

const formSchema = z.object({
  kind: z.literal('form'),
  fields: z.array(formFieldSchema).min(1),
});

const requestInteractiveInputArgsSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(['assistant', 'tool', 'system']).optional(),
  submitLabel: z.string().min(1).optional(),
  skipLabel: z.string().min(1).optional(),
  metadata: z.object({}).passthrough().optional(),
  schema: z.discriminatedUnion('kind', [choiceSchema, formSchema]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeChoiceOption(option: unknown): unknown {
  if (typeof option === 'string') {
    return {
      value: option,
      label: option,
    };
  }

  if (!isRecord(option)) {
    return option;
  }

  const value = typeof option.value === 'string'
    ? option.value
    : typeof option.label === 'string'
      ? option.label
      : undefined;
  const label = typeof option.label === 'string'
    ? option.label
    : typeof option.value === 'string'
      ? option.value
      : undefined;

  return {
    ...option,
    ...(value ? { value } : {}),
    ...(label ? { label } : {}),
  };
}

function normalizeChoiceOptions(options: unknown): unknown {
  if (!Array.isArray(options)) {
    return options;
  }

  return options.map((option) => normalizeChoiceOption(option));
}

const FOLDER_PATH_PATTERN = /\b(folder|directory|dir|working.?path|work.?dir|output.?path|output.?dir|root.?path|base.?path|project.?path|workspace|install.?path|install.?dir|save.?dir|save.?path|dest.?dir|dest.?path|target.?dir|target.?path)\b/i;
const FILE_PATH_PATTERN = /\b(file.?path|file.?location|config.?file|log.?file|input.?file|output.?file|script.?path|template.?file|cert.?file|key.?file|credential.?file)\b/i;

function inferPathControl(field: Record<string, unknown>): 'folder' | 'file' | null {
  const signals = [field.key, field.label, field.description, field.placeholder]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');

  if (FOLDER_PATH_PATTERN.test(signals)) {
    return 'folder';
  }

  if (FILE_PATH_PATTERN.test(signals)) {
    return 'file';
  }

  return null;
}

function normalizeFormField(field: unknown): unknown {
  if (!isRecord(field)) {
    return field;
  }

  const normalizedKey = typeof field.key === 'string'
    ? field.key
    : typeof field.id === 'string'
      ? field.id
      : typeof field.fieldName === 'string'
        ? field.fieldName
        : typeof field.name === 'string'
          ? field.name
          : field.key;

  let control = field.control;
  if (control === 'email') {
    control = 'text';
  }
  if (control === 'text' || control === undefined) {
    const inferred = inferPathControl(field);
    if (inferred) {
      control = inferred;
    }
  }

  return {
    ...field,
    key: normalizedKey,
    control,
    options: normalizeChoiceOptions(field.options),
  };
}

function normalizeInteractiveInputArgs(args: unknown): unknown {
  if (!isRecord(args) || !isRecord(args.schema)) {
    return args;
  }

  if (args.schema.kind === 'choice') {
    const normalizedDescription = typeof args.description === 'string'
      ? args.description
      : typeof args.schema.question === 'string'
        ? args.schema.question
        : args.description;

    return {
      ...args,
      ...(normalizedDescription ? { description: normalizedDescription } : {}),
      schema: {
        ...args.schema,
        options: normalizeChoiceOptions(args.schema.options),
      },
    };
  }

  if (args.schema.kind === 'form' && Array.isArray(args.schema.fields)) {
    return {
      ...args,
      schema: {
        ...args.schema,
        fields: args.schema.fields.map((field) => normalizeFormField(field)),
      },
    };
  }

  return args;
}

function validateNormalizedArgs(args: RequestInteractiveInputArgs): string | null {
  if (args.schema.kind === 'choice') {
    if (
      typeof args.schema.minSelections === 'number' &&
      typeof args.schema.maxSelections === 'number' &&
      args.schema.minSelections > args.schema.maxSelections
    ) {
      return 'minSelections must be less than or equal to maxSelections';
    }

    return null;
  }

  const seenKeys = new Set<string>();
  for (const field of args.schema.fields) {
    if (seenKeys.has(field.key)) {
      return `Duplicate field key: ${field.key}`;
    }
    seenKeys.add(field.key);

    const needsOptions = field.control === 'select' || field.control === 'multiselect';
    if (needsOptions && (!field.options || field.options.length === 0)) {
      return `options are required for ${field.control} controls`;
    }

    if (
      typeof field.minSelections === 'number' &&
      typeof field.maxSelections === 'number' &&
      field.minSelections > field.maxSelections
    ) {
      return `minSelections must be less than or equal to maxSelections for field ${field.key}`;
    }
  }

  return null;
}

export class RequestInteractiveInputTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'request_interactive_input',
      description:
        'Request structured user input during the current chat turn. Use this tool when you know the missing information and can describe it as a controlled choice or form schema. Do not ask follow-up questions in plain assistant text when a structured interaction card would be clearer. The tool returns only validated schema metadata; the main chat runtime will pause, render the card, collect the user response, and continue the turn.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title shown at the top of the interaction card.' },
          description: { type: 'string', description: 'Optional supporting explanation. HTML is allowed for existing chat card rendering.' },
          source: {
            type: 'string',
            enum: ['assistant', 'tool', 'system'],
            description: 'Logical source of the request. Defaults to assistant.',
          },
          submitLabel: { type: 'string', description: 'Optional custom label for the submit button.' },
          skipLabel: { type: 'string', description: 'Optional custom label for the skip button.' },
          metadata: {
            type: 'object',
            description: 'Optional runtime metadata consumed by the host; use only when another tool explicitly provided it.',
            additionalProperties: true,
          },
          schema: {
            type: 'object',
            description: 'Structured interaction schema. Set kind="choice" for a single question with selectable options, or kind="form" for structured multi-field input.',
            properties: {
              kind: {
                type: 'string',
                enum: ['choice', 'form'],
                description: 'The type of interaction. "choice" renders selectable option cards. "form" renders a multi-field input form.',
              },
              mode: {
                type: 'string',
                enum: ['single', 'multi'],
                description: 'For kind="choice" only. Use "single" when the user should pick exactly one option. Use "multi" when the user may select multiple options.',
              },
              options: {
                type: 'array',
                description: 'For kind="choice" only. The available choices. Each option can be a string (used as both value and label) or an object with value, label, description?, disabled?.',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string', description: 'The value returned when this option is selected.' },
                    label: { type: 'string', description: 'Display text for this option.' },
                    description: { type: 'string', description: 'Optional explanation shown below the label.' },
                    disabled: { type: 'boolean', description: 'If true, the option is shown but not selectable.' },
                  },
                  required: ['value', 'label'],
                },
                minItems: 1,
              },
              minSelections: { type: 'number', description: 'For kind="choice" or multiselect form fields. Minimum number of selections required.' },
              maxSelections: { type: 'number', description: 'For kind="choice" or multiselect form fields. Maximum number of selections allowed.' },
              fields: {
                type: 'array',
                description: 'For kind="form" only. The form fields to display.',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string', description: 'Unique field identifier used as the key in the returned form values.' },
                    label: { type: 'string', description: 'Display label for this field.' },
                    control: {
                      type: 'string',
                      enum: ['text', 'textarea', 'time', 'folder', 'file', 'number', 'checkbox', 'select', 'multiselect'],
                      description: 'Input control type. Use "time" for HH:MM selection, "folder" for a native folder picker, "file" for a native file picker, "select" for single-choice dropdown, "multiselect" for multi-choice.',
                    },
                    required: { type: 'boolean', description: 'Whether this field must be filled before submission.' },
                    placeholder: { type: 'string', description: 'Placeholder text shown inside the input.' },
                    description: { type: 'string', description: 'Help text shown below the label.' },
                    defaultValue: { description: 'Default value for the field. Can be a string, number, boolean, or array of strings.' },
                    options: {
                      type: 'array',
                      description: 'Available choices for select/multiselect controls.',
                      items: {
                        type: 'object',
                        properties: {
                          value: { type: 'string' },
                          label: { type: 'string' },
                          description: { type: 'string' },
                          disabled: { type: 'boolean' },
                        },
                        required: ['value', 'label'],
                      },
                    },
                    minSelections: { type: 'number', description: 'Minimum selections for multiselect controls.' },
                    maxSelections: { type: 'number', description: 'Maximum selections for multiselect controls.' },
                  },
                  required: ['key', 'label', 'control'],
                },
                minItems: 1,
              },
            },
            required: ['kind'],
            oneOf: [
              {
                properties: {
                  kind: { type: 'string', enum: ['choice'] },
                },
                required: ['kind', 'mode', 'options'],
              },
              {
                properties: {
                  kind: { type: 'string', enum: ['form'] },
                },
                required: ['kind', 'fields'],
              },
            ],
          },
        },
        required: ['title', 'schema'],
      },
    };
  }

  static async execute(args: unknown): Promise<RequestInteractiveInputToolResult> {
    const parsed = requestInteractiveInputArgsSchema.safeParse(normalizeInteractiveInputArgs(args));
    if (!parsed.success) {
      return {
        success: false,
        error: 'INVALID_INPUT',
        message: parsed.error.issues
          .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
          })
          .join('; '),
      };
    }

    const normalizedArgs = {
      ...parsed.data,
      source: parsed.data.source || 'assistant',
      submitLabel: parsed.data.submitLabel || 'Continue',
      skipLabel: parsed.data.skipLabel || 'Skip',
      schema: parsed.data.schema.kind === 'choice'
        ? {
            ...parsed.data.schema,
            minSelections: typeof parsed.data.schema.minSelections === 'number'
              ? parsed.data.schema.minSelections
              : parsed.data.schema.mode === 'single' ? 1 : 0,
            maxSelections: typeof parsed.data.schema.maxSelections === 'number'
              ? parsed.data.schema.maxSelections
              : parsed.data.schema.mode === 'single' ? 1 : undefined,
          }
        : parsed.data.schema,
    };

    const validationError = validateNormalizedArgs(normalizedArgs as RequestInteractiveInputArgs);
    if (validationError) {
      return {
        success: false,
        error: 'INVALID_INPUT',
        message: validationError,
      };
    }

    return {
      success: true,
      interactive_request: normalizedArgs as RequestInteractiveInputArgs,
    };
  }
}