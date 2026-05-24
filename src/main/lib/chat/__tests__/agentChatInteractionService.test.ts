import type { ApprovalInteractionRequest, InteractiveResponse } from '@shared/types/interactiveRequestTypes';

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../interactiveRequestManager', async () => ({
  interactiveRequestManager: {
    createPendingRequest: vi.fn(),
    clearSession: vi.fn(),
  },
}));

import { AgentChatInteractionService } from '../agentChatInteractionService';
import { NonInteractiveRuntimeInteractionError } from '../agentChatInteractionPolicy';
import { interactiveRequestManager } from '../interactiveRequestManager';

function createService(overrides?: { interactionPolicy?: 'allow-ui' | 'plain-text-only' | 'forbid' }) {
  const currentChatSession = {
    interaction_history: [] as any[],
  } as any;
  const reportBlockedInteraction = vi.fn();

  return {
    currentChatSession,
    reportBlockedInteraction,
    service: new AgentChatInteractionService({
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getAgentName: () => 'OpenKosmos',
      getEventSender: () => null,
      getCurrentChatSession: () => currentChatSession,
      saveChatSession: vi.fn().mockResolvedValue({ success: true }),
      safeEmitEvent: vi.fn(),
      getPendingInteractiveRequest: vi.fn(() => null),
      setPendingInteractiveRequest: vi.fn(),
      getInteractionPolicy: () => overrides?.interactionPolicy || 'allow-ui',
      reportBlockedInteraction,
    }),
  };
}

