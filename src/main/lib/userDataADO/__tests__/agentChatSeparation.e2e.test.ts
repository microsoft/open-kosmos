import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyProfileMigrations } from '../profileMigration';
import { extractAgentsToStore, hydrateChatsFromStore, stripInlineChatAgentsForDisk } from '../agentExtraction';
import { readAgent, readIndex, getAgentConfigPath } from '../agentStoreManager';
import { ProfileV2 } from '../types/profile';

function makeProfileV5(): ProfileV2 {
  return {
    version: '2.0.0',
    alias: 'alice',
    profileMigrationVersion: 5,
    mcp_servers: [],
    skills: [],
    chats: [{
      chat_id: 'chat_1',
      chat_type: 'single_agent',
      agent: { name: 'Kobi', model: 'm', source: 'ON-DEVICE', mcp_servers: [] },
    }],
  } as never;
}

describe('agent/chat separation — end to end', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsep-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('migrates, extracts to disk, and rehydrates after inline is stripped', async () => {
    const profile = makeProfileV5();

    // v6 mints a stable UUID id and derives agent_ids from it
    expect(applyProfileMigrations(profile)).toBe(true);
    const agentId = profile.chats[0].agent_ids?.[0] as string;
    expect(agentId).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
    expect(profile.chats[0].agent?.id).toBe(agentId);

    // extraction materializes the standalone store
    expect(await extractAgentsToStore(dir, profile)).toBe(1);
    expect(fs.existsSync(getAgentConfigPath(dir, agentId))).toBe(true);
    expect(readIndex(dir).map((i) => i.id)).toEqual([agentId]);

    // simulate a profile.json that only stores the mapping
    delete profile.chats[0].agent;
    expect(hydrateChatsFromStore(dir, profile)).toBe(true);
    expect((profile.chats[0].agent as { name?: string } | undefined)?.name).toBe('Kobi');
    expect(readAgent(dir, agentId)?.name).toBe('Kobi');
  });

  it('strips inline agents from the disk copy once the store holds them, then rehydrates', async () => {
    const profile = makeProfileV5();
    applyProfileMigrations(profile);
    const agentId = profile.chats[0].agent_ids?.[0] as string;
    expect(agentId).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
    await extractAgentsToStore(dir, profile);

    // disk copy carries only chat_id + agent_ids (inline removed)
    const disk = stripInlineChatAgentsForDisk(dir, profile);
    expect(disk.chats[0].agent).toBeUndefined();
    expect(disk.chats[0].agent_ids).toEqual([agentId]);
    // original profile (cache) keeps inline
    expect(profile.chats[0].agent).toBeDefined();

    // a fresh load of the stripped profile rehydrates from the store
    expect(hydrateChatsFromStore(dir, disk)).toBe(true);
    expect((disk.chats[0].agent as { name?: string } | undefined)?.name).toBe('Kobi');
  });
});
