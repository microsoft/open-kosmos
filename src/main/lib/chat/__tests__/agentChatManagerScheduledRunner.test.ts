vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { AgentChatManagerScheduledRunner } from '../agentChatManagerScheduledRunner';
import { NonInteractiveRuntimeInteractionError } from '../agentChatInteractionPolicy';
import { CancellationError } from '../../cancellation';
import { SCHEDULER_USER_CANCELLED_ERROR } from '@shared/constants/scheduler';

function makeCancellationSource() {
  return {
    token: {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    },
    cancel: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

describe('AgentChatManagerScheduledRunner', () => {
  const job = {
    id: 'job_1',
    chat_id: 'chat_1',
    message: 'scheduled prompt',
  } as any;

  function createRunner(overrides?: {
    streamMessageError?: Error;
    initialSaveResult?: { success: boolean; error?: string };
    completedSaveResult?: { success: boolean; error?: string };
    unreadUpdated?: boolean;
    runtimeMode?: 'interactive' | 'scheduled-silent' | null;
  }) {
    const saveChatSession = vi
      .fn()
      .mockResolvedValueOnce(overrides?.initialSaveResult ?? { success: true })
      .mockResolvedValueOnce(overrides?.completedSaveResult ?? { success: true })
      .mockResolvedValue({ success: true });
    const agentChat = {
      setEventSender: vi.fn(),
      setInteractionPolicy: vi.fn(),
      setSchedulerJobId: vi.fn(),
      setSchedulerExecutionState: vi.fn(),
      saveChatSession,
      addMessageToSession: vi.fn().mockResolvedValue(undefined),
      streamMessage: overrides?.streamMessageError
        ? vi.fn().mockRejectedValue(overrides.streamMessageError)
        : vi.fn().mockResolvedValue([{ id: 'assistant_1' }]),
      getCurrentChatSession: vi.fn(() => ({ title: 'Scheduled Session' })),
    } as any;

    const cancellationSource = makeCancellationSource();
    const deps = {
      createAgentWithChatSession: vi.fn().mockResolvedValue(agentChat),
      registerManagedInstance: vi.fn(),
      updateChatSessionReadStatus: vi.fn().mockResolvedValue(overrides?.unreadUpdated ?? true),
      showChatSessionCompletionNotification: vi.fn(),
      disposeManagedInstance: vi.fn(),
      // Only consulted on the cancellation path. Default to 'interactive' so the
      // common "user opened the running session then cancelled" case keeps the
      // instance alive; override with 'scheduled-silent' to model a background
      // run cancelled from the sidepane without ever being opened.
      getRuntimeMode: vi.fn(() => overrides?.runtimeMode ?? 'interactive'),
      getOrCreateCancellationSource: vi.fn(() => cancellationSource),
      clearCancellationSource: vi.fn(),
    };

    return { runner: new AgentChatManagerScheduledRunner(deps), deps, agentChat, cancellationSource };
  }

  it('runs a scheduled job successfully and notifies completion after unread persistence', async () => {
    const { runner, deps, agentChat, cancellationSource } = createRunner();
    const onReady = vi.fn();

    const result = await runner.run('alias', 'session_1', job, { onReady });

    expect(result).toEqual({
      success: true,
      chatSessionId: 'session_1',
      messagesCount: 1,
    });
    expect(deps.createAgentWithChatSession).toHaveBeenCalledWith('alias', 'chat_1', 'session_1');
    expect(agentChat.setSchedulerJobId).toHaveBeenCalledWith('job_1');
    expect(deps.registerManagedInstance).toHaveBeenCalledWith('session_1', 'chat_1', agentChat, 'scheduled-silent');
    expect(deps.getOrCreateCancellationSource).toHaveBeenCalledWith('session_1');
    expect(onReady).toHaveBeenCalledWith({ chatSessionId: 'session_1' });
    expect(agentChat.streamMessage).toHaveBeenCalledTimes(1);
    expect(agentChat.streamMessage).toHaveBeenCalledWith(expect.anything(), cancellationSource.token, undefined, {
      interactionPolicy: 'forbid',
      triggerSource: 'scheduled',
    });
    expect(onReady.mock.invocationCallOrder[0]).toBeLessThan(agentChat.streamMessage.mock.invocationCallOrder[0]);
    expect(deps.updateChatSessionReadStatus).toHaveBeenCalledWith('chat_1', 'session_1', 'unread');
    expect(deps.showChatSessionCompletionNotification).toHaveBeenCalledWith('chat_1', 'session_1', 'Scheduled Session', 'completed');
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
    expect(deps.clearCancellationSource).toHaveBeenCalledWith('session_1');
  });

  it('passes triggerSource user when isManualTrigger is true', async () => {
    const { runner, agentChat, cancellationSource } = createRunner();

    await runner.run('alias', 'session_1', job, { isManualTrigger: true });

    expect(agentChat.streamMessage).toHaveBeenCalledWith(expect.anything(), cancellationSource.token, undefined, {
      interactionPolicy: 'forbid',
      triggerSource: 'user',
    });
  });

  it('treats a cancel of an opened (interactive) run as interrupted: keeps the session and skips unread/notification/dispose', async () => {
    const { runner, deps, agentChat } = createRunner({
      streamMessageError: new CancellationError('Operation cancelled by user'),
      runtimeMode: 'interactive',
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result).toEqual({
      success: true,
      cancelled: true,
      chatSessionId: 'session_1',
      messagesCount: 0,
    });
    // Session is marked failed with a user-cancelled reason so the sidepane renders "interrupted".
    expect(agentChat.setSchedulerExecutionState).toHaveBeenCalledWith('failed', expect.objectContaining({
      error: SCHEDULER_USER_CANCELLED_ERROR,
    }));
    // A deliberate cancel must not raise an unread badge or a "failed" completion notification
    expect(deps.updateChatSessionReadStatus).not.toHaveBeenCalled();
    expect(deps.showChatSessionCompletionNotification).not.toHaveBeenCalled();
    // The promoted interactive session stays alive (like a normal chat), so it is NOT disposed
    expect(deps.disposeManagedInstance).not.toHaveBeenCalled();
    // The cancellation source is always cleared afterwards
    expect(deps.clearCancellationSource).toHaveBeenCalledWith('session_1');
  });

  it('disposes a cancelled background (scheduled-silent) run that was never opened', async () => {
    const { runner, deps, agentChat } = createRunner({
      streamMessageError: new CancellationError('Operation cancelled by user'),
      runtimeMode: 'scheduled-silent',
    });

    const result = await runner.run('alias', 'session_1', job);

    // Still resolves cleanly as a cancel (no failure backoff, no remote "failed")
    expect(result).toEqual({
      success: true,
      cancelled: true,
      chatSessionId: 'session_1',
      messagesCount: 0,
    });
    expect(agentChat.setSchedulerExecutionState).toHaveBeenCalledWith('failed', expect.objectContaining({
      error: SCHEDULER_USER_CANCELLED_ERROR,
    }));
    // A deliberate cancel must not raise an unread badge or a "failed" completion notification
    expect(deps.updateChatSessionReadStatus).not.toHaveBeenCalled();
    expect(deps.showChatSessionCompletionNotification).not.toHaveBeenCalled();
    // No foreground session to keep — the background instance MUST be disposed so it does not leak
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
    expect(deps.clearCancellationSource).toHaveBeenCalledWith('session_1');
  });

  it('returns failure when cancelled-state persistence fails so the scheduler does not mark the job completed', async () => {
    const { runner, deps, agentChat } = createRunner({
      streamMessageError: new CancellationError('Operation cancelled by user'),
      completedSaveResult: { success: false, error: 'metadata write failed' },
      runtimeMode: 'interactive',
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result).toEqual({
      success: false,
      chatSessionId: 'session_1',
      error: 'metadata write failed',
    });
    expect(agentChat.setSchedulerExecutionState).toHaveBeenCalledWith('failed', expect.objectContaining({
      error: SCHEDULER_USER_CANCELLED_ERROR,
    }));
    expect(deps.updateChatSessionReadStatus).not.toHaveBeenCalled();
    expect(deps.showChatSessionCompletionNotification).not.toHaveBeenCalled();
    expect(deps.disposeManagedInstance).not.toHaveBeenCalled();
    expect(deps.clearCancellationSource).toHaveBeenCalledWith('session_1');
  });

  it('records failure state, persists unread, and notifies failed completion on stream errors', async () => {
    const { runner, deps, agentChat } = createRunner({
      streamMessageError: new Error('boom'),
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result).toEqual({
      success: false,
      chatSessionId: 'session_1',
      error: 'boom',
    });
    expect(agentChat.setSchedulerExecutionState).toHaveBeenCalledWith('failed', expect.objectContaining({
      error: 'boom',
    }));
    expect(deps.updateChatSessionReadStatus).toHaveBeenCalledWith('chat_1', 'session_1', 'unread');
    expect(deps.showChatSessionCompletionNotification).toHaveBeenCalledWith('chat_1', 'session_1', 'Scheduled Session', 'failed');
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
  });

  it('creates a visible failed session without streaming when preflight fails', async () => {
    const { runner, deps, agentChat } = createRunner();

    const result = await runner.run('alias', 'session_1', job, {
      preflightError: 'Required MCP server disconnected: teams',
    });

    expect(result).toEqual({
      success: false,
      chatSessionId: 'session_1',
      error: 'Required MCP server disconnected: teams',
    });
    expect(agentChat.saveChatSession).toHaveBeenCalledTimes(2);
    expect(agentChat.streamMessage).not.toHaveBeenCalled();
    expect(agentChat.addMessageToSession).toHaveBeenCalledTimes(2);
    expect(agentChat.addMessageToSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: 'assistant',
        content: [expect.objectContaining({
          type: 'text',
          text: 'Scheduled run failed: Required MCP server disconnected: teams',
        })],
      }),
    );
    expect(agentChat.setSchedulerExecutionState).toHaveBeenCalledWith('failed', expect.objectContaining({
      error: 'Required MCP server disconnected: teams',
    }));
    expect(deps.updateChatSessionReadStatus).toHaveBeenCalledWith('chat_1', 'session_1', 'unread');
    expect(deps.showChatSessionCompletionNotification).toHaveBeenCalledWith('chat_1', 'session_1', 'Scheduled Session', 'failed');
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
  });

  it('fails fast when a scheduled run requires forbidden interaction', async () => {
    const { runner, deps, agentChat } = createRunner({
      streamMessageError: new NonInteractiveRuntimeInteractionError({
        policy: 'forbid',
        requestType: 'form',
        title: 'Need input',
        message: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
      }),
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result).toEqual({
      success: false,
      chatSessionId: 'session_1',
      error: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
    });
    expect(agentChat.setSchedulerExecutionState).toHaveBeenCalledWith('failed', expect.objectContaining({
      error: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
    }));
    expect(deps.showChatSessionCompletionNotification).toHaveBeenCalledWith('chat_1', 'session_1', 'Scheduled Session', 'failed');
  });

  it('returns failure when initial save fails (before streaming)', async () => {
    const { runner, deps, agentChat } = createRunner({
      initialSaveResult: { success: false, error: 'disk full' },
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('disk full');
    // streamMessage should never have been called
    expect(agentChat.streamMessage).not.toHaveBeenCalled();
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
  });

  it('returns failure when completed save fails (after streaming)', async () => {
    const { runner, deps, agentChat } = createRunner({
      completedSaveResult: { success: false, error: 'write error' },
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('write error');
    expect(agentChat.streamMessage).toHaveBeenCalledTimes(1);
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
  });

  it('swallows secondary error during failure cleanup and still returns primary error', async () => {
    const agentChatWithCleanupError = {
      setEventSender: vi.fn(),
      setSchedulerJobId: vi.fn(),
      setSchedulerExecutionState: vi.fn(),
      saveChatSession: vi.fn()
        .mockResolvedValueOnce({ success: true }) // initial save OK
        .mockRejectedValue(new Error('cleanup save failed')), // failure-path save throws
      streamMessage: vi.fn().mockRejectedValue(new Error('stream error')),
      getCurrentChatSession: vi.fn(() => ({ title: 'Session' })),
    } as any;

    const deps = {
      createAgentWithChatSession: vi.fn().mockResolvedValue(agentChatWithCleanupError),
      registerManagedInstance: vi.fn(),
      updateChatSessionReadStatus: vi.fn().mockResolvedValue(true),
      showChatSessionCompletionNotification: vi.fn(),
      disposeManagedInstance: vi.fn(),
      getRuntimeMode: vi.fn(() => null),
      getOrCreateCancellationSource: vi.fn(() => makeCancellationSource()),
      clearCancellationSource: vi.fn(),
    };

    const runner = new AgentChatManagerScheduledRunner(deps);
    const result = await runner.run('alias', 'session_1', job);

    // Primary error is still returned even though cleanup threw
    expect(result.success).toBe(false);
    expect(result.error).toBe('stream error');
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
  });

  it('skips notification when unread status update returns false', async () => {
    const { runner, deps } = createRunner({ unreadUpdated: false });

    await runner.run('alias', 'session_1', job);

    expect(deps.showChatSessionCompletionNotification).not.toHaveBeenCalled();
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
  });

  it('persists schedulerError to the saved session metadata after a blocked interactive request', async () => {
    const savedSchedulerStates: Array<{
      schedulerExecutionStatus?: 'running' | 'completed' | 'failed';
      schedulerStartedAt?: string;
      schedulerCompletedAt?: string;
      schedulerError?: string;
    }> = [];

    const schedulerExecutionMetadata: {
      schedulerExecutionStatus?: 'running' | 'completed' | 'failed';
      schedulerStartedAt?: string;
      schedulerCompletedAt?: string;
      schedulerError?: string;
    } = {};

    const blockingError = new NonInteractiveRuntimeInteractionError({
      policy: 'forbid',
      requestType: 'form',
      title: 'Need input',
      message: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
    });

    const agentChat = {
      setEventSender: vi.fn(),
      setSchedulerJobId: vi.fn(),
      setSchedulerExecutionState: vi.fn((status, options) => {
        schedulerExecutionMetadata.schedulerExecutionStatus = status;
        if (options?.startedAt !== undefined) {
          schedulerExecutionMetadata.schedulerStartedAt = options.startedAt;
        }
        if (options?.completedAt !== undefined) {
          schedulerExecutionMetadata.schedulerCompletedAt = options.completedAt;
        }
        if (options?.error !== undefined) {
          schedulerExecutionMetadata.schedulerError = options.error;
        }
      }),
      saveChatSession: vi.fn().mockImplementation(async () => {
        savedSchedulerStates.push({ ...schedulerExecutionMetadata });
        return { success: true };
      }),
      streamMessage: vi.fn().mockRejectedValue(blockingError),
      getCurrentChatSession: vi.fn(() => ({ title: 'Scheduled Session' })),
    } as any;

    const deps = {
      createAgentWithChatSession: vi.fn().mockResolvedValue(agentChat),
      registerManagedInstance: vi.fn(),
      updateChatSessionReadStatus: vi.fn().mockResolvedValue(true),
      showChatSessionCompletionNotification: vi.fn(),
      disposeManagedInstance: vi.fn(),
      getRuntimeMode: vi.fn(() => null),
      getOrCreateCancellationSource: vi.fn(() => makeCancellationSource()),
      clearCancellationSource: vi.fn(),
    };

    const runner = new AgentChatManagerScheduledRunner(deps);

    const result = await runner.run('alias', 'session_1', job);

    expect(result).toEqual({
      success: false,
      chatSessionId: 'session_1',
      error: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
    });
    expect(savedSchedulerStates).toHaveLength(2);
    expect(savedSchedulerStates[0]).toEqual(expect.objectContaining({
      schedulerExecutionStatus: 'running',
      schedulerStartedAt: expect.any(String),
    }));
    expect(savedSchedulerStates[1]).toEqual(expect.objectContaining({
      schedulerExecutionStatus: 'failed',
      schedulerStartedAt: expect.any(String),
      schedulerCompletedAt: expect.any(String),
      schedulerError: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
    }));
  });

  it('runs successfully without onReady callback', async () => {
    const { runner } = createRunner();

    const result = await runner.run('alias', 'session_1', job);

    expect(result.success).toBe(true);
  });

  it('uses fallback error message when initialSaveResult.error is empty', async () => {
    const { runner } = createRunner({
      initialSaveResult: { success: false },
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to create scheduled chat session');
  });

  it('uses fallback error message when completedSaveResult.error is empty', async () => {
    const { runner } = createRunner({
      completedSaveResult: { success: false },
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to persist scheduled chat completion state');
  });

  it('handles createAgentWithChatSession failure (agentChat is null in catch)', async () => {
    const deps = {
      createAgentWithChatSession: vi.fn().mockRejectedValue(new Error('create failed')),
      registerManagedInstance: vi.fn(),
      updateChatSessionReadStatus: vi.fn(),
      showChatSessionCompletionNotification: vi.fn(),
      disposeManagedInstance: vi.fn(),
      getRuntimeMode: vi.fn(() => null),
      getOrCreateCancellationSource: vi.fn(() => makeCancellationSource()),
      clearCancellationSource: vi.fn(),
    };
    const runner = new AgentChatManagerScheduledRunner(deps);

    const result = await runner.run('alias', 'session_1', job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('create failed');
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
  });

  it('handles non-Error throw in stream path', async () => {
    const { runner } = createRunner({
      streamMessageError: 'string error' as any,
    });

    const result = await runner.run('alias', 'session_1', job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('string error');
  });

  it('skips failure notification when unread update returns false in error path', async () => {
    const agentChat = {
      setEventSender: vi.fn(),
      setSchedulerJobId: vi.fn(),
      setSchedulerExecutionState: vi.fn(),
      saveChatSession: vi.fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValue({ success: true }),
      streamMessage: vi.fn().mockRejectedValue(new Error('fail')),
      getCurrentChatSession: vi.fn(() => ({ title: 'Session' })),
    } as any;

    const deps = {
      createAgentWithChatSession: vi.fn().mockResolvedValue(agentChat),
      registerManagedInstance: vi.fn(),
      updateChatSessionReadStatus: vi.fn().mockResolvedValue(false),
      showChatSessionCompletionNotification: vi.fn(),
      disposeManagedInstance: vi.fn(),
      getRuntimeMode: vi.fn(() => null),
      getOrCreateCancellationSource: vi.fn(() => makeCancellationSource()),
      clearCancellationSource: vi.fn(),
    };

    const runner = new AgentChatManagerScheduledRunner(deps);
    await runner.run('alias', 'session_1', job);

    expect(deps.showChatSessionCompletionNotification).not.toHaveBeenCalled();
  });
});