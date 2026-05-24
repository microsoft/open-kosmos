/**
 * Utility for wrapping system-injected content in <system-reminder> tags.
 *
 * Convention (matching Claude Code):
 *   All content that is automatically injected by the system — as opposed to
 *   direct user input — should be wrapped in <system-reminder> tags.  The
 *   system prompt tells the model to treat these as authoritative guidance.
 *
 * When to wrap:
 *   - Skill snapshots / skill listing / skill content
 *   - Knowledge-base context
 *   - Runtime environment notices (remote session, scheduled job)
 *   - Plugin hook additional context
 *   - Sub-agent turn-progress hints
 *   - Tool results that carry system-level guidance (e.g. Skill tool output)
 *
 * When NOT to wrap:
 *   - The base system prompt itself (already highest priority)
 *   - User-authored custom system prompts
 *   - Agent identity blocks (authored by the user via agent config)
 */

export function wrapInSystemReminder(content: string): string {
  if (!content) return content;
  return `<system-reminder>\n${content}\n</system-reminder>`;
}
