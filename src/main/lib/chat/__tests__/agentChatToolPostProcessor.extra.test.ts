/**
 * Additional coverage tests for agentChatToolPostProcessor.ts
 * Covers branches not hit by existing tests
 */

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
    getCurrentAuth: vi.fn(() => ({
      ghcAuth: { alias: 'testuser' },
    })),
  },
}));

vi.mock('../../userDataADO/openkosmosPlaceholders', async () => ({
  containsOpenKosmosPlaceholder: vi.fn(() => false),
  openkosmosPlaceholderManager: {
    replacePlaceholders: vi.fn((value: string) => value),
    replacePlaceholdersInObject: vi.fn((value: any) => value),
  },
}));

vi.mock('../../userDataADO/userInputPlaceholderParser', async () => ({
  userInputPlaceholderParser: {
    parseConfig: vi.fn(() => ({ hasUserInputFields: false, fields: [] })),
  },
  UserInputField: class UserInputField {},
}));

import { AgentChatToolPostProcessor } from '../agentChatToolPostProcessor';

function makeProcessor(overrides: any = {}) {
  return new AgentChatToolPostProcessor({
    getAgentName: () => 'OpenKosmos',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    isRemoteSession: () => false,
    getInteractionPolicy: () => 'allow-ui',
    buildInteractionId: (prefix: string) => `${prefix}-id`,
    requestUserInteraction: vi.fn(),
    requestUserInfoInput: vi.fn(),
    ...overrides,
  });
}

describe('AgentChatToolPostProcessor — getMcpTemplateFromLibrary additional branches', () => {
  it('returns toolResult unchanged when toolResult is a number (non-string, non-object)', async () => {
    const processor = makeProcessor();
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      99,
    );
    expect(result).toBe(99);
  });

  it('returns toolResult unchanged when string is not valid JSON', async () => {
    const processor = makeProcessor();
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      'not-json{{',
    );
    expect(result).toBe('not-json{{');
  });

  it('returns config as-is when no env field and no openkosmos placeholder in url', async () => {
    const processor = makeProcessor();
    const toolResult = { name: 'MCP Server', url: 'https://example.com/mcp', command: 'npx' };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      toolResult,
    );
    // No env, no placeholder — returned as-is
    expect(result).toEqual(toolResult);
  });

  it('replaces OpenKosmos placeholder in URL when no env and currentUserAlias exists', async () => {
    const { containsOpenKosmosPlaceholder, openkosmosPlaceholderManager } = await import('../../userDataADO/openkosmosPlaceholders');
    (containsOpenKosmosPlaceholder as any).mockReturnValueOnce(true);
    (openkosmosPlaceholderManager.replacePlaceholders as any).mockReturnValueOnce('https://example.com/testuser/mcp');

    const processor = makeProcessor();
    const toolResult = { name: 'MCP Server', url: 'https://example.com/{{alias}}/mcp' };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      toolResult,
    );
    expect(result.url).toBe('https://example.com/testuser/mcp');
  });

  it('handles config nested under .config key as string input', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    (userInputPlaceholderParser.parseConfig as any).mockReturnValueOnce({ hasUserInputFields: false, fields: [] });

    const processor = makeProcessor();
    const toolResult = JSON.stringify({ config: { name: 'MCP Server', env: { KEY: 'value' } } });
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      toolResult,
    );
    // String input returns stringified JSON
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result);
    expect(parsed.config.env.KEY).toBe('value');
  });

  it('removes optional env fields with empty user input', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    (userInputPlaceholderParser.parseConfig as any).mockReturnValueOnce({
      hasUserInputFields: true,
      fields: [{
        key: 'OPTIONAL_KEY',
        label: 'Optional',
        type: 'STRING',
        control: 'text',
        varName: 'OPTIONAL_KEY',
        isRequired: false,
        defaultValue: undefined,
      }],
    });

    const processor = makeProcessor({
      requestUserInfoInput: vi.fn().mockResolvedValue({ OPTIONAL_KEY: '' }),
    });

    const toolResult = { name: 'MCP', env: { OPTIONAL_KEY: '{{user_input:OPTIONAL_KEY}}' } };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      toolResult,
    );
    // Optional field with empty value should be removed
    expect(result.env).not.toHaveProperty('OPTIONAL_KEY');
  });

  it('replaces OpenKosmos placeholder in URL when env exists', async () => {
    const { containsOpenKosmosPlaceholder, openkosmosPlaceholderManager } = await import('../../userDataADO/openkosmosPlaceholders');
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');

    (containsOpenKosmosPlaceholder as any)
      .mockReturnValueOnce(false)  // env values check
      .mockReturnValueOnce(true);  // url check
    (openkosmosPlaceholderManager.replacePlaceholders as any).mockReturnValueOnce('https://example.com/testuser/mcp');
    (userInputPlaceholderParser.parseConfig as any).mockReturnValueOnce({ hasUserInputFields: false, fields: [] });

    const processor = makeProcessor();
    const toolResult = { name: 'MCP', url: 'https://example.com/{{alias}}/mcp', env: { KEY: 'static' } };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_mcp_template_from_library' } },
      toolResult,
    );
    expect(result.url).toBe('https://example.com/testuser/mcp');
  });
});

