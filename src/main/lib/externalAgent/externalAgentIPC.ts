import { ipcMain } from 'electron';
import * as os from 'os';
import { renderToMain } from '@shared/ipc/externalAgent';
import { useExternalAgentService } from '../../startup/lazy';

/**
 * Get local IPv4 addresses (non-internal) for display in External Agent connection UI.
 */
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

/** Filter out virtual network addresses (Docker, WSL, etc.) */
function isVirtualNetworkAddress(address: string): boolean {
  // Docker bridge: 172.17.x.x — 172.31.x.x
  const match = address.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 17 && Number(match[1]) <= 31) return true;
  return false;
}

const DEFAULT_EXTERNAL_AGENT_PORT = 51927;

/**
 * Register External Agent IPC handlers.
 */
export function registerExternalAgentIPC() {
  const handle = renderToMain.bindMain(ipcMain);

  handle.getConnectionInfo(async () => {
    try {
      const connected = useExternalAgentService(s => s.isConnected) ?? false;

      return {
        success: true,
        data: {
          addresses: getLocalIPv4Addresses(),
          port: DEFAULT_EXTERNAL_AGENT_PORT,
          connected,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
