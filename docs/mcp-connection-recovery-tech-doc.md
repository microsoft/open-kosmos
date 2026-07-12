# MCP Connection Recovery — Tech Doc

<!-- Last verified: 2026-06-25 -->

> Implements [mcp-connection-recovery-prd.md](./mcp-connection-recovery-prd.md).

## 1. Overview

Four cooperating layers, all inside `src/main/lib/mcpRuntime`:

```
VscodeMcpClient.handleMessage
  ├─ matched response             → classifyProtocolError()
  │     ├─ connection-lost        → failConnection()  ─────────────┐
  │     └─ otherwise              → resolve/reject the request      │
  │                                 (reset timeout counter)         │
  └─ UNMATCHED error response     → classifyProtocolError()         │
        ├─ connection-lost        → failConnection()  ─────────────┤
        ├─ id-less + 1 pending    → reject that one request        │
        └─ concrete-id miss       → log only (stale/late reply)    │
VscodeMcpClient idle timeout (per request)                         │
  ├─ reject ONLY this request + notifications/cancelled            │
  └─ Nth consecutive timeout      → failConnection() ──────────────┤
                                                                    ▼
VscodeMcpClient.failConnection → setState('error') + reject pending + transport.stop()
        │ emits stateChange('error')
        ▼
VscMcpClient (adapter) re-emits stateChange
        ▼
MCPClientManager._registerClientStateHandlers → status='error'
        │ + autoReconnect.onServerError(serverName, causeMessage, previous user-interaction snapshot)
        ▼
McpAutoReconnectCoordinator  (eligibility + everConnected/baseError + compose lastError)
        │ eligible? (non-builtin, in_use, everConnected, not needs-user-interaction,
        │            not deterministic auth/account/config failure)
        ▼
McpAutoReconnectManager  (backoff schedule, attempt cap, cancel)
        │ host.executeReconnect
        ▼
MCPClientManager host adapter → opLock.run('reconnect', …, { isAutoReconnect: true }) → _performReconnect
```

Logic that is branchy is pushed into four small, fully unit-tested modules
(`mcpReconnectPolicy.ts`, `mcpAutoReconnectManager.ts`, `mcpAutoReconnectCoordinator.ts`,
`mcpOperationLock.ts`) so the two large, coverage-gated files
(`VscodeMcpClient.ts`, `mcpClientManager.ts`) only gain thin, mostly straight-line wiring.

## 2. Root cause recap (why the old code hung 10 minutes)

`VscodeMcpClient.handleMessage` (old):

```ts
if (message.id !== undefined && this.pendingRequests.has(message.id)) {
  // matched response → resolve/reject
} else if (!message.id) {
  // treated as a notification  ← BUG: id === "" lands here, error is dropped
  this.handleNotification(message);
}
```

The Teams proxy error had `id === ""` and `error.code === -32001`
(`Session not found`). It matched neither branch's intent: it is an **error
response** the client cannot attribute, so it fell into the notification branch
and was ignored. The pending `id=113` request then waited the full
`TOOL_IDLE_TIMEOUT_MS` (10 min) before the idle watchdog killed the connection.

## 3. Layer 1 — protocol fail-fast (`VscodeMcpClient.handleMessage`)

New routing:

```ts
const id = message.id;
const matched = id !== undefined && id !== null && id !== '' && this.pendingRequests.has(id);

if (matched) {
  const pending = this.pendingRequests.get(id)!;
  this.consecutiveIdleTimeouts = 0;            // a real reply proves the link is healthy
  if (message.error) {
    const err = message.error;
    // A matched lost-session error (e.g. -32001 "Session not found") is fatal to the whole
    // connection even though the proxy echoed this id; fail it so the manager auto-reconnects.
    // failConnection rejects every pending request (incl. this one, still in the map).
    if (classifyProtocolError(err) === 'connection-lost') {
      const description = `MCP Error: ${err.message ?? 'unknown error'} (${err.code ?? 'n/a'})`;
      this.failConnection(new McpProtocolConnectionError(description, err.code));
      return;
    }
    this.pendingRequests.delete(id);
    pending.reject(new Error(`MCP Error: ${err.message} (${err.code})`));
  } else {
    this.pendingRequests.delete(id);
    pending.resolve(message.result);
  }
} else if (message.error) {
  this.handleUnmatchedErrorResponse(message);  // NEW
} else if (id === undefined || id === null || id === '') {
  this.handleNotification(message);
}
// else: a response id we no longer track and no error → ignore (late/duplicate)
```

