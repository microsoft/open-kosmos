/**
 * agentChatUtilities.extra.test.ts
 *
 * Supplementary tests for agentChatUtilities.ts covering paths not exercised
 * in the primary test file.
 *
 * Uncovered paths targeted:
 *  - normalizeToolArguments: non-string rawArgs (object) → stringifies
 *  - normalizeToolArguments: fallback extract path (first JSON inside garbage)
 *  - normalizeToolArguments: single-segment split after failed direct parse
 *  - normalizeToolCalls: undefined arguments (no function.arguments key)
 *  - normalizeToolCalls: non-null non-string rawArgs (object value)
 *  - normalizeToolCalls: stringify failure path (circular)
 *  - detectTruncatedToolCalls: empty list
 *  - detectTruncatedToolCalls: non-string args + no required fields → not truncated
 *  - detectTruncatedToolCalls: non-string args + required fields → truncated
 *  - detectTruncatedToolCalls: empty args + no required fields
 *  - detectTruncatedToolCalls: balanced braces but fails JSON.parse
 *  - detectTruncatedToolCalls: unbalanced brackets
 *  - detectTruncatedToolCalls: unbalanced string quotes
 *  - extractFirstJsonStructure: empty and array input
 *  - extractFirstJsonStructure: no JSON structure found
 *  - sanitizeToolCallsForApi: non-object tool call passes through unchanged
 *  - sanitizeToolCallsForApi: missing function field passes through
 *  - sanitizeToolCallsForApi: non-string args get stringified
 *  - sanitizeToolCallsForApi: empty string args → '{}'
 *  - sanitizeToolCallsForApi: garbage string → '{}'
 *  - hasImageContentInMessages: null / non-array input
 *  - hasImageContentInMessages: string content (not array)
 *  - hasImageContentInMessages: image_url type detected
 *  - compressContextHistoryWithFullMode: compressor throws
 *  - compressContextHistoryWithFullMode: compressed not shorter → false
 *  - applyStorageCompressionToRecentMessages: no user messages → false
 *  - applyStorageCompressionToRecentMessages: last user message has no images → false
 *  - applyStorageCompressionToRecentMessages: all images already compressed → false
 *  - applyStorageCompressionToRecentMessages: compression succeeds
 *  - applyStorageCompressionToRecentMessages: compression throws
 *  - formatMessagesForApi: user message with images only (no files/office)
 *  - formatMessagesForApi: user message with office files only
 *  - formatMessagesForApi: user message with other files only
 *  - formatMessagesForApi: user message with images + files + office + others mixed
 *  - formatMessagesForApi: tool message in systemMessages list
 *  - formatMessagesForApi: /responses endpoint with tool_calls + content
 *  - formatMessagesForApi: convertResponseMessageContent empty array fallback
 */

import type { Message } from '../../../../shared/types/chatTypes';
import {
  normalizeToolArguments,
  normalizeToolCalls,
  detectTruncatedToolCalls,
  extractFirstJsonStructure,
  sanitizeToolCallsForApi,
  hasImageContentInMessages,
  compressContextHistoryWithFullMode,
  applyStorageCompressionToRecentMessages,
  formatMessagesForApi,
  mergeConsecutiveUserMessages,
} from '../agentChatUtilities';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../utilities/imageStorageCompression', () => ({
  compressMessageImagesForStorage: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { compressMessageImagesForStorage } from '../../utilities/imageStorageCompression';

const mockCompressMessageImages = compressMessageImagesForStorage as ReturnType<typeof vi.fn>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUserMsg(content: any[]): Message {
  return { id: 'u1', role: 'user', timestamp: 1, content } as Message;
}

// ─── normalizeToolArguments ───────────────────────────────────────────────────

describe('normalizeToolArguments — uncovered branches', () => {
  it('stringifies non-string rawArgs (object)', () => {
    const result = normalizeToolArguments('tool', { command: 'ls' } as any, 0);
    expect(result.didChange).toBe(true);
    expect(JSON.parse(result.argumentsList[0])).toEqual({ command: 'ls' });
  });

  it('extracts first JSON structure from garbage-wrapped JSON', () => {
    const result = normalizeToolArguments('tool', 'prefix garbage {"command":"echo"} trailing', 0);
    expect(result.didChange).toBe(true);
    expect(JSON.parse(result.argumentsList[0])).toEqual({ command: 'echo' });
  });

  it('returns raw string when no JSON structure can be extracted at all', () => {
    const raw = 'totally not json at all';
    const result = normalizeToolArguments('tool', raw, 0);
    expect(result.argumentsList).toEqual([raw]);
  });

  it('returns single parsed segment when split produces exactly one valid object', () => {
    // splitConcatenatedJsonObjects returns two segments but only one parses
    const raw = '{"a":1}invalid';
    const result = normalizeToolArguments('tool', raw, 0);
    expect(result.argumentsList).toHaveLength(1);
    expect(JSON.parse(result.argumentsList[0])).toEqual({ a: 1 });
  });
});

