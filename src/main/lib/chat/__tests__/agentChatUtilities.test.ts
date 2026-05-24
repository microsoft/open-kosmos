import { Message, AssistantMessage, ToolMessage } from '../../../../shared/types/chatTypes';
import { deserializeMessage } from '@shared/utils/deserialize-message';
import {
  compressContextHistoryWithFullMode,
  convertMcpToolsToOpenAiFormat,
  detectTruncatedToolCalls,
  determineToolChoice,
  formatMessagesForApi,
  generateSyntheticToolCallId,
  getCompressionThreshold,
  checkCompressionNeeds,
  hasImageContentInMessages,
  isMissingCriticalToolCallFields,
  normalizeToolArguments,
  normalizeToolCalls,
  splitConcatenatedJsonObjects,
  stripJsonCodeFence,
  tryParseJson,
  validateToolsRequest,
} from '../agentChatUtilities';
import {
  isToolMessageOrphaned,
  sanitizeOrphanedToolMessages,
} from '../agentChatToolMessageSanitizer';

describe('agentChatUtilities /responses formatting', () => {
  it('nests image inputs inside the user message content for /responses requests', async () => {
    const systemMessage: Message = {
      id: 'sys-1',
      role: 'system',
      timestamp: 1000,
      content: [{ type: 'text', text: 'You are helpful.' }],
    };

    const userMessage: Message = {
      id: 'user-1',
      role: 'user',
      timestamp: 1000,
      content: [
        { type: 'text', text: 'Please summarize this design.' },
        {
          type: 'image',
          image_url: {
            url: 'data:image/png;base64,abc123',
            detail: 'high',
          },
          metadata: {
            fileName: 'design.png',
            fileSize: 128,
            mimeType: 'image/png',
          },
        },
      ],
    };

    const formatted = await formatMessagesForApi(
      [systemMessage],
      [userMessage],
      false,
      '/responses'
    );

    expect(formatted).toEqual([
      {
        type: 'message',
        role: 'system',
        content: 'You are helpful.',
      },
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Please summarize this design.' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,abc123',
            detail: 'high',
          },
        ],
      },
    ]);
  });

  it('detects image content in /responses-formatted message arrays', () => {
    expect(
      hasImageContentInMessages([
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'hello' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc123' },
          ],
        },
      ])
    ).toBe(true);
  });

  it('normalizes empty tool arguments to an empty object', () => {
    expect(normalizeToolArguments('get_current_datetime', '', 0)).toEqual({
      argumentsList: ['{}'],
      didChange: true,
    });
  });

  it('sanitizes malformed assistant tool-call arguments before /chat/completions replay', async () => {
    const assistantMessage: Message = {
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 1000,
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          function: {
            name: 'execute_command',
            arguments: '{"command":"python3 create_draft.py"',
          },
        },
      ],
    };

    const toolMessage: Message = {
      id: 'tool-1',
      role: 'tool',
      timestamp: 1000,
      content: [{ type: 'text', text: '{"success":false,"truncated":true}' }],
      tool_call_id: 'tool-1',
      name: 'execute_command',
    };

    const formatted = await formatMessagesForApi([], [assistantMessage, toolMessage], true, '/chat/completions');

    expect(formatted).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-1',
            type: 'function',
            function: {
              name: 'execute_command',
              arguments: '{}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"success":false,"truncated":true}',
        tool_call_id: 'tool-1',
        name: 'execute_command',
      },
    ]);
  });

  it('sanitizes malformed assistant tool-call arguments before /responses replay', async () => {
    const assistantMessage: Message = {
      id: 'assistant-2',
      role: 'assistant',
      timestamp: 1000,
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-2',
          type: 'function',
          function: {
            name: 'get_current_datetime',
            arguments: '',
          },
        },
      ],
    };

    const toolMessage: Message = {
      id: 'tool-2',
      role: 'tool',
      timestamp: 1000,
      content: [{ type: 'text', text: '{"local_datetime":"2026-03-17T18:34:40.171"}' }],
      tool_call_id: 'tool-2',
      name: 'get_current_datetime',
    };

    const formatted = await formatMessagesForApi([], [assistantMessage, toolMessage], true, '/responses');

    expect(formatted).toEqual([
      {
        type: 'function_call',
        call_id: 'tool-2',
        name: 'get_current_datetime',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'tool-2',
        output: '{"local_datetime":"2026-03-17T18:34:40.171"}',
      },
    ]);
  });

  it('removes cross-turn tool-call replays whose tool_result is not immediately adjacent', async () => {
    const orphanAssistantMessage: Message = {
      id: 'assistant-orphan',
      role: 'assistant',
      timestamp: 1000,
      content: [{ type: 'text', text: 'running' }],
      tool_calls: [
        {
          id: 'tool-orphan',
          type: 'function',
          function: {
            name: 'execute_command',
            arguments: '{"command":"long-running"}',
          },
        },
      ],
    };

    const interruptingUserMessage: Message = {
      id: 'user-next',
      role: 'user',
      timestamp: 1000,
      content: [{ type: 'text', text: 'new question' }],
    };

    const lateToolMessage: Message = {
      id: 'tool-orphan_error',
      role: 'tool',
      timestamp: 1000,
      content: [{ type: 'text', text: '{"error":"cancelled"}' }],
      tool_call_id: 'tool-orphan',
      name: 'execute_command',
    };

    const formatted = await formatMessagesForApi(
      [],
      [orphanAssistantMessage, interruptingUserMessage, lateToolMessage],
      true,
      '/chat/completions'
    );

    expect(formatted).toEqual([
      {
        role: 'assistant',
        content: 'running',
      },
      {
        role: 'user',
        content: 'new question',
      },
    ]);
  });

  it('sanitizes a real-world dirty history shape with a late cancelled tool result after newer turns', async () => {
    const completedToolMessage: Message = {
      id: 'tool-setup-ok',
      role: 'tool',
      timestamp: 1000,
      content: [{ type: 'text', text: '{"stdout":"Syntax OK"}' }],
      tool_call_id: 'tool-setup',
      name: 'execute_command',
    };

    const longRunningAssistant: Message = {
      id: 'assistant-long',
      role: 'assistant',
      timestamp: 1000,
      content: [{ type: 'text', text: 'Now let\'s run it.' }],
      tool_calls: [
        {
          id: 'tool-long-run',
          type: 'function',
          function: {
            name: 'execute_command',
            arguments: '{"command":"python3 openclaw_staged_v2.py","timeoutSeconds":900}',
          },
        },
      ],
    };

    const interruptingUser: Message = {
      id: 'user-interrupt',
      role: 'user',
      timestamp: 1000,
      content: [{ type: 'text', text: '为什么会出现这样的搜索？' }],
    };

    const explanatoryAssistant: Message = {
      id: 'assistant-explain',
      role: 'assistant',
      timestamp: 1000,
      content: [{ type: 'text', text: '因为地址栏导航不可靠。' }],
    };

    const fixAssistant: Message = {
      id: 'assistant-fix',
      role: 'assistant',
      timestamp: 1000,
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-write-v3',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: '{"filePath":"/tmp/openclaw_staged_v3.py","content":"print(1)"}',
          },
        },
      ],
    };

    const fixToolMessage: Message = {
      id: 'tool-write-v3-result',
      role: 'tool',
      timestamp: 1000,
      content: [{ type: 'text', text: '{"success":true}' }],
      tool_call_id: 'tool-write-v3',
      name: 'write_file',
    };

    const lateCancelledToolMessage: Message = {
      id: 'tool-long-run-error',
      role: 'tool',
      timestamp: 1000,
      content: [{ type: 'text', text: '{"error":"Tool execution failed: Operation cancelled during tool execution: execute_command"}' }],
      tool_call_id: 'tool-long-run',
      name: 'execute_command',
    };

    const formatted = await formatMessagesForApi(
      [],
      [
        {
          id: 'assistant-setup',
          role: 'assistant',
          timestamp: 1000,
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            {
              id: 'tool-setup',
              type: 'function',
              function: {
                name: 'execute_command',
                arguments: '{"command":"python3 -m py_compile openclaw_staged_v2.py"}',
              },
            },
          ],
        },
        completedToolMessage,
        longRunningAssistant,
        interruptingUser,
        explanatoryAssistant,
        fixAssistant,
        fixToolMessage,
        lateCancelledToolMessage,
      ],
      true,
      '/chat/completions'
    );

    expect(formatted).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-setup',
            type: 'function',
            function: {
              name: 'execute_command',
              arguments: '{"command":"python3 -m py_compile openclaw_staged_v2.py"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"stdout":"Syntax OK"}',
        tool_call_id: 'tool-setup',
        name: 'execute_command',
      },
      {
        role: 'assistant',
        content: 'Now let\'s run it.',
      },
      {
        role: 'user',
        content: '为什么会出现这样的搜索？',
      },
      {
        role: 'assistant',
        content: '因为地址栏导航不可靠。',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-write-v3',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"filePath":"/tmp/openclaw_staged_v3.py","content":"print(1)"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"success":true}',
        tool_call_id: 'tool-write-v3',
        name: 'write_file',
      },
    ]);
  });

  it('keeps only the first contiguous tool_result when history contains duplicate results for one tool_use id', async () => {
    const formatted = await formatMessagesForApi(
      [],
      [
        {
          id: 'assistant-dup',
          role: 'assistant',
          timestamp: 1000,
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            {
              id: 'tool-dup',
              type: 'function',
              function: {
                name: 'execute_command',
                arguments: '{"command":"echo hello"}',
              },
            },
          ],
        },
        {
          id: 'tool-dup-result-1',
          role: 'tool',
          timestamp: 1000,
          content: [{ type: 'text', text: '{"stdout":"hello"}' }],
          tool_call_id: 'tool-dup',
          name: 'execute_command',
        },
        {
          id: 'tool-dup-result-2',
          role: 'tool',
          timestamp: 1000,
          content: [{ type: 'text', text: '{"stdout":"hello again"}' }],
          tool_call_id: 'tool-dup',
          name: 'execute_command',
        },
      ],
      true,
      '/chat/completions'
    );

    expect(formatted).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-dup',
            type: 'function',
            function: {
              name: 'execute_command',
              arguments: '{"command":"echo hello"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"stdout":"hello"}',
        tool_call_id: 'tool-dup',
        name: 'execute_command',
      },
    ]);
  });

  it('keeps only the first contiguous tool_result when duplicate tool messages have no ids', async () => {
    const formatted = await formatMessagesForApi(
      [],
      [
        {
          id: 'assistant-dup-no-id',
          role: 'assistant',
          timestamp: 1000,
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            {
              id: 'tool-dup-no-id',
              type: 'function',
              function: {
                name: 'execute_command',
                arguments: '{"command":"echo hello"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: '{"stdout":"hello"}' }],
          tool_call_id: 'tool-dup-no-id',
          name: 'execute_command',
        } as any,
        {
          role: 'tool',
          content: [{ type: 'text', text: '{"stdout":"hello again"}' }],
          tool_call_id: 'tool-dup-no-id',
          name: 'execute_command',
        } as any,
      ],
      true,
      '/chat/completions'
    );

    expect(formatted).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-dup-no-id',
            type: 'function',
            function: {
              name: 'execute_command',
              arguments: '{"command":"echo hello"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"stdout":"hello"}',
        tool_call_id: 'tool-dup-no-id',
        name: 'execute_command',
      },
    ]);
  });

  it('sanitizes duplicate tool results at final payload stage even if they came from unsanitized system messages', async () => {
    const formatted = await formatMessagesForApi(
      [
        {
          id: 'assistant-system-dup',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            {
              id: 'tool-system-dup',
              type: 'function',
              function: {
                name: 'execute_command',
                arguments: '{"command":"echo hi"}',
              },
            },
          ],
        } as any,
        {
          role: 'tool',
          content: [{ type: 'text', text: '{"stdout":"hi"}' }],
          tool_call_id: 'tool-system-dup',
          name: 'execute_command',
        } as any,
        {
          role: 'tool',
          content: [{ type: 'text', text: '{"stdout":"hi again"}' }],
          tool_call_id: 'tool-system-dup',
          name: 'execute_command',
        } as any,
      ],
      [],
      true,
      '/chat/completions'
    );

    expect(formatted).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-system-dup',
            type: 'function',
            function: {
              name: 'execute_command',
              arguments: '{"command":"echo hi"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"stdout":"hi"}',
        tool_call_id: 'tool-system-dup',
        name: 'execute_command',
      },
    ]);
  });

  it('does not treat empty arguments as truncated for tools without required parameters', () => {
    const toolCalls = [
      {
        id: 'tool-3',
        type: 'function',
        function: {
          name: 'get_current_datetime',
          arguments: '',
        },
      },
    ];

    expect(detectTruncatedToolCalls(toolCalls)).toEqual([]);
  });

  it('detects truncated tool calls for required-argument tools', () => {
    const toolCalls = [
      {
        id: 'tool-4',
        type: 'function',
        function: {
          name: 'execute_command',
          arguments: '{"command":"python create_draft.py"',
        },
      },
      {
        id: 'tool-5',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: '{"filePath":"test.txt"}',
        },
      },
    ];

    expect(detectTruncatedToolCalls(toolCalls)).toEqual(toolCalls);
  });
});

