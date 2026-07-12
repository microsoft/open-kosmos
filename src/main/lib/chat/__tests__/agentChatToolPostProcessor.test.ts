vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: {
    getCurrentAuth: vi.fn(() => null),
  },
}));

vi.mock('../../userDataADO/openkosmosPlaceholders', async () => ({
  containsOpenKosmosPlaceholder: vi.fn(() => false),
  openkosmosPlaceholderManager: {
    replacePlaceholders: vi.fn((value) => value),
    replacePlaceholdersInObject: vi.fn((value) => value),
  },
}));

vi.mock('../../userDataADO/userInputPlaceholderParser', async () => ({
  userInputPlaceholderParser: {
    parseConfig: vi.fn(() => ({ hasUserInputFields: false, fields: [] })),
  },
  UserInputField: class UserInputField {},
}));

import { AgentChatToolPostProcessor } from '../agentChatToolPostProcessor';
import { NonInteractiveRuntimeInteractionError } from '../agentChatInteractionPolicy';
import type { RequestInteractiveInputArgs } from '@shared/types/requestInteractiveInputTypes';
import {
  buildComputerUseConfirmationRequest,
  computerUseConfirmationStore,
} from '../../computerUse/confirmationGate';
import { mainAuthManager } from '../../auth/authManager';
import { containsOpenKosmosPlaceholder, openkosmosPlaceholderManager } from '../../userDataADO/openkosmosPlaceholders';
import { userInputPlaceholderParser } from '../../userDataADO/userInputPlaceholderParser';

beforeEach(() => {
  computerUseConfirmationStore.clear();
  vi.mocked(mainAuthManager.getCurrentAuth).mockReturnValue(null);
  vi.mocked(containsOpenKosmosPlaceholder).mockReturnValue(false);
  vi.mocked(openkosmosPlaceholderManager.replacePlaceholders).mockImplementation((value) => value);
  vi.mocked(openkosmosPlaceholderManager.replacePlaceholdersInObject).mockImplementation((value) => value);
  vi.mocked(userInputPlaceholderParser.parseConfig).mockReturnValue({ hasUserInputFields: false, fields: [] });
});

function createTrustedComputerUseConfirmation(fingerprint = 'fp-1'): {
  confirmationId: string;
  request: RequestInteractiveInputArgs;
} {
  let request: RequestInteractiveInputArgs | null = null;
  const confirmationId = computerUseConfirmationStore.createPendingWithRequest('session-1', fingerprint, (id) => {
    request = buildComputerUseConfirmationRequest(id, { action: 'click', x: 1, y: 2 });
    return request;
  });
  if (!request) {
    throw new Error('Expected Computer Use confirmation request to be created');
  }
  return { confirmationId, request };
}

