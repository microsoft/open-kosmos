import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractAgentsToStore, hydrateChatsFromStore, syncChatAgentsToStore, pruneStaleStoreAgents, persistNewChatAgents, seedNewProfileAgents, ensureInlineAgentIds, stripInlineChatAgentsForDisk, migrateKnowledgeToAgentStore, consolidateWorkspaceDirsToChatId, legacyWorkspaceDirNames, ensureChatAgentIds, runAgentStoreMigrations, migrateArchivedAgentsToStore, repointCrossAgentKnowledge, syncInlineChatAgentsToStore } from '../agentExtraction';
import { getAgentMemoryDir, readAgent, readIndex, writeAgent, getRegistryAgentsByIds } from '../agentStoreManager';
import * as agentStoreManager from '../agentStoreManager';
import { ProfileV2 } from '../types/profile';

function agent(name: string, source: 'ON-DEVICE' | 'IN-LIBRARY' = 'ON-DEVICE', id?: string) {
  return { name, model: 'm', source, mcp_servers: [], ...(id ? { id } : {}) } as never;
}

function profileWith(chats: unknown[]): ProfileV2 {
  return { chats } as ProfileV2;
}

describe('extractAgentsToStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentextract-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes single-agent chat into store + active index', async () => {
    const n = await extractAgentsToStore(dir, profileWith([{ chat_id: 'c', agent: agent('Kobi') }]));
    expect(n).toBe(1);
    expect(readAgent(dir, 'agent-kobi-on-device')?.id).toBe('agent-kobi-on-device');
    expect(readIndex(dir).map((i) => i.id)).toEqual(['agent-kobi-on-device']);
  });

  it('writes multi-agent chat agents', async () => {
    const n = await extractAgentsToStore(dir, profileWith([
      { chat_id: 'c', agents: [agent('Alpha'), agent('Beta', 'IN-LIBRARY')] },
    ]));
    expect(n).toBe(2);
    expect(readIndex(dir).map((i) => i.id).sort()).toEqual([
      'agent-alpha-on-device',
      'agent-beta-in-library',
    ]);
  });

  it('is idempotent — second run writes nothing', async () => {
    await extractAgentsToStore(dir, profileWith([{ chat_id: 'c', agent: agent('Kobi') }]));
    const n = await extractAgentsToStore(dir, profileWith([{ chat_id: 'c', agent: agent('Kobi') }]));
    expect(n).toBe(0);
  });

  it('dedupes the same agent referenced by two chats in one pass', async () => {
    const n = await extractAgentsToStore(dir, profileWith([
      { chat_id: 'a', agent: agent('Kobi') },
      { chat_id: 'b', agent: agent('Kobi') },
    ]));
    expect(n).toBe(1);
  });

  it('skips nameless agents and tolerates missing/empty chats', async () => {
    expect(await extractAgentsToStore(dir, profileWith([{ chat_id: 'x' }]))).toBe(0);
    expect(await extractAgentsToStore(dir, profileWith([{ chat_id: 'y', agent: { source: 'ON-DEVICE' } }]))).toBe(0);
    expect(await extractAgentsToStore(dir, {} as ProfileV2)).toBe(0);
  });

  it('returns 0 when persistence fails (profileDir is a file)', async () => {
    const fileDir = path.join(dir, 'not-a-dir');
    fs.writeFileSync(fileDir, 'x');
    const n = await extractAgentsToStore(fileDir, profileWith([{ chat_id: 'c', agent: agent('Kobi') }]));
    expect(n).toBe(0);
  });
});

describe('hydrateChatsFromStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthydrate-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rebuilds single inline agent from store via agent_ids', async () => {
    await extractAgentsToStore(dir, profileWith([{ chat_id: 'c', agent: agent('Kobi') }]));
    const p = profileWith([{ chat_id: 'c', agent_ids: ['agent-kobi-on-device'] }]);
    expect(hydrateChatsFromStore(dir, p)).toBe(true);
    expect(p.chats[0].agent?.name).toBe('Kobi');
  });

  it('rebuilds multiple agents into chat.agents', async () => {
    await extractAgentsToStore(dir, profileWith([{ chat_id: 'c', agents: [agent('A'), agent('B', 'IN-LIBRARY')] }]));
    const p = profileWith([{ chat_id: 'c', agent_ids: ['agent-a-on-device', 'agent-b-in-library'] }]);
    expect(hydrateChatsFromStore(dir, p)).toBe(true);
    expect(p.chats[0].agents?.map((a) => a.name)).toEqual(['A', 'B']);
  });

  it('skips chats with no ids, existing inline, or unresolved ids', async () => {
    expect(hydrateChatsFromStore(dir, profileWith([{ chat_id: 'a' }]))).toBe(false);
    expect(hydrateChatsFromStore(dir, profileWith([{ chat_id: 'b', agent_ids: ['x'], agent: agent('Keep') }]))).toBe(false);
    expect(hydrateChatsFromStore(dir, profileWith([{ chat_id: 'c', agent_ids: ['missing'] }]))).toBe(false);
    expect(hydrateChatsFromStore(dir, profileWith([{ chat_id: 'd', agent_ids: ['x'], agents: [agent('Keep')] }]))).toBe(false);
    expect(hydrateChatsFromStore(dir, {} as ProfileV2)).toBe(false);
  });
});