// ─── normalizeToolCalls ───────────────────────────────────────────────────────

describe('normalizeToolCalls — uncovered branches', () => {
  it('handles tool call with no function.arguments key (undefined args)', () => {
    const toolCalls = [
      { id: 'tc1', function: { name: 'tool', arguments: undefined } },
    ];
    const result = normalizeToolCalls(toolCalls as any);
    expect(result).toHaveLength(1);
    expect(result![0].function.arguments).toBeUndefined();
  });

  it('passes through tool call with null/non-object value', () => {
    const toolCalls = [null, 'string', 42];
    const result = normalizeToolCalls(toolCalls as any);
    expect(result).toEqual(toolCalls);
  });

  it('passes through tool call without a function object', () => {
    const toolCalls = [{ id: 'tc1', type: 'function' }];
    const result = normalizeToolCalls(toolCalls as any);
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual({ id: 'tc1', type: 'function' });
  });

  it('stringifies non-string object arguments', () => {
    const toolCalls = [
      { id: 'tc1', function: { name: 'exec', arguments: { command: 'pwd' } } },
    ];
    const result = normalizeToolCalls(toolCalls as any);
    expect(typeof result![0].function.arguments).toBe('string');
    expect(JSON.parse(result![0].function.arguments)).toEqual({ command: 'pwd' });
  });
});

// ─── detectTruncatedToolCalls ─────────────────────────────────────────────────

describe('detectTruncatedToolCalls — uncovered branches', () => {
  it('returns empty array for empty input', () => {
    expect(detectTruncatedToolCalls([])).toEqual([]);
  });

  it('non-string args with no required fields → not truncated', () => {
    const toolCalls = [{ function: { name: 'get_current_datetime', arguments: 42 } }];
    expect(detectTruncatedToolCalls(toolCalls as any)).toEqual([]);
  });

  it('non-string args with required fields → truncated', () => {
    const toolCalls = [{ function: { name: 'execute_command', arguments: null } }];
    expect(detectTruncatedToolCalls(toolCalls as any)).toEqual(toolCalls);
  });

  it('empty string args with no required fields → not truncated', () => {
    const toolCalls = [{ function: { name: 'get_current_datetime', arguments: '' } }];
    expect(detectTruncatedToolCalls(toolCalls as any)).toEqual([]);
  });

  it('empty string args with required fields → truncated', () => {
    const toolCalls = [{ function: { name: 'execute_command', arguments: '' } }];
    expect(detectTruncatedToolCalls(toolCalls as any)).toEqual(toolCalls);
  });

  it('balanced braces but invalid JSON → truncated', () => {
    const toolCalls = [{ function: { name: 'execute_command', arguments: '{command:echo}' } }];
    expect(detectTruncatedToolCalls(toolCalls as any)).toHaveLength(1);
  });

  it('unbalanced brackets → truncated', () => {
    const toolCalls = [{ function: { name: 'write_file', arguments: '{"filePath":"f","content":["a"' } }];
    expect(detectTruncatedToolCalls(toolCalls as any)).toHaveLength(1);
  });

  it('unbalanced string quotes → truncated', () => {
    const toolCalls = [{ function: { name: 'execute_command', arguments: '{"command":"echo hello}' } }];
    expect(detectTruncatedToolCalls(toolCalls as any)).toHaveLength(1);
  });

  it('valid JSON with all required fields → not truncated', () => {
    const toolCalls = [
      { function: { name: 'execute_command', arguments: '{"command":"ls -la"}' } },
    ];
    expect(detectTruncatedToolCalls(toolCalls as any)).toEqual([]);
  });

  it('valid JSON but missing required field → truncated', () => {
    const toolCalls = [
      { function: { name: 'write_file', arguments: '{"filePath":"/tmp/f.txt"}' } },
    ];
    expect(detectTruncatedToolCalls(toolCalls as any)).toHaveLength(1);
  });

  it('handles escape sequences in strings without false-positive truncation', () => {
    const toolCalls = [
      { function: { name: 'execute_command', arguments: '{"command":"echo \\"hello\\""}' } },
    ];
    expect(detectTruncatedToolCalls(toolCalls as any)).toEqual([]);
  });
});

