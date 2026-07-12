/**
 * Command Hook runner (tech-doc §10).
 *
 * Spawns a child process for a command Hook, writes the Hook input to stdin as
 * JSON, captures capped stdout/stderr, enforces a timeout, supports cancellation
 * via AbortSignal, and exposes OpenKosmos env vars. It applies a dedicated command
 * validation policy aligned with the existing execute_command blocklist
 * (PRD open question #1: dedicated runner with shared validation rules).
 *
 * The runner never throws — every failure is reported through CommandHookResult,
 * so a misbehaving Hook can never crash the Agent Loop.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createLogger } from '../unifiedLogger';
import { MAX_HOOK_OUTPUT_BYTES, resolveHookTimeoutMs } from './types';
import type { AgentHookInput, CommandHookAction, CommandHookResult } from './types';

const logger = createLogger();

/** Dangerous shell patterns — aligned with executeCommandTool. */
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/?/i,
  /shutdown/i,
  /poweroff/i,
  /\bformat(?:\.com)?\s+[a-z]:/i,
  /mkfs/i,
  /del\s+\/?s\s+\/?q\s+[a-z]:/i,
  /Remove-Item.*(?:credential|token|cookie|auth.*cache)/i,
  /rm\s+.*(?:credential|token|cookie|auth.*cache)/i,
  /del\s+.*(?:credential|token|cookie|auth.*cache)/i,
  /https?:\/\/[^\s"'<>]+\/(?:[^/\s"'<>]+\/)*(?:logout|revoke|signout)\b/i,
  /(?:\\|\/)User Data(?:\\|\/)/i,
  /\/Application Support\/(?:[^/\s"']+\/){1,2}(?:Default|Profile(?: \d+)?)(?:\/|["']?\s*$)/i,
];

/** Environment metadata exposed to a command Hook process. */
export interface CommandHookEnv {
  event: string;
  userAlias: string;
  chatId: string;
  chatSessionId: string;
  agentName: string;
  workspacePath?: string;
  /**
   * Per-profile directory for Hook scripts and artifacts (typically
   * `<userData>/profiles/<alias>/hooks-artifacts`). Exposed to spawned hook
   * processes as `OPENKOSMOS_HOOKS_ARTIFACTS_PATH` and usable in command/args via
   * the `${OPENKOSMOS_HOOKS_ARTIFACTS_PATH}` placeholder.
   */
  hooksArtifactsPath?: string;
}

/** Validate a command before execution. Returns an error string, or undefined when safe. */
export function validateHookCommand(command: string, args?: string[]): string | undefined {
  if (typeof command !== 'string' || command.trim() === '') {
    return 'Empty hook command';
  }
  const effectiveCommand = args ? `${command} ${args.join(' ')}` : command;
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(effectiveCommand)) {
      return `Hook command blocked by security policy: matches dangerous pattern ${pattern}`;
    }
  }
  return undefined;
}

export function quoteShellValue(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function substitutePathPlaceholders(value: string, envCtx: CommandHookEnv, options: { shellForm: boolean }): string {
  const workspacePath = envCtx.workspacePath ?? '';
  const artifactsPath = envCtx.hooksArtifactsPath ?? '';
  const workspaceReplacement = options.shellForm ? quoteShellValue(workspacePath) : workspacePath;
  const artifactsReplacement = options.shellForm ? quoteShellValue(artifactsPath) : artifactsPath;
  return value
    .replace(/\$\{OPENKOSMOS_WORKSPACE_PATH\}/g, workspaceReplacement)
    .replace(/\$\{OPENKOSMOS_HOOKS_ARTIFACTS_PATH\}/g, artifactsReplacement);
}

const SAFE_INHERITED_ENV_KEYS = [
  'PATH',
  'Path',
  'HOME',
  'USER',
  'USERNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
] as const;

function buildEnv(envCtx: CommandHookEnv): NodeJS.ProcessEnv {
  const workspacePath = envCtx.workspacePath ?? '';
  const hooksArtifactsPath = envCtx.hooksArtifactsPath ?? '';
  const inherited: Record<string, string> = {};
  for (const key of SAFE_INHERITED_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      inherited[key] = process.env[key];
    }
  }
  return {
    ...inherited,
    OPENKOSMOS_HOOK_EVENT: envCtx.event,
    OPENKOSMOS_USER_ALIAS: envCtx.userAlias,
    OPENKOSMOS_CHAT_ID: envCtx.chatId,
    OPENKOSMOS_CHAT_SESSION_ID: envCtx.chatSessionId,
    // @deprecated Legacy alias of OPENKOSMOS_CHAT_ID — carries the chat-scoped id, not
    // a distinct agent id. Kept for compatibility with existing hook scripts.
    OPENKOSMOS_AGENT_ID: envCtx.chatId,
    OPENKOSMOS_AGENT_NAME: envCtx.agentName,
    OPENKOSMOS_WORKSPACE_PATH: workspacePath,
    OPENKOSMOS_HOOKS_ARTIFACTS_PATH: hooksArtifactsPath,
    APP_NAME: process.env.APP_NAME ?? '',
    BRAND_NAME: 'openkosmos',
    BRAND_CONFIG: process.env.BRAND_CONFIG ?? '',
  };
}

