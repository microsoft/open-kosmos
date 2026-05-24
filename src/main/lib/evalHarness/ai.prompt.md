<!-- Last verified: 2026-04-27 -->
# Eval Harness

> HTTP server for integration with AgenticEval, an external agent evaluation system. Exposes `/eval/health`, `/eval/run`, and `/eval/judge` endpoints. Supports both single-turn and multi-turn evaluation sessions.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `evalHttpServer.ts` | HTTP server with eval endpoints, request routing, JSON body parsing, timeout with AbortSignal, lifecycle | ~230 LOC |
| `evalProtocol.ts` | TypeScript types + Zod schemas for request/response validation | ~70 LOC |
| `evalAgentRunner.ts` | `run_test` handler: manages headless AgentChat instances with multi-turn session caching, per-session turn serialization, idle eviction | ~280 LOC |
| `evalJudgeRunner.ts` | `judge` handler: raw LLM call with caller-provided messages, no agent loop | ~60 LOC |

## Architecture
- Activated via `--eval-mode` flag in `main.ts` `onReady()`. Skips window creation, analytics, auto-update. Initializes only auth, profile, MCP, and chat singletons. Startup logic lives in `src/main/startup/evalMode.ts`.
- Single-instance lock is bypassed in eval mode (allows running alongside the GUI).
- HTTP server binds to `127.0.0.1:8100` (configurable via `--eval-port=NNNN`). Uses raw `http.createServer`.
- **Authentication:** All endpoints except `/eval/health` require `Authorization: Bearer <token>`. The token is read from the `EVAL_AUTH_TOKEN` environment variable, which must be set by the caller (AgenticEval) before launching OpenKosmos. The server refuses to start without it.
- **No CORS headers** — localhost-to-localhost doesn't need CORS, and omitting headers blocks browser-originated cross-origin requests.
- **Single-turn:** `run_test` without `session_id` creates a fresh headless `AgentChat` with `setSkipPersistence(true)` (no disk writes). On success, the session is cached for potential multi-turn continuation and its `session_id` is returned.
- **Multi-turn:** `run_test` with `session_id` reuses the cached `AgentChat`. Turns are serialized per-session via a promise-based lock to prevent concurrent mutation. Sessions are evicted after 15 minutes of inactivity or when capacity (10 sessions) is exceeded.
- **Timeout safety:** First-turn requests pass an `AbortSignal` to prevent timed-out runs from leaking into the session cache. If the signal is aborted before caching, the agent is destroyed immediately.
- **No persistence:** Eval sessions use `setSkipPersistence(true)` so `AgentChatSessionService.saveChatSession()` short-circuits. No session data is written to disk, and no UI filtering is needed.
- `judge` uses `GhcModelApi.callWithMessages()` for a direct non-streaming LLM call without the agent loop.

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/eval/health` | Health check — returns `{ "status": "ok" }` |
| POST | `/eval/run` | Full agent e2e loop — body `{ "prompt": "...", "metadata": {}, "session_id": "..." (optional) }` |
| POST | `/eval/judge` | Raw LLM call — body `{ "messages": [{ "role": "...", "content": "..." }] }` |

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new endpoint | `evalHttpServer.ts` (routing), `evalProtocol.ts` (schema) | Follow existing handler pattern |
| Change default port | `evalHttpServer.ts` (`DEFAULT_PORT` constant) | Currently 8100 |
| Change which agent is used | `evalAgentRunner.ts` (`getDefaultChatId`) | Currently uses profile's `primaryAgent` |
| Change judge model | `evalJudgeRunner.ts` (`getAgentModelId`) | Currently uses agent's configured model |
| Change session limits | `evalAgentRunner.ts` (`MAX_SESSIONS`, `SESSION_IDLE_TIMEOUT_MS`) | Currently 10 sessions, 15 min idle |

## Gotchas
- ⚠️ `EVAL_AUTH_TOKEN` env var is **required** — the server throws on startup without it. AgenticEval sets this automatically via its adapter config.
- ⚠️ The user must have logged in via the GUI at least once before eval mode works — auth tokens are read from the persisted session.
- ⚠️ `AgentChat` constructor and `initialize()` are called directly (not through `AgentChatManager.createAgentWithChatSession` which is private). If the manager's creation logic changes, the agent runner may need updating.
- ⚠️ Sub-agent message extraction relies on parsing tool result JSON. If the sub-agent result format changes in `SubAgentManager`, update `extractSubAgentMessages()`.
- ⚠️ Port 8100 must not conflict with other services. The `BrowserControlHttpServer` uses port 8000.
- ⚠️ Per-session turn lock prevents concurrent mutations but does NOT cancel in-flight LLM calls. A stuck turn blocks subsequent turns on the same session until timeout/eviction.
- ⚠️ `runOneShot` is public (called directly by `evalHttpServer.ts` for AbortSignal support). `runWithSession` remains private.

## Related
- Depends on: [Chat Engine](../chat/ai.prompt.md), [LLM](../llm/ai.prompt.md), [UserDataADO](../userDataADO/ai.prompt.md), [MCP Runtime](../mcpRuntime/ai.prompt.md), [Auth](../auth/ai.prompt.md)
- Entry point: `src/main/startup/evalMode.ts` → `src/main/main.ts` (`onReady()`)
