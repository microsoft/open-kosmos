import { ipcMain } from 'electron';
import type { UserContentPart, UserMessage } from '@shared/types/chatTypes';

import type { Context } from './shared';
import { agentChatManager } from '../../lib/chat/agentChatManager';
import { createLogger } from '../../lib/unifiedLogger';

const logger = createLogger();

type AgentChatInstance = NonNullable<ReturnType<typeof agentChatManager.getInstanceByChatSessionId>>;
type ValidationResult<T> = { success: true; value: T } | { success: false; error: string };
type FieldKind = 'record' | 'string' | 'number';
type FieldRequirement = { path: string[]; kind: FieldKind };

const REQUIRED_CONTENT_FIELDS: Record<UserContentPart['type'], FieldRequirement[]> = {
  text: [{ path: ['text'], kind: 'string' }],
  image: [
    { path: ['image_url'], kind: 'record' },
    { path: ['image_url', 'url'], kind: 'string' },
    { path: ['metadata'], kind: 'record' },
    { path: ['metadata', 'fileName'], kind: 'string' },
    { path: ['metadata', 'fileSize'], kind: 'number' },
    { path: ['metadata', 'mimeType'], kind: 'string' },
  ],
  file: [
    { path: ['file'], kind: 'record' },
    { path: ['file', 'fileName'], kind: 'string' },
    { path: ['file', 'filePath'], kind: 'string' },
    { path: ['file', 'mimeType'], kind: 'string' },
    { path: ['metadata'], kind: 'record' },
    { path: ['metadata', 'fileSize'], kind: 'number' },
  ],
  office: [
    { path: ['file'], kind: 'record' },
    { path: ['file', 'fileName'], kind: 'string' },
    { path: ['file', 'filePath'], kind: 'string' },
    { path: ['file', 'mimeType'], kind: 'string' },
    { path: ['metadata'], kind: 'record' },
    { path: ['metadata', 'fileSize'], kind: 'number' },
  ],
  others: [
    { path: ['file'], kind: 'record' },
    { path: ['file', 'fileName'], kind: 'string' },
    { path: ['file', 'filePath'], kind: 'string' },
    { path: ['file', 'mimeType'], kind: 'string' },
    { path: ['metadata'], kind: 'record' },
    { path: ['metadata', 'fileSize'], kind: 'number' },
  ],
};

/**
 * Guards the idle-consumption pump so a burst of enqueue/update calls for the
 * same session cannot start overlapping drains. The pump is fire-and-forget, so
 * this module-level set is the single source of truth for "a pump is running".
 */
const idleConsumingSessions = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateNonEmptyString(value: unknown, fieldName: string): ValidationResult<string> {
  return isNonEmptyString(value)
    ? { success: true, value }
    : { success: false, error: `Invalid ${fieldName}` };
}

function getPathValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function fieldMatches(value: unknown, kind: FieldKind): boolean {
  if (kind === 'record') return isRecord(value);
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'string';
}

function isValidQueuedContentPart(value: unknown): value is UserContentPart {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  const requirements = REQUIRED_CONTENT_FIELDS[value.type as UserContentPart['type']];
  return !!requirements && requirements.every((requirement) => (
    fieldMatches(getPathValue(value, requirement.path), requirement.kind)
  ));
}

function sanitizeQueuedUserMessage(value: unknown): ValidationResult<UserMessage> {
  if (!isRecord(value)) return { success: false, error: 'Invalid queued user message' };
  if (!isNonEmptyString(value.id)) return { success: false, error: 'Invalid queued user message id' };
  if (value.role !== 'user') return { success: false, error: 'Invalid queued user message role' };
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) {
    return { success: false, error: 'Invalid queued user message timestamp' };
  }
  if (!Array.isArray(value.content) || value.content.length === 0 || !value.content.every(isValidQueuedContentPart)) {
    return { success: false, error: 'Invalid queued user message content' };
  }
  return { success: true, value: { id: value.id, role: 'user', timestamp: value.timestamp, content: value.content } };
}

