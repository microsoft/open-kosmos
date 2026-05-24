import type { ChannelPlugin, OpenClawConfig } from 'openclaw/plugin-sdk/channel-core';
import { WebSocket } from 'ws';
import { handleKosmosInbound } from './inbound';
import type { ResolvedKosmosAccount, KosmosAccountEntry, ServerMessage, ClientMessage } from './types';

const CHANNEL_ID = 'kosmos';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// Active WS client connections per account (only after auth success)
const activeClients = new Map<string, WebSocket>();
// Reconnect timers
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Abort flag
const aborted = new Set<string>();
// Generation counter per account — stale close handlers compare against this
const generation = new Map<string, number>();

function cleanupAccount(accountId: string): void {
  aborted.add(accountId);
  const timer = reconnectTimers.get(accountId);
  if (timer) { clearTimeout(timer); reconnectTimers.delete(accountId); }
  const ws = activeClients.get(accountId);
  if (ws) { ws.close(); activeClients.delete(accountId); }
}

function getPluginConfig(cfg: OpenClawConfig): Record<string, any> {
  return (cfg as any).plugins?.entries?.kosmos?.config ?? {};
}

function getAccountEntries(cfg: OpenClawConfig): Record<string, KosmosAccountEntry> {
  return getPluginConfig(cfg).accounts ?? {};
}

function resolveKosmosAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedKosmosAccount {
  const accounts = getAccountEntries(cfg);
  const id = accountId ?? 'default';
  const entry: KosmosAccountEntry = accounts[id] ?? {};
  return { accountId: id, token: entry.token ?? '', configured: !!entry.token };
}

