import { Companion } from './types';

const REACTION_THROTTLE_MS = 60_000;
const MAX_USER_MSG_LENGTH = 200;
const MAX_ASSISTANT_MSG_LENGTH = 300;

export function shouldThrottle(lastReactionTime: number): boolean {
  return Date.now() - lastReactionTime < REACTION_THROTTLE_MS;
}

export function buildReactionPrompt(
  companion: Companion,
  lastUserMsg: string,
  lastAssistantMsg: string,
): string {
  const truncatedUser = lastUserMsg.slice(0, MAX_USER_MSG_LENGTH);
  const truncatedAssistant = lastAssistantMsg.slice(0, MAX_ASSISTANT_MSG_LENGTH);

  return [
    `You are ${companion.name}, a ${companion.personality} ${companion.species} companion.`,
    `The user just said: "${truncatedUser}"`,
    `The assistant replied: "${truncatedAssistant}"`,
    '',
    'Write a very short reaction (max 80 chars) as this companion character.',
    'Be in character. Use ASCII emoticons if appropriate. Do NOT use markdown.',
    'Reply with ONLY the reaction text, nothing else.',
  ].join('\n');
}

export async function generateReaction(
  companion: Companion,
  lastUserMsg: string,
  lastAssistantMsg: string,
  lastReactionTime: number,
  callLLM: (prompt: string) => Promise<string>,
): Promise<{ text: string } | undefined> {
  if (shouldThrottle(lastReactionTime)) {
    return undefined;
  }

  try {
    const prompt = buildReactionPrompt(companion, lastUserMsg, lastAssistantMsg);
    const response = await callLLM(prompt);
    const text = response.trim().slice(0, 80);
    if (text.length === 0) {
      return undefined;
    }
    return { text };
  } catch (error) {
    console.error('[BuddyReaction] Failed to generate reaction:', error);
    return undefined;
  }
}
