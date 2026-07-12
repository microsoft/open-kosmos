import { Message, MessageHelper } from '@shared/types/chatTypes';

import type { SchedulerJob } from '../scheduler/types';

import { createLogger } from '../unifiedLogger';

import type { AgentChat } from './agentChat';
import type { AgentChatRuntimeMode } from './agentChatManagerRegistry';
import { CancellationError, type CancellationTokenSource } from '../cancellation';
import { SCHEDULER_USER_CANCELLED_ERROR } from '@shared/constants/scheduler';

const logger = createLogger();

export interface AgentChatManagerScheduledRunnerDeps {
  createAgentWithChatSession(userAlias: string, chatId: string, chatSessionId: string): Promise<AgentChat>;
  registerManagedInstance(chatSessionId: string, chatId: string, instance: AgentChat, runtimeMode: AgentChatRuntimeMode): void;
  updateChatSessionReadStatus(chatId: string, chatSessionId: string, readStatus: 'read' | 'unread'): Promise<boolean>;
  showChatSessionCompletionNotification(
    chatId: string,
    chatSessionId: string,
    chatSessionName?: string | null,
    outcome?: 'completed' | 'failed',
  ): void;
  disposeManagedInstance(chatSessionId: string, notifyFrontend: boolean): void;
  getRuntimeMode(chatSessionId: string): AgentChatRuntimeMode | null;
  getOrCreateCancellationSource(chatSessionId: string): CancellationTokenSource;
  clearCancellationSource(chatSessionId: string): void;
}

type ScheduledRunReadyPayload = {
  chatSessionId: string;
};

interface ScheduledRunnerRunOptions {
  onReady?: (payload: ScheduledRunReadyPayload) => void;
  isManualTrigger?: boolean;
  preflightError?: string;
}

export class AgentChatManagerScheduledRunner {
  constructor(private readonly deps: AgentChatManagerScheduledRunnerDeps) {}