`handleUnmatchedErrorResponse`:

```ts
private handleUnmatchedErrorResponse(message: any): void {
  const err = message.error;
  const description = `MCP Error: ${err.message ?? 'unknown error'} (${err.code ?? 'n/a'})`;
  this.log('warning', `mcp.protocol.unmatched-error (id=${JSON.stringify(message?.id)}): ${description}`);

  if (classifyProtocolError(err) === 'connection-lost') {
    // Upstream/proxy session is gone; every pending request is doomed. Fail the
    // connection so the manager can auto-reconnect. Replaces the 10-min hang.
    // Applies regardless of the error's id (matching, empty, or non-matching).
    this.failConnection(new McpProtocolConnectionError(description, err.code));
    return;
  }

  // Only an *id-less* (absent/empty) error may be attributed to a lone in-flight request — that is
  // the ambiguous proxy case this exists for. An error carrying a *concrete* id that no longer maps
  // to a pending request is a late/stale reply for an already-removed request (e.g. one that
  // idle-timed-out and was replaced by a new call); rejecting the current request would fail the
  // WRONG tool call, so a concrete-id miss is logged only.
  const id = message.id;
  const isIdless = id === undefined || id === null || id === '';
  if (isIdless && this.pendingRequests.size === 1) {
    const onlyId = this.pendingRequests.keys().next().value as number;
    const pending = this.pendingRequests.get(onlyId)!;
    this.pendingRequests.delete(onlyId);
    pending.reject(new Error(description));
  }
  // concrete-id miss, or zero / multiple pending → cannot attribute; logged only, connection kept.
}
```

## 4. Layer 2 — request-level idle timeout + escalation (`VscodeMcpClient`)

The idle `InactivityTimer` callback in `sendRequestTracked` no longer calls the
connection-killing path. It rejects only its own request, then asks
`handleRequestIdleTimeout` whether to escalate:

```ts
const idle = new InactivityTimer(deadline.idleMs, () => {
  this.pendingRequests.delete(request.id);
  cleanup();
  const idleError = new ToolIdleTimeoutError(deadline.label, deadline.idleMs);
  this.log('error', idleError.message);
  this.handleRequestIdleTimeout(request.id, idleError);   // request-level + maybe escalate
  reject(idleError);
});
```

```ts
private consecutiveIdleTimeouts = 0;
private lastIdleTimeoutAt = 0;

private handleRequestIdleTimeout(requestId: number, idleError: ToolIdleTimeoutError): void {
  this.sendCancellationNotification(requestId, idleError.message);  // best-effort

  const now = Date.now();
  this.consecutiveIdleTimeouts =
    now - this.lastIdleTimeoutAt <= IDLE_TIMEOUT_ESCALATION_WINDOW_MS
      ? this.consecutiveIdleTimeouts + 1
      : 1;
  this.lastIdleTimeoutAt = now;

  if (this.consecutiveIdleTimeouts >= IDLE_TIMEOUT_ESCALATION_THRESHOLD) {
    this.log('warning', `Escalating to connection reset after ${this.consecutiveIdleTimeouts} consecutive tool idle timeouts`);
    this.consecutiveIdleTimeouts = 0;
    this.failConnection(idleError);
  }
  // else: keep the connection; only this request failed.
}

private sendCancellationNotification(requestId: number, reason: string): void {
  if (!this.transport) return;
  void this.sendNotification({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId, reason } })
    .catch((e) => this.log('debug', `Failed to send cancellation for ${requestId}: ${e instanceof Error ? e.message : String(e)}`));
}
```