describe('syncChatAgentsToStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsync-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes inline single agent and stamps agent_ids', async () => {
    const chat: { agent?: unknown; agents?: unknown[]; agent_ids?: string[] } = { agent: agent('Kobi') } as never;
    const ids = await syncChatAgentsToStore(dir, chat as never);
    expect(ids).toEqual(['agent-kobi-on-device']);
    expect(chat.agent_ids).toEqual(['agent-kobi-on-device']);
    expect(readAgent(dir, 'agent-kobi-on-device')?.name).toBe('Kobi');
  });

  it('keeps the stable id on rename (no re-key, no prune)', async () => {
    await syncChatAgentsToStore(dir, { agent: agent('Kobi'), agent_ids: [] } as never);
    // Legacy inline agent with no carried id: anchored to the existing binding by
    // position, so a rename reuses the same id instead of deriving a new one.
    const chat = { agent: agent('Robi'), agent_ids: ['agent-kobi-on-device'] };
    const ids = await syncChatAgentsToStore(dir, chat as never);
    expect(ids).toEqual(['agent-kobi-on-device']);
    expect(chat.agent_ids).toEqual(['agent-kobi-on-device']);
    // Same id, content updated to the new name; no second id minted, none pruned.
    expect(readAgent(dir, 'agent-kobi-on-device')?.name).toBe('Robi');
    expect(readAgent(dir, 'agent-robi-on-device')).toBeNull();
  });

  it('matches legacy multi-agent ids by stored metadata before position fallback', async () => {
    await syncChatAgentsToStore(dir, {
      agents: [agent('Alpha'), agent('Beta')],
      agent_ids: [],
    } as never);
    const chat = {
      agents: [agent('Beta'), agent('Alpha')],
      agent_ids: ['agent-alpha-on-device', 'agent-beta-on-device'],
    };

    const ids = await syncChatAgentsToStore(dir, chat as never);

    expect(ids).toEqual(['agent-beta-on-device', 'agent-alpha-on-device']);
    expect(chat.agent_ids).toEqual(['agent-beta-on-device', 'agent-alpha-on-device']);
    expect(readAgent(dir, 'agent-alpha-on-device')?.name).toBe('Alpha');
    expect(readAgent(dir, 'agent-beta-on-device')?.name).toBe('Beta');
  });

  it('prunes a store entry when an agent is genuinely swapped (id changes)', async () => {
    await syncChatAgentsToStore(dir, { agent: agent('Kobi', 'ON-DEVICE', 'agent-old'), agent_ids: [] } as never);
    expect(readAgent(dir, 'agent-old')?.name).toBe('Kobi');
    const chat = { agent: agent('Nova', 'ON-DEVICE', 'agent-new'), agent_ids: ['agent-old'] };
    const ids = await syncChatAgentsToStore(dir, chat as never);
    expect(ids).toEqual(['agent-new']);
    expect(readAgent(dir, 'agent-old')).toBeNull();
    expect(readAgent(dir, 'agent-new')?.name).toBe('Nova');
  });

  it('prefers multi-agent array and dedupes ids', async () => {
    const ids = await syncChatAgentsToStore(dir, {
      agents: [agent('Alpha'), agent('Alpha')], agent_ids: [],
    } as never);
    expect(ids).toEqual(['agent-alpha-on-device']);
  });

  it('skips nameless agents and clears ids when none', async () => {
    const chat = { agent: { source: 'ON-DEVICE' } as never, agent_ids: [] };
    const ids = await syncChatAgentsToStore(dir, chat as never);
    expect(ids).toEqual([]);
    expect(chat.agent_ids).toEqual([]);
  });

  it('returns empty for a chat with no inline agents (no agent/agents)', async () => {
    const chat = { agent_ids: ['agent-x-on-device'] };
    const ids = await syncChatAgentsToStore(dir, chat as never);
    expect(ids).toEqual([]);
    expect(chat.agent_ids).toEqual([]);
  });

  it('swallows a broken store (write failure) and preserves the existing binding', async () => {
    const fileDir = path.join(dir, 'f');
    fs.writeFileSync(fileDir, 'x');
    // The store dir is a plain file, so writeAgent throws (swallowed) and the new id
    // is never durably persisted. The durability gate therefore ABORTS the rebind:
    // no throw, the stale agent is NOT deleted, and agent_ids is NOT re-stamped to the
    // never-written id (binding a chat to a missing agent would be data loss).
    const chat = { agent: agent('Kobi', 'ON-DEVICE', 'agent-new-id'), agent_ids: ['agent-old-on-device'] };
    const ids = await syncChatAgentsToStore(fileDir, chat as never);
    expect(ids).toEqual(['agent-old-on-device']);
    expect(chat.agent_ids).toEqual(['agent-old-on-device']);
  });

  it('swallows a deleteAgent failure on a DURABLE swap and still re-stamps agent_ids', async () => {
    // Complements the write-failure case: here the replacement IS durably written
    // (real writeAgent into the temp dir), so the durability gate passes and the
    // stale-prune runs — but deleteAgent throws for the removed id. That failure must
    // be swallowed (best-effort) and the rebind must still complete.
    const spy = vi.spyOn(agentStoreManager, 'deleteAgent').mockRejectedValue(new Error('boom'));
    try {
      const chat = { agent: agent('New', 'ON-DEVICE', 'agent-new-id'), agent_ids: ['agent-old-id'] };
      const ids = await syncChatAgentsToStore(dir, chat as never);
      expect(spy).toHaveBeenCalledWith(dir, 'agent-old-id');
      expect(ids).toEqual(['agent-new-id']);
      expect(chat.agent_ids).toEqual(['agent-new-id']);
    } finally {
      spy.mockRestore();
    }
  });

  it('does NOT prune a dropped id that another chat still references (shared agent)', async () => {
    // Seed a chat bound to two agents, then edit it down to just agent-a. agent-b
    // is referenced by another chat, so it must survive the write-through.
    await syncChatAgentsToStore(dir, {
      agents: [agent('A', 'ON-DEVICE', 'agent-a'), agent('B', 'ON-DEVICE', 'agent-b')], agent_ids: [],
    } as never);
    const chat = { agent: agent('A', 'ON-DEVICE', 'agent-a'), agent_ids: ['agent-a', 'agent-b'] };
    const ids = await syncChatAgentsToStore(dir, chat as never, new Set(['agent-b']));
    expect(ids).toEqual(['agent-a']);
    expect(readAgent(dir, 'agent-a')?.name).toBe('A');
    // Shared agent preserved — its store entry (and knowledge) is not destroyed.
    expect(readAgent(dir, 'agent-b')).not.toBeNull();
  });

  it('DOES prune a dropped id when no other chat references it (control)', async () => {
    await syncChatAgentsToStore(dir, {
      agents: [agent('A', 'ON-DEVICE', 'agent-a'), agent('B', 'ON-DEVICE', 'agent-b')], agent_ids: [],
    } as never);
    const chat = { agent: agent('A', 'ON-DEVICE', 'agent-a'), agent_ids: ['agent-a', 'agent-b'] };
    // No referenced-elsewhere set: agent-b is genuinely orphaned and gets pruned.
    const ids = await syncChatAgentsToStore(dir, chat as never);
    expect(ids).toEqual(['agent-a']);
    expect(readAgent(dir, 'agent-b')).toBeNull();
  });

  it('DEFERS the destructive prune to a staleSink instead of deleting inline', async () => {
    await syncChatAgentsToStore(dir, {
      agents: [agent('A', 'ON-DEVICE', 'agent-a'), agent('B', 'ON-DEVICE', 'agent-b')], agent_ids: [],
    } as never);
    const chat = { agent: agent('A', 'ON-DEVICE', 'agent-a'), agent_ids: ['agent-a', 'agent-b'] };
    const staleSink: string[] = [];
    const ids = await syncChatAgentsToStore(dir, chat as never, undefined, staleSink);
    // Rebind still completes (agent_ids re-stamped), but agent-b is NOT deleted yet —
    // the caller owns an uncommitted profile write and must prune only once it is durable.
    expect(ids).toEqual(['agent-a']);
    expect(chat.agent_ids).toEqual(['agent-a']);
    expect(staleSink).toEqual(['agent-b']);
    expect(readAgent(dir, 'agent-b')).not.toBeNull();
    // Draining the sink performs the deferred delete.
    await pruneStaleStoreAgents(dir, staleSink);
    expect(readAgent(dir, 'agent-b')).toBeNull();
  });

  it('pushes nothing to the staleSink on an aborted (non-durable) rebind', async () => {
    const fileDir = path.join(dir, 'f2');
    fs.writeFileSync(fileDir, 'x');
    const staleSink: string[] = [];
    const chat = { agent: agent('New', 'ON-DEVICE', 'agent-new'), agent_ids: ['agent-old'] };
    const ids = await syncChatAgentsToStore(fileDir, chat as never, undefined, staleSink);
    // The store write failed, so the rebind aborts before computing stale ids: the
    // sink stays empty and the existing binding is preserved.
    expect(ids).toEqual(['agent-old']);
    expect(staleSink).toEqual([]);
  });

  it('surfaces a same-id write failure via the writeFailedSink that readAgent cannot detect', async () => {
    // Seed a durable agent (old content on disk).
    await syncChatAgentsToStore(dir, { agent: agent('Kobi', 'ON-DEVICE', 'agent-x'), agent_ids: [] } as never);
    expect(readAgent(dir, 'agent-x')?.name).toBe('Kobi');
    // Now edit the SAME id, but force the store write to throw. The previous
    // agent.json survives (atomic write), so readAgent still returns the STALE 'Kobi'
    // and the durability gate cannot see the failure — only writeFailedSink surfaces
    // it, which is exactly what a CRUD caller needs to fail the edit instead of
    // stripping the inline copy.
    const spy = vi.spyOn(agentStoreManager, 'writeAgent').mockRejectedValue(new Error('disk full'));
    try {
      const failed: string[] = [];
      const chat = { agent: agent('Robi', 'ON-DEVICE', 'agent-x'), agent_ids: ['agent-x'] };
      const ids = await syncChatAgentsToStore(dir, chat as never, undefined, undefined, failed);
      expect(failed).toEqual(['agent-x']);
      // Rebind aborts: binding preserved and the old content is untouched.
      expect(ids).toEqual(['agent-x']);
      expect(readAgent(dir, 'agent-x')?.name).toBe('Kobi');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('seedNewProfileAgents', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseed-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists each chat inline agent into the store and stamps agent_ids', async () => {
    const chatA = { chat_id: 'a', agent: agent('Kobi', 'ON-DEVICE', 'agent_seed_kobi') };
    const chatB = { chat_id: 'b', agent: agent('Nova', 'IN-LIBRARY', 'agent_seed_nova') };
    const profile = profileWith([chatA, chatB]);

    await seedNewProfileAgents(dir, profile);

    expect((chatA as any).agent_ids).toEqual(['agent_seed_kobi']);
    expect((chatB as any).agent_ids).toEqual(['agent_seed_nova']);
    expect(readAgent(dir, 'agent_seed_kobi')?.name).toBe('Kobi');
    expect(readAgent(dir, 'agent_seed_nova')?.name).toBe('Nova');
    expect(readIndex(dir).map((i) => i.id).sort()).toEqual(['agent_seed_kobi', 'agent_seed_nova']);
  });

  it('mints ids for inline agents that lack one', async () => {
    const chat = { chat_id: 'a', agent: agent('Kobi') };
    await seedNewProfileAgents(dir, profileWith([chat]));
    const ids = (chat as any).agent_ids as string[];
    expect(ids).toHaveLength(1);
    expect(readAgent(dir, ids[0])?.name).toBe('Kobi');
  });

  it('tolerates a profile with no chats', async () => {
    await expect(seedNewProfileAgents(dir, { } as ProfileV2)).resolves.toBeUndefined();
    expect(readIndex(dir)).toEqual([]);
  });

  it('surfaces a failed store write via the writeFailedSink so first-run creation can abort', async () => {
    // Point the store at a FILE so writeAgent throws for the default chat's agent.
    const fileDir = path.join(dir, 'f');
    fs.writeFileSync(fileDir, 'x');
    const chat = { chat_id: 'a', agent: agent('Kobi', 'ON-DEVICE', 'agent_seed_kobi') };
    const failed: string[] = [];
    await seedNewProfileAgents(fileDir, profileWith([chat]), failed);
    expect(failed).toEqual(['agent_seed_kobi']);
  });
});

describe('ensureInlineAgentIds', () => {
  it('mints a UUID for a single inline agent that has no id', () => {
    const chat: { agent?: { id?: string; name: string } } = { agent: agent('Kobi') } as never;
    ensureInlineAgentIds(chat as never);
    expect(chat.agent?.id).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
  });

  it('is idempotent: leaves an already-carried id untouched', () => {
    const chat = { agent: agent('Kobi', 'ON-DEVICE', 'agent_kept') } as never;
    ensureInlineAgentIds(chat);
    expect((chat as { agent: { id?: string } }).agent.id).toBe('agent_kept');
  });

  it('mints only for array entries that lack an id, keeping the rest', () => {
    const withId = agent('A', 'ON-DEVICE', 'agent_a') as { id?: string };
    const noId = agent('B') as { id?: string };
    ensureInlineAgentIds({ agents: [withId, noId] } as never);
    expect(withId.id).toBe('agent_a');
    expect(noId.id).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
  });

  it('mints when the carried id is an empty string', () => {
    const a = agent('Kobi') as { id?: string };
    a.id = '';
    ensureInlineAgentIds({ agent: a } as never);
    expect(a.id).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
  });

  it('is a no-op for a chat with no inline agents', () => {
    expect(() => ensureInlineAgentIds({ agent_ids: ['x'] } as never)).not.toThrow();
  });
});

describe('persistNewChatAgents', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentnew-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a new chat inline agent into the store and stamps agent_ids', async () => {
    const chat: { agent?: unknown; agent_ids?: string[] } = { agent: agent('Kobi', 'ON-DEVICE', 'agent_fixed_kobi') } as never;
    const ids = await persistNewChatAgents(dir, chat as never);
    expect(ids).toEqual(['agent_fixed_kobi']);
    expect(chat.agent_ids).toEqual(['agent_fixed_kobi']);
    expect(readAgent(dir, 'agent_fixed_kobi')?.name).toBe('Kobi');
    expect(readIndex(dir).map((i) => i.id)).toEqual(['agent_fixed_kobi']);
    expect(fs.existsSync(path.join(dir, 'agents', 'agent_fixed_kobi', 'knowledge'))).toBe(true);
  });

  it('mints a stable UUID for a new inline agent that has no id', async () => {
    const chat: { agent?: { id?: string; name: string }; agent_ids?: string[] } = { agent: agent('Kobi') } as never;
    const ids = await persistNewChatAgents(dir, chat as never);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
    // The minted id is written back onto the inline agent and used as the store key.
    expect(chat.agent?.id).toBe(ids[0]);
    expect(readAgent(dir, ids[0])?.name).toBe('Kobi');
  });

  it('lets inline agents win over stale caller-supplied agent_ids', async () => {
    const chat = { agent: agent('Kobi', 'ON-DEVICE', 'agent_fixed_kobi'), agent_ids: ['stale-id'] };
    const ids = await persistNewChatAgents(dir, chat as never);
    expect(ids).toEqual(['agent_fixed_kobi']);
    expect(chat.agent_ids).toEqual(['agent_fixed_kobi']);
  });

  it('prefers the multi-agent array and dedupes ids', async () => {
    const ids = await persistNewChatAgents(dir, {
      agents: [agent('Alpha', 'ON-DEVICE', 'agent_x'), agent('Alpha', 'ON-DEVICE', 'agent_x')], agent_ids: [],
    } as never);
    expect(ids).toEqual(['agent_x']);
  });

  it('preserves caller-supplied agent_ids without deleting shared store entries when no inline', async () => {
    // Pre-existing shared agent referenced by id only.
    await writeAgent(dir, { name: 'Shared', model: 'm', source: 'ON-DEVICE', mcp_servers: [], id: 'agent-shared-on-device' } as never);
    const chat = { agent_ids: ['agent-shared-on-device'] };
    const ids = await persistNewChatAgents(dir, chat as never);
    expect(ids).toEqual(['agent-shared-on-device']);
    expect(chat.agent_ids).toEqual(['agent-shared-on-device']);
    // Never prunes: the shared agent must survive.
    expect(readAgent(dir, 'agent-shared-on-device')?.name).toBe('Shared');
  });

  it('returns [] for a chat with neither inline agents nor agent_ids', async () => {
    expect(await persistNewChatAgents(dir, {} as never)).toEqual([]);
  });

  it('skips nameless inline agents, leaving agent_ids untouched', async () => {
    const chat = { agent: { source: 'ON-DEVICE' } as never };
    const ids = await persistNewChatAgents(dir, chat as never);
    expect(ids).toEqual([]);
    expect((chat as { agent_ids?: string[] }).agent_ids).toBeUndefined();
  });

  it('swallows a write failure but still stamps the id', async () => {
    const fileDir = path.join(dir, 'f');
    fs.writeFileSync(fileDir, 'x');
    const chat = { agent: agent('Kobi', 'ON-DEVICE', 'agent_fixed_kobi') };
    const ids = await persistNewChatAgents(fileDir, chat as never);
    expect(ids).toEqual(['agent_fixed_kobi']);
    expect((chat as { agent_ids?: string[] }).agent_ids).toEqual(['agent_fixed_kobi']);
  });

  it('surfaces a failed store write via the writeFailedSink so the create path can abort', async () => {
    // Force writeAgent to throw by pointing the store at a path that is a FILE.
    const fileDir = path.join(dir, 'f');
    fs.writeFileSync(fileDir, 'x');
    const chat = { agent: agent('Kobi', 'ON-DEVICE', 'agent_fixed_kobi') };
    const failed: string[] = [];
    const ids = await persistNewChatAgents(fileDir, chat as never, failed);
    // The id is still stamped in-memory, but the sink surfaces the failure so the
    // caller bails before writeProfileToFile strips the (now unbacked) inline agent.
    expect(ids).toEqual(['agent_fixed_kobi']);
    expect(failed).toEqual(['agent_fixed_kobi']);
  });

  it('enables the disk inline-strip once the chat is persisted', async () => {
    const chat = { chat_id: 'c', agent: agent('Kobi', 'ON-DEVICE', 'agent_fixed_kobi') };
    await persistNewChatAgents(dir, chat as never);
    const out = stripInlineChatAgentsForDisk(dir, profileWith([
      { chat_id: 'c', agent_ids: chat['agent_ids' as keyof typeof chat], agent: agent('Kobi', 'ON-DEVICE', 'agent_fixed_kobi') },
    ]));
    expect(out.chats[0].agent).toBeUndefined();
    expect(out.chats[0].agent_ids).toEqual(['agent_fixed_kobi']);
  });
});

