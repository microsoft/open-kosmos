/**
 * manage_hooks facade — unified Agent Hooks management tool.
 *
 * This tool is registered like other facade tools but is exposed/executable only
 * while the current profile's Hooks master switch is enabled.
 */

import { randomUUID } from 'crypto';
import {
  BuiltinToolDefinition,
  FacadeResult,
  ManageHooksInput,
  errorResult,
} from './types';
import type {
  AgentHookEvent,
  HookAction,
  HookDefinition,
} from '@shared/agentHooks/profileTypes';
import { validateCreateHookInput, validateUpdateHookPatch } from '../../../agentHooks/hookInputValidation';
import { profileCacheManager } from '../../../userDataADO/profileCacheManager';
import { getChatAgents } from '../../../userDataADO/agentAccessor';

const VALID_ACTIONS = [
  'status',
  'list',
  'create',
  'update',
  'delete',
  'disable',
] as const;

const HOOK_EVENTS: AgentHookEvent[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PreCompact',
  'PostCompact',
];

type HookTarget =
  | { hook: HookDefinition; error?: undefined }
  | { hook?: undefined; error: FacadeResult };

export interface ManageHooksExecutionOptions {
  userAlias?: string | null;
}

export class ManageHooksFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'manage_hooks',
      description:
        'Create, update, delete, disable, or list Hooks. ' +
        'Hooks must already be enabled in Settings; this tool cannot toggle the master switch. ' +
        'For safety, hooks created by this tool are disabled until the user enables them in Settings. ' +
        'Enabled or agent-bound hooks must be disabled/deleted from Settings after user review. ' +
        'Hooks are bound to Agents from the Agent editor (like Skills and MCP servers), not from this tool. ' +
        'Each hook binds exactly one event, an optional matcher, and one command or http action.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: VALID_ACTIONS as unknown as string[],
            description: 'The operation to perform. There is intentionally no action to toggle the master switch.',
          },
          hook_id: {
            type: 'string',
            description: 'Hook id. Preferred for update/delete/disable.',
          },
          name: {
            type: 'string',
            description: 'Hook name. For target lookup, must match exactly one existing hook.',
          },
          description: { type: 'string', description: 'Hook description.' },
          enabled: { type: 'boolean', description: 'Only false is accepted; enabling hooks requires the Settings UI.' },
          event: {
            type: 'string',
            enum: HOOK_EVENTS,
            description: 'The single event this hook reacts to.',
          },
          matcher: {
            type: 'string',
            description: 'Optional matcher, such as a tool name or pattern for PreToolUse/PostToolUse.',
          },
          action_type: {
            type: 'string',
            enum: ['command', 'http'],
            description: 'Action type. Inferred from command/url when omitted.',
          },
          if: {
            type: 'string',
            description:
              'Optional permission-rule condition, e.g. "execute_command(rm *)". Only evaluated on tool events.',
          },
          command: { type: 'string', description: 'Command action executable or shell command.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Exec-form command args.' },
          url: { type: 'string', description: 'HTTP action URL.' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method.' },
          headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'HTTP headers.' },
          body: { type: 'string', description: 'HTTP request body.' },
          timeout: { type: 'number', description: 'Timeout in seconds.' },
          async: { type: 'boolean', description: 'Run action fire-and-forget.' },
        },
        required: ['action'],
      },
    };
  }

  static async execute(args: ManageHooksInput, options: ManageHooksExecutionOptions = {}): Promise<FacadeResult> {
    if (!args.action || !(VALID_ACTIONS as readonly string[]).includes(args.action)) {
      return errorResult(
        `Invalid action "${args.action}".`,
        `Valid actions: ${VALID_ACTIONS.join(', ')}`,
      );
    }

    const alias = ManageHooksFacade.resolveUserAlias(options);
    if (!alias) {
      return errorResult('No current user session found.', 'Please ensure you are logged in.');
    }

    switch (args.action) {
      case 'status':
        return ManageHooksFacade.status(alias);
      case 'list':
        return ManageHooksFacade.list(alias);
      case 'create':
        return ManageHooksFacade.create(alias, args);
      case 'update':
        return ManageHooksFacade.update(alias, args);
      case 'delete':
        return ManageHooksFacade.delete(alias, args);
      case 'disable':
        return ManageHooksFacade.setHookEnabled(alias, args, false);
    }
  }

  private static async create(alias: string, args: ManageHooksInput): Promise<FacadeResult> {
    if (!args.name?.trim()) {
      return errorResult('"name" is required for create.', 'Provide a short hook name.');
    }
    if (!args.event) {
      return errorResult('"event" is required for create.', `Provide one of: ${HOOK_EVENTS.join(', ')}.`);
    }
    const action = ManageHooksFacade.buildFlatAction(args);
    if (!action) {
      return errorResult(
        'A command or http action is required for create.',
        'Provide command (+args) for a command action, or url (+method/headers/body) for an http action.',
      );
    }

    const warnings: string[] = [];
    const payload = {
      name: args.name,
      description: args.description,
      enabled: false,
      event: args.event,
      matcher: args.matcher,
      action,
    };

    if (args.enabled === true) {
      warnings.push('Hook was created disabled. Enabling hooks requires manual review in Settings > Hooks.');
    }

    const validation = validateCreateHookInput(payload);
    if (!validation.ok) return errorResult(validation.error);

    const hook = ManageHooksFacade.buildPersistedHook(validation.value);
    const added = await profileCacheManager.addHook(alias, hook);
    if (!added) return errorResult('Failed to create hook.');

    const created = ManageHooksFacade.findHookById(alias, hook.id) ?? hook;
    return {
      success: true,
      message: `Created hook "${created.name}".`,
      hook: created,
      warnings,
      next_actions: ['Review the hook in Settings > Hooks, then enable it manually when ready. Bind it to an agent in the Agent editor.'],
    };
  }

  private static async update(alias: string, args: ManageHooksInput): Promise<FacadeResult> {
    const target = ManageHooksFacade.resolveTarget(alias, args);
    if (target.error) return target.error;
    const hook = target.hook;

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.description !== undefined) patch.description = args.description;
    if (args.enabled === true) {
      return errorResult('Enabling hooks from manage_hooks is not allowed.', 'Open Settings > Hooks to review and enable hooks manually.');
    }
    if (args.enabled === false) {
      const safetyError = ManageHooksFacade.requireSettingsReviewForDisableOrDelete(alias, hook, 'disable');
      if (safetyError) return safetyError;
      patch.enabled = false;
    }
    const action = ManageHooksFacade.buildFlatAction(args);
    const hasOperationChange = args.event !== undefined || args.matcher !== undefined || action !== null;
    if (hook.enabled && hasOperationChange) {
      return errorResult('Enabled hooks cannot be modified from manage_hooks.', 'Disable the hook first, then review and re-enable it manually in Settings.');
    }
    if (args.event !== undefined) patch.event = args.event;
    if (args.matcher !== undefined) patch.matcher = args.matcher;
    if (action) patch.action = action;

    const validation = validateUpdateHookPatch(patch);
    if (!validation.ok) return errorResult(validation.error);
    const updated = await profileCacheManager.updateHook(alias, hook.id, validation.value);
    if (!updated) return errorResult(`Failed to update hook "${hook.name}".`);

    return {
      success: true,
      message: `Updated hook "${hook.name}".`,
      hook: ManageHooksFacade.findHookById(alias, hook.id),
    };
  }

  private static async delete(alias: string, args: ManageHooksInput): Promise<FacadeResult> {
    const target = ManageHooksFacade.resolveTarget(alias, args);
    if (target.error) return target.error;
    const safetyError = ManageHooksFacade.requireSettingsReviewForDisableOrDelete(alias, target.hook, 'delete');
    if (safetyError) return safetyError;
    const deleted = await profileCacheManager.deleteHook(alias, target.hook.id);
    if (!deleted) return errorResult(`Failed to delete hook "${target.hook.name}".`);
    return {
      success: true,
      message: `Deleted hook "${target.hook.name}".`,
      removed: ManageHooksFacade.summarizeHook(target.hook),
    };
  }

  private static async setHookEnabled(
    alias: string,
    args: ManageHooksInput,
    enabled: boolean,
  ): Promise<FacadeResult> {
    const target = ManageHooksFacade.resolveTarget(alias, args);
    if (target.error) return target.error;
    if (!enabled) {
      const safetyError = ManageHooksFacade.requireSettingsReviewForDisableOrDelete(alias, target.hook, 'disable');
      if (safetyError) return safetyError;
    }
    const updated = await profileCacheManager.updateHook(alias, target.hook.id, { enabled });
    if (!updated) return errorResult(`Failed to ${enabled ? 'enable' : 'disable'} hook "${target.hook.name}".`);
    return {
      success: true,
      message: `${enabled ? 'Enabled' : 'Disabled'} hook "${target.hook.name}".`,
      hook: ManageHooksFacade.findHookById(alias, target.hook.id),
    };
  }

  private static list(alias: string): FacadeResult {
    const hooks = profileCacheManager.getHooks(alias);
    return {
      success: true,
      message: `Found ${hooks.length} hook(s).`,
      hooks: hooks.map(ManageHooksFacade.summarizeHook),
    };
  }

  private static status(alias: string): FacadeResult {
    const hooks = profileCacheManager.getHooks(alias);
    return {
      success: true,
      message: `Agent Hooks management is available. ${hooks.filter(h => h.enabled).length}/${hooks.length} hook(s) are enabled.`,
      runtime_enabled: true,
      total_hooks: hooks.length,
      enabled_hooks: hooks.filter(h => h.enabled).length,
    };
  }

  private static buildFlatAction(args: ManageHooksInput): HookAction | null {
    const actionType = args.action_type ?? (args.command ? 'command' : args.url ? 'http' : undefined);
    if (actionType === 'command' && args.command) {
      const action: HookAction = { type: 'command', command: args.command };
      if (Array.isArray(args.args)) action.args = args.args;
      ManageHooksFacade.applyCommonActionFields(action, args);
      return action;
    }
    if (actionType === 'http' && args.url) {
      const action: HookAction = { type: 'http', url: args.url };
      if (args.method) action.method = args.method;
      if (args.headers) action.headers = args.headers;
      if (args.body !== undefined) action.body = args.body;
      ManageHooksFacade.applyCommonActionFields(action, args);
      return action;
    }
    return null;
  }

  private static applyCommonActionFields(action: HookAction, args: ManageHooksInput): void {
    if (args.if !== undefined) action.if = args.if;
    if (args.timeout !== undefined) action.timeout = args.timeout;
    if (args.timeoutMs !== undefined) action.timeoutMs = args.timeoutMs;
    if (args.async !== undefined) action.async = args.async;
  }

  private static requireSettingsReviewForDisableOrDelete(
    alias: string,
    hook: HookDefinition,
    action: 'disable' | 'delete',
  ): FacadeResult | null {
    if (hook.enabled) {
      return errorResult(
        `Enabled hooks cannot be ${action}d from manage_hooks.`,
        'Open Settings > Hooks to review and change enabled hooks manually.',
      );
    }
    const boundAgents = ManageHooksFacade.findBoundAgentNames(alias, hook.id);
    if (boundAgents.length > 0) {
      return errorResult(
        `Agent-bound hooks cannot be ${action}d from manage_hooks.`,
        `Remove the hook from bound agent(s) in the Agent editor first: ${boundAgents.join(', ')}`,
      );
    }
    return null;
  }

  private static findBoundAgentNames(alias: string, hookId: string): string[] {
    const names: string[] = [];
    for (const chat of profileCacheManager.getAllChatConfigs(alias)) {
      const agents = getChatAgents(chat);
      for (const agent of agents) {
        if (Array.isArray(agent?.hooks) && agent.hooks.includes(hookId)) {
          names.push(agent.name || chat.chat_id);
        }
      }
    }
    return [...new Set(names)];
  }

  private static buildPersistedHook(input: {
    name: string;
    description?: string;
    enabled: boolean;
    event: AgentHookEvent;
    matcher?: string;
    action: HookAction;
  }): HookDefinition {
    const now = new Date().toISOString();
    const hook: HookDefinition = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      version: '1.0.0',
      remoteVersion: '',
      source: 'ON-DEVICE',
      enabled: input.enabled,
      event: input.event,
      action: input.action,
      createdAt: now,
      updatedAt: now,
    };
    if (input.matcher !== undefined) hook.matcher = input.matcher;
    return hook;
  }

  private static resolveTarget(alias: string, args: ManageHooksInput): HookTarget {
    if (args.hook_id?.trim()) {
      const hook = ManageHooksFacade.findHookById(alias, args.hook_id.trim());
      if (!hook) return { error: errorResult(`Hook id "${args.hook_id}" not found.`) };
      return { hook };
    }
    if (!args.name?.trim()) {
      return {
        error: errorResult('"hook_id" or unique "name" is required.', 'Use action=list to find hook ids.'),
      };
    }
    const matches = profileCacheManager.getHooks(alias).filter(hook => hook.name === args.name!.trim());
    if (matches.length === 0) {
      return { error: errorResult(`Hook name "${args.name}" not found.`) };
    }
    if (matches.length > 1) {
      return {
        error: errorResult(`Hook name "${args.name}" is ambiguous.`, 'Provide hook_id instead of name.'),
      };
    }
    return { hook: matches[0] };
  }

  private static findHookById(alias: string, hookId: string): HookDefinition | undefined {
    return profileCacheManager.getHooks(alias).find(hook => hook.id === hookId);
  }

  private static summarizeHook(hook: HookDefinition): Record<string, unknown> {
    return {
      id: hook.id,
      name: hook.name,
      description: hook.description,
      version: hook.version,
      remoteVersion: hook.remoteVersion,
      source: hook.source,
      enabled: hook.enabled,
      event: hook.event,
      matcher: hook.matcher,
      action_type: hook.action.type,
      if: hook.action.if,
      createdAt: hook.createdAt,
      updatedAt: hook.updatedAt,
    };
  }

  private static resolveUserAlias(options: ManageHooksExecutionOptions): string | null {
    if (options.userAlias !== undefined) {
      return typeof options.userAlias === 'string' && options.userAlias.length > 0 ? options.userAlias : null;
    }
    const manager = profileCacheManager as unknown as {
      getCurrentUserAlias?: () => string | null;
      currentUserAlias?: string | null;
    };
    return manager.getCurrentUserAlias?.() ?? manager.currentUserAlias ?? null;
  }
}
