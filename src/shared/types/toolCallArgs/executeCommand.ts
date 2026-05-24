export interface ExecuteCommandToolArgs {
  description: string;
  command: string;
  cwd: string;
  args?: string[];
  timeoutSeconds?: number;
  shell?: 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';
  background?: boolean;
}

export interface ExecuteCommandBackgroundResult {
  sessionId: string;
  pid: number | undefined;
  background: true;
}

export interface ExecuteCommandInteractiveAuthHint {
  commandFamily: 'gh-auth-login' | 'gh-auth-refresh' | 'az-login' | 'npm-login' | 'npm-adduser' | 'pnpm-login' | 'yarn-npm-login';
  verificationUri?: string;
  deviceCode?: string;
  timeoutMs: number;
  startedAt: number;
}

export type ExecuteCommandAuthInterruptionReason = 'cancelled' | 'timed_out';

export interface ExecuteCommandToolResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
  shell: string;
  truncated?: boolean;
  interactiveAuth?: ExecuteCommandInteractiveAuthHint;
  authInterruptedReason?: ExecuteCommandAuthInterruptionReason;
  success?: boolean;
}
