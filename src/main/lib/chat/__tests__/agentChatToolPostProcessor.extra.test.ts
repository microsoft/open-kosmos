/**
 * Additional coverage tests for agentChatToolPostProcessor.ts.
 */

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { AgentChatToolPostProcessor } from '../agentChatToolPostProcessor';

function makeProcessor(overrides: any = {}) {
  return new AgentChatToolPostProcessor({
    getAgentName: () => 'OpenKosmos',
    getChatId: () => 'chat-1',
    getChatSessionId: () => 'session-1',
    getInteractionPolicy: () => 'allow-ui',
    buildInteractionId: (prefix: string) => `${prefix}-id`,
    requestUserInteraction: vi.fn(),
    requestUserInfoInput: vi.fn(),
    ...overrides,
  });
}

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
    const toolResult = { success: true };
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
