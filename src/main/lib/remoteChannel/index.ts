export { RemoteChannelManager } from './channelManager';
export type { RemoteChannelPlugin, InboundMessage, OutboundMessage, ChannelStatusInfo } from './types';
import { RemoteChannelManager } from "./channelManager";

/**
 * Initialize the remote channel module: create singleton and register built-in plugins.
 * Triggered on first call by the main.ts lazy getter.
 */
export async function initRemoteChannelModule(): Promise<import('./channelManager').RemoteChannelManager> {
  const manager = RemoteChannelManager.getInstance();
  return manager;
}
