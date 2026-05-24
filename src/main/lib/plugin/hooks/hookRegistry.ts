/**
 * Global Hook Registry — registers and executes plugin lifecycle hooks.
 *
 * Compatible with the Claude Code plugin format:
 *   - `${CLAUDE_PLUGIN_ROOT}` variable substitution in commands
 *   - `CLAUDE_PLUGIN_ROOT` / `OPENKOSMOS_PLUGIN_ROOT` env vars
 *   - `async` flag (fire-and-forget hooks)
 *   - Parses hook stdout as JSON and extracts `additionalContext`
 *     from three supported formats (Claude Code / Copilot CLI / Cursor)
 *
 * Hook commands run as child processes with a timeout.  Failures are
 * logged but never block the main flow (non-fatal strategy).
 */

import { exec } from 'child_process';
import { createLogger } from '../../unifiedLogger';
import type { HookCommand, HookEvent } from '../types';
import type {
  HookContext,
  HookCommandResult,
  HookExecutionResult,
  HookJsonOutput,
} from './hookTypes';

const logger = createLogger();

const DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum stdout/stderr bytes captured per hook to prevent memory exhaustion. */
const MAX_OUTPUT_BYTES = 1024 * 256; // 256 KB

/**
 * Dangerous shell patterns — aligned with executeCommandTool.ts blocklist.
 */
const DANGEROUS_PATTERNS = [
  // File system / system destruction
  /rm\s+-rf\s+\/?/i,
  /shutdown/i,
  /poweroff/i,
  /\bformat(?:\.com)?\s+[a-z]:/i,
  /mkfs/i,
  /del\s+\/?s\s+\/?q\s+[a-z]:/i,

  // Credentials / auth destruction — deletes credential/token/cookie/auth cache files
  /Remove-Item.*(?:credential|token|cookie|auth.*cache)/i,
  /rm\s+.*(?:credential|token|cookie|auth.*cache)/i,
  /del\s+.*(?:credential|token|cookie|auth.*cache)/i,

  // OAuth logout/revoke/signout endpoints
  /login\.microsoftonline\.com\/.*\/logout/i,
  /login\.live\.com\/.*logout/i,
  /accounts\.google\.com\/Logout/i,
  /\/oauth2?\/(?:logout|revoke|signout)/i,

  // Direct manipulation of OS browser profile directories (Windows + macOS)
  /(?:Microsoft\\\\Edge|Google\\\\Chrome)\\\\User Data/i,
  /Application Support\/(?:Microsoft Edge|Google\/Chrome)/i,
];

interface RegisteredHook {
  pluginId: string;
  /** Absolute path to the plugin root directory. */
  pluginPath: string;
  command: HookCommand;
}

/**
 * Validate that a hook command is safe to execute.
 * Returns an error string if the command is blocked, undefined if OK.
 */
