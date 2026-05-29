// OpenClaw OpenKosmos Channel Plugin — Protocol & Config Types
//
// Protocol direction (from plugin's perspective):
//   ServerMessage = OpenKosmos WS server → Plugin (client)
//   ClientMessage = Plugin (client) → OpenKosmos WS server

import type { OpenClawConfig } from 'openclaw/plugin-sdk/channel-core';

// ====== Client → Server (Plugin → OpenKosmos) ======

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

// ====== Server → Client (OpenKosmos → Plugin) ======

/** Authentication succeeded */
export interface AuthSuccessMessage {
  type: 'auth_success';
}

/** Authentication failed */
export interface AuthErrorMessage {
  type: 'auth_error';
  error: string;
}

/** User message from OpenKosmos */
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
 * OpenKosmos config as it appears in OpenClaw config.yaml:
 * ```yaml
 * plugins:
 *   entries:
 *     openkosmos:
 *       enabled: true
 *       config:
 *         url: "ws://localhost:9527"
 *         accounts:
 *           <openclaw-agent-id>:
 *             token: "auth-token-from-openkosmos"
 * ```
 */
export interface OpenKosmosAccountEntry {
  token?: string;
}

export interface OpenKosmosChannelConfig {
  /** WebSocket URL to connect to OpenKosmos (e.g. ws://localhost:9527) */
  url?: string;
  accounts?: Record<string, OpenKosmosAccountEntry>;
}

/** Type alias for OpenClaw config */
export type OpenKosmosConfig = OpenClawConfig;

// ====== Resolved Account Types ======

/** Resolved account after config lookup */
export interface ResolvedOpenKosmosAccount {
  accountId: string;
  token: string;
  configured: boolean;
}
