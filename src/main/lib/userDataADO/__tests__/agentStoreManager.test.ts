import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getAgentsRootDir,
  getAgentDir,
  isSafeAgentId,
  getAgentConfigPath,
  getAgentKnowledgeDir,
  getAgentMemoryDir,
  getAgentIndexPath,
  readAgent,
  writeAgent,
  listAgents,
  readIndex,
  consolidateLegacyAgentIndexes,
  deleteAgent,
  setRegistryAgents,
  upsertRegistryAgent,
  removeRegistryAgent,
  getRegistryAgent,
  getRegistryAgentsByIds,
  getAllRegistryAgents,
  clearRegistry,
  migrateStoredAgentSystemPrompts,
} from '../agentStoreManager';
import { AgentConfig, AgentIndexItem } from '../types/agentStore';

function mkAgent(id: string, name: string): AgentConfig {
  return { id, name, source: 'ON-DEVICE' } as AgentConfig;
}

function writeIndexFile(dir: string, name: string, items: AgentIndexItem[]): void {
  fs.mkdirSync(getAgentsRootDir(dir), { recursive: true });
  fs.writeFileSync(path.join(getAgentsRootDir(dir), name), JSON.stringify({ agents: items }, null, 2));
}

describe('agentStoreManager', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstore-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('builds expected paths', () => {
    expect(getAgentsRootDir(dir)).toBe(path.join(dir, 'agents'));
    expect(getAgentDir(dir, 'a')).toBe(path.join(dir, 'agents', 'a'));
    expect(getAgentConfigPath(dir, 'a')).toBe(path.join(dir, 'agents', 'a', 'agent.json'));
    expect(getAgentKnowledgeDir(dir, 'a')).toBe(path.join(dir, 'agents', 'a', 'knowledge'));
    expect(getAgentMemoryDir(dir, 'a')).toBe(path.join(dir, 'agents', 'a', 'memory'));
    expect(getAgentIndexPath(dir)).toBe(path.join(dir, 'agents', 'index.json'));
  });

  it('readAgent returns null when missing and on parse error', () => {
    expect(readAgent(dir, 'nope')).toBeNull();
    const p = getAgentConfigPath(dir, 'bad');
    fs.mkdirSync(getAgentDir(dir, 'bad'), { recursive: true });
    fs.writeFileSync(p, '{not json');
    expect(readAgent(dir, 'bad')).toBeNull();
  });

  it('writeAgent persists config, knowledge and memory dirs, and the single index.json', async () => {
    await writeAgent(dir, mkAgent('agent-a-on-device', 'A'));
    expect(readAgent(dir, 'agent-a-on-device')?.name).toBe('A');
    expect(fs.existsSync(getAgentKnowledgeDir(dir, 'agent-a-on-device'))).toBe(true);
    expect(fs.existsSync(getAgentMemoryDir(dir, 'agent-a-on-device'))).toBe(true);
    expect(readIndex(dir)).toEqual([{ id: 'agent-a-on-device', name: 'A' }]);
    // No legacy split index files are written.
    expect(fs.existsSync(path.join(getAgentsRootDir(dir), 'index_active.json'))).toBe(false);
    expect(fs.existsSync(path.join(getAgentsRootDir(dir), 'index_archived.json'))).toBe(false);
  });

  it('writeAgent strips chat-owned workspace from stored agent configs', async () => {
    await writeAgent(dir, { ...mkAgent('agent-a-on-device', 'A'), workspace: '/chat-workspace' } as AgentConfig);

    const stored = JSON.parse(fs.readFileSync(getAgentConfigPath(dir, 'agent-a-on-device'), 'utf8'));
    expect(stored.workspace).toBeUndefined();
    expect(readAgent(dir, 'agent-a-on-device')?.workspace).toBeUndefined();
  });

  it('writeAgent normalizes legacy string system prompts before persisting', async () => {
    await writeAgent(dir, {
      ...mkAgent('agent-a-on-device', 'A'),
      system_prompt: 'legacy prompt',
    } as unknown as AgentConfig);

    const stored = JSON.parse(fs.readFileSync(getAgentConfigPath(dir, 'agent-a-on-device'), 'utf8'));
    expect(stored.system_prompt).toEqual({ 'Base.md': 'legacy prompt', 'AGENTS.md': '' });
    expect(readAgent(dir, 'agent-a-on-device')?.system_prompt).toEqual({ 'Base.md': 'legacy prompt', 'AGENTS.md': '' });
  });

  it('writeAgent throws without id', async () => {
    await expect(writeAgent(dir, { name: 'x' } as AgentConfig)).rejects.toThrow(/id is required/);
  });

  it('writeAgent updates existing index entry instead of duplicating', async () => {
    await writeAgent(dir, mkAgent('a', 'A'));
    await writeAgent(dir, mkAgent('a', 'A2'));
    expect(readIndex(dir)).toEqual([{ id: 'a', name: 'A2' }]);
  });

  it('rolls a NEW agent back when its index write fails (no half-persisted orphan)', async () => {
    // Force upsertIndex to fail by making index.json a DIRECTORY: readIndex tolerates
    // it (returns []), but the atomic index write cannot replace a directory. The
    // agent.json write to agents/{id}/agent.json still succeeds first.
    fs.mkdirSync(getAgentsRootDir(dir), { recursive: true });
    fs.mkdirSync(getAgentIndexPath(dir));
    await expect(writeAgent(dir, mkAgent('agent-orphan', 'Orphan'))).rejects.toThrow();
    // A NEW agent that never made it into the index must NOT linger on disk: readAgent
    // (and the syncChatAgentsToStore durability gate keyed on it) would otherwise report
    // it durable while listAgents / the load-time registry rebuild omit it.
    expect(readAgent(dir, 'agent-orphan')).toBeNull();
    expect(fs.existsSync(getAgentDir(dir, 'agent-orphan'))).toBe(false);
  });

  it('keeps an EXISTING agent config when only the index refresh fails (no rollback on update)', async () => {
    await writeAgent(dir, mkAgent('agent-keep', 'V1'));
    // Break the index write for the follow-up update (swap index.json for a directory).
    fs.rmSync(getAgentIndexPath(dir));
    fs.mkdirSync(getAgentIndexPath(dir));
    await expect(writeAgent(dir, mkAgent('agent-keep', 'V2'))).rejects.toThrow();
    // The agent already existed, so its freshly written config is preserved — deleting
    // its dir (and knowledge) here would be the data loss the rollback guards against.
    expect(readAgent(dir, 'agent-keep')?.name).toBe('V2');
    expect(fs.existsSync(getAgentDir(dir, 'agent-keep'))).toBe(true);
  });

  it('listAgents skips index entries with missing config', async () => {
    await writeAgent(dir, mkAgent('a', 'A'));
    fs.rmSync(getAgentDir(dir, 'a'), { recursive: true, force: true });
    expect(listAgents(dir)).toEqual([]);
  });

  it('listAgents returns every agent from the single index', async () => {
    await writeAgent(dir, mkAgent('a', 'A'));
    await writeAgent(dir, mkAgent('b', 'B'));
    const ids = listAgents(dir).map((agent) => agent.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('migrates stored legacy string system prompts from indexed agent files', async () => {
    writeIndexFile(dir, 'index.json', [{ id: 'legacy-agent', name: 'Legacy Agent' }]);
    fs.mkdirSync(getAgentDir(dir, 'legacy-agent'), { recursive: true });
    fs.writeFileSync(getAgentConfigPath(dir, 'legacy-agent'), JSON.stringify({
      id: 'legacy-agent',
      name: 'Legacy Agent',
      source: 'ON-DEVICE',
      system_prompt: 'legacy prompt',
    }, null, 2));

    await expect(migrateStoredAgentSystemPrompts(dir)).resolves.toBe(true);

    const stored = JSON.parse(fs.readFileSync(getAgentConfigPath(dir, 'legacy-agent'), 'utf8'));
    expect(stored.system_prompt).toEqual({ 'Base.md': 'legacy prompt', 'AGENTS.md': '' });
  });

  it('does not rewrite stored agents that already use system prompt file maps', async () => {
    await writeAgent(dir, {
      ...mkAgent('agent-normalized', 'Normalized'),
      system_prompt: { 'Base.md': 'base', 'AGENTS.md': 'agents' },
    });

    await expect(migrateStoredAgentSystemPrompts(dir)).resolves.toBe(false);
    expect(readAgent(dir, 'agent-normalized')?.system_prompt).toEqual({ 'Base.md': 'base', 'AGENTS.md': 'agents' });
  });

  it('readIndex tolerates absent, invalid, and non-array files', () => {
    expect(readIndex(dir)).toEqual([]);
    fs.mkdirSync(getAgentsRootDir(dir), { recursive: true });
    fs.writeFileSync(getAgentIndexPath(dir), '{bad');
    expect(readIndex(dir)).toEqual([]);
    fs.writeFileSync(getAgentIndexPath(dir), JSON.stringify({ agents: 'x' }));
    expect(readIndex(dir)).toEqual([]);
  });

  it('deleteAgent removes folder and index entry; tolerates absent dir', async () => {
    await writeAgent(dir, mkAgent('a', 'A'));
    await deleteAgent(dir, 'a');
    expect(fs.existsSync(getAgentDir(dir, 'a'))).toBe(false);
    expect(readIndex(dir)).toEqual([]);
    await deleteAgent(dir, 'missing'); // no throw
  });

  describe('agent id path confinement (security)', () => {
    it('isSafeAgentId accepts one safe segment and rejects traversal/separator/empty ids', () => {
      expect(isSafeAgentId('agent-a-on-device')).toBe(true);
      expect(isSafeAgentId('agent_20260101000000_abcdefghi')).toBe(true);
      // Dots WITHOUT a path separator are still a single valid segment.
      expect(isSafeAgentId('a..b')).toBe(true);
      expect(isSafeAgentId('')).toBe(false);
      expect(isSafeAgentId('.')).toBe(false);
      expect(isSafeAgentId('..')).toBe(false);
      expect(isSafeAgentId('../evil')).toBe(false);
      expect(isSafeAgentId('a/b')).toBe(false);
      expect(isSafeAgentId('a\\b')).toBe(false);
      expect(isSafeAgentId('a\u0000b')).toBe(false);
      expect(isSafeAgentId(undefined)).toBe(false);
      expect(isSafeAgentId(123 as unknown)).toBe(false);
    });

    it('getAgentDir throws for an unsafe id and joins the path for a safe id', () => {
      expect(getAgentDir(dir, 'safe-id')).toBe(path.join(dir, 'agents', 'safe-id'));
      expect(() => getAgentDir(dir, '../../evil')).toThrow(/path-traversal/);
    });

    it('writeAgent rejects an id that escapes the agents dir', async () => {
      await expect(writeAgent(dir, mkAgent('../../evil', 'Evil'))).rejects.toThrow(/safe path segment/);
      expect(fs.existsSync(path.join(dir, 'evil'))).toBe(false);
    });

    it('readAgent returns null for an unsafe id', () => {
      expect(readAgent(dir, '../../evil')).toBeNull();
    });

    it('deleteAgent refuses an unsafe id and never removes a directory outside agents/', async () => {
      // A directory in the profile root (a sibling of agents/) that a traversal
      // id would resolve to: agents/{'../victim'} === {profileDir}/victim.
      const victim = path.join(dir, 'victim');
      fs.mkdirSync(victim, { recursive: true });
      fs.writeFileSync(path.join(victim, 'keep.txt'), 'precious');
      await deleteAgent(dir, path.join('..', 'victim')); // no throw, no-op
      expect(fs.existsSync(victim)).toBe(true);
      expect(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8')).toBe('precious');
    });
  });

  describe('consolidateLegacyAgentIndexes', () => {
    it('returns false and is a no-op when no legacy split files exist', async () => {
      expect(await consolidateLegacyAgentIndexes(dir)).toBe(false);
      // An existing single index.json is left untouched.
      await writeAgent(dir, mkAgent('a', 'A'));
      expect(await consolidateLegacyAgentIndexes(dir)).toBe(false);
      expect(readIndex(dir)).toEqual([{ id: 'a', name: 'A' }]);
    });

    it('merges active + archived split files into index.json and deletes them', async () => {
      writeIndexFile(dir, 'index_active.json', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      writeIndexFile(dir, 'index_archived.json', [{ id: 'c', name: 'C' }]);
      expect(await consolidateLegacyAgentIndexes(dir)).toBe(true);
      const ids = readIndex(dir).map((i) => i.id).sort();
      expect(ids).toEqual(['a', 'b', 'c']);
      expect(fs.existsSync(path.join(getAgentsRootDir(dir), 'index_active.json'))).toBe(false);
      expect(fs.existsSync(path.join(getAgentsRootDir(dir), 'index_archived.json'))).toBe(false);
    });

    it('keeps existing index.json entries, then active, then archived on id conflict', async () => {
      writeIndexFile(dir, 'index.json', [{ id: 'a', name: 'A-existing' }, { name: 'noid' } as AgentIndexItem]);
      writeIndexFile(dir, 'index_active.json', [{ id: 'a', name: 'A-active' }, { id: 'b', name: 'B' }]);
      writeIndexFile(dir, 'index_archived.json', [
        { id: 'b', name: 'B-archived' },
        { name: 'junk' } as AgentIndexItem,
        { id: 'c', name: 'C' },
      ]);
      expect(await consolidateLegacyAgentIndexes(dir)).toBe(true);
      const merged = readIndex(dir).sort((x, y) => x.id.localeCompare(y.id));
      expect(merged).toEqual([
        { id: 'a', name: 'A-existing' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ]);
    });

    it('consolidates when only one legacy file is present', async () => {
      writeIndexFile(dir, 'index_active.json', [{ id: 'a', name: 'A' }]);
      expect(await consolidateLegacyAgentIndexes(dir)).toBe(true);
      expect(readIndex(dir)).toEqual([{ id: 'a', name: 'A' }]);
      expect(fs.existsSync(path.join(getAgentsRootDir(dir), 'index_active.json'))).toBe(false);
      // Idempotent: a second run finds nothing to do.
      expect(await consolidateLegacyAgentIndexes(dir)).toBe(false);
    });

    it('returns false and keeps the legacy files when the merged write fails', async () => {
      writeIndexFile(dir, 'index_active.json', [{ id: 'a', name: 'A' }]);
      // Make the target index.json path an unremovable directory so the atomic
      // write (temp file + rename onto index.json) fails.
      const indexPath = path.join(getAgentsRootDir(dir), 'index.json');
      fs.mkdirSync(indexPath, { recursive: true });
      fs.writeFileSync(path.join(indexPath, 'blocker'), '1');
      expect(await consolidateLegacyAgentIndexes(dir)).toBe(false);
      // The legacy file is preserved for a later retry — no data loss.
      expect(fs.existsSync(path.join(getAgentsRootDir(dir), 'index_active.json'))).toBe(true);
    });
  });

  describe('in-memory registry', () => {
    afterEach(() => clearRegistry());

    it('sets, reads, and resolves by ids; skips id-less and unknown ids', () => {
      setRegistryAgents(dir, [mkAgent('a', 'A'), mkAgent('b', 'B'), { name: 'noid' } as AgentConfig]);
      expect(getRegistryAgent(dir, 'a')).toMatchObject({ id: 'a', name: 'A' });
      expect(getRegistryAgent(dir, 'noid')).toBeNull();
      expect(getRegistryAgentsByIds(dir, ['b', 'a', 'zzz']).map((x) => x.id)).toEqual(['b', 'a']);
    });

    it('returns null/[] when profile dir has no registry', () => {
      expect(getRegistryAgent('other', 'a')).toBeNull();
      expect(getRegistryAgentsByIds('other', ['a'])).toEqual([]);
    });

    it('clearRegistry(dir) drops only that dir; clearRegistry() drops all', () => {
      setRegistryAgents(dir, [mkAgent('a', 'A')]);
      setRegistryAgents('d2', [mkAgent('b', 'B')]);
      clearRegistry(dir);
      expect(getRegistryAgent(dir, 'a')).toBeNull();
      expect(getRegistryAgent('d2', 'b')).toMatchObject({ id: 'b' });
      clearRegistry();
      expect(getRegistryAgent('d2', 'b')).toBeNull();
    });

    it('upsertRegistryAgent creates the map on first write, replaces on repeat, skips id-less', () => {
      // No setRegistryAgents beforehand: the map must be lazily created.
      upsertRegistryAgent(dir, mkAgent('a', 'A'));
      expect(getRegistryAgent(dir, 'a')).toMatchObject({ id: 'a', name: 'A' });
      // Replace in place (same id, new content).
      upsertRegistryAgent(dir, mkAgent('a', 'A-renamed'));
      expect(getRegistryAgent(dir, 'a')).toMatchObject({ id: 'a', name: 'A-renamed' });
      // Id-less agents are ignored and never create an entry.
      upsertRegistryAgent(dir, { name: 'noid' } as AgentConfig);
      expect(getRegistryAgentsByIds(dir, ['a']).map((x) => x.id)).toEqual(['a']);
    });

    it('removeRegistryAgent evicts one entry and tolerates missing dir/id', () => {
      setRegistryAgents(dir, [mkAgent('a', 'A'), mkAgent('b', 'B')]);
      removeRegistryAgent(dir, 'a');
      expect(getRegistryAgent(dir, 'a')).toBeNull();
      expect(getRegistryAgent(dir, 'b')).toMatchObject({ id: 'b' });
      // Unknown id and unknown dir are no-ops (no throw).
      removeRegistryAgent(dir, 'zzz');
      removeRegistryAgent('other', 'a');
      expect(getRegistryAgent(dir, 'b')).toMatchObject({ id: 'b' });
    });

    it('getAllRegistryAgents snapshots every agent for a dir; [] when absent', () => {
      // Absent dir yields an empty array (no throw).
      expect(getAllRegistryAgents('other')).toEqual([]);
      setRegistryAgents(dir, [mkAgent('a', 'A'), mkAgent('b', 'B')]);
      const all = getAllRegistryAgents(dir);
      expect(all.map((x) => x.id).sort()).toEqual(['a', 'b']);
      // Reflects write-through upserts.
      upsertRegistryAgent(dir, mkAgent('c', 'C'));
      expect(getAllRegistryAgents(dir).map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('registry write-through (regression: stale chat.agent after save)', () => {
    afterEach(() => clearRegistry());

    it('writeAgent refreshes the hot registry so a post-load edit is served, not the load-time snapshot', async () => {
      // Simulate load-time population with the ORIGINAL agent (0 mcp servers).
      const loaded = { ...mkAgent('a', 'A'), mcp_servers: [] } as AgentConfig;
      setRegistryAgents(dir, [loaded]);
      expect(getRegistryAgentsByIds(dir, ['a'])[0]).toMatchObject({ mcp_servers: [] });

      // Editor save persists a new binding (2 mcp servers) via writeAgent.
      const edited = {
        ...mkAgent('a', 'A'),
        mcp_servers: [{ name: 'builtin-tools', tools: [] }, { name: 'teams', tools: [] }],
      } as AgentConfig;
      await writeAgent(dir, edited);

      // The IPC re-injection reads the registry — it MUST see the edit, not stale data.
      const served = getRegistryAgentsByIds(dir, ['a'])[0];
      expect(served.mcp_servers).toEqual([
        { name: 'builtin-tools', tools: [] },
        { name: 'teams', tools: [] },
      ]);
    });

    it('writeAgent seeds the registry even without a prior load-time snapshot', async () => {
      await writeAgent(dir, mkAgent('fresh', 'Fresh'));
      expect(getRegistryAgent(dir, 'fresh')).toMatchObject({ id: 'fresh', name: 'Fresh' });
    });

    it('deleteAgent evicts the agent from the hot registry in lockstep with disk', async () => {
      await writeAgent(dir, mkAgent('a', 'A'));
      expect(getRegistryAgent(dir, 'a')).toMatchObject({ id: 'a' });
      await deleteAgent(dir, 'a');
      expect(getRegistryAgent(dir, 'a')).toBeNull();
      expect(getRegistryAgentsByIds(dir, ['a'])).toEqual([]);
    });
  });
});
