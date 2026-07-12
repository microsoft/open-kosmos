import { describe, expect, it } from 'vitest';
import type { ImageContentPart, TextContentPart, UserMessage } from '@shared/types/chatTypes';
import { normalizeComposerMentions } from '../composerMentions';

function textPart(text: string): TextContentPart {
  return { type: 'text', text };
}

function imagePart(): ImageContentPart {
  return {
    type: 'image',
    image_url: { url: 'data:image/png;base64,abc' },
    metadata: { fileName: 'a.png', fileSize: 10, mimeType: 'image/png' },
  };
}

function userMessage(content: Array<TextContentPart | ImageContentPart>): UserMessage {
  return {
    id: 'm1',
    role: 'user',
    content,
    timestamp: 123,
  } as UserMessage;
}

describe('normalizeComposerMentions', () => {
  it('strips brackets from every supported mention/skill token', () => {
    const message = userMessage([
      textPart('[@knowledge-base:Docs] [@chat-session:S1] [@workspace:W1] [#skill:pdf]'),
    ]);

    const result = normalizeComposerMentions(message);
    const text = (result.content[0] as TextContentPart).text;

    expect(text).toBe('`@knowledge-base:Docs` `@chat-session:S1` `@workspace:W1` `#skill:pdf`');
  });

  it('converts multiple occurrences of the same token type', () => {
    const message = userMessage([
      textPart('[@knowledge-base:A] and [@knowledge-base:B]'),
    ]);

    normalizeComposerMentions(message);

    expect((message.content[0] as TextContentPart).text).toBe(
      '`@knowledge-base:A` and `@knowledge-base:B`',
    );
  });

  it('leaves plain text without tokens unchanged', () => {
    const message = userMessage([textPart('just a normal prompt')]);

    normalizeComposerMentions(message);

    expect((message.content[0] as TextContentPart).text).toBe('just a normal prompt');
  });

  it('leaves non-text parts untouched', () => {
    const image = imagePart();
    const message = userMessage([textPart('[#skill:pdf]'), image]);

    const result = normalizeComposerMentions(message);

    expect((result.content[0] as TextContentPart).text).toBe('`#skill:pdf`');
    expect(result.content[1]).toEqual(image);
  });

  it('mutates and returns the same message instance', () => {
    const message = userMessage([textPart('[@chat-session:S1]')]);

    const result = normalizeComposerMentions(message);

    expect(result).toBe(message);
  });
});
