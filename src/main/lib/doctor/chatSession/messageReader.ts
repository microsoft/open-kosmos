/**
 * L2 message reader: return raw JSON for several Messages by index, truncating long fields.
 *
 * - view='ui' indexes chat_history directly.
 * - view='llm' indexes context_history first; if the index is out of range or the message at that
 *   position is missing, falls back to id/timestamp lookup in context_history; returns a dropped
 *   signal when all attempts fail.
 */

import type { Message, UnifiedContentPart, ToolCall, UserContentPart, AssistantContentPart, TextContentPart } from '@shared/types/chatTypes';
import type { ChatSessionFile } from '../../userDataADO/chatSessionFileOps';
import { truncateMiddle } from './truncate';
import type { HistoryView } from './types';

export const MAX_MESSAGES_PER_CALL = 10;
export const TEXT_LIMIT = 5000;
export const TOOL_RESULT_LIMIT = 10000;
export const ARGUMENTS_LIMIT = 3000;

export interface ReadMessagesOptions {
  view: HistoryView;
  indices: number[];
}

export interface MessageReadResult {
  index: number;
  view: HistoryView;
  status: 'ok' | 'dropped' | 'out_of_range';
  message?: Message;
  note?: string;
}

export function readMessages(
  file: ChatSessionFile,
  opts: ReadMessagesOptions,
): MessageReadResult[] {
  const { view, indices } = opts;
  const ui = file.chat_history ?? [];
  const llm = file.context_history ?? [];

  return indices.map((idx) => {
    if (view === 'ui') {
      return resolveUi(ui, idx);
    }
    return resolveLlm(ui, llm, idx);
  });
}

function resolveUi(history: Message[], idx: number): MessageReadResult {
  if (idx < 0 || idx >= history.length) {
    return { index: idx, view: 'ui', status: 'out_of_range' };
  }
  return { index: idx, view: 'ui', status: 'ok', message: redactMessage(history[idx]) };
}

function resolveLlm(
  ui: Message[],
  llm: Message[],
  idx: number,
): MessageReadResult {
  const refMsg = idx >= 0 && idx < ui.length ? ui[idx] : undefined;

  if (idx >= 0 && idx < llm.length) {
    const direct = llm[idx];
    if (refMsg && messagesMatch(direct, refMsg)) {
      return { index: idx, view: 'llm', status: 'ok', message: redactMessage(direct) };
    }
    if (!refMsg) {
      return { index: idx, view: 'llm', status: 'ok', message: redactMessage(direct) };
    }
  }

  if (refMsg) {
    const found = findInLlm(llm, refMsg);
    if (found) {
      return {
        index: idx,
        view: 'llm',
        status: 'ok',
        message: redactMessage(found.message),
        note: `resolved via ${found.via} at context_history[${found.idx}]`,
      };
    }
    return {
      index: idx,
      view: 'llm',
      status: 'dropped',
      note: 'message exists in chat_history but not in context_history (likely compressed)',
    };
  }

  return { index: idx, view: 'llm', status: 'out_of_range' };
}

function getToolCallId(msg: Message): string {
  return msg.role === 'tool' ? msg.tool_call_id : '';
}

function findInLlm(
  llm: Message[],
  ref: Message,
): { message: Message; idx: number; via: 'id' | 'composite' } | null {
  if (ref.id) {
    const i = llm.findIndex((m) => m.id && m.id === ref.id);
    if (i >= 0) return { message: llm[i], idx: i, via: 'id' };
    return null;
  }
  if (ref.timestamp !== undefined) {
    const refToolCallId = getToolCallId(ref);
    const i = llm.findIndex(
      (m) =>
        !m.id &&
        m.timestamp === ref.timestamp &&
        m.role === ref.role &&
        getToolCallId(m) === refToolCallId,
    );
    if (i >= 0) return { message: llm[i], idx: i, via: 'composite' };
  }
  return null;
}

function messagesMatch(a: Message, b: Message): boolean {
  if (a.id || b.id) return Boolean(a.id && b.id && a.id === b.id);
  return a.timestamp === b.timestamp && a.role === b.role && getToolCallId(a) === getToolCallId(b);
}

function redactMessage(msg: Message): Message {
  switch (msg.role) {
    case 'assistant':
      return {
        ...msg,
        content: msg.content.map((p) => redactPart(p, false)) as AssistantContentPart[],
        tool_calls: msg.tool_calls?.map(redactToolCall),
      };
    case 'tool':
      return { ...msg, content: msg.content.map((p) => redactPart(p, true)) as TextContentPart[] };
    case 'user':
      return { ...msg, content: msg.content.map((p) => redactPart(p, false)) as UserContentPart[] };
    case 'system':
      return { ...msg, content: msg.content.map((p) => redactPart(p, false)) as TextContentPart[] };
  }
}

function redactPart(part: UnifiedContentPart, isToolResult: boolean): UnifiedContentPart {
  if (!part) return part;
  switch (part.type) {
    case 'text': {
      const limit = isToolResult ? TOOL_RESULT_LIMIT : TEXT_LIMIT;
      return { ...part, text: truncateMiddle(part.text ?? '', limit) };
    }
    case 'thinking':
      return {
        ...part,
        text: truncateMiddle(part.text ?? '', TEXT_LIMIT),
        tool_calls: part.tool_calls?.map(redactToolCall),
      };
    case 'image': {
      const m = part.metadata ?? {};
      const sizeKB = m.fileSize ? `${Math.round(m.fileSize / 1024)}KB` : '?KB';
      const dims = m.width && m.height ? `${m.width}×${m.height}` : '?×?';
      const placeholder = `[image: ${m.fileName ?? 'unnamed'} ${dims} ${sizeKB}]`;
      return { ...part, image_url: { ...(part.image_url ?? {}), url: placeholder } };
    }
    default:
      return part;
  }
}

function redactToolCall(call: ToolCall): ToolCall {
  if (!call?.function) return call;
  const args = call.function.arguments ?? '';
  return {
    ...call,
    function: {
      ...call.function,
      arguments: truncateMiddle(args, ARGUMENTS_LIMIT),
    },
  };
}
