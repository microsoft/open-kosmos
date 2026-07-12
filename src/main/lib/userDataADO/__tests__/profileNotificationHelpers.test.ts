import { describe, it, expect, vi } from 'vitest';
import {
  emitSidecarChangeEvents,
  buildRendererProfilePayload,
  reinjectInlineChatAgents,
  mapChatSessionProjection,
  findNotificationTargetWindow,
} from '../profileNotificationHelpers';

const fakeWindow = (title: string, destroyed = false) =>
  ({ title, isDestroyed: () => destroyed } as any);

describe('profileNotificationHelpers.emitSidecarChangeEvents', () => {
  it('sends agents/skills/hooks change events with the slices', () => {
    const send = vi.fn();
    emitSidecarChangeEvents({ send } as any, 'alice', {
      agents: [{ id: 'a1', name: 'A1' } as any],
      skills: [{ name: 'skill-x' } as any],
      hooks: [{ id: 'hook-y' } as any],
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith(
      'agents:changed',
      expect.objectContaining({ alias: 'alice', agents: [{ id: 'a1', name: 'A1' }] }),
    );
    expect(send).toHaveBeenCalledWith(
      'skills:changed',
      expect.objectContaining({ alias: 'alice', skills: [{ name: 'skill-x' }] }),
    );
    expect(send).toHaveBeenCalledWith(
      'hooks:changed',
      expect.objectContaining({ alias: 'alice', hooks: [{ id: 'hook-y' }] }),
    );
  });
});

describe('profileNotificationHelpers.findNotificationTargetWindow', () => {
  it('returns the preferred window without enumerating when it is alive', () => {
    const preferred = fakeWindow('OpenKosmos AI Studio');
    const getWindows = vi.fn(() => [] as any[]);
    expect(findNotificationTargetWindow(preferred, getWindows, undefined)).toBe(preferred);
    expect(getWindows).not.toHaveBeenCalled();
  });

  it('enumerates when the preferred window is destroyed and matches exact brand title', () => {
    const dead = fakeWindow('OpenKosmos AI Studio', true);
    const match = fakeWindow('OpenKosmos AI Studio');
    const getWindows = vi.fn(() => [fakeWindow('Other'), match]);
    expect(findNotificationTargetWindow(dead, getWindows, undefined)).toBe(match);
    expect(getWindows).toHaveBeenCalledTimes(1);
  });

  it('matches by provided APP_NAME title', () => {
    const match = fakeWindow('Custom App');
    expect(findNotificationTargetWindow(undefined, () => [fakeWindow('Nope'), match], 'Custom App')).toBe(match);
  });

  it('matches a title that merely contains a known brand token', () => {
    const openkosmos = fakeWindow('My OpenKosmos Window');
    expect(findNotificationTargetWindow(null, () => [openkosmos], 'Unrelated')).toBe(openkosmos);
  });

  it('falls back to the sole open window when nothing matches', () => {
    const only = fakeWindow('Totally Different');
    expect(findNotificationTargetWindow(null, () => [only], undefined)).toBe(only);
  });

  it('returns undefined when no match and more than one window is open', () => {
    const windows = [fakeWindow('Alpha'), fakeWindow('Beta')];
    expect(findNotificationTargetWindow(null, () => windows, undefined)).toBeUndefined();
  });
});

describe('profileNotificationHelpers.buildRendererProfilePayload', () => {
  const sidecars = {
    mcp_servers: [{ name: 'builtin-tools' } as any],
    skills: [{ name: 's' } as any],
    hooks: [{ id: 'h' } as any],
  };

  it('strips inline agent/agents from each chat and re-attaches sidecars + alias', () => {
    const profile: any = {
      version: '2.0.0',
      alias: 'stale',
      chats: [
        { chat_id: 'c1', agent_ids: ['a1'], agent: { id: 'a1' }, agents: [{ id: 'a1' }] },
        { chat_id: 'c2', agent_ids: ['a2'] },
      ],
    };

    const registered = [{ id: 'a1' } as any, { id: 'a2' } as any];
    const out = buildRendererProfilePayload(profile, 'alice', sidecars, registered);

    expect(out.alias).toBe('alice');
    expect(out.mcp_servers).toEqual(sidecars.mcp_servers);
    expect(out.skills).toEqual(sidecars.skills);
    expect(out.hooks).toEqual(sidecars.hooks);
    expect(out.chats).toHaveLength(2);
    expect(out.chats[0]).not.toHaveProperty('agent');
    expect(out.chats[0]).not.toHaveProperty('agents');
    expect(out.chats[0].agent_ids).toEqual(['a1']);
    expect(out.chats[1].agent_ids).toEqual(['a2']);
    // Input is not mutated.
    expect(profile.chats[0]).toHaveProperty('agent');
  });

  it('keeps the inline agent facade when the chat\'s agent is NOT durable in the registry', () => {
    const profile: any = {
      version: '2.0.0',
      alias: 'stale',
      chats: [
        // a1 IS registered -> durable -> stripped.
        { chat_id: 'c1', agent_ids: ['a1'], agent: { id: 'a1', name: 'Alpha' } },
        // a2 is NOT registered (its store write failed) -> keep inline so the
        // renderer's resolveChatAgent inline fallback still renders it.
        { chat_id: 'c2', agent_ids: ['a2'], agent: { id: 'a2', name: 'Beta' } },
      ],
    };

    const out = buildRendererProfilePayload(profile, 'alice', sidecars, [{ id: 'a1' } as any]);

    expect(out.chats[0]).not.toHaveProperty('agent');
    expect(out.chats[1]).toHaveProperty('agent');
    expect((out.chats[1] as any).agent).toEqual({ id: 'a2', name: 'Beta' });
  });

  it('keeps inline for a partial multi-agent chat when any id is missing from the registry', () => {
    const profile: any = {
      version: '2.0.0',
      chats: [
        {
          chat_id: 'c1',
          agent_ids: ['a1', 'a2'],
          agents: [{ id: 'a1' }, { id: 'a2' }],
        },
      ],
    };

    // Only a1 is durable; a2 is missing -> the whole chat keeps its inline facade.
    const out = buildRendererProfilePayload(profile, 'alice', sidecars, [{ id: 'a1' } as any]);

    expect(out.chats[0]).toHaveProperty('agents');
    expect((out.chats[0] as any).agents).toHaveLength(2);
  });

  it('passes chats through untouched when chats is not an array', () => {
    const profile: any = { version: '2.0.0', chats: undefined };
    const out = buildRendererProfilePayload(profile, 'bob', sidecars, []);
    expect(out.chats).toBeUndefined();
    expect(out.alias).toBe('bob');
    expect(out.hooks).toEqual(sidecars.hooks);
  });
});

describe('profileNotificationHelpers.reinjectInlineChatAgents', () => {
  const agentA = { id: 'a1', name: 'Alpha', model: 'gpt-4' } as any;
  const agentB = { id: 'a2', name: 'Beta', model: 'gpt-4' } as any;

  it('returns the profile unchanged when chats is not an array', () => {
    const profile: any = { version: '2.0.0', chats: undefined };
    const out = reinjectInlineChatAgents(profile, [agentA]);
    expect(out).toBe(profile);
  });

  it('returns the profile unchanged when chats is empty', () => {
    const profile: any = { version: '2.0.0', chats: [] };
    const out = reinjectInlineChatAgents(profile, [agentA]);
    expect(out).toBe(profile);
  });

  it('leaves a chat untouched when it has no agent_ids', () => {
    const profile: any = { chats: [{ chat_id: 'c1' }] };
    const out = reinjectInlineChatAgents(profile, [agentA]);
    expect(out.chats[0]).not.toHaveProperty('agent');
  });

  it('leaves a chat untouched when it already carries an inline agent', () => {
    const existing = { id: 'a1', name: 'Stale' };
    const profile: any = { chats: [{ chat_id: 'c1', agent_ids: ['a1'], agent: existing }] };
    const out = reinjectInlineChatAgents(profile, [agentA]);
    expect(out.chats[0].agent).toBe(existing);
  });

  it('leaves a chat untouched when it already carries inline agents[]', () => {
    const existing = [{ id: 'a1', name: 'Stale' }];
    const profile: any = { chats: [{ chat_id: 'c1', agent_ids: ['a1'], agents: existing }] };
    const out = reinjectInlineChatAgents(profile, [agentA]);
    expect(out.chats[0].agents).toBe(existing);
    expect(out.chats[0]).not.toHaveProperty('agent');
  });

  it('leaves a chat untouched when its agent_ids resolve to nothing', () => {
    const profile: any = { chats: [{ chat_id: 'c1', agent_ids: ['missing'] }] };
    const out = reinjectInlineChatAgents(profile, [agentA]);
    expect(out.chats[0]).not.toHaveProperty('agent');
  });

  it('re-injects a single resolved agent as the inline primary', () => {
    const profile: any = { chats: [{ chat_id: 'c1', agent_ids: ['a1'] }] };
    const out = reinjectInlineChatAgents(profile, [agentA, agentB]);
    expect(out.chats[0].agent).toBe(agentA);
    expect(out.chats[0]).not.toHaveProperty('agents');
  });

  it('re-injects multiple resolved agents as agent + agents[] in id order', () => {
    const profile: any = { chats: [{ chat_id: 'c1', agent_ids: ['a2', 'a1'] }] };
    const out = reinjectInlineChatAgents(profile, [agentA, agentB]);
    expect(out.chats[0].agent).toBe(agentB);
    expect(out.chats[0].agents).toEqual([agentB, agentA]);
  });

  it('does not mutate the input profile or its chats', () => {
    const chat = { chat_id: 'c1', agent_ids: ['a1'] };
    const profile: any = { chats: [chat] };
    reinjectInlineChatAgents(profile, [agentA]);
    expect(chat).not.toHaveProperty('agent');
  });
});

describe('profileNotificationHelpers.mapChatSessionProjection', () => {
  it('includes every optional scheduler/starred field when present', () => {
    const row = {
      chatSession_id: 's1',
      last_updated: 123,
      title: 'T',
      readStatus: 'read',
      starred: true,
      starredAt: 10,
      schedulerJobId: 'job1',
      schedulerExecutionStatus: 'running',
      schedulerStartedAt: 20,
      schedulerCompletedAt: 30,
      schedulerError: 'boom',
      source: { type: 'schedule' },
    };
    const out = mapChatSessionProjection(row) as any;
    expect(out).toMatchObject({
      chatSession_id: 's1',
      last_updated: 123,
      title: 'T',
      readStatus: 'read',
      starred: true,
      starredAt: 10,
      schedulerJobId: 'job1',
      schedulerExecutionStatus: 'running',
      schedulerStartedAt: 20,
      schedulerCompletedAt: 30,
      schedulerError: 'boom',
    });
    expect(out.source).toEqual({ type: 'schedule' });
    expect(out.source).not.toBe(row.source); // shallow-copied
  });

  it('omits absent optional fields and leaves source undefined', () => {
    const row = { chatSession_id: 's2', last_updated: 1, title: 'X', readStatus: 'unread' };
    const out = mapChatSessionProjection(row) as any;
    expect(out).not.toHaveProperty('starred');
    expect(out).not.toHaveProperty('starredAt');
    expect(out).not.toHaveProperty('schedulerJobId');
    expect(out).not.toHaveProperty('schedulerExecutionStatus');
    expect(out).not.toHaveProperty('schedulerStartedAt');
    expect(out).not.toHaveProperty('schedulerCompletedAt');
    expect(out).not.toHaveProperty('schedulerError');
    expect(out.source).toBeUndefined();
  });

  it('includes starred when it is boolean false', () => {
    const out = mapChatSessionProjection({
      chatSession_id: 's3',
      last_updated: 1,
      title: 'Y',
      readStatus: 'read',
      starred: false,
    }) as any;
    expect(out).toHaveProperty('starred', false);
  });
});
