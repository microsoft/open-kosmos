import { connectRenderToMain, connectMainToRender } from './base';

// ──────────────────────────────────────────────
// IPC contract types (inline definitions, serving as the Single Source of Truth for inter-process types)
//
// Structurally consistent with Step 1 (profile.ts) / Step 2 (types.ts),
// the main process implementation must ensure structural compatibility.
// ──────────────────────────────────────────────

/** Channel configuration */
export interface ChannelConfig {
  boundChatId?: string;
}

/** Remote channels overall configuration */
export interface RemoteChannelsConfig {
  [channelId: string]: ChannelConfig;
}

/** Channel runtime status */
export type ChannelStatus = 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';

/** Channel status details */
export interface ChannelStatusInfo {
  channelId: string;
  status: ChannelStatus;
  error?: string;
  startedAt?: number;
  publicUrl?: string;
}

// ──────────────────────────────────────────────
// Renderer → Main (invoke/handle)
// ──────────────────────────────────────────────

type RenderToMain = {
  /** Read remote channel configuration */
  getConfig: {
    call: [];
    return: { success: boolean; data?: RemoteChannelsConfig; error?: string };
  };
  /** Update configuration, automatically restart affected channels */
  updateConfig: {
    call: [config: Partial<RemoteChannelsConfig>];
    return: { success: boolean; error?: string };
  };
  /** Get status of a single channel */
  getStatus: {
    call: [channelId: string];
    return: { success: boolean; data?: ChannelStatusInfo; error?: string };
  };
  /** Get status of all channels */
  getAllStatus: {
    call: [];
    return: { success: boolean; data?: ChannelStatusInfo[]; error?: string };
  };
  /** Start channel */
  start: {
    call: [channelId: string];
    return: { success: boolean; error?: string };
  };
  /** Stop channel */
  stop: {
    call: [channelId: string];
    return: { success: boolean; error?: string };
  };
  /** Pairing bind — called after user enters the pairing code */
  bind: {
    call: [params: { channelId: string; code: string }];
    return: { success: boolean; data?: { userId: string }; error?: string };
  };
  /** Remove binding */
  unbind: {
    call: [params: { channelId: string }];
    return: { success: boolean; error?: string };
  };
  /** Get binding status */
  getBindingStatus: {
    call: [params: { channelId: string }];
    return: { success: boolean; data?: { bound: boolean; userId?: string }; error?: string };
  };
};

// ──────────────────────────────────────────────
// Main → Renderer (send/on)
// ──────────────────────────────────────────────

type MainToRender = {
  /** Channel status change notification */
  statusChanged: ChannelStatusInfo;
  /** Binding status change notification */
  bindingChanged: { channelId: string; bound: boolean };
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('remoteChannel');
export const mainToRender = connectMainToRender<MainToRender>('remoteChannel');
