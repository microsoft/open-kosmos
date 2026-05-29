/**
 * Tests for doctor/toolExecutor.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all tool modules before importing the executor
vi.mock('../tools/getAppInfo', () => ({ executeGetAppInfo: vi.fn() }));
vi.mock('../tools/getAppKnowledge', () => ({ executeGetAppKnowledge: vi.fn() }));
vi.mock('../tools/readAppLogs', () => ({ executeReadAppLogs: vi.fn() }));
vi.mock('../tools/readChatSession', () => ({ executeReadChatSession: vi.fn() }));
vi.mock('../tools/getChatMessages', () => ({ executeGetChatMessages: vi.fn() }));
vi.mock('../tools/getCrashStatus', () => ({ executeGetCrashStatus: vi.fn() }));
vi.mock('../tools/readCrashBundle', () => ({ executeReadCrashBundle: vi.fn() }));
vi.mock('../tools/readSchedules', () => ({ executeReadSchedules: vi.fn() }));
vi.mock('../tools/createGithubIssue', () => ({ executeCreateGithubIssue: vi.fn() }));
vi.mock('../tools/askUserQuestion', () => ({ executeAskUserQuestion: vi.fn() }));
vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { executeTool } from '../toolExecutor';
import { executeGetAppInfo } from '../tools/getAppInfo';
import { executeGetAppKnowledge } from '../tools/getAppKnowledge';
import { executeReadAppLogs } from '../tools/readAppLogs';
import { executeAskUserQuestion } from '../tools/askUserQuestion';

const ctx = { taskId: 'test-task-1' };

describe('executeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error JSON for an unknown tool name', async () => {
    const result = await executeTool('no_such_tool', {}, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Unknown tool: no_such_tool');
  });

  it('dispatches to executeGetAppInfo for get_app_info', async () => {
    (executeGetAppInfo as any).mockResolvedValue('{"os":"macOS"}');
    const result = await executeTool('get_app_info', {}, ctx);
    expect(executeGetAppInfo).toHaveBeenCalledOnce();
    expect(result).toBe('{"os":"macOS"}');
  });

  it('dispatches to executeGetAppKnowledge for get_app_knowledge', async () => {
    (executeGetAppKnowledge as any).mockResolvedValue('knowledge');
    await executeTool('get_app_knowledge', {}, ctx);
    expect(executeGetAppKnowledge).toHaveBeenCalledOnce();
  });

  it('passes args to executeReadAppLogs', async () => {
    (executeReadAppLogs as any).mockResolvedValue('logs');
    await executeTool('read_app_logs', { level: 'error' }, ctx);
    expect(executeReadAppLogs).toHaveBeenCalledWith({ level: 'error' });
  });

  it('passes both args and context to executeAskUserQuestion', async () => {
    (executeAskUserQuestion as any).mockResolvedValue('answer');
    await executeTool('ask_user_question', { question: 'yes?' }, ctx);
    expect(executeAskUserQuestion).toHaveBeenCalledWith({ question: 'yes?' }, ctx);
  });

  it('returns error JSON when a handler throws', async () => {
    (executeGetAppInfo as any).mockRejectedValue(new Error('disk error'));
    const result = await executeTool('get_app_info', {}, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('disk error');
  });

  it('handles non-Error throws from handlers', async () => {
    (executeGetAppInfo as any).mockRejectedValue('string error');
    const result = await executeTool('get_app_info', {}, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('string error');
  });

  it('handles null args gracefully (no crash on Object.keys)', async () => {
    (executeGetAppInfo as any).mockResolvedValue('ok');
    // Should not throw even when args is null
    await expect(executeTool('get_app_info', null, ctx)).resolves.toBe('ok');
  });
});