describe('stripInlineChatAgentsForDisk', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstrip-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('strips inline agent/agents when every id is persisted, keeping agent_ids', async () => {
    await syncChatAgentsToStore(dir, { agent: agent('Kobi'), agent_ids: [] } as never);
    const out = stripInlineChatAgentsForDisk(dir, profileWith([
      { chat_id: 'c', agent_ids: ['agent-kobi-on-device'], agent: agent('Kobi') },
    ]));
    expect(out.chats[0].agent).toBeUndefined();
    expect(out.chats[0].agents).toBeUndefined();
    expect(out.chats[0].agent_ids).toEqual(['agent-kobi-on-device']);
  });

  it('keeps inline when an id is missing from store or none', () => {
    const out = stripInlineChatAgentsForDisk(dir, profileWith([
      { chat_id: 'a', agent_ids: ['agent-missing-on-device'], agent: agent('M') },
      { chat_id: 'b', agent: agent('N') },
    ]));
    expect(out.chats[0].agent).toBeDefined();
    expect(out.chats[1].agent).toBeDefined();
  });

  it('does not mutate input and tolerates missing chats', () => {
    const p = profileWith([{ chat_id: 'a', agent_ids: ['agent-missing-on-device'], agent: agent('M') }]);
    const out = stripInlineChatAgentsForDisk(dir, p);
    expect(p.chats[0].agent).toBeDefined();
    expect(stripInlineChatAgentsForDisk(dir, {} as ProfileV2).chats).toEqual([]);
    expect(out.chats.length).toBe(1);
  });
});

describe('migrateKnowledgeToAgentStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentknow-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedLegacy(id: string, file: string, body: string) {
    const legacy = path.join(dir, 'chat_workspaces', id, 'knowledge');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, file), body);
  }

  it('moves legacy knowledge into agents/{id}/knowledge and removes empty legacy dir', async () => {
    seedLegacy('agent-kobi-on-device', 'a.md', 'hi');
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'c', agent_ids: ['agent-kobi-on-device'] }]));
    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'agents', 'agent-kobi-on-device', 'knowledge', 'a.md'), 'utf-8')).toBe('hi');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'agent-kobi-on-device', 'knowledge'))).toBe(false);
  });

  it('keeps multi-agent legacy knowledge with each owning agent', async () => {
    seedLegacy('agent-alpha-on-device', 'alpha.md', 'alpha-body');
    seedLegacy('agent-beta-on-device', 'beta.md', 'beta-body');
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{
      chat_id: 'chat-multi',
      chat_type: 'multi_agent',
      agent_ids: ['agent-alpha-on-device', 'agent-beta-on-device'],
      agents: [agent('Alpha'), agent('Beta')],
    }]));

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'agents', 'agent-alpha-on-device', 'knowledge', 'alpha.md'), 'utf-8')).toBe('alpha-body');
    expect(fs.readFileSync(path.join(dir, 'agents', 'agent-beta-on-device', 'knowledge', 'beta.md'), 'utf-8')).toBe('beta-body');
    expect(fs.existsSync(path.join(dir, 'agents', 'agent-alpha-on-device', 'knowledge', 'beta.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'agents', 'agent-beta-on-device', 'knowledge', 'alpha.md'))).toBe(false);
  });

  it('is idempotent and skips files already present at target', async () => {
    seedLegacy('agent-k-on-device', 'a.md', 'old');
    const target = path.join(dir, 'agents', 'agent-k-on-device', 'knowledge');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'a.md'), 'new');
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'c', agent_ids: ['agent-k-on-device'] }]));
    expect(moved).toBe(false);
    expect(fs.readFileSync(path.join(target, 'a.md'), 'utf-8')).toBe('new');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'agent-k-on-device', 'knowledge'))).toBe(true);
  });

  it('removes empty legacy knowledge dirs but skips missing dirs and chats without ids', async () => {
    fs.mkdirSync(path.join(dir, 'chat_workspaces', 'agent-empty-on-device', 'knowledge'), { recursive: true });
    expect(await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'c', agent_ids: ['agent-empty-on-device'] }]))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'agent-empty-on-device'))).toBe(false);
    expect(await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'd', agent_ids: ['agent-missing-on-device'] }]))).toBe(false);
    expect(await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'e' }]))).toBe(false);
    expect(await migrateKnowledgeToAgentStore(dir, {} as ProfileV2)).toBe(false);
  });

  it('moves into io error when target dir cannot be created', async () => {
    seedLegacy('agent-z-on-device', 'a.md', 'hi');
    fs.mkdirSync(path.join(dir, 'agents', 'agent-z-on-device'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agents', 'agent-z-on-device', 'knowledge'), 'blocker');
    expect(await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'c', agent_ids: ['agent-z-on-device'] }]))).toBe(false);
  });

  it('skips when legacy knowledge path is a file (not a dir) and swallows io errors', async () => {
    fs.mkdirSync(path.join(dir, 'chat_workspaces', 'agent-x-on-device'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat_workspaces', 'agent-x-on-device', 'knowledge'), 'iamfile');
    expect(await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'c', agent_ids: ['agent-x-on-device'] }]))).toBe(false);
  });

  it('migrates knowledge stored under the chat_id dir to agents/{primaryId}', async () => {
    const legacy = path.join(dir, 'chat_workspaces', 'chat-1', 'knowledge');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'b.md'), 'body');
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]));
    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'agents', 'agent-kobi-on-device', 'knowledge', 'b.md'), 'utf-8')).toBe('body');
  });

  it('skips a chat whose primary agent_id is an unsafe path-traversal id', async () => {
    // A malformed agent_ids entry must not reach getAgentKnowledgeDir (which
    // would throw and abort the whole migration) nor let mkdir escape agents/.
    seedLegacy('chat-evil', 'a.md', 'hi');
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-evil', agent_ids: ['../victim'] }]));
    expect(moved).toBe(false);
    // agents/{'../victim'} would resolve to {dir}/victim — the guard prevents it.
    expect(fs.existsSync(path.join(dir, 'victim'))).toBe(false);
    // Migration did not abort: the legacy knowledge is left in place for a retry.
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'chat-evil', 'knowledge', 'a.md'))).toBe(true);
  });

  it('skips an unsafe SOURCE workspace dir so knowledge migration cannot escape chat_workspaces', async () => {
    // A corrupt agent_ids entry BEYOND the primary (e.g. ['agent-safe-on-device',
    // '../evil']) is still collected as a knowledge SOURCE via legacyWorkspaceDirNames.
    // Its name must never be joined + renameSync + rmdirSync'd below: chat_workspaces/
    // ../evil/knowledge resolves OUTSIDE chat_workspaces, so without the per-source
    // guard migration would pull an external dir's files into the store and delete it.
    // The primary id stays safe so the source loop is actually reached.
    const external = path.join(dir, 'evil', 'knowledge'); // == chat_workspaces/../evil/knowledge
    fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(path.join(external, 'secret.md'), 'do-not-touch');

    const moved = await migrateKnowledgeToAgentStore(
      dir,
      profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-safe-on-device', '../evil'] }]),
    );

    expect(moved).toBe(false);
    // The external file is untouched — neither moved into the store nor deleted.
    expect(fs.readFileSync(path.join(external, 'secret.md'), 'utf-8')).toBe('do-not-touch');
    expect(fs.existsSync(path.join(dir, 'agents', 'agent-safe-on-device', 'knowledge', 'secret.md'))).toBe(false);
    expect(fs.existsSync(external)).toBe(true);
  });

  it('migrates knowledge for an inline chat with no agent_ids (first-run scenario)', async () => {
    // First-run inline profile: chat.agent set, agent_ids absent. The primary
    // id must be derived from the inline name, else no knowledge migrates.
    const legacy = path.join(dir, 'chat_workspaces', 'chat-kobi', 'knowledge');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'k.md'), 'inline-body');
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-kobi', agent: agent('Kobi') }]));
    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'agents', 'agent-kobi-on-device', 'knowledge', 'k.md'), 'utf-8')).toBe('inline-body');
  });

  it('does not steal a dir referenced only by a cross-agent knowledgeBase', async () => {
    // MS Agency (active) references the archived M365 agent's knowledge via its
    // knowledgeBase. migrateKnowledgeToAgentStore must NOT fold M365's dir into
    // MS Agency: knowledgeBase is a reference, not a workspace-ownership signal.
    const m365Know = path.join(dir, 'chat_workspaces', 'agent-m365-on-device', 'knowledge');
    fs.mkdirSync(m365Know, { recursive: true });
    fs.writeFileSync(path.join(m365Know, 'doc.md'), 'kb');
    const chat = { chat_id: 'chat-1', agent: { name: 'MS Agency', source: 'ON-DEVICE', knowledge: { knowledgeBase: m365Know } } };
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([chat as never]));
    expect(moved).toBe(false);
    // M365's knowledge stays put; MS Agency does not gain a knowledge dir here.
    expect(fs.readFileSync(path.join(m365Know, 'doc.md'), 'utf-8')).toBe('kb');
    expect(fs.existsSync(path.join(dir, 'agents', 'agent-ms-agency-on-device', 'knowledge', 'doc.md'))).toBe(false);
    // The cross-agent reference is left untouched by this pass.
    expect((chat.agent.knowledge as { knowledgeBase: string }).knowledgeBase).toBe(m365Know);
  });

  it('repoints inline knowledge path inside profile but leaves custom external path', async () => {
    seedLegacy('agent-kobi-on-device', 'a.md', 'hi');
    const inProfile = { chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'], agent: { name: 'Kobi', knowledge: { knowledgeBase: path.join(dir, 'chat_workspaces', 'chat-1', 'knowledge') } } };
    await migrateKnowledgeToAgentStore(dir, profileWith([inProfile as never]));
    expect(inProfile.agent.knowledge.knowledgeBase).toBe(path.join(dir, 'agents', 'agent-kobi-on-device', 'knowledge'));
    const custom = { chat_id: 'chat-2', agent_ids: ['agent-x-on-device'], agent: { name: 'X', knowledge: { knowledgeBase: '/Users/me/Docs/kb' } } };
    await migrateKnowledgeToAgentStore(dir, profileWith([custom as never]));
    expect(custom.agent.knowledge.knowledgeBase).toBe('/Users/me/Docs/kb');
  });

  it('repoints the store agent.json knowledgeBase into its own dir when it lived inside the profile', async () => {
    // extractAgentsToStore writes agent.json with the legacy in-profile path;
    // the migration must rewrite the store SSOT, not only the inline facade.
    await writeAgent(dir, { id: 'agent-kobi-on-device', name: 'Kobi', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: path.join(dir, 'chat_workspaces', 'chat-1', 'knowledge') } } as never);
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]));
    expect(moved).toBe(true);
    expect(readAgent(dir, 'agent-kobi-on-device')?.knowledge?.knowledgeBase).toBe(path.join(dir, 'agents', 'agent-kobi-on-device', 'knowledge'));
  });

  it('leaves the store agent.json knowledgeBase untouched when it points outside the profile', async () => {
    await writeAgent(dir, { id: 'agent-ext-on-device', name: 'Ext', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: '/Users/me/custom/kb' } } as never);
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-ext', agent_ids: ['agent-ext-on-device'] }]));
    expect(moved).toBe(false);
    expect(readAgent(dir, 'agent-ext-on-device')?.knowledge?.knowledgeBase).toBe('/Users/me/custom/kb');
  });

  it('skips store repoint when the store agent has no knowledge block', async () => {
    await writeAgent(dir, { id: 'agent-nok-on-device', name: 'NoK', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } as never);
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-nok', agent_ids: ['agent-nok-on-device'] }]));
    expect(moved).toBe(false);
    expect(readAgent(dir, 'agent-nok-on-device')?.knowledge).toBeUndefined();
  });

  it('skips store repoint when the store knowledgeBase is undefined', async () => {
    await writeAgent(dir, { id: 'agent-und-on-device', name: 'Und', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: {} } as never);
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-und', agent_ids: ['agent-und-on-device'] }]));
    expect(moved).toBe(false);
    expect(readAgent(dir, 'agent-und-on-device')?.knowledge?.knowledgeBase).toBeUndefined();
  });

  it('swallows errors when the store agent cannot be rewritten', async () => {
    // agent.json on disk lacks an id, so writeAgent throws; the repoint must
    // catch it and keep the migration non-fatal.
    const agentDir = path.join(dir, 'agents', 'agent-noid-on-device');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({ name: 'NoId', source: 'ON-DEVICE', knowledge: { knowledgeBase: path.join(dir, 'chat_workspaces', 'chat-1', 'knowledge') } })
    );
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-noid-on-device'] }]));
    expect(moved).toBe(false);
  });

  it('keeps the agent in the index when repointing its knowledgeBase', async () => {
    // The repoint must preserve index membership: an agent whose knowledgeBase
    // is rewritten must remain registered in the single index.json.
    await writeAgent(
      dir,
      { id: 'agent-arch-on-device', name: 'Arch', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: path.join(dir, 'chat_workspaces', 'chat-1', 'knowledge') } } as never
    );
    const moved = await migrateKnowledgeToAgentStore(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-arch-on-device'] }]));
    expect(moved).toBe(true);
    expect(readAgent(dir, 'agent-arch-on-device')?.knowledge?.knowledgeBase).toBe(path.join(dir, 'agents', 'agent-arch-on-device', 'knowledge'));
    expect(readIndex(dir).map((i) => i.id)).toContain('agent-arch-on-device');
  });
});