export const kosmosPlugin: ChannelPlugin<ResolvedKosmosAccount> = {
  id: CHANNEL_ID,
  meta: { id: 'kosmos' as any, label: 'Kosmos', selectionLabel: 'Kosmos Desktop', docsPath: '/plugins/kosmos', blurb: 'Connect Kosmos desktop app to OpenClaw' },
  capabilities: { chatTypes: ['direct'] },

  config: {
    listAccountIds: (cfg) => Object.keys(getAccountEntries(cfg)),
    resolveAccount: (cfg, accountId) => resolveKosmosAccount(cfg, accountId),
    isConfigured: (account) => account.configured,
  },

  setup: {
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const plugins = (cfg as any).plugins ?? {};
      const entries = plugins.entries ?? {};
      const kosmos = entries.kosmos ?? {};
      const config = kosmos.config ?? {};
      const accounts = config.accounts ?? {};
      accounts[accountId] = { ...accounts[accountId], token: input.token };
      return { ...cfg, plugins: { ...plugins, entries: { ...entries, kosmos: { ...kosmos, config: { ...config, accounts } } } } } as OpenClawConfig;
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const { cfg, accountId, account, abortSignal, setStatus, log, channelRuntime } = ctx;
      const pluginConfig = getPluginConfig(cfg);
      const url = pluginConfig.url;

      if (!url) {
        log?.error?.(`[KosmosPlugin] No url configured for account: ${accountId}`);
        setStatus({ accountId, configured: false, enabled: true });
        return;
      }

      // Clean up any existing connection/reconnect timer before starting fresh
      cleanupAccount(accountId);
      aborted.delete(accountId);
      const gen = (generation.get(accountId) ?? 0) + 1;
      generation.set(accountId, gen);
      let reconnectAttempts = 0;

      function connect() {
        if (aborted.has(accountId)) return;

        log?.info?.(`[KosmosPlugin] Connecting to Kosmos at ${url} (account: ${accountId})`);
        const ws = new WebSocket(url);

        ws.on('open', () => {
          log?.info?.(`[KosmosPlugin] Connected to Kosmos, sending auth`);
          reconnectAttempts = 0;
          const authMsg: ClientMessage = { type: 'auth', token: account.token };
          ws.send(JSON.stringify(authMsg));
        });

        ws.on('message', async (data) => {
          try {
            const msg = JSON.parse(data.toString()) as ServerMessage;
            if (msg.type === 'auth_success') {
              log?.info?.(`[KosmosPlugin] Authenticated with Kosmos`);
              activeClients.set(accountId, ws);
              setStatus({ accountId, configured: true, enabled: true, connected: true, running: true });
            } else if (msg.type === 'auth_error') {
              log?.warn?.(`[KosmosPlugin] Auth rejected: ${msg.error}`);
            } else if (msg.type === 'message') {
              log?.info?.(`[KosmosPlugin] Received message from Kosmos (account: ${accountId}, conv: ${msg.conversationId}, text length: ${msg.text?.length ?? 0})`);
              if (!channelRuntime) {
                log?.warn?.(`[KosmosPlugin] channelRuntime not available`);
                return;
              }
              await handleKosmosInbound({
                cfg,
                account: resolveKosmosAccount(cfg, accountId),
                text: msg.text,
                conversationId: msg.conversationId,
                channelRuntime,
                handler: {
                  sendReply: (text: string, convId: string) => {
                    const activeWs = activeClients.get(accountId) ?? ws;
                    if (activeWs.readyState !== WebSocket.OPEN) {
                      throw new Error(`Cannot send push — WebSocket not open (readyState: ${activeWs.readyState}, account: ${accountId}, conv: ${convId})`);
                    }
                    log?.info?.(`[KosmosPlugin] Sending push to Kosmos (account: ${accountId}, conv: ${convId}, text length: ${text?.length ?? 0})`);
                    const push: ClientMessage = { type: 'push', text, conversationId: convId };
                    activeWs.send(JSON.stringify(push));
                  },
                  sendReplyEnd: (convId: string) => {
                    const activeWs = activeClients.get(accountId) ?? ws;
                    if (activeWs.readyState !== WebSocket.OPEN) {
                      throw new Error(`Cannot send push_end — WebSocket not open (readyState: ${activeWs.readyState}, account: ${accountId}, conv: ${convId})`);
                    }
                    log?.info?.(`[KosmosPlugin] Sending push_end to Kosmos (account: ${accountId}, conv: ${convId})`);
                    const end: ClientMessage = { type: 'push_end', conversationId: convId };
                    activeWs.send(JSON.stringify(end));
                  },
                  sendError: (error: string, convId: string) => {
                    const activeWs = activeClients.get(accountId) ?? ws;
                    if (activeWs.readyState !== WebSocket.OPEN) {
                      log?.warn?.(`[KosmosPlugin] Cannot send error — WebSocket not open (readyState: ${activeWs.readyState}, account: ${accountId}, conv: ${convId})`);
                      return; // error delivery is best-effort, don't throw
                    }
                    log?.warn?.(`[KosmosPlugin] Sending error to Kosmos (account: ${accountId}, conv: ${convId}, error: ${error})`);
                    activeWs.send(JSON.stringify({ type: 'error', error, conversationId: convId }));
                  },
                },
              });
            } else if (msg.type === 'error') {
              log?.warn?.(`[KosmosPlugin] Error from Kosmos: ${msg.error}`);
            }
          } catch (err) {
            log?.error?.(`[KosmosPlugin] Failed to parse message: ${err}`);
          }
        });

        ws.on('close', (code) => {
          log?.info?.(`[KosmosPlugin] Disconnected from Kosmos (code: ${code})`);
          // Stale close handler from a previous generation — ignore entirely
          if (generation.get(accountId) !== gen) {
            log?.info?.(`[KosmosPlugin] Stale close handler (gen ${gen} vs current ${generation.get(accountId)}), ignoring`);
            return;
          }
          // Only remove from activeClients if this ws is still the active one
          // (a newer connection may have already replaced us)
          if (activeClients.get(accountId) === ws) {
            activeClients.delete(accountId);
          }
          setStatus({ accountId, configured: true, enabled: true, connected: false });
          // 4004 = invalid token — do not reconnect
          // 4009 = replaced by newer connection — do not reconnect (the new one is active)
          // 4010 = rate limited — delay before reconnecting
          if (code === 4004) {
            log?.error?.(`[KosmosPlugin] Auth token rejected by Kosmos, stopping reconnect for account: ${accountId}`);
            aborted.add(accountId);
            return;
          }
          if (code === 4009) {
            log?.info?.(`[KosmosPlugin] Connection replaced by newer session, not reconnecting (account: ${accountId})`);
            return;
          }
          if (code === 4010) {
            log?.warn?.(`[KosmosPlugin] Rate limited by Kosmos, backing off (account: ${accountId})`);
            reconnectAttempts = Math.max(reconnectAttempts, 5); // force long backoff
          }
          scheduleReconnect();
        });

        ws.on('error', (err) => {
          log?.error?.(`[KosmosPlugin] WebSocket error: ${err.message}`);
        });
      }

      function scheduleReconnect() {
        if (aborted.has(accountId)) return;
        reconnectAttempts++;
        const base = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_MS);
        const delay = Math.round(base * (0.5 + Math.random() * 0.5));
        log?.info?.(`[KosmosPlugin] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        const timer = setTimeout(connect, delay);
        reconnectTimers.set(accountId, timer);
      }

      connect();

      // Keep startAccount alive until abort — prevents gateway auto-restart.
      // Gateway sets running=false when startAccount's promise resolves,
      // which triggers auto-restart. We must hold the promise open.
      await new Promise<void>((resolve) => {
        abortSignal.addEventListener('abort', () => {
          cleanupAccount(accountId);
          resolve();
        }, { once: true });
      });
    },

    stopAccount: async (ctx) => {
      cleanupAccount(ctx.accountId);
      ctx.log?.info?.(`[KosmosPlugin] Stopped account: ${ctx.accountId}`);
    },
  },

  outbound: {
    deliveryMode: 'direct',
    textChunkLimit: 20000,
    // Sends the full text as a single push + push_end pair (non-streaming).
    // OpenClaw's buffered block dispatcher handles chunking before calling this.
    sendText: async ({ text, to, threadId, accountId }) => {
      const conversationId = to ?? threadId?.toString() ?? 'default';
      const ws = activeClients.get(accountId ?? 'default');
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`No connected Kosmos client for account: ${accountId}`);
      }
      const push: ClientMessage = { type: 'push', text, conversationId };
      ws.send(JSON.stringify(push));
      const end: ClientMessage = { type: 'push_end', conversationId };
      ws.send(JSON.stringify(end));
      return { channel: CHANNEL_ID as any, messageId: `kosmos-${Date.now()}` };
    },
  },
};
