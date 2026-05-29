/**
 * readChatSessionTool — L1: return a session skeleton (markdown).
 *
 * Returns no long content. Once the LLM has the structure, it calls get_chat_messages on demand
 * to read specific indices.
 */

import { mainAuthManager } from '../../auth/authManager';
import { chatSessionStore } from '../../chat/chatSessionStore';
import { formatSkeleton } from '../chatSession/skeletonFormatter';

export const readChatSessionToolDef = {
  type: 'function' as const,
  function: {
    name: 'read_chat_session',
    description: `Return a compact markdown skeleton of the chat session: header KV, plus tables for chat_history, context_history, and interaction_history. All fields are preserved; long content (text, thinking, image base64, tool_call arguments) is replaced by length numbers only. Use this first to understand shape and locate suspicious messages, then call get_chat_messages with specific indices to read them.`,
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The chat (agent) id the session belongs to.',
        },
        chatSessionId: {
          type: 'string',
          description: 'The chat session id to read.',
        },
      },
      required: ['agentId', 'chatSessionId'],
    },
  },
};

export async function executeReadChatSession(args: {
  agentId: string;
  chatSessionId: string;
}): Promise<string> {
  const { agentId, chatSessionId } = args;

  if (!agentId || !chatSessionId) {
    return errorBlock('agentId and chatSessionId are required.');
  }

  const alias = mainAuthManager.getCurrentAuth()?.ghcAuth?.alias;
  if (!alias) {
    return errorBlock('No active user alias.');
  }

  try {
    const aggregate = await chatSessionStore.ensureLoaded(alias, agentId, chatSessionId);
    if (!aggregate) {
      return errorBlock(`Chat session "${chatSessionId}" not found under agent "${agentId}".`);
    }

    const file = chatSessionStore.getSessionFile(chatSessionId);
    if (!file) {
      return errorBlock(`Chat session file "${chatSessionId}" not found.`);
    }

    return formatSkeleton(file);
  } catch (err) {
    return errorBlock(err instanceof Error ? err.message : String(err));
  }
}

function errorBlock(message: string): string {
  return `## Error\n\nread_chat_session failed: ${message}`;
}
