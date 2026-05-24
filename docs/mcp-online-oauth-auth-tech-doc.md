# MCP Online OAuth Authentication Technical Design

> Version: 1.0.0 | Date: 2026-03-29

## 1. Overview

This document describes the implemented MVP for Kosmos support of OAuth-protected online MCP servers.

The current failure mode is straightforward:

1. Kosmos sends MCP initialize traffic to an online server.
2. The server returns `401 Unauthorized`.
3. Kosmos's custom HTTP transport converts that into a generic connection error.
4. No OAuth discovery, consent flow, token acquisition, or authenticated retry occurs.

The implementation goal is to align Kosmos behavior with VS Code core where practical:

1. detect auth challenge
2. discover metadata
3. obtain token through a user-approved flow
4. retry the failed MCP request automatically

## 2. Current State

### 2.1 Kosmos Runtime Path

Current MCP connection path:

1. [src/main/lib/mcpRuntime/mcpClientManager.ts](../src/main/lib/mcpRuntime/mcpClientManager.ts)
2. [src/main/lib/mcpRuntime/vscMcpClient.ts](../src/main/lib/mcpRuntime/vscMcpClient.ts)
3. [src/main/lib/mcpRuntime/vscodeMcpClient/VscodeMcpClient.ts](../src/main/lib/mcpRuntime/vscodeMcpClient/VscodeMcpClient.ts)
4. [src/main/lib/mcpRuntime/vscodeMcpClient/transport/VscodeHttpTransport.ts](../src/main/lib/mcpRuntime/vscodeMcpClient/transport/VscodeHttpTransport.ts)

Important existing behavior:

1. `mcpClientManager` routes online transports to `VscMcpClient`.
2. `VscMcpClient` delegates connection and initialization to the internal `VscodeMcpClient` wrapper.
3. `VscodeMcpClient.initializeMcp()` sends `initialize` via transport and bubbles failures as `Failed to initialize MCP server: ...`.
4. `VscodeHttpTransport` now handles HTTP/SSE auth challenge retry for Microsoft-backed online MCP servers.

### 2.2 Exact Failure Point

In [src/main/lib/mcpRuntime/vscodeMcpClient/transport/VscodeHttpTransport.ts](../src/main/lib/mcpRuntime/vscodeMcpClient/transport/VscodeHttpTransport.ts), online request paths now delegate through `_fetchWithAuthRetry()`:

1. optionally adds an `Authorization` header when auth metadata already exists
2. performs the request
3. on `401/403`, discovers metadata, requests a token, and retries automatically
4. if an authorized retry still fails with `401/403`, forces one more retry with `forceRefresh: true`

This is the direct fix for protected MCP servers that previously failed as unrecoverable connection errors.

## 3. VS Code Reference Architecture

### 3.1 Why VS Code Core Is the Correct Reference

The relevant logic is in VS Code core, not `vscode-copilot-chat`.

`vscode-copilot-chat` consumes MCP capabilities, but the MCP OAuth challenge handling lives in:

1. [../../vscode/src/vs/workbench/api/common/extHostMcp.ts](../../vscode/src/vs/workbench/api/common/extHostMcp.ts)
2. [../../vscode/src/vs/workbench/api/browser/mainThreadMcp.ts](../../vscode/src/vs/workbench/api/browser/mainThreadMcp.ts)
3. [../../vscode/src/vs/workbench/services/authentication/browser/authenticationMcpService.ts](../../vscode/src/vs/workbench/services/authentication/browser/authenticationMcpService.ts)
4. [../../vscode/src/vs/workbench/api/browser/mainThreadAuthentication.ts](../../vscode/src/vs/workbench/api/browser/mainThreadAuthentication.ts)

### 3.2 VS Code Flow Summary

VS Code `McpHTTPHandle` does the following:

1. send request
2. if `401/403`, call `_fetchWithAuthRetry()`
3. build auth metadata via `createAuthMetadata()`
4. request token from main thread using discovered server/resource metadata
5. add `Authorization` header
6. retry original request
7. if needed, re-register auth provider and retry again

Main thread then:

1. locates or creates an authentication provider
2. prompts the user via consent dialog
3. gets or creates a session
4. returns an access token to the MCP layer

This is the reference behavior Kosmos must replicate.

## 4. Root Cause

### 4.1 Direct Cause

Kosmos's custom online MCP transport stops at raw HTTP error handling and never enters an OAuth recovery path.