describe('AgentChatToolPostProcessor — getAgentTemplateFromLibrary additional branches', () => {
  it('returns toolResult as-is for invalid JSON string', async () => {
    const processor = makeProcessor();
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      '{invalid json',
    );
    expect(result).toBe('{invalid json');
  });

  it('returns toolResult when no configuration.workspace field', async () => {
    const processor = makeProcessor();
    const toolResult = {
      name: 'MyAgent',
      configuration: { maxTokens: 100 }, // no workspace
    };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      toolResult,
    );
    // configuration exists but no workspace — just returns the config
    expect(result).toEqual(toolResult);
  });

  it('returns config when workspace has no user input fields', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    (userInputPlaceholderParser.parseConfig as any).mockReturnValueOnce({ hasUserInputFields: false, fields: [] });

    const processor = makeProcessor();
    const toolResult = { name: 'MyAgent', configuration: { workspace: '/home/user/project' } };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      toolResult,
    );
    expect(result.configuration.workspace).toBe('/home/user/project');
  });

  it('replaces OpenKosmos placeholder in workspace', async () => {
    const { containsOpenKosmosPlaceholder, openkosmosPlaceholderManager } = await import('../../userDataADO/openkosmosPlaceholders');
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');

    (containsOpenKosmosPlaceholder as any).mockReturnValueOnce(true);
    (openkosmosPlaceholderManager.replacePlaceholders as any).mockReturnValueOnce('/home/testuser/project');
    (userInputPlaceholderParser.parseConfig as any).mockReturnValueOnce({ hasUserInputFields: false, fields: [] });

    const processor = makeProcessor();
    const toolResult = { name: 'MyAgent', configuration: { workspace: '/home/{{alias}}/project' } };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      toolResult,
    );
    expect(result.configuration.workspace).toBe('/home/testuser/project');
  });

  it('sets workspace from user input field value', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    (userInputPlaceholderParser.parseConfig as any).mockReturnValueOnce({
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

    const processor = makeProcessor({
      requestUserInfoInput: vi.fn().mockResolvedValue({ WORKSPACE: '/home/user/my-project' }),
    });

    const toolResult = { name: 'MyAgent', configuration: { workspace: '{{user_input:WORKSPACE}}' } };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      toolResult,
    );
    expect(result.configuration.workspace).toBe('/home/user/my-project');
  });

  it('sets workspace to empty when optional workspace field has empty user input', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    (userInputPlaceholderParser.parseConfig as any).mockReturnValueOnce({
      hasUserInputFields: true,
      fields: [{
        key: 'WORKSPACE',
        label: 'Workspace',
        type: 'STRING',
        control: 'text',
        varName: 'WORKSPACE',
        isRequired: false,
        defaultValue: undefined,
      }],
    });

    const processor = makeProcessor({
      requestUserInfoInput: vi.fn().mockResolvedValue({ WORKSPACE: '' }),
    });

    const toolResult = { name: 'MyAgent', configuration: { workspace: '{{user_input:WORKSPACE}}' } };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      toolResult,
    );
    expect(result.configuration.workspace).toBe('');
  });

  it('returns toolResult as-is when error occurs (non-interaction error)', async () => {
    const { userInputPlaceholderParser } = await import('../../userDataADO/userInputPlaceholderParser');
    (userInputPlaceholderParser.parseConfig as any).mockImplementationOnce(() => {
      throw new Error('parser failed');
    });

    const processor = makeProcessor();
    const toolResult = { name: 'MyAgent', configuration: { workspace: '{{user_input:WORKSPACE}}' } };
    const result = await processor.postProcessToolResult(
      { function: { name: 'get_agent_template_from_library' } },
      toolResult,
    );
    // Error caught and returns original toolResult
    expect(result).toBe(toolResult);
  });
});

describe('AgentChatToolPostProcessor — request_interactive_input string toolResult', () => {
  it('parses string toolResult for interactive input', async () => {
    const processor = makeProcessor({
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'choice-id',
        chatSessionId: 'session-1',
        requestType: 'choice',
        action: 'submit',
        selectedValues: ['a'],
      }),
    });

    // Provide toolResult as JSON string
    const toolResultString = JSON.stringify({
      success: true,
      interactive_request: {
        title: 'Pick one',
        schema: {
          kind: 'choice',
          mode: 'single',
          options: [{ value: 'a', label: 'A' }],
        },
      },
    });

    const result = await processor.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      toolResultString,
    );

    expect(result.status).toBe('submitted');
    expect(result.selected_values).toEqual(['a']);
  });

  it('returns toolResult unchanged when interactive_request is missing', async () => {
    const processor = makeProcessor();
    const toolResult = { success: true }; // no interactive_request
    const result = await processor.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      toolResult,
    );
    expect(result).toBe(toolResult);
  });

  it('handles form expire action', async () => {
    const processor = makeProcessor({
      requestUserInteraction: vi.fn().mockResolvedValue({
        interactionId: 'form-id',
        chatSessionId: 'session-1',
        requestType: 'form',
        action: 'expire',
        resolutionSource: 'timeout',
      }),
    });

    const result = await processor.postProcessToolResult(
      { function: { name: 'request_interactive_input' } },
      {
        success: true,
        interactive_request: {
          title: 'Fill form',
          schema: {
            kind: 'form',
            fields: [{ key: 'name', label: 'Name', control: 'text', required: true }],
          },
        },
      },
    );
    expect(result.status).toBe('expired');
    expect(result.form_values).toBeNull();
  });
});
