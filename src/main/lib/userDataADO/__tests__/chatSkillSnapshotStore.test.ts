import { vi, describe, it, expect } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import { ChatSkillSnapshotStore, chatSkillSnapshotStore } from '../chatSkillSnapshotStore';
import type { ChatConfig, ChatSkillSnapshot } from '../types/profile';

function makeSnapshot(overrides: Partial<ChatSkillSnapshot> = {}): ChatSkillSnapshot {
  return {
    binding_signature: '["a"]',
    registry_signature: '[{"name":"a"}]',
    generated_at: '2026-03-24T00:00:00.000Z',
    skills: [],
    prompt: 'prompt',
    ...overrides,
  };
}

function makeChat(chatId: string, skills: string[] | undefined): ChatConfig {
  return {
    chat_id: chatId,
    chat_type: 'single_agent',
    agent: skills === undefined ? undefined : ({ skills } as ChatConfig['agent']),
  } as ChatConfig;
}

describe('ChatSkillSnapshotStore — singleton', () => {
  it('exposes a stable singleton', () => {
    expect(ChatSkillSnapshotStore.getInstance()).toBe(ChatSkillSnapshotStore.getInstance());
    expect(chatSkillSnapshotStore).toBe(ChatSkillSnapshotStore.getInstance());
  });
});

describe('ChatSkillSnapshotStore — get/set', () => {
  it('returns undefined for an unknown alias or chat', () => {
    const store = new ChatSkillSnapshotStore();
    expect(store.get('alice', 'c1')).toBeUndefined();
    store.set('alice', 'c1', makeSnapshot());
    expect(store.get('alice', 'unknown')).toBeUndefined();
    expect(store.get('bob', 'c1')).toBeUndefined();
  });

  it('caches and replaces a snapshot per chat', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot({ prompt: 'first' }));
    expect(store.get('alice', 'c1')!.prompt).toBe('first');
    store.set('alice', 'c1', makeSnapshot({ prompt: 'second' }));
    expect(store.get('alice', 'c1')!.prompt).toBe('second');
    // A second chat under the same alias reuses the existing inner map.
    store.set('alice', 'c2', makeSnapshot({ prompt: 'other' }));
    expect(store.get('alice', 'c2')!.prompt).toBe('other');
  });
});

describe('ChatSkillSnapshotStore — clear', () => {
  it('drops a single chat entry and is a no-op for an unknown alias', () => {
    const store = new ChatSkillSnapshotStore();
    store.clear('ghost', 'c1'); // no-op, alias absent
    store.set('alice', 'c1', makeSnapshot());
    store.set('alice', 'c2', makeSnapshot());

    store.clear('alice', 'c1');
    expect(store.get('alice', 'c1')).toBeUndefined();
    expect(store.get('alice', 'c2')).toBeDefined();
  });

  it('prunes the alias map once its last chat entry is cleared', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot());
    store.clear('alice', 'c1');
    // Re-adding works (alias map was pruned and is recreated).
    store.set('alice', 'c2', makeSnapshot());
    expect(store.get('alice', 'c2')).toBeDefined();
  });

  it('clearForAlias drops only the targeted alias', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot());
    store.set('bob', 'c1', makeSnapshot());
    store.clearForAlias('alice');
    expect(store.get('alice', 'c1')).toBeUndefined();
    expect(store.get('bob', 'c1')).toBeDefined();
  });

  it('clearAll drops every alias', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot());
    store.set('bob', 'c1', makeSnapshot());
    store.clearAll();
    expect(store.get('alice', 'c1')).toBeUndefined();
    expect(store.get('bob', 'c1')).toBeUndefined();
  });
});

describe('ChatSkillSnapshotStore.invalidateAffectedChats', () => {
  it('returns 0 when skillNames is empty or not an array', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot());
    expect(store.invalidateAffectedChats('alice', [makeChat('c1', ['a'])], [])).toBe(0);
    expect(store.invalidateAffectedChats('alice', [makeChat('c1', ['a'])], undefined as unknown as string[])).toBe(0);
    expect(store.get('alice', 'c1')).toBeDefined();
  });

  it('returns 0 when the alias has no cached snapshots', () => {
    const store = new ChatSkillSnapshotStore();
    expect(store.invalidateAffectedChats('nobody', [makeChat('c1', ['a'])], ['a'])).toBe(0);
  });

  it('clears only chats whose binding overlaps the changed skills', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot()); // binds ['a'] -> affected
    store.set('alice', 'c2', makeSnapshot()); // binds ['z'] -> unaffected
    const chats = [makeChat('c1', ['a']), makeChat('c2', ['z'])];

    const cleared = store.invalidateAffectedChats('alice', chats, ['a']);

    expect(cleared).toBe(1);
    expect(store.get('alice', 'c1')).toBeUndefined();
    expect(store.get('alice', 'c2')).toBeDefined();
  });

  it('skips chats with no agent skills, chats without a cached entry, and tolerates an undefined chat list', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot());
    const chats = [
      makeChat('c1', undefined), // no agent.skills -> skipped (kept)
      makeChat('c2', ['a']),     // overlaps but no cached entry -> skipped
    ];

    expect(store.invalidateAffectedChats('alice', chats, ['a'])).toBe(0);
    expect(store.get('alice', 'c1')).toBeDefined();
    // undefined chat list iterates over nothing without throwing.
    expect(store.invalidateAffectedChats('alice', undefined, ['a'])).toBe(0);
  });

  it('prunes the alias map when every cached chat is invalidated', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot());
    const cleared = store.invalidateAffectedChats('alice', [makeChat('c1', ['a'])], ['a']);
    expect(cleared).toBe(1);
    // Alias map pruned: re-adding recreates it cleanly.
    store.set('alice', 'c2', makeSnapshot());
    expect(store.get('alice', 'c2')).toBeDefined();
  });

  it('skips a chat whose binding does not overlap the changed skills', () => {
    const store = new ChatSkillSnapshotStore();
    store.set('alice', 'c1', makeSnapshot());
    expect(store.invalidateAffectedChats('alice', [makeChat('c1', ['other'])], ['a'])).toBe(0);
    expect(store.get('alice', 'c1')).toBeDefined();
  });
});
