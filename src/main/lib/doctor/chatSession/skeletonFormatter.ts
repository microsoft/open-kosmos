/**
 * L1 skeleton formatter: convert a ChatSessionFile into compact markdown.
 *
 * Output contains a Header and up to 7 tables (one Messages/Parts/ToolCalls trio for each of
 * chat_history and context_history, plus one interaction_history table).
 * All fields are preserved; long content like text/thinking/arguments/base64 urls is shown
 * only as a length number.
 */

import type { Message, UnifiedContentPart, ToolCall } from '@shared/types/chatTypes';
import type { InteractionHistoryEntry } from '@shared/types/interactiveRequestTypes';
import type { ChatSessionFile } from '../../userDataADO/chatSessionFileOps';
import { truncateMiddle } from './truncate';
import type { SkeletonOptions } from './types';

const DEFAULT_INTERACTION_TEXT_LIMIT = 200;
const TITLE_MAX_CHARS = 200;

const MESSAGE_COLS = [
  '#',
  'id',
  'role',
  'content.parts',
  'tool_calls',
  'tool_call_id',
  'name',
  'streamingComplete',
  'timestamp',
  'usage.prompt_tokens',
  'usage.completion_tokens',
  'usage.total_tokens',
  'model',
] as const;

const PART_COLS = [
  'msg#',
  'part#',
  'type',
  'text.len',
  'image.url.detail',
  'image.metadata.fileName',
  'image.metadata.fileSize',
  'image.metadata.width',
  'image.metadata.height',
  'image.metadata.mimeType',
  'image.metadata.storageCompressed',
  'image.metadata.originalSize',
  'image.metadata.compressionRatio',
  'image.metadata.compressionStage',
  'file.fileName',
  'file.filePath',
  'file.mimeType',
  'file.extension',
  'metadata.fileSize',
  'metadata.lines',
  'metadata.pages',
  'metadata.lastModified',
  'metadata.encoding',
  'metadata.detail',
  'metadata.truncated',
  'metadata.fileExtension',
  'metadata.description',
  'thinking.tool_calls',
] as const;

const TOOL_CALL_COLS = [
  'msg#',
  'part#',
  'call#',
  'id',
  'type',
  'function.name',
  'function.arguments.len',
] as const;

const INTERACTION_COLS = [
  '#',
  'interactionId',
  'requestType',
  'title',
  'description',
  'source',
  'resolutionSource',
  'createdAt',
  'resolvedAt',
  'status',
  'summaryText',
] as const;

export function formatSkeleton(file: ChatSessionFile, opts: SkeletonOptions = {}): string {
  if (!file || typeof file !== 'object') {
    return '## Error\n\nformatSkeleton received an invalid session file (not an object).';
  }

  const interactionTextLimit = opts.interactionTextLimit ?? DEFAULT_INTERACTION_TEXT_LIMIT;
  const chatHistory = Array.isArray(file.chat_history) ? file.chat_history : [];
  const contextHistory = Array.isArray(file.context_history) ? file.context_history : [];
  const interactionHistory = Array.isArray(file.interaction_history)
    ? file.interaction_history
    : [];

  const out: string[] = [];

  out.push('## Session');
  out.push(`- chatSession_id: ${file.chatSession_id ?? ''}`);
  out.push(`- title: ${escapeCell(truncateMiddle(file.title ?? '', TITLE_MAX_CHARS))}`);
  out.push(`- last_updated: ${file.last_updated ?? ''}`);
  out.push(`- chat_history.length: ${chatHistory.length}`);
  out.push(`- context_history.length: ${contextHistory.length}`);
  out.push(`- interaction_history.length: ${interactionHistory.length}`);
  out.push('');

  out.push('## chat_history');
  out.push(...formatHistorySection(chatHistory));
  out.push('');

  out.push('## context_history');
  out.push(...formatHistorySection(contextHistory));
  out.push('');

  out.push('## interaction_history');
  out.push(formatInteractionTable(interactionHistory, interactionTextLimit));

  const body = out.join('\n');
  const originalBytes = Buffer.byteLength(JSON.stringify(file), 'utf8');
  const skeletonBytes = Buffer.byteLength(body, 'utf8');
  const ratio = originalBytes > 0 ? ((skeletonBytes / originalBytes) * 100).toFixed(1) : '0.0';

  const banner = [
    '<!--',
    `  Original JSON size: ${originalBytes} bytes (${(originalBytes / 1024).toFixed(1)} KB)`,
    `  Skeleton size:      ${skeletonBytes} bytes (${(skeletonBytes / 1024).toFixed(1)} KB)`,
    `  Compression ratio:  ${ratio}% of original`,
    '-->',
  ].join('\n');

  return [banner, READING_GUIDE, body].join('\n\n');
}

