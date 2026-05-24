export const MCP_AUTH_CANCELLED_CODE = 'MCP_AUTH_CANCELLED';
export const MCP_OAUTH_FLOW_FAILED_CODE = 'MCP_OAUTH_FLOW_FAILED';
export const MCP_DCR_REQUIRES_USER_CLIENT_ID_CODE = 'MCP_DCR_REQUIRES_USER_CLIENT_ID';

export function createMcpAuthCancelledError(serverName: string): Error {
  return new Error(`[${MCP_AUTH_CANCELLED_CODE}] Authentication was canceled for MCP server "${serverName}". Start the sign-in flow again to continue.`);
}

export function createMcpOAuthFlowFailedError(serverName: string, cause: string): Error {
  return new Error(`[${MCP_OAUTH_FLOW_FAILED_CODE}] OAuth flow failed for MCP server "${serverName}": ${cause}`);
}

/**
 * Thrown when the OAuth authorization server does not support Dynamic Client
 * Registration (RFC 7591) and the user has not pre-configured a client_id.
 * The renderer surfaces a dialog so the user can paste a client_id obtained
 * from the provider's OAuth app dashboard.
 */
export function createMcpDcrRequiresUserClientIdError(serverName: string): Error {
  return new Error(`[${MCP_DCR_REQUIRES_USER_CLIENT_ID_CODE}] MCP server "${serverName}" requires a manually-registered OAuth client_id (Dynamic Client Registration is not supported by this provider).`);
}

export function isMcpAuthCancelledError(error: Error | null | undefined): boolean {
  return !!error && error.message.startsWith(`[${MCP_AUTH_CANCELLED_CODE}]`);
}

export function isMcpDcrRequiresUserClientIdError(error: Error | null | undefined): boolean {
  return !!error && error.message.startsWith(`[${MCP_DCR_REQUIRES_USER_CLIENT_ID_CODE}]`);
}

export function isMcpOAuthFlowFailedError(error: Error | null | undefined): boolean {
  return !!error && error.message.startsWith(`[${MCP_OAUTH_FLOW_FAILED_CODE}]`);
}

export function isMcpNeedsUserInteractionError(error: Error | null | undefined): boolean {
  if (!error) {
    return false;
  }

  // OAuth needs user to provide credentials we couldn't auto-discover.
  return isMcpDcrRequiresUserClientIdError(error);
}