describe('runAgentStoreMigrations', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmig-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('extracts inline agents, heals missing agent_ids, and refreshes the registry', async () => {
    const profile = profileWith([{ chat_id: 'chat-1', agent: agent('Kobi') }]);
    const healed = await runAgentStoreMigrations(dir, profile);
    expect(healed).toBe(true);
    expect((profile.chats[0] as { agent_ids?: string[] }).agent_ids).toEqual(['agent-kobi-on-device']);
    expect(readAgent(dir, 'agent-kobi-on-device')?.id).toBe('agent-kobi-on-device');
    expect(getRegistryAgentsByIds(dir, ['agent-kobi-on-device']).map((a) => a.id)).toEqual(['agent-kobi-on-device']);
  });

  it('migrates active legacy Memex memory during the load-time migration pass', async () => {
    const legacyCards = path.join(dir, 'memex_memory', 'chat-1', 'cards');
    fs.mkdirSync(legacyCards, { recursive: true });
    fs.writeFileSync(path.join(legacyCards, 'note.md'), 'memory');
    const profile = profileWith([{ chat_id: 'chat-1', agent: agent('Kobi') }]);

    const changed = await runAgentStoreMigrations(dir, profile);

    expect(changed).toBe(true);
    expect(fs.readFileSync(path.join(getAgentMemoryDir(dir, 'agent-kobi-on-device'), 'cards', 'note.md'), 'utf-8')).toBe('memory');
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-1'))).toBe(false);
  });

  it('defers active Memex migration until the active ids are durable', async () => {
    const legacyCards = path.join(dir, 'memex_memory', 'chat-1', 'cards');
    fs.mkdirSync(legacyCards, { recursive: true });
    fs.writeFileSync(path.join(legacyCards, 'note.md'), 'memory');
    const transientAgentId = 'agent_20260704101010_abcdefghi';
    const diskProfile = profileWith([{ chat_id: 'chat-1', agent: agent('Kobi') }]);
    const loadedProfile = profileWith([{ chat_id: 'chat-1', agent: agent('Kobi', 'ON-DEVICE', transientAgentId), agent_ids: [transientAgentId] }]);

    await runAgentStoreMigrations(dir, loadedProfile, diskProfile);
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-1', 'cards', 'note.md'))).toBe(true);
    expect(fs.existsSync(path.join(getAgentMemoryDir(dir, transientAgentId), 'cards', 'note.md'))).toBe(false);

    await runAgentStoreMigrations(dir, loadedProfile, loadedProfile);
    expect(fs.readFileSync(path.join(getAgentMemoryDir(dir, transientAgentId), 'cards', 'note.md'), 'utf-8')).toBe('memory');
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-1'))).toBe(false);
  });

  it('migrates archived legacy Memex memory during the load-time migration pass', async () => {
    const legacyCards = path.join(dir, 'memex_memory', 'chat-archived', 'cards');
    fs.mkdirSync(legacyCards, { recursive: true });
    fs.writeFileSync(path.join(legacyCards, 'archive-note.md'), 'archived memory');
    const profile = profileWith([]);
    profile.archived_chats = [{ chat_id: 'chat-archived', chat_type: 'single_agent', agent_ids: ['agent-archived-on-device'] }];

    const changed = await runAgentStoreMigrations(dir, profile);

    expect(changed).toBe(true);
    expect(fs.readFileSync(path.join(getAgentMemoryDir(dir, 'agent-archived-on-device'), 'cards', 'archive-note.md'), 'utf-8')).toBe('archived memory');
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-archived'))).toBe(false);
  });

  it('defers archived Memex migration until the archived ids are durable', async () => {
    const legacyCards = path.join(dir, 'memex_memory', 'chat-arch', 'cards');
    fs.mkdirSync(legacyCards, { recursive: true });
    fs.writeFileSync(path.join(legacyCards, 'note.md'), 'archived memory');
    // A transitional source drives a FRESH Phase-1 import: the profile does not
    // yet own archived_chats, so the archived ids are not durable this load.
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'agents', 'archived_chats.json'),
      JSON.stringify({ archived_chats: [{ chat_id: 'chat-arch', chat_type: 'single_agent', agent_ids: ['agent-arch-on-device'] }] }),
    );
    const profile = profileWith([]);

    // Load 1 (fresh import): ids are freshly imported and not yet persisted, so
    // the Memex memory must be LEFT IN PLACE rather than moved under a transient id.
    await runAgentStoreMigrations(dir, profile);
    expect(Array.isArray(profile.archived_chats)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-arch', 'cards', 'note.md'))).toBe(true);
    expect(fs.existsSync(path.join(getAgentMemoryDir(dir, 'agent-arch-on-device'), 'cards', 'note.md'))).toBe(false);

    // Load 2 (archived_chats now durable on the profile): the memory migrates.
    await runAgentStoreMigrations(dir, profile);
    expect(fs.readFileSync(path.join(getAgentMemoryDir(dir, 'agent-arch-on-device'), 'cards', 'note.md'), 'utf-8')).toBe('archived memory');
    expect(fs.existsSync(path.join(dir, 'memex_memory', 'chat-arch'))).toBe(false);
  });

  it('returns false when every chat already carries agent_ids', async () => {
    await writeAgent(dir, { id: 'agent-kobi-on-device', name: 'Kobi', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } as never);
    const profile = profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]);
    const healed = await runAgentStoreMigrations(dir, profile);
    expect(healed).toBe(false);
    expect(getRegistryAgentsByIds(dir, ['agent-kobi-on-device']).map((a) => a.id)).toEqual(['agent-kobi-on-device']);
  });

  it('rewrites a profile-owned legacy chat.workspace path to the chat_id workspace', async () => {
    await writeAgent(dir, { id: 'agent-kobi-on-device', name: 'Kobi', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } as never);
    const legacyWorkspace = path.join(dir, 'chat_workspaces', 'agent-kobi-on-device');
    const profile = profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'], workspace: legacyWorkspace }]);

    const changed = await runAgentStoreMigrations(dir, profile);

    expect(changed).toBe(true);
    expect(profile.chats[0].workspace).toBe(path.join(dir, 'chat_workspaces', 'chat-1'));
  });

  it('migrates multi-agent knowledge before consolidating workspaces to chat_id', async () => {
    const ws = (sub: string): string => path.join(dir, 'chat_workspaces', sub);
    fs.mkdirSync(ws('agent-alpha-on-device/knowledge'), { recursive: true });
    fs.writeFileSync(path.join(ws('agent-alpha-on-device/knowledge'), 'alpha.md'), 'alpha-kb');
    fs.mkdirSync(ws('agent-alpha-on-device/202604'), { recursive: true });
    fs.writeFileSync(path.join(ws('agent-alpha-on-device/202604'), 'alpha-session.txt'), 'alpha-session');
    fs.mkdirSync(ws('agent-beta-on-device/knowledge'), { recursive: true });
    fs.writeFileSync(path.join(ws('agent-beta-on-device/knowledge'), 'beta.md'), 'beta-kb');
    fs.mkdirSync(ws('agent-beta-on-device/202604'), { recursive: true });
    fs.writeFileSync(path.join(ws('agent-beta-on-device/202604'), 'beta-session.txt'), 'beta-session');
    const profile = profileWith([{
      chat_id: 'chat-multi',
      chat_type: 'multi_agent',
      agents: [agent('Alpha'), agent('Beta')],
    }]);

    const changed = await runAgentStoreMigrations(dir, profile);

    expect(changed).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'agents', 'agent-alpha-on-device', 'knowledge', 'alpha.md'), 'utf-8')).toBe('alpha-kb');
    expect(fs.readFileSync(path.join(dir, 'agents', 'agent-beta-on-device', 'knowledge', 'beta.md'), 'utf-8')).toBe('beta-kb');
    expect(fs.existsSync(path.join(dir, 'agents', 'agent-alpha-on-device', 'knowledge', 'beta.md'))).toBe(false);
    expect(fs.existsSync(path.join(ws('chat-multi'), 'knowledge'))).toBe(false);
    expect(fs.readFileSync(path.join(ws('chat-multi/202604'), 'alpha-session.txt'), 'utf-8')).toBe('alpha-session');
    expect(fs.readFileSync(path.join(ws('chat-multi/202604'), 'beta-session.txt'), 'utf-8')).toBe('beta-session');
  });

  it('strips workspace fields left in stored agent configs', async () => {
    const agentsRoot = path.join(dir, 'agents');
    const agentDir = path.join(agentsRoot, 'agent-kobi-on-device');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify({
      id: 'agent-kobi-on-device',
      name: 'Kobi',
      source: 'ON-DEVICE',
      model: 'm',
      mcp_servers: [],
      workspace: '/legacy-chat-workspace',
    }));
    fs.writeFileSync(path.join(agentsRoot, 'index.json'), JSON.stringify({
      agents: [{ id: 'agent-kobi-on-device', name: 'Kobi' }],
    }));
    const profile = profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]);

    const healed = await runAgentStoreMigrations(dir, profile);

    expect(healed).toBe(true);
    expect(readAgent(dir, 'agent-kobi-on-device')?.workspace).toBeUndefined();
    expect(getRegistryAgentsByIds(dir, ['agent-kobi-on-device'])[0]?.workspace).toBeUndefined();
  });

  it('consolidates legacy split indexes into index.json before listing agents', async () => {
    // A prior layout left split indexes behind; the migration must merge them
    // into the single index.json so archived-chat agents stay registered.
    await writeAgent(dir, { id: 'agent-kobi-on-device', name: 'Kobi', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } as never);
    const agentsDir = path.join(dir, 'agents');
    fs.renameSync(path.join(agentsDir, 'index.json'), path.join(agentsDir, 'index_active.json'));
    fs.writeFileSync(path.join(agentsDir, 'index_archived.json'), JSON.stringify({ agents: [{ id: 'agent-kobi-on-device', name: 'Kobi' }] }));
    const profile = profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]);
    await runAgentStoreMigrations(dir, profile);
    expect(readIndex(dir).map((i) => i.id)).toEqual(['agent-kobi-on-device']);
    expect(fs.existsSync(path.join(agentsDir, 'index_active.json'))).toBe(false);
    expect(fs.existsSync(path.join(agentsDir, 'index_archived.json'))).toBe(false);
  });

  it('does not let an active agent steal an archived agent referenced via knowledgeBase', async () => {
    // Regression for the MS Agency (active) <-> M365 (archived) corruption: MS
    // Agency's knowledgeBase points at the archived M365 agent's dir. Migration
    // must keep each agent's own data and only FOLLOW the reference once M365's
    // knowledge has migrated to its own store dir.
    const ws = (sub: string): string => path.join(dir, 'chat_workspaces', sub);
    const m365Knowledge = ws('agent-m365-on-device/knowledge');
    // MS Agency: own session under its own dir; knowledgeBase points at M365.
    fs.mkdirSync(ws('agent-ms-agency-on-device/202606'), { recursive: true });
    fs.writeFileSync(path.join(ws('agent-ms-agency-on-device/202606'), 'sess.txt'), 'ms');
    // M365 (archived): own knowledge + own session.
    fs.mkdirSync(m365Knowledge, { recursive: true });
    fs.writeFileSync(path.join(m365Knowledge, 'agency-doc.md'), 'agency');
    fs.mkdirSync(ws('agent-m365-on-device/202605'), { recursive: true });
    fs.writeFileSync(path.join(ws('agent-m365-on-device/202605'), 'm365-sess.txt'), 'm365');
    fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'archive', 'archived_agents.json'), JSON.stringify({
      archived_agents: [{ chat_id: 'chat-m365', agent: { name: 'M365', source: 'ON-DEVICE', model: 'm', mcp_servers: [], workspace: ws('agent-m365-on-device'), knowledge: { knowledgeBase: m365Knowledge } } }],
    }));
    const profile = profileWith([{ chat_id: 'chat-ms', agent: { name: 'MS Agency', source: 'ON-DEVICE', model: 'm', mcp_servers: [], workspace: ws('agent-ms-agency-on-device'), knowledge: { knowledgeBase: m365Knowledge } } }]);

    await runAgentStoreMigrations(dir, profile);

    // The archived M365 agent is minted a UUID (unified id scheme), so its store
    // dir is UUID-keyed, not the legacy name-derived agent-m365-on-device.
    const uuidM365 = (profile as unknown as { archived_chats: Array<{ agent_ids: string[] }> }).archived_chats[0].agent_ids[0];
    expect(uuidM365).toMatch(/^agent_\d{14}_[a-z0-9]{9}$/);
    const storeM365Knowledge = path.join(dir, 'agents', uuidM365, 'knowledge');
    // M365 keeps its OWN knowledge; MS Agency never absorbed it.
    expect(fs.readFileSync(path.join(storeM365Knowledge, 'agency-doc.md'), 'utf-8')).toBe('agency');
    expect(fs.existsSync(path.join(dir, 'agents', 'agent-ms-agency-on-device', 'knowledge', 'agency-doc.md'))).toBe(false);
    // Each agent's sessions consolidate under its OWN chat_id dir.
    expect(fs.readFileSync(path.join(ws('chat-ms/202606'), 'sess.txt'), 'utf-8')).toBe('ms');
    expect(fs.readFileSync(path.join(ws('chat-m365/202605'), 'm365-sess.txt'), 'utf-8')).toBe('m365');
    // MS Agency's reference FOLLOWS M365's knowledge to its new UUID store home
    // (resolved via the legacy name-derived dir name -> store UUID mapping).
    const followed = storeM365Knowledge;
    expect((profile.chats[0] as { agent: { knowledge: { knowledgeBase: string } } }).agent.knowledge.knowledgeBase).toBe(followed);
    expect(readAgent(dir, 'agent-ms-agency-on-device')?.knowledge?.knowledgeBase).toBe(followed);
    expect(profile.chats[0].workspace).toBe(ws('chat-ms'));
    expect((profile as unknown as { archived_chats: Array<{ workspace: string }> }).archived_chats[0].workspace).toBe(ws('chat-m365'));
    // Index membership is correct: both agents live in the single index.json.
    const indexIds = readIndex(dir).map((i) => i.id);
    expect(indexIds).toContain(uuidM365);
    expect(indexIds).toContain('agent-ms-agency-on-device');
  });

  it('returns true when the only migration change is cross-agent knowledge repointing', async () => {
    const ownerKnowledge = path.join(dir, 'agents', 'agent-owner-on-device', 'knowledge');
    fs.mkdirSync(ownerKnowledge, { recursive: true });
    fs.writeFileSync(path.join(ownerKnowledge, 'doc.md'), 'owner kb');
    const legacyReference = path.join(dir, 'chat_workspaces', 'chat-owner', 'knowledge');
    await writeAgent(dir, { id: 'agent-owner-on-device', name: 'Owner', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: ownerKnowledge } } as never);
    await writeAgent(dir, { id: 'agent-ref-on-device', name: 'Ref', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: legacyReference } } as never);
    const profile = profileWith([
      { chat_id: 'chat-owner', agent_ids: ['agent-owner-on-device'] },
      { chat_id: 'chat-ref', agent_ids: ['agent-ref-on-device'] },
    ]);

    const changed = await runAgentStoreMigrations(dir, profile);

    expect(changed).toBe(true);
    expect(readAgent(dir, 'agent-ref-on-device')?.knowledge?.knowledgeBase).toBe(ownerKnowledge);
  });
});

