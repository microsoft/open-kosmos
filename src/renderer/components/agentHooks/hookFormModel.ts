import type {
  AgentHookEvent,
  CommandHookAction,
  CreateHookInput,
  HookAction,
  HttpHookAction,
  HttpHookMethod,
  HookDefinition,
  UpdateHookInput,
} from '@shared/ipc/agentHooks';
import { translate, type TranslationKey, type TranslationParams } from '../../lib/i18n';

/**
 * Pure form model for the Agent Hooks editor. Keeps all mapping, defaulting, and
 * client-side validation out of the React components so each branch is unit
 * testable and the components stay "boring". The main process re-validates every
 * field, so this layer is purely for UX feedback and shaping the IPC payload.
 *
 * Each Hook is flat: exactly one event, one optional matcher, and one action.
 */

export const HOOK_EVENTS: readonly AgentHookEvent[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PreCompact',
  'PostCompact',
];

export type HookActionType = 'command' | 'http';

export const HOOK_ACTION_TYPES: readonly HookActionType[] = ['command', 'http'];

export const HOOK_HTTP_METHODS: readonly HttpHookMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** One editable Hook operation: one event, one optional matcher, and one action. */
export interface HookOperationForm {
  event: AgentHookEvent;
  matcher: string;
  actionType: HookActionType;
  /** Optional permission-rule condition (using actual OpenKosmos tool names), evaluated on tool events. */
  ifCondition: string;
  /** Command for `command` actions. */
  command: string;
  /** When true, persist command args and run without a shell. */
  execForm: boolean;
  /** Newline-delimited exec-form arguments for `command` actions. */
  argsText: string;
  /** URL for `http` actions. */
  url: string;
  /** HTTP method for `http` actions. */
  method: HttpHookMethod;
  /** Newline-delimited `Key: Value` header text for `http` actions. */
  headersText: string;
  /** Literal request body for `http` actions. */
  body: string;
  /** Raw text input in official hook timeout seconds; converted to a number at save time. */
  timeout: string;
  async: boolean;
}

export interface HookFormState {
  name: string;
  description: string;
  enabled: boolean;
  operation: HookOperationForm;
}

export function emptyOperationForm(): HookOperationForm {
  return {
    event: 'PreToolUse',
    matcher: '',
    actionType: 'command',
    ifCondition: '',
    command: '',
    execForm: false,
    argsText: '',
    url: '',
    method: 'POST',
    headersText: '',
    body: '',
    timeout: '',
    async: false,
  };
}

export function emptyFormState(): HookFormState {
  return {
    name: '',
    description: '',
    enabled: false,
    operation: emptyOperationForm(),
  };
}

/** Serialize a header record into newline-delimited `Key: Value` text. */
export function headersToText(headers: Record<string, string> | undefined): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

/** Parse newline-delimited `Key: Value` header text into a record. */
export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key !== '') headers[key] = value;
  }
  return headers;
}

function timeoutToText(action: CommandHookAction | HttpHookAction): string {
  if (action.timeout !== undefined) return String(action.timeout);
  if (action.timeoutMs !== undefined) return String(action.timeoutMs / 1000);
  return '';
}

function operationFromCommandAction(hook: HookDefinition, action: CommandHookAction): HookOperationForm {
  const operation = emptyOperationForm();
  operation.event = hook.event;
  operation.matcher = hook.matcher ?? '';
  operation.actionType = 'command';
  operation.ifCondition = action.if ?? '';
  operation.command = action.command;
  operation.execForm = Array.isArray(action.args);
  operation.argsText = action.args?.join('\n') ?? '';
  operation.timeout = timeoutToText(action);
  operation.async = action.async === true;
  return operation;
}

