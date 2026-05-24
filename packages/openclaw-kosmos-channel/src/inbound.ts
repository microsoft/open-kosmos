// OpenClaw Kosmos Channel Plugin — Inbound Message Routing

import { dispatchInboundReplyWithBase } from 'openclaw/plugin-sdk/inbound-reply-dispatch';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/channel-core';
import type { ResolvedKosmosAccount } from './types';

export interface KosmosMessageHandler {
  sendReply: (text: string, conversationId: string) => void;
  sendReplyEnd?: (conversationId: string) => void;
  sendError: (error: string, conversationId: string) => void;
}

export interface HandleKosmosInboundParams {
  cfg: OpenClawConfig;
  account: ResolvedKosmosAccount;
  text: string;
  conversationId: string;
  /** The channelRuntime from ChannelGatewayContext */
  channelRuntime: any; // PluginRuntimeChannel (ChannelRuntimeSurface)
  handler: KosmosMessageHandler;
}

export async function handleKosmosInbound(params: HandleKosmosInboundParams): Promise<void> {
  const { cfg, account, text, conversationId, channelRuntime, handler } = params;

  const from = `kosmos:${account.accountId}`;
  const timestamp = Date.now();

  // 1. Resolve agent route
  const route = channelRuntime.routing.resolveAgentRoute({
    cfg,
    channel: 'kosmos',
    accountId: account.accountId,
    peer: { kind: 'direct', id: conversationId },
  });

  if (!route) {
    handler.sendError('No agent route configured', conversationId);
    return;
  }

  // 2. Resolve store path
  const storePath = channelRuntime.session.resolveStorePath(undefined, {
    agentId: route.agentId,
  });

  // 3. Format envelope
  const envelope = channelRuntime.reply.formatAgentEnvelope({
    channel: 'kosmos',
    from,
    body: text,
    timestamp,
  });

  // 4. Finalize inbound context
  const ctxPayload = channelRuntime.reply.finalizeInboundContext({
    Body: text,
    BodyForAgent: envelope,
    RawBody: text,
    CommandBody: text,
    From: from,
    SessionKey: route.sessionKey,
    AccountId: account.accountId,
    MessageSid: `kosmos-${conversationId}-${timestamp}`,
  });

  // 5. Dispatch with deliver callback
  await dispatchInboundReplyWithBase({
    cfg,
    channel: 'kosmos',
    accountId: account.accountId,
    route: { agentId: route.agentId, sessionKey: route.sessionKey },
    storePath,
    ctxPayload,
    core: {
      channel: {
        session: {
          recordInboundSession: channelRuntime.session.recordInboundSession,
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
        },
      },
    },
    replyOptions: { disableBlockStreaming: false },
    deliver: async (payload) => {
      handler.sendReply(payload.text ?? '', conversationId);
    },
    onRecordError: (err) => {
      console.error('[KosmosPlugin] recordInboundSession error:', err);
    },
    onDispatchError: (err, info) => {
      console.error(`[KosmosPlugin] dispatch error (${info.kind}):`, err);
      handler.sendError('Failed to process message', conversationId);
    },
  });

  // Signal that all reply blocks have been sent for this conversation
  if (handler.sendReplyEnd) {
    handler.sendReplyEnd(conversationId);
  }
}
