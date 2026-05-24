import type { ChoiceInteractionOption, InteractiveRequestSource } from './interactiveRequestTypes';

export type InteractiveInputControl =
  | 'text'
  | 'textarea'
  | 'time'
  | 'folder'
  | 'file'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'multiselect';

export interface ChoiceInteractiveInputSchema {
  kind: 'choice';
  mode: 'single' | 'multi';
  options: ChoiceInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
}

export interface FormInteractiveInputFieldSchema {
  key: string;
  label: string;
  control: InteractiveInputControl;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: string | number | boolean | string[];
  options?: ChoiceInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
}

export interface FormInteractiveInputSchema {
  kind: 'form';
  fields: FormInteractiveInputFieldSchema[];
}

export type InteractiveInputSchema = ChoiceInteractiveInputSchema | FormInteractiveInputSchema;

export interface RequestInteractiveInputArgs {
  title: string;
  description?: string;
  source?: InteractiveRequestSource;
  submitLabel?: string;
  skipLabel?: string;
  schema: InteractiveInputSchema;
}

export interface RequestInteractiveInputToolResult {
  success: boolean;
  interactive_request?: RequestInteractiveInputArgs;
  error?: string;
  message?: string;
}