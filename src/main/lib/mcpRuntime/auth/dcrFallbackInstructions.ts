/**
 * Provider help catalog for the DCR-fallback dialog.
 *
 * When an MCP server's OAuth authorization server does not support Dynamic
 * Client Registration (RFC 7591) and the user has not pre-configured a
 * `clientId` in `.mcp.json`, the renderer pops a dialog asking the user to
 * paste a manually-registered client_id. This module supplies the dialog
 * with provider-specific or generic step-by-step instructions.
 *
 * Lookup priority (handled in `getProviderHelp`):
 *   1. Plugin-author-supplied `cfg.oauth.setupUrl` / `cfg.oauth.setupInstructions`
 *   2. Built-in catalog matched by issuer / metadata-URL substring
 *   3. Generic fallback (only redirect URI guidance)
 *
 * Steps may contain `{redirectUri}` and `{serverName}` placeholders that the
 * dialog substitutes at render time.
 */

import type { McpResolvedAuthMetadata } from './types';
import type { McpServerConfig } from '../../userDataADO/types/profile';

export interface ProviderHelp {
  /** Display label for the provider, falls back to the metadata-derived label. */
  label?: string;
  /** External URL where the user creates a new OAuth app. */
  setupUrl?: string;
  /**
   * Ordered, human-readable steps. Use `{redirectUri}` to mark where the
   * locally-running OAuth callback URL should be pasted.
   */
  steps: string[];
}

/**
 * Built-in catalog: hostname substring → instructions. The substring matches
 * either the authorization-server issuer or the metadata-URL string. Order
 * matters because the first match wins.
 */
const BUILTIN_CATALOG: Array<{ match: string[]; help: ProviderHelp }> = [
  {
    match: ['github.com'],
    help: {
      label: 'GitHub',
      setupUrl: 'https://github.com/settings/developers',
      steps: [
        'Click "OAuth Apps" → "New OAuth App".',
        'Application name: anything (e.g. "OpenKosmos – {serverName}").',
        'Homepage URL: any value (e.g. http://localhost).',
        'Authorization callback URL: {redirectUri}',
        'Click "Register application", then copy the "Client ID" shown on the next page.',
        'If the page also offers "Generate a new client secret", copy that too — but most desktop apps only need the Client ID.',
      ],
    },
  },
  {
    match: ['gitlab.com'],
    help: {
      label: 'GitLab',
      setupUrl: 'https://gitlab.com/-/profile/applications',
      steps: [
        'Open your GitLab user settings → "Applications".',
        'Name: anything (e.g. "OpenKosmos – {serverName}").',
        'Redirect URI: {redirectUri}',
        'Confidential: leave unchecked (OpenKosmos uses PKCE).',
        'Scopes: as documented by your MCP server.',
        'Click "Save application" and copy the "Application ID" — that is the Client ID.',
      ],
    },
  },
  {
    match: ['slack.com'],
    help: {
      label: 'Slack',
      setupUrl: 'https://api.slack.com/apps',
      steps: [
        'Click "Create New App" → "From scratch". Pick any workspace.',
        'In the app settings: open "OAuth & Permissions".',
        'Under "Redirect URLs" click "Add New Redirect URL", paste {redirectUri}, then "Save URLs".',
        'Open "Basic Information" and copy the "Client ID".',
      ],
    },
  },
  {
    match: ['accounts.google.com', 'googleapis.com'],
    help: {
      label: 'Google',
      setupUrl: 'https://console.cloud.google.com/apis/credentials',
      steps: [
        'Open Google Cloud Console → "APIs & Services" → "Credentials".',
        'Click "Create Credentials" → "OAuth client ID".',
        'Application type: "Desktop app".',
        'Authorized redirect URIs: {redirectUri}',
        'Click "Create" and copy the "Client ID".',
        'Note: you may also need to configure the OAuth consent screen first.',
      ],
    },
  },
  {
    match: ['atlassian.com'],
    help: {
      label: 'Atlassian',
      setupUrl: 'https://developer.atlassian.com/console/myapps/',
      steps: [
        'Open Atlassian Developer Console → "My Apps" → "Create" → "OAuth 2.0 integration".',
        'In the app: "Authorization" → "Configure" for OAuth 2.0 (3LO).',
        'Callback URL: {redirectUri}',
        'Save changes, then copy the "Client ID" from "Settings".',
      ],
    },
  },
  {
    match: ['notion.so', 'notion.com'],
    help: {
      label: 'Notion',
      setupUrl: 'https://www.notion.so/my-integrations',
      steps: [
        'Open Notion → "My integrations" → "New integration".',
        'Choose "Public" integration type.',
        'Redirect URIs: {redirectUri}',
        'Submit and copy the "OAuth client ID".',
      ],
    },
  },
  {
    match: ['discord.com'],
    help: {
      label: 'Discord',
      setupUrl: 'https://discord.com/developers/applications',
      steps: [
        'Open Discord Developer Portal → "Applications" → "New Application".',
        'In the app: "OAuth2" → "General".',
        'Add Redirect: {redirectUri}',
        'Save changes, then copy the "Client ID".',
      ],
    },
  },
];

const GENERIC_HELP: ProviderHelp = {
  steps: [
    'Open your provider\'s developer console / OAuth-app dashboard.',
    'Create a new OAuth application (also called "OAuth client" or "API key").',
    'Set the redirect URI / callback URL to: {redirectUri}',
    'Set the client type to "Public client" / "PKCE" if asked (no client secret).',
    'Save the application and copy the generated Client ID below.',
  ],
};

/**
 * Resolve provider help for a given metadata + config combination.
 *
 * Priority:
 *   1. `cfg.oauth.setupUrl` and/or `cfg.oauth.setupInstructions` (plugin author)
 *   2. Built-in catalog (issuer hostname / metadata-URL substring)
 *   3. Generic fallback
 */
export function getProviderHelp(
  metadata: McpResolvedAuthMetadata,
  cfg: McpServerConfig,
): ProviderHelp {
  // 1. Plugin-author override
  if (cfg.oauth?.setupUrl || (cfg.oauth?.setupInstructions && cfg.oauth.setupInstructions.length > 0)) {
    return {
      label: metadata.providerLabel,
      setupUrl: cfg.oauth.setupUrl,
      steps: cfg.oauth.setupInstructions ?? GENERIC_HELP.steps,
    };
  }

  // 2. Built-in catalog
  const haystack = `${metadata.authorizationServerUrl} ${metadata.authorizationServerMetadata.issuer ?? ''}`.toLowerCase();
  for (const entry of BUILTIN_CATALOG) {
    if (entry.match.some(host => haystack.includes(host))) {
      return entry.help;
    }
  }

  // 3. Generic fallback
  return {
    label: metadata.providerLabel,
    steps: GENERIC_HELP.steps,
  };
}

/**
 * Substitute placeholders in a step string. Exposed for unit tests and the
 * renderer (the renderer also performs substitution but uses this for parity).
 */
export function substituteStepPlaceholders(
  step: string,
  context: { redirectUri: string; serverName: string },
): string {
  return step
    .replace(/\{redirectUri\}/g, context.redirectUri)
    .replace(/\{serverName\}/g, context.serverName);
}