// ─── extractFirstJsonStructure ────────────────────────────────────────────────

describe('extractFirstJsonStructure — uncovered branches', () => {
  it('returns null for empty string', () => {
    expect(extractFirstJsonStructure('')).toBeNull();
  });

  it('returns null when no JSON structure found', () => {
    expect(extractFirstJsonStructure('just plain text')).toBeNull();
  });

  it('extracts JSON array from surrounding text', () => {
    expect(extractFirstJsonStructure('result: [1,2,3] done')).toBe('[1,2,3]');
  });

  it('handles escaped quotes inside strings', () => {
    const result = extractFirstJsonStructure('prefix {"key":"val\\"ue"} suffix');
    expect(result).toBe('{"key":"val\\"ue"}');
  });
});

// ─── sanitizeToolCallsForApi ──────────────────────────────────────────────────

describe('sanitizeToolCallsForApi — uncovered branches', () => {
  it('passes through null/non-object tool calls unchanged', () => {
    const { toolCalls, sanitizedCount } = sanitizeToolCallsForApi([null as any, undefined as any]);
    expect(toolCalls).toEqual([null, undefined]);
    expect(sanitizedCount).toBe(0);
  });

  it('passes through tool calls without a function object', () => {
    const call = { id: 'tc1' } as any;
    const { toolCalls, sanitizedCount } = sanitizeToolCallsForApi([call]);
    expect(toolCalls[0]).toBe(call);
    expect(sanitizedCount).toBe(0);
  });

  it('sanitizes non-string arguments by stringifying', () => {
    const call = {
      id: 'tc1',
      type: 'function',
      function: { name: 'exec', arguments: { command: 'ls' } },
    } as any;
    const { toolCalls, sanitizedCount } = sanitizeToolCallsForApi([call]);
    expect(sanitizedCount).toBe(1);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ command: 'ls' });
  });

  it('sanitizes empty string arguments to {}', () => {
    const call = {
      id: 'tc1',
      type: 'function',
      function: { name: 'exec', arguments: '' },
    } as any;
    const { toolCalls, sanitizedCount } = sanitizeToolCallsForApi([call]);
    expect(sanitizedCount).toBe(1);
    expect(toolCalls[0].function.arguments).toBe('{}');
  });

  it('sanitizes garbage string arguments to {}', () => {
    const call = {
      id: 'tc1',
      type: 'function',
      function: { name: 'exec', arguments: 'totally garbage' },
    } as any;
    const { toolCalls, sanitizedCount } = sanitizeToolCallsForApi([call]);
    expect(sanitizedCount).toBe(1);
    expect(toolCalls[0].function.arguments).toBe('{}');
  });

  it('does not sanitize already-valid JSON arguments', () => {
    const args = '{"command":"ls"}';
    const call = {
      id: 'tc1',
      type: 'function',
      function: { name: 'exec', arguments: args },
    } as any;
    const { sanitizedCount } = sanitizeToolCallsForApi([call]);
    expect(sanitizedCount).toBe(0);
  });
});

// ─── hasImageContentInMessages ────────────────────────────────────────────────

describe('hasImageContentInMessages — uncovered branches', () => {
  it('returns false for null input', () => {
    expect(hasImageContentInMessages(null as any)).toBe(false);
  });

  it('returns false for non-array input', () => {
    expect(hasImageContentInMessages('not array' as any)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasImageContentInMessages([])).toBe(false);
  });

  it('returns false when message content is a string', () => {
    expect(hasImageContentInMessages([{ role: 'user', content: 'hello' }] as any)).toBe(false);
  });

  it('returns false when no image_url/input_image content parts', () => {
    const msgs = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] as any;
    expect(hasImageContentInMessages(msgs)).toBe(false);
  });

  it('returns true for image_url content part', () => {
    const msgs = [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],
    }] as any;
    expect(hasImageContentInMessages(msgs)).toBe(true);
  });
});

// ─── compressContextHistoryWithFullMode ───────────────────────────────────────