describe('consolidateWorkspaceDirsToChatId', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentwsc-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('moves agent-id workspace contents into chat_id dir and removes empties', () => {
    const ag = path.join(dir, 'chat_workspaces', 'agent-kobi-on-device', '202604');
    fs.mkdirSync(ag, { recursive: true });
    fs.writeFileSync(path.join(ag, 's.txt'), 'x');
    const chat = { chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'], workspace: path.join(dir, 'chat_workspaces', 'agent-kobi-on-device') };
    const moved = consolidateWorkspaceDirsToChatId(dir, profileWith([chat]));
    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'chat_workspaces', 'chat-1', '202604', 's.txt'), 'utf-8')).toBe('x');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'agent-kobi-on-device'))).toBe(false);
    expect(chat.workspace).toBe(path.join(dir, 'chat_workspaces', 'chat-1'));
  });

  it('consolidates an agent-name dir for an inline chat with no agent_ids', () => {
    // First-run inline profile: legacy chat_workspaces/{agent-name-id} must fold
    // into the chat_id dir even though agent_ids has not been stamped yet.
    const ag = path.join(dir, 'chat_workspaces', 'agent-kobi-on-device', '202604');
    fs.mkdirSync(ag, { recursive: true });
    fs.writeFileSync(path.join(ag, 's.txt'), 'inline-x');
    const moved = consolidateWorkspaceDirsToChatId(dir, profileWith([{ chat_id: 'chat-kobi', agent: agent('Kobi') }]));
    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'chat_workspaces', 'chat-kobi', '202604', 's.txt'), 'utf-8')).toBe('inline-x');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'agent-kobi-on-device'))).toBe(false);
  });

  it('does not move legacy knowledge into the chat-owned workspace', () => {
    const legacyMonth = path.join(dir, 'chat_workspaces', 'agent-kobi-on-device', '202604');
    const legacyKnowledge = path.join(dir, 'chat_workspaces', 'agent-kobi-on-device', 'knowledge');
    fs.mkdirSync(legacyMonth, { recursive: true });
    fs.writeFileSync(path.join(legacyMonth, 's.txt'), 'session');
    fs.mkdirSync(legacyKnowledge, { recursive: true });
    fs.writeFileSync(path.join(legacyKnowledge, 'kb.md'), 'knowledge');

    const moved = consolidateWorkspaceDirsToChatId(dir, profileWith([{ chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] }]));

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'chat_workspaces', 'chat-1', '202604', 's.txt'), 'utf-8')).toBe('session');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'chat-1', 'knowledge', 'kb.md'))).toBe(false);
    expect(fs.readFileSync(path.join(legacyKnowledge, 'kb.md'), 'utf-8')).toBe('knowledge');
  });

  it('skips when no chat_id, id equals chat_id, missing dir, and swallows errors', () => {
    expect(consolidateWorkspaceDirsToChatId(dir, profileWith([{ agent_ids: ['a'] } as never]))).toBe(false);
    expect(consolidateWorkspaceDirsToChatId(dir, profileWith([{ chat_id: 'c', agent_ids: ['c'] }]))).toBe(false);
    expect(consolidateWorkspaceDirsToChatId(dir, profileWith([{ chat_id: 'c', agent_ids: ['missing'] }]))).toBe(false);
    fs.writeFileSync(path.join(dir, 'chat_workspaces'), 'x');
    expect(consolidateWorkspaceDirsToChatId(dir, {} as ProfileV2)).toBe(false);
  });

  it('does not consolidate a dir referenced only by a cross-agent knowledgeBase', () => {
    // The dir belongs to a DIFFERENT agent (M365) that MS Agency merely
    // references via knowledgeBase. It must NOT be folded into MS Agency's chat.
    const old = path.join(dir, 'chat_workspaces', 'agent-m365-on-device', '202606');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'sess.txt'), 'data');
    const chat = { chat_id: 'chat-1', agent: { name: 'MS Agency', source: 'ON-DEVICE', knowledge: { knowledgeBase: path.join(dir, 'chat_workspaces', 'agent-m365-on-device', 'knowledge') } } };
    const moved = consolidateWorkspaceDirsToChatId(dir, profileWith([chat as never]));
    expect(moved).toBe(false);
    // M365's dir stays; MS Agency's chat dir is not created from it.
    expect(fs.readFileSync(path.join(old, 'sess.txt'), 'utf-8')).toBe('data');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'chat-1', '202606', 'sess.txt'))).toBe(false);
  });

  it('merges a legacy month dir into an existing chat_id month dir, leaving no residue', () => {
    // Regression: when the chat_id dir already holds a same-named month dir
    // (e.g. 202606) the legacy month dir was skipped wholesale, leaving its
    // sessions behind. The legacy dir here is found via the workspace field.
    const chatMonth = path.join(dir, 'chat_workspaces', 'chat-ms', '202606');
    fs.mkdirSync(chatMonth, { recursive: true });
    fs.writeFileSync(path.join(chatMonth, 'sess-existing.txt'), 'existing');
    const legacyMonth = path.join(dir, 'chat_workspaces', 'agent-m365-on-device', '202606');
    fs.mkdirSync(legacyMonth, { recursive: true });
    fs.writeFileSync(path.join(legacyMonth, 'sess-legacy.txt'), 'legacy');
    const chat = { chat_id: 'chat-ms', agent: { name: 'MS Agency', source: 'ON-DEVICE', workspace: path.join(dir, 'chat_workspaces', 'agent-m365-on-device') } };
    const moved = consolidateWorkspaceDirsToChatId(dir, profileWith([chat as never]));
    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(chatMonth, 'sess-existing.txt'), 'utf-8')).toBe('existing');
    expect(fs.readFileSync(path.join(chatMonth, 'sess-legacy.txt'), 'utf-8')).toBe('legacy');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'agent-m365-on-device'))).toBe(false);
  });

  it('skips an unsafe agent_ids entry (path traversal) instead of escaping chat_workspaces', () => {
    // Unguarded, '../evil' resolves to chat_workspaces/../evil = <profile>/evil,
    // OUTSIDE chat_workspaces — its contents would be moved and the dir removed.
    const outside = path.join(dir, 'evil');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'keep');
    const moved = consolidateWorkspaceDirsToChatId(
      dir,
      profileWith([{ chat_id: 'chat-1', agent_ids: ['../evil'] }])
    );
    expect(moved).toBe(false);
    // The escaped dir + file survive; no chat-1 target dir was created from it.
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf-8')).toBe('keep');
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'chat-1'))).toBe(false);
  });

  it('skips an unsafe chat_id TARGET (path traversal) instead of escaping chat_workspaces', () => {
    // A corrupt chat_id like '../evil' resolves the move TARGET to
    // chat_workspaces/../evil = <profile>/evil, OUTSIDE chat_workspaces. A safe
    // source dir exists, so without the target guard mkdirSync + move would
    // create/populate the escaped dir.
    const src = path.join(dir, 'chat_workspaces', 'agent-kobi-on-device', '202604');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 's.txt'), 'x');
    const escaped = path.join(dir, 'evil');
    const moved = consolidateWorkspaceDirsToChatId(
      dir,
      profileWith([{ chat_id: '../evil', agent_ids: ['agent-kobi-on-device'] }])
    );
    expect(moved).toBe(false);
    // The source survives untouched and no escaped target dir was created.
    expect(fs.readFileSync(path.join(src, 's.txt'), 'utf-8')).toBe('x');
    expect(fs.existsSync(escaped)).toBe(false);
  });
});

