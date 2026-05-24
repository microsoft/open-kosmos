// @ts-nocheck
import type { ChoiceInteractionRequest } from '@shared/types/interactiveRequestTypes';
import { InteractiveRequestManager } from '../interactiveRequestManager';

function makeChoiceRequest(overrides: Partial<ChoiceInteractionRequest> = {}): ChoiceInteractionRequest {
  return {
    interactionId: 'choice-1',
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    requestType: 'choice',
    status: 'pending',
    title: 'Choose one',
    createdAt: Date.now(),
    mode: 'single',
    options: [{ value: 'a', label: 'A' }],
    ...overrides,
  };
}

describe('InteractiveRequestManager', () => {
  // ── interruptSession ────────────────────────────────────────────────────────

  it('interrupts a pending request when the chat is cancelled', async () => {
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest();

    const pending = manager.createPendingRequest(request);

    expect(manager.interruptSession('session-1')).toBe(true);

    await expect(pending).resolves.toEqual({
      interactionId: 'choice-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'skip',
      resolutionSource: 'chat-cancelled',
    });
    expect(manager.getPendingRequest('session-1')).toBeNull();
  });

  it('interrupts a pending approval request when the chat is cancelled', async () => {
    const manager = new InteractiveRequestManager();
    const pending = manager.createPendingRequest({
      interactionId: 'approval-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      createdAt: Date.now(),
      items: [{ itemId: 'item-1', toolName: 'read_file', message: 'Needs review', paths: [{ path: '/tmp/demo.txt' }] }],
    });

    expect(manager.interruptSession('session-1')).toBe(true);

    await expect(pending).resolves.toEqual({
      interactionId: 'approval-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      action: 'skip',
      resolutionSource: 'chat-cancelled',
    });
  });

  it('returns false when interruptSession is called with no pending request', () => {
    const manager = new InteractiveRequestManager();
    expect(manager.interruptSession('non-existent-session')).toBe(false);
  });

  // ── resolveRequest ──────────────────────────────────────────────────────────

  it('resolves a pending request with the provided response', async () => {
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest();
    const pending = manager.createPendingRequest(request);

    const resolved = manager.resolveRequest({
      interactionId: 'choice-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'confirm',
      resolutionSource: 'user',
      selectedValues: ['a'],
    });

    expect(resolved).toBe(true);
    await expect(pending).resolves.toEqual(expect.objectContaining({ action: 'confirm', selectedValues: ['a'] }));
  });

  it('returns false when resolveRequest is called with no pending request for that session', () => {
    const manager = new InteractiveRequestManager();
    const resolved = manager.resolveRequest({
      interactionId: 'choice-1',
      chatSessionId: 'no-session',
      requestType: 'choice',
      action: 'confirm',
      resolutionSource: 'user',
      selectedValues: [],
    });
    expect(resolved).toBe(false);
  });

  it('returns false when the interactionId does not match', async () => {
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest({ interactionId: 'choice-A' });
    manager.createPendingRequest(request);

    const resolved = manager.resolveRequest({
      interactionId: 'choice-WRONG',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'confirm',
      resolutionSource: 'user',
      selectedValues: [],
    });

    expect(resolved).toBe(false);
    // The request should still be pending
    expect(manager.getPendingRequest('session-1')).not.toBeNull();
  });

  // ── createPendingRequest — duplicate / timeout ──────────────────────────────

  it('throws when a pending request already exists for the session', async () => {
    const manager = new InteractiveRequestManager();
    manager.createPendingRequest(makeChoiceRequest());

    await expect(manager.createPendingRequest(makeChoiceRequest())).rejects.toThrow(
      'Pending interactive request already exists for session session-1',
    );

    // Clean up
    manager.interruptSession('session-1');
  });

  it('resolves immediately with expire when expiresAt is in the past', async () => {
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest({ expiresAt: Date.now() - 1000 });

    const result = await manager.createPendingRequest(request);

    expect(result).toEqual(expect.objectContaining({
      action: 'expire',
      resolutionSource: 'timeout',
    }));
  });

  it('resolves with expire after the timeout fires', async () => {
    vi.useFakeTimers();
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest({ expiresAt: Date.now() + 200 });

    const pending = manager.createPendingRequest(request);

    vi.advanceTimersByTime(300);

    await expect(pending).resolves.toEqual(expect.objectContaining({
      action: 'expire',
      resolutionSource: 'timeout',
    }));
    vi.useRealTimers();
  });

  // ── getPendingRequest ───────────────────────────────────────────────────────

  it('returns null for a session with no pending request', () => {
    const manager = new InteractiveRequestManager();
    expect(manager.getPendingRequest('no-such-session')).toBeNull();
  });

  it('returns the pending request for an active session', async () => {
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest();
    manager.createPendingRequest(request);

    expect(manager.getPendingRequest('session-1')).toEqual(request);

    manager.interruptSession('session-1');
  });

  // ── clearSession ────────────────────────────────────────────────────────────

  it('clears a pending request without resolving it', () => {
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest();
    manager.createPendingRequest(request); // intentionally not awaited

    manager.clearSession('session-1');

    expect(manager.getPendingRequest('session-1')).toBeNull();
  });

  it('does nothing when clearSession is called with no pending request', () => {
    const manager = new InteractiveRequestManager();
    // Should not throw
    expect(() => manager.clearSession('ghost-session')).not.toThrow();
  });

  it('clears the timeout when clearSession is called on a timed request', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const manager = new InteractiveRequestManager();
    const request = makeChoiceRequest({ expiresAt: Date.now() + 5000 });
    manager.createPendingRequest(request);

    manager.clearSession('session-1');

    expect(clearTimeoutSpy).toHaveBeenCalled();
    vi.useRealTimers();
    clearTimeoutSpy.mockRestore();
  });
});