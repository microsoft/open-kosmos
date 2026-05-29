import { describe, it, expect } from 'vitest';
import {
  readMessages,
  MAX_MESSAGES_PER_CALL,
  TEXT_LIMIT,
  TOOL_RESULT_LIMIT,
  ARGUMENTS_LIMIT,
} from '../messageReader';
import type { Message, AssistantMessage, ToolMessage, UserMessage, SystemMessage } from '@shared/types/chatTypes';
import type { ChatSessionFile } from '../../../userDataADO/chatSessionFileOps';

function makeUserMsg(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    id: 'u1',
    role: 'user',
    timestamp: 1000,
    content: [{ type: 'text', text: 'hello' }],
    ...overrides,
  };
}

function makeAssistantMsg(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 'a1',
    role: 'assistant',
    timestamp: 2000,
    content: [{ type: 'text', text: 'world' }],
    ...overrides,
  };
}

function makeToolMsg(overrides: Partial<ToolMessage> = {}): ToolMessage {
  return {
    id: 't1',
    role: 'tool',
    timestamp: 3000,
    content: [{ type: 'text', text: 'result' }],
    tool_call_id: 'call-1',
    name: 'some_tool',
    ...overrides,
  };
}

function makeSystemMsg(overrides: Partial<SystemMessage> = {}): SystemMessage {
  return {
    id: 's1',
    role: 'system',
    timestamp: 500,
    content: [{ type: 'text', text: 'system message' }],
    ...overrides,
  };
}

function makeFile(overrides: Partial<ChatSessionFile> = {}): ChatSessionFile {
  return {
    chatSession_id: 'session-1',
    title: 'Test',
    last_updated: '',
    chat_history: [],
    context_history: [],
    interaction_history: [],
    ...overrides,
  } as unknown as ChatSessionFile;
}

describe('readMessages — constants', () => {
  it('exports MAX_MESSAGES_PER_CALL = 10', () => {
    expect(MAX_MESSAGES_PER_CALL).toBe(10);
  });
  it('exports TEXT_LIMIT = 5000', () => {
    expect(TEXT_LIMIT).toBe(5000);
  });
  it('exports TOOL_RESULT_LIMIT = 10000', () => {
    expect(TOOL_RESULT_LIMIT).toBe(10000);
  });
  it('exports ARGUMENTS_LIMIT = 3000', () => {
    expect(ARGUMENTS_LIMIT).toBe(3000);
  });
});

