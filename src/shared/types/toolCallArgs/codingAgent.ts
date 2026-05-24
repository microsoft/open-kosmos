export interface CodingAgentToolArgs {
  task: string;
  cwd: string;
  timeoutSeconds?: number;
}

export interface CodingAgentToolResult {
  task: string;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
  truncated?: boolean;
}
