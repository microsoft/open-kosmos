<!-- Last verified: 2026-03-25 -->
# Authentication System

> Manages GitHub Copilot OAuth authentication, token lifecycle, and per-user profile auth persistence.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `authManager.ts` | `MainAuthManager` singleton — session state, token refresh orchestration, auth.json read/write, post-auth flow | ~large |
| `ghcAuth.ts` | `GhcAuthManager` — device-code OAuth flow against GitHub, Copilot token exchange, GitHub API interactions | ~large |
| `tokenMonitor.ts` | `MainTokenMonitor` — 60s polling loop; refreshes Copilot token when ≤5 min remain; triggers re-login when GitHub token invalid | small |
| `refreshTokenAnalyzer.ts` | `RefreshTokenAnalyzer` — HTTP-status-based error classifier (401/403/429/5xx/network); determines retry strategy vs session clear | medium |
| `ghcConfig.ts` | OAuth client ID, API endpoint, and other GitHub Copilot constants | tiny |
| `aliasUtils.ts` | `aliasToAadAccount()` — derives AAD account identifier from user alias | tiny |
| `types/` | `authTypes.ts` (`AuthData`, `IAuthManager`), `refreshTokenTypes.ts` | small |

## Architecture
- **Two-token model**: a long-lived GitHub OAuth token (no expiry field) and a short-lived Copilot session token (expires ~1 h). `tokenMonitor` tracks only the Copilot token expiry.
- **Device Code Flow** (`ghcAuth.ts`): `startDeviceFlow()` → poll `accessToken()` → exchange GitHub token for Copilot token. All polling is driven by the renderer; the main process only executes individual steps on IPC calls.
- **RefreshTokenAnalyzer** replaces a retry-count heuristic with exact HTTP status codes: 401 = expired (recoverable), 403 = invalid (clear session), 429 = rate-limited (back-off), 5xx = server error (retry), network errors = transient (retry). This distinction prevents unnecessary sign-out on temporary network failures.
- Auth data stored at `{userData}/profiles/{userAlias}/auth.json`. Profile directory created automatically on first sign-in.
- **V1→V2 migration** runs automatically on first load: V1 used a flat token object; V2 wraps it in `AuthData` with consistent field names.
- `MainAuthManager` holds a `BrowserWindow` reference for triggering renderer navigation (e.g., redirecting to `/login` on token invalidation).

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Change Copilot refresh threshold | `tokenMonitor.ts` (`COPILOT_TOKEN_REFRESH_THRESHOLD`) | Currently 5 min |
| Add new OAuth scope | `ghcAuth.ts` (`OAUTH_CONFIG.SCOPE`) | May require re-auth for existing users |
| Handle new HTTP error code | `refreshTokenAnalyzer.ts` | Add a new `if (status === …)` block |
| Add fields to auth.json format | `types/authTypes.ts` + `authManager.ts` | Add migration step for V2→V3 |
| Change profile directory layout | `authManager.ts` (`getProfilesDirectoryPath`) | Several downstream managers derive paths from here |

## Gotchas
- ⚠️ `MainTokenMonitor` guards against double-start with `isMonitoring && monitorInterval` checks — do not call `startMonitoring()` more than once (main.ts handles startup order).
- ⚠️ The GitHub OAuth token has no `expires_in` field from GitHub's API; the monitor only polls the Copilot token. A GitHub token can be silently revoked (403), which `RefreshTokenAnalyzer` maps to a session-clear action.
- ⚠️ `aliasUtils.ts` derives AAD identity from the alias string; if the format changes, profile directory paths change and existing data becomes inaccessible.
- ⚠️ Auth data is written to disk synchronously (`fs.writeFileSync`) to avoid losing tokens during abrupt app exit.

## Related
- Depends on: [Unified Logger](../unifiedLogger/), Electron `BrowserWindow`, `app.getPath('userData')`
- Depended by: [LLM](../llm/ai.prompt.md), [Chat Engine](../chat/ai.prompt.md), [Sub-Agent](../subAgent/ai.prompt.md), [ProfileCacheManager](../userDataADO/ai.prompt.md)
