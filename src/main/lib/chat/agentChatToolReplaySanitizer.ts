import { Message, ToolCall, MessageHelper } from '@shared/types/chatTypes';
import { createLogger } from '../unifiedLogger';
import { sanitizeOrphanedToolMessages } from './agentChatToolMessageSanitizer';

const logger = createLogger();

export function sanitizeFormattedToolReplayMessages(messages: Array<Record<string, any>>): Array<Record<string, any>> {
  if (!messages || messages.length === 0) {
    return messages;
  }

  const retainedToolMessages = new Set<Record<string, any>>();
  const retainedToolCallIds = new Set<string>();
  const sanitizedMessages: Array<Record<string, any>> = [];
  let removedAssistantCount = 0;
  let removedToolCallCount = 0;
  let removedToolMessageCount = 0;
  let removedDuplicateToolMessageCount = 0;
  const droppedAssistantToolCallIds = new Set<string>();
  const droppedToolResultIds = new Set<string>();
  const duplicateToolResultIds = new Set<string>();

  for (let index = 0; index < messages.length; index += 1) {
    const msg = messages[index];

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const contiguousToolResultIds = new Set<string>();
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
        const nextMessage = messages[nextIndex];
        if (nextMessage.role !== 'tool') {
          break;
        }

        if (nextMessage.tool_call_id) {
          if (!contiguousToolResultIds.has(nextMessage.tool_call_id)) {
            contiguousToolResultIds.add(nextMessage.tool_call_id);
            retainedToolMessages.add(nextMessage);
          } else {
            removedDuplicateToolMessageCount += 1;
            duplicateToolResultIds.add(nextMessage.tool_call_id);
          }
        }
      }

      const matchedToolCalls = msg.tool_calls.filter((toolCall: any) => toolCall.id && contiguousToolResultIds.has(toolCall.id));

      if (matchedToolCalls.length > 0) {
        matchedToolCalls.forEach((toolCall: any) => retainedToolCallIds.add(toolCall.id));
        if (matchedToolCalls.length !== msg.tool_calls.length) {
          removedToolCallCount += msg.tool_calls.length - matchedToolCalls.length;
          msg.tool_calls.forEach((toolCall: any) => {
            if (toolCall?.id && !contiguousToolResultIds.has(toolCall.id)) {
              droppedAssistantToolCallIds.add(toolCall.id);
            }
          });
          sanitizedMessages.push({
            ...msg,
            tool_calls: matchedToolCalls,
          });
        } else {
          sanitizedMessages.push(msg);
        }
        continue;
      }

      removedToolCallCount += msg.tool_calls.length;
      msg.tool_calls.forEach((toolCall: any) => {
        if (toolCall?.id) {
          droppedAssistantToolCallIds.add(toolCall.id);
        }
      });
      if (msg.content) {
        sanitizedMessages.push({
          ...msg,
          tool_calls: undefined,
        });
      } else {
        removedAssistantCount += 1;
      }
      continue;
    }

    sanitizedMessages.push(msg);
  }

  const filteredMessages = sanitizedMessages.filter((msg) => {
    if (msg.role !== 'tool') {
      return true;
    }

    const keep = Boolean(msg.tool_call_id && retainedToolCallIds.has(msg.tool_call_id) && retainedToolMessages.has(msg));
    if (!keep) {
      removedToolMessageCount += 1;
      if (msg.tool_call_id) {
        droppedToolResultIds.add(msg.tool_call_id);
      }
    }
    return keep;
  });

  if (removedAssistantCount > 0 || removedToolCallCount > 0 || removedToolMessageCount > 0 || removedDuplicateToolMessageCount > 0) {
    logger.info('[AgentChatUtilities] Sanitized final formatted tool replay payload', 'sanitizeFormattedToolReplayMessages', {
      removedAssistantCount,
      removedToolCallCount,
      removedToolMessageCount,
      removedDuplicateToolMessageCount,
      droppedAssistantToolCallIds: Array.from(droppedAssistantToolCallIds),
      droppedToolResultIds: Array.from(droppedToolResultIds),
      duplicateToolResultIds: Array.from(duplicateToolResultIds),
      originalMessageCount: messages.length,
      sanitizedMessageCount: filteredMessages.length,
    });
  }

  return sanitizeOrphanedToolMessages(filteredMessages as Message[]);
}