`failConnection` generalizes the old `terminateConnectionAfterToolIdleTimeout`
(same body, accepts any `Error`):

```ts
private failConnection(error: Error): void {
  this.setState({ state: 'error', message: error.message });
  this.rejectPendingRequests(error);
  const transport = this.transport;
  if (!transport) return;
  void transport.stop()
    .catch((stopError) => this.log('warning', `Failed to stop MCP transport: ${stopError instanceof Error ? stopError.message : String(stopError)}`))
    .finally(() => {
      if (this.transport === transport) {
        this.transport = null;
        this.isInitialized = false;
        this.tools = [];
        this.resources = [];
      }
    });
}
```

### Why escalation, and why not blanket-kill

A single hung tool is a *tool* problem; killing the whole connection (and every
other tool on it) is collateral damage — that was the user's core objection.
But `N` no-response timeouts in a row strongly imply the *transport* is wedged
(not just one slow tool), so escalating to a reset + reconnect is the correct
recovery. `IDLE_TIMEOUT_ESCALATION_THRESHOLD = 3`,
`IDLE_TIMEOUT_ESCALATION_WINDOW_MS = 30 min` (a successful reply resets the
counter, so only genuinely back-to-back failures escalate).

## 5. Layer 3 — `mcpReconnectPolicy.ts` (NEW, pure)

```ts
export type ProtocolErrorClass = 'connection-lost' | 'ambiguous';

// JSON-RPC -32001 is the upstream proxy "Session not found" code seen in the incident.
const CONNECTION_LOST_CODES = new Set<number>([-32001]);
const CONNECTION_LOST_PATTERNS = [/session not found/i, /session expired/i, /session .*closed/i];

export function classifyProtocolError(error?: { code?: number; message?: string } | null): ProtocolErrorClass {
  if (!error) return 'ambiguous';
  if (typeof error.code === 'number' && CONNECTION_LOST_CODES.has(error.code)) return 'connection-lost';
  const msg = typeof error.message === 'string' ? error.message : '';
  return CONNECTION_LOST_PATTERNS.some((re) => re.test(msg)) ? 'connection-lost' : 'ambiguous';
}

// 5s, 30s, 2m, 5m, 15m, 30m (cap). +0..20% jitter.
export const RECONNECT_BACKOFF_SCHEDULE_MS = [5_000, 30_000, 120_000, 300_000, 900_000, 1_800_000];
export const MAX_AUTO_RECONNECT_ATTEMPTS = 8;

export function computeReconnectDelayMs(attempt: number, rng: () => number = Math.random): number {
  const idx = Math.min(Math.max(attempt, 1), RECONNECT_BACKOFF_SCHEDULE_MS.length) - 1;
  const base = RECONNECT_BACKOFF_SCHEDULE_MS[idx];
  return base + Math.floor(base * 0.2 * rng());
}

export interface AutoReconnectDecisionInput {
  isBuiltin: boolean;
  inUse: boolean;
  everConnected: boolean;
  needsUserInteraction: boolean;
}

export function shouldAutoReconnect(i: AutoReconnectDecisionInput): boolean {
  return !i.isBuiltin && i.inUse && i.everConnected && !i.needsUserInteraction;
}
```

The classification table (PRD §4) maps onto these two predicates: anything
matching a `connection-lost` code/pattern reconnects; everything else is handled
at the request level.

## 6. Layer 3 — `McpAutoReconnectManager` (NEW)

A small state machine, fully injectable for tests (clock, timer, rng, and the
manager callbacks). It owns scheduling so there is exactly one pending action per
server.