const READING_GUIDE = `## Reading Guide

A skeleton of one chat session JSON. All fields preserved; long content (text, base64 images,
tool-call args) replaced by length numbers. Use this to locate suspicious messages, then call
\`get_chat_messages\` with their indices to read real content.

### Tables
- **messages**: one row per message. Primary table.
- **content parts**: one row per part inside \`message.content[]\`. Joined via \`msg#\`.
- **tool calls**: one row per tool call. Joined via \`msg#\`. \`part#\` empty = top-level
  \`message.tool_calls\`; filled = call nested inside a \`thinking\` part.

### Conventions
- Column names mirror JSON paths (\`usage.prompt_tokens\` = \`message.usage.prompt_tokens\`).
- **content parts** lists the union of fields across all part types; cells not applicable to the
  row's \`type\` are empty. Empty cell = \`undefined\` / \`null\` / not applicable.
- \`*.len\` columns = original length in chars; the body itself is gone. Image base64 \`url\` is
  never shown (metadata is). To read any of these, call \`get_chat_messages\` (≤10 indices/call;
  long fields then truncated head 60% + tail 40%).

### chat_history vs context_history
- \`chat_history\` = what the user saw. \`context_history\` = what the LLM saw on the wire (may be
  compressed, sanitized, summarized). Indices may diverge.
- Divergence is itself a signal — especially for "AI forgot earlier context" bugs.
- \`get_chat_messages\` with \`view='llm'\` returns \`status: 'dropped'\` when a message was removed
  by compression. Worth flagging in the Issue.`;

function formatHistorySection(history: Message[]): string[] {
  return [
    '### messages',
    formatMessagesTable(history),
    '',
    '### content parts',
    formatPartsTable(history),
    '',
    '### tool calls',
    formatToolCallsTable(history),
  ];
}

function formatMessagesTable(history: Message[]): string {
  const rows = history.map((msg, idx) => formatMessageRow(msg, idx));
  return renderTable(MESSAGE_COLS, rows);
}

function formatMessageRow(msg: Message, idx: number): string[] {
  const partsSummary = summarizeParts(msg.content);

  let toolCallsSummary = '';
  let toolCallId = '';
  let name = '';
  let streamingComplete = '';
  let promptTokens = '';
  let completionTokens = '';
  let totalTokens = '';
  let model = '';

  switch (msg.role) {
    case 'assistant':
      toolCallsSummary = summarizeToolCalls(msg.tool_calls);
      streamingComplete = msg.streamingComplete === undefined ? '' : String(msg.streamingComplete);
      promptTokens = msg.usage?.prompt_tokens === undefined ? '' : String(msg.usage.prompt_tokens);
      completionTokens = msg.usage?.completion_tokens === undefined ? '' : String(msg.usage.completion_tokens);
      totalTokens = msg.usage?.total_tokens === undefined ? '' : String(msg.usage.total_tokens);
      model = msg.model ?? '';
      break;
    case 'tool':
      toolCallId = msg.tool_call_id;
      name = msg.name;
      streamingComplete = msg.streamingComplete === undefined ? '' : String(msg.streamingComplete);
      break;
  }

  return [
    String(idx),
    msg.id ?? '',
    msg.role,
    partsSummary,
    toolCallsSummary,
    toolCallId,
    name,
    streamingComplete,
    String(msg.timestamp),
    promptTokens,
    completionTokens,
    totalTokens,
    model,
  ];
}

function summarizeParts(content: UnifiedContentPart[] | undefined): string {
  if (!content || content.length === 0) return '';
  const types = content.map((p) => p?.type ?? '?').join(',');
  return `${content.length}:${types}`;
}

function summarizeToolCalls(calls: ToolCall[] | undefined): string {
  if (!calls || calls.length === 0) return '';
  const names = calls.map((c) => c?.function?.name ?? '?').join(',');
  return `${calls.length}:${names}`;
}

function formatPartsTable(history: Message[]): string {
  const rows: string[][] = [];
  history.forEach((msg, msgIdx) => {
    (msg.content ?? []).forEach((part, partIdx) => {
      rows.push(formatPartRow(part, msgIdx, partIdx));
    });
  });
  return renderTable(PART_COLS, rows);
}