### 4.2 Architectural Cause

Kosmos currently has no MCP-specific authentication bridge layer.

The system lacks a generalized auth service that can:

1. interpret MCP/OAuth challenge semantics
2. map discovered authorization servers to a provider/session model
3. request user consent
4. return a token to transport code for automatic retry

### 4.3 Why Existing BrowserAuth Is Not Sufficient

Any existing product-specific auth flows are not sufficient for MCP OAuth because:

1. they are triggered by product-specific clients, not by MCP challenge discovery
2. they assume specific resource flows, not arbitrary MCP protected resources
3. they do not expose the VS Code-style `get token from discovered server metadata` contract needed by transport code

## 5. Design Principles

1. Keep the existing Kosmos MCP runtime structure intact where possible.
2. Add auth support as a focused layer, not by scattering provider logic into transport code.
3. Treat auth-required transport states as recoverable, not generic failures.
4. Keep the design provider-abstract even if MVP support starts with Microsoft only.
5. Ensure the failed request is retried automatically after auth success.

## 6. Target Architecture

### 6.1 High-Level Flow

```text
VscodeHttpTransport request
  -> server returns 401/403 with WWW-Authenticate
  -> McpAuthMetadataService discovers resource/server metadata
  -> McpAuthenticationService resolves provider/session/token
  -> McpAuthUiService requests user consent if needed
  -> token returned to transport
  -> transport retries original request with Authorization header
  -> initialization continues
```

### 6.2 Implemented Modules

Recommended directory:

```text
src/main/lib/mcpRuntime/auth/
  McpAuthMetadataService.ts
  McpAuthService.ts
  errors.ts
  types.ts
```

Implemented renderer/UI support:

```text
src/renderer/components/mcp/
  McpAuthConsentDialog.tsx
```

### 6.3 Responsibilities by Layer

#### A. `McpAuthMetadataService`

Responsibilities:

1. parse `WWW-Authenticate`
2. extract `resource_metadata` and `scope`
3. fetch OAuth protected resource metadata
4. fetch authorization server metadata
5. return normalized auth metadata + telemetry source information

Suggested type:

```ts
export interface McpResolvedAuthMetadata {
  resourceMetadata?: OAuthProtectedResourceMetadata;
  authorizationServerUrl: string;
  authorizationServerMetadata: OAuthAuthorizationServerMetadata;
  scopes?: string[];
  telemetry: {
    resourceMetadataSource: 'header' | 'wellKnown' | 'none';
    serverMetadataSource: 'resourceMetadata' | 'wellKnown' | 'default';
  };
}
```

This service should follow the same discovery order as VS Code wherever practical.

#### B. `McpAuthService`

Responsibilities:

1. accept resolved authorization/resource metadata from transport code
2. support Microsoft-backed authorization servers in MVP
3. reuse cached MSAL accounts via `acquireTokenSilent()` when available
4. trigger MCP-specific user consent when interaction is required
5. perform interactive acquisition via the external-browser loopback flow

Suggested contract:

```ts
getTokenForServer(
  serverName: string,
  metadata: McpResolvedAuthMetadata,
  options?: { forceRefresh?: boolean }
): Promise<string | undefined>
```

#### C. `McpAuthUiService`

Responsibilities:

1. show consent UI
2. bridge main-process auth orchestration and renderer dialogs

Suggested IPC family:

1. `mcpAuth:showConsent`
2. `mcpAuth:respondConsent`

This should remain distinct from any other product auth IPC channels to avoid mixing product auth with MCP protocol auth.

## 7. Transport Changes

### 7.1 `VscodeHttpTransport` Additions

File:

1. [../src/main/lib/mcpRuntime/vscodeMcpClient/transport/VscodeHttpTransport.ts](../src/main/lib/mcpRuntime/vscodeMcpClient/transport/VscodeHttpTransport.ts)

Add:

1. `private authMetadata: McpResolvedAuthMetadata | null`
2. `private async _addAuthHeader(headers)`
3. `private async _fetchWithAuthRetry(url, init, headers)`
4. helper `_isAuthStatusCode(status)`

### 7.2 New Request Algorithm

Target behavior for HTTP requests:

```text
prepare headers
try add existing auth header if available
send request
if 401/403:
  if no auth metadata yet:
    discover metadata
  request token via McpAuthService
  if token exists:
    retry request with Authorization
if auth still fails with Authorization:
  request another token with forceRefresh
  retry once
return final response
```

