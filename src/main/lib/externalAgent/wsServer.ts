import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

export interface ExternalAgentWsServerConfig {
  port: number;
}

export type TokenValidator = (token: string) => boolean;
export type PushHandler = (text: string, conversationId: string, token: string) => void;
export type PushEndHandler = (conversationId: string, token: string) => void;
export type ConnectionHandler = () => void;

export class ExternalAgentWsServer {
  private wss: WebSocketServer | null = null;
  private authenticatedClients = new Map<string, WebSocket>(); // token → ws
  private config: ExternalAgentWsServerConfig;
  private tokenValidator: TokenValidator | null = null;
  private onPushHandler: PushHandler | null = null;
  private onPushEndHandler: PushEndHandler | null = null;
  private onConnectedHandler: ConnectionHandler | null = null;
  private onDisconnectedHandler: ConnectionHandler | null = null;

  // Auth failure tracking per IP: count consecutive failures, reset on success
  private authFailures = new Map<string, number>();
  private static readonly AUTH_FAILURE_THRESHOLD = 5;

  // Connection rate limiting: track recent connections per IP
  private recentConnections = new Map<string, number[]>(); // ip → timestamps
  private static readonly MAX_CONNECTIONS_PER_WINDOW = 5;
  private static readonly CONNECTION_WINDOW_MS = 5_000;

  constructor(config: ExternalAgentWsServerConfig) {
    this.config = config;
  }

  setTokenValidator(validator: TokenValidator): void {
    this.tokenValidator = validator;
  }

  onPush(handler: PushHandler): void {
    this.onPushHandler = handler;
  }

  onPushEnd(handler: PushEndHandler): void {
    this.onPushEndHandler = handler;
  }

  onConnected(handler: ConnectionHandler): void {
    this.onConnectedHandler = handler;
  }

  onDisconnected(handler: ConnectionHandler): void {
    this.onDisconnectedHandler = handler;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.config.port });
    logger.info('[ExternalAgent WS] Server listening', 'start', { port: this.config.port });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const ip = req.socket.remoteAddress ?? 'unknown';
      const failures = this.authFailures.get(ip) ?? 0;
      if (failures >= ExternalAgentWsServer.AUTH_FAILURE_THRESHOLD) {
        logger.warn('[ExternalAgent WS] IP blocked after auth failures', 'onConnection', { ip, failures });
        ws.close(4008, 'too many auth failures');
        return;
      }

      // Rate limit: max N connections per IP within time window
      const now = Date.now();
      const timestamps = (this.recentConnections.get(ip) ?? []).filter(
        t => now - t < ExternalAgentWsServer.CONNECTION_WINDOW_MS
      );
      timestamps.push(now);
      this.recentConnections.set(ip, timestamps);
      if (timestamps.length > ExternalAgentWsServer.MAX_CONNECTIONS_PER_WINDOW) {
        logger.warn('[ExternalAgent WS] Connection rate limit exceeded', 'onConnection', { ip, count: timestamps.length });
        ws.close(4010, 'rate limit exceeded');
        return;
      }

      logger.debug('[ExternalAgent WS] Client connected, waiting for auth');

      let authToken: string | null = null;
      const authTimeout = setTimeout(() => {
        logger.warn('[ExternalAgent WS] Auth timeout, closing');
        ws.close(1008, 'auth timeout');
      }, 10000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'auth') {
            if (this.tokenValidator && this.tokenValidator(msg.token)) {
              clearTimeout(authTimeout);
              authToken = msg.token;
              // Close existing connection for this token (prevent duplicate sessions)
              const existing = this.authenticatedClients.get(msg.token);
              if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
                logger.info('[ExternalAgent WS] Closing previous connection for same token');
                existing.close(4009, 'replaced by new connection');
              }
              this.authenticatedClients.set(msg.token, ws);
              this.authFailures.delete(ip);
              ws.send(JSON.stringify({ type: 'auth_success' }));
              logger.debug('[ExternalAgent WS] Client authenticated');
              this.onConnectedHandler?.();
            } else {
              const newFailures = (this.authFailures.get(ip) ?? 0) + 1;
              this.authFailures.set(ip, newFailures);
              logger.warn('[ExternalAgent WS] Auth failed', 'onConnection', { ip, attempts: newFailures, threshold: ExternalAgentWsServer.AUTH_FAILURE_THRESHOLD });
              ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
              ws.close(4004, 'invalid token');
            }
            return;
          }

          if (!authToken) {
            ws.close(4004, 'not authenticated');
            return;
          }

          if (msg.type === 'push') {
            logger.info('[ExternalAgent WS] Received push', 'onMessage', { conversationId: msg.conversationId, textLength: msg.text?.length ?? 0 });
            if (msg.text != null && msg.conversationId) {
              this.onPushHandler?.(msg.text, msg.conversationId, authToken);
            }
          } else if (msg.type === 'push_end') {
            logger.info('[ExternalAgent WS] Received push_end', 'onMessage', { conversationId: msg.conversationId });
            if (msg.conversationId) {
              this.onPushEndHandler?.(msg.conversationId, authToken);
            }
          }
        } catch (err) {
          logger.error('[ExternalAgent WS] Failed to parse message', 'onMessage', { error: String(err) });
        }
      });

      ws.on('close', () => {
        clearTimeout(authTimeout);
        if (authToken && this.authenticatedClients.get(authToken) === ws) {
          this.authenticatedClients.delete(authToken);
          logger.info('[ExternalAgent WS] Authenticated client disconnected');
          if (this.authenticatedClients.size === 0) {
            this.onDisconnectedHandler?.();
          }
        }
      });
    });
  }

  sendMessage(text: string, conversationId: string, token: string): boolean {
    const client = this.authenticatedClients.get(token);
    if (!client || client.readyState !== 1) {
      logger.warn(`[ExternalAgent WS] sendMessage FAILED: no open client for token`);
      return false;
    }
    client.send(JSON.stringify({ type: 'message', text, conversationId }));
    return true;
  }

  stop(): void {
    for (const client of this.authenticatedClients.values()) {
      client.close();
    }
    this.authenticatedClients.clear();
    this.authFailures.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  get isConnected(): boolean {
    return [...this.authenticatedClients.values()].some(ws => ws.readyState === 1);
  }
}
