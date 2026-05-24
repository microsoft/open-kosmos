import { Message, MessageHelper } from '@shared/types/chatTypes';

import type { SchedulerJob } from '../scheduler/types';

import { createLogger } from '../unifiedLogger';

import type { AgentChat } from './agentChat';
import type { AgentChatRuntimeMode } from './agentChatManagerRegistry';

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
}

type ScheduledRunReadyPayload = {
  chatSessionId: string;
};

interface ScheduledRunnerRunOptions {
  onReady?: (payload: ScheduledRunReadyPayload) => void;
}

export class AgentChatManagerScheduledRunner {
  constructor(private readonly deps: AgentChatManagerScheduledRunnerDeps) {}

  async run(
    userAlias: string,
    chatSessionId: string,
    job: SchedulerJob,
    options?: ScheduledRunnerRunOptions,
  ): Promise<{ success: boolean; chatSessionId?: string; messagesCount?: number; error?: string }> {
    let agentChat: AgentChat | null = null;
    let startedAt: string | null = null;

    try {
      agentChat = await this.deps.createAgentWithChatSession(userAlias, job.agentId, chatSessionId);
      logger.info('scheduler.runtime.runScheduledJob.chatSession-created', 'run', {
        alias: userAlias,
        jobId: job.id,
        agentId: job.agentId,
        chatId: job.agentId,
        chatSessionId,
        runtimeMode: 'scheduled-silent',
      });
      agentChat.setEventSender(null);
      agentChat.setSchedulerJobId(job.id);
      this.deps.registerManagedInstance(chatSessionId, job.agentId, agentChat, 'scheduled-silent');

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
      const messages = await agentChat.streamMessage(userMessage, undefined, undefined, {
        interactionPolicy: 'forbid',
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

      const unreadUpdated = await this.deps.updateChatSessionReadStatus(job.agentId, chatSessionId, 'unread');
      if (unreadUpdated) {
        this.deps.showChatSessionCompletionNotification(
          job.agentId,
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
      try {
        if (agentChat) {
          agentChat.setSchedulerExecutionState('failed', {
            startedAt: startedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          });

          await agentChat.saveChatSession();
          const unreadUpdated = await this.deps.updateChatSessionReadStatus(job.agentId, chatSessionId, 'unread');
          if (unreadUpdated) {
            this.deps.showChatSessionCompletionNotification(
              job.agentId,
              chatSessionId,
              agentChat.getCurrentChatSession()?.title,
              'failed',
            );
          }
        }
      } catch (secondaryError) {
        logger.warn('[AgentChatManager] Scheduled job failure cleanup failed', 'runScheduledJob', {
          chatSessionId,
          error: secondaryError instanceof Error ? secondaryError.message : String(secondaryError),
        });
      }

      this.deps.disposeManagedInstance(chatSessionId, false);

      return {
        success: false,
        chatSessionId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}