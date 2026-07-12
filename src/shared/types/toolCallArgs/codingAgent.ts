import type { CodingCliId } from '../codingCli';

export interface CodingAgentToolArgs {
  task: string;
  cwd: string;
}

export interface CodingAgentToolResult {
  task: string;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
  truncated?: boolean;
  /** The coding CLI that produced this result. */
  cli: CodingCliId;
}
