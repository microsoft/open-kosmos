// @ts-nocheck
/**
 * profileSanitizer.archivedChats.test.ts
 *
 * Full-branch coverage for sanitizeArchivedChats (the profile.archived_chats
 * SSOT cleaner) plus its wiring into sanitizeProfileV2 output (the conditional
 * `archived_chats` spread).
 */
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: '1.0.0',
}));

import { sanitizeArchivedChats, sanitizeProfileV2 } from '../profileSanitizer';
import type { ProfileV2 } from '../types/profile';

const prof = (archived?: unknown): ProfileV2 =>
  ({ archived_chats: archived } as unknown as ProfileV2);

describe('sanitizeArchivedChats', () => {
  it('returns [] when archived_chats is missing or not an array', () => {
    expect(sanitizeArchivedChats({} as ProfileV2)).toEqual([]);
    expect(sanitizeArchivedChats(prof('nope'))).toEqual([]);
    expect(sanitizeArchivedChats(prof(null))).toEqual([]);
  });

  it('skips null and non-object items', () => {
    expect(sanitizeArchivedChats(prof([null, 42, 'x', undefined]))).toEqual([]);
  });

  it('skips items with a missing, non-string, or blank chat_id', () => {
    expect(sanitizeArchivedChats(prof([
      { agent_ids: ['a'] },
      { chat_id: 123, agent_ids: ['a'] },
      { chat_id: '   ', agent_ids: ['a'] },
    ]))).toEqual([]);
  });

  it('trims chat_id and deduplicates by the trimmed value (first wins)', () => {
    const out = sanitizeArchivedChats(prof([
      { chat_id: '  c1  ', agent_ids: ['first'] },
      { chat_id: 'c1', agent_ids: ['second'] },
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].chat_id).toBe('c1');
    expect(out[0].agent_ids).toEqual(['first']);
  });

  it('filters blank/non-string agent_ids and skips entries left with none', () => {
    const out = sanitizeArchivedChats(prof([
      { chat_id: 'c1', agent_ids: ['', '  ', null, 5, 'keep'] },
      { chat_id: 'c2', agent_ids: ['', null] },
      { chat_id: 'c3', agent_ids: 'not-an-array' },
      { chat_id: 'c4' },
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].chat_id).toBe('c1');
    expect(out[0].agent_ids).toEqual(['keep']);
  });

  it('drops any inline agent object and unknown junk, keeping ids only', () => {
    const out = sanitizeArchivedChats(prof([
      { chat_id: 'c1', agent_ids: ['a'], agent: { name: 'X' }, junk: true },
    ]));
    expect(out[0]).toEqual({ chat_id: 'c1', chat_type: 'single_agent', agent_ids: ['a'] });
    expect((out[0] as { agent?: unknown }).agent).toBeUndefined();
  });

  it('strips workspace from archived chat entries', () => {
    const out = sanitizeArchivedChats(prof([
      { chat_id: 'c1', agent_ids: ['a'], workspace: '/chat-workspace' },
      { chat_id: 'c2', agent_ids: ['b'], workspace: 123 },
    ]));
    expect(out[0].workspace).toBeUndefined();
    expect(out[1].workspace).toBeUndefined();
  });

  it('normalizes chat_type: multi_agent kept, anything else => single_agent', () => {
    const out = sanitizeArchivedChats(prof([
      { chat_id: 'multi', chat_type: 'multi_agent', agent_ids: ['a'] },
      { chat_id: 'weird', chat_type: 'bogus', agent_ids: ['a'] },
      { chat_id: 'none', agent_ids: ['a'] },
    ]));
    expect(out.map((e) => e.chat_type)).toEqual(['multi_agent', 'single_agent', 'single_agent']);
  });

  it('includes archived_at only when it is a non-blank string', () => {
    const out = sanitizeArchivedChats(prof([
      { chat_id: 'with', archived_at: '2026-06-30T00:00:00Z', agent_ids: ['a'] },
      { chat_id: 'blank', archived_at: '   ', agent_ids: ['a'] },
      { chat_id: 'nonstr', archived_at: 123, agent_ids: ['a'] },
    ]));
    expect(out[0].archived_at).toBe('2026-06-30T00:00:00Z');
    expect(out[1].archived_at).toBeUndefined();
    expect(out[2].archived_at).toBeUndefined();
  });

  it('includes starred_sessions only when it is a non-empty array', () => {
    const stars = [{ chatSessionId: 's1', title: 't' }];
    const out = sanitizeArchivedChats(prof([
      { chat_id: 'with', agent_ids: ['a'], starred_sessions: stars },
      { chat_id: 'empty', agent_ids: ['a'], starred_sessions: [] },
      { chat_id: 'nonarr', agent_ids: ['a'], starred_sessions: 'x' },
    ]));
    expect(out[0].starred_sessions).toEqual(stars);
    expect(out[1].starred_sessions).toBeUndefined();
    expect(out[2].starred_sessions).toBeUndefined();
  });
});

describe('sanitizeProfileV2 archived_chats wiring', () => {
  it('omits archived_chats entirely when nothing valid survives', () => {
    const out = sanitizeProfileV2({ archived_chats: [{ chat_id: '', agent_ids: [] }] } as unknown as ProfileV2);
    expect('archived_chats' in out).toBe(false);
  });

  it('emits a cleaned archived_chats array when valid entries exist', () => {
    const out = sanitizeProfileV2({
      archived_chats: [{ chat_id: 'c1', chat_type: 'multi_agent', agent_ids: ['a', ''], agent: { name: 'X' } }],
    } as unknown as ProfileV2);
    expect(out.archived_chats).toEqual([
      { chat_id: 'c1', chat_type: 'multi_agent', agent_ids: ['a'] },
    ]);
  });
});