describe('AgentChatInteractionService', () => {
  it('builds approval summaries with mixed outcomes', () => {
    const { service } = createService();
    const request: ApprovalInteractionRequest = {
      interactionId: 'approval_1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      description: 'Review',
      createdAt: Date.now(),
      source: 'tool',
      items: [
        { itemId: '1', toolName: 'tool-a', message: 'a', paths: [{ path: '/a' }] },
        { itemId: '2', toolName: 'tool-b', message: 'b', paths: [{ path: '/b' }] },
      ],
    };
    const response: InteractiveResponse = {
      interactionId: 'approval_1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      action: 'submit',
      approvalItemDecisions: [
        { itemId: '1', approved: true },
        { itemId: '2', approved: false },
      ],
    };

    expect(service.buildInteractionSummary(request, response)).toBe('Approved 1 and rejected 1 tool requests.');
  });

  it('finalizes an interaction by appending history and emitting the processed event', async () => {
    const { service, currentChatSession } = createService();
    const request: ApprovalInteractionRequest = {
      interactionId: 'approval_2',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      description: 'Review',
      createdAt: Date.now(),
      source: 'tool',
      items: [{ itemId: '1', toolName: 'tool-a', message: 'a', paths: [{ path: '/a' }] }],
    };
    const response: InteractiveResponse = {
      interactionId: 'approval_2',
      chatSessionId: 'session-1',
      requestType: 'approval',
      action: 'reject',
      approvalItemDecisions: [{ itemId: '1', approved: false }],
    };

    await service.finalizeInteractiveRequest(request, response);

    expect(currentChatSession.interaction_history).toHaveLength(1);
    expect(currentChatSession.interaction_history[0]).toEqual(
      expect.objectContaining({
        interactionId: 'approval_2',
        status: 'rejected',
        summaryText: 'Rejected 1 tool request.',
      }),
    );
  });

  it('throws when interactive requests are forbidden by runtime policy', async () => {
    const { service, reportBlockedInteraction } = createService({ interactionPolicy: 'forbid' });

    await expect(service.requestUserInfoInput({
      header: { title: 'Need input' },
      body: { description: 'Need input' },
      fields: [],
    })).rejects.toBeInstanceOf(NonInteractiveRuntimeInteractionError);

    expect(reportBlockedInteraction).toHaveBeenCalledWith(expect.objectContaining({
      policy: 'forbid',
      requestType: 'form',
      title: 'Need input',
    }));
  });

  it('marks no-event-sender fallback responses as system fallback instead of user input', async () => {
    const { service, currentChatSession } = createService();
    const request = {
      interactionId: 'choice_1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      status: 'pending',
      title: 'Choose one',
      createdAt: Date.now(),
      mode: 'single',
      options: [{ value: 'a', label: 'A' }],
    } as any;

    const response = await service.requestUserInteraction(request, {
      interactionId: 'choice_1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'skip',
    });

    expect(response).toEqual(expect.objectContaining({
      action: 'skip',
      resolutionSource: 'system-fallback',
    }));
    expect(currentChatSession.interaction_history[0]).toEqual(expect.objectContaining({
      resolutionSource: 'system-fallback',
      status: 'skipped',
      summaryText: 'The selection request could not be delivered to an active UI receiver, so the system returned a fallback result.',
    }));
  });

  it('preserves timeout as a distinct persisted interaction outcome', () => {
    const { service } = createService();
    const request = {
      interactionId: 'form_1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Need details',
      createdAt: Date.now(),
      fields: [{ key: 'name', label: 'Name', type: 'string' }],
    } as any;

    const entry = service.buildInteractionHistoryEntry(request, {
      interactionId: 'form_1',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'expire',
      resolutionSource: 'timeout',
    });

    expect(entry).toEqual(expect.objectContaining({
      resolutionSource: 'timeout',
      status: 'expired',
      summaryText: 'Interaction expired before the user responded.',
    }));
  });

  it('preserves chat cancellation as a distinct persisted interaction outcome', () => {
    const { service } = createService();
    const request = {
      interactionId: 'choice_2',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      status: 'pending',
      title: 'Need selection',
      createdAt: Date.now(),
      mode: 'single',
      options: [{ value: 'a', label: 'A' }],
    } as any;

    const entry = service.buildInteractionHistoryEntry(request, {
      interactionId: 'choice_2',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'skip',
      resolutionSource: 'chat-cancelled',
    });

    expect(entry).toEqual(expect.objectContaining({
      resolutionSource: 'chat-cancelled',
      status: 'skipped',
      summaryText: 'The chat was cancelled while waiting for user input.',
    }));
  });

  it('builds summary for fully approved approval request', () => {
    const { service } = createService();
    const request: any = {
      interactionId: 'a1', chatId: 'c', chatSessionId: 's',
      requestType: 'approval', status: 'pending', title: 't',
      createdAt: Date.now(), source: 'tool',
      items: [{ itemId: '1', toolName: 'tool-a', message: 'a', paths: [{ path: '/a' }] }],
    };
    const response: any = {
      interactionId: 'a1', chatSessionId: 's', requestType: 'approval',
      action: 'submit',
      approvalItemDecisions: [{ itemId: '1', approved: true }],
    };
    expect(service.buildInteractionSummary(request, response)).toBe('Approved 1 tool request.');
  });

  it('builds summary for fully rejected approval request', () => {
    const { service } = createService();
    const request: any = {
      interactionId: 'a2', chatId: 'c', chatSessionId: 's',
      requestType: 'approval', status: 'pending', title: 't',
      createdAt: Date.now(), source: 'tool',
      items: [
        { itemId: '1', toolName: 'tool-a', message: 'a', paths: [{ path: '/a' }] },
        { itemId: '2', toolName: 'tool-b', message: 'b', paths: [{ path: '/b' }] },
      ],
    };
    const response: any = {
      interactionId: 'a2', chatSessionId: 's', requestType: 'approval',
      action: 'reject',
      approvalItemDecisions: [{ itemId: '1', approved: false }, { itemId: '2', approved: false }],
    };
    expect(service.buildInteractionSummary(request, response)).toBe('Rejected 2 tool requests.');
  });

  it('builds summary for expired interaction', () => {
    const { service } = createService();
    const request: any = { requestType: 'choice', interactionId: 'c1', title: 't', createdAt: 0, items: [] };
    const response: any = { action: 'expire', requestType: 'choice', chatSessionId: 's', interactionId: 'c1' };
    expect(service.buildInteractionSummary(request, response)).toBe('Interaction expired before the user responded.');
  });

  it('builds summary for skipped choice request', () => {
    const { service } = createService();
    const request: any = { requestType: 'choice', interactionId: 'c1', title: 't', createdAt: 0, items: [] };
    const response: any = { action: 'skip', requestType: 'choice', chatSessionId: 's', interactionId: 'c1' };
    expect(service.buildInteractionSummary(request, response)).toBe('Skipped the selection request.');
  });

  it('builds summary for submitted choice with selected values', () => {
    const { service } = createService();
    const request: any = { requestType: 'choice', interactionId: 'c1', title: 't', createdAt: 0, items: [] };
    const response: any = { action: 'submit', requestType: 'choice', chatSessionId: 's', interactionId: 'c1', selectedValues: ['a', 'b'] };
    expect(service.buildInteractionSummary(request, response)).toBe('Selected: a, b');
  });

  it('builds summary for submitted choice with no selected values', () => {
    const { service } = createService();
    const request: any = { requestType: 'choice', interactionId: 'c1', title: 't', createdAt: 0, items: [] };
    const response: any = { action: 'submit', requestType: 'choice', chatSessionId: 's', interactionId: 'c1', selectedValues: [] };
    expect(service.buildInteractionSummary(request, response)).toBe('Submitted the selection request without any selected value.');
  });

  it('builds summary for skipped form request', () => {
    const { service } = createService();
    const request: any = { requestType: 'form', interactionId: 'f1', title: 't', createdAt: 0, items: [] };
    const response: any = { action: 'skip', requestType: 'form', chatSessionId: 's', interactionId: 'f1' };
    expect(service.buildInteractionSummary(request, response)).toBe('Skipped the form request.');
  });

  it('builds summary for submitted form with values', () => {
    const { service } = createService();
    const request: any = { requestType: 'form', interactionId: 'f1', title: 't', createdAt: 0, items: [] };
    const response: any = {
      action: 'submit', requestType: 'form', chatSessionId: 's', interactionId: 'f1',
      formValues: { name: 'Alice', age: '30' },
    };
    expect(service.buildInteractionSummary(request, response)).toBe('Submitted form: name, age');
  });

  it('builds summary for system-fallback form request', () => {
    const { service } = createService();
    const request: any = { requestType: 'form', interactionId: 'f1', title: 't', createdAt: 0, items: [] };
    const response: any = {
      action: 'skip', requestType: 'form', chatSessionId: 's', interactionId: 'f1',
      resolutionSource: 'system-fallback',
    };
    expect(service.buildInteractionSummary(request, response)).toContain('system returned a fallback result');
  });

  it('returns selected values from a submitted choice via requestUserChoice', async () => {
    (interactiveRequestManager.createPendingRequest as Mock).mockResolvedValueOnce({
      interactionId: 'choice_submit',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'submit',
      selectedValues: ['option-a'],
    });
    const { service } = createService();
    // Patch getEventSender to return a non-null value so the request reaches the manager
    (service as any).deps.getEventSender = () => ({} as any);
    const result = await service.requestUserChoice('Pick one', 'Desc', [{ value: 'option-a', label: 'A' }], 'single');
    expect(result).toEqual(['option-a']);
  });

  it('returns null when user skips a requestUserChoice', async () => {
    (interactiveRequestManager.createPendingRequest as Mock).mockResolvedValueOnce({
      interactionId: 'choice_skip',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'skip',
    });
    const { service } = createService();
    (service as any).deps.getEventSender = () => ({} as any);
    const result = await service.requestUserChoice('Pick one', 'Desc', [{ value: 'a', label: 'A' }], 'single');
    expect(result).toBeNull();
  });

  it('batchValidateAndRequestApproval approves all tools and returns the map', async () => {
    const { service } = createService();
    const toolCalls = [
      { id: 'tc-1', function: { name: 'read_file', arguments: '{}' } },
      { id: 'tc-2', function: { name: 'write_file', arguments: '{}' } },
    ];
    const result = await service.batchValidateAndRequestApproval(toolCalls as any);
    expect(result.get('tc-1')).toBe(true);
    expect(result.get('tc-2')).toBe(true);
  });

  it('rethrows errors from createPendingRequest that are not a normal resolution', async () => {
    (interactiveRequestManager.createPendingRequest as Mock).mockRejectedValueOnce(new Error('connection lost'));
    const { service } = createService();
    (service as any).deps.getEventSender = () => ({} as any);
    const request: any = {
      interactionId: 'choice_err', chatId: 'chat-1', chatSessionId: 'session-1',
      requestType: 'choice', status: 'pending', title: 'Pick', createdAt: Date.now(),
      mode: 'single', options: [{ value: 'a', label: 'A' }],
    };
    await expect(service.requestUserInteraction(request, {
      interactionId: 'choice_err', chatSessionId: 'session-1', requestType: 'choice', action: 'skip',
    })).rejects.toThrow('connection lost');
    expect(interactiveRequestManager.clearSession).toHaveBeenCalledWith('session-1');
  });

  it('maps chat-cancelled approval interruptions to rejected decisions without hanging', async () => {
    const { service } = createService();
    (interactiveRequestManager.createPendingRequest as Mock).mockResolvedValueOnce({
      interactionId: 'approval_cancelled',
      chatSessionId: 'session-1',
      requestType: 'approval',
      action: 'skip',
      resolutionSource: 'chat-cancelled',
    });

    const decisions = await service.requestApprovalInteraction([
      {
        toolCallId: 'tool-1',
        toolName: 'read_file',
        paths: [{ path: '/tmp/demo.txt' }],
      },
      {
        toolCallId: 'tool-2',
        toolName: 'write_file',
        paths: [{ path: '/tmp/other.txt' }],
      },
    ] as any);

    expect(decisions.get('tool-1')).toBe(false);
    expect(decisions.get('tool-2')).toBe(false);
  });
});