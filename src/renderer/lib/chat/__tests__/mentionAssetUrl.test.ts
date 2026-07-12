/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/userData', () => ({
  profileDataManager: { getCurrentChat: vi.fn() },
}));
vi.mock('@/lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: { getCurrentChatSessionId: vi.fn() },
}));

import {
  resolveChatSessionFolder,
  localPathToFileUrl,
  getCurrentMentionAssetBases,
  resolveMentionAssetUrl,
  type MentionAssetBases,
} from '../mentionAssetUrl';
import { profileDataManager } from '@/lib/userData';
import { agentChatSessionCacheManager } from '@/lib/chat/agentChatSessionCacheManager';

const getCurrentChat = profileDataManager.getCurrentChat as unknown as ReturnType<typeof vi.fn>;
const getCurrentChatSessionId =
  agentChatSessionCacheManager.getCurrentChatSessionId as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveChatSessionFolder', () => {
  it('builds the deliverables folder from workspace + session id', () => {
    expect(resolveChatSessionFolder('/ws', 'chatSession_20260618100122_dev_abc')).toBe(
      '/ws/202606/chatSession_20260618100122_dev_abc',
    );
  });

  it('preserves the raw workspace path (Windows separators untouched here)', () => {
    expect(resolveChatSessionFolder('C:\\Users\\x\\ws', 'chatSession_202501_id')).toBe(
      'C:\\Users\\x\\ws/202501/chatSession_202501_id',
    );
  });

  it('returns null for empty workspace', () => {
    expect(resolveChatSessionFolder('', 'chatSession_202501_id')).toBeNull();
  });

  it('returns null for whitespace-only workspace', () => {
    expect(resolveChatSessionFolder('   ', 'chatSession_202501_id')).toBeNull();
  });

  it('returns null for undefined workspace', () => {
    expect(resolveChatSessionFolder(undefined, 'chatSession_202501_id')).toBeNull();
  });

  it('returns null for null workspace', () => {
    expect(resolveChatSessionFolder(null, 'chatSession_202501_id')).toBeNull();
  });

  it('returns null for missing session id', () => {
    expect(resolveChatSessionFolder('/ws', null)).toBeNull();
    expect(resolveChatSessionFolder('/ws', undefined)).toBeNull();
    expect(resolveChatSessionFolder('/ws', '')).toBeNull();
  });

  it('returns null when session id format is unrecognized', () => {
    expect(resolveChatSessionFolder('/ws', 'not-a-session')).toBeNull();
  });
});

describe('localPathToFileUrl', () => {
  it('encodes spaces in a unix absolute path', () => {
    expect(localPathToFileUrl('/Users/d/Application Support/x.png')).toBe(
      'file:///Users/d/Application%20Support/x.png',
    );
  });

  it('preserves the Windows drive letter and converts backslashes', () => {
    expect(localPathToFileUrl('C:\\Users\\d\\My Files\\x.png')).toBe(
      'file:///C:/Users/d/My%20Files/x.png',
    );
  });

  it('prepends a leading slash for paths without one', () => {
    expect(localPathToFileUrl('relative dir/y.png')).toBe('file:///relative%20dir/y.png');
  });

  it('encodes other reserved characters in a segment', () => {
    expect(localPathToFileUrl('/a/b#c?d.png')).toBe('file:///a/b%23c%3Fd.png');
  });
});

describe('getCurrentMentionAssetBases', () => {
  it('reads workspace, knowledge base (nested) and chat session folder', () => {
    getCurrentChat.mockReturnValue({
      workspace: '/chat-ws',
      agent: { workspace: '/legacy-agent-ws', knowledge: { knowledgeBase: '/kb' } },
    });
    getCurrentChatSessionId.mockReturnValue('chatSession_202606_dev_abc');

    expect(getCurrentMentionAssetBases()).toEqual({
      chatSessionFolder: '/chat-ws/202606/chatSession_202606_dev_abc',
      knowledgeBasePath: '/kb',
      workspacePath: '/chat-ws',
    });
  });

  it('falls back to legacy agent.knowledgeBase when nested knowledge is absent', () => {
    getCurrentChat.mockReturnValue({ workspace: '/chat-ws', agent: { workspace: '/legacy-agent-ws', knowledgeBase: '/legacy-kb' } });
    getCurrentChatSessionId.mockReturnValue('chatSession_202606_dev_abc');

    const bases = getCurrentMentionAssetBases();
    expect(bases.knowledgeBasePath).toBe('/legacy-kb');
    expect(bases.workspacePath).toBe('/chat-ws');
  });

  it('does not fall back to deprecated agent.workspace when chat workspace is missing', () => {
    getCurrentChat.mockReturnValue({ agent: { workspace: '/legacy-agent-ws' } });
    getCurrentChatSessionId.mockReturnValue('chatSession_202606_dev_abc');

    const bases = getCurrentMentionAssetBases();
    expect(bases.chatSessionFolder).toBeNull();
    expect(bases.workspacePath).toBeNull();
  });

  it('returns null/undefined bases when there is no current chat', () => {
    getCurrentChat.mockReturnValue(null);
    getCurrentChatSessionId.mockReturnValue(null);

    expect(getCurrentMentionAssetBases()).toEqual({
      chatSessionFolder: null,
      knowledgeBasePath: null,
      workspacePath: null,
    });
  });
});

