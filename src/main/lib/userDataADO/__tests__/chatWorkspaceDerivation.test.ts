import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProfileV2 } from '../types/profile';

const mockGetDefaultWorkspacePath = vi.hoisted(() => vi.fn());

vi.mock('../pathUtils', () => ({
  getDefaultWorkspacePath: mockGetDefaultWorkspacePath,
}));

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { attachDerivedChatWorkspaces, stripDerivedChatWorkspacesForDisk } from '../chatWorkspaceDerivation';

function makeProfile(): ProfileV2 {
  return {
    version: '2.0.0',
    alias: 'alice',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    mcp_servers: [],
    skills: [],
    chats: [
      {
        chat_id: 'chat_20260101010101_dev_abc',
        chat_type: 'single_agent',
        workspace: '/caller/supplied',
        agent_ids: ['agent-a'],
      },
    ],
    archived_chats: [
      {
        chat_id: 'chat_20260102020202_dev_def',
        chat_type: 'single_agent',
        workspace: '/archived/supplied',
        agent_ids: ['agent-b'],
      },
    ],
    'starred-chat-sessions': [],
  } as ProfileV2;
}

describe('chatWorkspaceDerivation', () => {
  let userData: string;

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-derive-'));
    mockGetDefaultWorkspacePath.mockImplementation((alias: string, chatId: string) => {
      if (chatId.includes('/') || chatId.includes('..')) {
        throw new Error('not a safe path segment');
      }
      const workspace = path.join(userData, 'profiles', alias, 'chat_workspaces', chatId);
      fs.mkdirSync(workspace, { recursive: true });
      return workspace;
    });
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('attaches fixed chat_id-keyed workspace paths for active and archived chats', () => {
    const profile = makeProfile();

    const result = attachDerivedChatWorkspaces('alice', profile);

    expect(result).toBe(profile);
    expect(result.chats[0].workspace).toBe(
      path.join(userData, 'profiles', 'alice', 'chat_workspaces', 'chat_20260101010101_dev_abc'),
    );
    expect(result.archived_chats![0].workspace).toBe(
      path.join(userData, 'profiles', 'alice', 'chat_workspaces', 'chat_20260102020202_dev_def'),
    );
    expect(fs.existsSync(result.chats[0].workspace!)).toBe(true);
    expect(fs.existsSync(result.archived_chats![0].workspace!)).toBe(true);
  });

  it('drops unsafe chat workspace values instead of preserving caller paths', () => {
    const profile = {
      ...makeProfile(),
      chats: [{ chat_id: '../escape', chat_type: 'single_agent', workspace: '/caller/supplied', agent_ids: ['agent-a'] }],
    } as ProfileV2;

    const result = attachDerivedChatWorkspaces('alice', profile);

    expect(result.chats[0].workspace).toBeUndefined();
  });

  it('drops workspace when derivation throws a non-Error value', () => {
    mockGetDefaultWorkspacePath.mockImplementationOnce(() => {
      throw 'string failure';
    });
    const profile = makeProfile();

    const result = attachDerivedChatWorkspaces('alice', profile);

    expect(result.chats[0].workspace).toBeUndefined();
  });

  it('drops workspace when chat_id is missing or blank', () => {
    const profile = {
      ...makeProfile(),
      chats: [
        { chat_id: '', chat_type: 'single_agent', workspace: '/blank', agent_ids: ['agent-a'] },
        { chat_id: 123, chat_type: 'single_agent', workspace: '/non-string', agent_ids: ['agent-b'] },
      ],
    } as unknown as ProfileV2;

    const result = attachDerivedChatWorkspaces('alice', profile);

    expect(result.chats[0].workspace).toBeUndefined();
    expect(result.chats[1].workspace).toBeUndefined();
  });

  it('strips derived workspace fields from the disk profile without mutating the runtime profile', () => {
    const profile = makeProfile();

    const diskProfile = stripDerivedChatWorkspacesForDisk(profile);

    expect(diskProfile).not.toBe(profile);
    expect(diskProfile.chats[0].workspace).toBeUndefined();
    expect(diskProfile.archived_chats![0].workspace).toBeUndefined();
    expect(profile.chats[0].workspace).toBe('/caller/supplied');
    expect(profile.archived_chats![0].workspace).toBe('/archived/supplied');
  });

  it('leaves missing chat arrays untouched', () => {
    const profile = { version: '2.0.0', alias: 'alice' } as ProfileV2;

    expect(attachDerivedChatWorkspaces('alice', profile)).toBe(profile);
    expect(stripDerivedChatWorkspacesForDisk(profile)).toEqual(profile);
  });
});
