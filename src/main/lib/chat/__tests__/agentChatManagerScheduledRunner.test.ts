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

describe('AgentChatManagerScheduledRunner', () => {
  const job = {
    id: 'job_1',
    agentId: 'chat_1',
    message: 'scheduled prompt',
  } as any;

  function createRunner(overrides?: {
    streamMessageError?: Error;
    initialSaveResult?: { success: boolean; error?: string };
    completedSaveResult?: { success: boolean; error?: string };
    unreadUpdated?: boolean;
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
      streamMessage: overrides?.streamMessageError
        ? vi.fn().mockRejectedValue(overrides.streamMessageError)
        : vi.fn().mockResolvedValue([{ id: 'assistant_1' }]),
      getCurrentChatSession: vi.fn(() => ({ title: 'Scheduled Session' })),
    } as any;

    const deps = {
      createAgentWithChatSession: vi.fn().mockResolvedValue(agentChat),
      registerManagedInstance: vi.fn(),
      updateChatSessionReadStatus: vi.fn().mockResolvedValue(overrides?.unreadUpdated ?? true),
      showChatSessionCompletionNotification: vi.fn(),
      disposeManagedInstance: vi.fn(),
    };

    return { runner: new AgentChatManagerScheduledRunner(deps), deps, agentChat };
  }

  it('runs a scheduled job successfully and notifies completion after unread persistence', async () => {
    const { runner, deps, agentChat } = createRunner();
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
    expect(onReady).toHaveBeenCalledWith({ chatSessionId: 'session_1' });
    expect(agentChat.streamMessage).toHaveBeenCalledTimes(1);
    expect(agentChat.streamMessage).toHaveBeenCalledWith(expect.anything(), undefined, undefined, {
      interactionPolicy: 'forbid',
    });
    expect(onReady.mock.invocationCallOrder[0]).toBeLessThan(agentChat.streamMessage.mock.invocationCallOrder[0]);
    expect(deps.updateChatSessionReadStatus).toHaveBeenCalledWith('chat_1', 'session_1', 'unread');
    expect(deps.showChatSessionCompletionNotification).toHaveBeenCalledWith('chat_1', 'session_1', 'Scheduled Session', 'completed');
    expect(deps.disposeManagedInstance).toHaveBeenCalledWith('session_1', false);
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

});