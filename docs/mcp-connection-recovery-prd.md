# MCP Connection Recovery — PRD

<!-- Last verified: 2026-06-25 -->

## 1. Background

OpenKosmos connects to third-party MCP servers (stdio / HTTP / SSE) through
`MCPClientManager` and `VscodeMcpClient`. A production incident showed a chain of
failures around the **Teams** MCP server:

1. A `tools/call:SendMessageToUser` request (JSON-RPC `id = 113`) was sent.
2. ~3s later the upstream proxy answered with a JSON-RPC **error** whose `id` was
   an **empty string** (`""`): `{"code":-32001,"message":"Session not found"}`.
   The upstream session had been lost (proxy/session-level, not a business error).
3. Because the error `id` did not match any pending request, `handleMessage()`
   classified it as a *notification* and **ignored** it. The pending request kept
   waiting.
4. After **10 minutes** of no response, the idle watchdog
   (`terminateConnectionAfterToolIdleTimeout`) fired and **tore down the whole
   Teams connection** (transport stopped, state `error`).
5. Every subsequent scheduled run that required Teams was then silently skipped
   (a separate gate), so from the user's perspective "scheduled tasks just
   stopped working" with **no visible reason**.

Two distinct defects compounded the impact:

- **A) Wedged for 10 minutes on a fatal protocol error.** A "Session not found"
  answer means the call can never succeed on that connection, yet the client
  waited the full idle budget before reacting.
- **B) No recovery.** Once the connection went to `error`, nothing ever tried to
  bring it back, even though the failure was a transient upstream/session loss
  that a reconnect would very likely fix.

> The scheduler "silent skip" half of this incident is addressed by a separate
> change (scheduled runs now fail **visibly** when a required MCP server is
> disconnected). This PRD covers the **MCP connection layer**: reacting to fatal
> protocol errors quickly, scoping tool timeouts to the request, and
> automatically recovering a connection that was healthy and suddenly failed.

## 2. Goals

- **G1 — Fail fast on fatal protocol errors.** When a server reports an error
  that the client cannot attribute to a specific request but that clearly means
  the connection/session is gone (e.g. `Session not found`), stop waiting
  immediately instead of after the 10-minute idle budget.
- **G2 — Tool timeouts terminate the tool call, not the server.** A single
  long-silent tool call must fail **that call** and leave the MCP connection and
  its other tools usable. Only *repeated* no-response timeouts (a sign the
  transport itself is wedged) may escalate to a connection reset.
- **G3 — Auto-recover dropped connections.** A server that was previously
  `connected`, is still in use, and suddenly enters `error` (transport exit,
  network drop, lost upstream session) should be reconnected automatically with
  exponential backoff, without user action.
- **G4 — Keep the user informed.** Recovery state and reasons are visible through
  the server's last-error text and structured logs; failures are never silent.

## 3. Non-goals

- Changing how the **scheduler** behaves (already handled: it never waits for a
  reconnect and creates a visible failed session when a required server is down).
- Reconnecting the **builtin** server (it is always connected and managed
  separately).
- Auto-reconnecting servers that need **user interaction** (OAuth consent /
  sign-in) or that have **invalid configuration** — these cannot be fixed by
  retrying and must wait for the user.
- Adding a brand-new MCP server status value or any renderer/UI redesign. The
  existing `connecting` / `error` statuses plus last-error text are reused.
- Guaranteeing in-flight tool calls survive a reconnect. A reconnect is a fresh
  session; calls that were in flight fail and may be retried by the caller.

## 4. User-visible behavior

| Situation | Before | After |
| --- | --- | --- |
| Server returns `Session not found` (unmatched id) | Tool call hangs 10 min, then the whole server dies | Tool call fails within seconds with `Session not found`; server auto-reconnects |
| One tool call is silent past the idle budget | Entire server connection is killed | Only that tool call fails; the server and its other tools stay connected |
| Many tool calls time out in a row | (same single kill) | After N consecutive timeouts the connection is reset and auto-reconnects |
| A connected, in-use server drops (process exit / network) | Stays `error` until the user manually reconnects | Auto-reconnects with backoff; last-error shows `auto-reconnecting (attempt N) in Ns` |
| Server needs OAuth / sign-in | n/a | **No** auto-reconnect; waits for the user |
| User manually disconnects / reconnects / updates config | n/a | Pending **or in-flight** auto-reconnect is cancelled/superseded; the manual action wins |

## 5. Functional requirements

- **FR1.** Unmatched JSON-RPC **error** responses (those whose `id` matches no
  pending request — empty, missing, or non-matching `id`) must no longer be
  silently dropped as notifications; they are inspected and classified per
  FR2–FR3.
- **FR2.** A `connection-lost` class error (e.g. JSON-RPC `-32001` /
  `Session not found`) must fail the connection immediately, rejecting all
  pending requests with the upstream message, and trigger auto-reconnect. This
  applies regardless of the error's `id` (matching, empty, or non-matching).
- **FR3.** An **ambiguous** unmatched error — one whose `id` is absent or empty,
  so it cannot be attributed to any specific call — must reject the single
  in-flight request when exactly one exists, and otherwise be logged without
  killing the connection. An unmatched error carrying a **concrete** `id` that
  matches no pending request is a stale/late reply (its original request already
  settled, e.g. via the FR4 idle timeout); it must be logged only and must
  **never** be reattributed to a different in-flight request, since doing so
  would fail the wrong tool call.
- **FR4.** A tool no-response (idle) timeout must reject **only that request**,
  clear its activity listeners, best-effort send `notifications/cancelled`, and
  **keep** the transport.
- **FR5.** `N` consecutive idle timeouts within a time window must escalate to a
  connection reset (which then auto-reconnects). A matched response resets the
  counter.
- **FR6.** Auto-reconnect applies only to non-builtin, in-use, previously
  connected servers that are not awaiting user interaction and did not fail due
  to deterministic user-action/configuration issues (for example OAuth consent,
  DCR/client registration, account-gated endpoints, or invalid transport config).
  It uses exponential backoff with jitter and a maximum attempt cap, and resets
  after a stable connection.
- **FR7.** Manual `connect` / `disconnect` / `reconnect` / `update` and profile
  teardown cancel any pending auto-reconnect for that server.
- **FR8.** Recovery progress and outcomes are emitted as structured logs and
  reflected in the server's last-error text.

## 6. Success criteria

- The Teams `Session not found` case fails the tool call in **seconds**, not 10
  minutes, and the connection comes back automatically.
- A single hung tool no longer disconnects an otherwise healthy MCP server.
- No regression in builtin-server handling, manual connect/disconnect/reconnect,
  OAuth servers, or scheduler behavior.
- All changed source files meet the repository's ≥90% per-file coverage gate.
