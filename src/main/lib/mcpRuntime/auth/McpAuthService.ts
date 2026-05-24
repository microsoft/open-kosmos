import { BrowserWindow } from 'electron';
import { getUnifiedLogger } from '../../unifiedLogger';
import { pickAuthUiWindow } from './authWindowSelector';
import type { McpResolvedAuthMetadata } from './types';
import {
  createMcpAuthCancelledError,
  isMcpAuthCancelledError,
  isMcpDcrRequiresUserClientIdError,
} from './errors';
import { OpenKosmosOAuthProvider, PROACTIVE_REFRESH_WINDOW_SEC } from './OpenKosmosOAuthProvider';
import { performOAuthFlow, runRefreshOnly } from './performOAuthFlow';
import { getCallbackServer } from './CallbackServer';
import { getProviderHelp } from './dcrFallbackInstructions';
import { isKnownToNotSupportDcr } from './wellKnownOAuthProviders';
import { getMcpOAuthServerKey } from './serverKey';
import { mcpAuthPromptRegistry, type McpAuthConsentDecision } from './mcpAuthPromptRegistry';
import type { McpServerConfig } from '../../userDataADO/types/profile';
import type { OAuthClientInformation } from '@modelcontextprotocol/sdk/shared/auth.js';
import type {
  McpAuthClientIdRequestPayload,
  McpAuthClientIdResponse,
} from '../../../../shared/types/mcpAuth';

const logger = getUnifiedLogger();
const VSCODE_CLIENT_ID_SCOPE_PREFIX = 'VSCODE_CLIENT_ID:';
/** Renderer-prompt timeout matches `CallbackServer.waitForCode`. On
 *  timeout/abort we resolve as cancelled so the transport surfaces a
 *  clean "needs sign-in" rather than hanging the connection. */
const MCP_AUTH_PROMPT_TIMEOUT_MS = 5 * 60_000;

type McpAuthInteractionListener = (event: {
  serverName: string;
  providerLabel: string;
  phase: 'consent-requested';
}) => void;

function summarizeClientId(clientId: string): string {
  if (clientId.length <= 8) {
    return clientId;
  }
  return `${clientId.slice(0, 4)}...${clientId.slice(-4)}`;
}

export class McpAuthService {
  private static instance: McpAuthService | null = null;
  private static interactionListeners = new Set<McpAuthInteractionListener>();
  private readonly genericTokenRequests = new Map<string, Promise<string | undefined>>();

  static getInstance(): McpAuthService {
    if (!McpAuthService.instance) {
      McpAuthService.instance = new McpAuthService();
    }
    return McpAuthService.instance;
  }

  static onInteraction(listener: McpAuthInteractionListener): () => void {
    McpAuthService.interactionListeners.add(listener);
    return () => {
      McpAuthService.interactionListeners.delete(listener);
    };
  }

