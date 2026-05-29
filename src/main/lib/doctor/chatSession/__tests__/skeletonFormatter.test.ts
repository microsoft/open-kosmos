import { describe, it, expect } from 'vitest';
import { formatSkeleton } from '../skeletonFormatter';
import type { ChatSessionFile } from '../../../userDataADO/chatSessionFileOps';

function makeFile(overrides: Partial<ChatSessionFile> = {}): ChatSessionFile {
  return {
    chatSession_id: 'sess-1',
    title: 'My Test Session',
    last_updated: '2026-01-01T00:00:00Z',
    chat_history: [],
    context_history: [],
    interaction_history: [],
    ...overrides,
  } as unknown as ChatSessionFile;
}

describe('formatSkeleton', () => {
  it('returns an error block when given a non-object', () => {
    const result = formatSkeleton(null as any);
    expect(result).toContain('Error');
  });

  it('returns an error block when given a string', () => {
    const result = formatSkeleton('bad' as any);
    expect(result).toContain('Error');
  });

  it('includes session header fields', () => {
    const file = makeFile();
    const result = formatSkeleton(file);
    expect(result).toContain('sess-1');
    expect(result).toContain('My Test Session');
    expect(result).toContain('chat_history.length: 0');
    expect(result).toContain('context_history.length: 0');
    expect(result).toContain('interaction_history.length: 0');
  });

  it('includes HTML comment with size info', () => {
    const file = makeFile();
    const result = formatSkeleton(file);
    expect(result).toContain('<!--');
    expect(result).toContain('Original JSON size');
    expect(result).toContain('Skeleton size');
  });

  it('includes the reading guide', () => {
    const file = makeFile();
    const result = formatSkeleton(file);
    expect(result).toContain('Reading Guide');
  });

  it('renders chat_history messages table', () => {
    const file = makeFile({
      chat_history: [
        { id: 'u1', role: 'user', timestamp: 1000, content: [{ type: 'text', text: 'hello' }] } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('u1');
    expect(result).toContain('user');
  });

  it('renders assistant messages with tool_calls summary', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 'a1',
          role: 'assistant',
          timestamp: 2000,
          content: [{ type: 'text', text: 'done' }],
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{}' } }],
          streamingComplete: true,
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-4',
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('search');
    expect(result).toContain('true');
    expect(result).toContain('gpt-4');
  });

  it('renders tool messages with tool_call_id and name', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 't1',
          role: 'tool',
          timestamp: 3000,
          content: [{ type: 'text', text: 'result data' }],
          tool_call_id: 'call-xyz',
          name: 'some_tool',
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('call-xyz');
    expect(result).toContain('some_tool');
  });

  it('renders image parts with metadata', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 'u2',
          role: 'user',
          timestamp: 1000,
          content: [
            {
              type: 'image',
              image_url: { url: 'data:...', detail: 'high' },
              metadata: {
                fileName: 'photo.jpg',
                fileSize: 4096,
                width: 800,
                height: 600,
                mimeType: 'image/jpeg',
                storageCompressed: true,
                originalSize: 8192,
                compressionRatio: 0.5,
                compressionStage: 'encode',
              },
            },
          ],
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('image');
    expect(result).toContain('photo.jpg');
  });

  it('renders thinking parts with tool_calls count', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 'a2',
          role: 'assistant',
          timestamp: 2000,
          content: [
            {
              type: 'thinking',
              text: 'some thoughts',
              tool_calls: [
                { id: 'tc1', type: 'function', function: { name: 'fn', arguments: '{}' } },
              ],
            },
          ],
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('thinking');
    expect(result).toContain('1'); // tool_calls count
  });

  it('renders file parts', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 'u3',
          role: 'user',
          timestamp: 1000,
          content: [
            {
              type: 'file',
              file: { fileName: 'doc.txt', filePath: '/tmp/doc.txt', mimeType: 'text/plain', extension: 'txt' },
              metadata: { fileSize: 512, lines: 10, lastModified: 1000, encoding: 'utf8', truncated: false },
            },
          ],
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('file');
    expect(result).toContain('doc.txt');
  });

  it('renders office parts', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 'u4',
          role: 'user',
          timestamp: 1000,
          content: [
            {
              type: 'office',
              file: { fileName: 'report.docx', filePath: '/tmp/report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
              metadata: { fileSize: 1024, pages: 5 },
            },
          ],
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('office');
  });

  it('renders others parts', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 'u5',
          role: 'user',
          timestamp: 1000,
          content: [
            {
              type: 'others',
              file: { fileName: 'archive.zip', filePath: '/tmp/archive.zip', mimeType: 'application/zip' },
              metadata: { fileSize: 2048, description: 'zipped', detail: 'auto' },
            },
          ],
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('others');
  });

  it('renders tool call rows for assistant top-level tool_calls', () => {
    const file = makeFile({
      chat_history: [
        {
          id: 'a3',
          role: 'assistant',
          timestamp: 2000,
          content: [],
          tool_calls: [
            { id: 'tc2', type: 'function', function: { name: 'fn2', arguments: '{"key":"value"}' } },
          ],
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('fn2');
  });

  it('renders interaction_history table', () => {
    const file = makeFile({
      interaction_history: [
        {
          interactionId: 'int-1',
          requestType: 'approval',
          title: 'Approve action',
          description: 'Some description',
          source: 'agent',
          resolutionSource: 'user',
          createdAt: 1000,
          resolvedAt: 2000,
          status: 'resolved',
          summaryText: 'done',
        } as any,
      ],
    });
    const result = formatSkeleton(file);
    expect(result).toContain('int-1');
    expect(result).toContain('approval');
    expect(result).toContain('Approve action');
  });

  it('truncates long title to TITLE_MAX_CHARS (200)', () => {
    const file = makeFile({ title: 'T'.repeat(300) });
    const result = formatSkeleton(file);
    expect(result).toContain('truncated');
  });

  it('handles missing optional fields gracefully', () => {
    const file = makeFile({ title: undefined, last_updated: undefined, chatSession_id: undefined } as any);
    const result = formatSkeleton(file);
    expect(result).toContain('## Session');
  });

  it('handles cells with pipe characters (escaping)', () => {
    const file = makeFile({
      chat_history: [
        { id: 'u6|pipe', role: 'user', timestamp: 1000, content: [{ type: 'text', text: 'a|b|c' }] } as any,
      ],
    });
    const result = formatSkeleton(file);
    // Pipe characters in message id should be escaped (text content is replaced by length number)
    expect(result).toContain('u6\\|pipe');
  });

  it('respects custom interactionTextLimit', () => {
    const longText = 'L'.repeat(300);
    const file = makeFile({
      interaction_history: [
        {
          interactionId: 'int-2',
          requestType: 'approval',
          title: longText,
          description: '',
          createdAt: 1000,
          resolvedAt: 2000,
          status: 'resolved',
          summaryText: '',
        } as any,
      ],
    });
    const defaultResult = formatSkeleton(file);
    const limitedResult = formatSkeleton(file, { interactionTextLimit: 50 });
    expect(limitedResult.length).toBeLessThan(defaultResult.length);
  });
});
