# MCP Online OAuth Authentication PRD

## 1. Background

Kosmos currently supports local MCP servers and unauthenticated online MCP servers, but it cannot successfully connect to OAuth-protected online MCP servers.

The concrete user-visible failure is:

1. User configures an online MCP server such as:

```jsonc
"my-protected-mcp": {
  "url": "https://my-mcp-service.example.com/mcp",
  "type": "http"
}
```

2. Server returns `401 Unauthorized` during initialization.
3. Kosmos surfaces a connection failure.
4. No authentication consent flow is shown.

By contrast, VS Code correctly detects the authentication challenge and prompts the user with a consent dialog such as:

`The MCP Server Definition 'my-protected-mcp' wants to authenticate.`

This gap blocks teams that host online MCP services behind Microsoft identity or other OAuth-compatible identity providers.

## 2. Problem Statement

Kosmos does not support the required product flow for authenticated online MCP servers:

1. detect that an MCP server requires OAuth
2. ask the user for consent
3. complete the OAuth flow
4. retry the MCP connection with valid credentials

As a result, any protected MCP resource behaves as permanently unavailable in Kosmos even though the same configuration works in VS Code.

## 3. Product Decision

Kosmos will add first-class support for OAuth-protected online MCP servers.

The product behavior will be:

1. when an online MCP server returns `401` or `403` with an OAuth challenge, Kosmos recognizes it as an authentication-required state rather than a terminal transport failure
2. Kosmos presents a consent prompt to the user before beginning authentication
3. after consent, Kosmos completes OAuth, obtains an access token, retries the original MCP request, and continues connection setup automatically
4. the authenticated session is reused when possible and renewed when needed

## 4. Goals

### 4.1 Product Goals

1. Make authenticated online MCP servers usable in Kosmos.
2. Align Kosmos user experience with VS Code for MCP OAuth scenarios.
3. Ensure connection failures caused by missing auth are recoverable through guided UX rather than terminal errors.
4. Avoid hard-coding the runtime to only one specific MCP service.

### 4.2 User Goals

1. "If an MCP server requires Microsoft login, Kosmos should prompt me instead of just failing."
2. "After I sign in once, the app should retry and connect automatically."
3. "If my session expires later, the app should guide me back through auth instead of leaving me with a generic 401 error."

### 4.3 Non-Goals

1. Full redesign of the MCP settings UI.
2. Replacing the entire Kosmos MCP runtime with a different transport stack.
3. Supporting every possible identity provider in v1.
4. Mid-request authentication mutation for already-running tool calls.

## 5. Scope

### 5.1 In Scope

1. Online MCP server authentication for `http` and `sse` transport paths.
2. Detecting `401/403` auth challenges.
3. Parsing `WWW-Authenticate` challenge data.
4. Discovering OAuth protected resource metadata and authorization server metadata.
5. Presenting an auth consent dialog.
6. Completing OAuth and retrying MCP initialization.
7. Session/token reuse and expiration handling.
8. Supporting at least one identity provider at minimum.

### 5.2 Out of Scope

1. Reworking stdio MCP server auth.
2. General-purpose browser auth redesign for Graph/Teams tools.
3. Historical auth session inspection UI.
4. Full identity-provider marketplace support in the first release.

## 6. User Stories

1. As a user, when I add a protected online MCP server, I want Kosmos to prompt me for sign-in rather than fail with a raw 401 error.
2. As a user, when I approve authentication, I want Kosmos to finish connecting automatically without requiring a manual reconnect.
3. As a user, when my authentication expires, I want Kosmos to ask me to re-authenticate in a clear and recoverable way.
4. As a developer/operator, I want Kosmos logs and state to clearly distinguish auth-required states from generic transport failures.

## 7. Experience Requirements

### 7.1 Consent Behavior

Before starting an OAuth flow, Kosmos must ask for user consent.

Minimum UX requirement:

1. show which MCP server is requesting authentication
2. show which provider is being used when known, for example `Microsoft`
3. allow canceling the flow cleanly

### 7.2 Retry Behavior

After successful authentication, Kosmos must automatically retry the MCP request that failed because of missing auth.

The user should not need to click reconnect manually for the common success path.

### 7.3 Failure Behavior

If the user cancels authentication:

1. the server should not be shown as a generic broken transport
2. the UI should preserve a clear auth-interrupted state or a precise error message

If authentication fails after user approval:

1. the user should receive a targeted auth error
2. logs should preserve the underlying server challenge and retry behavior

### 7.4 State Semantics

Kosmos should distinguish among:

1. `connecting`
2. `needs-user-interaction`
3. `running`
4. `error`

This prevents auth-required states from being collapsed into ordinary connection failures.

## 8. Functional Requirements

### 8.1 Must Have

1. Detect when an online MCP server responds with `401` or `403` during connect/initialize/send.
2. Parse OAuth challenge data from `WWW-Authenticate`.
3. Discover auth metadata required to complete OAuth.
4. Prompt for user consent.
5. Acquire a valid access token.
6. Retry the failed MCP request with `Authorization: Bearer <token>`.
7. Successfully continue MCP initialization if auth succeeds.
8. Support Microsoft identity for v1.

### 8.2 Should Have

1. Reuse prior session/token when valid.
2. Refresh or reacquire auth on expiration.
3. Keep telemetry/logging for discovery source and retry behavior.
4. Surface auth-required state distinctly in UI.

### 8.3 Won't Have in MVP

1. Broad provider-specific settings UI.
2. Rich account chooser and multi-account management matching full VS Code capabilities.
3. Session history and advanced credential diagnostics UI.

## 9. Success Metrics

1. A protected online MCP server can be added and connected successfully in Kosmos.
2. First-time authentication succeeds without manual reconnect.
3. The user sees consent UX instead of only a raw 401 failure.
4. Expired-session recovery works for supported provider flows.

## 10. Acceptance Criteria

The feature is accepted when all of the following are true:

1. With a protected MCP server config, Kosmos no longer fails immediately on the initial `401`.
2. Kosmos shows an authentication consent prompt.
3. After the user approves and completes auth, Kosmos retries automatically and connects.
4. Logs show auth challenge discovery and retry rather than only transport failure.
5. User cancellation is handled cleanly without misleading generic error messaging.

## 11. Risks

1. Reusing the existing Microsoft 365 auth stack too directly could over-couple MCP auth to Graph/Teams-specific assumptions.
2. Implementing only a prompt without full retry orchestration would not solve the real connectivity problem.
3. If auth state is modeled only as `error`, users will continue to see confusing failures even after the protocol-side work is added.

## 12. Open Product Constraints

These are not blockers for writing code, but they should be acknowledged as rollout constraints:

1. Decide whether token/session state should be persisted beyond process lifetime in v1.
2. Decide whether MVP should expose only Microsoft-branded consent wording or provider-generic wording with provider label substitution.
3. Decide whether auth-required server state should be recoverable from existing reconnect controls or receive dedicated UI affordances.

## 13. Final Product Statement

Kosmos will support OAuth-protected online MCP servers by turning authentication challenges into a guided consent-and-login flow followed by automatic authenticated retry.