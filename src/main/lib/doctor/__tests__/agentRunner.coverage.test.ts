// @ts-nocheck
/**
 * Tests for DoctorAgentRunner (agentRunner.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockClearDebugLog = vi.fn();
const mockAppendDebugLog = vi.fn();
vi.mock('../log', () => ({
  clearDebugLog: () => mockClearDebugLog(),
  appendDebugLog: (...args: any[]) => mockAppendDebugLog(...args),
}));

const mockCallDoctorLlm = vi.fn();
vi.mock('../llmClient', () => ({
  callDoctorLlm: (...args: any[]) => mockCallDoctorLlm(...args),
}));

const mockExecuteTool = vi.fn();
vi.mock('../toolExecutor', () => ({
  executeTool: (...args: any[]) => mockExecuteTool(...args),
}));

vi.mock('../agentConfig', () => ({
  MAX_TURNS: 5,
  TOOL_DEFINITIONS: [],
  SYSTEM_PROMPT: 'You are a helpful assistant.',
}));

const mockCompressImageFirstPass = vi.fn();
vi.mock('../../utilities/imageStorageCompression', () => ({
  compressImageFirstPass: (...args: any[]) => mockCompressImageFirstPass(...args),
  MAX_IMAGE_BYTES_FOR_INLINE: 5 * 1024 * 1024, // 5MB
  MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE: 2 * 1024 * 1024, // 2MB
}));

import { DoctorAgentRunner } from '../agentRunner';

const TASK_ID = 'test-task-42';

function makePayload(overrides: Partial<any> = {}): any {
  return {
    description: 'Something is broken',
    stepsToReproduce: '1. Open app\n2. Click button',
    occurredAt: 'yesterday',
    agentId: 'agent-123',
    chatSessionId: 'session-456',
    screenshots: [],
    ...overrides,
  };
}

function makeLlmResponse(overrides: Partial<any> = {}) {
  return {
    finishReason: 'stop',
    content: 'Done.',
    toolCalls: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── basic success/failure ──────────────────────────────────────────────────────

describe('DoctorAgentRunner – basic run', () => {
  it('returns failure when LLM finishes with no tool calls and no issue created', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const runner = new DoctorAgentRunner(vi.fn());
    const result = await runner.run(makePayload(), TASK_ID);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('did not create a GitHub issue');
    }
  });

  it('clears debug log and appends initial entries', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(makePayload(), TASK_ID);
    expect(mockClearDebugLog).toHaveBeenCalledOnce();
    expect(mockAppendDebugLog).toHaveBeenCalledWith('Agent Started', expect.stringContaining(TASK_ID));
  });

  it('pushes "Preparing analysis..." and "Thinking..." step info', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const pushStepInfo = vi.fn();
    const runner = new DoctorAgentRunner(pushStepInfo);
    await runner.run(makePayload(), TASK_ID);
    expect(pushStepInfo).toHaveBeenCalledWith('Preparing analysis...');
    expect(pushStepInfo).toHaveBeenCalledWith('Thinking...');
  });

  it('logs user bug report details to debug log', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const runner = new DoctorAgentRunner(vi.fn());
    const payload = makePayload({ agentId: 'my-agent', chatSessionId: 'my-session' });
    await runner.run(payload, TASK_ID);
    const call = mockAppendDebugLog.mock.calls.find((c: any[]) => c[0] === 'User Bug Report');
    expect(call).toBeTruthy();
    expect(call[1]).toContain('Something is broken');
    expect(call[1]).toContain('my-agent');
    expect(call[1]).toContain('my-session');
  });
});

// ── tool calls ────────────────────────────────────────────────────────────────

describe('DoctorAgentRunner – tool calls', () => {
  it('executes tool calls in sequence and appends results to messages', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc1', function: { name: 'get_app_info', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse()); // second turn: no more tools

    mockExecuteTool.mockResolvedValue(JSON.stringify({ os: 'macOS' }));

    const runner = new DoctorAgentRunner(vi.fn());
    const result = await runner.run(makePayload(), TASK_ID);

    expect(mockExecuteTool).toHaveBeenCalledWith('get_app_info', {}, { taskId: TASK_ID });
    expect(result.success).toBe(false); // no issue created
  });

  it('pushes known step info for tool calls', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc2', function: { name: 'read_app_logs', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    mockExecuteTool.mockResolvedValue('[]');
    const pushStepInfo = vi.fn();
    const runner = new DoctorAgentRunner(pushStepInfo);
    await runner.run(makePayload(), TASK_ID);
    expect(pushStepInfo).toHaveBeenCalledWith('Querying application logs...');
  });

  it('pushes "Running <name>..." for unknown tool names', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc3', function: { name: 'custom_tool', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    mockExecuteTool.mockResolvedValue('result');
    const pushStepInfo = vi.fn();
    const runner = new DoctorAgentRunner(pushStepInfo);
    await runner.run(makePayload(), TASK_ID);
    expect(pushStepInfo).toHaveBeenCalledWith('Running custom_tool...');
  });

  it('handles invalid JSON tool arguments gracefully', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc4', function: { name: 'get_app_info', arguments: 'not-valid-json' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    mockExecuteTool.mockResolvedValue('ok');
    const runner = new DoctorAgentRunner(vi.fn());
    // Should not throw
    await expect(runner.run(makePayload(), TASK_ID)).resolves.toBeDefined();
    expect(mockExecuteTool).toHaveBeenCalledWith('get_app_info', {}, { taskId: TASK_ID });
  });

  it('handles empty tool arguments string', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc5', function: { name: 'get_app_info', arguments: '' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    mockExecuteTool.mockResolvedValue('ok');
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(makePayload(), TASK_ID);
    expect(mockExecuteTool).toHaveBeenCalledWith('get_app_info', {}, { taskId: TASK_ID });
  });
});

// ── create_github_issue tool ──────────────────────────────────────────────────

describe('DoctorAgentRunner – create_github_issue', () => {
  it('returns success with issueUrl when create_github_issue returns a valid URL', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            {
              id: 'tc-gh',
              function: {
                name: 'create_github_issue',
                arguments: JSON.stringify({ title: 'Bug report' }),
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    const issueUrl = 'https://github.com/org/repo/issues/42';
    mockExecuteTool.mockResolvedValue(JSON.stringify({ issueUrl }));

    const runner = new DoctorAgentRunner(vi.fn());
    const result = await runner.run(makePayload(), TASK_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.issueUrl).toBe(issueUrl);
    }
  });

  it('ignores invalid JSON from create_github_issue silently', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc-gh2', function: { name: 'create_github_issue', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    mockExecuteTool.mockResolvedValue('not-json'); // invalid JSON from tool
    const runner = new DoctorAgentRunner(vi.fn());
    const result = await runner.run(makePayload(), TASK_ID);
    expect(result.success).toBe(false);
  });

  it('handles create_github_issue result with no issueUrl field', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc-gh3', function: { name: 'create_github_issue', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    mockExecuteTool.mockResolvedValue(JSON.stringify({ status: 'created' })); // no issueUrl
    const runner = new DoctorAgentRunner(vi.fn());
    const result = await runner.run(makePayload(), TASK_ID);
    expect(result.success).toBe(false);
  });
});

// ── max turns ─────────────────────────────────────────────────────────────────

describe('DoctorAgentRunner – max turns', () => {
  it('stops after MAX_TURNS even if LLM keeps returning tool calls', async () => {
    // Always return a tool call → should stop after MAX_TURNS (5)
    mockCallDoctorLlm.mockResolvedValue(
      makeLlmResponse({
        toolCalls: [
          { id: 'tc-loop', function: { name: 'get_app_info', arguments: '{}' } },
        ],
      }),
    );
    mockExecuteTool.mockResolvedValue('ok');
    const runner = new DoctorAgentRunner(vi.fn());
    const result = await runner.run(makePayload(), TASK_ID);
    expect(result.success).toBe(false);
    expect(mockCallDoctorLlm).toHaveBeenCalledTimes(5); // MAX_TURNS
  });
});

// ── screenshots ───────────────────────────────────────────────────────────────

describe('DoctorAgentRunner – screenshots handling', () => {
  it('embeds screenshot as image_url when within size limit', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    mockCompressImageFirstPass.mockResolvedValue({
      compressedSize: 500 * 1024, // 500KB, within limit
      originalSize: 1 * 1024 * 1024,
      mimeType: 'image/jpeg',
      base64Data: 'abc123',
      width: 1024,
      height: 768,
    });

    const runner = new DoctorAgentRunner(vi.fn());
    // 1MB screenshot (< 5MB limit)
    const bytes = new ArrayBuffer(1 * 1024 * 1024);
    const result = await runner.run(
      makePayload({
        screenshots: [{ name: 'shot.png', mimeType: 'image/png', bytes }],
      }),
      TASK_ID,
    );

    expect(mockCompressImageFirstPass).toHaveBeenCalled();
    // Check that the LLM was called with multi-part content (array)
    const llmCall = mockCallDoctorLlm.mock.calls[0];
    const messages = llmCall[0];
    const userMsg = messages[1];
    expect(Array.isArray(userMsg.content)).toBe(true);
    const imagePart = (userMsg.content as any[]).find((p: any) => p.type === 'image_url');
    expect(imagePart).toBeDefined();
    expect(imagePart.image_url.url).toContain('data:image/jpeg;base64,abc123');
  });

  it('skips screenshot that exceeds MAX_IMAGE_BYTES_FOR_INLINE', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());

    const runner = new DoctorAgentRunner(vi.fn());
    // 10MB screenshot (> 5MB limit)
    const bytes = new ArrayBuffer(10 * 1024 * 1024);
    await runner.run(
      makePayload({
        screenshots: [{ name: 'huge.png', mimeType: 'image/png', bytes }],
      }),
      TASK_ID,
    );

    expect(mockCompressImageFirstPass).not.toHaveBeenCalled();
    const userMsg = mockCallDoctorLlm.mock.calls[0][0][1];
    // When screenshot is skipped, the content is an array with just the text part
    // (because the code path still goes through the array content creation with empty extraParts)
    const contentText = Array.isArray(userMsg.content)
      ? (userMsg.content as any[]).find((p: any) => p.type === 'text')?.text || ''
      : userMsg.content;
    expect(contentText).toContain('too large');
  });

  it('skips screenshot when compressed size exceeds limit', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    mockCompressImageFirstPass.mockResolvedValue({
      compressedSize: 3 * 1024 * 1024, // 3MB > 2MB limit
      originalSize: 4 * 1024 * 1024,
      mimeType: 'image/jpeg',
      base64Data: 'xyz',
      width: 2048,
      height: 1536,
    });

    const runner = new DoctorAgentRunner(vi.fn());
    const bytes = new ArrayBuffer(4 * 1024 * 1024);
    await runner.run(
      makePayload({
        screenshots: [{ name: 'big-compressed.png', mimeType: 'image/png', bytes }],
      }),
      TASK_ID,
    );

    const userMsg = mockCallDoctorLlm.mock.calls[0][0][1];
    const contentText = Array.isArray(userMsg.content)
      ? (userMsg.content as any[]).find((p: any) => p.type === 'text')?.text || ''
      : userMsg.content;
    expect(contentText).toContain('still too large');
  });

  it('skips screenshot when compression throws', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    mockCompressImageFirstPass.mockRejectedValue(new Error('compression failed'));

    const runner = new DoctorAgentRunner(vi.fn());
    const bytes = new ArrayBuffer(1 * 1024 * 1024);
    await runner.run(
      makePayload({
        screenshots: [{ name: 'error.png', mimeType: 'image/png', bytes }],
      }),
      TASK_ID,
    );

    const userMsg = mockCallDoctorLlm.mock.calls[0][0][1];
    const contentText = Array.isArray(userMsg.content)
      ? (userMsg.content as any[]).find((p: any) => p.type === 'text')?.text || ''
      : userMsg.content;
    expect(contentText).toContain('compression failed');
  });

  it('handles unsupported mime type by defaulting to image/png', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    mockCompressImageFirstPass.mockResolvedValue({
      compressedSize: 100 * 1024,
      originalSize: 500 * 1024,
      mimeType: 'image/png',
      base64Data: 'abc',
      width: 640,
      height: 480,
    });

    const runner = new DoctorAgentRunner(vi.fn());
    const bytes = new ArrayBuffer(500 * 1024);
    await runner.run(
      makePayload({
        screenshots: [{ name: 'shot.tiff', mimeType: 'image/tiff', bytes }], // unsupported
      }),
      TASK_ID,
    );

    // compressImageFirstPass should still be called (with image/png as fallback)
    expect(mockCompressImageFirstPass).toHaveBeenCalledWith(
      expect.any(String),
      'image/png',
      expect.any(Object),
    );
  });

  it('builds user message as plain string when no screenshots provided', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(makePayload({ screenshots: [] }), TASK_ID);

    const userMsg = mockCallDoctorLlm.mock.calls[0][0][1];
    expect(typeof userMsg.content).toBe('string');
    expect(userMsg.content).toContain('Bug Report');
    expect(userMsg.content).toContain('Something is broken');
  });

  it('includes agentId and chatSessionId in user message when provided', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(
      makePayload({ agentId: 'my-agent', chatSessionId: 'my-session', screenshots: [] }),
      TASK_ID,
    );

    const userMsg = mockCallDoctorLlm.mock.calls[0][0][1];
    expect(userMsg.content).toContain('my-agent');
    expect(userMsg.content).toContain('my-session');
  });

  it('omits agentId and chatSessionId when not provided', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(
      makePayload({ agentId: undefined, chatSessionId: undefined, screenshots: [] }),
      TASK_ID,
    );

    const userMsg = mockCallDoctorLlm.mock.calls[0][0][1];
    expect(userMsg.content).not.toContain('Affected Agent ID');
    expect(userMsg.content).not.toContain('Affected Chat Session ID');
  });

  it('includes multiple screenshots count in text', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    mockCompressImageFirstPass.mockResolvedValue({
      compressedSize: 100 * 1024,
      originalSize: 500 * 1024,
      mimeType: 'image/png',
      base64Data: 'img1',
      width: 640,
      height: 480,
    });

    const runner = new DoctorAgentRunner(vi.fn());
    const bytes = new ArrayBuffer(500 * 1024);
    await runner.run(
      makePayload({
        screenshots: [
          { name: 'shot1.png', mimeType: 'image/png', bytes },
          { name: 'shot2.png', mimeType: 'image/png', bytes },
        ],
      }),
      TASK_ID,
    );

    const userMsg = mockCallDoctorLlm.mock.calls[0][0][1];
    expect(Array.isArray(userMsg.content)).toBe(true);
    const textPart = (userMsg.content as any[]).find((p: any) => p.type === 'text');
    expect(textPart.text).toContain('2 of 2 screenshot');
  });
});

// ── debug log entries for tool calls ─────────────────────────────────────────

describe('DoctorAgentRunner – debug log entries', () => {
  it('appends LLM response debug log each turn', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse({ content: 'My response' }));
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(makePayload(), TASK_ID);

    const llmLogCall = mockAppendDebugLog.mock.calls.find((c: any[]) => c[0].startsWith('LLM Response'));
    expect(llmLogCall).toBeTruthy();
    expect(llmLogCall[1]).toContain('My response');
  });

  it('appends Run Complete log', async () => {
    mockCallDoctorLlm.mockResolvedValue(makeLlmResponse());
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(makePayload(), TASK_ID);

    const runCompleteCall = mockAppendDebugLog.mock.calls.find((c: any[]) => c[0] === 'Run Complete');
    expect(runCompleteCall).toBeTruthy();
  });

  it('appends tool call and tool result debug entries', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc-debug', function: { name: 'get_app_info', arguments: '{"verbose": true}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    mockExecuteTool.mockResolvedValue('{"os":"macOS"}');
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(makePayload(), TASK_ID);

    const toolCallLog = mockAppendDebugLog.mock.calls.find((c: any[]) => c[0] === 'Tool Call: get_app_info');
    expect(toolCallLog).toBeTruthy();
    const toolResultLog = mockAppendDebugLog.mock.calls.find((c: any[]) => c[0] === 'Tool Result: get_app_info');
    expect(toolResultLog).toBeTruthy();
  });

  it('truncates long tool results in debug log', async () => {
    mockCallDoctorLlm
      .mockResolvedValueOnce(
        makeLlmResponse({
          toolCalls: [
            { id: 'tc-long', function: { name: 'get_app_info', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(makeLlmResponse());

    const longResult = 'x'.repeat(3000);
    mockExecuteTool.mockResolvedValue(longResult);
    const runner = new DoctorAgentRunner(vi.fn());
    await runner.run(makePayload(), TASK_ID);

    const toolResultLog = mockAppendDebugLog.mock.calls.find((c: any[]) => c[0] === 'Tool Result: get_app_info');
    expect(toolResultLog[1]).toContain('...(truncated)');
  });
});

// ── all known tool step info messages ─────────────────────────────────────────

describe('DoctorAgentRunner – all known tool step info', () => {
  const knownTools = [
    ['get_app_info', 'Collecting runtime environment info...'],
    ['get_app_knowledge', 'Loading app knowledge base...'],
    ['read_app_logs', 'Querying application logs...'],
    ['read_chat_session', 'Fetching session skeleton...'],
    ['get_chat_messages', 'Reading conversation messages...'],
    ['get_crash_status', 'Checking for crash reports...'],
    ['read_crash_bundle', 'Reading crash bundle details...'],
    ['read_schedules', 'Inspecting scheduled jobs...'],
    ['ask_user_question', 'Waiting for your answer...'],
    ['create_github_issue', 'Generating diagnostic report...'],
  ];

  for (const [toolName, expectedMsg] of knownTools) {
    it(`pushes "${expectedMsg}" for ${toolName}`, async () => {
      mockCallDoctorLlm
        .mockResolvedValueOnce(
          makeLlmResponse({
            toolCalls: [{ id: `tc-${toolName}`, function: { name: toolName, arguments: '{}' } }],
          }),
        )
        .mockResolvedValueOnce(makeLlmResponse());

      if (toolName === 'create_github_issue') {
        mockExecuteTool.mockResolvedValue(JSON.stringify({ issueUrl: 'https://github.com/x/y/issues/1' }));
      } else {
        mockExecuteTool.mockResolvedValue('result');
      }

      const pushStepInfo = vi.fn();
      const runner = new DoctorAgentRunner(pushStepInfo);
      await runner.run(makePayload(), TASK_ID);
      expect(pushStepInfo).toHaveBeenCalledWith(expectedMsg);
    });
  }
});
