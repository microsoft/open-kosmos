import { describe, it, expect } from 'vitest';
import { buildSubAgentSystemPrompt } from '../subAgentPromptBuilder';

describe('buildSubAgentSystemPrompt', () => {
  function buildOptions(overrides: Record<string, unknown> = {}) {
    return {
      subAgent: {
        config: {
          id: 'sub-1',
          name: 'Reviewer',
          role: 'reviewer',
          system_prompt: 'Review carefully.',
          mcp_servers: [],
        },
        inheritedModel: 'gpt-5',
        parentChatId: 'chat-1',
        parentSessionId: 'session-1',
        userAlias: 'alice',
        resolvedMcpServers: [{ name: 'builtin-tools', connected: true, tools: ['memex_memory'], inherited: true }],
        resolvedSkills: [],
        taskId: 'task-1',
      },
      task: 'Review a plan',
      cancellationToken: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) } as any,
      currentUserAlias: 'alice',
      allowedToolNames: new Set(['memex_memory']),
      ...overrides,
    } as any;
  }

  it('injects read-only Memex guidance when memex_memory is allowed', () => {
    const prompt = buildSubAgentSystemPrompt(buildOptions());

    const text = (prompt[0].content[0] as any).text;
    expect(text).toContain('Memex Memory is available read-only');
    expect(text).toContain('Use only `recall`, `search`, and `read`');
    expect(text).toContain('Do not call `capture`');
  });

  it('falls back to resolved server tools when allowedToolNames is omitted', () => {
    const prompt = buildSubAgentSystemPrompt(buildOptions({ allowedToolNames: undefined }));

    const text = (prompt[0].content[0] as any).text;
    expect(text).toContain('Memex Memory is available read-only');
  });

  it('treats an empty builtin server tool list as allowing memex_memory', () => {
    const options = buildOptions({ allowedToolNames: undefined });
    options.subAgent.resolvedMcpServers = [{ name: 'builtin-tools', connected: true, tools: [], inherited: true }];

    const prompt = buildSubAgentSystemPrompt(options);

    const text = (prompt[0].content[0] as any).text;
    expect(text).toContain('Memex Memory is available read-only');
  });

  it('omits Memex guidance when memex_memory is not allowed', () => {
    const options = buildOptions({ allowedToolNames: new Set(['read_file']) });
    options.subAgent.resolvedMcpServers = [{ name: 'builtin-tools', connected: true, tools: ['read_file'], inherited: true }];

    const prompt = buildSubAgentSystemPrompt(options);

    const text = (prompt[0].content[0] as any).text;
    expect(text).not.toContain('Memex Memory is available');
  });
});