function validateHookCommand(command: string): string | undefined {
  if (!command.trim()) {
    return 'Empty hook command';
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Hook command blocked by security policy: matches dangerous pattern ${pattern}`;
    }
  }

  return undefined;
}

/**
 * Substitute `${CLAUDE_PLUGIN_ROOT}` and `${OPENKOSMOS_PLUGIN_ROOT}` in a
 * command string with the actual plugin path.
 */
function substituteVariables(command: string, pluginPath: string): string {
  return command
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginPath)
    .replace(/\$\{OPENKOSMOS_PLUGIN_ROOT\}/g, pluginPath);
}

/**
 * Parse hook stdout as JSON and extract `additionalContext`.
 *
 * Supports three platform formats:
 *   1. Claude Code:  `{ hookSpecificOutput: { additionalContext: "..." } }`
 *   2. Copilot CLI:  `{ additionalContext: "..." }`
 *   3. Cursor:       `{ additional_context: "..." }`
 *
 * Returns `undefined` for non-JSON output or when no context is provided.
 */
function parseHookOutput(stdout: string): { json?: HookJsonOutput; plainText?: string } {
  const trimmed = stdout.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    // Not JSON — treat as plain text output
    return { plainText: stdout || undefined };
  }

  try {
    const parsed = JSON.parse(trimmed) as HookJsonOutput;
    return { json: parsed };
  } catch (e) {
    logger.warn(`[HookRegistry] Failed to parse hook stdout as JSON: ${e}`);
    return { plainText: stdout };
  }
}

/**
 * Extract `additionalContext` from a parsed hook JSON output.
 * Checks all three supported formats in priority order:
 *   1. hookSpecificOutput.additionalContext  (Claude Code)
 *   2. additionalContext                     (Copilot CLI / SDK standard)
 *   3. additional_context                    (Cursor)
 */
function extractAdditionalContext(json: HookJsonOutput): string | undefined {
  // 1. Claude Code nested format (highest priority)
  if (json.hookSpecificOutput?.additionalContext) {
    return json.hookSpecificOutput.additionalContext;
  }
  // 2. Copilot CLI / SDK standard top-level format
  if (json.additionalContext) {
    return json.additionalContext;
  }
  // 3. Cursor snake_case format
  if (json.additional_context) {
    return json.additional_context;
  }
  return undefined;
}

/**
 * Singleton hook registry.
 */
class HookRegistry {
  private static instance: HookRegistry;
  private hooks: Map<HookEvent, RegisteredHook[]> = new Map();

  static getInstance(): HookRegistry {
    if (!HookRegistry.instance) {
      HookRegistry.instance = new HookRegistry();
    }
    return HookRegistry.instance;
  }

  // ---- Registration -------------------------------------------------------

  /**
   * Register hooks declared by a plugin.
   *
   * Any existing hooks from the same plugin+event are removed first
   * to prevent duplicates from re-activation.
   *
   * @param pluginId   Unique plugin identifier (manifest.name)
   * @param pluginPath Absolute path to the plugin root directory
   * @param event      Lifecycle event name
   * @param commands   Array of hook commands (already normalized to flat format)
   */
  registerPluginHooks(
    pluginId: string,
    pluginPath: string,
    event: HookEvent,
    commands: HookCommand[],
  ): void {
    // Remove any existing hooks from this plugin for this event (dedup safety net)
    const existing = this.hooks.get(event) ?? [];
    const filtered = existing.filter(h => h.pluginId !== pluginId);

    for (const cmd of commands) {
      filtered.push({ pluginId, pluginPath, command: cmd });
    }
    this.hooks.set(event, filtered);
    logger.info(`[HookRegistry] Registered ${commands.length} ${event} hook(s) from plugin "${pluginId}"`);
  }

  /**
   * Remove all hooks registered by a specific plugin.
   */
  unregisterPluginHooks(pluginId: string): void {
    for (const [event, list] of this.hooks.entries()) {
      const filtered = list.filter(h => h.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.hooks.delete(event);
      } else {
        this.hooks.set(event, filtered);
      }
    }
    logger.info(`[HookRegistry] Unregistered all hooks from plugin "${pluginId}"`);
  }

  /**
   * Clear the entire registry (used during refresh).
   */
  clear(): void {
    this.hooks.clear();
  }

  // ---- Execution ----------------------------------------------------------

  /**
   * Execute all hooks registered for a given event.
   *
   * Hooks with `async: true` are fired without waiting (fire-and-forget).
   * Synchronous hooks run sequentially.  A failing hook logs an error
   * but does NOT prevent subsequent hooks or the main flow.
   *
   * Hook stdout is parsed as JSON and `additionalContext` is extracted
   * following the Claude Code / Copilot CLI / Cursor protocol.
   */
  async execute(event: HookEvent, context: HookContext): Promise<HookExecutionResult> {
    const registered = this.hooks.get(event) ?? [];
    if (registered.length === 0) {
      return { event, results: [], allSucceeded: true, additionalContexts: [] };
    }

    logger.info(`[HookRegistry] Executing ${registered.length} hook(s) for ${event}`);
    const results: HookCommandResult[] = [];
    const additionalContexts: string[] = [];

    for (const { pluginId, pluginPath, command } of registered) {
      if (command.async) {
        // Fire-and-forget: start but don't await
        this.executeCommand(pluginId, pluginPath, command, context).catch(err => {
          logger.error(`[HookRegistry] Async hook from "${pluginId}" failed: ${err}`);
        });
        results.push({ success: true, durationMs: 0 });
      } else {
        const result = await this.executeCommand(pluginId, pluginPath, command, context);
        results.push(result);
        // Collect additionalContext from successful hooks
        if (result.success && result.additionalContext) {
          additionalContexts.push(result.additionalContext);
          logger.info(
            `[HookRegistry] Hook ${event} from "${pluginId}" provided additionalContext (${result.additionalContext.length} chars)`,
          );
        }
      }
    }

    const allSucceeded = results.every(r => r.success);
    return { event, results, allSucceeded, additionalContexts };
  }

  // ---- Internal -----------------------------------------------------------

  private async executeCommand(
    pluginId: string,
    pluginPath: string,
    hook: HookCommand,
    context: HookContext,
  ): Promise<HookCommandResult> {
    const start = Date.now();
    const timeout = hook.timeout ?? DEFAULT_TIMEOUT_MS;

    // Security: validate hook command before execution
    const validationError = validateHookCommand(hook.command);
    if (validationError) {
      logger.error(`[HookRegistry] Plugin "${pluginId}" hook blocked: ${validationError}`);
      return { success: false, error: validationError, durationMs: 0 };
    }

    // Substitute variables in the command string
    const resolvedCommand = substituteVariables(hook.command, pluginPath);

    // Determine cwd: prefer project workspace (matches Claude Code), fallback to plugin root
    const cwd = context.workspacePath || pluginPath;

    // Build environment with both Claude Code and OpenKosmos variable names
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      // Claude Code compatible env vars
      CLAUDE_PLUGIN_ROOT: pluginPath,
      CLAUDE_PLUGIN_DATA: pluginPath,
      CLAUDE_PROJECT_DIR: context.workspacePath || '',
      // OpenKosmos env vars
      OPENKOSMOS_PLUGIN_ROOT: pluginPath,
      OpenKosmos_HOOK_EVENT: 'SessionStart',
      OpenKosmos_USER_ALIAS: context.userAlias ?? '',
      OpenKosmos_CHAT_ID: context.chatId ?? '',
      OpenKosmos_CHAT_SESSION_ID: context.chatSessionId ?? '',
    };

    return new Promise<HookCommandResult>(resolve => {
      exec(
        resolvedCommand,
        { timeout, env: env as NodeJS.ProcessEnv, cwd, maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - start;

          if (error) {
            const msg = (error as any).killed
              ? `Hook timed out after ${timeout}ms`
              : `Hook failed: ${error.message}`;
            logger.error(`[HookRegistry] Plugin "${pluginId}" ${msg}`);
            resolve({ success: false, error: msg, output: stdout || undefined, durationMs });
            return;
          }

          if (stderr) {
            logger.warn(`[HookRegistry] Plugin "${pluginId}" hook stderr: ${stderr.trim()}`);
          }

          // Parse stdout for JSON output and extract additionalContext
          let additionalContext: string | undefined;
          if (stdout) {
            const { json, plainText } = parseHookOutput(stdout);
            if (json) {
              additionalContext = extractAdditionalContext(json);
              if (additionalContext) {
                logger.info(
                  `[HookRegistry] Plugin "${pluginId}" hook returned additionalContext (${additionalContext.length} chars)`,
                );
              }
            }
          }

          resolve({
            success: true,
            output: stdout || undefined,
            durationMs,
            additionalContext,
          });
        },
      );
    });
  }
}

export const hookRegistry = HookRegistry.getInstance();
