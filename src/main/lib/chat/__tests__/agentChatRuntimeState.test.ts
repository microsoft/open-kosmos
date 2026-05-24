import { AgentChatRuntimeState } from '../agentChatRuntimeState';
import { ChatStatus } from '../agentChatTypes';

describe('AgentChatRuntimeState', () => {
  it('tracks mutable runtime state through explicit mutation methods', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);

    runtimeState.setChatStatus(ChatStatus.SENDING_RESPONSE);
    runtimeState.setPendingInteractiveRequest({ interactionId: 'int-1' } as any);
    runtimeState.setMessagesToSave([{ id: 'm1' }] as any);
    runtimeState.setActiveToolCancellationHandler(() => undefined);

    expect(runtimeState.chatStatus).toBe(ChatStatus.SENDING_RESPONSE);
    expect(runtimeState.pendingInteractiveRequest).toEqual(expect.objectContaining({ interactionId: 'int-1' }));
    expect(runtimeState.messagesToSave).toEqual([{ id: 'm1' }]);
    expect(typeof runtimeState.activeToolCancellationHandler).toBe('function');
  });

  it('clearCancellationToken only clears when nonce matches (stale turn guard)', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    const token1 = { isCancelled: () => false } as any;
    const token2 = { isCancelled: () => false } as any;

    // Turn 1 binds token and captures nonce
    runtimeState.bindCancellationToken(token1);
    const nonce1 = runtimeState.bumpToolExecutionNonce();
    expect(runtimeState.currentCancellationToken).toBe(token1);

    // Turn 2 starts (simulating cancel -> new message): binds new token, bumps nonce
    runtimeState.bindCancellationToken(token2);
    const nonce2 = runtimeState.bumpToolExecutionNonce();
    expect(runtimeState.currentCancellationToken).toBe(token2);
    expect(nonce2).not.toBe(nonce1);

    // Stale turn 1 reaches finally — nonce doesn't match, so should NOT clear
    if (nonce1 === runtimeState.toolExecutionNonce) {
      runtimeState.clearCancellationToken();
    }
    // Token2 must still be intact
    expect(runtimeState.currentCancellationToken).toBe(token2);

    // Active turn 2 reaches finally — nonce matches, clears normally
    if (nonce2 === runtimeState.toolExecutionNonce) {
      runtimeState.clearCancellationToken();
    }
    expect(runtimeState.currentCancellationToken).toBeUndefined();
  });

  it('preserves saveChain replacement and execution nonce increments', async () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    const saveChain = Promise.resolve({ success: true as const });

    runtimeState.setSaveChain(saveChain);

    expect(runtimeState.saveChain).toBe(saveChain);
    expect(runtimeState.bumpToolExecutionNonce()).toBe(1);
    expect(runtimeState.bumpToolExecutionNonce()).toBe(2);
  });

  it('setToolExecutionNonce directly sets the nonce to an arbitrary value', () => {
    const runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);

    runtimeState.setToolExecutionNonce(42);
    expect(runtimeState.toolExecutionNonce).toBe(42);

    // bumpToolExecutionNonce increments from the explicitly set value
    expect(runtimeState.bumpToolExecutionNonce()).toBe(43);
  });
});