export function sanitizeIncompleteToolCallMessages(
  messages: Message[],
  sanitizeToolCallsForApi: (toolCalls: ToolCall[]) => { toolCalls: ToolCall[]; sanitizedCount: number },
): Message[] {
  if (!messages || messages.length === 0) {
    return messages;
  }

  const retainedToolCallIds = new Set<string>();
  const retainedToolMessages = new Set<Message>();
  let removedToolCallCount = 0;
  let removedAssistantCount = 0;
  let sanitizedToolArgumentCount = 0;
  let removedDuplicateToolMessageCount = 0;
  const droppedAssistantToolCallIds = new Set<string>();
  const droppedToolResultIds = new Set<string>();
  const duplicateToolResultIds = new Set<string>();

  const sanitizedMessages: Message[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const msg = messages[index];

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const contiguousToolResultIds = new Set<string>();
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
        const nextMessage = messages[nextIndex];
        if (nextMessage.role !== 'tool') {
          break;
        }

        if (nextMessage.tool_call_id) {
          if (!contiguousToolResultIds.has(nextMessage.tool_call_id)) {
            contiguousToolResultIds.add(nextMessage.tool_call_id);
            retainedToolMessages.add(nextMessage);
          } else {
            removedDuplicateToolMessageCount += 1;
            duplicateToolResultIds.add(nextMessage.tool_call_id);
          }
        }
      }

      const matchedToolCalls = msg.tool_calls.filter((toolCall) => toolCall.id && contiguousToolResultIds.has(toolCall.id));

      if (matchedToolCalls.length > 0) {
        const { toolCalls: sanitizedToolCalls, sanitizedCount } = sanitizeToolCallsForApi(matchedToolCalls);
        sanitizedToolArgumentCount += sanitizedCount;

        sanitizedToolCalls.forEach((toolCall) => retainedToolCallIds.add(toolCall.id));

        if (matchedToolCalls.length !== msg.tool_calls.length) {
          removedToolCallCount += msg.tool_calls.length - matchedToolCalls.length;
          msg.tool_calls.forEach((toolCall) => {
            if (toolCall?.id && !contiguousToolResultIds.has(toolCall.id)) {
              droppedAssistantToolCallIds.add(toolCall.id);
            }
          });
          sanitizedMessages.push({
            ...msg,
            tool_calls: sanitizedToolCalls,
          });
        } else if (sanitizedCount > 0) {
          sanitizedMessages.push({
            ...msg,
            tool_calls: sanitizedToolCalls,
          });
        } else {
          sanitizedMessages.push(msg);
        }
        continue;
      }

      removedToolCallCount += msg.tool_calls.length;
      msg.tool_calls.forEach((toolCall) => {
        if (toolCall?.id) {
          droppedAssistantToolCallIds.add(toolCall.id);
        }
      });

      const hasContent = Boolean(MessageHelper.getText(msg).trim()) || msg.content.some((part) => part.type !== 'text');
      if (hasContent) {
        sanitizedMessages.push({
          ...msg,
          tool_calls: undefined,
        });
      } else {
        removedAssistantCount += 1;
      }
      continue;
    }

    sanitizedMessages.push(msg);
  }

  let removedToolMessageCount = 0;
  const filteredMessages = sanitizedMessages.filter((msg) => {
    if (msg.role !== 'tool') {
      return true;
    }

    const keep = Boolean(
      msg.tool_call_id
      && retainedToolCallIds.has(msg.tool_call_id)
      && retainedToolMessages.has(msg)
    );
    if (!keep) {
      removedToolMessageCount += 1;
      if (msg.tool_call_id) {
        droppedToolResultIds.add(msg.tool_call_id);
      }
    }
    return keep;
  });

  if (
    removedToolCallCount > 0
    || removedAssistantCount > 0
    || removedToolMessageCount > 0
    || removedDuplicateToolMessageCount > 0
    || sanitizedToolArgumentCount > 0
  ) {
    logger.info('[AgentChatUtilities] Sanitized incomplete tool-call history before API formatting', 'sanitizeIncompleteToolCallMessages', {
      removedToolCallCount,
      removedAssistantCount,
      removedToolMessageCount,
      removedDuplicateToolMessageCount,
      droppedAssistantToolCallIds: Array.from(droppedAssistantToolCallIds),
      droppedToolResultIds: Array.from(droppedToolResultIds),
      duplicateToolResultIds: Array.from(duplicateToolResultIds),
      sanitizedToolArgumentCount,
      originalMessageCount: messages.length,
      sanitizedMessageCount: filteredMessages.length,
    });
  }

  return filteredMessages;
}