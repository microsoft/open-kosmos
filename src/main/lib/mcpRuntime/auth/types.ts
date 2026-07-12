export interface OAuthProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
  resource_name?: string;
}

export interface OAuthAuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

export interface McpResolvedAuthMetadata {
  resourceMetadata?: OAuthProtectedResourceMetadata;
  authorizationServerUrl: string;
  authorizationServerMetadata: OAuthAuthorizationServerMetadata;
  scopes: string[];
  providerLabel: string;
  telemetry: {
    resourceMetadataSource: 'header' | 'wellKnown' | 'none';
    serverMetadataSource: 'resourceMetadata' | 'wellKnown' | 'default';
  };
}

export interface McpAuthChallengeInfo {
  scopes?: string[];
  resourceMetadataUrl?: string;
  authorizationServerUrl?: string;
}
