import { Companion, RARITY_STARS } from './types';

/**
 * Generate a system prompt snippet introducing the companion.
 * Returns empty string if companion is null.
 */
export function getBuddySystemPrompt(companion: Companion | null): string {
  if (!companion) return '';

  const stars = RARITY_STARS[companion.rarity];
  return [
    '',
    '---',
    `[Companion: ${companion.name} — a ${companion.personality} ${companion.species} ${stars}]`,
    `The user has a virtual companion named ${companion.name}.`,
    `${companion.name} is a ${companion.rarity} ${companion.species} who is ${companion.personality}.`,
    'You may occasionally reference the companion in a natural, brief way,',
    'but do NOT let it interfere with the primary task. Keep companion mentions short and rare.',
    '---',
  ].join('\n');
}