  private static emitInteraction(event: {
    serverName: string;
    providerLabel: string;
    phase: 'consent-requested';
  }): void {
    for (const listener of McpAuthService.interactionListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn(`[McpAuthService] Interaction listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Acquire an access token for an MCP server using PKCE + DCR via the SDK,
   * persisted in `OpenKosmosTokenCache.mcpOAuth`.
   */
  async getTokenForServer(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    options?: { forceRefresh?: boolean; cfg?: McpServerConfig; signal?: AbortSignal },
  ): Promise<string | undefined> {
    return this.getTokenForGenericOAuth(serverName, metadata, options);
  }

  // ────────────────── Generic OAuth (non-Microsoft) ──────────────────

  /** SDK-based PKCE flow with persistence in `OpenKosmosTokenCache.mcpOAuth`. */
  private async getTokenForGenericOAuth(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    options?: { forceRefresh?: boolean; cfg?: McpServerConfig; signal?: AbortSignal },
  ): Promise<string | undefined> {
    const cfg = options?.cfg;
    if (!cfg) {
      // Without cfg we can't compute a stable serverKey; surface a controlled
      // skip rather than throwing so the transport keeps using whatever
      // Authorization header was already on the request.
      logger.warn(`[McpAuthService] Generic OAuth requested for ${serverName} but cfg was not threaded through transport — returning undefined`);
      return undefined;
    }

    // Dedupe concurrent requests for the same server (parallel transports
    // hitting 401 at startup) so we don't open two browser tabs. forceRefresh
    // latecomers join too — the in-flight flow produces fresh tokens either way.
    const dedupKey = getMcpOAuthServerKey(serverName, cfg);
    const inflight = this.genericTokenRequests.get(dedupKey);
    if (inflight) {
      logger.info(`[McpAuthService] Joining in-flight generic OAuth flow for ${serverName}`);
      return inflight;
    }

    const promise = this._performGenericOAuth(serverName, metadata, cfg, options).finally(() => {
      this.genericTokenRequests.delete(dedupKey);
    });
    this.genericTokenRequests.set(dedupKey, promise);
    return promise;
  }

  private async _performGenericOAuth(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    cfg: McpServerConfig,
    options?: { forceRefresh?: boolean; signal?: AbortSignal },
  ): Promise<string | undefined> {
    const provider = new OpenKosmosOAuthProvider(serverName, cfg);

    // Fast path / proactive refresh.
    if (!options?.forceRefresh) {
      const cachedTokens = await provider.tokens();
      if (cachedTokens?.access_token) {
        const expiresIn = cachedTokens.expires_in ?? Number.POSITIVE_INFINITY;
        if (expiresIn > PROACTIVE_REFRESH_WINDOW_SEC) {
          return cachedTokens.access_token;
        }
        // Inside the proactive refresh window: try refresh-token grant
        // directly. `runRefreshOnly` wraps the provider so the SDK's
        // would-redirect path throws instead of opening a browser — we
        // need this because the SDK silently falls through to redirect
        // on any non-OAuthError (transient 5xx, DNS hiccup, AbortSignal).
        // On any failure, fall through to the gated interactive flow.
        if (cachedTokens.refresh_token) {
          try {
            await runRefreshOnly(provider, serverName, cfg.url, {
              signal: options?.signal,
            });
            const refreshed = await provider.tokens();
            if (refreshed?.access_token) {
              return refreshed.access_token;
            }
          } catch (e) {
            if (isMcpAuthCancelledError(e instanceof Error ? e : null)) {
              throw e;
            }
            logger.info(
              `[McpAuthService] Proactive refresh failed for ${serverName} — falling through to interactive flow`,
              '_performGenericOAuth',
              { error: e instanceof Error ? e.message : String(e) },
            );
          }
        }
      }
    } else {
      // Force-refresh: zero only the access-token expiry so the SDK's
      // auth() switches to refresh-token grant. Don't use
      // invalidateCredentials('tokens') — that wipes the refresh token too
      // (per the SDK contract for that scope), defeating the whole point
      // for providers like Slack/Atlassian that issue refresh tokens.
      await provider.markAccessTokenExpired();
    }

    // Skip the doomed sdkAuth() call for known-no-DCR providers and
    // surface the fallback dialog up front.
    const hasClientInfo = !!(await provider.clientInformation());
    if (!hasClientInfo && isKnownToNotSupportDcr(metadata)) {
      logger.info(`[McpAuthService] ${serverName}: provider known to not support DCR, prompting user up front`);
      const port = provider.pinnedCallbackPort;
      try {
        await getCallbackServer(port).ensureRunning(port);
      } catch (e) {
        logger.warn(`[McpAuthService] CallbackServer ensureRunning failed: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }
      const provided = await this.requestClientIdFromUser({
        serverName,
        metadata,
        cfg,
        redirectUri: getCallbackServer(port).getRedirectUri(),
      }, { signal: options?.signal });
      if ('cancelled' in provided && provided.cancelled) {
        throw createMcpAuthCancelledError(serverName);
      }
      if (!('clientId' in provided)) {
        throw createMcpAuthCancelledError(serverName);
      }
      await provider.saveClientInformation({
        client_id: provided.clientId,
        client_secret: provided.clientSecret,
      });
    }

    const consent = await this.requestConsent(serverName, metadata.providerLabel, { signal: options?.signal });
    if (consent === 'cancel') {
      throw createMcpAuthCancelledError(serverName);
    }

    try {
      await performOAuthFlow(provider, serverName, cfg.url, {
        signal: options?.signal,
      });
    } catch (e) {
      const err = e instanceof Error ? e : null;
      if (isMcpAuthCancelledError(err)) {
        throw e;
      }
      if (isMcpDcrRequiresUserClientIdError(err)) {
        // DCR not supported and no clientId pre-configured: prompt the user.
        const port = provider.pinnedCallbackPort;
        const provided = await this.requestClientIdFromUser({
          serverName,
          metadata,
          cfg,
          redirectUri: getCallbackServer(port).getRedirectUri(),
        }, { signal: options?.signal });
        if ('cancelled' in provided && provided.cancelled) {
          throw createMcpAuthCancelledError(serverName);
        }
        if (!('clientId' in provided)) {
          throw createMcpAuthCancelledError(serverName);
        }

        await provider.saveClientInformation({
          client_id: provided.clientId,
          client_secret: provided.clientSecret,
        });

        try {
          await performOAuthFlow(provider, serverName, cfg.url, {
            signal: options?.signal,
          });
        } catch (e2) {
          const err2 = e2 instanceof Error ? e2 : null;
          if (isMcpAuthCancelledError(err2)) {
            throw e2;
          }
          logger.warn(`[McpAuthService] OAuth flow retry failed after user-supplied clientId for ${serverName}: ${err2?.message ?? String(e2)}`);
          throw e2;
        }
      } else {
        logger.warn(`[McpAuthService] Generic OAuth flow failed for ${serverName}: ${err?.message ?? String(e)}`);
        throw e;
      }
    }

    const tokens = await provider.tokens();
    return tokens?.access_token;
  }

