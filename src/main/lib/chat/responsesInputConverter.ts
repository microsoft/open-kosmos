/**
 * responsesInputConverter — Convert chat-completions-style messages into the
 * OpenAI `/responses` API `input` items.
 *
 * The `/responses` endpoint has a different wire format from `/chat/completions`:
 * - It does NOT accept an assistant message carrying a `tool_calls` field.
 *   Each tool call must be emitted as a standalone `function_call` item.
 * - It does NOT accept `role: 'tool'` messages. A tool result must be emitted
 *   as a `function_call_output` item.
 * - Tool linkage uses `call_id` (not `id` / `tool_call_id`).
 *
 * Sending `/chat/completions`-shaped messages (assistant.tool_calls + role:'tool')
 * to `/responses` triggers `400 Unknown parameter: 'input[N].tool_calls'`.
 *
 * This module is the single source of truth for that transformation. It is
 * consumed by the sub-agent transport (`SubAgentLLMClient.callLLM`). The main
 * AgentChat transport currently keeps a private copy in `agentChatUtilities.ts`
 * (`convertMessagesToResponseInput`); that copy should be migrated onto this
 * module in a follow-up so the two transports cannot drift again.
 *
 * File location: src/main/lib/chat/responsesInputConverter.ts
 */

import type {
  ResponseInputItem,
  ResponseInputImageContent,
  ResponseInputTextContent,
} from '@shared/types/ghcChatTypes';

/** Text part of a chat-completions multipart `content` array. */
interface ConvertibleTextPart {
  type: 'text';
  text: string;
}

/** Image part of a chat-completions multipart `content` array. */
interface ConvertibleImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' };
}

type ConvertibleMultipartContent = Array<ConvertibleTextPart | ConvertibleImagePart>;

/** Tool call in chat-completions shape (`{ id, function: { name, arguments } }`). */
interface ConvertibleToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments: string };
}

/**
 * Minimal structural contract a message must satisfy to be converted.
 *
 * Intentionally a structural subset so both the main transport's `ApiMessage`
 * and the sub-agent transport's `formatMessageForAPI` output are assignable
 * without coupling this module to either definition.
 */
export interface ResponsesConvertibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ConvertibleMultipartContent;
  tool_calls?: ConvertibleToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * Convert a chat-completions `content` value into the `/responses` content form.
 *
 * - Plain strings pass through unchanged.
 * - Multipart arrays map `text` → `input_text` and `image_url` → `input_image`.
 * - An array that yields no recognized parts falls back to a JSON string so the
 *   data is never silently dropped.
 */
export function convertResponseMessageContent(
  content: string | ConvertibleMultipartContent,
): string | Array<ResponseInputTextContent | ResponseInputImageContent> {
  if (!Array.isArray(content)) {
    return content;
  }

  const convertedContent: Array<ResponseInputTextContent | ResponseInputImageContent> = [];

  for (const part of content) {
    if (part.type === 'text') {
      convertedContent.push({
        type: 'input_text',
        text: part.text,
      });
    } else if (part.type === 'image_url') {
      const detail = part.image_url.detail;
      convertedContent.push({
        type: 'input_image',
        image_url: part.image_url.url,
        detail: detail === 'low' || detail === 'high' ? detail : undefined,
      });
    }
  }

  if (convertedContent.length > 0) {
    return convertedContent;
  }

  return JSON.stringify(content);
}

/**
 * Convert a chat-completions style message array into the `/responses` API
 * `input` item array.
 *
 * Assistant tool calls become standalone `function_call` items and tool results
 * become `function_call_output` items, because `/responses` rejects the
 * `assistant.tool_calls` + `role:'tool'` shapes used by `/chat/completions`.
 */
export function convertMessagesToResponseInput(
  messages: ResponsesConvertibleMessage[],
): ResponseInputItem[] {
  const inputItems: ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      inputItems.push({
        type: 'message',
        role: 'system',
        content: convertResponseMessageContent(msg.content),
      });
    } else if (msg.role === 'user') {
      inputItems.push({
        type: 'message',
        role: 'user',
        content: convertResponseMessageContent(msg.content),
      });
    } else if (msg.role === 'assistant') {
      const item: ResponseInputItem = {
        type: 'message',
        role: 'assistant',
        content: convertResponseMessageContent(msg.content),
      };

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Only keep the assistant message item when it carries real content;
        // an empty assistant turn that only made tool calls is dropped.
        if (item.content) {
          inputItems.push(item);
        }

        for (const toolCall of msg.tool_calls) {
          inputItems.push({
            type: 'function_call',
            call_id: toolCall.id ?? '', // /responses uses call_id instead of id
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          });
        }
      } else {
        inputItems.push(item);
      }
    } else if (msg.role === 'tool') {
      inputItems.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id || '', // /responses uses call_id instead of tool_call_id
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  return inputItems;
}