describe('compressContextHistoryWithFullMode — uncovered branches', () => {
  const history: Message[] = [
    { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'a' }] },
    { id: 'u2', role: 'user', timestamp: 2, content: [{ type: 'text', text: 'b' }] },
    { id: 'u3', role: 'user', timestamp: 3, content: [{ type: 'text', text: 'c' }] },
  ];

  it('returns false when compressor throws', async () => {
    const compressor = {
      compressMessages: vi.fn().mockRejectedValue(new Error('OOM')),
    } as any;
    const result = await compressContextHistoryWithFullMode(history, compressor, 'agent');
    expect(result.success).toBe(false);
    expect(result.compressedMessages).toBe(history);
  });

  it('returns false when compressed count is not shorter than original', async () => {
    const compressor = {
      compressMessages: vi.fn().mockResolvedValue({
        success: true,
        compressedMessages: [...history], // same length
        summary: 'summary',
        strategy: 'intelligent_summary',
        metadata: { compressionMethod: 'summary', chunkSummaryCallCount: 0, totalLlmCallCount: 1 },
        processingTime: 100,
      }),
    } as any;
    const result = await compressContextHistoryWithFullMode(history, compressor, 'agent');
    expect(result.success).toBe(false);
    expect(result.compressedMessages).toBe(history);
  });

  it('returns false when summary method has empty summary', async () => {
    const shorter = [history[0]];
    const compressor = {
      compressMessages: vi.fn().mockResolvedValue({
        success: true,
        compressedMessages: shorter,
        summary: '   ', // whitespace only
        strategy: 'intelligent_summary',
        metadata: { compressionMethod: 'summary', chunkSummaryCallCount: 0, totalLlmCallCount: 1 },
        processingTime: 100,
      }),
    } as any;
    const result = await compressContextHistoryWithFullMode(history, compressor, 'agent');
    expect(result.success).toBe(false);
  });
});

// ─── applyStorageCompressionToRecentMessages ─────────────────────────────────

describe('applyStorageCompressionToRecentMessages', () => {
  beforeEach(() => {
    mockCompressMessageImages.mockReset();
  });

  it('returns false when no user messages', async () => {
    const history: Message[] = [
      { id: 'a1', role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'hi' }] },
    ];
    const result = await applyStorageCompressionToRecentMessages(history, 'agent');
    expect(result.success).toBe(false);
  });

  it('returns false when last user message has no images', async () => {
    const history: Message[] = [
      { id: 'u1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hello' }] },
    ];
    const result = await applyStorageCompressionToRecentMessages(history, 'agent');
    expect(result.success).toBe(false);
  });

  it('returns false when all images already compressed', async () => {
    const history: Message[] = [
      {
        id: 'u1',
        role: 'user',
        timestamp: 1,
        content: [
          { type: 'text', text: 'look' },
          {
            type: 'image',
            image_url: { url: 'data:image/png;base64,abc', detail: 'high' },
            metadata: {
              fileName: 'img.png',
              fileSize: 100,
              mimeType: 'image/png',
              storageCompressed: true, // already compressed
            },
          } as any,
        ],
      },
    ];
    const result = await applyStorageCompressionToRecentMessages(history, 'agent');
    expect(result.success).toBe(false);
    expect(mockCompressMessageImages).not.toHaveBeenCalled();
  });

  it('returns success when compression succeeds', async () => {
    const originalMsg: Message = {
      id: 'u1',
      role: 'user',
      timestamp: 1,
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,bigdata', detail: 'high' },
          metadata: {
            fileName: 'img.png',
            fileSize: 5000,
            mimeType: 'image/png',
            storageCompressed: false,
          },
        } as any,
      ],
    };

    const compressedMsg: Message = {
      id: 'u1',
      role: 'user',
      timestamp: 1,
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,small', detail: 'high' },
          metadata: {
            fileName: 'img.png',
            fileSize: 1000,
            mimeType: 'image/png',
            storageCompressed: true,
          },
        } as any,
      ],
    };

    mockCompressMessageImages.mockResolvedValue(compressedMsg);

    const result = await applyStorageCompressionToRecentMessages([originalMsg], 'agent');
    expect(result.success).toBe(true);
    expect(result.compressedMessage).toBe(compressedMsg);
  });

  it('returns false when compressMessageImagesForStorage throws', async () => {
    const originalMsg: Message = {
      id: 'u1',
      role: 'user',
      timestamp: 1,
      content: [
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,data' },
          metadata: {
            fileName: 'img.png',
            fileSize: 5000,
            mimeType: 'image/png',
            storageCompressed: false,
          },
        } as any,
      ],
    };

    mockCompressMessageImages.mockRejectedValue(new Error('compression error'));

    const result = await applyStorageCompressionToRecentMessages([originalMsg], 'agent');
    expect(result.success).toBe(false);
  });
});

