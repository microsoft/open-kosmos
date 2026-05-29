/**
 * llmClient — GHC streaming chat completion client dedicated to the Doctor Agent.
 *
 * Does not reuse the AgentChat stack; calls GHC /chat/completions (SSE) directly and returns the
 * reduced { content, toolCalls, finishReason }. Consumed by agentRunner inside its ReAct loop.
 */

import type { ToolCall } from '@shared/types/chatTypes';
import { GHC_CONFIG } from '../auth/ghcConfig';
import { mainAuthManager } from '../auth/authManager';
import { getEndpointForModel } from '../llm/ghcModelApi';
import { DOCTOR_MODEL } from './agentConfig';

export type { ToolCall };

export type MessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
>;

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: MessageContent }
  | { role: 'assistant'; content?: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
}

export async function callDoctorLlm(messages: ChatMessage[], tools: unknown[]): Promise<LlmResponse> {
  const currentAuth = mainAuthManager.getCurrentAuth();
  if (!currentAuth?.ghcAuth?.copilotTokens?.token) {
    throw new Error('No GitHub Copilot session available. Please sign in.');
  }
  const accessToken = currentAuth.ghcAuth.copilotTokens.token;

  const endpoint = getEndpointForModel(DOCTOR_MODEL);
  const url = `${GHC_CONFIG.API_ENDPOINT}${endpoint}`;

  const requestBody = {
    model: DOCTOR_MODEL,
    messages,
    temperature: 0.3,
    stream: true,
    stream_options: { include_usage: true },
    tools,
    tool_choice: 'auto',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': GHC_CONFIG.USER_AGENT,
      'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
      'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GHC API error ${response.status}: ${errorBody}`);
  }

  return parseSse(response);
}

async function parseSse(response: Response): Promise<LlmResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Failed to get response stream reader');

  let fullContent = '';
  const toolCalls: ToolCall[] = [];
  let finishReason = '';
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) fullContent += delta.content;

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCalls[index].id = tc.id;
              if (tc.function?.name) toolCalls[index].function.name = tc.function.name;
              if (tc.function?.arguments) toolCalls[index].function.arguments += tc.function.arguments;
            }
          }

          if (data.choices[0].finish_reason) {
            finishReason = data.choices[0].finish_reason;
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const validToolCalls = toolCalls.filter((tc) => tc && tc.function && tc.function.name);
  return { content: fullContent, toolCalls: validToolCalls, finishReason };
}