```ts
export interface AutoReconnectDeps {
  reconnect: (serverName: string) => Promise<void>;     // → host.executeReconnect (per-server lock + _performReconnect)
  getStatus: (serverName: string) => string | undefined; // runtime status
  isEligible: (serverName: string) => boolean;           // McpAutoReconnectCoordinator eligibility snapshot
  onStateMessage: (serverName: string, message: string) => void; // last-error text for UI
  log: (level: 'info' | 'warning' | 'debug', message: string) => void;
  now?: () => number;
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
  rng?: () => number;
}

class McpAutoReconnectManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private attempts = new Map<string, number>();
  private inFlight = new Set<string>();
  private cancelEpoch = new Map<string, number>();       // bumped by cancel/cancelAll

  onServerError(serverName: string): void {            // idempotent entry point
    if (!this.deps.isEligible(serverName)) { this.cancel(serverName); return; }
    if (this.inFlight.has(serverName) || this.timers.has(serverName)) return; // already handling
    this.scheduleNextAttempt(serverName);
  }

  private scheduleNextAttempt(serverName: string): void {
    const attempt = (this.attempts.get(serverName) ?? 0) + 1;
    if (attempt > MAX_AUTO_RECONNECT_ATTEMPTS) {
      this.deps.onStateMessage(serverName, `Reconnect failed after ${MAX_AUTO_RECONNECT_ATTEMPTS} attempts`);
      this.deps.log('warning', `Auto-reconnect gave up for ${serverName}`);
      return;
    }
    this.attempts.set(serverName, attempt);
    const delay = computeReconnectDelayMs(attempt, this.deps.rng ?? Math.random);
    this.deps.onStateMessage(serverName, `auto-reconnecting (attempt ${attempt}) in ${Math.round(delay / 1000)}s`);
    this.timers.set(serverName, this.setTimer(() => void this.run(serverName), delay));
  }

  private async run(serverName: string): Promise<void> {
    this.timers.delete(serverName);
    if (!this.deps.isEligible(serverName)) return;
    this.inFlight.add(serverName);
    const epoch = this.cancelEpoch.get(serverName) ?? 0;   // capture after marking in-flight
    try {
      await this.deps.reconnect(serverName);
      if (this.isCancelled(serverName, epoch)) return;      // a cancel raced the await → stop
      if (this.deps.getStatus(serverName) === 'connected') {
        this.reset(serverName);                          // success → clear attempts
        this.deps.log('info', `Auto-reconnect succeeded for ${serverName}`);
      } else {
        this.scheduleNextAttempt(serverName);            // still failed → next backoff step
      }
    } catch {
      if (this.isCancelled(serverName, epoch)) return;      // same guard on the failure arm
      this.scheduleNextAttempt(serverName);
    } finally {
      this.inFlight.delete(serverName);
    }
  }

  cancel(serverName: string): void { /* bump epoch + clear timer + attempts (manual op / ineligible) */ }
  cancelAll(): void { /* bump every epoch (profile teardown) */ }
  reset(serverName: string): void { /* clear timer + attempts after success */ }
}
```

Concurrency note: while `run()` is `inFlight`, a `stateChange('error')` emitted
by the *failing* reconnect re-enters `onServerError`, which returns early (in
flight). `run()` itself schedules the next attempt before clearing `inFlight`, so
there is never a double schedule. The per-server **cancel epoch** closes a second
race: if `cancel`/`cancelAll` fires *while* a `run()` is awaiting `reconnect`,
`run()` would otherwise reschedule the very attempt the user just cancelled. It
captures the epoch after marking in-flight and bails (in both the resolve and
reject arms) when the epoch has since been bumped.

## 6a. Layer 3 — `McpAutoReconnectCoordinator` (NEW)

