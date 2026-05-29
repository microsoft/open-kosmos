// ═══════════════════════════════════════════
// Remote Channel Plugin — Type Definitions
// ═══════════════════════════════════════════

/** Channel metadata */
export interface ChannelMeta {
  label: string;
  icon?: string;
}

/** Channel capabilities declaration */
export interface ChannelCapabilities {
  chatTypes: ('direct' | 'channel')[];
  media: boolean;
}

export interface InboundFileAttachment {
  kind: 'file';
  name: string;
  url: string;
  sharePointUrl?: string;
}

export interface InboundInlineImageAttachment {
  kind: 'inline-image';
  name: string;
  url: string;
  token: string;
}

/** Inbound attachment metadata */
export type InboundAttachment = InboundFileAttachment | InboundInlineImageAttachment;

/** Inbound message — entering the system from a remote channel */
export interface InboundMessage {
  channelId: string;
  activityId: string;
  text: string;
  userId: string;
  userName?: string;
  conversationId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  attachments?: InboundAttachment[];
}

/** Outbound message — sent back from the system to a remote channel */
export interface OutboundMessage {
  text: string;
  replyToConversationId: string;
  metadata?: Record<string, unknown>;
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

/** Gateway context — passed to Plugin gateway.start() */
export interface GatewayContext {
  alias: string;
  publicUrl?: string;
  abortSignal: AbortSignal;
  onInboundMessage: (message: InboundMessage) => void;
  onStatusChange: (status: ChannelStatus, error?: string) => void;
  onUnbound?: (reason?: string) => void;
}

/** Remote channel plugin interface */
export interface RemoteChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  config: {
    isConfigured: (alias: string) => boolean | Promise<boolean>;
    isEnabled: (alias: string) => boolean;
  };

  gateway: {
    start: (ctx: GatewayContext) => Promise<void>;
    stop: () => Promise<void>;
    bind?: (code: string) => Promise<{ success: boolean; userId?: string; error?: string }>;
    unbind?: () => Promise<void>;
  };

  outbound: {
    textChunkLimit: number;
    sendText: (message: OutboundMessage) => Promise<void>;
    sendProactive?: (userId: string, text: string) => Promise<void>;
    sendTyping?: () => Promise<void>;
  };
}
