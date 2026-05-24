import { AgentChatOutputPort } from '../agentChatOutputPort';
import { ChatStatus } from '../agentChatTypes';

describe('AgentChatOutputPort', () => {
  it('emits status and events through the active sender', () => {
    const send = vi.fn();
    const port = new AgentChatOutputPort(
      () => 'chat-1',
      () => 'session-1',
      () => 'OpenKosmos',
    );

    port.setSender({ send, isDestroyed: vi.fn().mockReturnValue(false) } as any);
    port.emitStatus(ChatStatus.SENDING_RESPONSE);
    port.emitEvent('agentChat:test', { foo: 'bar' });

    expect(send).toHaveBeenNthCalledWith(1, 'agentChat:chatStatusChanged', expect.objectContaining({
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      chatStatus: ChatStatus.SENDING_RESPONSE,
      agentName: 'OpenKosmos',
    }));
    expect(send).toHaveBeenNthCalledWith(2, 'agentChat:test', expect.objectContaining({
      foo: 'bar',
      chatSessionId: 'session-1',
    }));
  });

  it('clears the sender and becomes a no-op afterwards', () => {
    const send = vi.fn();
    const port = new AgentChatOutputPort(
      () => 'chat-1',
      () => 'session-1',
      () => 'OpenKosmos',
    );

    port.setSender({ send, isDestroyed: vi.fn().mockReturnValue(false) } as any);
    port.clear();
    port.emitStreamingChunk({ type: 'text_delta' } as any);

    expect(send).not.toHaveBeenCalled();
  });
});