describe('syncInlineChatAgentsToStore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentresync-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('overwrites existing store entries in place with the mutated inline agent', async () => {
    // Seed the store as runAgentStoreMigrations would, then mutate the inline agent
    // as applyBuiltinDefaultsMigrations does (add a builtin-tools server + skill).
    await writeAgent(dir, { id: 'agent_fixed', name: 'Kobi', model: 'm', source: 'ON-DEVICE', mcp_servers: [], skills: [] } as never);
    const chat = {
      chat_id: 'c',
      agent_ids: ['agent_fixed'],
      agent: { id: 'agent_fixed', name: 'Kobi', model: 'm', source: 'ON-DEVICE', mcp_servers: [{ name: 'builtin-tools', tools: [] }], skills: ['newskill'] },
    };
    await syncInlineChatAgentsToStore(dir, profileWith([chat as never]));
    const stored = readAgent(dir, 'agent_fixed') as never as { mcp_servers: unknown; skills: unknown };
    expect(stored.mcp_servers).toEqual([{ name: 'builtin-tools', tools: [] }]);
    expect(stored.skills).toEqual(['newskill']);
    // Pure writer: it does not re-stamp agent_ids.
    expect(chat.agent_ids).toEqual(['agent_fixed']);
  });

  it('handles a multi-agent chat, writing every inline agent by its carried id', async () => {
    const chat = {
      chat_id: 'c',
      agent_ids: ['id-a', 'id-b'],
      agents: [
        { id: 'id-a', name: 'A', model: 'm', source: 'ON-DEVICE', mcp_servers: [{ name: 'builtin-tools', tools: [] }] },
        { id: 'id-b', name: 'B', model: 'm', source: 'IN-LIBRARY', mcp_servers: [] },
      ],
    };
    await syncInlineChatAgentsToStore(dir, profileWith([chat as never]));
    expect((readAgent(dir, 'id-a') as never as { mcp_servers: unknown }).mcp_servers).toEqual([{ name: 'builtin-tools', tools: [] }]);
    expect(readAgent(dir, 'id-b')?.name).toBe('B');
  });

  it('tolerates a profile with no chats array (no throw, no writes)', async () => {
    await expect(syncInlineChatAgentsToStore(dir, {} as ProfileV2)).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'agents'))).toBe(false);
  });

  it('surfaces store write failures to the caller', async () => {
    const failures: string[] = [];
    const chat = {
      chat_id: 'c',
      agent_ids: ['../bad'],
      agent: { id: '../bad', name: 'Bad', model: 'm', source: 'ON-DEVICE' },
    };

    await syncInlineChatAgentsToStore(dir, profileWith([chat as never]), failures);

    expect(failures).toEqual(['../bad']);
  });
});

