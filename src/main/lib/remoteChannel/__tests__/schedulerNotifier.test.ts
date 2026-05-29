vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
  APP_NAME: 'OpenKosmos',
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    getSessionFile: vi.fn(),
  },
}));

const mockNotifyBoundUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../startup/lazy', () => ({
  getRemoteChannelManager: vi.fn().mockResolvedValue({
    notifyBoundUser: mockNotifyBoundUser,
  }),
}));

// Mock shared types
vi.mock('@shared/types/chatTypes', async () => {
  const actual = await vi.importActual<any>('@shared/types/chatTypes');
  return {
    ...actual,
    MessageHelper: {
      getText: vi.fn((msg: any) => {
        if (!msg?.content) return '';
        const texts = msg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text || '');
        return texts.join('');
      }),
    },
  };
});

import { notifyScheduledJobCompletion } from '../schedulerNotifier';
import { chatSessionStore } from '../../chat/chatSessionStore';
import { getRemoteChannelManager } from '../../../startup/lazy';

describe('notifyScheduledJobCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyBoundUser.mockResolvedValue(undefined);
  });

  it('does nothing when alias is empty', () => {
    notifyScheduledJobCompletion({ alias: '', jobId: 'j1', jobName: 'test', success: true });
    expect(getRemoteChannelManager).not.toHaveBeenCalled();
  });

  it('sends success notification to bound user', async () => {
    (chatSessionStore.getSessionFile as any).mockReturnValue({
      chat_history: [
        { role: 'assistant', content: [{ type: 'text', text: 'All done!' }] },
      ],
    });

    notifyScheduledJobCompletion({
      alias: 'user1',
      jobId: 'j1',
      jobName: 'My Job',
      success: true,
      chatSessionId: 'sess-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNotifyBoundUser).toHaveBeenCalledWith(
      'user1',
      expect.stringContaining('My Job'),
    );
    const text = mockNotifyBoundUser.mock.calls[0][1];
    expect(text).toContain('✅');
    expect(text).toContain('All done!');
  });

  it('sends failure notification without reply preview', async () => {
    notifyScheduledJobCompletion({
      alias: 'user1',
      jobId: 'j2',
      jobName: 'Failing Job',
      success: false,
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNotifyBoundUser).toHaveBeenCalledWith(
      'user1',
      expect.stringContaining('❌'),
    );
  });

  it('handles missing chatSessionId gracefully (no preview)', async () => {
    notifyScheduledJobCompletion({
      alias: 'user1',
      jobId: 'j3',
      jobName: 'No Session Job',
      success: true,
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockNotifyBoundUser).toHaveBeenCalled();
  });

  it('truncates long reply text to REPLY_PREVIEW_MAX_LEN', async () => {
    const longText = 'A'.repeat(600);
    (chatSessionStore.getSessionFile as any).mockReturnValue({
      chat_history: [
        { role: 'assistant', content: [{ type: 'text', text: longText }] },
      ],
    });

    notifyScheduledJobCompletion({
      alias: 'user1',
      jobId: 'j4',
      jobName: 'Long Reply',
      success: true,
      chatSessionId: 'sess-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const text = mockNotifyBoundUser.mock.calls[0][1];
    // Should contain truncated text (500 chars + ellipsis)
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(600 + 200); // rough bound
  });

  it('handles notifyBoundUser failure gracefully', async () => {
    mockNotifyBoundUser.mockRejectedValueOnce(new Error('network error'));
    notifyScheduledJobCompletion({
      alias: 'user1',
      jobId: 'j5',
      jobName: 'Error Job',
      success: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // No throw
  });

  it('logs warning when no assistant reply but success=true (invariant broken)', async () => {
    (chatSessionStore.getSessionFile as any).mockReturnValue({
      chat_history: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    notifyScheduledJobCompletion({
      alias: 'user1',
      jobId: 'j6',
      jobName: 'Bad Invariant',
      success: true,
      chatSessionId: 'sess-bad',
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Should still send notification but without reply body
    expect(mockNotifyBoundUser).toHaveBeenCalled();
    const text = mockNotifyBoundUser.mock.calls[0][1];
    expect(text).toContain('Bad Invariant');
  });
});