function formatPartRow(part: UnifiedContentPart, msgIdx: number, partIdx: number): string[] {
  const row: Record<(typeof PART_COLS)[number], string> = Object.fromEntries(
    PART_COLS.map((c) => [c, '']),
  ) as Record<(typeof PART_COLS)[number], string>;

  row['msg#'] = String(msgIdx);
  row['part#'] = String(partIdx);
  row['type'] = part?.type ?? '';

  switch (part?.type) {
    case 'text': {
      row['text.len'] = String(part.text?.length ?? 0);
      break;
    }
    case 'thinking': {
      row['text.len'] = String(part.text?.length ?? 0);
      row['thinking.tool_calls'] = String(part.tool_calls?.length ?? 0);
      break;
    }
    case 'image': {
      row['image.url.detail'] = part.image_url?.detail ?? '';
      const m = part.metadata ?? {};
      row['image.metadata.fileName'] = strOrEmpty(m.fileName);
      row['image.metadata.fileSize'] = strOrEmpty(m.fileSize);
      row['image.metadata.width'] = strOrEmpty(m.width);
      row['image.metadata.height'] = strOrEmpty(m.height);
      row['image.metadata.mimeType'] = strOrEmpty(m.mimeType);
      row['image.metadata.storageCompressed'] = strOrEmpty(m.storageCompressed);
      row['image.metadata.originalSize'] = strOrEmpty(m.originalSize);
      row['image.metadata.compressionRatio'] = strOrEmpty(m.compressionRatio);
      row['image.metadata.compressionStage'] = strOrEmpty(m.compressionStage);
      break;
    }
    case 'file':
    case 'office':
    case 'others': {
      row['file.fileName'] = part.file?.fileName ?? '';
      row['file.filePath'] = part.file?.filePath ?? '';
      row['file.mimeType'] = part.file?.mimeType ?? '';
      row['file.extension'] = ('extension' in part.file) ? strOrEmpty(part.file.extension) : '';
      const m = part.metadata;
      row['metadata.fileSize'] = strOrEmpty(m.fileSize);
      row['metadata.lines'] = strOrEmpty('lines' in m ? m.lines : undefined);
      row['metadata.pages'] = strOrEmpty('pages' in m ? m.pages : undefined);
      row['metadata.lastModified'] = strOrEmpty('lastModified' in m ? m.lastModified : undefined);
      row['metadata.encoding'] = strOrEmpty('encoding' in m ? m.encoding : undefined);
      row['metadata.detail'] = strOrEmpty('detail' in m ? m.detail : undefined);
      row['metadata.truncated'] = strOrEmpty('truncated' in m ? m.truncated : undefined);
      row['metadata.fileExtension'] = strOrEmpty('fileExtension' in m ? m.fileExtension : undefined);
      row['metadata.description'] = strOrEmpty('description' in m ? m.description : undefined);
      break;
    }
  }

  return PART_COLS.map((c) => row[c]);
}

function formatToolCallsTable(history: Message[]): string {
  const rows: string[][] = [];
  history.forEach((msg, msgIdx) => {
    if (msg.role === 'assistant') {
      (msg.tool_calls ?? []).forEach((call, callIdx) => {
        rows.push(formatToolCallRow(call, msgIdx, '', callIdx));
      });
    }
    (msg.content ?? []).forEach((part, partIdx) => {
      if (part?.type !== 'thinking') return;
      const calls = part.tool_calls ?? [];
      calls.forEach((call, callIdx) => {
        rows.push(formatToolCallRow(call, msgIdx, String(partIdx), callIdx));
      });
    });
  });
  return renderTable(TOOL_CALL_COLS, rows);
}

function formatToolCallRow(
  call: ToolCall,
  msgIdx: number,
  partIdx: string,
  callIdx: number,
): string[] {
  const rawArgs = call?.function?.arguments;
  const argsStr =
    typeof rawArgs === 'string'
      ? rawArgs
      : rawArgs === undefined || rawArgs === null
        ? ''
        : JSON.stringify(rawArgs);
  return [
    String(msgIdx),
    partIdx,
    String(callIdx),
    call?.id ?? '',
    call?.type ?? '',
    call?.function?.name ?? '',
    String(argsStr.length),
  ];
}

function formatInteractionTable(
  entries: InteractionHistoryEntry[],
  textLimit: number,
): string {
  const rows = entries.map((e, idx) => [
    String(idx),
    e.interactionId ?? '',
    e.requestType ?? '',
    truncateField(e.title, textLimit),
    truncateField(e.description, textLimit),
    e.source ?? '',
    e.resolutionSource ?? '',
    e.createdAt === undefined ? '' : String(e.createdAt),
    e.resolvedAt === undefined ? '' : String(e.resolvedAt),
    e.status ?? '',
    truncateField(e.summaryText, textLimit),
  ]);
  return renderTable(INTERACTION_COLS, rows);
}

function truncateField(text: string | undefined, limit: number): string {
  if (!text) return '';
  return escapeCell(truncateMiddle(text, limit));
}

function strOrEmpty(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTable(cols: readonly string[], rows: string[][]): string {
  const header = `| ${cols.join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  if (rows.length === 0) {
    return [header, sep, `| ${cols.map(() => '').join(' | ')} |`].join('\n');
  }
  const body = rows
    .map((r) => `| ${r.map((c) => escapeCell(c)).join(' | ')} |`)
    .join('\n');
  return [header, sep, body].join('\n');
}
