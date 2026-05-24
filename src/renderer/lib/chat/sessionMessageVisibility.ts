import type { Message } from '@shared/types/chatTypes';

export function isFrontendOnlySayHiMessage(message: Pick<Message, 'id' | 'role'>): boolean {
  return message.role === 'assistant' && Boolean(message.id?.startsWith('say-hi-'));
}

export function isRealSessionContentMessage(message: Pick<Message, 'id' | 'role'>): boolean {
  return message.role !== 'system' && !isFrontendOnlySayHiMessage(message);
}

export function hasRealSessionContentMessages(messages: Array<Pick<Message, 'id' | 'role'>>): boolean {
  return messages.some(isRealSessionContentMessage);
}