describe('compressContextHistoryWithFullMode', () => {
  it('accepts a shorter fallback result even when the compressor reports failure', async () => {
    const contextHistory: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        timestamp: 1000,
        content: [{ type: 'text', text: 'first' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        timestamp: 1000,
        content: [{ type: 'text', text: 'middle' }],
      },
      {
        id: 'user-2',
        role: 'user',
        timestamp: 1000,
        content: [{ type: 'text', text: 'last' }],
      },
    ];

    const fallbackMessages = [contextHistory[0], contextHistory[2]];
    const compressor = {
      compressMessages: vi.fn().mockResolvedValue({
        success: false,
        compressedMessages: fallbackMessages,
        strategy: 'fallback_preservation',
        metadata: {
          compressionMethod: 'fallback',
        },
      }),
    } as any;

    await expect(
      compressContextHistoryWithFullMode(contextHistory, compressor, 'OpenKosmos')
    ).resolves.toEqual({
      success: true,
      compressedMessages: fallbackMessages,
    });
  });

  it('rejects a shorter failed summary result when the compressor does not mark it as fallback', async () => {
    const contextHistory: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        timestamp: 1000,
        content: [{ type: 'text', text: 'first' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        timestamp: 1000,
        content: [{ type: 'text', text: 'middle' }],
      },
      {
        id: 'user-2',
        role: 'user',
        timestamp: 1000,
        content: [{ type: 'text', text: 'last' }],
      },
    ];

    const shorterMessages = [contextHistory[0], contextHistory[2]];
    const compressor = {
      compressMessages: vi.fn().mockResolvedValue({
        success: false,
        compressedMessages: shorterMessages,
        summary: '',
        strategy: 'intelligent_summary',
        metadata: {
          compressionMethod: 'summary',
        },
      }),
    } as any;

    await expect(
      compressContextHistoryWithFullMode(contextHistory, compressor, 'OpenKosmos')
    ).resolves.toEqual({
      success: false,
      compressedMessages: contextHistory,
    });
  });
});

