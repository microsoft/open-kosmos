# MCP Online OAuth Authentication

## Status

Implemented. Last verified: 2026-07-11.

## Scope

OpenKosmos supports standards-based OAuth for user-configured HTTP and SSE MCP servers. The implementation is provider-neutral and does not contain tenant-specific authorities, client registrations, token brokers, or Microsoft authentication fallbacks.

## Architecture

1. The transport receives a `401` or `403` response and passes `WWW-Authenticate` metadata to `McpAuthMetadataService`.
2. `McpAuthService` resolves the authorization metadata and creates an `OpenKosmosOAuthProvider`.
3. `performOAuthFlow` uses the MCP SDK's authorization-code flow with PKCE and Dynamic Client Registration when supported.
4. `CallbackServer` receives the loopback redirect and routes it by OAuth state.
5. `OpenKosmosTokenCache` stores credentials in the profile-scoped `mcpOAuth` map.
6. The transport retries with the resulting access token.

The renderer exposes generic consent and manual-client-ID dialogs through `mcpAuth:*` IPC. Prompt waits are bounded and honor cancellation.

## Persistence Compatibility

`OpenKosmosTokenCache` accepts old cache files that contain retired tenant-provider, account, refresh, or region fields. Loading reconstructs the persisted object from the provider-neutral `mcpOAuth` map, rewrites the sanitized cache locally, and performs no network request.

## Security and Privacy

- OAuth credentials are keyed by a hash of the MCP server identity and OAuth configuration.
- Callback requests require the expected state value.
- No private tenant, organization, authority, or client registration is built in.
- Logs must not include access tokens, refresh tokens, authorization codes, client secrets, or full OAuth payloads.

## Compatibility Requirements

- Preserve GitHub and other standards-compliant MCP OAuth providers.
- Support servers that require a user-supplied client ID when DCR is unavailable.
- Treat DCR restrictions as explicit connection errors rather than silently changing auth mechanisms.
- Keep credential reset scoped to the selected MCP server.

## Verification

Unit coverage lives under `src/main/lib/mcpRuntime/auth/__tests__/` and covers metadata discovery, callback routing, DCR fallback, proactive refresh, cancellation, credential invalidation, and legacy-cache sanitization.
