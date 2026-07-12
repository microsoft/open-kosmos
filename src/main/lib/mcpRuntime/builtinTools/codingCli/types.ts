/**
 * Coding CLI adapter types.
 *
 * Each supported coding-agent CLI (Claude Code, Codex, Gemini, GitHub Copilot) is described by
 * a CodingCliAdapter that knows how to build a non-interactive argv for a single task and how to
 * extract the CLI's final response from its captured stdout/stderr. OpenKosmos only detects
 * availability and invokes these CLIs; it never installs or updates them.
 */

import type { CodingCliId, CodingCliAvailability } from '@shared/types/codingCli';

export type { CodingCliId, CodingCliAvailability };

export interface CodingCliAdapter {
  /** Stable identifier persisted in profile.json. */
  id: CodingCliId;
  /** Human-readable name shown in Settings. */
  displayName: string;
  /** Executable looked up on PATH. */
  binaryName: string;
  /** Install command shown when the CLI is not found (OpenKosmos does not run it). */
  installHint: string;
  /** Documentation URL for the CLI. */
  docsUrl: string;
  /**
   * Build the argv (NOT a shell string) for a single non-interactive task.
   * Auto-approve / sandbox-bypass flags are included to match the tool's existing posture.
   */
  buildArgs(task: string): string[];
  /**
   * Extract the CLI's final response from captured output.
   * JSON-mode CLIs parse a field and fall back to raw text; text-mode CLIs return trimmed stdout.
   */
  extractFinal(stdout: string, stderr: string): string;
}
