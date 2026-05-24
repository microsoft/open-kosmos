/**
 * Cross-process types for MCP authentication flows.
 *
 * These shapes are exchanged between the main process (which orchestrates
 * the OAuth flow) and the renderer process (which surfaces consent and
 * fallback dialogs to the user) through the preload bridge.
 *
 * Keep this file dependency-free so both bundles can import it cheaply.
 */

/**
 * Payload for `mcpAuth:requestClientId`. Sent from main to renderer when an
 * MCP server's authorization server does not support Dynamic Client
 * Registration (RFC 7591) and the user has not pre-configured a `clientId`
 * in `.mcp.json`.
 *
 * The renderer renders a dialog that:
 *   - Shows `providerLabel` and `serverName`.
 *   - Renders `instructions.steps` with `{redirectUri}` and `{serverName}`
 *     placeholders substituted client-side.
 *   - Provides a "Copy redirect URI" affordance using `redirectUri`.
 *   - If `instructions.setupUrl` is present, adds an "Open registration page"
 *     button.
 *
 * The renderer responds via `mcpAuth:respondClientId`.
 */
export interface McpAuthClientIdRequestPayload {
  /** Unique correlation id; renderer must echo this back. */
  requestId: string;
  /** Server name as shown in the user's MCP list (UI-display purpose). */
  serverName: string;
  /** Friendly provider label (e.g. "GitHub"). */
  providerLabel: string;
  /** Local OAuth callback URL the user must register with the provider. */
  redirectUri: string;
  /** Provider-specific instructions resolved by `getProviderHelp(...)`. */
  instructions: McpAuthClientIdInstructions;
}

/**
 * Provider-specific guidance shown in the dialog. Resolved by the main-side
 * `getProviderHelp(metadata, cfg)` helper, which checks (in order):
 *   1. Plugin author overrides in `cfg.oauth.setupUrl/setupInstructions`
 *   2. Built-in catalog (GitHub, Slack, Google, Atlassian, …) by issuer match
 *   3. Generic fallback
 */
export interface McpAuthClientIdInstructions {
  /** Optional human-readable provider label override. */
  label?: string;
  /** Optional URL to the provider's OAuth-app registration page. */
  setupUrl?: string;
  /**
   * Ordered, human-readable steps. May contain `{redirectUri}` and
   * `{serverName}` placeholders that the renderer substitutes at render time.
   */
  steps: string[];
}

/**
 * Renderer's response to `mcpAuth:requestClientId`.
 *
 * Either the user supplies a client id (and optionally a client secret for
 * confidential clients), or they cancel the dialog. Cancelling is a
 * recoverable signal — the main process maps it to `MCP_AUTH_CANCELLED`.
 */
export type McpAuthClientIdResponse =
  | { cancelled: true }
  | {
      clientId: string;
      clientSecret?: string;
    };