// ─── formatMessagesForApi — additional paths ──────────────────────────────────

describe('formatMessagesForApi — additional uncovered paths', () => {
  it('formats user message with images only (no files)', async () => {
    const msg: Message = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [
        { type: 'text', text: 'Here is an image' },
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,abc', detail: 'high' },
          metadata: { fileName: 'p.png', fileSize: 100, mimeType: 'image/png' },
        } as any,
      ],
    };

    const result = await formatMessagesForApi([], [msg], false, '/chat/completions') as any[];
    expect(result[0].role).toBe('user');
    expect(Array.isArray(result[0].content)).toBe(true);
    const imagePart = result[0].content.find((p: any) => p.type === 'image_url');
    expect(imagePart?.image_url.url).toBe('data:image/png;base64,abc');
    expect(imagePart?.image_url.detail).toBe('high');
  });

  it('normalizes unknown image detail to undefined', async () => {
    const msg: Message = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [
        { type: 'text', text: 'image' },
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,abc', detail: 'auto' }, // invalid detail
          metadata: { fileName: 'p.png', fileSize: 100, mimeType: 'image/png' },
        } as any,
      ],
    };

    const result = await formatMessagesForApi([], [msg], false, '/chat/completions') as any[];
    const imagePart = result[0].content.find((p: any) => p.type === 'image_url');
    expect(imagePart?.image_url.detail).toBeUndefined();
  });

  it('formats user message with Office files only', async () => {
    const msg: Message = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [
        { type: 'text', text: 'review this doc' },
        {
          type: 'office',
          file: { fileName: 'report.docx', filePath: '/tmp/report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' },
          metadata: { fileSize: 40960, pages: 10 },
        } as any,
      ],
    };

    const result = await formatMessagesForApi([], [msg], false, '/chat/completions') as any[];
    expect(typeof result[0].content).toBe('string');
    expect(result[0].content).toContain('report.docx');
    expect(result[0].content).toContain('Office');
  });

  it('formats user message with other file types only', async () => {
    const msg: Message = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [
        { type: 'text', text: 'see this binary' },
        {
          type: 'others',
          file: { fileName: 'data.bin', filePath: '/tmp/data.bin', mimeType: 'application/octet-stream' },
          metadata: { fileSize: 2048, fileExtension: 'bin', description: 'Binary data' },
        } as any,
      ],
    };

    const result = await formatMessagesForApi([], [msg], false, '/chat/completions') as any[];
    expect(typeof result[0].content).toBe('string');
    expect(result[0].content).toContain('data.bin');
    expect(result[0].content).toContain('Other Files');
  });

  it('formats user message with images + files + office + others mixed', async () => {
    const msg: Message = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [
        { type: 'text', text: 'Mixed content' },
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,abc' },
          metadata: { fileName: 'p.png', fileSize: 100, mimeType: 'image/png' },
        } as any,
        {
          type: 'file',
          file: { fileName: 'notes.txt', filePath: '/tmp/notes.txt', mimeType: 'text/plain' },
          metadata: { fileSize: 500, lines: 20 },
        } as any,
        {
          type: 'office',
          file: { fileName: 'slide.pptx', filePath: '/tmp/slide.pptx', mimeType: 'application/vnd.ms-powerpoint', extension: 'pptx' },
          metadata: { fileSize: 2048000, pages: 30 },
        } as any,
        {
          type: 'others',
          file: { fileName: 'data.bin', filePath: '/tmp/data.bin', mimeType: 'application/octet-stream' },
          metadata: { fileSize: 1024, fileExtension: 'bin', description: 'Binary' },
        } as any,
      ],
    };

    const result = await formatMessagesForApi([], [msg], false, '/chat/completions') as any[];
    expect(result[0].role).toBe('user');
    expect(Array.isArray(result[0].content)).toBe(true);
    // Should have text + image parts
    const parts = result[0].content;
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('notes.txt');
    expect(parts[0].text).toContain('slide.pptx');
    expect(parts[0].text).toContain('data.bin');
    expect(parts.some((p: any) => p.type === 'image_url')).toBe(true);
  });

  it('includes tool message from systemMessages when tool_call_id is valid', async () => {
    const systemMsgs: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'text', text: '' }],
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'exec', arguments: '{}' } }],
      },
      {
        id: 't1',
        role: 'tool',
        timestamp: 2,
        content: [{ type: 'text', text: 'output' }],
        tool_call_id: 'tc1',
        name: 'exec',
      } as any,
    ];

    const result = await formatMessagesForApi(systemMsgs, [], true, '/chat/completions') as any[];
    const toolMsg = result.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(toolMsg.tool_call_id).toBe('tc1');
    expect(toolMsg.name).toBe('exec');
  });

  it('/responses endpoint: assistant with tool_calls + content emits message then function_call', async () => {
    const msgs: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'text', text: 'Let me search.' }],
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"query":"foo"}' } },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        timestamp: 2,
        content: [{ type: 'text', text: '{"results":[]}' }],
        tool_call_id: 'tc1',
      } as any,
    ];

    const result = await formatMessagesForApi([], msgs, true, '/responses') as any[];
    const assistantMsg = result.find((m: any) => m.type === 'message' && m.role === 'assistant');
    const funcCall = result.find((m: any) => m.type === 'function_call');
    const funcOutput = result.find((m: any) => m.type === 'function_call_output');

    expect(assistantMsg).toBeTruthy();
    expect(funcCall?.call_id).toBe('tc1');
    expect(funcCall?.name).toBe('search');
    expect(funcOutput?.output).toBe('{"results":[]}');
  });

  it('/responses endpoint: multipart content (image) converts to input_image', async () => {
    const msg: Message = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [
        { type: 'text', text: 'describe' },
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,abc', detail: 'low' },
          metadata: { fileName: 'p.png', fileSize: 100, mimeType: 'image/png' },
        } as any,
      ],
    };

    const result = await formatMessagesForApi([], [msg], false, '/responses') as any[];
    const userMsg = result.find((m: any) => m.role === 'user');
    expect(Array.isArray(userMsg?.content)).toBe(true);
    const imgPart = userMsg.content.find((p: any) => p.type === 'input_image');
    expect(imgPart?.image_url).toBe('data:image/png;base64,abc');
    expect(imgPart?.detail).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// mergeConsecutiveUserMessages — multipart content preservation
