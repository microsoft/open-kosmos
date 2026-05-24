/**
 * pmAgentSayHiConfig.ts
 *
 * Hardcoded say-hi message and cards config for PM Agent.
 * This is the single source of truth for what greeting and action cards are
 * shown each time PM Agent opens a new chat session.
 *
 * To change the greeting or cards just edit this file — no other files need
 * to be touched for content changes.
 */

/** The agent name used to identify PM Agent chats. */
export const PM_AGENT_CANONICAL_NAME = 'PM Agent';

/**
 * Delimiter embedded in the say-hi message body that tells the renderer to
 * swap in the hardcoded PM Agent say-hi cards component.
 */
export const PM_AGENT_SAY_HI_CARDS_DELIMITER = '<!-- PM_AGENT_SAY_HI_CARDS -->';

/** A single PM Agent say-hi card entry. */
export interface PmAgentSayHiCard {
  /** Emoji displayed on the card. */
  emoji: string;
  /** Bold card title shown to the user. */
  title: string;
  /** Short description shown below the title. */
  description: string;
  /**
   * Optional prompt sent as a chat message when the card is clicked.
   * If absent, `description` is sent instead.
   */
  prompt?: string;
  /**
   * Optional special action type.
   * 'createProjectAgent' – navigate to /agent/chat/creation/pm-project
   * 'openFeedbackChannel' – open the configured feedback channel URL
   */
  action?: 'createProjectAgent' | 'openFeedbackChannel';
}

/** The four PM Agent say-hi cards (in display order). */
export const PM_AGENT_SAY_HI_CARDS: PmAgentSayHiCard[] = [
  {
    emoji: '🤖',
    title: 'Create new agent project',
    description:
      'Create an agent tailored to your project by selecting context, skills, and tools that fit your needs.',
    action: 'createProjectAgent',
  },
  {
    emoji: '📬',
    title: 'Catch me up',
    description:
      'Set up scheduled briefings to keep you in the loop automatically.',
    prompt:
      'Follow the instruction https://cdn.kosmos-ai.com/setup/pm-agent/catch-me-up-project-briefs.prompt.md to schedule briefs to keep you in the loop.',
  },
  {
    emoji: '💡',
    title: 'Submit Your Feedback',
    description:
      'Share your thoughts, report issues, or suggest improvements — help shape the product roadmap with your input.',
    action: 'openFeedbackChannel',
  },
];

/**
 * Generate the say-hi message body for PM Agent.
 *
 * The returned string includes the personalized greeting and the delimiter
 * that triggers the say-hi cards component in the chat renderer.
 *
 * @param userName - Display name of the signed-in user (e.g. "Alex").
 */
export function generatePmAgentSayHiMessage(userName: string): string {
  const displayName = userName && userName.trim() ? userName.trim() : 'there';
  return `Hey ${displayName}! 👋 What are we building today?\n${PM_AGENT_SAY_HI_CARDS_DELIMITER}`;
}

/**
 * Returns true when `rawText` (the content of a say-hi message) belongs to
 * the PM Agent say-hi card format.
 */
export function isPmAgentSayHiMessage(rawText: string): boolean {
  return rawText.includes(PM_AGENT_SAY_HI_CARDS_DELIMITER);
}

/**
 * Extract the markdown greeting body from a PM Agent say-hi message.
 *
 * Returns `null` when the message is not in PM Agent say-hi format.
 */
export function parsePmAgentSayHiMessage(rawText: string): {
  markdownBody: string;
} | null {
  const delimiterIndex = rawText.indexOf(PM_AGENT_SAY_HI_CARDS_DELIMITER);
  if (delimiterIndex === -1) return null;
  const markdownBody = rawText.slice(0, delimiterIndex).trimEnd();
  return { markdownBody };
}
