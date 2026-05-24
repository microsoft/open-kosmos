/**
 * Tests for executeCommandTool background execution mode (K group)
 */

// Mock unifiedLogger
vi.mock('../../../unifiedLogger', async () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock backgroundProcessManager
const mockSpawn = vi.fn();
vi.mock('../../../backgroundProcessManager', async () => ({
  getBackgroundProcessManager: () => ({
    spawn: mockSpawn,
  }),
}));

// Mock terminalManager (needed by executeCommandTool's non-background path)
vi.mock('../../../terminalManager', async () => ({
  getTerminalManager: () => ({
    createInstance: vi.fn(),
    stopInstance: vi.fn(),
  }),
}));

// Mock builtinToolsManager execution context
vi.mock('../builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getExecutionContext: () => null,
  },
}));

import { ExecuteCommandTool } from '../executeCommandTool';
import { ExecuteCommandBackgroundResult } from '@shared/types/toolCallArgs';

describe('ExecuteCommandTool — background mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('K1: background=true calls bgManager.spawn and returns { sessionId, pid, background: true }', async () => {
    mockSpawn.mockResolvedValue({
      sessionId: 'bg_123_abc',
      pid: 4567,
    });

    const result = await ExecuteCommandTool.execute({
      description: 'Run dev server in background',
      command: 'npm run dev',
      cwd: '/tmp/project',
      background: true,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sessionId: 'bg_123_abc',
      pid: 4567,
      background: true,
    });
  });

  it('K2: background=false does not call bgManager.spawn', async () => {
    await expect(
      ExecuteCommandTool.execute({
        description: 'Run command normally',
        command: 'echo hello',
        cwd: '/tmp',
        background: false,
      })
    ).rejects.toThrow(); // sync path throws due to incomplete mock — that's expected

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('K3: background=true passes cwd and shell to spawn options', async () => {
    mockSpawn.mockResolvedValue({
      sessionId: 'bg_456_def',
      pid: 7890,
    });

    await ExecuteCommandTool.execute({
      description: 'Run with bash',
      command: 'make build',
      cwd: '/home/user/project',
      shell: 'bash',
      background: true,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'make build',
      expect.objectContaining({
        cwd: '/home/user/project',
        shell: 'bash',
      })
    );
  });

  it('K4: background=true with args does not duplicate arguments', async () => {
    mockSpawn.mockResolvedValue({
      sessionId: 'bg_789_ghi',
      pid: 1111,
    });

    await ExecuteCommandTool.execute({
      description: 'Run npm with args',
      command: 'npm',
      args: ['run', 'dev'],
      cwd: '/tmp/project',
      background: true,
    });

    // spawn should receive the already-built command line
    expect(mockSpawn).toHaveBeenCalledWith(
      'npm run dev',  // pre-built by buildCommandLine
      expect.any(Object)
    );
  });
});
