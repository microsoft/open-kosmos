import type { UserMessage } from '@shared/types/chatTypes';

/**
 * Strip the surrounding square brackets from inline mention/skill tokens so the
 * agent receives them as markdown inline code. Mirrors the token syntax emitted
 * by the composer autocomplete: [@knowledge-base:...], [@chat-session:...],
 * [@workspace:...] (backward-compatible) and [#skill:...]. Mutates and returns
 * the same message so callers can keep their existing in-place semantics.
 */
export function normalizeComposerMentions(message: UserMessage): UserMessage {
  message.content = message.content.map((part) => {
    if (part.type === 'text') {
      let processedText = part.text;

      processedText = processedText.replace(
        /\[@knowledge-base:([^\]]+)\]/g,
        '`@knowledge-base:$1`'
      );

      processedText = processedText.replace(
        /\[@chat-session:([^\]]+)\]/g,
        '`@chat-session:$1`'
      );

      processedText = processedText.replace(
        /\[@workspace:([^\]]+)\]/g,
        '`@workspace:$1`'
      );

      processedText = processedText.replace(
        /\[#skill:([^\]]+)\]/g,
        '`#skill:$1`'
      );

      return {
        ...part,
        text: processedText,
      };
    }
    return part;
  });

  return message;
}