describe('repointCrossAgentKnowledge', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentxref-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const seedMigrated = (storeId: string, file = 'doc.md'): string => {
    const knowledge = path.join(dir, 'agents', storeId, 'knowledge');
    fs.mkdirSync(knowledge, { recursive: true });
    fs.writeFileSync(path.join(knowledge, file), 'kb');
    return knowledge;
  };
  const crossRef = (subDir: string): string => path.join(dir, 'chat_workspaces', subDir, 'knowledge');

  it('follows a cross-agent knowledgeBase (inline + stored) to migrated knowledge', async () => {
    const migrated = seedMigrated('agent-m365-on-device');
    const ref = crossRef('agent-m365-on-device');
    await writeAgent(dir, { id: 'agent-ms-agency-on-device', name: 'MS Agency', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: ref } } as never);
    const chat = { chat_id: 'chat-ms', agent_ids: ['agent-ms-agency-on-device'], agent: { id: 'agent-ms-agency-on-device', name: 'MS Agency', source: 'ON-DEVICE', knowledge: { knowledgeBase: ref } } };
    const changed = await repointCrossAgentKnowledge(dir, profileWith([chat as never]));
    expect(changed).toBe(true);
    expect((chat.agent.knowledge as { knowledgeBase: string }).knowledgeBase).toBe(migrated);
    expect(readAgent(dir, 'agent-ms-agency-on-device')?.knowledge?.knowledgeBase).toBe(migrated);
  });

  it('resolves a chat_id-dir knowledgeBase via the chat->store id map', async () => {
    const migrated = seedMigrated('agent-kobi-on-device', 'k.md');
    const owner = { chat_id: 'chat-1', agent_ids: ['agent-kobi-on-device'] };
    const refChat = { chat_id: 'chat-2', agent_ids: ['agent-ref-on-device'], agent: { id: 'agent-ref-on-device', name: 'Ref', source: 'ON-DEVICE', knowledge: { knowledgeBase: crossRef('chat-1') } } };
    const changed = await repointCrossAgentKnowledge(dir, profileWith([owner as never, refChat as never]));
    expect(changed).toBe(true);
    expect((refChat.agent.knowledge as { knowledgeBase: string }).knowledgeBase).toBe(migrated);
  });

  it('leaves a cross-agent knowledgeBase untouched when the knowledge did not migrate', async () => {
    const ref = crossRef('agent-m365-on-device');
    // (a) destination knowledge dir absent -> not migrated.
    const chat = { chat_id: 'chat-ms', agent_ids: ['agent-x-on-device'], agent: { id: 'agent-x-on-device', name: 'X', source: 'ON-DEVICE', knowledge: { knowledgeBase: ref } } };
    expect(await repointCrossAgentKnowledge(dir, profileWith([chat as never]))).toBe(false);
    expect((chat.agent.knowledge as { knowledgeBase: string }).knowledgeBase).toBe(ref);
    // (b) destination present but EMPTY -> still not migrated.
    fs.mkdirSync(path.join(dir, 'agents', 'agent-m365-on-device', 'knowledge'), { recursive: true });
    const chat2 = { chat_id: 'chat-ms2', agent_ids: ['agent-y-on-device'], agent: { id: 'agent-y-on-device', name: 'Y', source: 'ON-DEVICE', knowledge: { knowledgeBase: ref } } };
    expect(await repointCrossAgentKnowledge(dir, profileWith([chat2 as never]))).toBe(false);
    expect((chat2.agent.knowledge as { knowledgeBase: string }).knowledgeBase).toBe(ref);
  });

  it('leaves an external knowledgeBase untouched', async () => {
    const chat = { chat_id: 'c', agent_ids: ['agent-x-on-device'], agent: { id: 'agent-x-on-device', name: 'X', source: 'ON-DEVICE', knowledge: { knowledgeBase: '/Users/me/Docs/kb' } } };
    expect(await repointCrossAgentKnowledge(dir, profileWith([chat as never]))).toBe(false);
    expect((chat.agent.knowledge as { knowledgeBase: string }).knowledgeBase).toBe('/Users/me/Docs/kb');
  });

  it('preserves index membership when following a stored cross-agent ref', async () => {
    const migrated = seedMigrated('agent-m365-on-device');
    await writeAgent(dir, { id: 'agent-arch-on-device', name: 'Arch', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: crossRef('agent-m365-on-device') } } as never);
    const changed = await repointCrossAgentKnowledge(dir, profileWith([]));
    expect(changed).toBe(true);
    expect(readAgent(dir, 'agent-arch-on-device')?.knowledge?.knowledgeBase).toBe(migrated);
    expect(readIndex(dir).map((i) => i.id)).toContain('agent-arch-on-device');
  });

  it('skips agents without knowledge, chats without ids, and swallows a stored write failure', async () => {
    seedMigrated('agent-m365-on-device');
    const ref = crossRef('agent-m365-on-device');
    // Stored agent whose agent.json loses its id, so the repoint write throws.
    await writeAgent(dir, { id: 'agent-evil-on-device', name: 'Evil', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: ref } } as never);
    fs.writeFileSync(path.join(dir, 'agents', 'agent-evil-on-device', 'agent.json'), JSON.stringify({ name: 'Evil', source: 'ON-DEVICE', knowledge: { knowledgeBase: ref } }));
    const noKnow = { chat_id: 'chat-nok', agent_ids: ['agent-nok-on-device'], agent: { id: 'agent-nok-on-device', name: 'NoK', source: 'ON-DEVICE' } };
    const noAgents = { chat_id: 'chat-empty' };
    const changed = await repointCrossAgentKnowledge(dir, profileWith([noKnow as never, noAgents as never]));
    expect(changed).toBe(false);
    // The write threw, so evil's on-disk kb stays at the legacy cross-ref path.
    expect(readAgent(dir, 'agent-evil-on-device')?.knowledge?.knowledgeBase).toBe(ref);
  });
  it('does not follow a knowledgeBase that resolves to an unsafe path-traversal id', async () => {
    // A chat whose agent_id is a malformed traversal id seeds dirNameToStoreId
    // with chat_id -> '../evil'; a second agent's kb points at that chat_id dir.
    // The guard must return "not migrated" instead of letting getAgentKnowledgeDir
    // throw out of the migration.
    const badOwner = { chat_id: 'chat-bad', agent_ids: ['../evil'] };
    const refChat = { chat_id: 'chat-ref', agent_ids: ['agent-ref-on-device'], agent: { id: 'agent-ref-on-device', name: 'Ref', source: 'ON-DEVICE', knowledge: { knowledgeBase: crossRef('chat-bad') } } };
    const changed = await repointCrossAgentKnowledge(dir, profileWith([badOwner as never, refChat as never]));
    expect(changed).toBe(false);
    expect((refChat.agent.knowledge as { knowledgeBase: string }).knowledgeBase).toBe(crossRef('chat-bad'));
  });
});

describe('legacyWorkspaceDirNames', () => {
  const root = '/p';
  const ws = (sub: string) => path.join(root, 'chat_workspaces', sub);

  it('returns only derived ids and ignores a cross-agent knowledgeBase', () => {
    // knowledgeBase is a reference, not an ownership signal: a kb pointing at
    // another agent's dir must NOT add that dir to this chat's legacy dirs.
    const chat = { chat_id: 'chat-1', agent: { name: 'MS Agency', source: 'ON-DEVICE', knowledge: { knowledgeBase: ws('agent-m365-on-device/knowledge') } } };
    expect(legacyWorkspaceDirNames(root, chat as never).sort()).toEqual(['agent-ms-agency-on-device']);
  });

  it('handles a missing, empty, or root workspace path', () => {
    const noWs = { chat_id: 'c', agent: { name: 'Y', source: 'ON-DEVICE' } };
    expect(legacyWorkspaceDirNames(root, noWs as never)).toEqual(['agent-y-on-device']);
    const emptyWs = { chat_id: 'c', agent: { name: 'Z', source: 'ON-DEVICE', workspace: '' } };
    expect(legacyWorkspaceDirNames(root, emptyWs as never)).toEqual(['agent-z-on-device']);
    const rootWs = { chat_id: 'c', agent: { name: 'W', source: 'ON-DEVICE', workspace: path.join(root, 'chat_workspaces') } };
    expect(legacyWorkspaceDirNames(root, rootWs as never)).toEqual(['agent-w-on-device']);
  });

  it('returns empty for a chat with no agents and dedupes a chat_id-pointing workspace', () => {
    expect(legacyWorkspaceDirNames(root, { chat_id: 'c' } as never)).toEqual([]);
    const selfWs = { chat_id: 'chat-1', agent: { name: 'Kobi', source: 'ON-DEVICE', workspace: ws('chat-1') } };
    expect(legacyWorkspaceDirNames(root, selfWs as never).sort()).toEqual(['agent-kobi-on-device', 'chat-1']);
  });

  it('adds the agent own workspace dir even when it differs from the derived id', () => {
    // The workspace field is the authoritative location of the agent's own
    // workspace dir, so it is honored even if the dir name differs from the id.
    const chat = { chat_id: 'chat-1', agent: { name: 'MS Agency', source: 'ON-DEVICE', workspace: ws('agent-m365-on-device') } };
    expect(legacyWorkspaceDirNames(root, chat as never).sort()).toEqual(['agent-m365-on-device', 'agent-ms-agency-on-device']);
  });

  it('ignores a workspace pointing outside the profile', () => {
    const chat = { chat_id: 'c', agent: { name: 'X', source: 'ON-DEVICE', workspace: '/Users/me/custom-ws' } };
    expect(legacyWorkspaceDirNames(root, chat as never)).toEqual(['agent-x-on-device']);
  });

  it('includes the legacy name-derived id alongside a carried UUID id', () => {
    // After migration mints UUID ids, agent_ids hold the UUID but the on-disk
    // dir is still keyed by the old name-derived id — both must be returned so
    // the legacy dir is discovered and relocated.
    const chat = { chat_id: 'chat-1', agent_ids: ['agent_20260101000000_kobi'], agent: { id: 'agent_20260101000000_kobi', name: 'Kobi', source: 'ON-DEVICE' } };
    expect(legacyWorkspaceDirNames(root, chat as never).sort()).toEqual(['agent-kobi-on-device', 'agent_20260101000000_kobi']);
  });

  it('skips the name-derived id for a nameless agent', () => {
    const chat = { chat_id: 'c', agent: { source: 'ON-DEVICE' } };
    expect(legacyWorkspaceDirNames(root, chat as never)).toEqual([]);
  });
});

describe('ensureChatAgentIds', () => {
  it('derives agent_ids from a single inline agent and reports change', () => {
    const profile = profileWith([{ chat_id: 'c', agent: agent('Kobi') }]);
    expect(ensureChatAgentIds(profile)).toBe(true);
    expect(profile.chats[0].agent_ids).toEqual(['agent-kobi-on-device']);
  });

  it('derives ids from multiple inline agents', () => {
    const profile = profileWith([{ chat_id: 'c', agents: [agent('Alpha'), agent('Beta', 'IN-LIBRARY')] }]);
    expect(ensureChatAgentIds(profile)).toBe(true);
    expect(profile.chats[0].agent_ids).toEqual(['agent-alpha-on-device', 'agent-beta-in-library']);
  });

  it('is a no-op when agent_ids already present', () => {
    const profile = profileWith([{ chat_id: 'c', agent: agent('Kobi'), agent_ids: ['agent-kobi-on-device'] }]);
    expect(ensureChatAgentIds(profile)).toBe(false);
    expect(profile.chats[0].agent_ids).toEqual(['agent-kobi-on-device']);
  });

  it('leaves a nameless chat untouched and tolerates a missing chats array', () => {
    const profile = profileWith([{ chat_id: 'c' }]);
    expect(ensureChatAgentIds(profile)).toBe(false);
    expect(profile.chats[0].agent_ids).toBeUndefined();
    expect(ensureChatAgentIds({} as ProfileV2)).toBe(false);
  });
});

