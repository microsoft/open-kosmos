// OpenClaw OpenKosmos Channel Plugin — Inbound Message Routing

import { dispatchInboundReplyWithBase } from 'openclaw/plugin-sdk/inbound-reply-dispatch';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/channel-core';
import type { ResolvedOpenKosmosAccount } from './types';

export interface OpenKosmosMessageHandler {
  sendReply: (text: string, conversationId: string) => void;
  sendReplyEnd?: (conversationId: string) => void;
  sendError: (error: string, conversationId: string) => void;
}

export interface HandleOpenKosmosInboundParams {
  cfg: OpenClawConfig;
  account: ResolvedOpenKosmosAccount;
  text: string;
  conversationId: string;
  /** The channelRuntime from ChannelGatewayContext */
  channelRuntime: any; // PluginRuntimeChannel (ChannelRuntimeSurface)
  handler: OpenKosmosMessageHandler;
}

export async function handleOpenKosmosInbound(params: HandleOpenKosmosInboundParams): Promise<void> {
  const { cfg, account, text, conversationId, channelRuntime, handler } = params;

  const from = `openkosmos:${account.accountId}`;
  const timestamp = Date.now();

  // 1. Resolve agent route
  const route = channelRuntime.routing.resolveAgentRoute({
    cfg,
    channel: 'openkosmos',
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
    channel: 'openkosmos',
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
    MessageSid: `openkosmos-${conversationId}-${timestamp}`,
  });

  // 5. Dispatch with deliver callback
  await dispatchInboundReplyWithBase({
    cfg,
    channel: 'openkosmos',
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
      console.error('[OpenKosmosPlugin] recordInboundSession error:', err);
    },
    onDispatchError: (err, info) => {
      console.error(`[OpenKosmosPlugin] dispatch error (${info.kind}):`, err);
      handler.sendError('Failed to process message', conversationId);
    },
  });

  // Signal that all reply blocks have been sent for this conversation
  if (handler.sendReplyEnd) {
    handler.sendReplyEnd(conversationId);
  }
}
