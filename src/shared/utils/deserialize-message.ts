import { AssistantMessage, Message, SystemMessage, ToolMessage, UserContentPart, UserMessage } from '../types/chatTypes';


type RawMessage = Record<string, any>;

function parseId(raw: RawMessage): string {
  return typeof raw.id === 'string' && raw.id
    ? raw.id
    : `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function parseTimestamp(raw: RawMessage): number {
  if (typeof raw.timestamp === 'number') return raw.timestamp;
  if (typeof raw.timestamp === 'string') {
    const parsed = Date.parse(raw.timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

const UserParts = new Set(['text', 'image', 'file', 'office', 'others'] as const);
const AssistantParts = new Set(['text', 'thinking'] as const);

function parseUserMessage(raw: RawMessage): UserMessage {
  const content: any[] = raw.content || [];
  return {
    id: parseId(raw),
    timestamp: parseTimestamp(raw),
    role: 'user',
    content: content.filter(p => UserParts.has(p.type)),
  };
}

function parseAssistantMessage(raw: RawMessage): AssistantMessage {
  const content: any[] = raw.content || [];
  return {
    id: parseId(raw),
    timestamp: parseTimestamp(raw),
    role: 'assistant',
    content: content.filter(p => AssistantParts.has(p.type)),
    tool_calls: raw.tool_calls,
    streamingComplete: raw.streamingComplete,
    usage: raw.usage,
    model: raw.model,
  };
}

// Todo: make sure the `tool_call_id` must exist
function parseToolMessage(raw: RawMessage): ToolMessage {
  const content: any[] = raw.content || [];
  return {
    id: parseId(raw),
    timestamp: parseTimestamp(raw),
    role: 'tool',
    content: content.filter(p => p.type === 'text'),
    tool_call_id: raw.tool_call_id,
    name: raw.name || 'unknown_tool',
    streamingComplete: raw.streamingComplete,
  }
}

function parseSystemMessage(raw: RawMessage): SystemMessage {
  const content: any[] = raw.content || [];
  return {
    id: parseId(raw),
    timestamp: parseTimestamp(raw),
    role: 'system',
    content: content.filter(p => p.type === 'text'),
  };
}


export function deserializeMessage(raw: RawMessage): Message {
  switch (raw.role) {
    case 'user':
      return parseUserMessage(raw);
    case 'assistant':
    case 'thinking':
      return parseAssistantMessage(raw);
    case 'tool':
      return parseToolMessage(raw);
    case 'system':
      return parseSystemMessage(raw);
    default:
      return parseUserMessage(raw); // Default to user message for backward compatibility
  }
}