describe('readMessages — view=ui', () => {
  it('returns out_of_range for negative index', () => {
    const file = makeFile({ chat_history: [makeUserMsg()] });
    const [r] = readMessages(file, { view: 'ui', indices: [-1] });
    expect(r.status).toBe('out_of_range');
    expect(r.index).toBe(-1);
  });

  it('returns out_of_range when index >= length', () => {
    const file = makeFile({ chat_history: [makeUserMsg()] });
    const [r] = readMessages(file, { view: 'ui', indices: [1] });
    expect(r.status).toBe('out_of_range');
  });

  it('returns ok with message for valid index', () => {
    const msg = makeUserMsg();
    const file = makeFile({ chat_history: [msg] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    expect(r.message).toBeDefined();
  });

  it('handles undefined chat_history gracefully', () => {
    const file = makeFile({ chat_history: undefined as any });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('out_of_range');
  });

  it('truncates long text in user messages', () => {
    const longText = 'A'.repeat(TEXT_LIMIT + 100);
    const msg = makeUserMsg({ content: [{ type: 'text', text: longText }] });
    const file = makeFile({ chat_history: [msg] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    const content = r.message!.content[0] as any;
    expect(content.text.length).toBeLessThanOrEqual(TEXT_LIMIT);
  });

  it('truncates long text in tool result messages', () => {
    const longText = 'B'.repeat(TOOL_RESULT_LIMIT + 100);
    const msg = makeToolMsg({ content: [{ type: 'text', text: longText }] });
    const file = makeFile({ chat_history: [msg] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    const content = r.message!.content[0] as any;
    expect(content.text.length).toBeLessThanOrEqual(TOOL_RESULT_LIMIT);
  });

  it('truncates long tool_call arguments in assistant messages', () => {
    const longArgs = 'C'.repeat(ARGUMENTS_LIMIT + 100);
    const msg = makeAssistantMsg({
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fn', arguments: longArgs } }],
    });
    const file = makeFile({ chat_history: [msg] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    const tc = (r.message as AssistantMessage).tool_calls![0];
    expect(tc.function.arguments.length).toBeLessThanOrEqual(ARGUMENTS_LIMIT);
  });

  it('replaces image url with placeholder', () => {
    const msg = makeUserMsg({
      content: [
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' },
          metadata: { fileName: 'photo.png', fileSize: 2048, width: 100, height: 100 },
        } as any,
      ],
    });
    const file = makeFile({ chat_history: [msg] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    const imgPart = r.message!.content[0] as any;
    expect(imgPart.image_url.url).toMatch(/\[image:/);
  });

  it('truncates thinking text in assistant messages', () => {
    const longThink = 'D'.repeat(TEXT_LIMIT + 100);
    const msg = makeAssistantMsg({
      content: [{ type: 'thinking', text: longThink, tool_calls: [] }],
    });
    const file = makeFile({ chat_history: [msg] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    const part = r.message!.content[0] as any;
    expect(part.text.length).toBeLessThanOrEqual(TEXT_LIMIT);
  });

  it('truncates thinking nested tool_calls arguments', () => {
    const longArgs = 'E'.repeat(ARGUMENTS_LIMIT + 100);
    const msg = makeAssistantMsg({
      content: [
        {
          type: 'thinking',
          text: 'think',
          tool_calls: [{ id: 'tc2', type: 'function', function: { name: 'fn2', arguments: longArgs } }],
        },
      ],
    });
    const file = makeFile({ chat_history: [msg] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    const part = r.message!.content[0] as any;
    expect(part.tool_calls[0].function.arguments.length).toBeLessThanOrEqual(ARGUMENTS_LIMIT);
  });

  it('handles system message role', () => {
    const msg = makeSystemMsg();
    const file = makeFile({ chat_history: [msg as Message] });
    const [r] = readMessages(file, { view: 'ui', indices: [0] });
    expect(r.status).toBe('ok');
    expect(r.message!.role).toBe('system');
  });

  it('processes multiple indices', () => {
    const msgs = [makeUserMsg({ id: 'u1' }), makeAssistantMsg({ id: 'a1' })];
    const file = makeFile({ chat_history: msgs });
    const results = readMessages(file, { view: 'ui', indices: [0, 1] });
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('ok');
  });
});

describe('readMessages — view=llm', () => {
  it('returns out_of_range when both ui and llm are empty', () => {
    const file = makeFile();
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('out_of_range');
  });

  it('returns ok when llm[idx] matches ui[idx] by id', () => {
    const msg = makeUserMsg({ id: 'match-id' });
    const file = makeFile({ chat_history: [msg], context_history: [msg] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('ok');
  });

  it('returns ok when llm[idx] has no refMsg and idx is in range', () => {
    const llmMsg = makeUserMsg({ id: 'llm-only' });
    const file = makeFile({ chat_history: [], context_history: [llmMsg] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('ok');
  });

  it('falls back to id lookup when direct index does not match', () => {
    const uiMsg = makeUserMsg({ id: 'same-id', timestamp: 100 });
    const llmMsg0 = makeAssistantMsg({ id: 'other-id', timestamp: 200 });
    const llmMsg1 = makeUserMsg({ id: 'same-id', timestamp: 100 });
    const file = makeFile({ chat_history: [uiMsg], context_history: [llmMsg0, llmMsg1] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('ok');
    expect(r.note).toMatch(/resolved via id/);
  });

  it('returns dropped when ui message has id but not found in llm', () => {
    const uiMsg = makeUserMsg({ id: 'missing-id' });
    const llmMsg = makeAssistantMsg({ id: 'other-id' });
    const file = makeFile({ chat_history: [uiMsg], context_history: [llmMsg] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('dropped');
  });

  it('falls back to composite key (timestamp+role+tool_call_id) when no id', () => {
    const uiMsg = makeUserMsg({ id: '', timestamp: 999 } as any);
    // Make id empty string so id-based match is skipped
    (uiMsg as any).id = undefined;
    const llmMsg0 = makeAssistantMsg({ id: undefined as any, timestamp: 888 });
    const llmMsg1: UserMessage = { ...makeUserMsg({ timestamp: 999 }), id: undefined as any };
    const file = makeFile({ chat_history: [uiMsg], context_history: [llmMsg0, llmMsg1] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('ok');
    expect(r.note).toMatch(/resolved via composite/);
  });

  it('returns dropped when no id and composite match fails', () => {
    const uiMsg: UserMessage = { ...makeUserMsg({ timestamp: 111 }), id: undefined as any };
    const llmMsg0: UserMessage = { ...makeUserMsg({ timestamp: 999 }), id: undefined as any };
    const file = makeFile({ chat_history: [uiMsg], context_history: [llmMsg0] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('dropped');
  });

  it('handles tool message tool_call_id in composite matching', () => {
    const uiTool: ToolMessage = { ...makeToolMsg({ timestamp: 500 }), id: undefined as any };
    const llmTool0: ToolMessage = { ...makeToolMsg({ timestamp: 500, tool_call_id: 'other' }), id: undefined as any };
    const llmTool1: ToolMessage = { ...makeToolMsg({ timestamp: 500, tool_call_id: 'call-1' }), id: undefined as any };
    const file = makeFile({ chat_history: [uiTool], context_history: [llmTool0, llmTool1] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('ok');
  });

  it('returns ok directly when llm[idx] matches ui[idx] by timestamp+role (no id)', () => {
    const ts = 12345;
    const uiMsg: UserMessage = { ...makeUserMsg({ timestamp: ts }), id: undefined as any };
    const llmMsg: UserMessage = { ...makeUserMsg({ timestamp: ts }), id: undefined as any };
    const file = makeFile({ chat_history: [uiMsg], context_history: [llmMsg] });
    const [r] = readMessages(file, { view: 'llm', indices: [0] });
    expect(r.status).toBe('ok');
  });
});