describe('migrateArchivedAgentsToStore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentarchmig-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const legacyPath = () => path.join(dir, 'archive', 'archived_agents.json');
  const storePath = () => path.join(dir, 'agents', 'archived_chats.json');
  // Matches a minted UUID agent id (agent_{YYYYMMDDHHMMSS}_{random}) — the scheme
  // brand-new AND migrated (active + archived) agents share; never name-derived.
  const UUID_RE = /^agent_\d{14}_[a-z0-9]{9}$/;

  function seedLegacyArchive(entries: unknown[]) {
    fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
    fs.writeFileSync(legacyPath(), JSON.stringify({ archived_agents: entries }));
  }
  function seedStoreArchive(entries: unknown[]) {
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify({ archived_chats: entries }));
  }
  // The function only reads/writes `archived_chats`; pass undefined to drive
  // Phase 1 (import) and an array to drive Phase 2 (retire).
  function prof(archivedChats?: unknown[]): ProfileV2 {
    const profile: Record<string, unknown> = { chats: [] };
    if (archivedChats !== undefined) {
      profile.archived_chats = archivedChats;
    }
    return profile as unknown as ProfileV2;
  }

  // ── Phase 1: import from a transitional file into profile.archived_chats ──────

  it('returns false and leaves archived_chats unset when no source file exists', async () => {
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(false);
    expect((p as { archived_chats?: unknown }).archived_chats).toBeUndefined();
  });

  it('returns false on unparseable archive JSON', async () => {
    fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
    fs.writeFileSync(legacyPath(), '{ not json');
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(false);
    expect((p as { archived_chats?: unknown }).archived_chats).toBeUndefined();
  });

  it('retires an empty source and leaves archived_chats unset', async () => {
    seedLegacyArchive([]);
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);
    expect((p as { archived_chats?: unknown }).archived_chats).toBeUndefined();
    expect(fs.existsSync(legacyPath())).toBe(false);
  });

  it('retires a keyless source and leaves archived_chats unset', async () => {
    fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
    fs.writeFileSync(legacyPath(), JSON.stringify({ other: 1 }));
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);
    expect((p as { archived_chats?: unknown }).archived_chats).toBeUndefined();
    expect(fs.existsSync(legacyPath())).toBe(false);
  });

  it('imports a legacy inline archived agent into the store + profile with a UUID id, keeping the source', async () => {
    const oldKnow = path.join(dir, 'chat_workspaces', 'agent-abc2-on-device', 'knowledge');
    fs.mkdirSync(oldKnow, { recursive: true });
    fs.writeFileSync(path.join(oldKnow, 'doc.md'), 'kb');
    const oldMonth = path.join(dir, 'chat_workspaces', 'agent-abc2-on-device', '202606');
    fs.mkdirSync(oldMonth, { recursive: true });
    fs.writeFileSync(path.join(oldMonth, 'sess.txt'), 'sess');
    seedLegacyArchive([{
      archived_at: 't', chat_id: 'chat-abc2', chat_type: 'single_agent',
      agent: { name: 'ABC2', source: 'ON-DEVICE', model: 'm', mcp_servers: [], knowledge: { knowledgeBase: oldKnow } },
    }]);

    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);

    // Archive list lands on profile.archived_chats (agent_ids, no inline agent).
    const archived = (p as unknown as { archived_chats: Array<Record<string, unknown>> }).archived_chats;
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ chat_id: 'chat-abc2', chat_type: 'single_agent', archived_at: 't' });
    expect(archived[0].agent).toBeUndefined();
    // The legacy inline agent (no id) is minted a UUID, exactly like active agents —
    // NOT the deprecated name-derived id — so the profile keeps a single id scheme.
    const id = (archived[0].agent_ids as string[])[0];
    expect(id).toMatch(UUID_RE);
    expect(id).not.toBe('agent-abc2-on-device');
    // Agent persisted into the store under the UUID and registered in the single index.
    expect(readAgent(dir, id)?.id).toBe(id);
    expect(readIndex(dir).map((i) => i.id)).toContain(id);
    // Knowledge relocated into the store and the stored knowledgeBase repointed.
    expect(fs.readFileSync(path.join(dir, 'agents', id, 'knowledge', 'doc.md'), 'utf8')).toBe('kb');
    expect(readAgent(dir, id)?.knowledge?.knowledgeBase).toBe(path.join(dir, 'agents', id, 'knowledge'));
    // Workspace consolidated to the chat_id dir.
    expect(fs.readFileSync(path.join(dir, 'chat_workspaces', 'chat-abc2', '202606', 'sess.txt'), 'utf8')).toBe('sess');
    expect(fs.existsSync(path.join(dir, 'chat_workspaces', 'agent-abc2-on-device'))).toBe(false);
    // Source file is KEPT — it is retired on the next (Phase 2) load.
    expect(fs.existsSync(legacyPath())).toBe(true);
  });

  it('drops entries with no resolvable agent id and retires when none remain', async () => {
    seedStoreArchive([{ chat_id: 'c-blank', note: 'orphan' }]);
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);
    expect((p as { archived_chats?: unknown }).archived_chats).toBeUndefined();
    expect(fs.existsSync(storePath())).toBe(false);
  });

  it('drops entries that have an id but no chat_id', async () => {
    seedStoreArchive([{ agent_ids: ['agent-x-on-device'] }]);
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);
    expect((p as { archived_chats?: unknown }).archived_chats).toBeUndefined();
  });

  it('filters blank/non-string agent_ids and mints a UUID for an inline agent without an id', async () => {
    seedStoreArchive([
      { chat_id: 'c1', agent_ids: ['', null, 'agent-keep-on-device'] },
      { chat_id: 'c2', agent: { name: 'Derived', source: 'ON-DEVICE' } },
    ]);
    const p = prof();
    await migrateArchivedAgentsToStore(dir, p);
    const archived = (p as unknown as { archived_chats: Array<Record<string, unknown>> }).archived_chats;
    // Explicit agent_ids win (blanks filtered); no inline agent means no minting.
    expect(archived[0].agent_ids).toEqual(['agent-keep-on-device']);
    // The inline agent without an id is minted a UUID, not a name-derived id.
    const derivedId = (archived[1].agent_ids as string[])[0];
    expect(derivedId).toMatch(UUID_RE);
    expect(derivedId).not.toBe('agent-derived-on-device');
  });

  it('keeps a store-only id whose agent config was never persisted (no store write)', async () => {
    seedStoreArchive([{ chat_id: 'c-ghost', agent_ids: ['agent-ghost-on-device'] }]);
    const p = prof();
    await migrateArchivedAgentsToStore(dir, p);
    expect(readAgent(dir, 'agent-ghost-on-device')).toBeNull();
    expect(readIndex(dir)).toEqual([]);
    expect((p as unknown as { archived_chats: Array<Record<string, unknown>> }).archived_chats[0].agent_ids).toEqual(['agent-ghost-on-device']);
  });

  it('keeps an already-stored agent in the index without rewriting it', async () => {
    await writeAgent(dir, { id: 'agent-act-on-device', name: 'Act', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } as never);
    seedStoreArchive([{ chat_id: 'chat-act', agent_ids: ['agent-act-on-device'] }]);
    await migrateArchivedAgentsToStore(dir, prof());
    expect(readIndex(dir).map((i) => i.id)).toContain('agent-act-on-device');
  });

  it('is idempotent for a store entry whose agent is already in the index', async () => {
    await writeAgent(dir, { id: 'agent-k-on-device', name: 'K', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } as never);
    seedStoreArchive([{ archived_at: 't', chat_id: 'chat-k', agent_ids: ['agent-k-on-device'] }]);
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);
    expect(readIndex(dir).map((i) => i.id)).toContain('agent-k-on-device');
    expect((p as unknown as { archived_chats: Array<Record<string, unknown>> }).archived_chats[0].agent_ids).toEqual(['agent-k-on-device']);
  });

  it('defers the import (keeps the source, leaves archived_chats unset) when a writeAgent fails', async () => {
    // agents/{id} pre-exists as a FILE, so writeAgent throws on the knowledge mkdir.
    // The inline agent carries an explicit id (so the id is deterministic and the
    // blocker path matches) — minting only fills in a MISSING id, never overwrites.
    // Because the agent could not be durably stored, the migration must NOT commit
    // to Phase 2: it keeps the transitional source file (the only inline copy) so
    // the write is retried next load, instead of retiring it and leaving an
    // unrestorable archived chat pointing at a missing agents/{id}/agent.json.
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agents', 'agent-bad-on-device'), 'blocker');
    seedLegacyArchive([{ chat_id: 'c-bad', agent: { id: 'agent-bad-on-device', name: 'Bad', source: 'ON-DEVICE' } }]);
    const p = prof();
    await migrateArchivedAgentsToStore(dir, p);
    // The failed agent is not in the index ...
    expect(readIndex(dir).map((i) => i.id)).not.toContain('agent-bad-on-device');
    // ... the archive list is NOT handed to the profile (import deferred) ...
    expect((p as { archived_chats?: unknown }).archived_chats).toBeUndefined();
    // ... and the transitional source file is preserved for the retry.
    expect(fs.existsSync(legacyPath())).toBe(true);
  });

  it('completes the deferred import on a later load once the writeAgent blocker clears', async () => {
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agents', 'agent-bad-on-device'), 'blocker');
    seedLegacyArchive([{ chat_id: 'c-bad', agent: { id: 'agent-bad-on-device', name: 'Bad', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } }]);
    // First load: writeAgent blocked -> import deferred, source kept.
    const p1 = prof();
    await migrateArchivedAgentsToStore(dir, p1);
    expect((p1 as { archived_chats?: unknown }).archived_chats).toBeUndefined();
    expect(fs.existsSync(legacyPath())).toBe(true);
    // Clear the blocker and re-run (simulating the next load): the import now lands.
    fs.rmSync(path.join(dir, 'agents', 'agent-bad-on-device'));
    const p2 = prof();
    expect(await migrateArchivedAgentsToStore(dir, p2)).toBe(true);
    const archived = (p2 as unknown as { archived_chats: Array<Record<string, unknown>> }).archived_chats;
    expect(archived[0].agent_ids).toEqual(['agent-bad-on-device']);
    expect(readAgent(dir, 'agent-bad-on-device')?.id).toBe('agent-bad-on-device');
    expect(readIndex(dir).map((i) => i.id)).toContain('agent-bad-on-device');
    // Source still kept — retired only in Phase 2 once the profile durably owns the list.
    expect(fs.existsSync(legacyPath())).toBe(true);
  });

  it('preserves a UUID that an archived inline agent already carries (mint is idempotent)', async () => {
    const existing = 'agent_20260101010101_abc123xyz';
    seedLegacyArchive([{ chat_id: 'chat-u', agent: { id: existing, name: 'Uuid', source: 'ON-DEVICE', model: 'm', mcp_servers: [] } }]);
    const p = prof();
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);
    // The pre-existing UUID is kept verbatim (never re-minted, never name-derived).
    expect((p as unknown as { archived_chats: Array<Record<string, unknown>> }).archived_chats[0].agent_ids).toEqual([existing]);
    expect(readAgent(dir, existing)?.id).toBe(existing);
    expect(readIndex(dir).map((i) => i.id)).toContain(existing);
  });

  // ── Phase 2: retire transitional files once the profile owns the list ─────────

  it('Phase 2: retires the legacy + store files and empty archive dir, list untouched', async () => {
    seedLegacyArchive([{ chat_id: 'c', agent_ids: ['agent-c-on-device'] }]);
    seedStoreArchive([{ chat_id: 'c', agent_ids: ['agent-c-on-device'] }]);
    const p = prof([{ chat_id: 'c', agent_ids: ['agent-c-on-device'] }]);
    expect(await migrateArchivedAgentsToStore(dir, p)).toBe(true);
    expect(fs.existsSync(legacyPath())).toBe(false);
    expect(fs.existsSync(storePath())).toBe(false);
    expect(fs.existsSync(path.join(dir, 'archive'))).toBe(false);
    expect((p as unknown as { archived_chats: unknown[] }).archived_chats).toHaveLength(1);
  });

  it('Phase 2: returns false when there is nothing to retire', async () => {
    expect(await migrateArchivedAgentsToStore(dir, prof([{ chat_id: 'c', agent_ids: ['agent-c-on-device'] }]))).toBe(false);
  });

  it('Phase 2: keeps a non-empty archive dir but removes the legacy file', async () => {
    seedLegacyArchive([{ chat_id: 'c', agent_ids: ['agent-c-on-device'] }]);
    fs.writeFileSync(path.join(dir, 'archive', 'other.json'), '{}');
    expect(await migrateArchivedAgentsToStore(dir, prof([]))).toBe(true);
    expect(fs.existsSync(legacyPath())).toBe(false);
    expect(fs.existsSync(path.join(dir, 'archive'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'archive', 'other.json'))).toBe(true);
  });

  it('Phase 2: swallows an archive-dir cleanup failure when archive is a file', async () => {
    seedStoreArchive([{ chat_id: 'c-file', agent_ids: ['agent-file-on-device'] }]);
    fs.writeFileSync(path.join(dir, 'archive'), 'not a dir');
    expect(await migrateArchivedAgentsToStore(dir, prof([]))).toBe(true);
    expect(fs.existsSync(storePath())).toBe(false);
    expect(fs.statSync(path.join(dir, 'archive')).isFile()).toBe(true);
  });
});
