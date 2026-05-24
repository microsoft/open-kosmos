// Mock unifiedLogger
vi.mock('../../../unifiedLogger', async () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Create mock background process manager
const mockBgManager = {
  list: vi.fn(),
  poll: vi.fn(),
  log: vi.fn(),
  kill: vi.fn(),
};

vi.mock('../../../backgroundProcessManager', async () => ({
  getBackgroundProcessManager: () => mockBgManager,
}));

import { ManageProcessTool } from '../manageProcessTool';

describe('ManageProcessTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute({ action: "list" })', () => {
    it('calls bgManager.list() and returns formatted result', async () => {
      const mockSessions = [
        {
          sessionId: 'bg_123_abc',
          command: 'npm start',
          status: 'running' as const,
          pid: 1234,
          startTime: Date.now(),
          durationMs: 5000,
        },
        {
          sessionId: 'bg_456_def',
          command: 'npm test',
          status: 'exited' as const,
          pid: 5678,
          startTime: Date.now() - 10000,
          durationMs: 3000,
          exitCode: 0,
        },
      ];
      mockBgManager.list.mockReturnValue(mockSessions);

      const result = await ManageProcessTool.execute({ action: 'list' });

      expect(mockBgManager.list).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        action: 'list',
        sessions: mockSessions,
      });
    });
  });

  describe('execute({ action: "poll" })', () => {
    it('calls bgManager.poll() with sessionId', async () => {
      mockBgManager.poll.mockReturnValue({
        status: 'running',
        pid: 1234,
        durationMs: 5000,
      });

      const result = await ManageProcessTool.execute({
        action: 'poll',
        sessionId: 'bg_123_abc',
      });

      expect(mockBgManager.poll).toHaveBeenCalledWith('bg_123_abc');
      expect(result).toEqual({
        action: 'poll',
        sessionId: 'bg_123_abc',
        status: 'running',
        pid: 1234,
        durationMs: 5000,
      });
    });
  });

  describe('execute({ action: "log" })', () => {
    it('calls bgManager.log() with default options', async () => {
      mockBgManager.log.mockReturnValue({
        lines: ['line1', 'line2'],
        nextOffset: 2,
        totalLines: 2,
        droppedCount: 0,
        done: false,
      });

      const result = await ManageProcessTool.execute({
        action: 'log',
        sessionId: 'bg_123_abc',
      });

      expect(mockBgManager.log).toHaveBeenCalledWith('bg_123_abc', {
        offset: undefined,
        limit: undefined,
      });
      expect(result).toEqual({
        action: 'log',
        sessionId: 'bg_123_abc',
        lines: ['line1', 'line2'],
        nextOffset: 2,
        totalLines: 2,
        droppedCount: 0,
        done: false,
      });
    });

    it('passes offset and limit options through', async () => {
      mockBgManager.log.mockReturnValue({
        lines: ['line10', 'line11'],
        nextOffset: 12,
        totalLines: 50,
        droppedCount: 0,
        done: false,
      });

      const result = await ManageProcessTool.execute({
        action: 'log',
        sessionId: 'bg_123_abc',
        offset: 10,
        limit: 20,
      });

      expect(mockBgManager.log).toHaveBeenCalledWith('bg_123_abc', {
        offset: 10,
        limit: 20,
      });
      expect((result as any).nextOffset).toBe(12);
    });
  });

  describe('execute({ action: "kill" })', () => {
    it('calls bgManager.kill() with sessionId', async () => {
      mockBgManager.kill.mockResolvedValue({
        success: true,
        message: 'Process killed successfully',
      });

      const result = await ManageProcessTool.execute({
        action: 'kill',
        sessionId: 'bg_123_abc',
      });

      expect(mockBgManager.kill).toHaveBeenCalledWith('bg_123_abc');
      expect(result).toEqual({
        action: 'kill',
        sessionId: 'bg_123_abc',
        success: true,
        message: 'Process killed successfully',
      });
    });
  });

  describe('validation', () => {
    it('throws on missing action', async () => {
      await expect(
        ManageProcessTool.execute({} as any)
      ).rejects.toThrow('Invalid manage_process arguments');
    });

    it('throws on invalid action value', async () => {
      await expect(
        ManageProcessTool.execute({ action: 'invalid' as any })
      ).rejects.toThrow('action must be one of: list, poll, log, kill');
    });

    it('throws on poll without sessionId', async () => {
      await expect(
        ManageProcessTool.execute({ action: 'poll' })
      ).rejects.toThrow('sessionId is required for poll/log/kill actions');
    });

    it('throws on log without sessionId', async () => {
      await expect(
        ManageProcessTool.execute({ action: 'log' })
      ).rejects.toThrow('sessionId is required for poll/log/kill actions');
    });

    it('throws on kill without sessionId', async () => {
      await expect(
        ManageProcessTool.execute({ action: 'kill' })
      ).rejects.toThrow('sessionId is required for poll/log/kill actions');
    });

    it('throws on negative offset', async () => {
      await expect(
        ManageProcessTool.execute({
          action: 'log',
          sessionId: 'bg_123_abc',
          offset: -1,
        })
      ).rejects.toThrow('offset must be a non-negative number');
    });

    it('throws on zero limit', async () => {
      await expect(
        ManageProcessTool.execute({
          action: 'log',
          sessionId: 'bg_123_abc',
          limit: 0,
        })
      ).rejects.toThrow('limit must be a positive number');
    });

    it('throws on negative limit', async () => {
      await expect(
        ManageProcessTool.execute({
          action: 'log',
          sessionId: 'bg_123_abc',
          limit: -5,
        })
      ).rejects.toThrow('limit must be a positive number');
    });
  });
});
