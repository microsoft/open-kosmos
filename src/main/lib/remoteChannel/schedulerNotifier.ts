import { createLogger } from '../unifiedLogger';
import { chatSessionStore } from '../chat/chatSessionStore';
import { MessageHelper } from '../../../shared/types/chatTypes';
import { APP_NAME } from '../../../shared/constants/branding';
import { getRemoteChannelManager } from '../../startup/lazy';

const logger = createLogger();
const REPLY_PREVIEW_MAX_LEN = 500;

/**
 * Fire-and-forget proactive notification to bound remote channels (e.g. Teams)
 * when a scheduled job finishes. Never throws — failures are logged and swallowed
 * so they cannot affect scheduler control flow.
 */
export function notifyScheduledJobCompletion(params: {
  alias: string;
  jobId: string;
  jobName: string;
  success: boolean;
  chatSessionId?: string;
}): void {
  const { alias, jobId, jobName, success, chatSessionId } = params;
  if (!alias) return;

  const statusLine = success
    ? `✅ **"${jobName}"** completed`
    : `❌ **"${jobName}"** failed`;

  const reply = success ? getLastAssistantText(chatSessionId, REPLY_PREVIEW_MAX_LEN) : '';
  const executedAt = new Date().toLocaleString('en-US');

  const parts: string[] = ['---', '', `🔔 **${APP_NAME} Scheduled Task**`, '', statusLine];
  if (reply) parts.push('', reply);
  parts.push('', `— *Executed at ${executedAt}*`, '', '---');

  getRemoteChannelManager()
    .then((manager) => manager.notifyBoundUser(alias, parts.join('\n')))
    .catch((err) => {
      logger.warn('scheduler.notifyRemote.failed', 'notifyScheduledJobCompletion', {
        jobId,
        success,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Read the final assistant reply from a successfully completed scheduled job.
 * Invariant: when runScheduledJob returns success=true, the last message is an assistant
 * message with non-empty text. A break in this invariant indicates a task anomaly that
 * was incorrectly marked successful — log a warning and skip the body.
 */
function getLastAssistantText(chatSessionId: string | undefined, maxLen: number): string {
  if (!chatSessionId) return '';
  const history = chatSessionStore.getSessionFile(chatSessionId)?.chat_history;
  const last = history?.[history.length - 1];
  const text = last?.role === 'assistant' ? MessageHelper.getText(last).trim() : '';
  if (!text) {
    logger.warn('scheduler.notifyRemote.invariantBroken', 'getLastAssistantText', {
      chatSessionId,
      lastRole: last?.role,
      historyLen: history?.length ?? 0,
    });
    return '';
  }
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