// Helper to create minimal Message objects for tests
function msg(role: string, opts: { id?: string; tool_calls?: any[]; tool_call_id?: string; name?: string } = {}): Message {
  return deserializeMessage({ role, id: opts.id || `test-${role}`, timestamp: 1000, content: [{ type: 'text', text: '' }], ...opts });
}

function tc(id: string): { id: string; type: 'function'; function: { name: string; arguments: string } } {
  return { id, type: 'function', function: { name: 'test', arguments: '{}' } };
}

describe('isToolMessageOrphaned', () => {
  it('returns false when the last assistant has a matching tool_call', () => {
    const history = [
      msg('user'),
      msg('assistant', { tool_calls: [tc('a'), tc('b')] }),
    ];
    expect(isToolMessageOrphaned('b', history)).toBe(false);
  });

  it('returns true when the last assistant does not have the tool_call_id', () => {
    const history = [
      msg('user'),
      msg('assistant', { tool_calls: [tc('a')] }),
    ];
    expect(isToolMessageOrphaned('x', history)).toBe(true);
  });

  it('returns true when the last assistant has no tool_calls', () => {
    const history = [
      msg('user'),
      msg('assistant'),
    ];
    expect(isToolMessageOrphaned('a', history)).toBe(true);
  });

  it('returns true when a user message is hit before any assistant', () => {
    const history = [
      msg('assistant', { tool_calls: [tc('a')] }),
      msg('tool', { tool_call_id: 'a' }),
      msg('user'),
    ];
    expect(isToolMessageOrphaned('a', history)).toBe(true);
  });

  it('returns true on empty history', () => {
    expect(isToolMessageOrphaned('a', [])).toBe(true);
  });

  it('skips trailing tool messages and finds the assistant', () => {
    const history = [
      msg('user'),
      msg('assistant', { tool_calls: [tc('a'), tc('b')] }),
      msg('tool', { tool_call_id: 'a' }),
    ];
    expect(isToolMessageOrphaned('b', history)).toBe(false);
  });

  it('does not look past the nearest assistant even if an earlier one matches', () => {
    const history = [
      msg('user'),
      msg('assistant', { tool_calls: [tc('old-id')] }),
      msg('tool', { tool_call_id: 'old-id' }),
      msg('assistant', { tool_calls: [tc('new-id')] }),
    ];
    expect(isToolMessageOrphaned('old-id', history)).toBe(true);
  });
});