/**
 * Drains the steering queue while the session stays idle. This closes the
 * busy->idle race where a prompt is enqueued after the active turn's end-of-turn
 * drain already finished (or when nothing was streaming at all): such a message
 * would otherwise sit in the queue with no automatic consumer.
 *
 * The actual consumption is delegated to `agentChatManager.drainQueuedSteeringWhileIdle`,
 * which runs the SAME cancel-safe peek -> hook -> commit-by-id protocol as the
 * end-of-turn drain with the session's cancellation source wired, so a user
 * cancel landing during a queued prompt's hook window wins instead of sending a
 * prompt the user cancelled. The manager drain cascades the whole queue and
 * manages the SENDING_RESPONSE/IDLE status transitions internally.
 *
 * After the drain the guard is released and the queue is re-checked, but ONLY a
 * successful, non-cancelled drain re-pumps: the manager drain awaits unread
 * persistence AFTER the instance drain flips status back to idle, so an enqueue
 * that lands in that window sees idle and schedules a pump the still-held guard
 * would skip. The re-check re-pumps any such stranded message. A cancelled drain
 * (the user cancelled, leaving the peeked prompt queued) or a failed drain (a
 * restored-to-front prompt) is NOT re-pumped — that would undo the cancel or spin
 * forever on a deterministic failure — so those release the bound WebContents and
 * leave the queue for manual action.
 */
async function consumeQueuedMessagesWhileIdle(
  instance: AgentChatInstance,
  chatSessionId: string,
): Promise<void> {
  if (idleConsumingSessions.has(chatSessionId)) {
    return;
  }
  idleConsumingSessions.add(chatSessionId);
  let drainResult: { success: boolean; cancelled?: boolean; data?: unknown[] } | undefined;
  try {
    drainResult = await agentChatManager.drainQueuedSteeringWhileIdle(chatSessionId);
  } finally {
    // Release the guard BEFORE the re-check so the re-pump below can start a
    // fresh drain (its own guard check must pass).
    idleConsumingSessions.delete(chatSessionId);
    if (instance.getChatStatus() === 'idle') {
      // Only re-pump after a fully SUCCESSFUL, NON-CANCELLED drain that actually
      // CONSUMED at least one message. On such a drain the queue is emptied, so a
      // still-pending head can ONLY be a message that was enqueued while the
      // session was already idle but the guard was still held (the manager drain
      // awaits unread persistence AFTER the instance drain flips status back to
      // idle): that enqueue saw idle, bound its WebContents, and scheduled a pump
      // the still-held guard skipped, so without this re-check it would sit in the
      // queue with no consumer. The racing enqueue's sender is still bound, so
      // renderer events (the consumed notification) keep reaching the correct
      // WebContents. Do NOT re-pump after a cancelled drain (that would undo the
      // user's cancel by resending the prompt they cancelled, which the cancel-safe
      // drain deliberately left queued) or a failed drain (that would spin forever
      // on a deterministic hook/persist failure the drain restored to the front) —
      // leave those queued for manual action and release the bound sender,
      // mirroring the end-of-turn cascade's `!result.success || result.cancelled`
      // break. The `consumedSomething` guard is critical: a drain can succeed while
      // consuming NOTHING yet leave `hasPending()` true — e.g. an EXTERNAL-agent
      // session (drainQueuedSteeringWhileIdle returns [] without ever consuming the
      // queue). Re-pumping on `hasPending()` alone would then reschedule the same
      // no-op drain forever (a hot infinite loop). Requiring real progress bounds
      // the re-pump — each one needs the previous drain to have consumed a message
      // — while still catching the busy->idle race above (that drain consumed the
      // queued head, so its result is non-empty).
      const consumedSomething = (drainResult?.data?.length ?? 0) > 0;
      const drainSucceeded = drainResult?.success === true && !drainResult.cancelled;
      if (drainSucceeded && consumedSomething && instance.steeringQueue.hasPending()) {
        scheduleIdleQueueConsumption(instance, chatSessionId);
      } else {
        // Queue fully drained, nothing consumable (a held head or an external
        // agent that never consumes), or the drain was cancelled/failed: release
        // the bound WebContents.
        instance.setEventSender(null);
      }
    }
  }
}

/**
 * Fire-and-forget trigger for the idle pump. Never awaited on the IPC critical
 * path (see CLAUDE.md IPC Handler Discipline): enqueue/update must return
 * `{ success: true }` immediately to unblock the renderer.
 */
