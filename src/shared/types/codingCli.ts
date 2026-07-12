/**
 * Shared coding-CLI types.
 *
 * The coding-agent built-in tool can drive one of several external coding CLIs. The chosen CLI is
 * a profile-level setting. These types are the single source of truth shared across the main
 * process (adapters, profile persistence), the IPC contract, and the renderer Settings UI.
 *
 * OpenKosmos only detects availability and invokes these CLIs; it never installs or updates them.
 */

/** Stable identifier for a supported coding CLI, persisted in profile.json. */
export type CodingCliId = 'claude' | 'codex' | 'gemini' | 'copilot';

/** All supported ids in stable display order. */
export const CODING_CLI_IDS: readonly CodingCliId[] = ['claude', 'codex', 'gemini', 'copilot'];

/**
 * Human-readable display name for each CLI. Single source of truth shared across the main-process
 * adapters, IPC availability payloads, the Settings UI, and the coding-agent tool-call view.
 */
export const CODING_CLI_DISPLAY_NAMES: Record<CodingCliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  copilot: 'GitHub Copilot CLI',
};

/** Serializable availability result for a single CLI, returned over IPC to the renderer. */
export interface CodingCliAvailability {
  id: CodingCliId;
  displayName: string;
  binaryName: string;
  installHint: string;
  docsUrl: string;
  available: boolean;
  path: string | null;
}
