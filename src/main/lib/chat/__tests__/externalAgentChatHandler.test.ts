vi.mock('../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../startup/lazy', async () => ({
  useExternalAgentService: vi.fn(),
}));

import { handleExternalAgentMessage, ExternalAgentChatContext } from '../externalAgentChatHandler';
import { useExternalAgentService } from '../../../startup/lazy';
import { Message } from '@shared/types/chatTypes';

const mockUseService = useExternalAgentService as ReturnType<typeof vi.fn>;

function createContext(overrides: Partial<ExternalAgentChatContext> = {}): ExternalAgentChatContext {
  return {
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    addMessageToSession: vi.fn(),
    emitStreamingChunk: vi.fn(),
    emitStatus: vi.fn(),
    ...overrides,
  };
}

function createUserMessage(text: string): Message {
  return {
    id: 'user-msg-1',
    role: 'user',
    timestamp: 1000,
    content: [{ type: 'text', text }],
  };
}

describe('handleExternalAgentMessage (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns system error when agent is not connected', async () => {
    mockUseService.mockImplementation((cb: Function) => cb({ sendMessage: () => false }));

    const ctx = createContext();
    const result = await handleExternalAgentMessage(ctx, createUserMessage('hello'));

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('system');
    expect(ctx.addMessageToSession).toHaveBeenCalledTimes(2); // user msg + error msg
    expect(ctx.emitStatus).toHaveBeenCalledWith('idle');
  });

  it('returns empty array on successful send (fire-and-forget)', async () => {
    mockUseService.mockImplementation((cb: Function) => cb({ sendMessage: () => true }));

    const ctx = createContext();
    const result = await handleExternalAgentMessage(ctx, createUserMessage('hi'));

    expect(result).toEqual([]);
    expect(ctx.addMessageToSession).toHaveBeenCalledTimes(1); // only user msg
    expect(ctx.emitStatus).toHaveBeenCalledWith('sending');
    // Does NOT emit idle — status stays as 'sending' until push arrives
    expect(ctx.emitStatus).toHaveBeenCalledTimes(1);
    // No streaming chunks emitted — bot reply arrives via push handler
    expect(ctx.emitStreamingChunk).not.toHaveBeenCalled();
  });

  it('persists user message before sending', async () => {
    mockUseService.mockImplementation((cb: Function) => cb({ sendMessage: () => true }));

    const ctx = createContext();
    const userMsg = createUserMessage('test');
    await handleExternalAgentMessage(ctx, userMsg);

    expect(ctx.addMessageToSession).toHaveBeenCalledWith(userMsg);
  });

  it('can resend an already-persisted user message without duplicating it', async () => {
    mockUseService.mockImplementation((cb: Function) => cb({ sendMessage: () => true }));

    const ctx = createContext();
    const userMsg = createUserMessage('retry');
    const result = await handleExternalAgentMessage(ctx, userMsg, { persistUserMessage: false });

    expect(result).toEqual([]);
    expect(ctx.addMessageToSession).not.toHaveBeenCalled();
    expect(ctx.emitStatus).toHaveBeenCalledWith('sending');
  });

  it('sends only text parts to the external agent service', async () => {
    const sendMessage = vi.fn(() => true);
    mockUseService.mockImplementation((cb: Function) => cb({ sendMessage }));

    const ctx = createContext();
    await handleExternalAgentMessage(ctx, {
      ...createUserMessage('ignored'),
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'image', image_url: { url: 'data:image/png;base64,abc' } },
        { type: 'text', text: 'world' },
      ],
    } as Message);

    expect(sendMessage).toHaveBeenCalledWith('hello world', 'chat-1', 'session-1');
  });

  it('emits content and complete chunks for error message', async () => {
    mockUseService.mockImplementation((cb: Function) => cb({ sendMessage: () => false }));

    const ctx = createContext();
    await handleExternalAgentMessage(ctx, createUserMessage('hi'));

    const chunks = (ctx.emitStreamingChunk as ReturnType<typeof vi.fn>).mock.calls.map((c: any) => c[0]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe('content');
    expect(chunks[1].type).toBe('complete');
  });

  it('does not emit idle on successful send (status managed by push handler)', async () => {
    mockUseService.mockImplementation((cb: Function) => cb({ sendMessage: () => true }));

    const ctx = createContext();
    await handleExternalAgentMessage(ctx, createUserMessage('hi'));

    const statusCalls = (ctx.emitStatus as ReturnType<typeof vi.fn>).mock.calls.map((c: any) => c[0]);
    expect(statusCalls).toEqual(['sending']);
  });
});
