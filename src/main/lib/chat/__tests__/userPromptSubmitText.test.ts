import { describe, expect, it } from 'vitest';
import type { UserMessage } from '@shared/types/chatTypes';

import { buildUserPromptSubmitText } from '../userPromptSubmitText';

describe('buildUserPromptSubmitText', () => {
  it('preserves text-only prompts', () => {
    expect(buildUserPromptSubmitText(message([{ type: 'text', text: 'hello' }]))).toBe('hello');
  });

  it('summarizes all attachment types without raw payloads', () => {
    const prompt = buildUserPromptSubmitText(message([
      { type: 'text', text: 'review this' },
      {
        type: 'image',
        image_url: { url: 'data:image/png;base64,secret' },
        metadata: { fileName: 'diagram.png', fileSize: 1234, mimeType: 'image/png' },
      },
      {
        type: 'file',
        file: { fileName: 'notes.md', filePath: '/tmp/notes.md', mimeType: 'text/markdown' },
        metadata: { fileSize: 456 },
      },
      {
        type: 'office',
        file: { fileName: 'deck.pptx', filePath: '/tmp/deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
        metadata: { fileSize: 789 },
      },
      {
        type: 'others',
        file: { fileName: 'archive.zip', filePath: '', mimeType: 'application/zip' },
        metadata: { fileSize: 111 },
      },
    ]));

    expect(prompt).toContain('review this');
    expect(prompt).toContain('[image: diagram.png, image/png, 1234 bytes]');
    expect(prompt).toContain('[file: notes.md, text/markdown, 456 bytes, path: /tmp/notes.md]');
    expect(prompt).toContain('[office: deck.pptx, application/vnd.openxmlformats-officedocument.presentationml.presentation, 789 bytes, path: /tmp/deck.pptx]');
    expect(prompt).toContain('[attachment: archive.zip, application/zip, 111 bytes]');
    expect(prompt).not.toContain('secret');
  });
});

function message(content: UserMessage['content']): UserMessage {
  return {
    id: 'user-1',
    role: 'user',
    timestamp: 1,
    content,
  };
}
