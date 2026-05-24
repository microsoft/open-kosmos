/**
 * Generates a stable storage key for OAuth credentials of an MCP server.
 *
 * Combines the server name with a short hash of the connection-defining
 * configuration so that:
 *   - Renaming a server starts a fresh OAuth slot.
 *   - Changing the URL or auth-relevant headers invalidates old tokens.
 *   - Different servers with the same name (different configs) do not
 *     accidentally share credentials.
 *
 * Header order is normalized so that a config rewrite that changes JSON key
 * ordering does not invalidate cached tokens.
 *
 * Inspired by Claude Code's `getServerKey` (services/mcp/auth.ts:325).
 */
import { createHash } from 'crypto';
import type { McpServerConfig } from '../../userDataADO/types/profile';

const KEY_HASH_LENGTH = 16;

function sortObjectKeys<T extends Record<string, unknown> | undefined>(value: T): T {
  if (!value) return value;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries) as T;
}

/**
 * Pick only the fields that should affect the OAuth slot identity:
 *   - transport
 *   - url
 *   - headers (sorted)
 *   - oauth.clientId / oauth.callbackPort (if a user explicitly pins these,
 *     a change should invalidate previously stored tokens because the
 *     redirect URI or registered client changed)
 *
 * NOT included (intentionally):
 *   - command/args/env/cwd (stdio-only, OAuth never applies)
 *   - version (display-only)
 *   - in_use, hidden, source (UI/runtime flags)
 *   - oauth.clientSecret (rotating a secret should not force re-auth)
 *   - oauth.authServerMetadataUrl (debugging hint, not identity)
 *   - oauth.setupUrl/setupInstructions (UX text)
 */
function buildFingerprint(cfg: McpServerConfig): string {
  return JSON.stringify({
    transport: cfg.transport,
    url: cfg.url ?? '',
    headers: sortObjectKeys(cfg.headers),
    oauthClientId: cfg.oauth?.clientId,
    oauthCallbackPort: cfg.oauth?.callbackPort,
  });
}

/**
 * Returns a stable string of the form `<serverName>|<sha256-hex16>`.
 * Used as the key under `OpenKosmosTokenCache.mcpOAuth` for storing tokens
 * and DCR client information per server.
 */
export function getMcpOAuthServerKey(name: string, cfg: McpServerConfig): string {
  const fingerprint = buildFingerprint(cfg);
  const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, KEY_HASH_LENGTH);
  return `${name}|${hash}`;
}