// ---------------------------------------------------------------------------
describe('mergeConsecutiveUserMessages', () => {
  const user = (content: any) => ({ role: 'user' as const, content });
  const asst = (content: string) => ({ role: 'assistant' as const, content });

  it('merges two text-only user messages into a single string', () => {
    const result = mergeConsecutiveUserMessages([user('Hello'), user('World')] as any);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello\n\nWorld');
  });

  it('preserves image parts when merging multipart user messages', () => {
    const result = mergeConsecutiveUserMessages([
      user('Summary of conversation'),
      user([
        { type: 'text' as const, text: 'Look at this screenshot' },
        { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,abc' } },
      ]),
    ] as any);
    expect(result).toHaveLength(1);
    expect(Array.isArray(result[0].content)).toBe(true);
    const parts = result[0].content as any[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: 'text', text: 'Summary of conversation' });
    expect(parts[1]).toEqual({ type: 'text', text: 'Look at this screenshot' });
    expect(parts[2].type).toBe('image_url');
    expect(parts[2].image_url.url).toBe('data:image/png;base64,abc');
  });

  it('preserves images from both messages when merging two multipart messages', () => {
    const result = mergeConsecutiveUserMessages([
      user([
        { type: 'text' as const, text: 'First' },
        { type: 'image_url' as const, image_url: { url: 'img1' } },
      ]),
      user([
        { type: 'text' as const, text: 'Second' },
        { type: 'image_url' as const, image_url: { url: 'img2' } },
      ]),
    ] as any);
    expect(result).toHaveLength(1);
    const parts = result[0].content as any[];
    expect(parts).toHaveLength(4);
    const images = parts.filter((p: any) => p.type === 'image_url');
    expect(images).toHaveLength(2);
  });

  it('does not merge across non-user messages', () => {
    const result = mergeConsecutiveUserMessages([user('A'), asst('B'), user('C')] as any);
    expect(result).toHaveLength(3);
  });
});
