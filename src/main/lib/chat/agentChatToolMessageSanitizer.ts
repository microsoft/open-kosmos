import { Message, ToolCall } from '@shared/types/chatTypes';

/**
 * Check whether an incoming tool message is orphaned.
 * Walks chatHistory backwards from the end looking for the nearest assistant message:
 * - Found with a matching tool_call_id → not orphaned (false)
 * - Found without a match → orphaned (true)
 * - Hit a user message first (conversation has moved on) → orphaned (true)
 * - Exhausted history without finding any → orphaned (true)
 */
export function isToolMessageOrphaned(toolCallId: string, chatHistory: ReadonlyArray<Message>): boolean {
  for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
    const msg = chatHistory[i];
    if (msg.role === 'user') {
      return true;
    }
    if (msg.role === 'assistant') {
      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length && toolCalls.some((tc) => tc.id === toolCallId)) {
        return false;
      }
      return true;
    }
  }
  return true;
}

/**
 * State-machine sanitizer: walks the message array front-to-back, stripping
 * any tool message that violates the LLM API ordering constraint.
 *
 * A tool message is valid only when it immediately follows its parent assistant
 * message (with only other tool messages in between) and its tool_call_id exists
 * in that assistant's tool_calls. Additionally, assistant messages are trimmed to
 * only retain tool_calls that were actually matched by a contiguous tool result.
 */
export function sanitizeOrphanedToolMessages<T extends Message>(messages: T[]) {
  const sanitized: T[] = [];
  interface Tracker {
    index: number;
    exist: Set<string>;
    matched: Set<string>;
  }

  let tracker: Tracker | undefined;

  function bind(index: number, msg: { tool_calls?: ToolCall[] }) {
    const calls = msg.tool_calls || [];
    const exist = new Set<string>(calls.map(tc => tc.id));
    tracker = { index, exist, matched: new Set<string>() };
  }

  function reset() {
    if (!tracker) return;
    const { index, matched } = tracker;
    const msg = sanitized[index];
    if (msg.role === 'assistant' && msg.tool_calls) {
      const list = msg.tool_calls.filter(tc => matched.has(tc.id));
      sanitized[index] = { ...msg, tool_calls: list.length ? list : undefined };
    }
    tracker = undefined;
  }

  function track(msg: T) {
    if (msg.role === 'assistant') bind(sanitized.length, msg);
    else reset();
    sanitized.push(msg);
  }

  for (const msg of messages) {
    if (tracker) {
      if (msg.role === 'tool') {
        if (msg.tool_call_id && tracker.exist.has(msg.tool_call_id)) {
          tracker.matched.add(msg.tool_call_id);
          sanitized.push(msg);
        }
        continue;
      }

      track(msg);
      continue;
    }

    if (msg.role === 'tool') continue;
    track(msg);
  }

  reset();
  return sanitized;
}
