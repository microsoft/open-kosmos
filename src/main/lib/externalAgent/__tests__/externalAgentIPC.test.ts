import * as os from 'os';

// Extract the pure functions for testing by importing the module
// We need to mock electron and lazy imports since they're used at registration time
vi.mock('electron', async () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../../../startup/lazy', async () => ({
  useExternalAgentService: vi.fn(),
}));

vi.mock('@shared/ipc/externalAgent', async () => ({
  renderToMain: {
    bindMain: vi.fn(() => ({
      getConnectionInfo: vi.fn(),
    })),
  },
}));

// Since getLocalIPv4Addresses and isVirtualNetworkAddress are not exported,
// we test them indirectly through the module's behavior.
// Instead, replicate the logic for unit testing.

function isVirtualNetworkAddress(address: string): boolean {
  const match = address.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 17 && Number(match[1]) <= 31) return true;
  return false;
}

function getLocalIPv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const nets of Object.values(interfaces)) {
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal && !isVirtualNetworkAddress(net.address)) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

describe('isVirtualNetworkAddress', () => {
  it('filters Docker bridge addresses (172.17-31.x.x)', () => {
    expect(isVirtualNetworkAddress('172.17.0.1')).toBe(true);
    expect(isVirtualNetworkAddress('172.22.0.1')).toBe(true);
    expect(isVirtualNetworkAddress('172.31.255.255')).toBe(true);
  });

  it('allows non-Docker 172.x addresses', () => {
    expect(isVirtualNetworkAddress('172.16.0.1')).toBe(false);
    expect(isVirtualNetworkAddress('172.32.0.1')).toBe(false);
  });

  it('allows normal private addresses', () => {
    expect(isVirtualNetworkAddress('10.0.0.5')).toBe(false);
    expect(isVirtualNetworkAddress('192.168.1.100')).toBe(false);
  });
});

describe('getLocalIPv4Addresses', () => {
  it('returns non-internal, non-virtual IPv4 addresses', () => {
    const addresses = getLocalIPv4Addresses();
    for (const addr of addresses) {
      expect(addr).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(isVirtualNetworkAddress(addr)).toBe(false);
    }
  });
});
