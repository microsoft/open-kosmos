import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrateMemexMemoryToAgentStore } from '../memexMemoryMigration';
import { getAgentMemoryDir } from '../agentStoreManager';
import { ProfileV2 } from '../types/profile';

function profileWith(chats: unknown[]): ProfileV2 {
  return { chats } as ProfileV2;
}

describe('migrateMemexMemoryToAgentStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmemex-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedLegacy(chatId: string, file: string, body: string) {
    const legacyCards = path.join(dir, 'memex_memory', chatId, 'cards');
    fs.mkdirSync(legacyCards, { recursive: true });
    fs.writeFileSync(path.join(legacyCards, file), body);
  }

  it('moves legacy chat memory into agents/{primaryAgentId}/memory and removes the empty root', () => {
    seedLegacy('chat-1', 'note.md', 'remember this');
    fs.writeFileSync(path.join(dir, 'memex_memory', 'chat-1', '.DS_Store'), 'metadata');

    const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]));

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(getAgentMemoryDir(dir, 'agent-kobi-on-device'), 'cards', 'note.md'), 'utf-8')).toBe('remember this');
    expect(fs.existsSync(path.join(getAgentMemoryDir(dir, 'agent-kobi-on-device'), '.DS_Store'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-1'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'memex_memory'))).toBe(false);
  });

  it('migrates multi-agent legacy chat memory only to the primary agent', () => {
    seedLegacy('chat-multi', 'shared.md', 'old chat memory');

    const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{
      chat_id: 'chat-multi',
      chat_type: 'multi_agent',
      agent_ids: ['agent-alpha-on-device', 'agent-beta-on-device'],
    }]));

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(getAgentMemoryDir(dir, 'agent-alpha-on-device'), 'cards', 'shared.md'), 'utf-8')).toBe('old chat memory');
    expect(fs.existsSync(path.join(getAgentMemoryDir(dir, 'agent-beta-on-device'), 'cards', 'shared.md'))).toBe(false);
  });

  it('keeps target files on conflict and moves the legacy source with a chat-id suffix', () => {
    seedLegacy('chat-1', 'note.md', 'old');
    const targetCards = path.join(getAgentMemoryDir(dir, 'agent-kobi-on-device'), 'cards');
    fs.mkdirSync(targetCards, { recursive: true });
    fs.writeFileSync(path.join(targetCards, 'note.md'), 'new');

    const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]));

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(targetCards, 'note.md'), 'utf-8')).toBe('new');
    expect(fs.readFileSync(path.join(targetCards, 'note-chat-1.md'), 'utf-8')).toBe('old');
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-1'))).toBe(false);
  });

  it('migrates multiple legacy chats that share the same primary agent without hiding conflicts', () => {
    seedLegacy('chat-one', 'decision.md', 'first');
    seedLegacy('chat-two', 'decision.md', 'second');
    const moved = migrateMemexMemoryToAgentStore(dir, profileWith([
      { chat_id: 'chat-one', agent_ids: ['agent-shared-on-device'] },
      { chat_id: 'chat-two', agent_ids: ['agent-shared-on-device'] },
    ]));

    const targetCards = path.join(getAgentMemoryDir(dir, 'agent-shared-on-device'), 'cards');
    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(targetCards, 'decision.md'), 'utf-8')).toBe('first');
    expect(fs.readFileSync(path.join(targetCards, 'decision-chat-two.md'), 'utf-8')).toBe('second');
    expect(fs.existsSync(path.join(dir, 'memex_memory'))).toBe(false);
  });

  it('migrates only chats whose primary agent id is durable in the supplied profile snapshot', () => {
    seedLegacy('chat-durable', 'keep.md', 'durable');
    seedLegacy('chat-transient', 'keep.md', 'transient');
    seedLegacy('chat-missing-durable', 'keep.md', 'missing');

    const moved = migrateMemexMemoryToAgentStore(
      dir,
      profileWith([
        { chat_id: 'chat-durable', agent_ids: ['agent-durable-on-device'] },
        { chat_id: 'chat-transient', agent_ids: ['agent-new-on-device'] },
        { chat_id: 'chat-missing-durable', agent_ids: ['agent-missing-on-device'] },
        { agent_ids: ['agent-no-chat-on-device'] },
      ]),
      profileWith([
        { chat_id: 'chat-durable', agent_ids: ['agent-durable-on-device'] },
        { chat_id: 'chat-transient', agent_ids: ['agent-old-on-device'] },
        { chat_id: 'chat-no-agent', agent_ids: [] },
        { chat_id: 42, agent_ids: ['agent-invalid-chat-on-device'] },
      ]),
    );

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(getAgentMemoryDir(dir, 'agent-durable-on-device'), 'cards', 'keep.md'), 'utf-8')).toBe('durable');
    expect(fs.existsSync(path.join(getAgentMemoryDir(dir, 'agent-new-on-device'), 'cards', 'keep.md'))).toBe(false);
    expect(fs.existsSync(path.join(getAgentMemoryDir(dir, 'agent-missing-on-device'), 'cards', 'keep.md'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'memex_memory', 'chat-transient', 'cards', 'keep.md'), 'utf-8')).toBe('transient');
    expect(fs.readFileSync(path.join(dir, 'memex_memory', 'chat-missing-durable', 'cards', 'keep.md'), 'utf-8')).toBe('missing');
  });

  it('suffixes an incrementing index when the chat-id conflict slug also exists', () => {
    seedLegacy('chat-1', 'note.md', 'legacy');
    const targetCards = path.join(getAgentMemoryDir(dir, 'agent-kobi-on-device'), 'cards');
    fs.mkdirSync(targetCards, { recursive: true });
    fs.writeFileSync(path.join(targetCards, 'note.md'), 'winner');
    fs.writeFileSync(path.join(targetCards, 'note-chat-1.md'), 'already taken');

    const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]));

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(targetCards, 'note.md'), 'utf-8')).toBe('winner');
    expect(fs.readFileSync(path.join(targetCards, 'note-chat-1.md'), 'utf-8')).toBe('already taken');
    expect(fs.readFileSync(path.join(targetCards, 'note-chat-1-2.md'), 'utf-8')).toBe('legacy');
  });

  it('removes empty legacy dirs and skips missing, unbound, and unsafe entries', () => {
    fs.mkdirSync(path.join(dir, 'memex_memory', 'chat-empty'), { recursive: true });
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-empty', agent_ids: ['agent-empty-on-device'] }]))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-empty'))).toBe(false);

    expect(migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-missing', agent_ids: ['agent-missing-on-device'] }]))).toBe(false);
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-no-agent' }]))).toBe(false);
    seedLegacy('chat-safe', 'x.md', 'x');
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-safe', agent_ids: ['../evil'] }]))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'evil'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-safe', 'cards', 'x.md'))).toBe(true);
  });

  it('prunes metadata-only legacy memex dirs without deleting orphan card data', () => {
    fs.mkdirSync(path.join(dir, 'memex_memory', 'chat-metadata-only', 'cards'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'memex_memory', '.DS_Store'), 'root metadata');
    fs.writeFileSync(path.join(dir, 'memex_memory', 'chat-metadata-only', '.DS_Store'), 'chat metadata');
    fs.mkdirSync(path.join(dir, 'memex_memory', 'chat-orphan', 'cards'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'memex_memory', 'chat-orphan', 'cards', 'keep.md'), 'orphan memory');

    expect(migrateMemexMemoryToAgentStore(dir, profileWith([]))).toBe(true);

    expect(fs.existsSync(path.join(dir, 'memex_memory', '.DS_Store'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-metadata-only'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'memex_memory', 'chat-orphan', 'cards', 'keep.md'), 'utf-8')).toBe('orphan memory');
  });

  it('returns false and preserves legacy cards when the target memory dir cannot be created', () => {
    seedLegacy('chat-err', 'note.md', 'keep me');
    // Place a FILE where agents/{agentId} should be a directory, so the recursive
    // mkdir of agents/{agentId}/memory throws and the migration hits its catch.
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agents', 'agent-err-on-device'), 'not a dir');

    const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-err', agent_ids: ['agent-err-on-device'] }]));

    expect(moved).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'memex_memory', 'chat-err', 'cards', 'note.md'), 'utf-8')).toBe('keep me');
  });

  it('renames a legacy directory under a suffix when the target entry is a file', () => {
    seedLegacy('chat-dirfile', 'note.md', 'legacy note');
    const memDir = getAgentMemoryDir(dir, 'agent-dirfile-on-device');
    fs.mkdirSync(memDir, { recursive: true });
    // Target has `cards` as a FILE while the legacy source has `cards` as a dir.
    fs.writeFileSync(path.join(memDir, 'cards'), 'i am a file, not a dir');

    const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-dirfile', agent_ids: ['agent-dirfile-on-device'] }]));

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(memDir, 'cards'), 'utf-8')).toBe('i am a file, not a dir');
    expect(fs.readFileSync(path.join(memDir, 'cards-chat-dirfile', 'note.md'), 'utf-8')).toBe('legacy note');
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-dirfile'))).toBe(false);
  });

  it('refuses a legacy chat dir containing a symlink and never follows it into the store', () => {
    // External directory outside the profile-managed memory tree.
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmemex-external-'));
    fs.writeFileSync(path.join(external, 'secret.md'), 'external secret');
    fs.writeFileSync(path.join(external, '.DS_Store'), 'external metadata');
    try {
      fs.mkdirSync(path.join(dir, 'memex_memory', 'chat-link'), { recursive: true });
      fs.symlinkSync(external, path.join(dir, 'memex_memory', 'chat-link', 'cards'));

      const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-link', agent_ids: ['agent-link-on-device'] }]));

      expect(moved).toBe(false);
      // The symlink is left in place, never relocated into agents/{agentId}/memory.
      expect(fs.existsSync(path.join(getAgentMemoryDir(dir, 'agent-link-on-device'), 'cards'))).toBe(false);
      expect(fs.lstatSync(path.join(dir, 'memex_memory', 'chat-link', 'cards')).isSymbolicLink()).toBe(true);
      // The external target and its files are untouched (never followed or pruned).
      expect(fs.readFileSync(path.join(external, 'secret.md'), 'utf-8')).toBe('external secret');
      expect(fs.existsSync(path.join(external, '.DS_Store'))).toBe(true);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it('refuses a legacy chat dir with a symlink nested below the top level', () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmemex-external-'));
    try {
      const cards = path.join(dir, 'memex_memory', 'chat-nested', 'cards');
      fs.mkdirSync(cards, { recursive: true });
      fs.writeFileSync(path.join(cards, 'real.md'), 'real card');
      fs.symlinkSync(external, path.join(cards, 'escape'));

      const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-nested', agent_ids: ['agent-nested-on-device'] }]));

      expect(moved).toBe(false);
      // Nothing migrates: even the sibling real card is left in place.
      expect(fs.existsSync(getAgentMemoryDir(dir, 'agent-nested-on-device'))).toBe(false);
      expect(fs.readFileSync(path.join(cards, 'real.md'), 'utf-8')).toBe('real card');
      expect(fs.lstatSync(path.join(cards, 'escape')).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it('refuses a legacy chat dir that is itself a symlink', () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmemex-external-'));
    fs.mkdirSync(path.join(external, 'cards'), { recursive: true });
    fs.writeFileSync(path.join(external, 'cards', 'x.md'), 'ext');
    try {
      fs.mkdirSync(path.join(dir, 'memex_memory'), { recursive: true });
      fs.symlinkSync(external, path.join(dir, 'memex_memory', 'chat-symdir'));

      const moved = migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-symdir', agent_ids: ['agent-symdir-on-device'] }]));

      expect(moved).toBe(false);
      expect(fs.existsSync(getAgentMemoryDir(dir, 'agent-symdir-on-device'))).toBe(false);
      expect(fs.readFileSync(path.join(external, 'cards', 'x.md'), 'utf-8')).toBe('ext');
      expect(fs.lstatSync(path.join(dir, 'memex_memory', 'chat-symdir')).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it('refuses to prune when memex_memory itself is a symlink', () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmemex-external-'));
    fs.writeFileSync(path.join(external, 'keep.md'), 'external');
    try {
      fs.symlinkSync(external, path.join(dir, 'memex_memory'));

      expect(migrateMemexMemoryToAgentStore(dir, profileWith([]))).toBe(false);
      // The root symlink is never followed, so external content is untouched.
      expect(fs.readFileSync(path.join(external, 'keep.md'), 'utf-8')).toBe('external');
      expect(fs.lstatSync(path.join(dir, 'memex_memory')).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it('skips a dangling symlink under memex_memory without following or deleting it', () => {
    fs.mkdirSync(path.join(dir, 'memex_memory'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'no-such-target'), path.join(dir, 'memex_memory', 'dangling'));

    // A dangling symlink is lstat-visible: it must be skipped (never followed),
    // leaving both it and the root in place with no change reported.
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([]))).toBe(false);
    expect(fs.lstatSync(path.join(dir, 'memex_memory', 'dangling')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(dir, 'memex_memory'))).toBe(true);
  });

  it('swallows a prune I/O failure as non-fatal', () => {
    // A directory with no read permission makes readdirSync throw EACCES inside
    // prune; the migration must swallow it (non-fatal) and leave the root intact.
    // Skipped where the permission cannot be enforced (Windows, or running as
    // root, which bypasses the mode bits) so the test never yields a false red.
    if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
      return;
    }
    const locked = path.join(dir, 'memex_memory', 'locked');
    fs.mkdirSync(path.join(locked, 'child'), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      expect(migrateMemexMemoryToAgentStore(dir, profileWith([]))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'memex_memory'))).toBe(true);
    } finally {
      // Restore permissions so afterEach cleanup can remove the tree.
      fs.chmodSync(locked, 0o755);
    }
  });

  it('skips chats with unsafe chat ids or missing chat ids', () => {
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: '../evil-chat', agent_ids: ['agent-ok-on-device'] }]))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'evil-chat'))).toBe(false);
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([{ agent_ids: ['agent-ok-on-device'] }]))).toBe(false);
  });

  it('ignores non-directory memex_memory roots and legacy entries', () => {
    // memex_memory itself is a file: pruning must treat it as nothing to do.
    fs.writeFileSync(path.join(dir, 'memex_memory'), 'not a dir');
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([]))).toBe(false);
    fs.rmSync(path.join(dir, 'memex_memory'), { force: true });

    // A legacy chat entry that is a file (not a dir) is left untouched.
    fs.mkdirSync(path.join(dir, 'memex_memory'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'memex_memory', 'chat-file'), 'not a dir');
    expect(migrateMemexMemoryToAgentStore(dir, profileWith([{ chat_id: 'chat-file', agent_ids: ['agent-x-on-device'] }]))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'memex_memory', 'chat-file'), 'utf-8')).toBe('not a dir');
  });

  it('returns false when the profile has no chats array', () => {
    expect(migrateMemexMemoryToAgentStore(dir, {} as ProfileV2)).toBe(false);
  });
});