  async run(
    userAlias: string,
    chatSessionId: string,
    job: SchedulerJob,
    options?: ScheduledRunnerRunOptions,
  ): Promise<{ success: boolean; cancelled?: boolean; chatSessionId?: string; messagesCount?: number; error?: string }> {
    let agentChat: AgentChat | null = null;
    let startedAt: string | null = null;

    try {
      agentChat = await this.deps.createAgentWithChatSession(userAlias, job.chat_id, chatSessionId);
      logger.info('scheduler.runtime.runScheduledJob.chatSession-created', 'run', {
        alias: userAlias,
        jobId: job.id,
        chatId: job.chat_id,
        chatSessionId,
        runtimeMode: 'scheduled-silent',
      });
      agentChat.setEventSender(null);
      agentChat.setSchedulerJobId(job.id);
      this.deps.registerManagedInstance(chatSessionId, job.chat_id, agentChat, 'scheduled-silent');

      // Register a cancellation source so that if the user opens this running
      // scheduled session (which promotes it to an interactive foreground
      // session) and clicks Cancel, cancelChatSession() can find the source and
      // actually interrupt the in-flight stream — matching normal chat behavior.
      const cancellationSource = this.deps.getOrCreateCancellationSource(chatSessionId);

      startedAt = new Date().toISOString();
      agentChat.setSchedulerExecutionState('running', {
        startedAt,
        completedAt: undefined,
        error: undefined,
      });

      const initialSaveResult = await agentChat.saveChatSession();
      if (!initialSaveResult.success) {
        throw new Error(initialSaveResult.error || 'Failed to create scheduled chat session');
      }

      options?.onReady?.({ chatSessionId });

      const message = job.message;

      const userMessage = MessageHelper.createTextMessage(message, 'user');
      if (options?.preflightError) {
        await agentChat.addMessageToSession(userMessage);
        await agentChat.addMessageToSession(
          MessageHelper.createTextMessage(`Scheduled run failed: ${options.preflightError}`, 'assistant'),
        );
        throw new Error(options.preflightError);
      }

      const messages = await agentChat.streamMessage(userMessage, cancellationSource.token, undefined, {
        interactionPolicy: 'forbid',
        triggerSource: options?.isManualTrigger ? 'user' : 'scheduled',
      });

      agentChat.setSchedulerExecutionState('completed', {
        startedAt,
        completedAt: new Date().toISOString(),
        error: undefined,
      });

      const completedSaveResult = await agentChat.saveChatSession();
      if (!completedSaveResult.success) {
        throw new Error(completedSaveResult.error || 'Failed to persist scheduled chat completion state');
      }

      const unreadUpdated = await this.deps.updateChatSessionReadStatus(job.chat_id, chatSessionId, 'unread');
      if (unreadUpdated) {
        this.deps.showChatSessionCompletionNotification(
          job.chat_id,
          chatSessionId,
          agentChat.getCurrentChatSession()?.title,
          'completed',
        );
      }
      this.deps.disposeManagedInstance(chatSessionId, false);

      return {
        success: true,
        chatSessionId,
        messagesCount: messages.length,
      };
    } catch (error) {
      const cancelled = error instanceof CancellationError;
      let cleanupError: Error | null = null;

      try {
        if (agentChat) {
          agentChat.setSchedulerExecutionState('failed', {
            startedAt: startedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            error: cancelled
              ? SCHEDULER_USER_CANCELLED_ERROR
              : error instanceof Error
                ? error.message
                : String(error),
          });

          const failedSaveResult = await agentChat.saveChatSession();
          if (!failedSaveResult.success) {
            throw new Error(failedSaveResult.error || 'Failed to persist scheduled chat failure state');
          }

          // For a user-initiated cancel, skip the unread badge and the "failed"
          // completion notification: the user is actively viewing the session
          // and deliberately stopped it, so neither signal is meaningful.
          if (!cancelled) {
            const unreadUpdated = await this.deps.updateChatSessionReadStatus(job.chat_id, chatSessionId, 'unread');
            if (unreadUpdated) {
              this.deps.showChatSessionCompletionNotification(
                job.chat_id,
                chatSessionId,
                agentChat.getCurrentChatSession()?.title,
                'failed',
              );
            }
          }
        }
      } catch (secondaryError) {
        cleanupError = secondaryError instanceof Error ? secondaryError : new Error(String(secondaryError));
        logger.warn('[AgentChatManager] Scheduled job failure cleanup failed', 'runScheduledJob', {
          chatSessionId,
          error: cleanupError.message,
        });
      }

      if (cancelled) {
        // A user cancel interrupts the in-flight stream via cancelChatSession().
        // How we treat the cached managed instance depends on whether the run
        // was opened:
        //   - If the user opened the running scheduled session it was promoted
        //     to an interactive foreground session; keep the managed instance
        //     alive (like a normal chat) so the user stays in the session after
        //     cancelling.
        //   - If it is still a background `scheduled-silent` run — cancelled from
        //     the Schedules sidepane "..." menu without ever being opened — there
        //     is no foreground session to keep, so dispose it like a normal
        //     completion to avoid leaking a cached instance with no idle timer.
        // Report success either way so the job resolves cleanly without failure
        // backoff, but flag it as cancelled so the scheduler skips the remote
        // "failed" notification.
        const runtimeMode = this.deps.getRuntimeMode(chatSessionId);
        const promotedToInteractive = runtimeMode === 'interactive';

        logger.info('scheduler.runtime.runScheduledJob.cancelled', 'run', {
          jobId: job.id,
          chatId: job.chat_id,
          chatSessionId,
          runtimeMode,
          disposed: !promotedToInteractive,
        });

        if (!promotedToInteractive) {
          this.deps.disposeManagedInstance(chatSessionId, false);
        }

        if (cleanupError) {
          return {
            success: false,
            chatSessionId,
            error: cleanupError.message,
          };
        }

        return {
          success: true,
          cancelled: true,
          chatSessionId,
          messagesCount: 0,
        };
      }

      this.deps.disposeManagedInstance(chatSessionId, false);

      return {
        success: false,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.deps.clearCancellationSource(chatSessionId);
    }
  }
}