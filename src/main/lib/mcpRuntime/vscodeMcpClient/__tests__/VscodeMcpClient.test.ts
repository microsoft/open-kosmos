import { EventEmitter } from 'events';
import { VscodeMcpClient } from '../VscodeMcpClient';

class FakeTransport extends EventEmitter {
  public state: { state: 'stopped' | 'running' | 'error' } = { state: 'stopped' };

  async start(): Promise<void> {
    this.state = { state: 'running' };
  }

  send(_message: string): void {
    setImmediate(() => {
      this.state = { state: 'error' };
      this.emit('stateChange', {
        state: 'error',
        message: 'spawn failed'
      });
    });
  }

  async stop(): Promise<void> {
    this.state = { state: 'stopped' };
  }
}

const mockCreateFromVscodeConfig = vi.fn();

vi.mock('../transport/VscodeTransportFactory', async () => ({
  VscodeTransportFactory: {
    createFromVscodeConfig: (...args: unknown[]) => mockCreateFromVscodeConfig(...args)
  }
}));

vi.mock('../../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => ({
    log: vi.fn()
  }))
}));

describe('VscodeMcpClient', () => {
  beforeEach(() => {
    mockCreateFromVscodeConfig.mockReset();
  });

  it('rejects initialization when the transport errors during startup', async () => {
    const transport = new FakeTransport();
    mockCreateFromVscodeConfig.mockReturnValue(transport);

    const client = new VscodeMcpClient({
      name: 'flink',
      type: 'stdio',
      command: 'node',
      args: ['server.js']
    });

    await expect(client.connect()).rejects.toThrow('spawn failed');
  });
});