  /**
   * Clear stored OAuth credentials for a single MCP server.
   *   - `'tokens'` (default): drop access+refresh+scope, keep clientId/secret.
   *   - `'all'`: drop everything including DCR clientId/secret.
   */
  async clearOAuthForServer(
    serverName: string,
    cfg: McpServerConfig,
    scope: 'tokens' | 'all' = 'tokens',
  ): Promise<void> {
    const provider = new OpenKosmosOAuthProvider(serverName, cfg);
    await provider.invalidateCredentials(scope);
    logger.info(`[McpAuthService] Cleared OAuth credentials for "${serverName}" (scope=${scope})`);
  }

  /**
   * Show the renderer-side "paste a client_id" dialog when the AS doesn't
   * support DCR. Honors signal + a 5-min timeout — without these the
   * promise can hang forever if the renderer crashes or the user walks away.
   */
  private async requestClientIdFromUser(
    args: {
      serverName: string;
      metadata: McpResolvedAuthMetadata;
      cfg: McpServerConfig;
      redirectUri: string;
    },
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpAuthClientIdResponse> {
    const { serverName, metadata, cfg, redirectUri } = args;
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs ?? MCP_AUTH_PROMPT_TIMEOUT_MS;

    const instructions = getProviderHelp(metadata, cfg);
    const requestId = `mcp-clientid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<McpAuthClientIdResponse>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
        mcpAuthPromptRegistry.cancelClientId(requestId);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        logger.warn(`[McpAuthService] Client-id dialog for "${serverName}" timed out after ${timeoutMs}ms — treating as cancel`);
        resolve({ cancelled: true });
      }, timeoutMs);
      timer.unref?.();

      const abortHandler = () => {
        if (settled) return;
        cleanup();
        resolve({ cancelled: true });
      };
      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      mcpAuthPromptRegistry.registerClientId(requestId, (response) => {
        if (settled) return;
        cleanup();
        resolve(response);
      });

      try {
        const targetWindow = pickAuthUiWindow(BrowserWindow.getAllWindows());
        if (!targetWindow?.webContents) {
          cleanup();
          resolve({ cancelled: true });
          return;
        }

        const payload: McpAuthClientIdRequestPayload = {
          requestId,
          serverName,
          providerLabel: instructions.label ?? metadata.providerLabel,
          redirectUri,
          instructions,
        };

        targetWindow.webContents.send('mcpAuth:requestClientId', payload);
      } catch (error) {
        logger.warn(`[McpAuthService] Failed to dispatch MCP client-id request: ${error instanceof Error ? error.message : String(error)}`);
        cleanup();
        resolve({ cancelled: true });
      }
    });
  }

  private async requestConsent(
    serverName: string,
    providerLabel: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpAuthConsentDecision> {
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs ?? MCP_AUTH_PROMPT_TIMEOUT_MS;
    const requestId = `mcp-consent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<McpAuthConsentDecision>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
        mcpAuthPromptRegistry.cancelConsent(requestId);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        logger.warn(`[McpAuthService] Consent dialog for "${serverName}" timed out after ${timeoutMs}ms — treating as cancel`);
        resolve('cancel');
      }, timeoutMs);
      timer.unref?.();

      const abortHandler = () => {
        if (settled) return;
        cleanup();
        resolve('cancel');
      };
      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      mcpAuthPromptRegistry.registerConsent(requestId, (decision) => {
        if (settled) return;
        cleanup();
        resolve(decision);
      });

      try {
        const targetWindow = pickAuthUiWindow(BrowserWindow.getAllWindows());
        if (!targetWindow?.webContents) {
          cleanup();
          resolve('cancel');
          return;
        }

        McpAuthService.emitInteraction({
          serverName,
          providerLabel,
          phase: 'consent-requested',
        });

        targetWindow.webContents.send('mcpAuth:showConsent', {
          requestId,
          serverName,
          providerLabel,
        });
      } catch (error) {
        logger.warn(`[McpAuthService] Failed to dispatch MCP auth consent: ${error instanceof Error ? error.message : String(error)}`);
        cleanup();
        resolve('cancel');
      }
    });
  }
}