function scheduleIdleQueueConsumption(instance: AgentChatInstance, chatSessionId: string): void {
  void consumeQueuedMessagesWhileIdle(instance, chatSessionId).catch((error) => {
    logger.warn(
      `[AgentChatSteering] Idle queue consumption failed for ${chatSessionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

function validateQueuedSteeringSupported(instance: AgentChatInstance): ValidationResult<void> {
  return instance.canUseQueuedSteering()
    ? { success: true, value: undefined }
    : { success: false, error: 'Queued steering is not supported for external agent sessions' };
}

/**
 * IPC handlers for the queued steering message list. Kept in a dedicated module
 * so the queue feature stays self-contained and fully testable instead of
 * growing the large agent-chat.ts handler surface. Every handler resolves the
 * target AgentChat instance by chat session id and delegates to its
 * `steeringQueue` facade.
 */
export default function registerAgentChatSteeringIpc(_ctx: Context) {
  ipcMain.handle('agentChat:enqueueQueuedSteeringMessage', async (event, chatSessionId: unknown, message: unknown) => {
    try {
      const validSessionId = validateNonEmptyString(chatSessionId, 'chatSessionId');
      if (!validSessionId.success) return validSessionId;
      const validMessage = sanitizeQueuedUserMessage(message);
      if (!validMessage.success) return validMessage;
      const instance = agentChatManager.getInstanceByChatSessionId(validSessionId.value);
      if (!instance) {
        return { success: false, error: `No agent instance found for session: ${validSessionId.value}` };
      }
      const supported = validateQueuedSteeringSupported(instance);
      if (!supported.success) return supported;
      instance.steeringQueue.enqueue(validMessage.value);
      // If the session is already idle the enqueue just raced past the active
      // turn's end-of-turn drain, so kick off the idle pump to consume it.
      if (instance.getChatStatus() === 'idle') {
        instance.setEventSender(event.sender);
        scheduleIdleQueueConsumption(instance, validSessionId.value);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agentChat:updateQueuedSteeringMessage', async (event, chatSessionId: unknown, message: unknown) => {
    try {
      const validSessionId = validateNonEmptyString(chatSessionId, 'chatSessionId');
      if (!validSessionId.success) return validSessionId;
      const validMessage = sanitizeQueuedUserMessage(message);
      if (!validMessage.success) return validMessage;
      const instance = agentChatManager.getInstanceByChatSessionId(validSessionId.value);
      if (!instance) {
        return { success: false, error: `No agent instance found for session: ${validSessionId.value}` };
      }
      const supported = validateQueuedSteeringSupported(instance);
      if (!supported.success) return supported;
      // Update-only-if-present: an edit must never re-add a message that was
      // already consumed. If the edit raced the consumption of the same prompt,
      // the id is gone from the queue and this is a silent no-op (the consumed
      // event already dropped the renderer draft) instead of resurrecting the
      // prompt as a duplicate tail entry that would be sent twice.
      const updated = instance.steeringQueue.update(validMessage.value);
      // An edit that lands while the session is idle would otherwise strand the
      // updated draft with no consumer, so pump it the same way as enqueue.
      if (updated && instance.getChatStatus() === 'idle') {
        instance.setEventSender(event.sender);
        scheduleIdleQueueConsumption(instance, validSessionId.value);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agentChat:removeQueuedSteeringMessage', async (event, chatSessionId: unknown, messageId: unknown) => {
    try {
      const validSessionId = validateNonEmptyString(chatSessionId, 'chatSessionId');
      if (!validSessionId.success) return validSessionId;
      const validMessageId = validateNonEmptyString(messageId, 'messageId');
      if (!validMessageId.success) return validMessageId;
      const instance = agentChatManager.getInstanceByChatSessionId(validSessionId.value);
      if (!instance) {
        return { success: false, error: `No agent instance found for session: ${validSessionId.value}` };
      }
      // Was this draft the one being edited (a held head the drain is waiting
      // behind)? Capture it BEFORE the remove clears the hold.
      const removingHeldDraft = instance.steeringQueue.editingMessageId() === validMessageId.value;
      instance.steeringQueue.remove(validMessageId.value);
      // Deleting the draft that was being edited must let the messages queued
      // BEHIND it resume flowing: the drain had stopped at that held head, so with
      // no active turn to re-drive it they would otherwise sit in the queue with no
      // consumer. Pump the same way the edit-release path does. This is gated on
      // `removingHeldDraft` on purpose — an ORDINARY delete (no hold, e.g. trimming
      // the queue after a cancel or while the start-with-queue dialog is open) must
      // NOT auto-send the rest of the queue; only clearing the edit-block resumes
      // consumption. The pump no-ops when the queue is empty or the new head is
      // itself held.
      if (removingHeldDraft && instance.getChatStatus() === 'idle') {
        instance.setEventSender(event.sender);
        scheduleIdleQueueConsumption(instance, validSessionId.value);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agentChat:setQueuedSteeringMessageEditing', async (event, chatSessionId: unknown, messageId: unknown, editing: unknown) => {
    try {
      const validSessionId = validateNonEmptyString(chatSessionId, 'chatSessionId');
      if (!validSessionId.success) return validSessionId;
      const validMessageId = validateNonEmptyString(messageId, 'messageId');
      if (!validMessageId.success) return validMessageId;
      if (typeof editing !== 'boolean') return { success: false, error: 'Invalid editing flag' };
      const instance = agentChatManager.getInstanceByChatSessionId(validSessionId.value);
      if (!instance) {
        return { success: false, error: `No agent instance found for session: ${validSessionId.value}` };
      }
      // Hold (editing=true) makes the draft invisible to the drain so main never
      // consumes a prompt the user is mid-edit; release (editing=false) un-holds it.
      instance.steeringQueue.setEditing(validMessageId.value, editing);
      // Releasing a hold can expose a now-consumable head that the drain skipped
      // while it was held. If the session is already idle there is no active turn's
      // end-of-turn drain to pick it up, so pump it the same way enqueue/update do.
      // Setting a hold (editing=true) must NOT pump — the whole point is to STOP
      // consumption until the edit finishes.
      if (!editing && instance.getChatStatus() === 'idle') {
        instance.setEventSender(event.sender);
        scheduleIdleQueueConsumption(instance, validSessionId.value);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agentChat:steerQueuedSteeringMessage', async (event, chatSessionId: unknown, messageId: unknown) => {
    try {
      const validSessionId = validateNonEmptyString(chatSessionId, 'chatSessionId');
      if (!validSessionId.success) return validSessionId;
      const validMessageId = validateNonEmptyString(messageId, 'messageId');
      if (!validMessageId.success) return validMessageId;
      const instance = agentChatManager.getInstanceByChatSessionId(validSessionId.value);
      if (!instance) {
        return { success: false, error: `No agent instance found for session: ${validSessionId.value}` };
      }
      const supported = validateQueuedSteeringSupported(instance);
      if (!supported.success) return supported;

      // Promote the steered prompt to the FIFO head first, so whichever consumer
      // runs next takes it before the rest of the queue.
      const currentStatus = instance.getChatStatus();
      const promoted = instance.steeringQueue.promote(validMessageId.value);
      if (!promoted) {
        return { success: false, error: `No queued steering message found: ${validMessageId.value}` };
      }

      if (currentStatus !== 'idle') {
        // A turn is running; the promoted head is consumed by that turn's
        // end-of-turn drain. Keeping it in the queue (rather than sending it now)
        // means a user cancel during the drain's hook window still wins. Do NOT
        // touch the event sender here: the active turn owns the sender, and
        // overwriting it would misroute that turn's stream to this caller's
        // WebContents (and we never restore it while busy).
        return { success: true };
      }

      // Idle: schedule the same fire-and-forget pump used by enqueue/update so
      // the IPC handler does not stay open while queued prompts run LLM turns.
      // Only now (when no turn owns the sender) do we bind it so the drain's
      // events reach the steering caller.
      instance.setEventSender(event.sender);
      scheduleIdleQueueConsumption(instance, validSessionId.value);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agentChat:clearQueuedSteeringMessages', async (_event, chatSessionId: unknown) => {
    try {
      const validSessionId = validateNonEmptyString(chatSessionId, 'chatSessionId');
      if (!validSessionId.success) return validSessionId;
      const instance = agentChatManager.getInstanceByChatSessionId(validSessionId.value);
      if (!instance) {
        return { success: false, error: `No agent instance found for session: ${validSessionId.value}` };
      }
      instance.steeringQueue.clear();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
