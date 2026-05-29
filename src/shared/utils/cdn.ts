/**
 * CDN base URL resolution (shared between main and renderer).
 *
 * The CDN is OPTIONAL. It powers a set of enhancement features only — when no
 * CDN URL is configured (env vars unset), these features degrade gracefully and
 * the core product (creating/configuring agents, chatting, running tools/MCP,
 * memory, sub-agents) continues to work normally.
 *
 * Features that depend on the CDN (all optional, all degrade gracefully):
 *   - Agent Library catalog        ("Add Agent from Library", FRE promoted agents)
 *   - MCP Server Library catalog   ("Add MCP from Library")
 *   - Skill Library + skill .zip downloads
 *   - App auto-update + native updater binary bootstrap
 *   - Chrome native-messaging host download (Browser Control helper)
 *   - Default quick-start card image / agent avatar images
 *   - Remote setup/update prompt markdown referenced by setup agents
 *
 * There is intentionally NO hardcoded default URL here. The deployment supplies
 * `DEVELOPMENT_BASE_CDN_URL` / `PRODUCTION_BASE_CDN_URL` (baked in at build time
 * via the bundler define plugin). When unset, callers must skip the remote fetch.
 */

/**
 * Returns the configured CDN base URL for the current environment, or an empty
 * string when no CDN is configured. Always check {@link isCdnConfigured} (or a
 * truthiness check on the result) before building a URL from it.
 */
export function getCdnBaseUrl(): string {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const url = isDevelopment
    ? process.env.DEVELOPMENT_BASE_CDN_URL
    : process.env.PRODUCTION_BASE_CDN_URL;
  return (url || '').trim();
}

/**
 * Whether a CDN base URL is configured. When this returns false, CDN-backed
 * optional features should no-op instead of attempting a remote request.
 */
export function isCdnConfigured(): boolean {
  return getCdnBaseUrl().length > 0;
}
