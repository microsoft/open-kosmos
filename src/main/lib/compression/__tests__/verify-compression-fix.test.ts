/**
 * Verify that compression never produces messages ending with assistant role.
 * This validates the fix for the assistant-prefill 400 error after context compression.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../llm/contextCompressionLlmSummarizer', async () => {
  const actual = await vi.importActual('../../llm/contextCompressionLlmSummarizer') as any;
  return {
    ...(actual as Record<string, unknown>),
    contextCompressionLlmSummarizer: {
      ...actual.contextCompressionLlmSummarizer,
      summarize: vi.fn().mockResolvedValue({
        success: true,
        summary: '<summary>Test summary of compressed conversation.</summary>',
        attempts: 1,
      }),
      buildPrompt: vi.fn((text: string) => ({
        messages: [{ role: 'user', content: text }],
        estimatedTokens: Math.ceil(text.length / 4),
      })),
    },
  };
});

import { FullModeCompressor } from '../fullModeCompressor';
import type { Message } from '@shared/types/chatTypes';

const FILLER = 'Lorem ipsum dolor sit amet. '.repeat(40);

function msg(role: string, text: string, id?: string): Message {
  return {
    id: id || `msg_${Math.random().toString(36).slice(2, 9)}`,
    role: role as any,
    timestamp: Date.now(),
    content: [{ type: 'text', text }],
  } as Message;
}

function toolCallMsg(round: number): Message {
  return {
    id: `asst_tc_${round}`,
    role: 'assistant',
    timestamp: Date.now(),
    content: [{ type: 'text', text: `Processing round ${round}. ${FILLER}` }],
    tool_calls: [{ id: `tc_${round}`, type: 'function', function: { name: 'search', arguments: '{}' } }],
  } as any;
}

function toolResultMsg(round: number): Message {
  return {
    id: `tool_${round}`,
    role: 'tool',
    timestamp: Date.now(),
    content: [{ type: 'text', text: `Results for round ${round}. ${FILLER}` }],
    tool_call_id: `tc_${round}`,
    name: 'search',
  } as any;
}

describe('Compression prefill fix verification', () => {
  it('compressed result ends with user when original ends with user', async () => {
    const compressor = new FullModeCompressor({ preserveRecentMessages: 2 });
    const messages: Message[] = [msg('user', 'Hello ' + FILLER)];
    for (let i = 0; i < 20; i++) {
      messages.push(toolCallMsg(i));
      messages.push(toolResultMsg(i));
      messages.push(msg('assistant', `Reply ${i}. ${FILLER}`));
    }
    messages.push(msg('user', 'Summarize everything'));

    const result = await compressor.compressMessages(messages);
    const last = result.compressedMessages[result.compressedMessages.length - 1];
    expect(last.role).toBe('user');
  });

  it('fallback compression ends with user when original ends with assistant', async () => {
    // preserveRecentMessages=1, last message is assistant → bridge should be appended
    const compressor = new FullModeCompressor({
      preserveRecentMessages: 1,
      preserveFirstUserMessage: false,
    });
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(msg('user', `Q${i} ${FILLER}`));
      messages.push(msg('assistant', `A${i} ${FILLER}`));
    }

    const result = await compressor.compressMessages(messages);
    const last = result.compressedMessages[result.compressedMessages.length - 1];
    expect(last.role).toBe('user');
  });

  it('fallback compression ends with user when preserving first user + recent assistant', async () => {
    const compressor = new FullModeCompressor({
      preserveRecentMessages: 2,
      preserveFirstUserMessage: true,
    });
    // 20 messages alternating user/assistant, last is assistant
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(msg('user', `Q${i} ${FILLER}`));
      messages.push(msg('assistant', `A${i} ${FILLER}`));
    }

    const result = await compressor.compressMessages(messages);
    const last = result.compressedMessages[result.compressedMessages.length - 1];
    expect(last.role).toBe('user');
  });
});