`McpAutoReconnectManager` is intentionally free of any `MCPClientManager`-specific
state. The **coordinator** owns that bookkeeping and bridges the two via an
injected `AutoReconnectHost` (`executeReconnect`, `getStatus`, `isBuiltin`,
`isInUse`, `setLastError`, `log`). It keeps `MCPClientManager` thin (the
file-length gate) and gives the eligibility/compose logic its own fully-covered
unit test.

```ts
export interface AutoReconnectHost {
  executeReconnect: (serverName: string) => Promise<void>; // per-server lock + _performReconnect
  getStatus: (serverName: string) => string | undefined;
  isBuiltin: (serverName: string) => boolean;
  isInUse: (serverName: string) => boolean;                // current-user profile in_use !== false
  setLastError: (serverName: string, message: string) => void;
  log: (level: 'info' | 'warning' | 'debug', message: string) => void;
}

class McpAutoReconnectCoordinator {
  private everConnected = new Set<string>();
  private baseError = new Map<string, string>();           // captured failure cause per server

  noteConnected(serverName: string): void { this.everConnected.add(serverName); }

  onServerError(serverName: string, cause?: string): void {
    if (cause) this.baseError.set(serverName, cause);
    this.manager.onServerError(serverName);                // manager self-gates via isEligible → this.isEligible
  }

  cancel(serverName: string): void { this.manager.cancel(serverName); this.baseError.delete(serverName); }
  resetAll(): void { this.manager.cancelAll(); this.everConnected.clear(); this.baseError.clear(); }
}
```

