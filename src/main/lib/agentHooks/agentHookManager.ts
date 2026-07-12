/**
 * Agent Hook manager — the narrow facade the Agent Loop uses (tech-doc §7).
 *
 * `AgentChatTurnRunner` and `AgentChat` only call `runHooks(...)` /
 * `resolveHooksForAgent(...)`; they never deal with persistence or resolution.
 *
 * The manager reads the profile Hook library and profile-level master switch
 * through injectable deps. The default deps point at the real
 * `profileCacheManager`; tests construct the class with fakes. `runHooks` never
 * throws — Hook failures must not crash the Agent Loop.
 */

import { createLogger } from '../unifiedLogger';
import { getHooksArtifactsPath } from '../userDataADO/pathUtils';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { executeHooksForEvent } from './agentHookExecutor';
import type { CommandRunner, HttpRunner } from './agentHookExecutor';
import { resolveEffectiveHooks } from './agentHookResolver';
import type { CommandHookEnv } from './commandHookRunner';
import type {
  AgentHookEvent,
  AgentHookInput,
  AgentHookRunContext,
  AggregatedHookResult,
  EffectiveHook,
  HookDefinition,
} from './types';

const logger = createLogger();

/**
 * Resolve the per-profile hooks artifacts directory for a user. Wrapped in
 * try/catch so a missing/invalid alias or filesystem error never crashes the
 * Agent Loop — falls back to `undefined`, which leaves the env var empty and
 * the `${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}` placeholder substituted as an empty
 * string (consistent with workspacePath behavior).
 */
function resolveHooksArtifactsPath(alias: string): string | undefined {
  try {
    return getHooksArtifactsPath(alias);
  } catch (error) {
    logger.warn('[AgentHooks] Failed to resolve hooks artifacts path', 'agentHookManager', {
      alias,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/** Injectable collaborators for the manager. */
export interface AgentHookManagerDeps {
  /** Read the profile-level Hook library for a user. */
  getHooks(alias: string): HookDefinition[];
  /** Whether the profile-level Hooks master switch is enabled for a user. */
  isEnabled(alias: string): boolean;
  /** Optional command runner override (used for tests). */
  runner?: CommandRunner;
  /** Optional HTTP runner override (used for tests). */
  httpRunner?: HttpRunner;
}

/** Default deps backed by the real profile cache. */
export function createDefaultDeps(): AgentHookManagerDeps {
  return {
    getHooks: (alias: string) => {
      try {
        return profileCacheManager.getHooks(alias);
      } catch {
        return [];
      }
    },
    isEnabled: (alias: string) => {
      try {
        return profileCacheManager.isHooksEnabled(alias);
      } catch {
        return false;
      }
    },
  };
}

export class AgentHookManager {
  private static instance: AgentHookManager | undefined;

  constructor(private readonly deps: AgentHookManagerDeps) {}

  static getInstance(): AgentHookManager {
    if (!AgentHookManager.instance) {
      AgentHookManager.instance = new AgentHookManager(createDefaultDeps());
    }
    return AgentHookManager.instance;
  }

  /**
   * Whether the profile-level Hooks master switch is enabled. Lets the Agent
   * Loop fast-path past Hook wiring entirely when the feature is OFF, keeping
   * the disabled path free of extra awaited no-op Hook calls.
   */
  isEnabled(alias: string): boolean {
    return this.deps.isEnabled(alias);
  }

  /** Resolve the Hooks effective for the Agent described by `context`. */
  resolveHooksForAgent(context: AgentHookRunContext): EffectiveHook[] {
    if (!this.deps.isEnabled(context.userAlias)) {
      return [];
    }
    const hooks = this.deps.getHooks(context.userAlias);
    return resolveEffectiveHooks(hooks, {
      hookIds: context.hookIds,
    });
  }

  /** Resolve and execute the effective Hooks for one lifecycle event. */
  async runHooks(
    event: AgentHookEvent,
    input: AgentHookInput,
    context: AgentHookRunContext,
  ): Promise<AggregatedHookResult> {
    try {
      const effective = this.resolveHooksForAgent(context);
      if (effective.length === 0) {
        return {};
      }
      const envCtx: CommandHookEnv = {
        event,
        userAlias: context.userAlias,
        chatId: context.chatId,
        chatSessionId: context.chatSessionId,
        agentName: context.agentName,
        workspacePath: context.workspacePath,
        hooksArtifactsPath: resolveHooksArtifactsPath(context.userAlias),
      };
      return await executeHooksForEvent(event, input, effective, envCtx, context.signal, this.deps.runner, this.deps.httpRunner);
    } catch (err) {
      logger.error(`[AgentHooks] runHooks(${event}) failed: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  }
}
