import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockExecuteCommand = vi.fn();
const mockCreateMcpTransport = vi.fn();

vi.mock('../TerminalManager', () => ({
  getTerminalManager: () => ({
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
    createMcpTransport: (...args: unknown[]) => mockCreateMcpTransport(...args),
  }),
}));

import { createExecuteCommandAdapter, createMcpTransportAdapter } from '../adapters';

describe('terminalManager/adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createExecuteCommandAdapter', () => {
    it('returns an adapter with an execute function', async () => {
      const adapter = await createExecuteCommandAdapter();
      expect(typeof adapter.execute).toBe('function');
    });

    it('delegates to manager.executeCommand with correct TerminalConfig', async () => {
      const fakeResult = { exitCode: 0, stdout: 'hello', stderr: '' };
      mockExecuteCommand.mockResolvedValue(fakeResult);

      const adapter = await createExecuteCommandAdapter();
      const result = await adapter.execute({
        command: 'echo',
        args: ['hello'],
        cwd: '/tmp',
        timeoutSeconds: 10,
        shell: 'bash',
      });

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'echo',
          args: ['hello'],
          cwd: '/tmp',
          timeoutMs: 10_000,
          shell: 'bash',
          type: 'command',
          persistent: false,
        })
      );
      expect(result).toBe(fakeResult);
    });

    it('converts timeoutSeconds to timeoutMs (undefined when not provided)', async () => {
      mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      const adapter = await createExecuteCommandAdapter();
      await adapter.execute({ command: 'ls', cwd: '/tmp' });
      const cfg = mockExecuteCommand.mock.calls[0][0];
      expect(cfg.timeoutMs).toBeUndefined();
    });

    it('defaults args to [] when not provided', async () => {
      mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      const adapter = await createExecuteCommandAdapter();
      await adapter.execute({ command: 'pwd', cwd: '/home' });
      expect(mockExecuteCommand.mock.calls[0][0].args).toEqual([]);
    });
  });

  describe('createMcpTransportAdapter', () => {
    it('returns an adapter with a create function', async () => {
      const adapter = await createMcpTransportAdapter();
      expect(typeof adapter.create).toBe('function');
    });

    it('registers event handlers through the transport instance', async () => {
      const onMock = vi.fn();
      const sendMock = vi.fn();
      const stopMock = vi.fn().mockResolvedValue(undefined);
      const fakeInstance = { send: sendMock, stop: stopMock, on: onMock };
      mockCreateMcpTransport.mockResolvedValue(fakeInstance);

      const adapter = await createMcpTransportAdapter();
      const transport = await adapter.create({
        command: 'node',
        args: ['server.js'],
        cwd: '/srv',
        env: { DEBUG: 'true' },
      });

      const msgHandler = () => {};
      const errHandler = () => {};
      const exitHandler = () => {};

      transport.onMessage(msgHandler);
      transport.onError(errHandler);
      transport.onExit(exitHandler);

      expect(onMock).toHaveBeenCalledWith('message', msgHandler);
      expect(onMock).toHaveBeenCalledWith('error', errHandler);
      expect(onMock).toHaveBeenCalledWith('exit', exitHandler);
    });

    it('delegates send and stop to the underlying instance', async () => {
      const sendMock = vi.fn();
      const stopMock = vi.fn().mockResolvedValue(undefined);
      mockCreateMcpTransport.mockResolvedValue({ send: sendMock, stop: stopMock, on: vi.fn() });

      const adapter = await createMcpTransportAdapter();
      const transport = await adapter.create({ command: 'node', args: [], cwd: '/srv' });

      transport.send('{"jsonrpc":"2.0"}');
      expect(sendMock).toHaveBeenCalledWith('{"jsonrpc":"2.0"}');

      await transport.stop();
      expect(stopMock).toHaveBeenCalled();
    });

    it('passes the provided cwd to the terminal config', async () => {
      mockCreateMcpTransport.mockResolvedValue({ send: vi.fn(), stop: vi.fn(), on: vi.fn() });
      const adapter = await createMcpTransportAdapter();
      await adapter.create({ command: 'node', args: [], cwd: '/custom/path' });
      const cfg = mockCreateMcpTransport.mock.calls[0][0];
      expect(cfg.cwd).toBe('/custom/path');
      expect(cfg.type).toBe('mcp_transport');
      expect(cfg.persistent).toBe(true);
    });
  });
});