The coordinator's `isEligible` calls `shouldAutoReconnect({ isBuiltin: host.isBuiltin(s),
inUse: host.isInUse(s), everConnected: this.everConnected.has(s), needsUserInteraction:
host.getStatus(s) === 'needs-user-interaction' })`. Before delegating to the scheduler,
`onServerError` also suppresses deterministic user-action/config failures via
`shouldSuppressAutoReconnectForError(cause)` and the manager-provided
`wasAwaitingUserInteraction` snapshot. The snapshot matters because an auth/consent
error is first represented as `needs-user-interaction`, then overwritten to `error` so
the UI is not stuck in a pending sign-in state; retry eligibility must still see that
previous user-action requirement. `setReconnectStatus(serverName, hint)` composes
`<baseError>; <hint>` (or just `<hint>` when no cause was captured — unreachable via
the public flow, which always records a cause first) and forwards to `host.setLastError`.

## 7. Layer 3 wiring — `MCPClientManager`

- **Track "ever connected".** In `_updateServerStatus`, when `status === 'connected'`,
  `this.autoReconnect.noteConnected(serverName)`.
- **Instantiate** `this.autoReconnect = new McpAutoReconnectCoordinator({ executeReconnect: (s) => this.opLock.run(s, 'reconnect', () => this._performReconnect(s), { isAutoReconnect: true }), getStatus: (s) => this.runtimeStates.get(s)?.status, isBuiltin: (s) => this.isBuiltinServer(s), isInUse: (s) => this._isServerInUse(s), setLastError: (s, m) => this._updateServerError(s, new Error(m)), log: ... })`.
- **Trigger** in `_registerClientStateHandlers` after setting status `error`:
  `this.autoReconnect.onServerError(serverName, causeMessage)` (the captured failure text).
- **In-use snapshot** (used by the host adapter's `isInUse`):

```ts
private _isServerInUse(serverName: string): boolean {
  if (!this.currentUserAlias) return false;
  try {
    const info = profileCacheManager.getMcpServerInfo(this.currentUserAlias, serverName);
    return !!info.config && info.config.in_use !== false;
  } catch { return false; }
}
```

- **Cancel / supersede on manual intent.** `connect`, `disconnect`, `reconnect`
  (public) call `this.autoReconnect.cancel(serverName)` first, then take the
  operation lock via `opLock.run`. `update` does the same: it `cancel`s the
  auto-reconnect synchronously and runs its background disconnect+reconnect inside
  one `opLock.run(serverName, 'connect', …)`, so a config edit cannot interleave
  with (or be clobbered by) a pending/in-flight auto-reconnect using the old
  config. A manual op that collides with an in-flight auto-reconnect attempt waits
  it out and proceeds (the manual action wins); see the operation-lock subsection
  in §7. After a manual `disconnect`, `in_use` becomes `false`, so the server is no
  longer eligible anyway.
- **Teardown.** The cleanup path calls `this.autoReconnect.resetAll()` first (cancels
  every schedule, bumps in-flight cancel epochs, and forgets the ever-connected set)
  and then `opLock.clear()` before client cleanup. `clear()` aborts every operation
  lock signal, so an in-flight auto-reconnect that outlives teardown returns before
  repopulating runtime state/tool mappings. `VscMcpClient.cleanup()` also calls the
  underlying VSCode client `disconnect()` even when the adapter is not marked
  connected, so starting/error transports are stopped during profile teardown.

### Why `_performReconnect`, not a new `cleanup-without-disabling`

The reconnect path reuses the existing client (or full-connects when none
remains) and **never** writes `in_use = false` — only `_performDisconnect` does.
So no new "cleanup without disabling" helper is needed; the auto path simply
routes through `opLock.run('reconnect', _performReconnect, { isAutoReconnect: true })`.

### Operation lock & manual supersede (`mcpOperationLock.ts`)

`OperationLockManager` serializes the three mutating operations (`connect` /
`disconnect` / `reconnect`) per server so they never interleave. Each lock is
tagged `isAutoReconnect` when held by a background attempt. A **manual** op that
collides with an **in-flight auto-reconnect** attempt does not throw — it `await`s
that attempt's settle, clears the stale lock, then proceeds, so the manual action
always wins (the public op also calls `autoReconnect.cancel` first, bumping the
epoch so the settling attempt cannot reschedule). Any other collision
(manual-vs-manual, or anything vs a *starting* manual op) still rejects fast with
`is currently <op>ing, please wait` as double-action protection. `run` creates the
operation `AbortSignal`, installs the lock, and only then starts the action, so
cleanup can abort a starting action deterministically. An identity guard in the
`finally` (`locks.get(server) === ourLock`) ensures a superseding op or `clear()`
never deletes a newer lock; `clear()` aborts all held signals before emptying the map.

The operation lock's lifecycle is owned **solely** by `OperationLockManager.run`.
`_forceCancelConnection` (the in-flight-connection teardown used by
`_performDisconnect`) tears down only the active connection process and client
mappings; it must **not** abort or delete the operation lock. Otherwise a
`disconnect`/`update` would release its own lock at the very start of
`_performDisconnect` and run the rest of the disconnect (and, for `update`, the
follow-up connect) unserialized, defeating the guarantee above. In-flight connect
cancellation is unaffected because it is driven by the separate
`activeConnections[server].abortController`; profile teardown uses the operation
lock signal as the broader lifecycle abort for any in-flight connect/reconnect.

## 8. Status / visibility

No new `MCPServerStatus` value. During an attempt the existing `_performReconnect`
sets `connecting`; between attempts the status is `error` with `lastError`
carrying `auto-reconnecting (attempt N) in Ns` (or the give-up message). This
keeps all changes inside `mcpRuntime` (main process) — no renderer type or
mapping changes, which also keeps the coverage surface contained.

### Structured logs

| Event | When |
| --- | --- |
| `mcp.protocol.unmatched-error` | unmatched JSON-RPC error received (class logged) |
| `mcp.tool.timeout.request` | a single request hit the idle budget (request-level) |
| `mcp.tool.timeout.escalated` | Nth consecutive timeout → connection reset |
| `mcp.auto-reconnect.scheduled` | next attempt scheduled (attempt #, delay) |
| `mcp.auto-reconnect.started` / `.succeeded` / `.failed` / `.gave-up` | attempt lifecycle |
| `mcp.auto-reconnect.suppressed` | ineligible (builtin / not in use / never connected / needs interaction) |

## 9. Testing strategy (≥90% per changed file)

- **`mcpReconnectPolicy.test.ts`** — classify by code, by each pattern, null/empty,
  ambiguous; backoff index clamping at both ends + jitter via stub rng; every
  `shouldAutoReconnect` arm (builtin / not-in-use / never-connected /
  needs-interaction / eligible).
- **`mcpAutoReconnectManager.test.ts`** — schedule→run→success resets attempts;
  failed run chains the next attempt; cap stops after MAX with give-up message;
  ineligible `onServerError` cancels; `cancel`/`cancelAll`; idempotency while in
  flight; a `cancel`/`cancelAll` that races an in-flight attempt suppresses the
  stale reschedule (cancel-epoch guard, both resolve and reject arms); injected
  fake timer/clock/rng.
- **`mcpAutoReconnectCoordinator.test.ts`** — eligibility arms (builtin / no user /
  not-in-use / never-connected / needs-interaction / eligible); compose with and
  without a captured base cause; full cycle success (stops once connected) and
  failure (reschedules with longer backoff); `cancel` stops a pending attempt;
  `resetAll` cancels schedules and forgets the ever-connected set.
- **`VscodeMcpClient` tests** (`VscodeMcpClientFull.test.ts`) — UPDATE the existing
  idle-timeout test (single timeout no longer stops the transport); ADD: unmatched
  `Session not found` → connection failed + pending rejected; ambiguous single
  pending → that request rejected, transport kept; a stale error carrying a concrete
  id does NOT reject an unrelated in-flight request; **matched** lost-session error
  (`-32001`, id echoes the request) → `failConnection` + state `error` (not just a
  single-request reject); matched non-connection-lost business error → only that
  request rejected, transport kept; 3 consecutive timeouts → `failConnection`;
  matched response resets the counter; cancellation notification is sent.
- **`mcpClientManager` tests** — `noteConnected` on connect; `_isServerInUse`
  true/false/throw; `onServerError(name, cause)` called on stateChange error (not on
  connected); manual ops cancel; cleanup `resetAll`; cleanup aborts an in-flight
  auto-reconnect before it can repopulate runtime state/tool mappings; a fake-timer
  integration test drives the host-adapter closures through a full reconnect cycle.
- **`mcpOperationLock.test.ts`** — `OperationLockManager`: runs an action and clears
  its own lock; rejects a colliding manual op while a non-auto lock is held; rejects
  an auto op colliding with another in-flight auto attempt; a manual op supersedes a
  real in-flight auto attempt (post-await skip branch) and an orphaned auto lock
  (in-loop delete branch, both resolve and reject arms); `clear()` racing an in-flight
  run (finally skip branch) and aborting the action signal; size/get/delete/clear
  accessors.
- **`toolTimeoutPolicy.test.ts`** — new constants present; `McpProtocolConnectionError`
  fields.

## 10. Risks & mitigations

- **Reconnect storm** against a permanently-broken server → bounded by
  `MAX_AUTO_RECONNECT_ATTEMPTS` (8) and the 30-min backoff cap; resets only after a
  stable `connected`.
- **Fighting a manual op** → public connect/disconnect/reconnect/update cancel
  pending auto-reconnect; the per-server `OperationLockManager` serializes attempts.
- **Auth/config loops** → `needs-user-interaction`, the manager's
  pre-error user-interaction snapshot, MCP auth failure codes, account-gated
  post-sign-in responses, and deterministic transport-config errors suppress
  auto-reconnect.
- **Late tool replies after a request-level timeout** → ignored by id matching
  (the request is already removed from `pendingRequests`).

## 11. Out of scope / follow-ups

- Surfacing a dedicated `reconnecting` status in the renderer (current reuse of
  `error` + last-error text is sufficient for now).
- A user-facing "reconnect now" affordance distinct from the existing manual
  reconnect button.