describe('resolveMentionAssetUrl', () => {
  const bases: MentionAssetBases = {
    chatSessionFolder: '/ws/202606/chatSession_202606_dev_abc',
    knowledgeBasePath: '/kb',
    workspacePath: '/ws',
  };

  it('returns empty/falsy url unchanged', () => {
    expect(resolveMentionAssetUrl('', bases)).toBe('');
  });

  it('returns non-string url unchanged', () => {
    const value = 123 as unknown as string;
    expect(resolveMentionAssetUrl(value, bases)).toBe(value);
  });

  it('returns non-mention urls unchanged', () => {
    expect(resolveMentionAssetUrl('https://example.com/a.png', bases)).toBe(
      'https://example.com/a.png',
    );
    expect(resolveMentionAssetUrl('/tmp/local.png', bases)).toBe('/tmp/local.png');
    expect(resolveMentionAssetUrl('file:///tmp/local.png', bases)).toBe('file:///tmp/local.png');
    expect(resolveMentionAssetUrl('data:image/png;base64,AAAA', bases)).toBe(
      'data:image/png;base64,AAAA',
    );
  });

  it('returns @-prefixed url with an unknown scheme unchanged', () => {
    expect(resolveMentionAssetUrl('@unknown:foo.png', bases)).toBe('@unknown:foo.png');
  });

  it('resolves @chat-session: to an encoded file url', () => {
    expect(resolveMentionAssetUrl('@chat-session:example_drill.png', bases)).toBe(
      'file:///ws/202606/chatSession_202606_dev_abc/example_drill.png',
    );
  });

  it('strips a leading slash in the relative path', () => {
    expect(resolveMentionAssetUrl('@chat-session:/sub dir/shot.png', bases)).toBe(
      'file:///ws/202606/chatSession_202606_dev_abc/sub%20dir/shot.png',
    );
  });

  it('resolves @knowledge-base: against the knowledge base path', () => {
    expect(resolveMentionAssetUrl('@knowledge-base:img.png', bases)).toBe('file:///kb/img.png');
  });

  it('resolves @workspace: against the workspace path', () => {
    expect(resolveMentionAssetUrl('@workspace:img.png', bases)).toBe('file:///ws/img.png');
  });

  it('normalizes a trailing slash on the base path', () => {
    expect(resolveMentionAssetUrl('@workspace:img.png', { workspacePath: '/ws/' })).toBe(
      'file:///ws/img.png',
    );
  });

  it('returns the url unchanged when the relative path is empty', () => {
    expect(resolveMentionAssetUrl('@chat-session:', bases)).toBe('@chat-session:');
    expect(resolveMentionAssetUrl('@chat-session:///', bases)).toBe('@chat-session:///');
  });

  it('returns the url unchanged when the matching base is missing', () => {
    expect(resolveMentionAssetUrl('@chat-session:x.png', { chatSessionFolder: null })).toBe(
      '@chat-session:x.png',
    );
    expect(resolveMentionAssetUrl('@knowledge-base:x.png', {})).toBe('@knowledge-base:x.png');
    expect(resolveMentionAssetUrl('@workspace:x.png', { workspacePath: '   ' })).toBe(
      '@workspace:x.png',
    );
  });

  it('falls back to the current chat/session context when no bases are passed', () => {
    getCurrentChat.mockReturnValue({ workspace: '/live-ws' });
    getCurrentChatSessionId.mockReturnValue('chatSession_202606_dev_xyz');

    expect(resolveMentionAssetUrl('@chat-session:shot.png')).toBe(
      'file:///live-ws/202606/chatSession_202606_dev_xyz/shot.png',
    );
  });
});
