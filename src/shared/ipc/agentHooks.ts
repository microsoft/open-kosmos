/**
 * Agent Hooks IPC contract (tech-doc §13).
 *
 * Renderer -> Main CRUD + master-switch surface for the Phase 2 management UX.
 * Every handler operates on the current user alias resolved in the main process,
 * so the renderer never passes an alias. Hooks are bound to Agents from the Agent
 * side (`ChatAgent.hooks`), so this surface no longer manages bindings. The
 * persisted resource model is shared from `agentHooks/profileTypes`.
 */

import { connectRenderToMain } from './base';
import type {
  AgentHookEvent,
  CommandHookAction,
  HttpHookAction,
  HttpHookMethod,
  HookAction,
  HookDefinition,
} from '../agentHooks/profileTypes';

export type {
  AgentHookEvent,
  CommandHookAction,
  HttpHookAction,
  HttpHookMethod,
  HookAction,
  HookDefinition,
};

/**
 * Input to create a new Hook. `id`, `createdAt`, and `updatedAt` are generated
 * in the main process and must not be supplied by the renderer.
 */
export interface CreateHookInput {
  name: string;
  description?: string;
  enabled?: boolean;
  event?: AgentHookEvent;
  matcher?: string;
  action?: HookAction;
}

/**
 * Patch to update an existing Hook. Identity and timestamps are owned by the
 * main process and cannot be set through this surface.
 */
export type UpdateHookInput = Partial<
  Pick<HookDefinition, 'name' | 'description' | 'enabled' | 'event' | 'matcher' | 'action'>
>;

export interface HookMutationResult {
  success: boolean;
  error?: string;
  hook?: HookDefinition;
}

type RenderToMain = {
  listHooks: {
    call: [];
    return: { success: boolean; data?: HookDefinition[]; error?: string };
  };
  createHook: {
    call: [input: CreateHookInput];
    return: HookMutationResult;
  };
  updateHook: {
    call: [hookId: string, patch: UpdateHookInput];
    return: HookMutationResult;
  };
  deleteHook: {
    call: [hookId: string];
    return: { success: boolean; error?: string };
  };
  getMasterSwitch: {
    call: [];
    return: { success: boolean; enabled: boolean; error?: string };
  };
  setMasterSwitch: {
    call: [enabled: boolean];
    return: { success: boolean; error?: string };
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('agentHooks');
