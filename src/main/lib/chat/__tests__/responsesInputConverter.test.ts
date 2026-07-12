/**
 * responsesInputConverter unit tests
 *
 * Covers every branch of:
 * - convertResponseMessageContent: string passthrough, text part, image part
 *   (detail low/high/other), empty-array JSON fallback.
 * - convertMessagesToResponseInput: system, user, assistant (with content +
 *   tool_calls, empty content + tool_calls, no tool_calls, empty tool_calls
 *   array), tool result (string + non-string content, present + missing
 *   tool_call_id), and tool_call with + without id.
 */

import {
  convertMessagesToResponseInput,
  convertResponseMessageContent,
  type ResponsesConvertibleMessage,
} from '../responsesInputConverter';

describe('convertResponseMessageContent', () => {
  it('returns a plain string unchanged', () => {
    expect(convertResponseMessageContent('hello')).toBe('hello');
  });

  it('maps a text part to input_text', () => {
    const result = convertResponseMessageContent([{ type: 'text', text: 'hi' }]);
    expect(result).toEqual([{ type: 'input_text', text: 'hi' }]);
  });

  it('maps an image part with detail "low" to input_image preserving detail', () => {
    const result = convertResponseMessageContent([
      { type: 'image_url', image_url: { url: 'http://img', detail: 'low' } },
    ]);
    expect(result).toEqual([{ type: 'input_image', image_url: 'http://img', detail: 'low' }]);
  });

  it('preserves detail "high"', () => {
    const result = convertResponseMessageContent([
      { type: 'image_url', image_url: { url: 'http://img', detail: 'high' } },
    ]) as Array<{ detail?: string }>;
    expect(result[0].detail).toBe('high');
  });

  it('drops an unsupported detail value to undefined', () => {
    const result = convertResponseMessageContent([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: 'image_url', image_url: { url: 'http://img', detail: 'auto' as any } },
    ]) as Array<{ detail?: string }>;
    expect(result[0].detail).toBeUndefined();
  });

  it('falls back to a JSON string when the array yields no recognized parts', () => {
    expect(convertResponseMessageContent([])).toBe('[]');
  });

  it('skips unrecognized part types and falls back to a JSON string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = [{ type: 'video_url', video_url: { url: 'http://v' } }] as any;
    expect(convertResponseMessageContent(content)).toBe(JSON.stringify(content));
  });
});

describe('convertMessagesToResponseInput', () => {
  it('converts a system message to a message item', () => {
    const result = convertMessagesToResponseInput([
      { role: 'system', content: 'you are a bot' },
    ]);
    expect(result).toEqual([{ type: 'message', role: 'system', content: 'you are a bot' }]);
  });

  it('converts a user message to a message item', () => {
    const result = convertMessagesToResponseInput([{ role: 'user', content: 'do it' }]);
    expect(result).toEqual([{ type: 'message', role: 'user', content: 'do it' }]);
  });

  it('keeps the assistant message item AND emits function_call when content is present', () => {
    const messages: ResponsesConvertibleMessage[] = [
      {
        role: 'assistant',
        content: 'let me search',
        tool_calls: [{ id: 'c1', function: { name: 'search', arguments: '{"q":"x"}' } }],
      },
    ];
    const result = convertMessagesToResponseInput(messages);
    expect(result).toEqual([
      { type: 'message', role: 'assistant', content: 'let me search' },
      { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{"q":"x"}' },
    ]);
  });

  it('drops the empty assistant message item but keeps the function_call', () => {
    const messages: ResponsesConvertibleMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c2', function: { name: 'get_time', arguments: '{}' } }],
      },
    ];
    const result = convertMessagesToResponseInput(messages);
    expect(result).toEqual([
      { type: 'function_call', call_id: 'c2', name: 'get_time', arguments: '{}' },
    ]);
  });

  it('falls back to empty call_id when a tool_call has no id', () => {
    const messages: ResponsesConvertibleMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'noop', arguments: '{}' } }],
      },
    ];
    const result = convertMessagesToResponseInput(messages);
    expect(result).toEqual([
      { type: 'function_call', call_id: '', name: 'noop', arguments: '{}' },
    ]);
  });

  it('emits a plain assistant message item when there are no tool_calls', () => {
    const result = convertMessagesToResponseInput([
      { role: 'assistant', content: 'final answer' },
    ]);
    expect(result).toEqual([{ type: 'message', role: 'assistant', content: 'final answer' }]);
  });

  it('treats an empty tool_calls array as no tool_calls', () => {
    const result = convertMessagesToResponseInput([
      { role: 'assistant', content: 'answer', tool_calls: [] },
    ]);
    expect(result).toEqual([{ type: 'message', role: 'assistant', content: 'answer' }]);
  });

  it('converts a string tool result to function_call_output', () => {
    const result = convertMessagesToResponseInput([
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1', name: 'search' },
    ]);
    expect(result).toEqual([
      { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
    ]);
  });

  it('JSON-stringifies a non-string tool result and falls back to empty call_id', () => {
    const result = convertMessagesToResponseInput([
      { role: 'tool', content: [{ type: 'text', text: 'raw' }] },
    ]);
    expect(result).toEqual([
      { type: 'function_call_output', call_id: '', output: '[{"type":"text","text":"raw"}]' },
    ]);
  });

  it('produces a tool-call history with no top-level tool_calls field (regression for 400)', () => {
    const messages: ResponsesConvertibleMessage[] = [
      { role: 'user', content: 'research' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', function: { name: 'get_current_datetime', arguments: '{}' } }],
      },
      { role: 'tool', content: '{"local_datetime":"2026-06-23"}', tool_call_id: 'call_1' },
    ];
    const result = convertMessagesToResponseInput(messages);
    // No item may carry a tool_calls field — that is exactly what /responses rejects.
    expect(result.every((item) => !('tool_calls' in item))).toBe(true);
    expect(result.map((i) => i.type)).toEqual(['message', 'function_call', 'function_call_output']);
  });

  it('skips a message whose role is not recognized', () => {
    const result = convertMessagesToResponseInput([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: 'developer' as any, content: 'ignored' },
      { role: 'user', content: 'kept' },
    ]);
    expect(result).toEqual([{ type: 'message', role: 'user', content: 'kept' }]);
  });
});