### 7.3 SSE Path

The same auth handling must apply to:

1. initial GET for SSE attach
2. POST send path in legacy SSE mode
3. streamable HTTP GET backchannel path

Otherwise behavior will remain inconsistent across transport modes.

## 8. Runtime State Changes

### 8.1 Connection State Model

Recommended MCP server runtime states:

1. `connecting`
2. `needs-user-interaction`
3. `connected`
4. `error`
5. `disconnected`

This is preferable to collapsing everything into `error` because it allows the UI to represent an authentication pause rather than a final failure.

### 8.2 Cancellation Semantics

If the user dismisses or denies consent:

1. transport should stop retrying
2. server state should move to a precise auth-interrupted state or a targeted stopped/error reason
3. callers should be able to reconnect later cleanly

## 9. UI Design Notes

### 9.1 Consent Dialog

Do not reuse the existing Microsoft 365 consent dialog component directly.

Reasons:

1. MCP auth is a different product surface
2. provider may not always be a single vendor in the future
3. wording should match MCP semantics, not any specific product's auth semantics

Recommended message shape:

1. identify MCP server label
2. identify provider label when known
3. `Cancel` / `Allow` actions

### 9.2 Progress UX

MVP currently ships with only a consent dialog. There is no dedicated MCP auth progress overlay yet.

## 10. Session and Token Strategy

### 10.1 MVP Recommendation

Implement minimal token/session reuse behind `McpAuthService`, but do not block initial delivery on a perfect long-lived persistence design.

Recommended MVP behavior:

1. reuse valid in-memory session/token when available
2. support MSAL silent reuse and one forced-refresh retry when an authorized request still receives `401/403`
3. fall back to reacquiring auth when refresh is not possible or session is invalid

### 10.2 Future Expansion

Later iterations can add:

1. secure persisted token/session storage
2. richer account preference management
3. multiple-account selection
4. provider inspection/cleanup UI

## 11. Implementation Plan

### Phase 1: Core Auth Retry MVP

Deliver:

1. `McpAuthMetadataService`
2. `McpAuthService` with Microsoft-capable flow
3. `VscodeHttpTransport._fetchWithAuthRetry()`
4. MCP-specific consent dialog IPC + renderer component
5. automatic retry after auth success

Outcome:

A protected MCP server can authenticate and connect.

### Phase 2: State and Recovery

Deliver:

1. `needs-user-interaction` state support
2. token/session reuse and invalidation rules
3. forced-refresh retry path
4. better logs and telemetry

### Phase 3: Provider Generalization

Deliver:

1. broader provider abstraction beyond Microsoft-backed auth
2. support for additional OAuth-compatible providers
3. improved UX around account selection and auth diagnostics

## 12. Testing Strategy

### 12.1 Unit Tests

Add tests for:

1. `WWW-Authenticate` parsing
2. metadata discovery ordering
3. auth retry on `401/403`
4. header injection on retry
5. user-cancel path
6. tokenized request still failing and triggering a force-refresh retry

### 12.2 Integration Tests

Add a test MCP server that:

1. rejects unauthenticated requests with `401 + WWW-Authenticate`
2. accepts requests after mock OAuth completion

Validate:

1. consent is requested
2. token is obtained
3. initialize is retried
4. server reaches running state

### 12.3 Manual Validation

Scenarios:

1. first-time auth for a protected MCP server
2. user cancels auth
3. user completes auth and server connects automatically
4. reconnect after token expiry
5. SSE and HTTP variants both behave correctly

## 13. Risks and Mitigations

### Risk 1: Over-coupling MCP auth to a specific product auth stack

Mitigation:

1. keep MCP auth service separate from any product-specific auth orchestration
2. keep transport logic metadata-driven even though the current token acquisition implementation only supports specific providers

### Risk 2: Incomplete MVP that prompts but does not retry

Mitigation:

1. treat automatic retry as part of the transport contract, not optional polish

### Risk 3: State model remains too coarse

Mitigation:

1. add explicit auth-interaction-aware states so the UI and logs can distinguish recoverable auth flow from terminal errors

## 14. Final Technical Statement

Kosmos should not solve this problem by adding a one-off prompt at the UI layer. The implemented MVP adds a VS Code-style MCP auth bridge in the runtime: challenge discovery, metadata resolution, token acquisition, and authenticated retry integrated directly into the online MCP transport path, with `needs-user-interaction` surfaced separately from generic connection failure.