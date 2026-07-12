import { connectRenderToMain, connectMainToRender } from './base';

// ──────────────────────────────────────────────
// External Agent IPC contract
// ──────────────────────────────────────────────

/** External Agent connection info for UI display */
export interface ExternalAgentConnectionInfo {
  addresses: string[];
  port: number;
  connected: boolean;
}

/** External Agent status info pushed from main to renderer */
export interface ExternalAgentStatusInfo {
  connected: boolean;
}

// ──────────────────────────────────────────────
// Renderer → Main (invoke/handle)
// ──────────────────────────────────────────────

type RenderToMain = {
  /** Get connection info: local IPs, port, status */
  getConnectionInfo: {
    call: [];
    return: { success: boolean; data?: ExternalAgentConnectionInfo; error?: string };
  };
};

// ──────────────────────────────────────────────
// Main → Renderer (send/on)
// ──────────────────────────────────────────────

type MainToRender = {
  /** External Agent connection status change */
  statusChanged: ExternalAgentStatusInfo;
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('externalAgent');
export const mainToRender = connectMainToRender<MainToRender>('externalAgent');