function operationFromHttpAction(hook: HookDefinition, action: HttpHookAction): HookOperationForm {
  const operation = emptyOperationForm();
  operation.event = hook.event;
  operation.matcher = hook.matcher ?? '';
  operation.actionType = 'http';
  operation.ifCondition = action.if ?? '';
  operation.url = action.url;
  operation.method = action.method ?? 'POST';
  operation.headersText = headersToText(action.headers);
  operation.body = action.body ?? '';
  operation.timeout = timeoutToText(action);
  operation.async = action.async === true;
  return operation;
}

/** Project a persisted Hook into one editable operation. */
export function hookToFormState(hook: HookDefinition): HookFormState {
  const operation = hook.action.type === 'http'
    ? operationFromHttpAction(hook, hook.action)
    : operationFromCommandAction(hook, hook.action);
  return {
    name: hook.name,
    description: hook.description ?? '',
    enabled: hook.enabled,
    operation,
  };
}

function parseTimeout(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function parseArgs(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

/** True when the operation has the minimum content required to persist its action. */
function operationHasAction(operation: HookOperationForm): boolean {
  return operation.actionType === 'http' ? operation.url.trim() !== '' : operation.command.trim() !== '';
}

/** Build the persisted action from the editable operation, or undefined when incomplete. */
export function operationToAction(operation: HookOperationForm): HookAction | undefined {
  const timeout = parseTimeout(operation.timeout);
  const ifCondition = operation.ifCondition.trim();
  if (operation.actionType === 'http') {
    const url = operation.url.trim();
    if (url === '') return undefined;
    const action: HttpHookAction = { type: 'http', url };
    if (ifCondition !== '') action.if = ifCondition;
    action.method = operation.method;
    const headers = parseHeaders(operation.headersText);
    if (Object.keys(headers).length > 0) action.headers = headers;
    if (operation.body.trim() !== '') action.body = operation.body;
    if (timeout !== undefined) action.timeout = timeout;
    if (operation.async) action.async = true;
    return action;
  }
  const command = operation.command.trim();
  if (command === '') return undefined;
  const action: CommandHookAction = { type: 'command', command };
  if (ifCondition !== '') action.if = ifCondition;
  if (operation.execForm) {
    action.args = parseArgs(operation.argsText);
  }
  if (timeout !== undefined) action.timeout = timeout;
  if (operation.async) action.async = true;
  return action;
}

export function formStateToCreateInput(state: HookFormState): CreateHookInput {
  const input: CreateHookInput = {
    name: state.name.trim(),
    enabled: false,
    event: state.operation.event,
  };
  const matcher = state.operation.matcher.trim();
  if (matcher !== '') input.matcher = matcher;
  const action = operationToAction(state.operation);
  if (action) input.action = action;
  const description = state.description.trim();
  if (description !== '') input.description = description;
  return input;
}

export function formStateToUpdatePatch(state: HookFormState): UpdateHookInput {
  const patch: UpdateHookInput = {
    name: state.name.trim(),
    description: state.description.trim(),
    // Saving an edit from the Settings editor always re-enables the hook: the
    // editor no longer exposes a manual enable toggle, and Update auto-enables.
    enabled: true,
    event: state.operation.event,
    matcher: state.operation.matcher.trim(),
  };
  const action = operationToAction(state.operation);
  if (action) patch.action = action;
  return patch;
}

/** Client-side validation. Returns a list of human-readable error messages. */
type TFunction = (key: TranslationKey, params?: TranslationParams) => string;
const fallbackT: TFunction = (key, params) => translate('en', key, params);

export function validateFormState(state: HookFormState, t: TFunction = fallbackT): string[] {
  const errors: string[] = [];
  if (state.name.trim() === '') {
    errors.push(t('agent.hooks.editor.validation.nameRequired'));
  }
  const operation = state.operation;
  if (!operationHasAction(operation)) {
    errors.push(t('agent.hooks.editor.validation.operationRequired'));
  }
  if (operationHasAction(operation)) {
    const timeout = operation.timeout.trim();
    if (timeout !== '' && !Number.isFinite(Number(timeout))) {
      errors.push(t('agent.hooks.editor.validation.timeoutNumber'));
    }
  }
  return errors;
}
