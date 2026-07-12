/**
 * Per-CLI adapters for the coding-agent built-in tool.
 *
 * Each adapter builds a non-interactive argv for a single task and extracts the final response
 * from captured output. Two output styles are supported:
 *   - JSON CLIs (claude, gemini): a structured field carries the final text; we parse it and
 *     fall back to raw text if parsing fails.
 *   - Text CLIs (codex, copilot): stdout already is the final agent message.
 */

import type { CodingCliAdapter } from './types';
import { CODING_CLI_DISPLAY_NAMES } from '@shared/types/codingCli';

/**
 * Best-effort extraction of a string field from a CLI's JSON stdout.
 * Tries the whole stdout first, then the last non-empty line (some CLIs print logs before JSON).
 * Returns null when no usable string field is found.
 */
export function parseJsonField(stdout: string, field: string): string | null {
  const tryParse = (text: string): string | null => {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object' && typeof obj[field] === 'string') {
        return obj[field];
      }
    } catch {
      // not valid JSON; caller will try another candidate
    }
    return null;
  };

  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const whole = tryParse(trimmed);
  if (whole !== null) return whole;

  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const parsed = tryParse(line);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Final text for text-mode CLIs: trimmed stdout, falling back to stderr. */
export function extractText(stdout: string, stderr: string): string {
  const out = stdout.trim();
  if (out) return out;
  return stderr.trim();
}

export const claudeAdapter: CodingCliAdapter = {
  id: 'claude',
  displayName: CODING_CLI_DISPLAY_NAMES.claude,
  binaryName: 'claude',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  buildArgs(task: string): string[] {
    return ['-p', '--output-format', 'json', '--dangerously-skip-permissions', task];
  },
  extractFinal(stdout: string, stderr: string): string {
    return parseJsonField(stdout, 'result') ?? extractText(stdout, stderr);
  },
};

export const codexAdapter: CodingCliAdapter = {
  id: 'codex',
  displayName: CODING_CLI_DISPLAY_NAMES.codex,
  binaryName: 'codex',
  installHint: 'npm install -g @openai/codex',
  docsUrl: 'https://github.com/openai/codex',
  buildArgs(task: string): string[] {
    return ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', task];
  },
  extractFinal(stdout: string, stderr: string): string {
    return extractText(stdout, stderr);
  },
};

export const geminiAdapter: CodingCliAdapter = {
  id: 'gemini',
  displayName: CODING_CLI_DISPLAY_NAMES.gemini,
  binaryName: 'gemini',
  installHint: 'npm install -g @google/gemini-cli',
  docsUrl: 'https://github.com/google-gemini/gemini-cli',
  buildArgs(task: string): string[] {
    return ['-p', task, '--output-format', 'json', '--yolo'];
  },
  extractFinal(stdout: string, stderr: string): string {
    return parseJsonField(stdout, 'response') ?? extractText(stdout, stderr);
  },
};

export const copilotAdapter: CodingCliAdapter = {
  id: 'copilot',
  displayName: CODING_CLI_DISPLAY_NAMES.copilot,
  binaryName: 'copilot',
  installHint: 'npm install -g @github/copilot',
  docsUrl: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli',
  buildArgs(task: string): string[] {
    return ['-p', task, '-s', '--allow-all', '--no-ask-user'];
  },
  extractFinal(stdout: string, stderr: string): string {
    return extractText(stdout, stderr);
  },
};