export function terminateHookProcess(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  if (!child.pid) {
    child.kill('SIGKILL');
    return;
  }

  if (platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', err => {
        logger.warn('[CommandHookRunner] Failed to terminate hook process tree with taskkill', 'CommandHookRunner', {
          pid: child.pid,
          error: err instanceof Error ? err.message : String(err),
        });
        child.kill('SIGKILL');
      });
      killer.unref?.();
      return;
    } catch (err) {
      logger.warn('[CommandHookRunner] Failed to start taskkill for hook process tree', 'CommandHookRunner', {
        pid: child.pid,
        error: err instanceof Error ? err.message : String(err),
      });
      child.kill('SIGKILL');
      return;
    }
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
    return;
  } catch {
    // Fall back to the direct child if process-group termination is unavailable.
  }
  child.kill('SIGKILL');
}

/** Append `text` to `buffer` without exceeding the output cap. */
function capAppend(buffer: string, text: string): string {
  if (buffer.length >= MAX_HOOK_OUTPUT_BYTES) return buffer;
  const remaining = MAX_HOOK_OUTPUT_BYTES - buffer.length;
  return buffer + (text.length > remaining ? text.slice(0, remaining) : text);
}

/**
 * Execute a single command Hook action. Resolves with a structured result;
 * never rejects.
 */
export function runCommandHook(
  action: CommandHookAction,
  input: AgentHookInput,
  envCtx: CommandHookEnv,
  signal?: AbortSignal,
): Promise<CommandHookResult> {
  const start = Date.now();
  const execForm = Array.isArray(action.args);
  const command = substitutePathPlaceholders(action.command, envCtx, { shellForm: !execForm });
  const args = execForm ? action.args!.map(arg => substitutePathPlaceholders(arg, envCtx, { shellForm: false })) : undefined;

  const validationError = validateHookCommand(command, args);
  if (validationError) {
    logger.warn(`[AgentHooks] Command hook blocked: ${validationError}`);
    return Promise.resolve({ success: false, stdout: '', stderr: '', durationMs: 0, error: validationError });
  }

  if (signal?.aborted) {
    return Promise.resolve({ success: false, stdout: '', stderr: '', durationMs: 0, error: 'Hook cancelled before start' });
  }

  const timeoutMs = resolveHookTimeoutMs(action, input);
  const cwd = envCtx.workspacePath && envCtx.workspacePath.trim() ? envCtx.workspacePath : process.cwd();

  return new Promise<CommandHookResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const spawnOptions = { cwd, env: buildEnv(envCtx), detached: process.platform !== 'win32' };
    const child = execForm
      ? spawn(command, args!, spawnOptions)
      : spawn(command, { ...spawnOptions, shell: true });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateHookProcess(child);
    }, timeoutMs);

    const onAbort = () => terminateHookProcess(child);
    if (signal) signal.addEventListener('abort', onAbort);

    const finalize = (result: CommandHookResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = capAppend(stdout, chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = capAppend(stderr, chunk.toString());
    });

    child.on('error', (err: Error) => {
      finalize({ success: false, stdout, stderr, durationMs: Date.now() - start, error: `Hook process error: ${err.message}` });
    });

    child.on('close', (code: number | null) => {
      const durationMs = Date.now() - start;
      if (timedOut) {
        finalize({ success: false, stdout, stderr, exitCode: code, durationMs, timedOut: true, error: `Hook timed out after ${timeoutMs}ms` });
        return;
      }
      if (signal?.aborted) {
        finalize({ success: false, stdout, stderr, exitCode: code, durationMs, error: 'Hook cancelled' });
        return;
      }
      const success = code === 0;
      finalize({ success, stdout, stderr, exitCode: code, durationMs, ...(success ? {} : { error: `Hook exited with code ${code}` }) });
    });

    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', err => {
        logger.debug('[CommandHookRunner] Hook stdin closed before input was written', 'CommandHookRunner', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      try {
        stdin.write(JSON.stringify(input));
        stdin.end();
      } catch {
        // Ignore stdin write failures (e.g. EPIPE if the process closed stdin early).
      }
    }
  });
}
