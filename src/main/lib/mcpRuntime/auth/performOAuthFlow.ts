/**
 * Drives an OAuth 2.0 PKCE flow against an MCP server using the SDK's
 * `auth()` helper. Throws cancelled / DCR-fallback-required /
 * `MCP_OAUTH_FLOW_FAILED` on respective failures; resolves on success
 * (tokens persisted via provider).
 */

import { auth as sdkAuth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getCallbackServer } from './CallbackServer';
import {
  createMcpAuthCancelledError,
  createMcpDcrRequiresUserClientIdError,
  createMcpOAuthFlowFailedError,
} from './errors';
import type { OpenKosmosOAuthProvider } from './OpenKosmosOAuthProvider';
import { createSyntheticMetadataFetch } from './wellKnownOAuthProviders';
import { getUnifiedLogger } from '../../unifiedLogger';

const logger = getUnifiedLogger();

export interface PerformOAuthFlowOptions {
  signal?: AbortSignal;
}

/**
 * Full authorize → callback → exchange-tokens flow. Callback port comes
 * from the provider so different servers don't share a global override.
 */
export async function performOAuthFlow(
  provider: OpenKosmosOAuthProvider,
  serverName: string,
  serverUrl: string,
  opts: PerformOAuthFlowOptions = {},
): Promise<void> {
  const { signal } = opts;
  const callbackPort = provider.pinnedCallbackPort;

  if (signal?.aborted) {
    throw createMcpAuthCancelledError(serverName);
  }

  // The SDK reads provider.redirectUrl → getCallbackServer().getRedirectUri(),
  // which throws unless the server is already listening.
  try {
    await getCallbackServer(callbackPort).ensureRunning(callbackPort);
  } catch (e) {
    throw createMcpOAuthFlowFailedError(serverName, errorMessage(e));
  }

  // Snapshot state before the first auth() call — provider.state() is
  // idempotent within an instance.
  const state = await provider.state();

  // Wrap fetch so SDK well-known probes for catalog providers (GitHub,
  // Slack, Notion …) get synthesized metadata; unknown providers pass
  // through to standard RFC 8414 / OIDC discovery.
  const fetchFn = createSyntheticMetadataFetch(globalThis.fetch);

  let firstResult: 'AUTHORIZED' | 'REDIRECT';
  try {
    firstResult = await sdkAuth(provider, { serverUrl, fetchFn });
  } catch (e) {
    if (signal?.aborted) {
      throw createMcpAuthCancelledError(serverName);
    }
    if (isDcrUnsupportedError(e)) {
      logger.info(`[McpOAuth] DCR not supported by ${serverName}; surfacing fallback dialog`, 'performOAuthFlow', {
        underlying: errorMessage(e),
      });
      throw createMcpDcrRequiresUserClientIdError(serverName);
    }
    throw createMcpOAuthFlowFailedError(serverName, errorMessage(e));
  }

  if (firstResult === 'AUTHORIZED') {
    // Cached refresh token was still valid; the SDK has already called
    // saveTokens internally.
    logger.info(`[McpOAuth] ${serverName}: cached tokens reused (no browser redirect needed)`);
    return;
  }

  // ─── Wait for the OAuth code via the local callback server ───
  let code: string;
  try {
    code = await getCallbackServer(callbackPort).waitForCode(state, { signal });
  } catch (e) {
    if (signal?.aborted) {
      throw createMcpAuthCancelledError(serverName);
    }
    throw createMcpOAuthFlowFailedError(serverName, errorMessage(e));
  }

  // ─── Second call: exchange the code for tokens ───
  let secondResult: 'AUTHORIZED' | 'REDIRECT';
  try {
    secondResult = await sdkAuth(provider, { serverUrl, authorizationCode: code, fetchFn });
  } catch (e) {
    if (signal?.aborted) {
      throw createMcpAuthCancelledError(serverName);
    }
    throw createMcpOAuthFlowFailedError(serverName, errorMessage(e));
  }

  if (secondResult !== 'AUTHORIZED') {
    throw createMcpOAuthFlowFailedError(
      serverName,
      `Token exchange returned unexpected result: ${secondResult}`,
    );
  }

  logger.info(`[McpOAuth] ${serverName}: authorization complete`);
}

/**
 * Run the SDK's `auth()` in refresh-only mode: never opens a browser.
 * Wraps the provider in a Proxy whose `redirectToAuthorization` throws
 * before `shell.openExternal` can fire, so a transient network failure
 * during proactive refresh can't surprise-pop a sign-in tab on the user.
 *
 * Resolves on success; rejects on any failure. Caller should treat any
 * rejection as "refresh did not produce a fresh token; re-evaluate".
 */
export async function runRefreshOnly(
  provider: OpenKosmosOAuthProvider,
  serverName: string,
  serverUrl: string,
  opts: PerformOAuthFlowOptions = {},
): Promise<void> {
  const { signal } = opts;

  if (signal?.aborted) {
    throw createMcpAuthCancelledError(serverName);
  }

  const fetchFn = createSyntheticMetadataFetch(globalThis.fetch);
  const refreshOnlyProvider = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'redirectToAuthorization') {
        return async (_url: URL): Promise<void> => {
          throw new Error('REFRESH_ONLY: SDK attempted to open browser, suppressed');
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as OpenKosmosOAuthProvider;

  let result: 'AUTHORIZED' | 'REDIRECT';
  try {
    result = await sdkAuth(refreshOnlyProvider, { serverUrl, fetchFn });
  } catch (e) {
    if (signal?.aborted) {
      throw createMcpAuthCancelledError(serverName);
    }
    throw e;
  }

  if (result !== 'AUTHORIZED') {
    // Unreachable: the proxy turns REDIRECT into a throw above.
    throw new Error(`REFRESH_ONLY: unexpected SDK result "${result}"`);
  }

  logger.info(`[McpOAuth] ${serverName}: proactive refresh succeeded`);
}

/**
 * Match only the SDK's own DCR-not-supported messages. Don't add HTTP-status
 * substring fallbacks — they fire on unrelated failures (token-endpoint
 * blip, misconfigured cfg.url) and push users into an irrelevant dialog.
 */
function isDcrUnsupportedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message.toLowerCase();
  return (
    m.includes('does not support dynamic client registration') ||
    m.includes('client information must be saveable for dynamic registration')
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