describe('AgentChatToolPostProcessor', () => {
  it('returns an explicit user-skipped result for choice requests', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'skip',
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Choose a project',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'a', label: 'A' }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      request_type: 'choice',
      skipped_by_user: true,
      user_action: 'skip',
      message: 'The user explicitly skipped or cancelled this interactive input request. Do not ask the same interactive question again unless the user later reopens the topic or provides new context.',
      selected_values: [],
    });
  });

  it('approves a Computer Use confirmation only when the user selects approve', async () => {
    const { confirmationId, request } = createTrustedComputerUseConfirmation();
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
        selectedValues: ['approve'],
        selectedPresetValues: ['approve'],
        customValues: [],
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: request,
      },
    );

    expect(result.status).toBe('submitted');
    expect(computerUseConfirmationStore.consumeApproved(confirmationId, 'session-1', 'fp-1')).toBe(true);
  });

  it('does not approve a spoofed Computer Use confirmation card', async () => {
    const { confirmationId } = createTrustedComputerUseConfirmation();
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
        selectedValues: ['approve'],
        selectedPresetValues: ['approve'],
        customValues: [],
      }),
      requestUserInfoInput: vi.fn(),
    });

    await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Continue harmless setup',
          description: 'Approve to continue setup.',
          metadata: { computerUseConfirmationId: confirmationId },
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'approve', label: 'Continue' }, { value: 'cancel', label: 'Cancel' }],
          },
        },
      },
    );

    expect(computerUseConfirmationStore.consumeApproved(confirmationId, 'session-1', 'fp-1')).toBe(false);
  });

  it('does not approve a Computer Use confirmation when approve is entered as a custom choice', async () => {
    const { confirmationId, request } = createTrustedComputerUseConfirmation();
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
        selectedValues: ['approve'],
        selectedPresetValues: [],
        customValues: ['approve'],
      }),
      requestUserInfoInput: vi.fn(),
    });

    await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: request,
      },
    );

    expect(computerUseConfirmationStore.consumeApproved(confirmationId, 'session-1', 'fp-1')).toBe(false);
  });

  it('does not approve a Computer Use confirmation when the user selects cancel', async () => {
    const { confirmationId, request } = createTrustedComputerUseConfirmation();
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
        selectedValues: ['cancel'],
      }),
      requestUserInfoInput: vi.fn(),
    });

    await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: request,
      },
    );

    expect(computerUseConfirmationStore.consumeApproved(confirmationId, 'session-1', 'fp-1')).toBe(false);
  });

  it('returns an explicit user-skipped result for form requests', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'form',
        action: 'skip',
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Need workspace path',
          schema: {
            kind: 'form',
            fields: [{ key: 'workspace', label: 'Workspace', control: 'text', required: true }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      request_type: 'form',
      skipped_by_user: true,
      user_action: 'skip',
      message: 'The user explicitly skipped or cancelled this interactive input request. Do not ask the same interactive question again unless the user later reopens the topic or provides new context.',
      form_values: null,
    });
  });

  it('returns a system-fallback result when the interactive request cannot be delivered to a renderer', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'skip',
        resolutionSource: 'system-fallback',
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Choose a project',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'a', label: 'A' }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      request_type: 'choice',
      skipped_by_user: false,
      user_action: 'system_fallback',
      message: 'This interactive input request could not be delivered to an active UI receiver, so the runtime returned a fallback result. Do not treat this as an explicit user decline.',
      selected_values: [],
    });
  });

  it('returns an expired result when the interactive request resolves via timeout semantics', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'expire',
        resolutionSource: 'timeout',
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Choose a project',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'a', label: 'A' }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      status: 'expired',
      request_type: 'choice',
      skipped_by_user: false,
      user_action: 'expire',
      message: 'This interactive input request expired before the user responded. Do not claim that the user declined it; decide whether to continue with a fallback or explain that the input was not provided in time.',
      selected_values: [],
    });
  });

  it('returns a chat-cancelled result when the chat is cancelled while waiting for interactive input', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'skip',
        resolutionSource: 'chat-cancelled',
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Choose a project',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'a', label: 'A' }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      request_type: 'choice',
      skipped_by_user: false,
      user_action: 'chat_cancelled',
      message: 'The chat was cancelled while waiting for this interactive input request, so no user response was collected. Do not treat this as an explicit user decline.',
      selected_values: [],
    });
  });

  it('rethrows blocked interactive errors for request_interactive_input in non-interactive runtimes', async () => {
    const blockedError = new NonInteractiveRuntimeInteractionError({
      policy: 'forbid',
      requestType: 'form',
      title: 'Need input',
      message: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
    });

    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'forbid',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockRejectedValue(blockedError),
      requestUserInfoInput: vi.fn(),
    });

    await expect(service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Need input',
          description: 'desc',
          source: 'assistant',
          submitLabel: 'Continue',
          skipLabel: 'Skip',
          schema: {
            kind: 'form',
            fields: [{ key: 'workspace', label: 'Workspace', control: 'text', required: true }],
          },
        },
      },
    )).rejects.toBe(blockedError);
  });

  it('returns the tool result unchanged when tool name has no special handling', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'read_file' } },
      { content: 'file content' },
    );

    expect(result).toEqual({ content: 'file content' });
  });

  it('returns submitted form values from request_interactive_input form', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'form',
        action: 'submit',
        formValues: { workspace: '/home/user/project' },
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Set workspace',
          schema: {
            kind: 'form',
            fields: [{ key: 'workspace', label: 'Workspace', control: 'text', required: true }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      status: 'submitted',
      request_type: 'form',
      skipped_by_user: false,
      user_action: 'submit',
      message: 'The user submitted a response to this interactive input request.',
      form_values: { workspace: '/home/user/project' },
    });
  });

  it('returns submitted selected values from request_interactive_input choice', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
        selectedValues: ['option-b'],
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Pick option',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'option-b', label: 'B' }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      status: 'submitted',
      request_type: 'choice',
      skipped_by_user: false,
      user_action: 'submit',
      message: 'The user submitted a response to this interactive input request.',
      selected_values: ['option-b'],
    });
  });

  it('parses string request_interactive_input tool results', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
        selectedValues: ['a'],
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      JSON.stringify({
        success: true,
        interactive_request: {
          title: 'Pick option',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'a', label: 'A' }],
          },
        },
      }),
    );

    expect(result.selected_values).toEqual(['a']);
  });

  it('defaults submitted choice values to an empty array', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'interaction-1',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
      }),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Pick option',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'option-b', label: 'B' }],
          },
        },
      },
    );

    expect(result.selected_values).toEqual([]);
  });

  it('maps form field controls and defaults missing submitted form values', async () => {
    const requestUserInteraction = vi.fn().mockResolvedValue({
      interactionId: 'interaction-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
    });
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction,
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Configure',
          schema: {
            kind: 'form',
            fields: [
              { key: 'enabled', label: 'Enabled', control: 'checkbox', required: false },
              { key: 'count', label: 'Count', control: 'number', required: false },
              { key: 'name', label: 'Name', control: 'text', required: true },
            ],
          },
        },
      },
    );

    expect(requestUserInteraction.mock.calls[0][0].fields.map((field: { type: string }) => field.type)).toEqual([
      'boolean',
      'double',
      'string',
    ]);
    expect(result.form_values).toEqual({});
  });

  it('returns a structured failure when request_interactive_input processing throws a non-Error', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockRejectedValue('boom'),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Pick option',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'a', label: 'A' }],
          },
        },
      },
    );

    expect(result).toEqual({
      success: false,
      error: 'INTERACTIVE_INPUT_POST_PROCESS_FAILED',
      message: 'Failed to process interactive input request',
    });
  });

  it('returns the thrown Error message when request_interactive_input processing fails', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn().mockRejectedValue(new Error('renderer unavailable')),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Pick option',
          schema: {
            kind: 'choice',
            mode: 'single',
            options: [{ value: 'a', label: 'A' }],
          },
        },
      },
    );

    expect(result.message).toBe('renderer unavailable');
  });

  it('returns toolResult unchanged when parsedResult.success is false', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn(),
    });

    const toolResult = { success: false, error: 'tool_failed' };
    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      toolResult,
    );

    expect(result).toBe(toolResult);
  });
});
