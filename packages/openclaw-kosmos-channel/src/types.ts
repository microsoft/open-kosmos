// OpenClaw Kosmos Channel Plugin — Protocol & Config Types
//
// Protocol direction (from plugin's perspective):
//   ServerMessage = Kosmos WS server → Plugin (client)
//   ClientMessage = Plugin (client) → Kosmos WS server

import type { OpenClawConfig } from 'openclaw/plugin-sdk/channel-core';

// ====== Client → Server (Plugin → Kosmos) ======

/** Authentication request (first message after WS connection) */
export interface AuthMessage {
  type: 'auth';
  token: string;
}

/** Push message from OpenClaw agent (streaming chunk) */
export interface PushMessage {
  type: 'push';
  text: string;
  conversationId: string;
}

/** Signals that all push blocks for a conversation have been sent */
export interface PushEndMessage {
  type: 'push_end';
  conversationId: string;
}

export type ClientMessage = AuthMessage | PushMessage | PushEndMessage;

// ====== Server → Client (Kosmos → Plugin) ======

/** Authentication succeeded */
export interface AuthSuccessMessage {
  type: 'auth_success';
}

/** Authentication failed */
export interface AuthErrorMessage {
  type: 'auth_error';
  error: string;
}

/** User message from Kosmos */
export interface TextMessage {
  type: 'message';
  text: string;
  conversationId: string;
}

/** Error from server */
export interface ErrorMessage {
  type: 'error';
  error: string;
  conversationId?: string;
}

export type ServerMessage =
  | AuthSuccessMessage
  | AuthErrorMessage
  | TextMessage
  | ErrorMessage;

// ====== Plugin Configuration Types ======

/**
 * Kosmos config as it appears in OpenClaw config.yaml:
 * ```yaml
 * plugins:
 *   entries:
 *     kosmos:
 *       enabled: true
 *       config:
 *         url: "ws://localhost:9527"
 *         accounts:
 *           <openclaw-agent-id>:
 *             token: "auth-token-from-kosmos"
 * ```
 */
export interface KosmosAccountEntry {
  token?: string;
}

export interface KosmosChannelConfig {
  /** WebSocket URL to connect to Kosmos (e.g. ws://localhost:9527) */
  url?: string;
  accounts?: Record<string, KosmosAccountEntry>;
}

/** Type alias for OpenClaw config */
export type KosmosConfig = OpenClawConfig;

// ====== Resolved Account Types ======

/** Resolved account after config lookup */
export interface ResolvedKosmosAccount {
  accountId: string;
  token: string;
  configured: boolean;
}
