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

vi.mock('../../userDataADO/kosmosPlaceholders', async () => ({
  containsOpenKosmosPlaceholder: vi.fn(() => false),
  kosmosPlaceholderManager: {
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

describe('AgentChatToolPostProcessor', () => {
  it('skips request_interactive_input in remote sessions', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => true,
      getInteractionPolicy: () => 'plain-text-only',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      { success: true, interactive_request: { title: 'ignored' } },
    );

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      skipped_by_user: false,
      user_action: 'unavailable_in_remote_session',
      message: 'This tool is unavailable because the user is interacting via a remote IM channel which does not support interactive UI components. Please ask the user directly in plain text instead.',
    });
  });

  it('returns an explicit user-skipped result for choice requests', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
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

  it('returns an explicit user-skipped result for form requests', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
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
      isRemoteSession: () => false,
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
      isRemoteSession: () => false,
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
      isRemoteSession: () => false,
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
      isRemoteSession: () => false,
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

  it('rethrows blocked interactive errors for template user-info enrichment', async () => {
    const blockedError = new NonInteractiveRuntimeInteractionError({
      policy: 'forbid',
      requestType: 'form',
      title: 'Configure MCP Server',
      message: 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.',
    });

    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    const parseConfig = userInputPlaceholderParser.parseConfig as Mock;
    parseConfig.mockReturnValueOnce({
      hasUserInputFields: true,
      fields: [{
        key: 'TOKEN',
        label: 'Token',
        type: 'STRING',
        control: 'text',
        varName: 'TOKEN',
        isRequired: true,
      }],
    });

    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
      getInteractionPolicy: () => 'forbid',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn().mockRejectedValue(blockedError),
    });

    await expect(service.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      { config: { name: 'MCP Server', env: { TOKEN: '{{user_input}}' } } },
    )).rejects.toBe(blockedError);
  });

  it('returns the tool result unchanged when tool name has no special handling', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
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
      isRemoteSession: () => false,
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
      isRemoteSession: () => false,
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

  it('returns toolResult unchanged when parsedResult.success is false', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
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

  it('postProcessForGetAgentTemplateFromLibraryTool returns toolResult for non-object', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn(),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      42, // non-object, non-string
    );

    expect(result).toBe(42);
  });

  it('postProcessForGetAgentTemplateFromLibraryTool returns configData for no configuration field', async () => {
    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn(),
    });

    const toolResult = { name: 'My Agent', description: 'an agent' };
    const result = await service.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      toolResult,
    );

    // Returns the original (no configuration field)
    expect(result).toBe(toolResult);
  });

  it('postProcessForGetAgentTemplateFromLibraryTool sets workspace empty when user skips input', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    const parseConfig = userInputPlaceholderParser.parseConfig as Mock;
    parseConfig.mockReturnValueOnce({
      hasUserInputFields: true,
      fields: [{
        key: 'WORKSPACE',
        label: 'Workspace',
        type: 'STRING',
        control: 'text',
        varName: 'WORKSPACE',
        isRequired: true,
        defaultValue: undefined,
      }],
    });

    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn().mockResolvedValue(null),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      {
        name: 'MyAgent',
        configuration: { workspace: '{{user_input:WORKSPACE}}' },
      },
    );

    expect(result.configuration.workspace).toBe('');
  });

  it('postProcessForGetMcpTemplateFromLibraryTool updates env with user-provided values', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    const parseConfig = userInputPlaceholderParser.parseConfig as Mock;
    parseConfig.mockReturnValueOnce({
      hasUserInputFields: true,
      fields: [{
        key: 'TOKEN',
        label: 'Token',
        type: 'STRING',
        control: 'text',
        varName: 'TOKEN',
        isRequired: true,
        defaultValue: undefined,
      }],
    });

    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn().mockResolvedValue({ TOKEN: 'my-secret-token' }),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      { config: { name: 'MCP Server', env: { TOKEN: '{{user_input:TOKEN}}' } } },
    );

    expect(result.config.env.TOKEN).toBe('my-secret-token');
  });

  it('postProcessForGetMcpTemplateFromLibraryTool removes env when user skips', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    const parseConfig = userInputPlaceholderParser.parseConfig as Mock;
    parseConfig.mockReturnValueOnce({
      hasUserInputFields: true,
      fields: [{
        key: 'TOKEN',
        label: 'Token',
        type: 'STRING',
        control: 'text',
        varName: 'TOKEN',
        isRequired: false,
        defaultValue: undefined,
      }],
    });

    const service = new AgentChatToolPostProcessor({
      getAgentName: () => 'OpenKosmos',
      getChatId: () => 'chat-1',
      getChatSessionId: () => 'session-1',
      isRemoteSession: () => false,
      getInteractionPolicy: () => 'allow-ui',
      buildInteractionId: () => 'interaction-1',
      requestUserInteraction: vi.fn(),
      requestUserInfoInput: vi.fn().mockResolvedValue(null),
    });

    const result = await service.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      { config: { name: 'MCP Server', env: { TOKEN: '{{user_input:TOKEN}}' } } },
    );

    expect(result.config.env).toBeUndefined();
  });
});