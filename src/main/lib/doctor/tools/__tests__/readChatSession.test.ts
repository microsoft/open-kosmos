import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetCurrentAuth, mockEnsureLoaded, mockGetSessionFile } = vi.hoisted(() => ({
  mockGetCurrentAuth: vi.fn(),
  mockEnsureLoaded: vi.fn(),
  mockGetSessionFile: vi.fn(),
}));

vi.mock('../../../auth/authManager', () => ({
  mainAuthManager: {
    getCurrentAuth: mockGetCurrentAuth,
  },
}));

vi.mock('../../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    ensureLoaded: mockEnsureLoaded,
    getSessionFile: mockGetSessionFile,
  },
}));

vi.mock('../../chatSession/skeletonFormatter', () => ({
  formatSkeleton: vi.fn(() => '## mock skeleton output'),
}));

import { executeReadChatSession, readChatSessionToolDef } from '../readChatSession';

describe('readChatSessionToolDef', () => {
  it('has correct name', () => {
    expect(readChatSessionToolDef.function.name).toBe('read_chat_session');
  });
});

describe('executeReadChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentAuth.mockReturnValue({ ghcAuth: { alias: 'user1' } });
  });

  it('returns error when agentId is missing', async () => {
    const result = await executeReadChatSession({ agentId: '', chatSessionId: 's1' });
    expect(result).toContain('Error');
    expect(result).toContain('required');
  });

  it('returns error when chatSessionId is missing', async () => {
    const result = await executeReadChatSession({ agentId: 'a1', chatSessionId: '' });
    expect(result).toContain('Error');
    expect(result).toContain('required');
  });

  it('returns error when no active user alias', async () => {
    mockGetCurrentAuth.mockReturnValue(null);
    const result = await executeReadChatSession({ agentId: 'a1', chatSessionId: 's1' });
    expect(result).toContain('Error');
    expect(result).toContain('alias');
  });

  it('returns error when session not found', async () => {
    mockEnsureLoaded.mockResolvedValue(null);
    const result = await executeReadChatSession({ agentId: 'a1', chatSessionId: 's1' });
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('returns error when session file not found', async () => {
    mockEnsureLoaded.mockResolvedValue({ some: 'aggregate' });
    mockGetSessionFile.mockReturnValue(null);
    const result = await executeReadChatSession({ agentId: 'a1', chatSessionId: 's1' });
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('returns formatted skeleton on success', async () => {
    mockEnsureLoaded.mockResolvedValue({ some: 'aggregate' });
    mockGetSessionFile.mockReturnValue({ chatSession_id: 's1' });
    const result = await executeReadChatSession({ agentId: 'a1', chatSessionId: 's1' });
    expect(result).toBe('## mock skeleton output');
  });

  it('returns error block on exception', async () => {
    mockEnsureLoaded.mockRejectedValue(new Error('Network error'));
    const result = await executeReadChatSession({ agentId: 'a1', chatSessionId: 's1' });
    expect(result).toContain('Error');
    expect(result).toContain('Network error');
  });
});