describe('sanitizeOrphanedToolMessages', () => {
  it('keeps valid assistant→tool sequences', () => {
    const messages = [
      msg('user'),
      msg('assistant', { tool_calls: [tc('a')] }),
      msg('tool', { tool_call_id: 'a' }),
      msg('user'),
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect(result).toHaveLength(4);
    expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
  });

  it('strips tool messages that do not follow their assistant', () => {
    const messages = [
      msg('user'),
      msg('assistant', { tool_calls: [tc('a')] }),
      msg('tool', { tool_call_id: 'a' }),
      msg('user'),
      msg('tool', { tool_call_id: 'a' }), // orphan: after user
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect(result).toHaveLength(4);
    expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
  });

  it('strips tool messages with non-matching tool_call_id', () => {
    const messages = [
      msg('assistant', { tool_calls: [tc('a')] }),
      msg('tool', { tool_call_id: 'a' }),
      msg('tool', { tool_call_id: 'x' }), // no matching tool_call
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect(result).toHaveLength(2);
    expect((result[1] as ToolMessage).tool_call_id).toBe('a');
  });

  it('strips tool messages with no active tracker (at start of array)', () => {
    const messages = [
      msg('tool', { tool_call_id: 'a' }), // no preceding assistant
      msg('user'),
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  it('trims unmatched tool_calls from assistant messages', () => {
    const messages = [
      msg('assistant', { tool_calls: [tc('a'), tc('b'), tc('c')] }),
      msg('tool', { tool_call_id: 'a' }),
      // b and c have no tool results
      msg('user'),
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect((result[0] as AssistantMessage).tool_calls).toHaveLength(1);
    expect((result[0] as AssistantMessage).tool_calls![0].id).toBe('a');
  });

  it('sets tool_calls to undefined when no tool results match at all', () => {
    const messages = [
      msg('assistant', { tool_calls: [tc('a')] }),
      // no tool messages follow
      msg('user'),
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect((result[0] as AssistantMessage).tool_calls).toBeUndefined();
  });

  it('handles multiple assistant→tool rounds correctly', () => {
    const messages = [
      msg('user'),
      msg('assistant', { tool_calls: [tc('a')] }),
      msg('tool', { tool_call_id: 'a' }),
      msg('assistant', { tool_calls: [tc('b'), tc('c')] }),
      msg('tool', { tool_call_id: 'b' }),
      msg('tool', { tool_call_id: 'c' }),
      msg('user'),
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect(result).toHaveLength(7);
    expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'tool', 'user']);
  });

  it('handles messages ending with tool messages (final reset)', () => {
    const messages = [
      msg('assistant', { tool_calls: [tc('a'), tc('b')] }),
      msg('tool', { tool_call_id: 'a' }),
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect(result).toHaveLength(2);
    // b was not matched, so assistant's tool_calls should be trimmed
    expect((result[0] as AssistantMessage).tool_calls).toHaveLength(1);
    expect((result[0] as AssistantMessage).tool_calls![0].id).toBe('a');
  });

  it('returns empty array for empty input', () => {
    expect(sanitizeOrphanedToolMessages([])).toEqual([]);
  });

  it('handles assistant with no tool_calls followed by tool message', () => {
    const messages = [
      msg('assistant'), // no tool_calls
      msg('tool', { tool_call_id: 'a' }), // should be stripped
      msg('user'),
    ];
    const result = sanitizeOrphanedToolMessages(messages);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.role)).toEqual(['assistant', 'user']);
  });
});

describe('getCompressionThreshold', () => {
  it('returns 0.40 for 1M context models (≥ 500K)', () => {
    expect(getCompressionThreshold(1_000_000)).toBe(0.40);
    expect(getCompressionThreshold(500_000)).toBe(0.40);
  });

  it('returns 0.50 for 200K–499K context models', () => {
    expect(getCompressionThreshold(200_000)).toBe(0.50);
    expect(getCompressionThreshold(499_999)).toBe(0.50);
  });

  it('returns 0.70 for small context models (< 200K)', () => {
    expect(getCompressionThreshold(128_000)).toBe(0.70);
    expect(getCompressionThreshold(64_000)).toBe(0.70);
    expect(getCompressionThreshold(199_999)).toBe(0.70);
  });
});

describe('checkCompressionNeeds — adaptive threshold', () => {
  it('triggers at 40% for 1M models', async () => {
    expect(await checkCompressionNeeds([], 1_000_000, 'agent',
      async () => ({ totalTokens: 400_001 }), 0)).toBe(true);
  });

  it('does not trigger below 40% for 1M models', async () => {
    expect(await checkCompressionNeeds([], 1_000_000, 'agent',
      async () => ({ totalTokens: 399_999 }), 0)).toBe(false);
  });

  it('triggers at 50% for 200K models', async () => {
    expect(await checkCompressionNeeds([], 200_000, 'agent',
      async () => ({ totalTokens: 100_001 }), 0)).toBe(true);
  });

  it('does not trigger below 50% for 200K models', async () => {
    expect(await checkCompressionNeeds([], 200_000, 'agent',
      async () => ({ totalTokens: 99_999 }), 0)).toBe(false);
  });

  it('triggers at 70% for 128K models', async () => {
    // 128_000 * 0.70 = 89_600
    expect(await checkCompressionNeeds([], 128_000, 'agent',
      async () => ({ totalTokens: 89_601 }), 0)).toBe(true);
  });

  it('does not trigger below 70% for 128K models', async () => {
    expect(await checkCompressionNeeds([], 128_000, 'agent',
      async () => ({ totalTokens: 89_599 }), 0)).toBe(false);
  });

  it('respects outputTokenReserve in ratio calculation', async () => {
    // 200K model - 8K reserve = 192K effectiveWindow
    // threshold = 0.50 (based on raw 200K contextWindowSize)
    // 192K * 0.50 = 96_000; with 96_001 tokens it should trigger
    expect(await checkCompressionNeeds([], 200_000, 'agent',
      async () => ({ totalTokens: 96_001 }), 8_000)).toBe(true);
  });
});

// ─── tryParseJson ────────────────────────────────────────────────────────────

describe('tryParseJson', () => {
  it('returns ok:true and value for valid JSON', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('returns ok:false for invalid JSON', () => {
    expect(tryParseJson('{invalid}')).toEqual({ ok: false });
  });
});

// ─── stripJsonCodeFence ──────────────────────────────────────────────────────

describe('stripJsonCodeFence', () => {
  it('strips a ```json ... ``` fence', () => {
    expect(stripJsonCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a ``` ... ``` fence without language', () => {
    expect(stripJsonCodeFence('```\n{"b":2}\n```')).toBe('{"b":2}');
  });

  it('returns content unchanged if no fence present', () => {
    expect(stripJsonCodeFence('{"c":3}')).toBe('{"c":3}');
  });
});

// ─── splitConcatenatedJsonObjects ────────────────────────────────────────────

describe('splitConcatenatedJsonObjects', () => {
  it('splits two adjacent JSON objects', () => {
    const result = splitConcatenatedJsonObjects('{"a":1}{"b":2}');
    expect(result).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('returns original string in array when no valid objects found', () => {
    expect(splitConcatenatedJsonObjects('just text')).toEqual(['just text']);
  });

  it('returns empty array for empty input', () => {
    expect(splitConcatenatedJsonObjects('')).toEqual([]);
  });
});

// ─── generateSyntheticToolCallId ─────────────────────────────────────────────

describe('generateSyntheticToolCallId', () => {
  it('uses the original id as base when present', () => {
    const id = generateSyntheticToolCallId({ id: 'call_abc', function: { name: 'tool' } }, 0, 1);
    expect(id).toBe('call_abc_part2');
  });

  it('uses function name + index as base when id is absent', () => {
    const id = generateSyntheticToolCallId({ function: { name: 'my_tool' } }, 2, 0);
    expect(id).toBe('my_tool_2_part1');
  });
});

// ─── isMissingCriticalToolCallFields ─────────────────────────────────────────

describe('isMissingCriticalToolCallFields', () => {
  it('returns false for tools with no required fields', () => {
    expect(isMissingCriticalToolCallFields('get_current_datetime', {})).toBe(false);
  });

  it('returns true when required field is absent', () => {
    expect(isMissingCriticalToolCallFields('write_file', { filePath: '/tmp/f.txt' })).toBe(true);
  });

  it('returns false when all required fields are present', () => {
    expect(isMissingCriticalToolCallFields('write_file', { filePath: '/tmp/f.txt', content: 'data' })).toBe(false);
  });

  it('returns false for non-object parsed value', () => {
    expect(isMissingCriticalToolCallFields('execute_command', null)).toBe(false);
  });
});

// ─── normalizeToolCalls ───────────────────────────────────────────────────────

describe('normalizeToolCalls', () => {
  it('returns undefined when toolCalls is undefined', () => {
    expect(normalizeToolCalls(undefined)).toBeUndefined();
  });

  it('returns empty array unchanged', () => {
    expect(normalizeToolCalls([])).toEqual([]);
  });

  it('normalizes non-string arguments by stringifying them', () => {
    const toolCalls = [
      { id: 'tc1', function: { name: 'exec', arguments: { command: 'ls' } } },
    ];
    const result = normalizeToolCalls(toolCalls as any);
    expect(typeof result![0].function.arguments).toBe('string');
    expect(JSON.parse(result![0].function.arguments)).toEqual({ command: 'ls' });
  });

  it('splits concatenated JSON arguments into multiple tool calls', () => {
    const toolCalls = [
      { id: 'tc1', function: { name: 'exec', arguments: '{"command":"ls"}{"command":"pwd"}' } },
    ];
    const result = normalizeToolCalls(toolCalls as any);
    expect(result!.length).toBe(2);
    expect(JSON.parse(result![0].function.arguments)).toEqual({ command: 'ls' });
    expect(JSON.parse(result![1].function.arguments)).toEqual({ command: 'pwd' });
    // Second call gets a synthetic id
    expect(result![1].id).toContain('part');
  });

  it('passes through tool calls without a function object', () => {
    const toolCalls = [{ id: 'tc1' }];
    const result = normalizeToolCalls(toolCalls as any);
    expect(result).toEqual(toolCalls);
  });

  it('wraps json-in-code-fence arguments', () => {
    const toolCalls = [
      { id: 'tc1', function: { name: 'exec', arguments: '```json\n{"command":"ls"}\n```' } },
    ];
    const result = normalizeToolCalls(toolCalls as any);
    expect(JSON.parse(result![0].function.arguments)).toEqual({ command: 'ls' });
  });
});

// ─── convertMcpToolsToOpenAiFormat ───────────────────────────────────────────

describe('convertMcpToolsToOpenAiFormat', () => {
  it('converts a valid MCP tool to OpenAI format', () => {
    const mcpTools = [
      { name: 'read_file', description: 'Reads a file', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } } } },
    ];
    const result = convertMcpToolsToOpenAiFormat(mcpTools);
    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Reads a file',
          parameters: { type: 'object', properties: { filePath: { type: 'string' } } },
        },
      },
    ]);
  });

  it('sets parameters to undefined when inputSchema is empty', () => {
    const mcpTools = [{ name: 'no_params', description: 'No params', inputSchema: {} }];
    const result = convertMcpToolsToOpenAiFormat(mcpTools);
    expect(result[0].function.parameters).toBeUndefined();
  });

  it('throws GhcApiError for invalid tool names', () => {
    const mcpTools = [{ name: 'invalid tool!', description: 'bad', inputSchema: {} }];
    expect(() => convertMcpToolsToOpenAiFormat(mcpTools)).toThrow('Invalid tool name');
  });

  it('uses fallback description when description is absent', () => {
    const mcpTools = [{ name: 'my_tool', inputSchema: {} }];
    const result = convertMcpToolsToOpenAiFormat(mcpTools);
    expect(result[0].function.description).toBe('Tool: my_tool');
  });
});

// ─── validateToolsRequest ─────────────────────────────────────────────────────

describe('validateToolsRequest', () => {
  it('throws when there are more than 128 tools', () => {
    const tools = Array.from({ length: 129 }, (_, i) => ({ function: { name: `tool_${i}` } }));
    expect(() => validateToolsRequest(tools)).toThrow('Cannot have more than 128 tools');
  });

  it('throws when a tool has no function name', () => {
    expect(() => validateToolsRequest([{ function: {} }] as any)).toThrow('Tool must have a function name');
  });

  it('throws for duplicate tool names', () => {
    const tools = [
      { function: { name: 'tool_a' } },
      { function: { name: 'tool_a' } },
    ];
    expect(() => validateToolsRequest(tools)).toThrow('Duplicate tool name');
  });

  it('throws for invalid tool name characters', () => {
    expect(() => validateToolsRequest([{ function: { name: 'bad name!' } }])).toThrow('Invalid tool name');
  });

  it('does not throw for valid tools', () => {
    expect(() => validateToolsRequest([{ function: { name: 'read_file' } }])).not.toThrow();
  });
});

// ─── determineToolChoice ──────────────────────────────────────────────────────

describe('determineToolChoice', () => {
  it('returns undefined when tools array is empty', () => {
    expect(determineToolChoice([])).toBeUndefined();
  });

  it('returns "auto" by default', () => {
    expect(determineToolChoice([{ function: { name: 'tool_a' } }])).toBe('auto');
  });

  it('returns "none" when toolMode is "none"', () => {
    expect(determineToolChoice([{ function: { name: 'tool_a' } }], 'none')).toBe('none');
  });

  it('returns a function object when toolMode is "required" with a single tool', () => {
    const result = determineToolChoice([{ function: { name: 'tool_a' } }], 'required');
    expect(result).toEqual({ type: 'function', function: { name: 'tool_a' } });
  });

  it('throws when toolMode is "required" with multiple tools', () => {
    expect(() => determineToolChoice(
      [{ function: { name: 'tool_a' } }, { function: { name: 'tool_b' } }],
      'required',
    )).toThrow('ToolMode.Required not supported with multiple tools');
  });
});

// ─── checkCompressionNeeds — edge cases ──────────────────────────────────────

describe('checkCompressionNeeds — edge cases', () => {
  it('returns false when calculateTokensFn throws', async () => {
    expect(await checkCompressionNeeds([], 128_000, 'agent',
      async () => { throw new Error('token count failed'); }, 0)).toBe(false);
  });

  it('falls back to message count when contextWindowSize is 0', async () => {
    const history = Array.from({ length: 16 }, (_, i) => ({
      id: `m${i}`, role: 'user', timestamp: i, content: [{ type: 'text', text: 'x' }],
    })) as any;
    // 16 messages > 15 threshold
    expect(await checkCompressionNeeds(history, 0, 'agent',
      async () => ({ totalTokens: 0 }), 0)).toBe(true);
  });

  it('does not compress with zero context window and 15 or fewer messages', async () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`, role: 'user', timestamp: i, content: [{ type: 'text', text: 'x' }],
    })) as any;
    expect(await checkCompressionNeeds(history, 0, 'agent',
      async () => ({ totalTokens: 0 }), 0)).toBe(false);
  });
});

// ─── formatMessagesForApi — additional coverage ───────────────────────────────

describe('formatMessagesForApi — additional paths', () => {
  it('formats user message with only files (no images) as enhanced text', async () => {
    const userMsg: Message = {
      id: 'u1', role: 'user', timestamp: 1,
      content: [
        { type: 'text', text: 'Analyze this file' },
        {
          type: 'file',
          file: { fileName: 'report.txt', filePath: '/tmp/report.txt', mimeType: 'text/plain' },
          metadata: { fileSize: 1024, lines: 50 },
        } as any,
      ],
    };

    const result = await formatMessagesForApi([], [userMsg], true, '/chat/completions') as any[];
    expect(result[0].role).toBe('user');
    expect(typeof result[0].content).toBe('string');
    expect(result[0].content).toContain('report.txt');
    expect(result[0].content).toContain('Text Files List');
  });

  it('filters out tool messages with no valid tool_call_id', async () => {
    const toolMsg: Message = {
      id: 'tool-orphan', role: 'tool', timestamp: 1,
      content: [{ type: 'text', text: 'result' }],
      tool_call_id: 'nonexistent-id',
    } as any;

    const result = await formatMessagesForApi([], [toolMsg], true, '/chat/completions');
    expect(result).toHaveLength(0);
  });

  it('skips assistant messages with neither content nor tool_calls', async () => {
    const assistantMsg: Message = {
      id: 'a1', role: 'assistant', timestamp: 1,
      content: [{ type: 'text', text: '' }],
    };

    const result = await formatMessagesForApi([], [assistantMsg], true, '/chat/completions');
    expect(result).toHaveLength(0);
  });

  it('skips system messages with no text content', async () => {
    const sysMsg: Message = {
      id: 'sys1', role: 'system', timestamp: 1,
      content: [{ type: 'text', text: '' }],
    };

    const result = await formatMessagesForApi([sysMsg], [], true, '/chat/completions');
    expect(result).toHaveLength(0);
  });
});