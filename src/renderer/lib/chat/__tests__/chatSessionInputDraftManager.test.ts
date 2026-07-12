import { ChatSessionInputDraftManager } from '../chatSessionInputDraftManager';

describe('ChatSessionInputDraftManager', () => {
  it('stores independent drafts by chatSessionId', () => {
    const manager = new ChatSessionInputDraftManager();

    manager.set('session-a', 'draft A');
    manager.set('session-b', 'draft B');

    expect(manager.get('session-a')).toBe('draft A');
    expect(manager.get('session-b')).toBe('draft B');
  });

  it('clears one session without affecting others', () => {
    const manager = new ChatSessionInputDraftManager();

    manager.set('session-a', 'draft A');
    manager.set('session-b', 'draft B');
    manager.clear('session-a');

    expect(manager.get('session-a')).toBe('');
    expect(manager.get('session-b')).toBe('draft B');
  });

  it('removes a draft when setting empty text', () => {
    const manager = new ChatSessionInputDraftManager();

    manager.set('session-a', 'draft A');
    manager.set('session-a', '');

    expect(manager.has('session-a')).toBe(false);
    expect(manager.get('session-a')).toBe('');
  });

  it('clears all drafts', () => {
    const manager = new ChatSessionInputDraftManager();

    manager.set('session-a', 'draft A');
    manager.set('session-b', 'draft B');
    manager.clearAll();

    expect(manager.get('session-a')).toBe('');
    expect(manager.get('session-b')).toBe('');
  });

  it('ignores missing chatSessionId values', () => {
    const manager = new ChatSessionInputDraftManager();

    manager.set(null, 'ignored');
    manager.set(undefined, 'ignored');

    expect(manager.get(null)).toBe('');
    expect(manager.get(undefined)).toBe('');
  });
});
