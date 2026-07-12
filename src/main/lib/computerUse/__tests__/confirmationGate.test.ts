import { describe, expect, it } from 'vitest';
import {
  buildComputerUseConfirmationFingerprint,
  buildComputerUseConfirmationRequest,
  ComputerUseConfirmationStore,
  getComputerUseConfirmationIdFromMetadata,
} from '../confirmationGate';

describe('Computer Use confirmation gate helpers', () => {
  it('builds stable fingerprints while ignoring retry-only confirmation fields', () => {
    const first = buildComputerUseConfirmationFingerprint({
      action: 'click',
      x: 1,
      y: 2,
      text: undefined,
      confirmed: true,
      confirmationId: 'id-a',
    });
    const second = buildComputerUseConfirmationFingerprint({
      y: 2,
      x: 1,
      action: 'click',
      confirmationId: 'id-b',
      text: undefined,
    });

    expect(first).toBe(second);
  });

  it('extracts Computer Use confirmation ids only from object metadata', () => {
    expect(getComputerUseConfirmationIdFromMetadata({ computerUseConfirmationId: ' cu-1 ' })).toBe('cu-1');
    expect(getComputerUseConfirmationIdFromMetadata({ computerUseConfirmationId: '  ' })).toBeNull();
    expect(getComputerUseConfirmationIdFromMetadata(null)).toBeNull();
    expect(getComputerUseConfirmationIdFromMetadata(['cu-1'])).toBeNull();
  });

  it('requires pending approval before a matching confirmation can be consumed', () => {
    const store = new ComputerUseConfirmationStore();
    const id = store.createPending('session-1', 'fp-1', 1000);

    expect(store.hasPending(id, 'session-1', 'fp-1', 1000)).toBe(true);
    expect(store.consumeApproved(id, 'session-1', 'fp-1', 1000)).toBe(false);
    expect(store.approve(id, 'other-session', 1000)).toBe(false);
    expect(store.approve(id, 'session-1', 1000)).toBe(true);
    expect(store.consumeApproved(id, 'session-1', 'other-fp', 1000)).toBe(false);
    expect(store.consumeApproved(id, 'session-1', 'fp-1', 1000)).toBe(true);
    expect(store.consumeApproved(id, 'session-1', 'fp-1', 1000)).toBe(false);
  });

  it('builds a locked approval request for a pending desktop action', () => {
    const request = buildComputerUseConfirmationRequest('cu-1', { action: 'type_text', text: 'hello' });

    expect(request).toMatchObject({
      title: 'Approve Computer Use action',
      source: 'system',
      submitLabel: 'Approve',
      skipLabel: 'Cancel',
      metadata: { computerUseConfirmationId: 'cu-1' },
      schema: {
        kind: 'choice',
        mode: 'single',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { value: 'approve', label: 'Approve this exact action' },
          { value: 'cancel', label: 'Cancel' },
        ],
      },
    });
    expect(request.description).toContain('Type text: &quot;hello&quot;.');
  });

  it('HTML-escapes model-provided action values in approval descriptions', () => {
    const textRequest = buildComputerUseConfirmationRequest('cu-1', {
      action: 'type_text',
      text: '<img src=x onerror=alert(1)>',
    });
    const keyRequest = buildComputerUseConfirmationRequest('cu-2', {
      action: 'press_key',
      key: '<script>alert(1)</script>',
    });
    const hotkeyRequest = buildComputerUseConfirmationRequest('cu-3', {
      action: 'hotkey',
      keys: ['ctrl', '<img src=x onerror=alert(1)>'],
    });

    expect(textRequest.description).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(textRequest.description).not.toContain('<img');
    expect(keyRequest.description).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(keyRequest.description).not.toContain('<script>');
    expect(hotkeyRequest.description).toContain('ctrl+&lt;img src=x onerror=alert(1)&gt;');
    expect(hotkeyRequest.description).not.toContain('<img');
  });

  it('approves only when the submitted request exactly matches the trusted request', () => {
    const store = new ComputerUseConfirmationStore();
    let trusted = buildComputerUseConfirmationRequest('placeholder', { action: 'click', x: 1, y: 2 });
    const id = store.createPendingWithRequest('session-1', 'fp-1', (confirmationId) => {
      trusted = buildComputerUseConfirmationRequest(confirmationId, { action: 'click', x: 1, y: 2 });
      return trusted;
    }, 1000);

    expect(store.approveTrustedRequest(id, 'session-1', { ...trusted, title: 'Approve setup' }, 1000)).toBe(false);
    expect(store.consumeApproved(id, 'session-1', 'fp-1', 1000)).toBe(false);
    expect(store.approveTrustedRequest(id, 'session-1', trusted, 1000)).toBe(true);
    expect(store.consumeApproved(id, 'session-1', 'fp-1', 1000)).toBe(true);
  });

  it('expires stale pending confirmations', () => {
    const store = new ComputerUseConfirmationStore();
    const id = store.createPending('session-1', 'fp-1', 1000);

    expect(store.hasPending(id, 'session-1', 'fp-1', 1000 + 10 * 60 * 1000 + 1)).toBe(false);
    expect(store.approve(id, 'session-1', 1000 + 10 * 60 * 1000 + 1)).toBe(false);
  });

  it('clears all records', () => {
    const store = new ComputerUseConfirmationStore();
    const id = store.createPending(undefined, 'fp-1', 1000);

    store.clear();

    expect(store.hasPending(id, undefined, 'fp-1', 1000)).toBe(false);
  });
});
